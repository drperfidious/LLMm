import {WorkspaceFileSystem, workspaceFileSystem} from './WorkspaceFileSystem';
import {displayWorkspacePath, resolveWorkspacePath} from './pathUtils';

export type WorkspaceShellResult = {
  ok: boolean;
  cwd: string;
  command: string;
  output: string;
  error?: string;
  mutated?: boolean;
};

type Token = {
  value: string;
  quoted: boolean;
};

type WorkspaceShellEnvironment = Record<string, string>;

const BUILTIN_COMMANDS = [
  'help',
  'runtime',
  'pkg',
  'pwd',
  'env',
  'export',
  'unset',
  'which',
  'ls',
  'tree',
  'cd',
  'stat',
  'cat',
  'head',
  'tail',
  'wc',
  'touch',
  'mkdir',
  'rmdir',
  'rm',
  'cp',
  'mv',
  'write',
  'append',
  'echo',
  'grep',
  'run',
] as const;

const RUNTIME_COMMANDS = new Set([
  'apk',
  'apt',
  'bash',
  'conda',
  'mamba',
  'micromamba',
  'node',
  'npm',
  'pip',
  'pip3',
  'python',
  'python3',
  'sh',
  'venv',
  'virtualenv',
]);

const HELP = [
  'LLMm Workspace Shell commands:',
  '  help',
  '  runtime',
  '  pkg list|search <term>|install <name>',
  '  pwd',
  '  env',
  '  export KEY=value',
  '  unset KEY',
  '  which <command>',
  '  ls [path]',
  '  tree [path]',
  '  cd <path>',
  '  stat <path>',
  '  cat <file>',
  '  head [-n N] <file>',
  '  tail [-n N] <file>',
  '  wc <file>',
  '  touch <file>',
  '  mkdir <path>',
  '  rmdir <empty-directory>',
  '  rm <path>',
  '  cp [-f] <source> <target>',
  '  mv [-f] <source> <target>',
  '  write <file> <text>',
  '  append <file> <text>',
  '  echo <text> > <file>',
  '  echo <text> >> <file>',
  '  grep <text> [path]',
  '  run <script.llsh>',
  '',
  'Runtime boundary:',
  '  This is an app-contained project shell. It cannot run native executables, pipes, network commands, package-manager installs, or access files outside the LLMm workspace. run executes LLMm shell commands from a text file, not native bash.',
  '  python, pip, conda, apk, npm, sh, and bash are recognized as future runtime-provider commands and will fail clearly in this build instead of silently pretending to run.',
].join('\n');

const MAX_SCRIPT_DEPTH = 2;
const MAX_SCRIPT_LINES = 80;
const MAX_SCRIPT_OUTPUT_CHARS = 24 * 1024;
const DEFAULT_LINE_LIMIT = 10;
const MAX_LINE_LIMIT = 200;
const TREE_MAX_ENTRIES = 120;

const DEFAULT_ENV: WorkspaceShellEnvironment = {
  HOME: '/',
  LLMM_WORKSPACE: '/',
  PATH: '/bin:/usr/bin:/workspace/bin',
  SHELL: 'llmm-sh',
  TERM: 'xterm-256color',
};

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let value = '';
  let quote: '"' | "'" | null = null;
  let quoted = false;

  const push = () => {
    if (value.length > 0 || quoted) {
      tokens.push({value, quoted});
    }
    value = '';
    quoted = false;
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < input.length) {
        value += input[i + 1];
        i++;
        continue;
      }
      if (ch === quote) {
        quote = null;
        quoted = true;
        continue;
      }
      value += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      quoted = true;
      continue;
    }
    if (/\s/.test(ch)) {
      push();
      continue;
    }
    if ((ch === '>' || ch === '<') && value.length > 0) {
      push();
    }
    if (ch === '>' && input[i + 1] === '>') {
      tokens.push({value: '>>', quoted: false});
      i++;
      continue;
    }
    if (';|&`$()<'.includes(ch)) {
      tokens.push({value: ch, quoted: false});
      continue;
    }
    if (ch === '>') {
      tokens.push({value: '>', quoted: false});
      continue;
    }
    value += ch;
  }
  if (quote) {
    throw new Error('Unclosed quote in command');
  }
  push();
  return tokens;
}

function rejectShellOperators(tokens: Token[]): void {
  const forbidden = new Set([';', '|', '&', '`', '$', '(', ')', '<']);
  const bad = tokens.find(token => !token.quoted && forbidden.has(token.value));
  if (bad) {
    throw new Error(
      `Unsupported shell operator "${bad.value}". Use one command at a time.`,
    );
  }
}

function stripOptionalNewline(text: string): string {
  return text.endsWith('\\n') ? `${text.slice(0, -2)}\n` : text;
}

function byteLength(text: string): number {
  const Encoder = (globalThis as any).TextEncoder;
  if (typeof Encoder === 'function') {
    return new Encoder().encode(text).length;
  }
  return unescape(encodeURIComponent(text)).length;
}

function formatStat(
  stat: Awaited<ReturnType<WorkspaceFileSystem['statPath']>>,
): string {
  return [
    `Path: ${stat.path}`,
    `Type: ${stat.type}`,
    `Size: ${stat.size} bytes`,
    stat.modifiedAt ? `Modified: ${stat.modifiedAt}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
}

function validateEnvName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid environment variable name "${name}"`);
  }
}

function formatEnv(env: WorkspaceShellEnvironment, cwd: string): string {
  return Object.entries({...env, PWD: cwd})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function parseForceAndPaths(args: Token[], commandName: string) {
  const values = args.map(token => token.value);
  const overwrite = values[0] === '-f';
  const paths = overwrite ? values.slice(1) : values;
  if (paths.length !== 2) {
    throw new Error(`${commandName} requires a source and target path`);
  }
  return {overwrite, source: paths[0], target: paths[1]};
}

function parseLineLimitAndPath(args: Token[], commandName: string) {
  let limit = DEFAULT_LINE_LIMIT;
  let path: string | undefined;

  if (args[0]?.value === '-n') {
    const raw = args[1]?.value;
    const parsed = raw ? Number(raw) : Number.NaN;
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(`${commandName} -n requires a positive integer`);
    }
    limit = Math.min(parsed, MAX_LINE_LIMIT);
    path = args[2]?.value;
  } else if (args[0]?.value?.startsWith('-n')) {
    const parsed = Number(args[0].value.slice(2));
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(`${commandName} -n requires a positive integer`);
    }
    limit = Math.min(parsed, MAX_LINE_LIMIT);
    path = args[1]?.value;
  } else {
    path = args[0]?.value;
  }

  if (!path) {
    throw new Error(`${commandName} requires a file path`);
  }
  return {limit, path};
}

function firstLines(content: string, limit: number): string {
  return content.split(/\r?\n/).slice(0, limit).join('\n');
}

function lastLines(content: string, limit: number): string {
  return content.split(/\r?\n/).slice(-limit).join('\n');
}

function countWords(content: string): number {
  const trimmed = content.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function formatEntries(
  entries: Awaited<ReturnType<WorkspaceFileSystem['list']>>,
): string {
  if (entries.length === 0) {
    return '(empty)';
  }
  return entries
    .map(entry => {
      const type = entry.type === 'directory' ? 'dir ' : 'file';
      return `${type.padEnd(5)} ${String(entry.size).padStart(8)} ${entry.path}`;
    })
    .join('\n');
}

function formatMatches(
  matches: Awaited<ReturnType<WorkspaceFileSystem['search']>>,
): string {
  if (matches.length === 0) {
    return 'No matches';
  }
  return matches
    .map(match => `${match.path}:${match.line}: ${match.text}`)
    .join('\n');
}

export class WorkspaceShell {
  private readonly env: WorkspaceShellEnvironment = {...DEFAULT_ENV};

  constructor(private readonly fs = workspaceFileSystem) {}

  async execute(
    command: string,
    cwd = '',
    depth = 0,
  ): Promise<WorkspaceShellResult> {
    const trimmedCommand = command.trim();
    const currentCwd = (() => {
      try {
        return displayWorkspacePath(resolveWorkspacePath(cwd || '/'));
      } catch {
        return '/';
      }
    })();

    if (!trimmedCommand) {
      return {
        ok: false,
        cwd: currentCwd,
        command,
        output: '',
        error: 'Command cannot be empty',
      };
    }

    try {
      const currentCwd = displayWorkspacePath(resolveWorkspacePath(cwd || '/'));
      const tokens = tokenize(trimmedCommand);
      rejectShellOperators(tokens);
      const [commandToken, ...args] = tokens;
      const name = commandToken.value.toLowerCase();
      const cwdRel = resolveWorkspacePath(currentCwd);

      switch (name) {
        case 'help':
          return {ok: true, cwd: currentCwd, command, output: HELP};
        case 'runtime':
          return {
            ok: true,
            cwd: currentCwd,
            command,
            output: this.formatRuntimeStatus(),
          };
        case 'pkg':
          return this.executePkg(command, currentCwd, args);
        case 'pwd':
          return {ok: true, cwd: currentCwd, command, output: currentCwd};
        case 'env':
          if (args.length > 0) {
            throw new Error('env does not accept arguments');
          }
          return {
            ok: true,
            cwd: currentCwd,
            command,
            output: formatEnv(this.env, currentCwd),
          };
        case 'export':
          return this.executeExport(command, currentCwd, args);
        case 'unset':
          return this.executeUnset(command, currentCwd, args);
        case 'which':
          return this.executeWhich(command, currentCwd, args);
        case 'cd': {
          const target = args[0]?.value ?? '/';
          const nextCwdRel = resolveWorkspacePath(target, cwdRel);
          const nextCwd = await this.fs.assertDirectory(nextCwdRel);
          return {ok: true, cwd: nextCwd, command, output: nextCwd};
        }
        case 'ls': {
          const entries = await this.fs.list(args[0]?.value ?? '.', cwdRel);
          return {
            ok: true,
            cwd: currentCwd,
            command,
            output: formatEntries(entries),
          };
        }
        case 'tree':
          return {
            ok: true,
            cwd: currentCwd,
            command,
            output: await this.formatTree(args[0]?.value ?? '.', cwdRel),
          };
        case 'stat': {
          const stat = await this.fs.statPath(args[0]?.value ?? '.', cwdRel);
          return {
            ok: true,
            cwd: currentCwd,
            command,
            output: formatStat(stat),
          };
        }
        case 'cat': {
          if (!args[0]?.value) {
            throw new Error('cat requires a file path');
          }
          const result = await this.fs.readFile(args[0].value, cwdRel);
          return {
            ok: true,
            cwd: currentCwd,
            command,
            output: result.content,
          };
        }
        case 'head': {
          const {limit, path} = parseLineLimitAndPath(args, name);
          const result = await this.fs.readFile(path, cwdRel);
          return {
            ok: true,
            cwd: currentCwd,
            command,
            output: firstLines(result.content, limit),
          };
        }
        case 'tail': {
          const {limit, path} = parseLineLimitAndPath(args, name);
          const result = await this.fs.readFile(path, cwdRel);
          return {
            ok: true,
            cwd: currentCwd,
            command,
            output: lastLines(result.content, limit),
          };
        }
        case 'wc': {
          if (!args[0]?.value) {
            throw new Error('wc requires a file path');
          }
          const result = await this.fs.readFile(args[0].value, cwdRel);
          const lines = result.content.split(/\r?\n/).length;
          const words = countWords(result.content);
          const bytes = byteLength(result.content);
          return {
            ok: true,
            cwd: currentCwd,
            command,
            output: `${String(lines).padStart(8)} ${String(words).padStart(8)} ${String(bytes).padStart(8)} ${result.path}`,
          };
        }
        case 'touch': {
          if (!args[0]?.value) {
            throw new Error('touch requires a file path');
          }
          const result = await this.fs.touchFile(args[0].value, cwdRel);
          return {
            ok: true,
            cwd: currentCwd,
            command,
            output: `Touched ${result.path}`,
            mutated: true,
          };
        }
        case 'mkdir': {
          if (!args[0]?.value) {
            throw new Error('mkdir requires a path');
          }
          const path = await this.fs.mkdir(args[0].value, cwdRel);
          return {
            ok: true,
            cwd: currentCwd,
            command,
            output: `Created ${path}`,
            mutated: true,
          };
        }
        case 'rmdir': {
          if (!args[0]?.value) {
            throw new Error('rmdir requires a path');
          }
          const entries = await this.fs.list(args[0].value, cwdRel);
          if (entries.length > 0) {
            throw new Error('rmdir only removes empty directories');
          }
          const result = await this.fs.deletePath(args[0].value, cwdRel);
          return {
            ok: true,
            cwd: currentCwd,
            command,
            output: `Deleted ${result.path}`,
            mutated: true,
          };
        }
        case 'rm': {
          if (!args[0]?.value) {
            throw new Error('rm requires a path');
          }
          const result = await this.fs.deletePath(args[0].value, cwdRel);
          return {
            ok: true,
            cwd: currentCwd,
            command,
            output: `Deleted ${result.path}`,
            mutated: true,
          };
        }
        case 'cp': {
          const paths = parseForceAndPaths(args, name);
          const result = await this.fs.copyPath(paths.source, paths.target, {
            cwd: cwdRel,
            overwrite: paths.overwrite,
          });
          return {
            ok: true,
            cwd: currentCwd,
            command,
            output: `Copied ${result.sourcePath} to ${result.path}`,
            mutated: true,
          };
        }
        case 'mv': {
          const paths = parseForceAndPaths(args, name);
          const result = await this.fs.movePath(paths.source, paths.target, {
            cwd: cwdRel,
            overwrite: paths.overwrite,
          });
          return {
            ok: true,
            cwd: currentCwd,
            command,
            output: `Moved ${result.sourcePath} to ${result.path}`,
            mutated: true,
          };
        }
        case 'write':
        case 'append': {
          if (!args[0]?.value) {
            throw new Error(`${name} requires a file path`);
          }
          const content = stripOptionalNewline(
            args
              .slice(1)
              .map(token => token.value)
              .join(' '),
          );
          const result = await this.fs.writeFile(args[0].value, content, {
            cwd: cwdRel,
            append: name === 'append',
          });
          return {
            ok: true,
            cwd: currentCwd,
            command,
            output: `${name === 'append' ? 'Appended' : 'Wrote'} ${result.size} bytes to ${result.path}`,
            mutated: true,
          };
        }
        case 'echo':
          return this.executeEcho(command, currentCwd, cwdRel, args);
        case 'grep': {
          if (!args[0]?.value) {
            throw new Error('grep requires a search string');
          }
          const matches = await this.fs.search(
            args[0].value,
            args[1]?.value ?? '.',
            cwdRel,
          );
          return {
            ok: true,
            cwd: currentCwd,
            command,
            output: formatMatches(matches),
          };
        }
        case 'run':
          return this.executeScript(command, currentCwd, cwdRel, args, depth);
        default:
          if (RUNTIME_COMMANDS.has(name)) {
            throw new Error(
              `${name} requires a bundled runtime provider. This build only includes the app-contained LLMm workspace shell; use run <script.llsh> or install a future WASI/iSH runtime build.`,
            );
          }
          throw new Error(
            `Unknown command "${name}". Run "help" for supported commands.`,
          );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        cwd: currentCwd,
        command,
        output: '',
        error: message,
      };
    }
  }

  private async executeEcho(
    command: string,
    currentCwd: string,
    cwdRel: string,
    args: Token[],
  ): Promise<WorkspaceShellResult> {
    const redirectIndex = args.findIndex(
      token => !token.quoted && (token.value === '>' || token.value === '>>'),
    );
    if (redirectIndex < 0) {
      return {
        ok: true,
        cwd: currentCwd,
        command,
        output: args.map(token => token.value).join(' '),
      };
    }

    const redirect = args[redirectIndex].value;
    const target = args[redirectIndex + 1]?.value;
    if (!target) {
      throw new Error('echo redirection requires a target file');
    }
    if (args.length > redirectIndex + 2) {
      throw new Error('echo redirection accepts one target file');
    }
    const content = `${stripOptionalNewline(
      args
        .slice(0, redirectIndex)
        .map(token => token.value)
        .join(' '),
    )}\n`;
    const result = await this.fs.writeFile(target, content, {
      cwd: cwdRel,
      append: redirect === '>>',
    });
    return {
      ok: true,
      cwd: currentCwd,
      command,
      output: `${redirect === '>>' ? 'Appended' : 'Wrote'} ${result.size} bytes to ${result.path}`,
      mutated: true,
    };
  }

  private formatRuntimeStatus(): string {
    return [
      'Runtime: builtin LLMm workspace shell',
      'Native processes: disabled',
      'Filesystem: app-contained workspace only',
      'Network commands: disabled',
      'Package installs: disabled until a bundled runtime provider is added',
      'Python virtualenv/conda: disabled until a Python/WASI/iSH runtime provider is added',
      '',
      `Built-in commands: ${BUILTIN_COMMANDS.join(', ')}`,
    ].join('\n');
  }

  private executePkg(
    command: string,
    currentCwd: string,
    args: Token[],
  ): WorkspaceShellResult {
    const subcommand = args[0]?.value?.toLowerCase() ?? 'help';
    switch (subcommand) {
      case 'help':
        return {
          ok: true,
          cwd: currentCwd,
          command,
          output: [
            'pkg list',
            'pkg search <term>',
            'pkg install <name>',
            '',
            'Package installation requires a bundled runtime provider. This build exposes the interface, but does not install or execute downloaded packages.',
          ].join('\n'),
        };
      case 'list':
        return {
          ok: true,
          cwd: currentCwd,
          command,
          output: [
            'Installed packages:',
            '  llmm-core  built-in workspace commands',
            '',
            'Runtime package managers: not installed',
          ].join('\n'),
        };
      case 'search': {
        const term = args
          .slice(1)
          .map(token => token.value)
          .join(' ')
          .trim()
          .toLowerCase();
        if (!term) {
          throw new Error('pkg search requires a search term');
        }
        const runtimeHints = [
          'python',
          'pip',
          'conda',
          'mamba',
          'apk',
          'node',
          'npm',
          'bash',
        ];
        const matches = runtimeHints.filter(item => item.includes(term));
        return {
          ok: true,
          cwd: currentCwd,
          command,
          output:
            matches.length > 0
              ? matches
                  .map(item => `${item}  planned runtime-provider command`)
                  .join('\n')
              : 'No package matches. Only llmm-core is installed in this build.',
        };
      }
      case 'install':
      case 'remove':
      case 'update':
        throw new Error(
          `pkg ${subcommand} requires a bundled runtime provider. Downloaded package managers are intentionally disabled in this build.`,
        );
      default:
        throw new Error(`Unknown pkg command "${subcommand}"`);
    }
  }

  private executeExport(
    command: string,
    currentCwd: string,
    args: Token[],
  ): WorkspaceShellResult {
    if (args.length === 0) {
      return {
        ok: true,
        cwd: currentCwd,
        command,
        output: formatEnv(this.env, currentCwd),
      };
    }

    const exported: string[] = [];
    args.forEach(token => {
      const index = token.value.indexOf('=');
      if (index <= 0) {
        throw new Error('export requires KEY=value pairs');
      }
      const key = token.value.slice(0, index);
      const value = token.value.slice(index + 1);
      validateEnvName(key);
      if (key === 'PWD') {
        throw new Error('PWD is controlled by the workspace cwd');
      }
      this.env[key] = value;
      exported.push(key);
    });

    return {
      ok: true,
      cwd: currentCwd,
      command,
      output: `Exported ${exported.join(', ')}`,
    };
  }

  private executeUnset(
    command: string,
    currentCwd: string,
    args: Token[],
  ): WorkspaceShellResult {
    if (args.length === 0) {
      throw new Error('unset requires at least one variable name');
    }
    const removed: string[] = [];
    args.forEach(token => {
      validateEnvName(token.value);
      if (token.value === 'PWD') {
        throw new Error('PWD is controlled by the workspace cwd');
      }
      delete this.env[token.value];
      removed.push(token.value);
    });
    return {
      ok: true,
      cwd: currentCwd,
      command,
      output: `Unset ${removed.join(', ')}`,
    };
  }

  private executeWhich(
    command: string,
    currentCwd: string,
    args: Token[],
  ): WorkspaceShellResult {
    const target = args[0]?.value?.toLowerCase();
    if (!target) {
      throw new Error('which requires a command name');
    }
    if ((BUILTIN_COMMANDS as readonly string[]).includes(target)) {
      return {
        ok: true,
        cwd: currentCwd,
        command,
        output: `/bin/${target}`,
      };
    }
    if (RUNTIME_COMMANDS.has(target)) {
      throw new Error(`${target}: runtime provider not installed`);
    }
    throw new Error(`${target}: not found`);
  }

  private async formatTree(path: string, cwdRel: string): Promise<string> {
    const root = await this.fs.statPath(path, cwdRel);
    const lines = [root.path];
    let entryCount = 0;

    const visit = async (displayPath: string, depth: number): Promise<void> => {
      if (entryCount >= TREE_MAX_ENTRIES) {
        return;
      }
      const entries = await this.fs.list(displayPath);
      for (const entry of entries) {
        if (entryCount >= TREE_MAX_ENTRIES) {
          break;
        }
        entryCount += 1;
        const marker = entry.type === 'directory' ? '[dir] ' : '[file]';
        lines.push(`${'  '.repeat(depth)}${marker} ${entry.name}`);
        if (entry.type === 'directory') {
          await visit(entry.path, depth + 1);
        }
      }
    };

    if (root.type === 'directory') {
      await visit(root.path, 1);
    }
    if (entryCount >= TREE_MAX_ENTRIES) {
      lines.push(`... truncated at ${TREE_MAX_ENTRIES} entries`);
    }
    return lines.join('\n');
  }

  private async executeScript(
    command: string,
    currentCwd: string,
    cwdRel: string,
    args: Token[],
    depth: number,
  ): Promise<WorkspaceShellResult> {
    if (!args[0]?.value) {
      throw new Error('run requires a script path');
    }
    if (depth >= MAX_SCRIPT_DEPTH) {
      throw new Error('Script nesting limit reached');
    }

    const script = await this.fs.readFile(args[0].value, cwdRel);
    const rawLines = script.content.split(/\r?\n/);
    if (rawLines.length > MAX_SCRIPT_LINES) {
      throw new Error(
        `Script has ${rawLines.length} lines; max is ${MAX_SCRIPT_LINES}`,
      );
    }

    let activeCwd = currentCwd;
    let mutated = false;
    const output: string[] = [];

    for (let index = 0; index < rawLines.length; index++) {
      const lineNumber = index + 1;
      const line = rawLines[index].trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      const result = await this.execute(line, activeCwd, depth + 1);
      activeCwd = result.cwd;
      mutated = mutated || !!result.mutated;
      output.push(`$ ${line}`);
      if (result.output) {
        output.push(result.output);
      }
      if (!result.ok) {
        return {
          ok: false,
          cwd: activeCwd,
          command,
          output: output.join('\n').slice(0, MAX_SCRIPT_OUTPUT_CHARS),
          error: `Script failed at line ${lineNumber}: ${result.error}`,
          mutated,
        };
      }
    }

    return {
      ok: true,
      cwd: activeCwd,
      command,
      output:
        output.join('\n').slice(0, MAX_SCRIPT_OUTPUT_CHARS) || '(no output)',
      mutated,
    };
  }
}

export const workspaceShell = new WorkspaceShell();
