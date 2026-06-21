const CODE_SEGMENT_PATTERN = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g;

function encodeMathValue(value: string): string {
  return encodeURIComponent(value.trim());
}

export function decodeMathValue(value?: string): string {
  if (!value) {
    return '';
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isEscaped(input: string, index: number): boolean {
  let slashCount = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && input[cursor] === '\\';
    cursor--
  ) {
    slashCount++;
  }
  return slashCount % 2 === 1;
}

function isLikelyInlineMath(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed || trimmed.includes('\n')) {
    return false;
  }
  if (/^[a-zA-Z]$/.test(trimmed)) {
    return true;
  }
  if (/\\[a-zA-Z]+/.test(trimmed)) {
    return true;
  }
  return /[=^_+\-*/<>()[\]{}]/.test(trimmed);
}

function replaceInlineMath(input: string): string {
  let output = '';
  let cursor = 0;

  while (cursor < input.length) {
    const start = input.indexOf('$', cursor);
    if (start === -1) {
      output += input.slice(cursor);
      break;
    }

    if (
      input[start + 1] === '$' ||
      isEscaped(input, start) ||
      /\s/.test(input[start + 1] ?? '')
    ) {
      output += input.slice(cursor, start + 1);
      cursor = start + 1;
      continue;
    }

    let end = start + 1;
    while (end < input.length) {
      end = input.indexOf('$', end);
      if (end === -1) {
        break;
      }
      if (
        input[end - 1] !== ' ' &&
        input[end - 1] !== '\n' &&
        input[end + 1] !== '$' &&
        !isEscaped(input, end)
      ) {
        break;
      }
      end += 1;
    }

    if (end === -1) {
      output += input.slice(cursor);
      break;
    }

    const content = input.slice(start + 1, end);
    if (!isLikelyInlineMath(content)) {
      output += input.slice(cursor, end + 1);
      cursor = end + 1;
      continue;
    }

    output += input.slice(cursor, start);
    output += `<span data-llmm-math="inline" data-value="${encodeMathValue(
      content,
    )}"></span>`;
    cursor = end + 1;
  }

  return output;
}

function replaceBlockMath(input: string): string {
  return input.replace(/\$\$([\s\S]+?)\$\$/g, (_match, content: string) => {
    return `\n\n<div data-llmm-math="block" data-value="${encodeMathValue(
      content,
    )}"></div>\n\n`;
  });
}

function replaceBracketBlockMath(input: string): string {
  return input.replace(/\\\[([\s\S]+?)\\\]/g, (_match, content: string) => {
    return `\n\n<div data-llmm-math="block" data-value="${encodeMathValue(
      content,
    )}"></div>\n\n`;
  });
}

function replaceParenInlineMath(input: string): string {
  return input.replace(/\\\(([\s\S]+?)\\\)/g, (_match, content: string) => {
    if (!isLikelyInlineMath(content)) {
      return _match;
    }
    return `<span data-llmm-math="inline" data-value="${encodeMathValue(
      content,
    )}"></span>`;
  });
}

function replaceEquationEnvironment(input: string): string {
  return input.replace(
    /\\begin\{(equation\*?|align\*?|gather\*?)\}([\s\S]+?)\\end\{\1\}/g,
    (_match, _environment: string, content: string) => {
      return `\n\n<div data-llmm-math="block" data-value="${encodeMathValue(
        content,
      )}"></div>\n\n`;
    },
  );
}

function replaceMathInTextSegment(segment: string): string {
  return replaceInlineMath(
    replaceParenInlineMath(
      replaceBlockMath(
        replaceBracketBlockMath(replaceEquationEnvironment(segment)),
      ),
    ),
  );
}

export function preprocessMarkdownMath(markdown: string): string {
  if (
    !markdown.includes('$') &&
    !markdown.includes('\\(') &&
    !markdown.includes('\\[') &&
    !markdown.includes('\\begin{')
  ) {
    return markdown;
  }

  let output = '';
  let cursor = 0;
  let match: RegExpExecArray | null;
  CODE_SEGMENT_PATTERN.lastIndex = 0;

  while ((match = CODE_SEGMENT_PATTERN.exec(markdown)) !== null) {
    output += replaceMathInTextSegment(markdown.slice(cursor, match.index));
    output += match[0];
    cursor = match.index + match[0].length;
  }

  output += replaceMathInTextSegment(markdown.slice(cursor));
  return output;
}
