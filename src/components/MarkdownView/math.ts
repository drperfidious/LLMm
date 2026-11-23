const CODE_SEGMENT_PATTERN = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g;
const BARE_LATEX_COMMAND_PATTERN =
  /\\{1,2}(frac|sqrt|left|right|sum|prod|int|lim|sin|cos|tan|log|ln|exp|pi|theta|alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|lambda|mu|nu|xi|rho|sigma|tau|phi|varphi|omega|Omega|Delta|Sigma|cdot|cdots|ldots|dots|times|pm|leq?|geq?|neq|approx|infty)(?![A-Za-z])/;

const SYMBOL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\\alpha(?![A-Za-z])/g, 'α'],
  [/\\beta(?![A-Za-z])/g, 'β'],
  [/\\gamma(?![A-Za-z])/g, 'γ'],
  [/\\delta(?![A-Za-z])/g, 'δ'],
  [/\\epsilon(?![A-Za-z])/g, 'ε'],
  [/\\varepsilon(?![A-Za-z])/g, 'ε'],
  [/\\zeta(?![A-Za-z])/g, 'ζ'],
  [/\\eta(?![A-Za-z])/g, 'η'],
  [/\\theta(?![A-Za-z])/g, 'θ'],
  [/\\lambda(?![A-Za-z])/g, 'λ'],
  [/\\mu(?![A-Za-z])/g, 'μ'],
  [/\\nu(?![A-Za-z])/g, 'ν'],
  [/\\xi(?![A-Za-z])/g, 'ξ'],
  [/\\pi(?![A-Za-z])/g, 'π'],
  [/\\rho(?![A-Za-z])/g, 'ρ'],
  [/\\sigma(?![A-Za-z])/g, 'σ'],
  [/\\tau(?![A-Za-z])/g, 'τ'],
  [/\\phi(?![A-Za-z])/g, 'φ'],
  [/\\varphi(?![A-Za-z])/g, 'φ'],
  [/\\omega(?![A-Za-z])/g, 'ω'],
  [/\\Omega(?![A-Za-z])/g, 'Ω'],
  [/\\Delta(?![A-Za-z])/g, 'Δ'],
  [/\\Sigma(?![A-Za-z])/g, 'Σ'],
  [/\\sum(?![A-Za-z])/g, 'Σ'],
  [/\\prod(?![A-Za-z])/g, 'Π'],
  [/\\int(?![A-Za-z])/g, '∫'],
  [/\\lim(?![A-Za-z])/g, 'lim'],
  [/\\sin(?![A-Za-z])/g, 'sin'],
  [/\\cos(?![A-Za-z])/g, 'cos'],
  [/\\tan(?![A-Za-z])/g, 'tan'],
  [/\\log(?![A-Za-z])/g, 'log'],
  [/\\ln(?![A-Za-z])/g, 'ln'],
  [/\\exp(?![A-Za-z])/g, 'exp'],
  [/\\cdot(?![A-Za-z])/g, '·'],
  [/\\cdots(?![A-Za-z])/g, '⋯'],
  [/\\ldots(?![A-Za-z])/g, '…'],
  [/\\dots(?![A-Za-z])/g, '…'],
  [/\\times(?![A-Za-z])/g, '×'],
  [/\\pm(?![A-Za-z])/g, '±'],
  [/\\leq?(?![A-Za-z])/g, '≤'],
  [/\\geq?(?![A-Za-z])/g, '≥'],
  [/\\neq(?![A-Za-z])/g, '≠'],
  [/\\approx(?![A-Za-z])/g, '≈'],
  [/\\infty(?![A-Za-z])/g, '∞'],
  [/\\to(?![A-Za-z])/g, '→'],
  [/\\rightarrow(?![A-Za-z])/g, '→'],
  [/\\Rightarrow(?![A-Za-z])/g, '⇒'],
];

const SUPERSCRIPT_CHARS: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  n: 'ⁿ',
  i: 'ⁱ',
};

const SUBSCRIPT_CHARS: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
  '+': '₊',
  '-': '₋',
  '=': '₌',
  '(': '₍',
  ')': '₎',
};

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

function readBracedGroup(
  input: string,
  start: number,
): {content: string; end: number} | undefined {
  if (input[start] !== '{') {
    return undefined;
  }

  let depth = 0;
  for (let index = start; index < input.length; index++) {
    if (input[index] === '{') {
      depth++;
    } else if (input[index] === '}') {
      depth--;
      if (depth === 0) {
        return {
          content: input.slice(start + 1, index),
          end: index + 1,
        };
      }
    }
  }

  return undefined;
}

function readOptionalBracketGroup(
  input: string,
  start: number,
): {content: string; end: number} | undefined {
  if (input[start] !== '[') {
    return undefined;
  }

  const end = input.indexOf(']', start + 1);
  if (end === -1) {
    return undefined;
  }

  return {
    content: input.slice(start + 1, end),
    end: end + 1,
  };
}

function skipSpaces(input: string, start: number): number {
  let cursor = start;
  while (/\s/.test(input[cursor] ?? '')) {
    cursor++;
  }
  return cursor;
}

function parenthesizeIfNeeded(value: string): string {
  if (!value.includes(' ') && !/[+\-×·=<>≤≥]/.test(value.slice(1))) {
    return value;
  }
  return `(${value})`;
}

function replaceLatexFractions(input: string): string {
  let output = '';
  let cursor = 0;

  while (cursor < input.length) {
    const start = input.indexOf('\\frac', cursor);
    if (start === -1) {
      output += input.slice(cursor);
      break;
    }

    output += input.slice(cursor, start);
    const numeratorStart = skipSpaces(input, start + '\\frac'.length);
    const numerator = readBracedGroup(input, numeratorStart);
    const denominatorStart = numerator
      ? skipSpaces(input, numerator.end)
      : numeratorStart;
    const denominator = numerator
      ? readBracedGroup(input, denominatorStart)
      : undefined;

    if (!numerator || !denominator) {
      output += '\\frac';
      cursor = start + '\\frac'.length;
      continue;
    }

    const top = parenthesizeIfNeeded(formatMathValue(numerator.content));
    const bottom = parenthesizeIfNeeded(formatMathValue(denominator.content));
    output += `${top}⁄${bottom}`;
    cursor = denominator.end;
  }

  return output;
}

function replaceLatexSqrt(input: string): string {
  let output = '';
  let cursor = 0;

  while (cursor < input.length) {
    const start = input.indexOf('\\sqrt', cursor);
    if (start === -1) {
      output += input.slice(cursor);
      break;
    }

    output += input.slice(cursor, start);
    let groupStart = skipSpaces(input, start + '\\sqrt'.length);
    const optionalDegree = readOptionalBracketGroup(input, groupStart);
    if (optionalDegree) {
      groupStart = skipSpaces(input, optionalDegree.end);
    }
    const radicand = readBracedGroup(input, groupStart);

    if (!radicand) {
      output += '\\sqrt';
      cursor = start + '\\sqrt'.length;
      continue;
    }

    const renderedRadicand = parenthesizeIfNeeded(
      formatMathValue(radicand.content),
    );
    const renderedDegree = optionalDegree
      ? formatScriptValue(optionalDegree.content, SUPERSCRIPT_CHARS)
      : '';
    output += `${renderedDegree}√${renderedRadicand}`;
    cursor = radicand.end;
  }

  return output;
}

function replaceOneGroupCommands(input: string): string {
  let output = input;
  for (const command of [
    'text',
    'mathrm',
    'mathbf',
    'mathbb',
    'mathcal',
    'mathsf',
    'mathtt',
    'boldsymbol',
    'operatorname',
    'boxed',
  ]) {
    let next = '';
    let cursor = 0;
    const token = `\\${command}`;
    while (cursor < output.length) {
      const start = output.indexOf(token, cursor);
      if (start === -1) {
        next += output.slice(cursor);
        break;
      }

      next += output.slice(cursor, start);
      const groupStart = skipSpaces(output, start + token.length);
      const group = readBracedGroup(output, groupStart);
      if (!group) {
        next += token;
        cursor = start + token.length;
        continue;
      }
      next += group.content;
      cursor = group.end;
    }
    output = next;
  }
  return output;
}

function formatScriptValue(value: string, map: Record<string, string>): string {
  const formatted = formatMathValue(value);
  let output = '';
  for (const char of formatted) {
    const replacement = map[char];
    if (!replacement) {
      return formatted.length > 1 ? `(${formatted})` : formatted;
    }
    output += replacement;
  }
  return output;
}

function replaceScripts(input: string): string {
  let output = '';
  let cursor = 0;

  while (cursor < input.length) {
    const marker = input[cursor];
    if (marker !== '^' && marker !== '_') {
      output += marker;
      cursor++;
      continue;
    }

    const map = marker === '^' ? SUPERSCRIPT_CHARS : SUBSCRIPT_CHARS;
    const valueStart = cursor + 1;
    const group = readBracedGroup(input, valueStart);
    if (group) {
      output += formatScriptValue(group.content, map);
      cursor = group.end;
      continue;
    }

    const value = input[valueStart];
    if (value && map[value]) {
      output += map[value];
      cursor = valueStart + 1;
      continue;
    }

    output += marker;
    cursor++;
  }

  return output;
}

export function formatMathValue(value: string): string {
  let output = value.trim();

  output = output.replace(/\\\\([a-zA-Z]+)/g, '\\$1');
  output = output.replace(/\\\\/g, '\n');
  output = output.replace(/\\left\s*/g, '');
  output = output.replace(/\\right\s*/g, '');
  output = output.replace(/\\[,;:!]/g, '');

  output = replaceLatexFractions(output);
  output = replaceLatexSqrt(output);
  output = replaceOneGroupCommands(output);

  for (const [pattern, replacement] of SYMBOL_REPLACEMENTS) {
    output = output.replace(pattern, replacement);
  }

  output = replaceScripts(output);
  output = output
    .replace(/&/g, '')
    .replace(/[{}]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/([0-9A-Za-zπ]) \(/g, '$1(')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();

  return output || value.trim();
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

function isLikelyBareLatexMathLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.includes('<') || trimmed.includes('>')) {
    return false;
  }
  if (trimmed.length > 600) {
    return false;
  }
  if (!BARE_LATEX_COMMAND_PATTERN.test(trimmed)) {
    return false;
  }
  if (/^\s*[-*+]\s+\w/.test(line) && !/[=^_]/.test(trimmed)) {
    return false;
  }

  const proseWords = trimmed
    .replace(/\\[a-zA-Z]+/g, ' ')
    .split(/\s+/)
    .filter(word => /^[A-Za-z]{3,}$/.test(word));
  if (proseWords.length > 5) {
    return false;
  }

  return /[=^_+\-*/]|\\frac|\\sqrt|\\sum|\\int/.test(trimmed);
}

function replaceBareLatexMathLines(input: string): string {
  return input
    .split('\n')
    .map(line => {
      if (!isLikelyBareLatexMathLine(line)) {
        return line;
      }
      return `<div data-llmm-math="block" data-value="${encodeMathValue(
        line.trim(),
      )}"></div>`;
    })
    .join('\n');
}

function replaceMathInTextSegment(segment: string): string {
  return replaceBareLatexMathLines(
    replaceInlineMath(
      replaceParenInlineMath(
        replaceBlockMath(
          replaceBracketBlockMath(replaceEquationEnvironment(segment)),
        ),
      ),
    ),
  );
}

export function preprocessMarkdownMath(markdown: string): string {
  if (
    !markdown.includes('$') &&
    !markdown.includes('\\(') &&
    !markdown.includes('\\[') &&
    !markdown.includes('\\begin{') &&
    !BARE_LATEX_COMMAND_PATTERN.test(markdown)
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
