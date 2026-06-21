import {
  displayWorkspacePath,
  normalizeWorkspacePath,
  resolveWorkspacePath,
} from '../pathUtils';

describe('workspace path utils', () => {
  it('normalizes root and dot paths to workspace root', () => {
    expect(normalizeWorkspacePath()).toBe('');
    expect(normalizeWorkspacePath('/')).toBe('');
    expect(normalizeWorkspacePath('.')).toBe('');
    expect(displayWorkspacePath('')).toBe('/');
  });

  it('resolves relative paths against the app workspace cwd', () => {
    expect(resolveWorkspacePath('notes/today.md', '/docs')).toBe(
      'docs/notes/today.md',
    );
    expect(displayWorkspacePath(resolveWorkspacePath('/notes/today.md'))).toBe(
      '/notes/today.md',
    );
  });

  it('supports parent-directory movement inside the app workspace', () => {
    expect(resolveWorkspacePath('../shared/todo.md', '/docs/notes')).toBe(
      'docs/shared/todo.md',
    );
    expect(resolveWorkspacePath('..', '/docs')).toBe('');
  });

  it('rejects paths that would leave the app workspace root', () => {
    expect(() => normalizeWorkspacePath('../outside')).toThrow(
      /cannot leave the app workspace/i,
    );
    expect(() => resolveWorkspacePath('../../outside', '/docs')).toThrow(
      /cannot leave the app workspace/i,
    );
  });

  it('rejects host-style paths', () => {
    expect(() => normalizeWorkspacePath('~/notes')).toThrow(
      /app-workspace paths/i,
    );
    expect(() => normalizeWorkspacePath('C:\\Users\\notes')).toThrow(
      /app-workspace paths/i,
    );
  });
});
