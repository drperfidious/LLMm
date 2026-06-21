import type {
  CompletionParams,
  LlamaContext,
  NativeCompletionResult,
  ToolCall,
} from 'llama.rn';

export type QualityTaskKind =
  | 'json_format'
  | 'tool_call'
  | 'reasoning'
  | 'context_recall';

export type QualityCapability =
  | 'fit'
  | 'chat-capable'
  | 'format-capable'
  | 'tool-call-capable'
  | 'agent-capable'
  | 'long-context-capable'
  | 'baseline-eligible';

export interface QualityTask {
  id: string;
  kind: QualityTaskKind;
  weight?: number;
  timeout_ms?: number;
  n_predict?: number;
  /**
   * Optional long-context stress size. The default is intentionally below
   * the runner's current 2048-token n_ctx, but producers can raise it when
   * they also raise base_params.n_ctx.
   */
  context_chars?: number;
}

export interface QualityTaskResult {
  id: string;
  kind: QualityTaskKind;
  passed: boolean;
  score: number;
  wall_ms: number;
  tokens_predicted: number | null;
  tokens_evaluated: number | null;
  predicted_per_second?: number | null;
  draft_tokens?: number | null;
  draft_tokens_accepted?: number | null;
  text_preview: string;
  error?: string;
  details?: Record<string, unknown>;
}

interface QualityCompletionOptions {
  constrainedJson?: boolean;
  stop?: CompletionParams['stop'];
}

interface RunQualityTaskOptions extends QualityCompletionOptions {}

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_N_PREDICT = 512;
const TEXT_PREVIEW_LIMIT = 240;
const NO_THINKING_INSTRUCTION =
  'Thinking is disabled for this benchmark. Do not output <think> blocks or hidden reasoning.';

const toolSchema = [
  {
    type: 'function',
    function: {
      name: 'calculator',
      description: 'Evaluate a small arithmetic expression.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['expression'],
        properties: {
          expression: {
            type: 'string',
            description: 'Arithmetic expression to evaluate.',
          },
        },
      },
    },
  },
];

function textFromResult(result: NativeCompletionResult): string {
  return (result.content || result.text || '').trim();
}

function preview(text: string): string {
  return text.replace(/\s+/g, ' ').slice(0, TEXT_PREVIEW_LIMIT);
}

function stripChatTemplateMarkers(text: string): string {
  return text
    .replace(/<\|im_start\|>\s*assistant/gi, '')
    .replace(/<\|im_end\|>/gi, '')
    .replace(/<start_of_turn>\s*model/gi, '')
    .replace(/<end_of_turn>/gi, '')
    .trim();
}

function stripReasoningBlocks(text: string): {
  visibleText: string;
  hadReasoningBlock: boolean;
} {
  const hadReasoningBlock = /<(?:think|reasoning)>/i.test(text);
  return {
    visibleText: text
      .replace(/<(?:think|reasoning)>[\s\S]*?<\/(?:think|reasoning)>/gi, ' ')
      .replace(/<(?:think|reasoning)>[\s\S]*$/gi, ' ')
      .trim(),
    hadReasoningBlock,
  };
}

function extractFinalInteger(text: string): string | null {
  const cleaned = stripChatTemplateMarkers(text).replace(/\s+/g, ' ').trim();
  const finalAnswer = [
    ...cleaned.matchAll(
      /(?:final\s+answer|answer|result|integer)\s*(?:is|:|-)?\s*(-?\d+)\b/gi,
    ),
  ].pop();
  if (finalAnswer?.[1]) {
    return finalAnswer[1];
  }

  const integers = [...cleaned.matchAll(/-?\d+\b/g)];
  return integers.length > 0 ? integers[integers.length - 1][0] : null;
}

function extractJsonPayload(text: string): string {
  const cleaned = stripChatTemplateMarkers(text);
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fenced ? fenced[1] : cleaned).trim();
  if (candidate.startsWith('{') && candidate.endsWith('}')) {
    return candidate;
  }
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return candidate.slice(start, end + 1).trim();
  }
  return candidate;
}

function buildContextPrompt(contextChars: number): string {
  const start = 'ppal-start-7f3a';
  const end = 'ppal-end-4d91';
  const filler =
    'The benchmark filler sentence is deliberately plain and repetitive. ';
  const repeats = Math.max(1, Math.ceil(contextChars / filler.length));
  return [
    `Remember both sentinel values: ${start} and ${end}.`,
    filler.repeat(repeats).slice(0, contextChars),
    `Now answer with only this JSON: {"start":"${start}","end":"${end}"}`,
  ].join('\n');
}

function strictSystemPrompt(
  content: string,
  responseInstruction: string,
): string {
  return `${content} ${NO_THINKING_INSTRUCTION} ${responseInstruction}`;
}

function normalizeStopWords(
  stop: CompletionParams['stop'] | undefined,
): CompletionParams['stop'] | undefined {
  const values = Array.isArray(stop)
    ? [...new Set(stop.filter(word => word.length > 0))]
    : [];
  return values.length > 0 ? values : undefined;
}

export function buildQualityCompletionParams(
  task: QualityTask,
  options: QualityCompletionOptions = {},
): CompletionParams {
  const nPredict = task.n_predict ?? DEFAULT_N_PREDICT;
  const useConstrainedJson = options.constrainedJson !== false;
  const stop = normalizeStopWords(options.stop);
  const common = {
    n_predict: nPredict,
    temperature: 0,
    top_p: 1,
    jinja: true,
    enable_thinking: false,
    reasoning_format: 'auto' as const,
    ...(stop ? {stop} : {}),
  };

  if (task.kind === 'json_format') {
    const params = {
      ...common,
      messages: [
        {
          role: 'system',
          content: strictSystemPrompt(
            'Return only valid JSON. Do not include markdown.',
            'Return only the requested JSON object.',
          ),
        },
        {
          role: 'user',
          content:
            'Return a JSON object with answer=42 and unit="tokens". No extra keys.',
        },
      ],
    } as CompletionParams;
    if (!useConstrainedJson) {
      return params;
    }
    return {
      ...params,
      response_format: {
        type: 'json_schema',
        json_schema: {
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['answer', 'unit'],
            properties: {
              answer: {type: 'integer'},
              unit: {type: 'string'},
            },
          },
        },
      },
    } as CompletionParams;
  }

  if (task.kind === 'tool_call') {
    return {
      ...common,
      messages: [
        {
          role: 'system',
          content: strictSystemPrompt(
            'When arithmetic requires a tool, call the calculator function.',
            'Emit the calculator tool call directly. Do not explain the calculation in prose.',
          ),
        },
        {
          role: 'user',
          content: 'Use the calculator tool to multiply 13 by 7.',
        },
      ],
      tools: toolSchema as object,
      tool_choice: 'auto',
    } as CompletionParams;
  }

  if (task.kind === 'context_recall') {
    const params = {
      ...common,
      messages: [
        {
          role: 'system',
          content: strictSystemPrompt(
            'Answer exactly as requested. Preserve sentinel strings verbatim.',
            'Return only the requested JSON object.',
          ),
        },
        {
          role: 'user',
          content: buildContextPrompt(task.context_chars ?? 6000),
        },
      ],
    } as CompletionParams;
    if (!useConstrainedJson) {
      return params;
    }
    return {
      ...params,
      response_format: {
        type: 'json_schema',
        json_schema: {
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['start', 'end'],
            properties: {
              start: {type: 'string'},
              end: {type: 'string'},
            },
          },
        },
      },
    } as CompletionParams;
  }

  return {
    ...common,
    messages: [
      {
        role: 'system',
        content: strictSystemPrompt(
          'Answer with only the final integer. No explanation.',
          'Return only the requested final integer.',
        ),
      },
      {
        role: 'user',
        content:
          'A tray has 18 blue cubes. You remove 5, triple the remainder, then add 3. What number do you get?',
      },
    ],
  } as CompletionParams;
}

function parseToolArguments(call: ToolCall): {
  args: Record<string, unknown> | null;
  error: string | null;
} {
  try {
    return {args: JSON.parse(call.function.arguments), error: null};
  } catch (e) {
    return {args: null, error: (e as Error).message};
  }
}

export function evaluateQualityTask(
  task: QualityTask,
  result: NativeCompletionResult,
  wallMs = 0,
): QualityTaskResult {
  const text = textFromResult(result);
  const base = {
    id: task.id,
    kind: task.kind,
    wall_ms: wallMs,
    tokens_predicted:
      typeof result.tokens_predicted === 'number'
        ? result.tokens_predicted
        : null,
    tokens_evaluated:
      typeof result.tokens_evaluated === 'number'
        ? result.tokens_evaluated
        : null,
    predicted_per_second:
      typeof result.timings?.predicted_per_second === 'number'
        ? result.timings.predicted_per_second
        : null,
    draft_tokens:
      typeof result.draft_tokens === 'number' ? result.draft_tokens : null,
    draft_tokens_accepted:
      typeof result.draft_tokens_accepted === 'number'
        ? result.draft_tokens_accepted
        : null,
    text_preview: preview(text),
  };

  if (task.kind === 'json_format') {
    try {
      const parsed = JSON.parse(extractJsonPayload(text));
      const passed =
        parsed &&
        parsed.answer === 42 &&
        parsed.unit === 'tokens' &&
        Object.keys(parsed).length === 2;
      return {
        ...base,
        passed,
        score: passed ? 1 : 0,
        details: {parsed},
      };
    } catch (e) {
      return {
        ...base,
        passed: false,
        score: 0,
        error: (e as Error).message,
      };
    }
  }

  if (task.kind === 'tool_call') {
    const calls = result.tool_calls ?? [];
    const call = calls.find(c => c.function?.name === 'calculator');
    const parsed = call
      ? parseToolArguments(call as ToolCall)
      : {args: null, error: null};
    const args = parsed.args;
    const expression = String(args?.expression ?? '').replace(/\s+/g, '');
    const passed =
      Boolean(call) &&
      (expression.includes('13*7') ||
        expression.includes('7*13') ||
        expression.includes('13x7') ||
        expression.includes('91'));
    return {
      ...base,
      passed,
      score: passed ? 1 : 0,
      details: {
        tool_call_count: calls.length,
        tool_name: call?.function?.name ?? null,
        expression: args?.expression ?? null,
        raw_arguments_preview: call
          ? preview(String(call.function?.arguments ?? ''))
          : null,
        arguments_parse_error: parsed.error,
      },
    };
  }

  if (task.kind === 'context_recall') {
    try {
      const parsed = JSON.parse(extractJsonPayload(text));
      const passed =
        parsed?.start === 'ppal-start-7f3a' && parsed?.end === 'ppal-end-4d91';
      return {
        ...base,
        passed,
        score: passed ? 1 : 0,
        details: {parsed},
      };
    } catch (e) {
      return {
        ...base,
        passed: false,
        score: 0,
        error: (e as Error).message,
      };
    }
  }

  const {visibleText, hadReasoningBlock} = stripReasoningBlocks(text);
  const finalInteger = extractFinalInteger(visibleText);
  const passed = finalInteger === '42';
  return {
    ...base,
    passed,
    score: passed ? 1 : 0,
    details: {
      final_integer: finalInteger,
      visible_text_preview: preview(visibleText),
      had_reasoning_block: hadReasoningBlock,
      reached_token_limit:
        typeof result.tokens_predicted === 'number'
          ? result.tokens_predicted >= (task.n_predict ?? DEFAULT_N_PREDICT) - 1
          : null,
    },
  };
}

async function completionWithTimeout(
  ctx: LlamaContext,
  params: CompletionParams,
  timeoutMs: number,
): Promise<NativeCompletionResult> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      ctx.completion(params),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          ctx.stopCompletion().catch(() => undefined);
          reject(new Error(`quality-timeout:${timeoutMs}`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shouldRetryUnconstrainedJson(
  task: QualityTask,
  error: unknown,
): boolean {
  if (task.kind !== 'json_format' && task.kind !== 'context_recall') {
    return false;
  }

  const message = errorMessage(error);
  if (message.startsWith('quality-timeout:')) {
    return false;
  }

  return /std::exception|response_format|json_schema|schema|grammar|constraint/i.test(
    message,
  );
}

function withResponseFormatRetryDetails(
  result: QualityTaskResult,
  error: unknown,
): QualityTaskResult {
  return {
    ...result,
    details: {
      ...(result.details ?? {}),
      response_format_retry: 'unconstrained',
      response_format_error: errorMessage(error).slice(0, TEXT_PREVIEW_LIMIT),
    },
  };
}

export async function runQualityTasks(
  ctx: LlamaContext,
  tasks: QualityTask[] | undefined,
  options: RunQualityTaskOptions = {constrainedJson: false},
): Promise<QualityTaskResult[]> {
  if (!tasks || tasks.length === 0) {
    return [];
  }

  const results: QualityTaskResult[] = [];
  for (const task of tasks) {
    const started = Date.now();
    try {
      await (
        ctx as unknown as {clearCache?: (clearData?: boolean) => Promise<void>}
      ).clearCache?.(false);
      const result = await completionWithTimeout(
        ctx,
        buildQualityCompletionParams(task, options),
        task.timeout_ms ?? DEFAULT_TIMEOUT_MS,
      );
      results.push(evaluateQualityTask(task, result, Date.now() - started));
    } catch (e) {
      if (
        options.constrainedJson !== false &&
        shouldRetryUnconstrainedJson(task, e)
      ) {
        try {
          const fallbackResult = await completionWithTimeout(
            ctx,
            buildQualityCompletionParams(task, {
              ...options,
              constrainedJson: false,
            }),
            task.timeout_ms ?? DEFAULT_TIMEOUT_MS,
          );
          results.push(
            withResponseFormatRetryDetails(
              evaluateQualityTask(task, fallbackResult, Date.now() - started),
              e,
            ),
          );
          continue;
        } catch (fallbackError) {
          results.push({
            id: task.id,
            kind: task.kind,
            passed: false,
            score: 0,
            wall_ms: Date.now() - started,
            tokens_predicted: null,
            tokens_evaluated: null,
            text_preview: '',
            error: errorMessage(fallbackError),
            details: {
              response_format_retry: 'failed',
              response_format_error: errorMessage(e).slice(
                0,
                TEXT_PREVIEW_LIMIT,
              ),
              fallback_error: errorMessage(fallbackError).slice(
                0,
                TEXT_PREVIEW_LIMIT,
              ),
            },
          });
          continue;
        }
      }

      results.push({
        id: task.id,
        kind: task.kind,
        passed: false,
        score: 0,
        wall_ms: Date.now() - started,
        tokens_predicted: null,
        tokens_evaluated: null,
        text_preview: '',
        error: errorMessage(e),
      });
    }
  }
  return results;
}

export function calculateQualityScore(
  tasks: QualityTask[] | undefined,
  results: QualityTaskResult[] | undefined,
): number | null {
  if (!tasks || tasks.length === 0 || !results || results.length === 0) {
    return null;
  }
  const byId = new Map(results.map(result => [result.id, result]));
  let weightTotal = 0;
  let scoreTotal = 0;
  for (const task of tasks) {
    const weight = task.weight ?? 1;
    weightTotal += weight;
    scoreTotal += (byId.get(task.id)?.score ?? 0) * weight;
  }
  return weightTotal > 0
    ? Math.round((scoreTotal / weightTotal) * 10_000) / 10_000
    : null;
}

export function deriveQualityCapabilities(args: {
  status: 'ok' | 'skipped' | 'failed';
  ppAvg?: number | null;
  tgAvg?: number | null;
  qualityResults?: QualityTaskResult[];
  qualityPassed?: boolean | null;
}): QualityCapability[] {
  const capabilities: QualityCapability[] = [];
  if (
    args.status === 'ok' &&
    typeof args.ppAvg === 'number' &&
    typeof args.tgAvg === 'number'
  ) {
    capabilities.push('fit');
  }

  const passedKinds = new Set(
    (args.qualityResults ?? [])
      .filter(result => result.passed)
      .map(result => result.kind),
  );

  if (passedKinds.has('reasoning')) {
    capabilities.push('chat-capable');
  }
  if (passedKinds.has('json_format')) {
    capabilities.push('format-capable');
  }
  if (passedKinds.has('tool_call')) {
    capabilities.push('tool-call-capable');
  }
  if (
    passedKinds.has('reasoning') &&
    passedKinds.has('json_format') &&
    passedKinds.has('tool_call')
  ) {
    capabilities.push('agent-capable');
  }
  if (passedKinds.has('context_recall')) {
    capabilities.push('long-context-capable');
  }
  if (
    args.qualityPassed === true &&
    args.qualityResults &&
    args.qualityResults.length > 0 &&
    args.qualityResults.every(result => result.passed)
  ) {
    capabilities.push('baseline-eligible');
  }

  return capabilities;
}

export const DEFAULT_IOS_FIT_QUALITY_TASKS: QualityTask[] = [
  {
    id: 'format-json',
    kind: 'json_format',
    weight: 1,
    timeout_ms: 90_000,
    n_predict: 512,
  },
  {
    id: 'tool-call',
    kind: 'tool_call',
    weight: 1,
    timeout_ms: 90_000,
    n_predict: 512,
  },
  {
    id: 'reasoning-42',
    kind: 'reasoning',
    weight: 1,
    timeout_ms: 90_000,
    n_predict: 512,
  },
  {
    id: 'context-sentinel',
    kind: 'context_recall',
    weight: 1,
    timeout_ms: 120_000,
    n_predict: 512,
    context_chars: 6000,
  },
];
