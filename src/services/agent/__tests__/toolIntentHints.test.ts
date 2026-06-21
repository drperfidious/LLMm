import {
  detectLikelyToolIntents,
  resolveToolIntentSystemMessages,
} from '../toolIntentHints';
import type {ToolDefinition} from '../../talents/types';

function tool(name: string): ToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description: name,
      parameters: {type: 'object'},
    },
  };
}

describe('toolIntentHints', () => {
  it('detects calculator intent only when calculate is enabled', () => {
    expect(
      detectLikelyToolIntents('What is 17 * 42?', [tool('calculate')]),
    ).toEqual(['calculate']);
    expect(detectLikelyToolIntents('What is 17 * 42?', [])).toEqual([]);
  });

  it('detects datetime and render_html intents from strong keywords', () => {
    expect(
      detectLikelyToolIntents('What time is it in UTC?', [tool('datetime')]),
    ).toEqual(['datetime']);
    expect(
      detectLikelyToolIntents('Build an interactive HTML page for this', [
        tool('render_html'),
      ]),
    ).toEqual(['render_html']);
  });

  it('does not emit a system message for weak non-tool text', () => {
    const messages = resolveToolIntentSystemMessages({
      messageText: 'Tell me about planning a benchmark run',
      tools: [tool('calculate'), tool('datetime'), tool('render_html')],
    });

    expect(messages).toEqual([]);
  });

  it('emits one concise system hint for matched enabled tools', () => {
    const messages = resolveToolIntentSystemMessages({
      messageText: 'Calculate 2^10 and tell me the current date',
      tools: [tool('calculate'), tool('datetime')],
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('calculate, datetime');
    expect(messages[0].content).toContain('valid JSON arguments');
  });

  it('detects web_search for weather and recent-news requests', () => {
    expect(
      detectLikelyToolIntents('What is the weather in the next coming days?', [
        tool('web_search'),
      ]),
    ).toEqual(['web_search']);
    expect(
      detectLikelyToolIntents('Search the web for recent news', [
        tool('web_search'),
      ]),
    ).toEqual(['web_search']);
  });

  it('does not detect web_search when it is not enabled', () => {
    expect(
      detectLikelyToolIntents('Search the web for recent news', [
        tool('calculate'),
      ]),
    ).toEqual([]);
  });

  it('detects custom talent intents from dynamic keyword hints', () => {
    expect(
      detectLikelyToolIntents(
        'Please run the contract reviewer on this text',
        [tool('contract_review')],
        {contract_review: ['contract reviewer']},
      ),
    ).toEqual(['contract_review']);
  });

  it('detects workspace file and shell intents from dynamic keywords', () => {
    expect(
      detectLikelyToolIntents(
        'Make a .md in cwd with basic python syntax quick reference information',
        [tool('workspace_write'), tool('workspace_shell')],
        {
          workspace_write: ['write file', 'make file', '.md', 'cwd'],
          workspace_shell: ['shell', 'cwd', '.md', 'create file'],
        },
      ),
    ).toEqual(['workspace_write', 'workspace_shell']);
  });

  it('detects calendar reads from dynamic keywords', () => {
    expect(
      detectLikelyToolIntents(
        "What's coming next on my calendar?",
        [tool('calendar_find_events')],
        {
          calendar_find_events: ['calendar', "what's next", 'coming next'],
        },
      ),
    ).toEqual(['calendar_find_events']);
  });

  it('does not match dynamic alphanumeric keywords inside unrelated words', () => {
    expect(
      detectLikelyToolIntents(
        'This prevents crashes.',
        [tool('calendar_find_events')],
        {calendar_find_events: ['event']},
      ),
    ).toEqual([]);
  });
});
