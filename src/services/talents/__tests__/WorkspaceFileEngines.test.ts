import {
  WorkspaceDeleteEngine,
  WorkspaceListEngine,
  WorkspaceReadEngine,
  WorkspaceSearchEngine,
  WorkspaceWriteEngine,
} from '../WorkspaceFileEngines';

const makeFs = () => ({
  list: jest.fn(async () => [
    {name: 'notes', path: '/notes', type: 'directory' as const, size: 0},
    {name: 'todo.md', path: '/todo.md', type: 'file' as const, size: 12},
  ]),
  listFiles: jest.fn(async () => [
    {name: 'todo.md', path: '/todo.md', type: 'file' as const, size: 12},
  ]),
  readFile: jest.fn(async () => ({
    path: '/todo.md',
    content: '# Todo',
    size: 6,
    truncated: false,
  })),
  exists: jest.fn(async () => false),
  writeFile: jest.fn(async (_path: string, content: string) => ({
    path: '/todo.md',
    content,
    size: content.length,
    truncated: false,
  })),
  deletePath: jest.fn(async () => ({path: '/todo.md', type: 'file' as const})),
  search: jest.fn(async () => [{path: '/todo.md', line: 1, text: '# Todo'}]),
});

describe('Workspace file talent engines', () => {
  it('lists workspace entries', async () => {
    const fs = makeFs();
    const result = await new WorkspaceListEngine(fs as any).execute({
      path: '/',
      cwd: '/',
    });

    expect(result.type).toBe('text');
    expect(result.summary).toContain('/todo.md');
    expect(fs.list).toHaveBeenCalledWith('/', '/');
  });

  it('reads a workspace file', async () => {
    const fs = makeFs();
    const result = await new WorkspaceReadEngine(fs as any).execute({
      path: 'todo.md',
      cwd: '/',
    });

    expect(result.type).toBe('text');
    expect(result.summary).toContain('# Todo');
    expect(fs.readFile).toHaveBeenCalledWith('todo.md', '/', 96 * 1024);
  });

  it('refuses to overwrite without overwrite or append', async () => {
    const fs = makeFs();
    fs.exists.mockResolvedValueOnce(true);

    const result = await new WorkspaceWriteEngine(fs as any).execute({
      path: 'todo.md',
      content: 'new',
      cwd: '/',
    });

    expect(result.type).toBe('error');
    expect(result.summary).toContain('refused');
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('writes when overwrite is explicit', async () => {
    const fs = makeFs();
    fs.exists.mockResolvedValueOnce(true);

    const result = await new WorkspaceWriteEngine(fs as any).execute({
      path: 'todo.md',
      content: 'new',
      cwd: '/',
      overwrite: true,
    });

    expect(result.type).toBe('text');
    expect(result.summary).toContain('Wrote 3 bytes');
    expect(fs.writeFile).toHaveBeenCalledWith('todo.md', 'new', {
      cwd: '/',
      append: false,
      maxBytes: 512 * 1024,
    });
  });

  it('requires confirmation before deleting', async () => {
    const fs = makeFs();
    const result = await new WorkspaceDeleteEngine(fs as any).execute({
      path: 'todo.md',
    });

    expect(result.type).toBe('error');
    expect(result.summary).toContain('confirmation');
    expect(fs.deletePath).not.toHaveBeenCalled();
  });

  it('deletes after explicit confirmation', async () => {
    const fs = makeFs();
    const result = await new WorkspaceDeleteEngine(fs as any).execute({
      path: 'todo.md',
      cwd: '/',
      user_confirmed: true,
    });

    expect(result.type).toBe('text');
    expect(result.summary).toBe('Deleted file /todo.md');
    expect(fs.deletePath).toHaveBeenCalledWith('todo.md', '/');
  });

  it('searches workspace text files', async () => {
    const fs = makeFs();
    const result = await new WorkspaceSearchEngine(fs as any).execute({
      pattern: 'todo',
      cwd: '/',
    });

    expect(result.type).toBe('text');
    expect(result.summary).toContain('/todo.md:1');
    expect(fs.search).toHaveBeenCalledWith('todo', '.', '/', {
      caseSensitive: false,
      maxResults: 40,
    });
  });

  it('emits tool definitions for all file tools', () => {
    const engines = [
      new WorkspaceListEngine(makeFs() as any),
      new WorkspaceReadEngine(makeFs() as any),
      new WorkspaceWriteEngine(makeFs() as any),
      new WorkspaceDeleteEngine(makeFs() as any),
      new WorkspaceSearchEngine(makeFs() as any),
    ];

    expect(
      engines.map(engine => engine.toToolDefinition().function.name),
    ).toEqual([
      'workspace_list',
      'workspace_read',
      'workspace_write',
      'workspace_delete',
      'workspace_search',
    ]);
  });
});
