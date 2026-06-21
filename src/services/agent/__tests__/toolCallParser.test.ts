import {extractToolCallsFromCompletionResult} from '../toolCallParser';
import type {CompletionResult} from '../../../utils/completionTypes';

function completion(text: string): CompletionResult {
  return {text, content: text};
}

describe('extractToolCallsFromCompletionResult', () => {
  it('prefers native structured tool_calls when present', () => {
    const calls = extractToolCallsFromCompletionResult(
      {
        ...completion(
          '<tool_call>{"name":"ignored","arguments":{}}</tool_call>',
        ),
        tool_calls: [
          {
            id: null as any,
            type: 'function',
            function: {
              name: 'calculate',
              arguments: {expr: '2+2'} as any,
            },
          },
        ],
      },
      42,
    );

    expect(calls).toEqual([
      {
        id: 'call_42_0',
        type: 'function',
        function: {
          name: 'calculate',
          arguments: '{"expr":"2+2"}',
        },
      },
    ]);
  });

  it('extracts Qwen-style tool_call marker JSON', () => {
    const calls = extractToolCallsFromCompletionResult(
      completion(
        '<tool_call>\n{"name":"datetime","arguments":{"timezone":"UTC"}}\n</tool_call>',
      ),
      7,
    );

    expect(calls).toEqual([
      {
        id: 'call_7_0',
        type: 'function',
        function: {
          name: 'datetime',
          arguments: '{"timezone":"UTC"}',
        },
      },
    ]);
  });

  it('extracts fenced tool_calls JSON', () => {
    const calls = extractToolCallsFromCompletionResult(
      completion(
        '```json\n{"tool_calls":[{"type":"function","function":{"name":"calculate","arguments":{"expr":"3*3"}}}]}\n```',
      ),
      9,
    );

    expect(calls?.[0]?.function).toEqual({
      name: 'calculate',
      arguments: '{"expr":"3*3"}',
    });
  });

  it('does not convert ambient natural language into a tool call', () => {
    const calls = extractToolCallsFromCompletionResult(
      completion('I should call calculate with {"expr":"2+2"} next.'),
      1,
    );

    expect(calls).toBeUndefined();
  });
});
