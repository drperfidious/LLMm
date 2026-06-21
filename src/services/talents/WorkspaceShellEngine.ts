import {
  workspaceSessionState,
  workspaceShell,
  type WorkspaceShell,
} from '../workspace';

import type {
  TalentEngine,
  TalentManifest,
  TalentResult,
  ToolDefinition,
} from './types';

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export class WorkspaceShellEngine implements TalentEngine {
  readonly name = 'workspace_shell';
  readonly manifest: TalentManifest = {
    name: this.name,
    title: 'Workspace shell',
    description:
      'Run shell-like commands inside the app-contained LLMm workspace.',
    source: 'builtin',
    category: 'management',
    configurable: true,
    sideEffect: true,
    agentDefaultEnabled: false,
    keywords: [
      'shell',
      'terminal',
      'workspace',
      'file',
      'files',
      'documents',
      'cwd',
      'current directory',
      '.md',
      'markdown',
      'make file',
      'create file',
      'save document',
      'read file',
      'write file',
      'grep',
    ],
  };

  constructor(private readonly shell: WorkspaceShell = workspaceShell) {}

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const command = cleanString(args.command);
    const cwd = cleanString(args.cwd) || workspaceSessionState.cwd;
    if (!command) {
      return {
        type: 'error',
        summary: 'workspace_shell: missing command',
        errorMessage: 'command is required',
      };
    }

    const result = await this.shell.execute(command, cwd);
    if (!result.ok) {
      return {
        type: 'error',
        summary: `workspace_shell (${result.cwd}): ${result.error}`,
        errorMessage: result.error ?? 'Workspace shell command failed',
      };
    }

    const mutationNote = result.mutated ? '\nMutation: yes' : '';
    return {
      type: 'text',
      summary:
        `workspace_shell cwd=${result.cwd}\n` +
        `command: ${command}${mutationNote}\n` +
        `output:\n${result.output}`,
    };
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description:
          'Run a shell-like command inside the LLMm app-contained workspace. Supported commands include help, runtime, pkg, pwd, env, export, unset, which, ls, tree, cd, stat, cat, head, tail, wc, touch, mkdir, rm, cp, mv, write, append, echo >, echo >>, grep, and run. If cwd is omitted, the command runs in the current chat workspace directory selected by the user. run executes LLMm shell commands from a workspace text file. Native bash, Python, Node, conda, package installs, network commands, pipes, and files outside the app workspace are not available in this build.',
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description:
                'One workspace shell command, for example: "ls docs", "cat notes.md", "grep TODO /", "echo \\"hello\\" > notes/hello.txt".',
            },
            cwd: {
              type: 'string',
              description:
                'Optional current working directory inside the workspace, for example "/" or "/notes". Defaults to the current chat workspace directory.',
            },
          },
          required: ['command'],
        },
      },
    };
  }
}
