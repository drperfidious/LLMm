import {
  buildQualityCompletionParams,
  calculateQualityScore,
  DEFAULT_IOS_FIT_QUALITY_TASKS,
  deriveQualityCapabilities,
  evaluateQualityTask,
  runQualityTasks,
  type QualityTask,
} from '../qualityTasks';

const baseResult = {
  reasoning_content: '',
  tool_calls: [],
  chat_format: 0,
  tokens_predicted: 8,
  tokens_evaluated: 16,
  draft_tokens: 0,
  draft_tokens_accepted: 0,
  truncated: false,
  timings: {},
} as any;

describe('qualityTasks', () => {
  it('passes strict JSON formatting only when fields match exactly', () => {
    const task: QualityTask = {id: 'format-json', kind: 'json_format'};
    const passed = evaluateQualityTask(task, {
      ...baseResult,
      content: '{"answer":42,"unit":"tokens"}',
      text: '',
    });
    const failed = evaluateQualityTask(task, {
      ...baseResult,
      content: '{"answer":42,"unit":"tokens","extra":true}',
      text: '',
    });
    expect(passed.passed).toBe(true);
    expect(passed.score).toBe(1);
    expect(failed.passed).toBe(false);
  });

  it('extracts schema JSON wrapped in chat-template markers', () => {
    const jsonTask: QualityTask = {id: 'format-json', kind: 'json_format'};
    const contextTask: QualityTask = {id: 'context', kind: 'context_recall'};
    const jsonResult = evaluateQualityTask(jsonTask, {
      ...baseResult,
      content:
        '<|im_start|>assistant ```json\\n{\"answer\":42,\"unit\":\"tokens\"}\\n```',
      text: '',
    });
    const contextResult = evaluateQualityTask(contextTask, {
      ...baseResult,
      content:
        '<start_of_turn>model {\"start\":\"ppal-start-7f3a\",\"end\":\"ppal-end-4d91\"}',
      text: '',
    });

    expect(jsonResult.passed).toBe(true);
    expect(contextResult.passed).toBe(true);
  });

  it('passes tool_call when the calculator expression contains 13*7', () => {
    const task: QualityTask = {id: 'tool-call', kind: 'tool_call'};
    const result = evaluateQualityTask(task, {
      ...baseResult,
      content: '',
      text: '',
      tool_calls: [
        {
          type: 'function',
          function: {name: 'calculator', arguments: '{"expression":"13 * 7"}'},
        },
      ],
    });
    expect(result.passed).toBe(true);
    expect(result.details).toMatchObject({
      tool_name: 'calculator',
      expression: '13 * 7',
      raw_arguments_preview: '{"expression":"13 * 7"}',
      arguments_parse_error: null,
    });
  });

  it('records malformed tool-call arguments for benchmark auditing', () => {
    const task: QualityTask = {id: 'tool-call', kind: 'tool_call'};
    const result = evaluateQualityTask(task, {
      ...baseResult,
      content: '',
      text: '',
      tool_calls: [
        {
          type: 'function',
          function: {name: 'calculator', arguments: '{"expression":'},
        },
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.details).toMatchObject({
      tool_call_count: 1,
      tool_name: 'calculator',
      expression: null,
      raw_arguments_preview: '{"expression":',
    });
    expect(result.details?.arguments_parse_error).toEqual(expect.any(String));
  });

  it('scores reasoning from the visible final answer instead of hidden thinking', () => {
    const task: QualityTask = {id: 'reasoning-42', kind: 'reasoning'};
    const hiddenOnly = evaluateQualityTask(task, {
      ...baseResult,
      content: '<think>18 - 5 = 13. 13 * 3 = 39. 39 + 3 = 42.</think>',
      text: '',
    });
    const visibleFinal = evaluateQualityTask(task, {
      ...baseResult,
      content:
        '<think>18 - 5 = 13.</think> 18 - 5 = 13; 13 * 3 = 39; 39 + 3 = 42. Final answer: 42',
      text: '',
    });

    expect(hiddenOnly.passed).toBe(false);
    expect(hiddenOnly.details).toMatchObject({
      final_integer: null,
      had_reasoning_block: true,
    });
    expect(visibleFinal.passed).toBe(true);
    expect(visibleFinal.details).toMatchObject({
      final_integer: '42',
      had_reasoning_block: true,
    });
  });

  it('builds context recall params with schema-constrained JSON output', () => {
    const params = buildQualityCompletionParams({
      id: 'context',
      kind: 'context_recall',
      context_chars: 128,
    });
    expect(params.response_format?.type).toBe('json_schema');
    expect(JSON.stringify(params.messages)).toContain('ppal-start-7f3a');
    expect(JSON.stringify(params.messages)).toContain('ppal-end-4d91');
  });

  it('disables thinking and gives default quality tasks a fair token budget', () => {
    expect(
      DEFAULT_IOS_FIT_QUALITY_TASKS.every(task => task.n_predict === 512),
    ).toBe(true);
    expect(
      DEFAULT_IOS_FIT_QUALITY_TASKS.every(task => task.timeout_ms! >= 90_000),
    ).toBe(true);

    const params = buildQualityCompletionParams({
      id: 'reasoning-42',
      kind: 'reasoning',
    });
    expect(params.n_predict).toBe(512);
    expect(params.enable_thinking).toBe(false);
    expect(params.reasoning_format).toBe('auto');
    expect(JSON.stringify(params.messages)).toContain('Do not output <think>');
  });

  it('does not bias the tool-call task toward prose final answers', () => {
    const params = buildQualityCompletionParams({
      id: 'tool-call',
      kind: 'tool_call',
    });
    const prompt = JSON.stringify(params.messages);

    expect(params.enable_thinking).toBe(false);
    expect(prompt).toContain('Emit the calculator tool call directly');
    expect(prompt).not.toContain('Return only the requested final answer');
  });

  it('passes model stop words into quality completion params', () => {
    const params = buildQualityCompletionParams(
      {id: 'format-json', kind: 'json_format'},
      {stop: ['<|end|>', '<|assistant|>', '<|end|>', '']},
    );

    expect(params.stop).toEqual(['<|end|>', '<|assistant|>']);
  });

  it('can build JSON tasks without native schema constraints for fallback retries', () => {
    const params = buildQualityCompletionParams(
      {id: 'format-json', kind: 'json_format'},
      {constrainedJson: false},
    );

    expect(params.response_format).toBeUndefined();
    expect(JSON.stringify(params.messages)).toContain('answer=42');
  });

  it('calculates weighted quality scores against configured task ids', () => {
    const tasks: QualityTask[] = [
      {id: 'a', kind: 'reasoning', weight: 3},
      {id: 'b', kind: 'json_format', weight: 1},
    ];
    expect(
      calculateQualityScore(tasks, [
        {
          id: 'a',
          kind: 'reasoning',
          passed: true,
          score: 1,
          wall_ms: 1,
          tokens_predicted: 1,
          tokens_evaluated: 1,
          text_preview: '42',
        },
        {
          id: 'b',
          kind: 'json_format',
          passed: false,
          score: 0,
          wall_ms: 1,
          tokens_predicted: 1,
          tokens_evaluated: 1,
          text_preview: '',
        },
      ]),
    ).toBe(0.75);
  });

  it('derives capability tiers independently from the strict all-pass gate', () => {
    const capabilities = deriveQualityCapabilities({
      status: 'ok',
      ppAvg: 800,
      tgAvg: 12,
      qualityPassed: false,
      qualityResults: [
        {
          id: 'format-json',
          kind: 'json_format',
          passed: true,
          score: 1,
          wall_ms: 1,
          tokens_predicted: 1,
          tokens_evaluated: 1,
          text_preview: '{}',
        },
        {
          id: 'tool-call',
          kind: 'tool_call',
          passed: false,
          score: 0,
          wall_ms: 1,
          tokens_predicted: 1,
          tokens_evaluated: 1,
          text_preview: '',
        },
        {
          id: 'reasoning-42',
          kind: 'reasoning',
          passed: true,
          score: 1,
          wall_ms: 1,
          tokens_predicted: 1,
          tokens_evaluated: 1,
          text_preview: '42',
        },
      ],
    });

    expect(capabilities).toEqual(['fit', 'chat-capable', 'format-capable']);
    expect(capabilities).not.toContain('baseline-eligible');
  });

  it('marks tool-call capability separately from full agent capability', () => {
    const capabilities = deriveQualityCapabilities({
      status: 'ok',
      ppAvg: 800,
      tgAvg: 12,
      qualityPassed: false,
      qualityResults: [
        {
          id: 'format-json',
          kind: 'json_format',
          passed: true,
          score: 1,
          wall_ms: 1,
          tokens_predicted: 1,
          tokens_evaluated: 1,
          text_preview: '{}',
        },
        {
          id: 'tool-call',
          kind: 'tool_call',
          passed: true,
          score: 1,
          wall_ms: 1,
          tokens_predicted: 1,
          tokens_evaluated: 1,
          text_preview: '',
        },
      ],
    });

    expect(capabilities).toEqual([
      'fit',
      'format-capable',
      'tool-call-capable',
    ]);
    expect(capabilities).not.toContain('agent-capable');
  });

  it('requires chat, formatting, and tool calling for full agent capability', () => {
    const capabilities = deriveQualityCapabilities({
      status: 'ok',
      ppAvg: 800,
      tgAvg: 12,
      qualityPassed: false,
      qualityResults: [
        {
          id: 'format-json',
          kind: 'json_format',
          passed: true,
          score: 1,
          wall_ms: 1,
          tokens_predicted: 1,
          tokens_evaluated: 1,
          text_preview: '{}',
        },
        {
          id: 'tool-call',
          kind: 'tool_call',
          passed: true,
          score: 1,
          wall_ms: 1,
          tokens_predicted: 1,
          tokens_evaluated: 1,
          text_preview: '',
        },
        {
          id: 'reasoning-42',
          kind: 'reasoning',
          passed: true,
          score: 1,
          wall_ms: 1,
          tokens_predicted: 1,
          tokens_evaluated: 1,
          text_preview: '42',
        },
      ],
    });

    expect(capabilities).toEqual([
      'fit',
      'chat-capable',
      'format-capable',
      'tool-call-capable',
      'agent-capable',
    ]);
  });

  it('adds baseline-eligible only when every configured quality result passes', () => {
    expect(
      deriveQualityCapabilities({
        status: 'ok',
        ppAvg: 800,
        tgAvg: 12,
        qualityPassed: true,
        qualityResults: [
          {
            id: 'format-json',
            kind: 'json_format',
            passed: true,
            score: 1,
            wall_ms: 1,
            tokens_predicted: 1,
            tokens_evaluated: 1,
            text_preview: '{}',
          },
        ],
      }),
    ).toEqual(['fit', 'format-capable', 'baseline-eligible']);
  });

  it('runs task completions sequentially and clears cache between tasks when available', async () => {
    const ctx = {
      clearCache: jest.fn().mockResolvedValue(undefined),
      stopCompletion: jest.fn().mockResolvedValue(undefined),
      completion: jest.fn().mockResolvedValue({
        ...baseResult,
        content: '42',
        text: '42',
      }),
    } as any;
    const results = await runQualityTasks(ctx, [
      {id: 'reasoning-1', kind: 'reasoning'},
      {id: 'reasoning-2', kind: 'reasoning'},
    ]);
    expect(results).toHaveLength(2);
    expect(results.every(result => result.passed)).toBe(true);
    expect(ctx.clearCache).toHaveBeenCalledTimes(2);
    expect(ctx.completion).toHaveBeenCalledTimes(2);
  });

  it('uses stop words during benchmark quality completions', async () => {
    const ctx = {
      clearCache: jest.fn().mockResolvedValue(undefined),
      stopCompletion: jest.fn().mockResolvedValue(undefined),
      completion: jest.fn().mockResolvedValue({
        ...baseResult,
        content: '42',
        text: '42',
      }),
    } as any;

    await runQualityTasks(ctx, [{id: 'reasoning-1', kind: 'reasoning'}], {
      stop: ['<|end|>', '<|assistant|>'],
    });

    expect(ctx.completion.mock.calls[0][0].stop).toEqual([
      '<|end|>',
      '<|assistant|>',
    ]);
  });

  it('runs JSON quality tasks without native schema constraints by default', async () => {
    const ctx = {
      clearCache: jest.fn().mockResolvedValue(undefined),
      stopCompletion: jest.fn().mockResolvedValue(undefined),
      completion: jest.fn().mockResolvedValue({
        ...baseResult,
        content: '{"answer":42,"unit":"tokens"}',
        text: '',
      }),
    } as any;

    const results = await runQualityTasks(ctx, [
      {id: 'format-json', kind: 'json_format'},
    ]);

    expect(ctx.completion).toHaveBeenCalledTimes(1);
    expect(ctx.completion.mock.calls[0][0].response_format).toBeUndefined();
    expect(results[0].passed).toBe(true);
  });

  it('retries JSON schema tasks without response_format after native schema errors', async () => {
    const ctx = {
      clearCache: jest.fn().mockResolvedValue(undefined),
      stopCompletion: jest.fn().mockResolvedValue(undefined),
      completion: jest
        .fn()
        .mockRejectedValueOnce(new Error('std::exception'))
        .mockResolvedValueOnce({
          ...baseResult,
          content: '{"answer":42,"unit":"tokens"}',
          text: '',
        }),
    } as any;

    const results = await runQualityTasks(
      ctx,
      [{id: 'format-json', kind: 'json_format'}],
      {constrainedJson: true, stop: ['<|stop|>']},
    );

    expect(ctx.completion).toHaveBeenCalledTimes(2);
    expect(ctx.completion.mock.calls[0][0].response_format?.type).toBe(
      'json_schema',
    );
    expect(ctx.completion.mock.calls[0][0].stop).toEqual(['<|stop|>']);
    expect(ctx.completion.mock.calls[1][0].response_format).toBeUndefined();
    expect(ctx.completion.mock.calls[1][0].stop).toEqual(['<|stop|>']);
    expect(results[0].passed).toBe(true);
    expect(results[0].details).toMatchObject({
      parsed: {answer: 42, unit: 'tokens'},
      response_format_retry: 'unconstrained',
      response_format_error: 'std::exception',
    });
  });

  it('does not retry JSON schema tasks after quality timeouts', async () => {
    const ctx = {
      clearCache: jest.fn().mockResolvedValue(undefined),
      stopCompletion: jest.fn().mockResolvedValue(undefined),
      completion: jest
        .fn()
        .mockRejectedValue(new Error('quality-timeout:1000')),
    } as any;

    const results = await runQualityTasks(ctx, [
      {id: 'format-json', kind: 'json_format'},
    ]);

    expect(ctx.completion).toHaveBeenCalledTimes(1);
    expect(results[0]).toMatchObject({
      passed: false,
      error: 'quality-timeout:1000',
    });
  });
});
