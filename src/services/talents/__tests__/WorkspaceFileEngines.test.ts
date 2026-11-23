import {
  WorkspaceDeleteEngine,
  WorkspaceListEngine,
  WorkspaceMakeDirEngine,
  WorkspacePruneEmptyDirsEngine,
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
  listDirectories: jest.fn(async () => [
    {name: 'notes', path: '/notes', type: 'directory' as const, size: 0},
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
  mkdir: jest.fn(async (path: string) => `/${path.replace(/^\/+/, '')}`),
  deletePath: jest.fn(async () => ({path: '/todo.md', type: 'file' as const})),
  listEmptyDirectories: jest.fn(async () => [
    {name: 'empty', path: '/empty', type: 'directory' as const, size: 0},
  ]),
  deleteEmptyDirectories: jest.fn(async () => ({
    deleted: [
      {name: 'empty', path: '/empty', type: 'directory' as const, size: 0},
    ],
  })),
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

  it('includes directories when listing recursively', async () => {
    const fs = makeFs();
    const result = await new WorkspaceListEngine(fs as any).execute({
      path: '/',
      cwd: '/',
      recursive: true,
    });

    expect(result.type).toBe('text');
    expect(result.summary).toContain('/notes');
    expect(result.summary).toContain('/todo.md');
    expect(fs.listDirectories).toHaveBeenCalledWith('/', '/', {
      maxEntries: 80,
    });
    expect(fs.listFiles).toHaveBeenCalledWith('/', '/', {maxEntries: 80});
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

  it('reads a workspace PDF through the shared read path', async () => {
    const fs = makeFs();
    fs.readFile.mockResolvedValueOnce({
      path: '/report.pdf',
      content: 'PDF pages: 1\n\nPage 1:\nReport text',
      size: 48 * 1024,
      truncated: false,
    });

    const result = await new WorkspaceReadEngine(fs as any).execute({
      path: 'report.pdf',
      cwd: '/',
    });

    expect(result.type).toBe('text');
    expect(result.summary).toContain('Report text');
    expect(fs.readFile).toHaveBeenCalledWith('report.pdf', '/', 96 * 1024);
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

  it('adds .md when writing extensionless markdown content', async () => {
    const fs = makeFs();

    const result = await new WorkspaceWriteEngine(fs as any).execute({
      path: 'python-reference',
      content: '# Python syntax\n\n- imports\n- functions',
      cwd: '/',
    });

    expect(result.type).toBe('text');
    expect(fs.exists).toHaveBeenCalledWith('python-reference.md', '/');
    expect(fs.writeFile).toHaveBeenCalledWith(
      'python-reference.md',
      '# Python syntax\n\n- imports\n- functions',
      {
        cwd: '/',
        append: false,
        maxBytes: 512 * 1024,
      },
    );
  });

  it('writes markdown from line arrays for larger generated docs', async () => {
    const fs = makeFs();

    const result = await new WorkspaceWriteEngine(fs as any).execute({
      path: 'python-reference',
      lines: [
        '# Python Basics',
        '',
        '## Variables',
        '- Assign with `=`.',
        '- Use descriptive names.',
      ],
      cwd: '/',
    });

    expect(result.type).toBe('text');
    expect(result.summary).toContain('from lines');
    expect(fs.exists).toHaveBeenCalledWith('python-reference.md', '/');
    expect(fs.writeFile).toHaveBeenCalledWith(
      'python-reference.md',
      '# Python Basics\n\n## Variables\n- Assign with `=`.\n- Use descriptive names.\n',
      {
        cwd: '/',
        append: false,
        maxBytes: 512 * 1024,
      },
    );
  });

  it('writes section chunks without forcing one-line content', async () => {
    const fs = makeFs();

    const result = await new WorkspaceWriteEngine(fs as any).execute({
      path: 'guide.md',
      chunks: ['# Guide\n\n', '## Setup\n\n- Install deps\n'],
      cwd: '/',
      overwrite: true,
    });

    expect(result.type).toBe('text');
    expect(result.summary).toContain('from chunks');
    expect(fs.writeFile).toHaveBeenCalledWith(
      'guide.md',
      '# Guide\n\n## Setup\n\n- Install deps\n',
      {
        cwd: '/',
        append: false,
        maxBytes: 512 * 1024,
      },
    );
  });

  it('explains accepted content shapes when write content is missing', async () => {
    const fs = makeFs();

    const result = await new WorkspaceWriteEngine(fs as any).execute({
      path: 'empty.md',
      cwd: '/',
    });

    expect(result.type).toBe('error');
    expect(result.summary).toContain('missing content');
    if (result.type === 'error') {
      expect(result.errorMessage).toContain('content as a string');
      expect(result.errorMessage).toContain('lines as a string array');
    }
    expect(fs.writeFile).not.toHaveBeenCalled();
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

  it('creates workspace directories with a narrow tool', async () => {
    const fs = makeFs();
    const result = await new WorkspaceMakeDirEngine(fs as any).execute({
      path: 'projects/python',
      cwd: '/',
    });

    expect(result.type).toBe('text');
    expect(result.summary).toBe('Created directory /projects/python');
    expect(fs.mkdir).toHaveBeenCalledWith('projects/python', '/');
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

  it('dry-runs empty directory cleanup', async () => {
    const fs = makeFs();
    const result = await new WorkspacePruneEmptyDirsEngine(fs as any).execute({
      path: '/',
      cwd: '/',
      dry_run: true,
    });

    expect(result.type).toBe('text');
    expect(result.summary).toContain('Found 1 empty directory');
    expect(result.summary).toContain('/empty');
    expect(fs.listEmptyDirectories).toHaveBeenCalledWith('/', '/', {
      maxEntries: 200,
    });
    expect(fs.deleteEmptyDirectories).not.toHaveBeenCalled();
  });

  it('removes empty directories after explicit delete wording is confirmed', async () => {
    const fs = makeFs();
    const result = await new WorkspacePruneEmptyDirsEngine(fs as any).execute({
      path: '/',
      cwd: '/',
      user_confirmed: true,
    });

    expect(result.type).toBe('text');
    expect(result.summary).toContain('Deleted 1 empty directory');
    expect(result.summary).toContain('/empty');
    expect(fs.deleteEmptyDirectories).toHaveBeenCalledWith('/', '/', {
      maxEntries: 200,
    });
  });

  it('requires confirmation before pruning empty directories', async () => {
    const fs = makeFs();
    const result = await new WorkspacePruneEmptyDirsEngine(fs as any).execute({
      path: '/',
      cwd: '/',
    });

    expect(result.type).toBe('error');
    expect(result.summary).toContain('confirmation');
    expect(fs.deleteEmptyDirectories).not.toHaveBeenCalled();
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
      new WorkspaceMakeDirEngine(makeFs() as any),
      new WorkspaceDeleteEngine(makeFs() as any),
      new WorkspacePruneEmptyDirsEngine(makeFs() as any),
      new WorkspaceSearchEngine(makeFs() as any),
    ];

    expect(
      engines.map(engine => engine.toToolDefinition().function.name),
    ).toEqual([
      'workspace_list',
      'workspace_read',
      'workspace_write',
      'workspace_mkdir',
      'workspace_delete',
      'workspace_prune_empty_dirs',
      'workspace_search',
    ]);
  });
});
