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
      /\b(current|latest|recent|today|this\s+week|breaking|news|headline|weather|forecast|temperature|stock|price|score|schedule|release|launched|announced)\b/i.test(
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
}: {
  messageText: string;
  tools: ToolDefinition[];
  keywordHints?: Record<string, string[]>;
}): SystemMessage[] {
  const likelyTools = detectLikelyToolIntents(messageText, tools, keywordHints);
  if (likelyTools.length === 0) {
    return [];
  }

  return [
    {
      role: 'system',
      content:
        `Tool routing hint for the latest user request: likely relevant enabled tool(s): ${likelyTools.join(
          ', ',
        )}. ` +
        'If a listed tool directly satisfies the request, call it once with valid JSON arguments before answering. Use only enabled tools and do not repeat identical tool calls.',
    },
  ];
}
