import {WorkspaceShellEngine} from '../WorkspaceShellEngine';
import {workspaceSessionState} from '../../workspace';

const makeShell = () => ({
  execute: jest.fn(async () => ({
    ok: true,
    cwd: '/docs',
    command: 'ls',
    output: 'file     12 /docs/notes.md',
    mutated: false,
  })),
});

describe('WorkspaceShellEngine', () => {
  beforeEach(() => {
    workspaceSessionState.setCwd('/');
  });

  it('returns shell output in a model-readable talent summary', async () => {
    const shell = makeShell();
    const engine = new WorkspaceShellEngine(shell as any);

    const result = await engine.execute({command: 'ls', cwd: '/docs'});

    expect(shell.execute).toHaveBeenCalledWith('ls', '/docs');
    expect(result).toEqual(
      expect.objectContaining({
        type: 'text',
        summary: expect.stringContaining('workspace_shell cwd=/docs'),
      }),
    );
  });

  it('maps failed shell commands to talent errors', async () => {
    const shell = {
      execute: jest.fn(async () => ({
        ok: false,
        cwd: '/',
        command: 'open -a Calendar',
        output: '',
        error: 'Unknown command "open".',
      })),
    };
    const engine = new WorkspaceShellEngine(shell as any);

    const result = await engine.execute({command: 'open -a Calendar'});

    expect(result).toEqual(
      expect.objectContaining({
        type: 'error',
        errorMessage: 'Unknown command "open".',
      }),
    );
  });

  it('defaults to the selected chat workspace cwd when cwd is omitted', async () => {
    const shell = makeShell();
    const engine = new WorkspaceShellEngine(shell as any);
    workspaceSessionState.setCwd('/research');

    await engine.execute({command: 'ls'});

    expect(shell.execute).toHaveBeenCalledWith('ls', '/research');
  });

  it('exposes command and cwd parameters', () => {
    const def = new WorkspaceShellEngine(makeShell() as any).toToolDefinition();

    expect(def.function.name).toBe('workspace_shell');
    expect(def.function.parameters.required).toContain('command');
    expect(def.function.parameters.properties.cwd).toBeDefined();
  });
});
