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

  it('detects plural mailbox requests without relying on dynamic keywords', () => {
    expect(
      detectLikelyToolIntents('Can you read my emails from today?', [
        tool('mail_search'),
        tool('mail_read'),
      ]),
    ).toEqual(['mail_search']);

    const messages = resolveToolIntentSystemMessages({
      messageText: 'Can you read my emails from today?',
      tools: [tool('mail_search'), tool('mail_read')],
    });

    expect(messages[0].content).toContain('Mail workflow');
    expect(messages[0].content).toContain('call mail_search first');
    expect(messages[0].content).toContain('mail_read only after');
  });

  it('detects email send requests separately from mailbox reads', () => {
    expect(
      detectLikelyToolIntents('Reply to this email with a quick update', [
        tool('mail_search'),
        tool('mail_send'),
      ]),
    ).toEqual(['mail_send']);
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

  it('routes vague PDF cwd reads through workspace list and read', () => {
    expect(
      detectLikelyToolIntents('Read the pdf in cwd', [
        tool('workspace_list'),
        tool('workspace_read'),
      ]),
    ).toEqual(['workspace_list', 'workspace_read']);

    const messages = resolveToolIntentSystemMessages({
      messageText: 'Read the pdf in cwd',
      tools: [tool('workspace_list'), tool('workspace_read')],
      workspaceCwd: '/cwd',
    });

    expect(messages[0].content).toContain('current cwd is /cwd');
    expect(messages[0].content).toContain('first call workspace_list');
    expect(messages[0].content).toContain('workspace_read extracts PDF text');
  });

  it('routes document creation to workspace_write with chunk guidance', () => {
    expect(
      detectLikelyToolIntents('Create a .md file in cwd with Python basics', [
        tool('workspace_write'),
      ]),
    ).toEqual(['workspace_write']);

    const messages = resolveToolIntentSystemMessages({
      messageText: 'Create a .md file in cwd with Python basics',
      tools: [tool('workspace_write')],
      workspaceCwd: '/dev',
    });

    expect(messages[0].content).toContain('workspace_write with lines');
    expect(messages[0].content).toContain('one Markdown/code line per array');
    expect(messages[0].content).toContain('append additional sections');
    expect(messages[0].content).toContain('valid JSON');
    expect(messages[0].content).toContain('current cwd is /dev');
  });

  it('routes empty folder cleanup to the prune tool with confirmation guidance', () => {
    expect(
      detectLikelyToolIntents(
        'Remove all empty subdirectories, ls them first to find them',
        [
          tool('workspace_list'),
          tool('workspace_prune_empty_dirs'),
          tool('workspace_delete'),
        ],
      ),
    ).toEqual([
      'workspace_list',
      'workspace_prune_empty_dirs',
      'workspace_delete',
    ]);

    const messages = resolveToolIntentSystemMessages({
      messageText:
        'Remove all empty subdirectories, ls them first to find them',
      tools: [
        tool('workspace_list'),
        tool('workspace_prune_empty_dirs'),
        tool('workspace_delete'),
      ],
      workspaceCwd: '/',
    });

    expect(messages[0].content).toContain('workspace_prune_empty_dirs');
    expect(messages[0].content).toContain('user_confirmed=true');
    expect(messages[0].content).toContain(
      'direct user wording like "remove all empty folders"',
    );
  });

  it('routes folder creation to workspace_mkdir', () => {
    const intents = detectLikelyToolIntents(
      'Create a subfolder named notes in cwd',
      [tool('workspace_mkdir'), tool('workspace_write')],
    );

    expect(intents).toContain('workspace_mkdir');
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

  it('detects reminder create/delete and emits workflow guidance', () => {
    expect(
      detectLikelyToolIntents(
        'Remind me to submit the assignment tomorrow at 8',
        [tool('reminder_create')],
      ),
    ).toEqual(['reminder_create']);
    expect(
      detectLikelyToolIntents('Remove the assignment reminder', [
        tool('reminder_find'),
        tool('reminder_delete'),
      ]),
    ).toEqual(['reminder_delete']);

    const messages = resolveToolIntentSystemMessages({
      messageText: 'Remind me to submit the assignment tomorrow at 8',
      tools: [tool('reminder_create')],
    });

    expect(messages[0].content).toContain('Reminder workflow');
    expect(messages[0].content).toContain('Convert clear relative due dates');
    expect(messages[0].content).toContain('user_confirmed=true');
  });

  it('detects clock create/list intents and emits AlarmKit limits', () => {
    expect(
      detectLikelyToolIntents('Set a timer for five minutes', [
        tool('clock_create_timer'),
        tool('clock_list'),
      ]),
    ).toEqual(['clock_create_timer']);
    expect(
      detectLikelyToolIntents('Show my LLMm timers', [
        tool('clock_create_timer'),
        tool('clock_list'),
      ]),
    ).toEqual(['clock_list']);

    const messages = resolveToolIntentSystemMessages({
      messageText: 'Set an alarm for tomorrow at 7',
      tools: [tool('clock_create_alarm')],
    });

    expect(messages[0].content).toContain('Clock workflow');
    expect(messages[0].content).toContain('app-owned AlarmKit timers');
    expect(messages[0].content).toContain('future ISO fire_date');
  });

  it('prefers calendar intent over web search for personal class schedules', () => {
    expect(
      detectLikelyToolIntents('Can you check my class schedule in a month?', [
        tool('calendar_find_events'),
        tool('web_search'),
      ]),
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
