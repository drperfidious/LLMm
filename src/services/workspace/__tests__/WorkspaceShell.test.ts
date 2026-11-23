import {WorkspaceShell} from '../WorkspaceShell';
import {resolveWorkspacePath} from '../pathUtils';

const makeFs = () => ({
  list: jest.fn(async () => [
    {
      name: 'docs',
      path: '/docs',
      type: 'directory' as const,
      size: 0,
    },
    {
      name: 'notes.md',
      path: '/notes.md',
      type: 'file' as const,
      size: 12,
    },
  ]),
  readFile: jest.fn(async (path: string, cwd = '') => ({
    path: `/${resolveWorkspacePath(path, cwd)}`,
    content: 'hello workspace',
    size: 15,
    truncated: false,
  })),
  writeFile: jest.fn(async (path: string, content: string) => ({
    path: path.startsWith('/') ? path : `/${path}`,
    content,
    size: content.length,
    truncated: false,
  })),
  statPath: jest.fn(async (path: string, cwd = '') => ({
    path: path.startsWith('/')
      ? path
      : `/${resolveWorkspacePath(path, cwd) || ''}`,
    type: 'file' as const,
    size: 15,
    modifiedAt: '2026-06-21T00:00:00.000Z',
  })),
  touchFile: jest.fn(async (path: string, cwd = '') => ({
    path: path.startsWith('/')
      ? path
      : `/${resolveWorkspacePath(path, cwd) || ''}`,
    type: 'file' as const,
    size: 0,
  })),
  mkdir: jest.fn(async (path: string) =>
    path.startsWith('/') ? path : `/${path}`,
  ),
  deletePath: jest.fn(async (path: string) => ({
    path: path.startsWith('/') ? path : `/${path}`,
    type: 'file' as const,
  })),
  copyPath: jest.fn(async (source: string, target: string) => ({
    sourcePath: source.startsWith('/') ? source : `/${source}`,
    path: target.startsWith('/') ? target : `/${target}`,
    size: 15,
  })),
  movePath: jest.fn(async (source: string, target: string) => ({
    sourcePath: source.startsWith('/') ? source : `/${source}`,
    path: target.startsWith('/') ? target : `/${target}`,
    size: 15,
  })),
  search: jest.fn(async () => [
    {
      path: '/notes.md',
      line: 1,
      text: 'hello workspace',
    },
  ]),
  assertDirectory: jest.fn(async (path: string) =>
    path ? `/${path.replace(/^\/+/, '')}` : '/',
  ),
});

describe('WorkspaceShell', () => {
  it('reports cwd without touching the native shell', async () => {
    const fs = makeFs();
    const shell = new WorkspaceShell(fs as any);

    const result = await shell.execute('pwd', '/docs');

    expect(result).toEqual(
      expect.objectContaining({ok: true, cwd: '/docs', output: '/docs'}),
    );
    expect(fs.list).not.toHaveBeenCalled();
  });

  it('lists files relative to cwd', async () => {
    const fs = makeFs();
    const shell = new WorkspaceShell(fs as any);

    const result = await shell.execute('ls .', '/');

    expect(result.ok).toBe(true);
    expect(result.output).toContain('/docs');
    expect(result.output).toContain('/notes.md');
    expect(fs.list).toHaveBeenCalledWith('.', '');
  });

  it('removes empty directories with rmdir only after verifying contents', async () => {
    const fs = makeFs();
    fs.list.mockResolvedValueOnce([]);
    const shell = new WorkspaceShell(fs as any);

    const result = await shell.execute('rmdir empty', '/');

    expect(result.ok).toBe(true);
    expect(result.output).toBe('Deleted /empty');
    expect(fs.list).toHaveBeenCalledWith('empty', '');
    expect(fs.deletePath).toHaveBeenCalledWith('empty', '');
  });

  it('refuses rmdir on non-empty directories', async () => {
    const fs = makeFs();
    const shell = new WorkspaceShell(fs as any);

    const result = await shell.execute('rmdir docs', '/');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('only removes empty directories');
    expect(fs.deletePath).not.toHaveBeenCalled();
  });

  it('changes cwd only through the returned shell result', async () => {
    const fs = makeFs();
    const shell = new WorkspaceShell(fs as any);

    const result = await shell.execute('cd docs', '/');

    expect(result).toEqual(
      expect.objectContaining({ok: true, cwd: '/docs', output: '/docs'}),
    );
    expect(fs.assertDirectory).toHaveBeenCalledWith('docs');
  });

  it('writes redirected echo output inside the workspace', async () => {
    const fs = makeFs();
    const shell = new WorkspaceShell(fs as any);

    const result = await shell.execute(
      'echo "hello" > notes/hello.txt',
      '/docs',
    );

    expect(result.ok).toBe(true);
    expect(result.mutated).toBe(true);
    expect(fs.writeFile).toHaveBeenCalledWith('notes/hello.txt', 'hello\n', {
      cwd: 'docs',
      append: false,
    });
  });

  it('deletes paths through the workspace filesystem', async () => {
    const fs = makeFs();
    const shell = new WorkspaceShell(fs as any);

    const result = await shell.execute('rm notes/old.md', '/docs');

    expect(result.ok).toBe(true);
    expect(result.mutated).toBe(true);
    expect(fs.deletePath).toHaveBeenCalledWith('notes/old.md', 'docs');
  });

  it('supports project-shell file inspection commands', async () => {
    const fs = makeFs();
    fs.readFile.mockResolvedValueOnce({
      path: '/docs/notes.md',
      content: 'one two\nthree four\nfive',
      size: 23,
      truncated: false,
    });
    const shell = new WorkspaceShell(fs as any);

    const head = await shell.execute('head -n 2 notes.md', '/docs');
    const wc = await shell.execute('wc notes.md', '/docs');
    const stat = await shell.execute('stat notes.md', '/docs');

    expect(head.output).toBe('one two\nthree four');
    expect(wc.output).toContain('/docs/notes.md');
    expect(stat.output).toContain('Size: 15 bytes');
  });

  it('supports touch, copy, and move inside the workspace', async () => {
    const fs = makeFs();
    const shell = new WorkspaceShell(fs as any);

    await expect(
      shell.execute('touch notes/todo.md', '/docs'),
    ).resolves.toEqual(expect.objectContaining({ok: true, mutated: true}));
    await expect(
      shell.execute('cp -f notes/todo.md notes/todo-copy.md', '/docs'),
    ).resolves.toEqual(expect.objectContaining({ok: true, mutated: true}));
    await expect(
      shell.execute('mv notes/todo-copy.md archive/todo.md', '/docs'),
    ).resolves.toEqual(expect.objectContaining({ok: true, mutated: true}));

    expect(fs.touchFile).toHaveBeenCalledWith('notes/todo.md', 'docs');
    expect(fs.copyPath).toHaveBeenCalledWith(
      'notes/todo.md',
      'notes/todo-copy.md',
      {
        cwd: 'docs',
        overwrite: true,
      },
    );
    expect(fs.movePath).toHaveBeenCalledWith(
      'notes/todo-copy.md',
      'archive/todo.md',
      {
        cwd: 'docs',
        overwrite: false,
      },
    );
  });

  it('tracks shell environment without changing cwd ownership', async () => {
    const fs = makeFs();
    const shell = new WorkspaceShell(fs as any);

    await expect(
      shell.execute('export PROJECT=llmm', '/docs'),
    ).resolves.toEqual(expect.objectContaining({ok: true}));
    const result = await shell.execute('env', '/docs');

    expect(result.output).toContain('PROJECT=llmm');
    expect(result.output).toContain('PWD=/docs');
    await expect(shell.execute('which ls', '/docs')).resolves.toEqual(
      expect.objectContaining({ok: true, output: '/bin/ls'}),
    );
  });

  it('reports package and runtime boundaries explicitly', async () => {
    const fs = makeFs();
    const shell = new WorkspaceShell(fs as any);

    const runtime = await shell.execute('runtime', '/');
    const packages = await shell.execute('pkg list', '/');
    const python = await shell.execute('python script.py', '/');
    const install = await shell.execute('pkg install python', '/');

    expect(runtime.output).toContain('Native processes: disabled');
    expect(packages.output).toContain('llmm-core');
    expect(python.ok).toBe(false);
    expect(python.error).toMatch(/runtime provider/i);
    expect(install.ok).toBe(false);
    expect(install.error).toMatch(/runtime provider/i);
  });

  it('runs workspace scripts with the same allowlisted commands', async () => {
    const fs = makeFs();
    fs.readFile.mockResolvedValueOnce({
      path: '/scripts/setup.llsh',
      content: [
        '# create a note',
        'mkdir notes',
        'cd notes',
        'write hello.md "hello workspace"',
        'pwd',
      ].join('\n'),
      size: 72,
      truncated: false,
    });
    const shell = new WorkspaceShell(fs as any);

    const result = await shell.execute('run scripts/setup.llsh', '/');

    expect(result.ok).toBe(true);
    expect(result.cwd).toBe('/notes');
    expect(result.output).toContain('$ mkdir notes');
    expect(result.output).toContain('$ write hello.md "hello workspace"');
    expect(fs.writeFile).toHaveBeenCalledWith('hello.md', 'hello workspace', {
      cwd: 'notes',
      append: false,
    });
  });

  it('stops workspace scripts when a line fails', async () => {
    const fs = makeFs();
    fs.readFile.mockResolvedValueOnce({
      path: '/scripts/bad.llsh',
      content: 'mkdir notes\nopen -a Calendar\nwrite notes/done.txt done',
      size: 56,
      truncated: false,
    });
    const shell = new WorkspaceShell(fs as any);

    const result = await shell.execute('run scripts/bad.llsh', '/');

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/line 2/i);
    expect(result.output).not.toContain('done.txt');
  });

  it('rejects native-looking commands instead of spawning them', async () => {
    const fs = makeFs();
    const shell = new WorkspaceShell(fs as any);

    const result = await shell.execute('open -a Calendar', '/');

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unknown command/i);
  });

  it('rejects shell operators and path traversal', async () => {
    const fs = makeFs();
    const shell = new WorkspaceShell(fs as any);

    await expect(shell.execute('ls ; cat notes.md', '/')).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.stringMatching(/unsupported shell operator/i),
      }),
    );
    await expect(
      shell.execute('cat ../../secret.txt', '/docs'),
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.stringMatching(/cannot leave the app workspace/i),
      }),
    );
  });
});
