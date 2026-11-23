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

function boolArgWithDefault(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) {
    return fallback;
  }
  return boolArg(value);
}

function numberArg(value: unknown, fallback: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n)
    ? Math.max(1, Math.min(max, Math.floor(n)))
    : fallback;
}

function stringArrayArg(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  if (!value.every(item => typeof item === 'string')) {
    return undefined;
  }
  return value;
}

function currentCwd(value: unknown): string {
  return cleanString(value) || workspaceSessionState.cwd;
}

function resolveWriteContent(
  args: Record<string, any>,
):
  | {content: string; source: 'content' | 'lines' | 'chunks'}
  | {errorMessage: string} {
  if (typeof args.content === 'string') {
    return {content: args.content, source: 'content'};
  }

  const lines = stringArrayArg(args.lines);
  if (lines) {
    const trailingNewline = boolArgWithDefault(args.trailing_newline, true);
    return {
      content:
        lines.join('\n') + (lines.length > 0 && trailingNewline ? '\n' : ''),
      source: 'lines',
    };
  }

  const chunks = stringArrayArg(args.chunks);
  if (chunks) {
    const separator =
      typeof args.chunk_separator === 'string' ? args.chunk_separator : '';
    return {
      content: chunks.join(separator),
      source: 'chunks',
    };
  }

  return {
    errorMessage:
      'Provide content as a string, lines as a string array, or chunks as a string array.',
  };
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
      'directories',
      'folder',
      'folders',
      'subdirectory',
      'subdirectories',
      'subfolder',
      'subfolders',
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
        ? [
            ...(await this.fs.listDirectories(path, cwd, {maxEntries})),
            ...(await this.fs.listFiles(path, cwd, {maxEntries})),
          ].slice(0, maxEntries)
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
              description: 'When true, list directories and files recursively.',
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
    description:
      'Read a text or PDF file from the app-contained LLMm workspace.',
    keywords: [
      'read file',
      'cat',
      'pdf',
      'read pdf',
      'workspace',
      'documents',
      'open file',
      'files',
      'folder',
      'folders',
      'subfolder',
      'subfolders',
      'subdirectory',
      'subdirectories',
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
          'Read a text file or PDF from the app-contained LLMm workspace. PDFs are extracted to text automatically. Use workspace_list first when unsure of the path or when the user says cwd/current directory without an exact filename.',
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
      'files',
      'folder',
      'folders',
      'subfolder',
      'subfolders',
      'subdirectory',
      'subdirectories',
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
    if (!rawPath) {
      return {
        type: 'error',
        summary: 'workspace_write: missing path',
        errorMessage: 'path is required',
      };
    }

    const writeContent = resolveWriteContent(args);
    if ('errorMessage' in writeContent) {
      return {
        type: 'error',
        summary: 'workspace_write: missing content',
        errorMessage: writeContent.errorMessage,
      };
    }

    const {content, source} = writeContent;
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
        summary: `${append ? 'Appended' : 'Wrote'} ${result.size} bytes to ${result.path} from ${source}`,
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
          'Create, replace, or append a text file inside the app-contained LLMm workspace. This never writes outside the app sandbox. For substantial Markdown or code files, prefer lines (one document line per array item) or chunks instead of compressing the whole file into one content string. For long guides, write an outline or first section, then append later sections with append=true so each JSON payload stays small.',
        parameters: {
          type: 'object',
          properties: {
            path: {type: 'string', description: 'Workspace file path.'},
            file_type: {
              type: 'string',
              description:
                'Optional hint such as markdown, text, json, python. For Markdown documents, include a .md extension in path.',
            },
            content: {
              type: 'string',
              description:
                'Short text content to write. For longer Markdown/code, use lines or chunks instead.',
            },
            lines: {
              type: 'array',
              items: {type: 'string'},
              description:
                'Preferred for Markdown/code documents: one file line per string. The engine joins entries with newlines.',
            },
            chunks: {
              type: 'array',
              items: {type: 'string'},
              description:
                'Section chunks for longer files. Include newlines inside chunks or set chunk_separator.',
            },
            chunk_separator: {
              type: 'string',
              description:
                'Separator used between chunks. Defaults to an empty string.',
            },
            trailing_newline: {
              type: 'boolean',
              description:
                'When using lines, add a final newline. Defaults to true.',
            },
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
          required: ['path'],
        },
      },
    };
  }
}

export class WorkspaceMakeDirEngine implements TalentEngine {
  readonly name = 'workspace_mkdir';
  readonly manifest: TalentManifest = {
    ...baseManifest,
    name: this.name,
    title: 'Create workspace folder',
    description: 'Create a directory in the app-contained workspace.',
    sideEffect: true,
    keywords: [
      'mkdir',
      'create folder',
      'make folder',
      'new folder',
      'create directory',
      'make directory',
      'new directory',
      'subdirectory',
      'subdirectories',
      'subfolder',
      'subfolders',
      'cwd',
      'workspace',
    ],
  };

  constructor(private readonly fs: WorkspaceFileSystem = workspaceFileSystem) {}

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const path = cleanString(args.path);
    if (!path) {
      return {
        type: 'error',
        summary: 'workspace_mkdir: missing path',
        errorMessage: 'path is required',
      };
    }
    try {
      const result = await this.fs.mkdir(path, currentCwd(args.cwd));
      return {
        type: 'text',
        summary: `Created directory ${result}`,
      };
    } catch (error) {
      return {
        type: 'error',
        summary: `workspace_mkdir failed for ${path}`,
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
          'Create a directory inside the app-contained LLMm workspace. Use this for mkdir/create folder/create subfolder requests.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Workspace directory path to create.',
            },
            cwd: {
              type: 'string',
              description:
                'Optional workspace cwd. Defaults to the current chat workspace directory.',
            },
          },
          required: ['path'],
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
    keywords: [
      'delete file',
      'remove file',
      'remove document',
      'delete folder',
      'remove folder',
      'delete directory',
      'remove directory',
      'delete subfolder',
      'remove subfolder',
      'delete subdirectory',
      'remove subdirectory',
      'rm',
      'rmdir',
    ],
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

export class WorkspacePruneEmptyDirsEngine implements TalentEngine {
  readonly name = 'workspace_prune_empty_dirs';
  readonly manifest: TalentManifest = {
    ...baseManifest,
    name: this.name,
    title: 'Remove empty workspace folders',
    description:
      'List or remove empty directories from the app-contained workspace.',
    sideEffect: true,
    keywords: [
      'empty directory',
      'empty directories',
      'empty folder',
      'empty folders',
      'empty subfolder',
      'empty subfolders',
      'empty subdirectory',
      'empty subdirectories',
      'remove empty directory',
      'remove empty directories',
      'remove empty subdirectory',
      'remove empty subdirectories',
      'delete empty folder',
      'delete empty folders',
      'delete empty subdirectory',
      'delete empty subdirectories',
      'prune empty',
      'rmdir',
      'cleanup folders',
    ],
  };

  constructor(private readonly fs: WorkspaceFileSystem = workspaceFileSystem) {}

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const cwd = currentCwd(args.cwd);
    const path = cleanString(args.path, '.');
    const dryRun = boolArg(args.dry_run);
    const maxEntries = numberArg(args.max_entries, 200, 500);

    if (!dryRun && !boolArg(args.user_confirmed)) {
      return {
        type: 'error',
        summary: 'workspace_prune_empty_dirs needs user confirmation',
        errorMessage:
          'Set user_confirmed=true only after the user explicitly asks to delete/remove empty directories.',
      };
    }

    try {
      if (dryRun) {
        const entries = await this.fs.listEmptyDirectories(path, cwd, {
          maxEntries,
        });
        return {
          type: 'text',
          summary:
            entries.length > 0
              ? `workspace_prune_empty_dirs dry_run cwd=${cwd} path=${path}\nFound ${entries.length} empty director${entries.length === 1 ? 'y' : 'ies'}:\n${formatEntries(entries)}`
              : `workspace_prune_empty_dirs dry_run cwd=${cwd} path=${path}\nNo empty directories found.`,
        };
      }

      const result = await this.fs.deleteEmptyDirectories(path, cwd, {
        maxEntries,
      });
      return {
        type: 'text',
        summary:
          result.deleted.length > 0
            ? `workspace_prune_empty_dirs cwd=${cwd} path=${path}\nDeleted ${result.deleted.length} empty director${result.deleted.length === 1 ? 'y' : 'ies'}:\n${formatEntries(result.deleted)}`
            : `workspace_prune_empty_dirs cwd=${cwd} path=${path}\nNo empty directories found.`,
      };
    } catch (error) {
      return {
        type: 'error',
        summary: `workspace_prune_empty_dirs failed for ${path}`,
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
          'List or remove empty directories inside the app-contained LLMm workspace. If the user directly asks to remove/delete/prune empty directories, user_confirmed=true is allowed. Use dry_run=true only for list/check/find requests.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description:
                'Workspace directory to scan. Defaults to current cwd.',
            },
            cwd: {
              type: 'string',
              description:
                'Optional workspace cwd. Defaults to the current chat workspace directory.',
            },
            dry_run: {
              type: 'boolean',
              description:
                'When true, only list empty directories without deleting them.',
            },
            user_confirmed: {
              type: 'boolean',
              description:
                'Must be true to delete; direct user requests like "remove all empty folders" count as explicit confirmation.',
            },
            max_entries: {
              type: 'number',
              description: 'Maximum empty directories to list/remove, 1-500.',
            },
          },
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
