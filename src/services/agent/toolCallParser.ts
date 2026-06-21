import type {CompletionResult} from '../../utils/completionTypes';
import type {AgentToolCall} from '../../utils/types';

const MAX_FALLBACK_TOOL_CALLS = 4;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

function isSafeFunctionName(name: string): boolean {
  return /^[A-Za-z0-9_.:-]+$/.test(name);
}

function normalizeArguments(value: unknown): string {
  if (value === undefined || value === null) {
    return '{}';
  }
  if (typeof value === 'string') {
    return value.trim() || '{}';
  }
  return JSON.stringify(value);
}

/**
 * Backfill stable synthetic ids onto raw tool calls. llama.rn sometimes
 * returns id=null; strict Jinja templates reject `tool_call_id: null`
 * in the next-turn tool response, so we synthesize deterministic ids
 * from a per-run seed + index.
 */
export function normalizeCompletionToolCalls(
  raw: NonNullable<CompletionResult['tool_calls']>,
  seed: number,
): AgentToolCall[] {
  return raw.map((tc, i) => ({
    id: tc.id || `call_${seed}_${i}`,
    type: 'function',
    function: {
      name: tc.function?.name ?? '',
      arguments: normalizeArguments(tc.function?.arguments),
    },
  }));
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(
    /^```(?:json|tool_call|tool_calls)?\s*([\s\S]*?)\s*```$/i,
  );
  return match ? match[1].trim() : trimmed;
}

function parseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(stripCodeFence(value));
  } catch {
    return undefined;
  }
}

function collectRegexBlocks(text: string, regex: RegExp): string[] {
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) {
      blocks.push(match[1].trim());
    }
  }
  return blocks;
}

function extractBalancedJson(text: string): string[] {
  const blocks: string[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const opener = text[i];
    if (opener !== '{' && opener !== '[') {
      continue;
    }

    const stack: string[] = [opener];
    let inString = false;
    let escaped = false;

    for (let j = i + 1; j < text.length; j += 1) {
      const ch = text[j];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{' || ch === '[') {
        stack.push(ch);
        continue;
      }
      if (ch !== '}' && ch !== ']') {
        continue;
      }

      const expectedOpener = ch === '}' ? '{' : '[';
      if (stack[stack.length - 1] !== expectedOpener) {
        break;
      }
      stack.pop();
      if (stack.length === 0) {
        blocks.push(text.slice(i, j + 1));
        i = j;
        break;
      }
    }
  }
  return blocks;
}

function collectJsonCandidates(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const candidates: string[] = [];
  candidates.push(
    ...collectRegexBlocks(text, /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi),
    ...collectRegexBlocks(text, /<tool_calls>\s*([\s\S]*?)\s*<\/tool_calls>/gi),
    ...collectRegexBlocks(
      text,
      /<\|tool_call\|>\s*([\s\S]*?)\s*<\|\/tool_call\|>/gi,
    ),
    ...collectRegexBlocks(
      text,
      /<\|tool_calls\|>\s*([\s\S]*?)\s*<\|\/tool_calls\|>/gi,
    ),
    ...collectRegexBlocks(
      text,
      /```(?:json|tool_call|tool_calls)\s*([\s\S]*?)```/gi,
    ),
  );

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    candidates.push(trimmed);
  }

  if (/<\/?tool_calls?>|<\|\/?tool_calls?\|>|tool_calls?/i.test(text)) {
    candidates.push(...extractBalancedJson(text));
  }

  return Array.from(new Set(candidates.map(c => c.trim()).filter(Boolean)));
}

function readFunctionPayload(value: unknown): {
  name: string;
  arguments: string;
} | null {
  if (!isRecord(value)) {
    return null;
  }

  const functionObject = isRecord(value.function) ? value.function : undefined;
  const name =
    asString(functionObject?.name) ??
    asString(value.name) ??
    asString(value.tool) ??
    asString(value.tool_name);
  if (!name || !isSafeFunctionName(name)) {
    return null;
  }

  const argsValue =
    functionObject && 'arguments' in functionObject
      ? functionObject.arguments
      : 'arguments' in value
        ? value.arguments
        : 'args' in value
          ? value.args
          : 'parameters' in value
            ? value.parameters
            : undefined;

  return {
    name,
    arguments: normalizeArguments(argsValue),
  };
}

function collectToolPayloads(value: unknown): Array<{
  name: string;
  arguments: string;
}> {
  if (Array.isArray(value)) {
    return value.flatMap(item => collectToolPayloads(item));
  }
  if (!isRecord(value)) {
    return [];
  }

  if (Array.isArray(value.tool_calls)) {
    return value.tool_calls.flatMap(item => collectToolPayloads(item));
  }
  if (Array.isArray(value.tool_call)) {
    return value.tool_call.flatMap(item => collectToolPayloads(item));
  }
  if (isRecord(value.tool_call)) {
    return collectToolPayloads(value.tool_call);
  }

  const payload = readFunctionPayload(value);
  return payload ? [payload] : [];
}

function parseTextToolCalls(text: string, seed: number): AgentToolCall[] {
  const parsed: AgentToolCall[] = [];
  const seen = new Set<string>();

  for (const candidate of collectJsonCandidates(text)) {
    const value = parseJson(candidate);
    if (value === undefined) {
      continue;
    }

    for (const payload of collectToolPayloads(value)) {
      const key = `${payload.name}\u0000${payload.arguments}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      parsed.push({
        id: `call_${seed}_${parsed.length}`,
        type: 'function',
        function: payload,
      });
      if (parsed.length >= MAX_FALLBACK_TOOL_CALLS) {
        return parsed;
      }
    }
  }

  return parsed;
}

export function extractToolCallsFromCompletionResult(
  result: CompletionResult,
  seed: number,
): AgentToolCall[] | undefined {
  if (result.tool_calls && result.tool_calls.length > 0) {
    return normalizeCompletionToolCalls(result.tool_calls, seed);
  }

  const texts = Array.from(
    new Set([result.content, result.text].filter(Boolean)),
  ) as string[];
  for (const text of texts) {
    const calls = parseTextToolCalls(text, seed);
    if (calls.length > 0) {
      return calls;
    }
  }

  return undefined;
}
