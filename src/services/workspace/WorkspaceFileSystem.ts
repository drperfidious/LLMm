import * as RNFS from '@dr.pogodin/react-native-fs';

import {
  WORKSPACE_ROOT_DIR,
  dirname,
  displayWorkspacePath,
  normalizeWorkspacePath,
  resolveWorkspacePath,
} from './pathUtils';

const DEFAULT_MAX_READ_BYTES = 96 * 1024;
const DEFAULT_MAX_WRITE_BYTES = 512 * 1024;
const DEFAULT_MAX_SEARCH_BYTES = 256 * 1024;
const DEFAULT_MAX_SEARCH_RESULTS = 40;

export type WorkspaceEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt?: string;
};

export type WorkspaceReadResult = {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
};

export type WorkspaceSearchMatch = {
  path: string;
  line: number;
  text: string;
};

export type WorkspaceImportResult = {
  path: string;
  sourceUri: string;
  size: number;
};

export type WorkspaceDeleteResult = {
  path: string;
  type: 'file' | 'directory';
};

export type WorkspaceStatResult = {
  path: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt?: string;
};

export type WorkspaceCopyResult = {
  sourcePath: string;
  path: string;
  size: number;
};

function byteLength(text: string): number {
  const Encoder = (globalThis as any).TextEncoder;
  if (typeof Encoder === 'function') {
    return new Encoder().encode(text).length;
  }
  return unescape(encodeURIComponent(text)).length;
}

function toIso(value: Date | null | undefined): string | undefined {
  return value instanceof Date ? value.toISOString() : undefined;
}

function normalizeSourceUri(uri: string): string {
  const trimmed = uri.trim();
  if (!trimmed) {
    throw new Error('Import source URI cannot be empty');
  }
  return trimmed.startsWith('file://')
    ? decodeURIComponent(trimmed.slice('file://'.length))
    : trimmed;
}

function basename(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

export class WorkspaceFileSystem {
  readonly rootPath: string;

  constructor(
    rootPath = `${RNFS.DocumentDirectoryPath}/${WORKSPACE_ROOT_DIR}`,
  ) {
    this.rootPath = rootPath.replace(/\/+$/, '');
  }

  async ensureRoot(): Promise<void> {
    await RNFS.mkdir(this.rootPath, {NSURLIsExcludedFromBackupKey: false});
  }

  resolve(path = '', cwd = ''): {relativePath: string; absolutePath: string} {
    const relativePath = resolveWorkspacePath(path, cwd);
    return {
      relativePath,
      absolutePath: relativePath
        ? `${this.rootPath}/${relativePath}`
        : this.rootPath,
    };
  }

  private async ensureParent(relativePath: string): Promise<void> {
    const parent = dirname(relativePath);
    if (parent) {
      await RNFS.mkdir(`${this.rootPath}/${parent}`, {
        NSURLIsExcludedFromBackupKey: false,
      });
    } else {
      await this.ensureRoot();
    }
  }

  async list(path = '', cwd = ''): Promise<WorkspaceEntry[]> {
    await this.ensureRoot();
    const {relativePath, absolutePath} = this.resolve(path, cwd);
    const entries = await RNFS.readDir(absolutePath);
    return entries
      .map(entry => ({
        name: entry.name,
        path: displayWorkspacePath(
          normalizeWorkspacePath(
            [relativePath, entry.name].filter(Boolean).join('/'),
          ),
        ),
        type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
        size: entry.size ?? 0,
        modifiedAt: toIso(entry.mtime),
      }))
      .sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
  }

  async listFiles(
    path = '',
    cwd = '',
    options: {maxEntries?: number} = {},
  ): Promise<WorkspaceEntry[]> {
    const maxEntries = options.maxEntries ?? 500;
    await this.ensureRoot();
    const {relativePath, absolutePath} = this.resolve(path, cwd);
    const files: WorkspaceEntry[] = [];

    const visit = async (abs: string, rel: string): Promise<void> => {
      if (files.length >= maxEntries) {
        return;
      }
      const entries = await RNFS.readDir(abs);
      for (const entry of entries) {
        if (files.length >= maxEntries) {
          break;
        }
        const entryRel = normalizeWorkspacePath(
          [rel, entry.name].filter(Boolean).join('/'),
        );
        if (entry.isDirectory()) {
          await visit(entry.path, entryRel);
          continue;
        }
        files.push({
          name: entry.name,
          path: displayWorkspacePath(entryRel),
          type: 'file',
          size: entry.size ?? 0,
          modifiedAt: toIso(entry.mtime),
        });
      }
    };

    await visit(absolutePath, relativePath);
    return files.sort((a, b) => {
      const aTime = a.modifiedAt ? new Date(a.modifiedAt).getTime() : 0;
      const bTime = b.modifiedAt ? new Date(b.modifiedAt).getTime() : 0;
      if (aTime !== bTime) {
        return bTime - aTime;
      }
      return a.path.localeCompare(b.path);
    });
  }

  async assertDirectory(path = '', cwd = ''): Promise<string> {
    await this.ensureRoot();
    const {relativePath, absolutePath} = this.resolve(path, cwd);
    const stat = await RNFS.stat(absolutePath);
    if (!stat.isDirectory()) {
      throw new Error(
        `${displayWorkspacePath(relativePath)} is not a directory`,
      );
    }
    return displayWorkspacePath(relativePath);
  }

  async statPath(path = '', cwd = ''): Promise<WorkspaceStatResult> {
    await this.ensureRoot();
    const {relativePath, absolutePath} = this.resolve(path, cwd);
    const stat = await RNFS.stat(absolutePath);
    return {
      path: displayWorkspacePath(relativePath),
      type: stat.isDirectory() ? 'directory' : 'file',
      size: stat.size ?? 0,
      modifiedAt: toIso(stat.mtime),
    };
  }

  async readFile(
    path: string,
    cwd = '',
    maxBytes = DEFAULT_MAX_READ_BYTES,
  ): Promise<WorkspaceReadResult> {
    await this.ensureRoot();
    const {relativePath, absolutePath} = this.resolve(path, cwd);
    if (!relativePath) {
      throw new Error('Cannot read workspace root as a file');
    }
    const stat = await RNFS.stat(absolutePath);
    if (stat.isDirectory()) {
      throw new Error(`${displayWorkspacePath(relativePath)} is a directory`);
    }
    if (stat.size > maxBytes) {
      throw new Error(
        `${displayWorkspacePath(relativePath)} is ${stat.size} bytes; max read is ${maxBytes} bytes`,
      );
    }
    const content = await RNFS.readFile(absolutePath, 'utf8');
    return {
      path: displayWorkspacePath(relativePath),
      content,
      size: stat.size,
      truncated: false,
    };
  }

  async exists(path: string, cwd = ''): Promise<boolean> {
    await this.ensureRoot();
    const {absolutePath} = this.resolve(path, cwd);
    return RNFS.exists(absolutePath);
  }

  async writeFile(
    path: string,
    content: string,
    options: {cwd?: string; append?: boolean; maxBytes?: number} = {},
  ): Promise<WorkspaceReadResult> {
    const cwd = options.cwd ?? '';
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_WRITE_BYTES;
    const {relativePath, absolutePath} = this.resolve(path, cwd);
    if (!relativePath) {
      throw new Error('Cannot write workspace root as a file');
    }
    if (byteLength(content) > maxBytes) {
      throw new Error(`Write is too large; max write is ${maxBytes} bytes`);
    }
    await this.ensureParent(relativePath);

    let nextContent = content;
    if (options.append) {
      const exists = await RNFS.exists(absolutePath);
      const previous = exists ? await RNFS.readFile(absolutePath, 'utf8') : '';
      nextContent = previous ? `${previous}${content}` : content;
      if (byteLength(nextContent) > maxBytes) {
        throw new Error(`Appended file would exceed ${maxBytes} bytes`);
      }
    }

    await RNFS.writeFile(absolutePath, nextContent, 'utf8');
    return {
      path: displayWorkspacePath(relativePath),
      content: nextContent,
      size: byteLength(nextContent),
      truncated: false,
    };
  }

  async mkdir(path: string, cwd = ''): Promise<string> {
    const {relativePath, absolutePath} = this.resolve(path, cwd);
    if (!relativePath) {
      await this.ensureRoot();
      return displayWorkspacePath(relativePath);
    }
    await RNFS.mkdir(absolutePath, {NSURLIsExcludedFromBackupKey: false});
    return displayWorkspacePath(relativePath);
  }

  async touchFile(path: string, cwd = ''): Promise<WorkspaceStatResult> {
    await this.ensureRoot();
    const {relativePath, absolutePath} = this.resolve(path, cwd);
    if (!relativePath) {
      throw new Error('Cannot touch the workspace root');
    }
    const exists = await RNFS.exists(absolutePath);
    if (exists) {
      const stat = await RNFS.stat(absolutePath);
      if (stat.isDirectory()) {
        throw new Error(`${displayWorkspacePath(relativePath)} is a directory`);
      }
      return {
        path: displayWorkspacePath(relativePath),
        type: 'file',
        size: stat.size ?? 0,
        modifiedAt: toIso(stat.mtime),
      };
    }

    await this.ensureParent(relativePath);
    await RNFS.writeFile(absolutePath, '', 'utf8');
    return {
      path: displayWorkspacePath(relativePath),
      type: 'file',
      size: 0,
    };
  }

  async copyPath(
    sourcePath: string,
    targetPath: string,
    options: {cwd?: string; overwrite?: boolean} = {},
  ): Promise<WorkspaceCopyResult> {
    const cwd = options.cwd ?? '';
    await this.ensureRoot();
    const source = this.resolve(sourcePath, cwd);
    if (!source.relativePath) {
      throw new Error('Cannot copy the workspace root');
    }
    const sourceStat = await RNFS.stat(source.absolutePath);
    if (sourceStat.isDirectory()) {
      throw new Error(
        `${displayWorkspacePath(source.relativePath)} is a directory; only file copy is supported`,
      );
    }

    let target = this.resolve(targetPath, cwd);
    const targetExists = await RNFS.exists(target.absolutePath);
    if (targetExists) {
      const targetStat = await RNFS.stat(target.absolutePath);
      if (targetStat.isDirectory()) {
        const sourceName = basename(source.relativePath);
        target = this.resolve(`${target.relativePath}/${sourceName}`);
      } else if (!options.overwrite) {
        throw new Error(
          `${displayWorkspacePath(target.relativePath)} already exists`,
        );
      }
    }
    if (!target.relativePath) {
      throw new Error('Copy target must be a file path inside the workspace');
    }
    if (source.absolutePath === target.absolutePath) {
      throw new Error('Source and target paths are the same');
    }

    const finalExists = await RNFS.exists(target.absolutePath);
    if (finalExists && !options.overwrite) {
      throw new Error(
        `${displayWorkspacePath(target.relativePath)} already exists`,
      );
    }
    if (finalExists && options.overwrite) {
      await RNFS.unlink(target.absolutePath);
    }

    await this.ensureParent(target.relativePath);
    await RNFS.copyFile(source.absolutePath, target.absolutePath);
    const copiedStat = await RNFS.stat(target.absolutePath);
    return {
      sourcePath: displayWorkspacePath(source.relativePath),
      path: displayWorkspacePath(target.relativePath),
      size: copiedStat.size ?? sourceStat.size ?? 0,
    };
  }

  async movePath(
    sourcePath: string,
    targetPath: string,
    options: {cwd?: string; overwrite?: boolean} = {},
  ): Promise<WorkspaceCopyResult> {
    const result = await this.copyPath(sourcePath, targetPath, options);
    const {absolutePath} = this.resolve(sourcePath, options.cwd ?? '');
    await RNFS.unlink(absolutePath);
    return result;
  }

  async importFile(
    sourceUri: string,
    targetPath: string,
    options: {cwd?: string; overwrite?: boolean} = {},
  ): Promise<WorkspaceImportResult> {
    const cwd = options.cwd ?? '';
    const sourcePath = normalizeSourceUri(sourceUri);
    const {relativePath, absolutePath} = this.resolve(targetPath, cwd);
    if (!relativePath) {
      throw new Error('Import target must be a file path inside the workspace');
    }
    await this.ensureParent(relativePath);

    const exists = await RNFS.exists(absolutePath);
    if (exists && !options.overwrite) {
      throw new Error(`${displayWorkspacePath(relativePath)} already exists`);
    }

    await RNFS.copyFile(sourcePath, absolutePath);
    const stat = await RNFS.stat(absolutePath);
    return {
      path: displayWorkspacePath(relativePath),
      sourceUri,
      size: stat.size ?? 0,
    };
  }

  async deletePath(path: string, cwd = ''): Promise<WorkspaceDeleteResult> {
    await this.ensureRoot();
    const {relativePath, absolutePath} = this.resolve(path, cwd);
    if (!relativePath) {
      throw new Error('Cannot delete the workspace root');
    }

    const stat = await RNFS.stat(absolutePath);
    await RNFS.unlink(absolutePath);
    return {
      path: displayWorkspacePath(relativePath),
      type: stat.isDirectory() ? 'directory' : 'file',
    };
  }

  async getAvailablePath(
    preferredPath: string,
    cwd = '',
    options: {maxAttempts?: number} = {},
  ): Promise<string> {
    const maxAttempts = options.maxAttempts ?? 100;
    const {relativePath} = this.resolve(preferredPath, cwd);
    if (!relativePath) {
      throw new Error('Path must point to a file inside the workspace');
    }

    const slashIndex = relativePath.lastIndexOf('/');
    const parent = slashIndex >= 0 ? relativePath.slice(0, slashIndex + 1) : '';
    const filename =
      slashIndex >= 0 ? relativePath.slice(slashIndex + 1) : relativePath;
    const dotIndex = filename.lastIndexOf('.');
    const hasExtension = dotIndex > 0;
    const stem = hasExtension ? filename.slice(0, dotIndex) : filename;
    const ext = hasExtension ? filename.slice(dotIndex) : '';

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const candidate =
        attempt === 0
          ? `${parent}${filename}`
          : `${parent}${stem} (${attempt + 1})${ext}`;
      const exists = await RNFS.exists(`${this.rootPath}/${candidate}`);
      if (!exists) {
        return displayWorkspacePath(candidate);
      }
    }

    throw new Error(`Could not find an available name for ${preferredPath}`);
  }

  async search(
    pattern: string,
    path = '',
    cwd = '',
    options: {
      caseSensitive?: boolean;
      maxResults?: number;
      maxFileBytes?: number;
    } = {},
  ): Promise<WorkspaceSearchMatch[]> {
    const query = pattern.trim();
    if (!query) {
      throw new Error('Search pattern cannot be empty');
    }

    const maxResults = options.maxResults ?? DEFAULT_MAX_SEARCH_RESULTS;
    const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_SEARCH_BYTES;
    const needle = options.caseSensitive ? query : query.toLowerCase();
    const {relativePath, absolutePath} = this.resolve(path, cwd);
    const matches: WorkspaceSearchMatch[] = [];

    const visit = async (abs: string, rel: string): Promise<void> => {
      if (matches.length >= maxResults) {
        return;
      }
      const stat = await RNFS.stat(abs);
      if (stat.isDirectory()) {
        const entries = await RNFS.readDir(abs);
        for (const entry of entries) {
          await visit(
            entry.path,
            normalizeWorkspacePath([rel, entry.name].filter(Boolean).join('/')),
          );
          if (matches.length >= maxResults) {
            break;
          }
        }
        return;
      }
      if (stat.size > maxFileBytes) {
        return;
      }
      const content = await RNFS.readFile(abs, 'utf8');
      const lines = content.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (matches.length >= maxResults) {
          return;
        }
        const haystack = options.caseSensitive ? line : line.toLowerCase();
        if (haystack.includes(needle)) {
          matches.push({
            path: displayWorkspacePath(rel),
            line: index + 1,
            text: line.slice(0, 500),
          });
        }
      });
    };

    await this.ensureRoot();
    await visit(absolutePath, relativePath);
    return matches;
  }
}

export const workspaceFileSystem = new WorkspaceFileSystem();
