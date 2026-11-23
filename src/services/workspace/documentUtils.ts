const TEXT_EXTENSIONS = new Set([
  '',
  '.bash',
  '.c',
  '.conf',
  '.cpp',
  '.cs',
  '.css',
  '.csv',
  '.env',
  '.go',
  '.h',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.log',
  '.lua',
  '.m',
  '.md',
  '.mm',
  '.php',
  '.plist',
  '.py',
  '.rb',
  '.rs',
  '.sh',
  '.sql',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.bash': 'bash',
  '.c': 'c',
  '.conf': 'ini',
  '.cpp': 'cpp',
  '.cs': 'csharp',
  '.css': 'css',
  '.csv': 'csv',
  '.go': 'go',
  '.h': 'c',
  '.html': 'html',
  '.ini': 'ini',
  '.java': 'java',
  '.js': 'javascript',
  '.json': 'json',
  '.jsx': 'javascript',
  '.lua': 'lua',
  '.m': 'objectivec',
  '.md': 'markdown',
  '.mm': 'objectivec',
  '.php': 'php',
  '.plist': 'xml',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.sh': 'bash',
  '.sql': 'sql',
  '.swift': 'swift',
  '.toml': 'toml',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.txt': 'text',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
};

const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

export function extensionForPath(path: string): string {
  const basename = path.split('/').pop() ?? path;
  const dotIndex = basename.lastIndexOf('.');
  return dotIndex > 0 ? basename.slice(dotIndex).toLowerCase() : '';
}

export function isTextLikeWorkspacePath(path: string): boolean {
  return TEXT_EXTENSIONS.has(extensionForPath(path));
}

export function isPdfWorkspacePath(path: string): boolean {
  return extensionForPath(path) === '.pdf';
}

export function isReadableWorkspacePath(path: string): boolean {
  return isTextLikeWorkspacePath(path) || isPdfWorkspacePath(path);
}

export function languageForWorkspacePath(path: string): string {
  const ext = extensionForPath(path);
  return LANGUAGE_BY_EXTENSION[ext] ?? 'text';
}

export function looksLikeMarkdownDocument(content: string): boolean {
  const text = content.trim();
  if (!text) {
    return false;
  }

  return (
    /^#{1,6}\s+\S/m.test(text) ||
    /```[\s\S]*```/m.test(text) ||
    /^\s*[-*+]\s+\S/m.test(text) ||
    /^\s*\d+\.\s+\S/m.test(text) ||
    /\[[^\]]+\]\([^)]+\)/.test(text)
  );
}

export function pathWithInferredTextExtension(
  path: string,
  content: string,
): string {
  if (extensionForPath(path)) {
    return path;
  }
  return looksLikeMarkdownDocument(content) ? `${path}.md` : path;
}

export function sanitizeWorkspaceFileName(
  name: string | null | undefined,
  fallback = 'document.txt',
): string {
  const source = (name || fallback).split('/').pop() || fallback;
  const cleaned = source
    .replace(UNSAFE_FILENAME_CHARS, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = Number.isInteger(value) || value >= 10 || unit === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function formatDocumentForChat(input: {
  path: string;
  content: string;
  language?: string;
}): string {
  const language = input.language ?? languageForWorkspacePath(input.path);
  const fence = language === 'text' ? '' : language;
  const label = isPdfWorkspacePath(input.path)
    ? 'Workspace PDF document'
    : 'Workspace document';
  return [
    `${label}: ${input.path}`,
    '',
    `\`\`\`${fence}`,
    input.content,
    '```',
  ].join('\n');
}
