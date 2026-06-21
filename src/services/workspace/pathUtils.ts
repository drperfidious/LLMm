export const WORKSPACE_ROOT_DIR = 'llmm-workspace';

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function normalizeWorkspacePath(input?: string): string {
  const raw = (input ?? '').trim().replace(/\\/g, '/');
  if (!raw || raw === '.' || raw === '/') {
    return '';
  }
  if (CONTROL_CHARS.test(raw)) {
    throw new Error('Workspace paths cannot contain control characters');
  }
  if (raw.startsWith('~') || /^[a-zA-Z]:/.test(raw)) {
    throw new Error('Only app-workspace paths are supported');
  }

  const parts = raw
    .replace(/^\/+/, '')
    .split('/')
    .filter(part => part.length > 0 && part !== '.')
    .reduce<string[]>((acc, part) => {
      if (part === '..') {
        if (acc.length === 0) {
          throw new Error('Workspace paths cannot leave the app workspace');
        }
        acc.pop();
      } else {
        acc.push(part);
      }
      return acc;
    }, []);

  return parts.join('/');
}

export function resolveWorkspacePath(input: string, cwd = ''): string {
  if (input.trim().startsWith('/')) {
    return normalizeWorkspacePath(input);
  }
  const base = normalizeWorkspacePath(cwd);
  return normalizeWorkspacePath([base, input].filter(Boolean).join('/'));
}

export function dirname(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  const parts = normalized.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

export function displayWorkspacePath(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  return normalized ? `/${normalized}` : '/';
}
