import type {ToolDefinition} from '../talents/types';
import {keywordMatchesText} from '../talents/keywordMatching';

type SystemMessage = {role: 'system'; content: string};

const TOOL_RULES: Array<{
  name: string;
  test: (text: string) => boolean;
}> = [
  {
    name: 'calculate',
    test: text =>
      /\b(calculate|compute|evaluate|solve|arithmetic|equation)\b/i.test(
        text,
      ) ||
      /(?:\d|\bpi\b|\be\b)\s*(?:[+\-*/^=]|sqrt\(|sin\(|cos\(|tan\(|log\()/i.test(
        text,
      ),
  },
  {
    name: 'datetime',
    test: text =>
      /\b(current\s+)?(date|time|datetime|today|tomorrow|yesterday|now|timezone|utc|gmt)\b/i.test(
        text,
      ),
  },
  {
    name: 'render_html',
    test: text =>
      /\b(render|preview|display|show)\b[\s\S]*\b(html|webpage|web page|website|ui|component|page)\b/i.test(
        text,
      ) ||
      /\b(make|build|create)\b[\s\S]*\b(html|webpage|web page|website|interactive page)\b/i.test(
        text,
      ),
  },
  {
    name: 'web_search',
    test: text =>
      /\b(web|internet|search|look\s+up|lookup|browse|online|source|sources)\b/i.test(
        text,
      ) ||
      /\b(current|latest|recent|today|this\s+week|breaking|news|headline|weather|forecast|temperature|stock|price|score|release|launched|announced)\b/i.test(
        text,
      ),
  },
  {
    name: 'mail_search',
    test: text =>
      /\b(check|read|search|find|show|list|latest|recent|unread)\b[\s\S]*\b(emails?|mail|mailbox|inbox)\b/i.test(
        text,
      ) ||
      /\b(emails?|mail|mailbox|inbox)\b[\s\S]*\b(from|about|latest|recent|unread|today|yesterday)\b/i.test(
        text,
      ),
  },
  {
    name: 'mail_read',
    test: text =>
      /\b(read|open|show)\b[\s\S]*\b(email|mail message|message id|mail id)\b/i.test(
        text,
      ),
  },
  {
    name: 'mail_send',
    test: text =>
      /\b(send|reply|respond|forward)\b[\s\S]*\b(emails?|mail)\b/i.test(text) ||
      /\b(email|mail)\b[\s\S]*\b(send|reply|respond|forward)\b/i.test(text),
  },
  {
    name: 'calendar_find_events',
    test: text =>
      /\b(my|personal|class|classes|school|course|courses)\b[\s\S]*\b(schedule|calendar|agenda|events?|timetable)\b/i.test(
        text,
      ) ||
      /\b(schedule|calendar|agenda|events?|timetable)\b[\s\S]*\b(my|class|classes|school|course|courses)\b/i.test(
        text,
      ),
  },
  {
    name: 'reminder_find',
    test: text =>
      /\b(check|read|search|find|show|list|latest|upcoming|open)\b[\s\S]*\b(reminders?|todos?|tasks?)\b/i.test(
        text,
      ) ||
      /\b(reminders?|todos?|tasks?)\b[\s\S]*\b(due|upcoming|open|today|tomorrow|this\s+week)\b/i.test(
        text,
      ),
  },
  {
    name: 'reminder_create',
    test: text =>
      /\b(remind\s+me|add|create|set|save)\b[\s\S]*\b(reminders?|todos?|tasks?)\b/i.test(
        text,
      ) || /\bremind\s+me\s+to\b/i.test(text),
  },
  {
    name: 'reminder_complete',
    test: text =>
      /\b(complete|finish|mark\s+done|done)\b[\s\S]*\b(reminders?|todos?|tasks?)\b/i.test(
        text,
      ),
  },
  {
    name: 'reminder_delete',
    test: text =>
      /\b(delete|remove|cancel|clear)\b[\s\S]*\b(reminders?|todos?|tasks?)\b/i.test(
        text,
      ),
  },
  {
    name: 'clock_list',
    test: text =>
      /\b(list|show|check|what|which)\b[\s\S]*\b(timers?|alarms?|clock)\b/i.test(
        text,
      ),
  },
  {
    name: 'clock_create_timer',
    test: text =>
      /\b(set|start|create|make)\b[\s\S]*\b(timer|countdown)\b/i.test(text) ||
      /\btimer\s+for\b/i.test(text),
  },
  {
    name: 'clock_create_alarm',
    test: text =>
      /\b(set|create|make)\b[\s\S]*\balarm\b/i.test(text) ||
      /\b(wake\s+me|wake\s+up)\b/i.test(text),
  },
  {
    name: 'clock_cancel',
    test: text =>
      /\b(cancel|delete|remove)\b[\s\S]*\b(timers?|alarms?)\b/i.test(text),
  },
  {
    name: 'clock_stop',
    test: text => /\b(stop|dismiss)\b[\s\S]*\b(timers?|alarms?)\b/i.test(text),
  },
  {
    name: 'workspace_list',
    test: text =>
      /\b(ls|list|show|find|locate|tree)\b[\s\S]*\b(files?|documents?|director(?:y|ies)|subdirector(?:y|ies)|dirs?|folders?|subfolders?|cwd|workspace)\b/i.test(
        text,
      ) ||
      /\b(ls|tree)\b/i.test(text) ||
      /\b(cwd|current directory|workspace|documents folder)\b/i.test(text),
  },
  {
    name: 'workspace_read',
    test: text =>
      /\b(read|open|cat|preview|summari[sz]e|extract)\b[\s\S]*\b(files?|documents?|pdf|markdown|md|txt|cwd|workspace)\b/i.test(
        text,
      ) ||
      /\b(read|open|cat|preview|summari[sz]e|extract)\b[\s\S]*\.[A-Za-z0-9]{1,8}\b/i.test(
        text,
      ),
  },
  {
    name: 'workspace_mkdir',
    test: text =>
      /\b(mkdir|create|make|new|add)\b[\s\S]*\b(director(?:y|ies)|subdirector(?:y|ies)|dirs?|folders?|subfolders?)\b/i.test(
        text,
      ),
  },
  {
    name: 'workspace_write',
    test: text =>
      /\b(write|create|make|save|draft|append)\b[\s\S]*\b(files?|documents?|markdown|md|txt|notes?|cwd|workspace)\b/i.test(
        text,
      ) ||
      /\b(write|create|make|save|draft|append)\b[\s\S]*\.[A-Za-z0-9]{1,8}\b/i.test(
        text,
      ),
  },
  {
    name: 'workspace_prune_empty_dirs',
    test: text =>
      /\b(remove|delete|clear|clean|cleanup|prune|rmdir)\b[\s\S]*\bempty\b[\s\S]*\b(director(?:y|ies)|subdirector(?:y|ies)|dirs?|folders?|subfolders?)\b/i.test(
        text,
      ) ||
      /\bempty\b[\s\S]*\b(director(?:y|ies)|subdirector(?:y|ies)|dirs?|folders?|subfolders?)\b[\s\S]*\b(remove|delete|clear|clean|cleanup|prune|rmdir)\b/i.test(
        text,
      ),
  },
  {
    name: 'workspace_delete',
    test: text =>
      /\b(remove|delete|rm|rmdir)\b[\s\S]*\b(files?|documents?|director(?:y|ies)|subdirector(?:y|ies)|dirs?|folders?|subfolders?|cwd|workspace)\b/i.test(
        text,
      ),
  },
  {
    name: 'workspace_shell',
    test: text =>
      /\b(shell|terminal|command|commands|pwd|cd|mkdir|rmdir|tree|grep)\b/i.test(
        text,
      ),
  },
];

function getToolNames(tools: ToolDefinition[]): Set<string> {
  return new Set(
    tools
      .map(tool => tool.function?.name)
      .filter((name): name is string => typeof name === 'string' && !!name),
  );
}

export function detectLikelyToolIntents(
  messageText: string,
  tools: ToolDefinition[],
  keywordHints: Record<string, string[]> = {},
): string[] {
  const text = messageText.trim();
  if (!text || tools.length === 0) {
    return [];
  }

  const enabledToolNames = getToolNames(tools);
  const builtInMatches = TOOL_RULES.filter(
    rule => enabledToolNames.has(rule.name) && rule.test(text),
  ).map(rule => rule.name);
  const dynamicMatches = Object.entries(keywordHints)
    .filter(([name]) => enabledToolNames.has(name))
    .filter(([, keywords]) =>
      keywords.some(keyword => keywordMatchesText(text, keyword)),
    )
    .map(([name]) => name);
  return Array.from(new Set([...builtInMatches, ...dynamicMatches]));
}

export function resolveToolIntentSystemMessages({
  messageText,
  tools,
  keywordHints,
  workspaceCwd,
}: {
  messageText: string;
  tools: ToolDefinition[];
  keywordHints?: Record<string, string[]>;
  workspaceCwd?: string;
}): SystemMessage[] {
  const likelyTools = detectLikelyToolIntents(messageText, tools, keywordHints);
  if (likelyTools.length === 0) {
    return [];
  }

  const workspaceTools = likelyTools.filter(name =>
    name.startsWith('workspace_'),
  );
  const mailTools = likelyTools.filter(name => name.startsWith('mail_'));
  const reminderTools = likelyTools.filter(name =>
    name.startsWith('reminder_'),
  );
  const clockTools = likelyTools.filter(name => name.startsWith('clock_'));
  const workspaceGuidance =
    workspaceTools.length > 0
      ? ` Workspace workflow: current cwd is ${workspaceCwd || '/'}. Prefer narrow workspace tools over shell strings when possible. If the user asks for a file in cwd/current directory/workspace/documents or does not provide an exact path, first call workspace_list with path "." and that cwd to discover filenames, then call workspace_read with the exact listed path. workspace_read extracts PDF text directly; do not invent scripts to parse PDFs. For folder creation, call workspace_mkdir. For requests to remove/delete/prune empty directories or empty folders, call workspace_prune_empty_dirs; direct user wording like "remove all empty folders" is explicit confirmation, so use user_confirmed=true. For arbitrary file/folder deletion, call workspace_delete only after explicit user deletion wording; direct wording like "delete X" or "remove X" is explicit confirmation, so use user_confirmed=true. For substantial file creation or edits, call workspace_write with lines (one Markdown/code line per array item) or chunks instead of compressing the whole document into one content string. For long guides or full references, write a concise outline or first section, then append additional sections with append=true in later tool calls; keep each call small enough to remain valid JSON. If the user already attached or cloned file content into the message/history, answer from that content before calling tools.`
      : '';
  const mailGuidance =
    mailTools.length > 0
      ? ' Mail workflow: for broad requests like read/check/search my emails, call mail_search first to get message IDs, subjects, senders, dates, and snippets. Call mail_read only after you have a specific message id. Call mail_send only after explicit user confirmation of recipient, subject, and body.'
      : '';
  const reminderGuidance =
    reminderTools.length > 0
      ? ' Reminder workflow: for create requests like "remind me to X", call reminder_create with a concise title, optional notes, and user_confirmed=true because the user explicitly asked for it. Convert clear relative due dates/times to ISO; if the due date or time is ambiguous, ask a follow-up instead of sending natural-language dates. For complete/delete requests without an identifier, call reminder_find first, then use the returned id only when the target is clear.'
      : '';
  const clockGuidance =
    clockTools.length > 0
      ? ' Clock workflow: LLMm can manage only app-owned AlarmKit timers and alarms, not arbitrary Apple Clock app alarms. For timers, call clock_create_timer with duration_seconds converted from the user’s duration. For alarms, call clock_create_alarm with a future ISO fire_date only when the date/time is clear; ask a follow-up if ambiguous. For cancel/stop without an identifier, call clock_list first and use a returned id only when the target is clear.'
      : '';

  return [
    {
      role: 'system',
      content:
        `Tool routing hint for the latest user request: likely relevant enabled tool(s): ${likelyTools.join(
          ', ',
        )}. ` +
        'If listed tools directly satisfy the request, call the minimum necessary tool or short tool sequence with valid JSON arguments before answering. Use only enabled tools and do not repeat identical tool calls.' +
        workspaceGuidance +
        mailGuidance +
        reminderGuidance +
        clockGuidance,
    },
  ];
}
