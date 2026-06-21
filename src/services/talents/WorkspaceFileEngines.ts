import {
  workspaceFileSystem,
  workspaceSessionState,
  type WorkspaceEntry,
  type WorkspaceFileSystem,
} from '../workspace';
import {pathWithInferredTextExtension} from '../workspace/documentUtils';

import type {
  TalentEngine,
  TalentManifest,
  TalentResult,
  ToolDefinition,
} from './types';

function cleanString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function boolArg(value: unknown): boolean {
  return value === true || value === 'true';
}

function numberArg(value: unknown, fallback: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n)
    ? Math.max(1, Math.min(max, Math.floor(n)))
    : fallback;
}

function currentCwd(value: unknown): string {
  return cleanString(value) || workspaceSessionState.cwd;
}

function formatEntries(entries: WorkspaceEntry[]): string {
  if (entries.length === 0) {
    return '(empty)';
  }
  return entries
    .map(entry => {
      const type = entry.type === 'directory' ? 'dir ' : 'file';
      const modified = entry.modifiedAt ? ` ${entry.modifiedAt}` : '';
      return `${type.padEnd(5)} ${String(entry.size).padStart(8)} ${entry.path}${modified}`;
    })
    .join('\n');
}

const baseManifest: Pick<
  TalentManifest,
  'category' | 'source' | 'configurable'
> = {
  category: 'management',
  source: 'builtin',
  configurable: true,
};

export class WorkspaceListEngine implements TalentEngine {
  readonly name = 'workspace_list';
  readonly manifest: TalentManifest = {
    ...baseManifest,
    name: this.name,
    title: 'List workspace files',
    description: 'List files in the app-contained LLMm workspace.',
    keywords: [
      'list files',
      'ls',
      'workspace',
      'documents',
      'directory',
      'cwd',
      'current directory',
    ],
  };

  constructor(private readonly fs: WorkspaceFileSystem = workspaceFileSystem) {}

  async execute(args: Record<string, any>): Promise<TalentResult> {
    try {
      const cwd = currentCwd(args.cwd);
      const path = cleanString(args.path, '.');
      const recursive = boolArg(args.recursive);
      const maxEntries = numberArg(args.max_entries, 80, 500);
      const entries = recursive
        ? await this.fs.listFiles(path, cwd, {maxEntries})
        : await this.fs.list(path, cwd);
      return {
        type: 'text',
        summary: `workspace_list cwd=${cwd} path=${path}\n${formatEntries(
          entries.slice(0, maxEntries),
        )}`,
      };
    } catch (error) {
      return {
        type: 'error',
        summary: 'workspace_list failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description:
          'List files or directories inside the app-contained LLMm workspace. Cannot access files outside the app workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Workspace path to list, such as "/" or "notes".',
            },
            cwd: {
              type: 'string',
              description:
                'Optional workspace cwd. Defaults to the current chat workspace directory.',
            },
            recursive: {
              type: 'boolean',
              description: 'When true, list files recursively.',
            },
            max_entries: {
              type: 'number',
              description: 'Maximum entries to return, 1-500.',
            },
          },
        },
      },
    };
  }
}

export class WorkspaceReadEngine implements TalentEngine {
  readonly name = 'workspace_read';
  readonly manifest: TalentManifest = {
    ...baseManifest,
    name: this.name,
    title: 'Read workspace file',
    description: 'Read a text file from the app-contained LLMm workspace.',
    keywords: [
      'read file',
      'cat',
      'workspace',
      'documents',
      'open file',
      'cwd',
      'current directory',
    ],
  };

  constructor(private readonly fs: WorkspaceFileSystem = workspaceFileSystem) {}

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const path = cleanString(args.path);
    if (!path) {
      return {
        type: 'error',
        summary: 'workspace_read: missing path',
        errorMessage: 'path is required',
      };
    }
    try {
      const result = await this.fs.readFile(
        path,
        currentCwd(args.cwd),
        numberArg(args.max_bytes, 96 * 1024, 512 * 1024),
      );
      return {
        type: 'text',
        summary: `workspace_read ${result.path} (${result.size} bytes)\n\n${result.content}`,
      };
    } catch (error) {
      return {
        type: 'error',
        summary: `workspace_read failed for ${path}`,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description:
          'Read a text file from the app-contained LLMm workspace. Use workspace_list first when unsure of the path.',
        parameters: {
          type: 'object',
          properties: {
            path: {type: 'string', description: 'Workspace file path.'},
            cwd: {
              type: 'string',
              description:
                'Optional workspace cwd. Defaults to the current chat workspace directory.',
            },
            max_bytes: {
              type: 'number',
              description: 'Maximum bytes to read, capped at 512 KB.',
            },
          },
          required: ['path'],
        },
      },
    };
  }
}

export class WorkspaceWriteEngine implements TalentEngine {
  readonly name = 'workspace_write';
  readonly manifest: TalentManifest = {
    ...baseManifest,
    name: this.name,
    title: 'Write workspace file',
    description: 'Create or update a text file in the app-contained workspace.',
    sideEffect: true,
    keywords: [
      'write file',
      'create file',
      'make file',
      'make a file',
      'append file',
      'save document',
      'create document',
      'make document',
      'write document',
      'markdown',
      '.md',
      'md file',
      'cwd',
      'current directory',
    ],
  };

  constructor(private readonly fs: WorkspaceFileSystem = workspaceFileSystem) {}

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const rawPath = cleanString(args.path);
    const content = typeof args.content === 'string' ? args.content : '';
    if (!rawPath) {
      return {
        type: 'error',
        summary: 'workspace_write: missing path',
        errorMessage: 'path is required',
      };
    }
    if (typeof args.content !== 'string') {
      return {
        type: 'error',
        summary: 'workspace_write: missing content',
        errorMessage: 'content is required and must be a string',
      };
    }
    const append = boolArg(args.append);
    const path = append
      ? rawPath
      : pathWithInferredTextExtension(rawPath, content);

    try {
      const cwd = currentCwd(args.cwd);
      const overwrite = boolArg(args.overwrite);
      if (!append && !overwrite && (await this.fs.exists(path, cwd))) {
        return {
          type: 'error',
          summary: `workspace_write refused to overwrite ${path}`,
          errorMessage:
            'File already exists. Pass overwrite=true to replace it or append=true to append.',
        };
      }

      const result = await this.fs.writeFile(path, content, {
        cwd,
        append,
        maxBytes: numberArg(args.max_bytes, 512 * 1024, 1024 * 1024),
      });
      return {
        type: 'text',
        summary: `${append ? 'Appended' : 'Wrote'} ${result.size} bytes to ${result.path}`,
      };
    } catch (error) {
      return {
        type: 'error',
        summary: `workspace_write failed for ${path}`,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description:
          'Create, replace, or append a text file inside the app-contained LLMm workspace. This never writes outside the app sandbox.',
        parameters: {
          type: 'object',
          properties: {
            path: {type: 'string', description: 'Workspace file path.'},
            file_type: {
              type: 'string',
              description:
                'Optional hint such as markdown, text, json, python. For Markdown documents, include a .md extension in path.',
            },
            content: {type: 'string', description: 'Text content to write.'},
            cwd: {
              type: 'string',
              description:
                'Optional workspace cwd. Defaults to the current chat workspace directory.',
            },
            append: {
              type: 'boolean',
              description: 'Append instead of replacing file content.',
            },
            overwrite: {
              type: 'boolean',
              description:
                'Required to replace an existing file when append is false.',
            },
            max_bytes: {
              type: 'number',
              description: 'Maximum final file size, capped at 1 MB.',
            },
          },
          required: ['path', 'content'],
        },
      },
    };
  }
}

export class WorkspaceDeleteEngine implements TalentEngine {
  readonly name = 'workspace_delete';
  readonly manifest: TalentManifest = {
    ...baseManifest,
    name: this.name,
    title: 'Delete workspace file',
    description: 'Delete a file or directory from the app-contained workspace.',
    sideEffect: true,
    keywords: ['delete file', 'remove file', 'remove document', 'rm'],
  };

  constructor(private readonly fs: WorkspaceFileSystem = workspaceFileSystem) {}

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const path = cleanString(args.path);
    if (!path) {
      return {
        type: 'error',
        summary: 'workspace_delete: missing path',
        errorMessage: 'path is required',
      };
    }
    if (!boolArg(args.user_confirmed)) {
      return {
        type: 'error',
        summary: 'workspace_delete needs user confirmation',
        errorMessage:
          'Set user_confirmed=true only after the user explicitly confirms deletion.',
      };
    }
    try {
      const result = await this.fs.deletePath(path, currentCwd(args.cwd));
      return {
        type: 'text',
        summary: `Deleted ${result.type} ${result.path}`,
      };
    } catch (error) {
      return {
        type: 'error',
        summary: `workspace_delete failed for ${path}`,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description:
          'Delete a workspace file or directory. Requires user_confirmed=true after explicit user confirmation. Cannot delete the workspace root or files outside the app workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: {type: 'string', description: 'Workspace path to delete.'},
            cwd: {
              type: 'string',
              description:
                'Optional workspace cwd. Defaults to the current chat workspace directory.',
            },
            user_confirmed: {
              type: 'boolean',
              description:
                'Must be true only after the user explicitly confirms deletion.',
            },
          },
          required: ['path', 'user_confirmed'],
        },
      },
    };
  }
}

export class WorkspaceSearchEngine implements TalentEngine {
  readonly name = 'workspace_search';
  readonly manifest: TalentManifest = {
    ...baseManifest,
    name: this.name,
    title: 'Search workspace files',
    description: 'Search text files in the app-contained workspace.',
    keywords: ['search files', 'grep', 'find text', 'workspace', 'documents'],
  };

  constructor(private readonly fs: WorkspaceFileSystem = workspaceFileSystem) {}

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const pattern = cleanString(args.pattern ?? args.query);
    if (!pattern) {
      return {
        type: 'error',
        summary: 'workspace_search: missing pattern',
        errorMessage: 'pattern is required',
      };
    }
    try {
      const matches = await this.fs.search(
        pattern,
        cleanString(args.path, '.'),
        currentCwd(args.cwd),
        {
          caseSensitive: boolArg(args.case_sensitive),
          maxResults: numberArg(args.max_results, 40, 200),
        },
      );
      return {
        type: 'text',
        summary: matches.length
          ? `workspace_search results for "${pattern}":\n${matches
              .map(match => `${match.path}:${match.line}: ${match.text}`)
              .join('\n')}`
          : `workspace_search: no matches for "${pattern}".`,
      };
    } catch (error) {
      return {
        type: 'error',
        summary: `workspace_search failed for ${pattern}`,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description:
          'Search text files inside the app-contained LLMm workspace. Use this before reading many files.',
        parameters: {
          type: 'object',
          properties: {
            pattern: {type: 'string', description: 'Text to search for.'},
            path: {
              type: 'string',
              description: 'Workspace path to search. Defaults to current cwd.',
            },
            cwd: {
              type: 'string',
              description:
                'Optional workspace cwd. Defaults to the current chat workspace directory.',
            },
            case_sensitive: {
              type: 'boolean',
              description: 'Whether matching should be case-sensitive.',
            },
            max_results: {
              type: 'number',
              description: 'Maximum matches to return, 1-200.',
            },
          },
          required: ['pattern'],
        },
      },
    };
  }
}
