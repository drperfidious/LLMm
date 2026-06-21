import * as RNFS from '@dr.pogodin/react-native-fs';

import {WorkspaceFileSystem} from '../WorkspaceFileSystem';

const asMock = <T extends (...args: any[]) => any>(fn: T) =>
  fn as unknown as jest.Mock;

describe('WorkspaceFileSystem', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('copies imported files into the app-contained workspace', async () => {
    const fs = new WorkspaceFileSystem('/app/Documents/llmm-workspace');
    asMock(RNFS.exists).mockResolvedValue(false);
    asMock(RNFS.stat).mockResolvedValue({
      size: 42,
      isDirectory: () => false,
    });

    const result = await fs.importFile(
      'file:///private/tmp/My%20Doc.md',
      'docs/My Doc.md',
    );

    expect(RNFS.mkdir).toHaveBeenCalledWith(
      '/app/Documents/llmm-workspace/docs',
      {NSURLIsExcludedFromBackupKey: false},
    );
    expect(RNFS.copyFile).toHaveBeenCalledWith(
      '/private/tmp/My Doc.md',
      '/app/Documents/llmm-workspace/docs/My Doc.md',
    );
    expect(result).toEqual({
      path: '/docs/My Doc.md',
      sourceUri: 'file:///private/tmp/My%20Doc.md',
      size: 42,
    });
  });

  it('does not overwrite imported files unless explicitly requested', async () => {
    const fs = new WorkspaceFileSystem('/app/Documents/llmm-workspace');
    asMock(RNFS.exists).mockResolvedValue(true);

    await expect(
      fs.importFile('/private/tmp/My Doc.md', 'docs/My Doc.md'),
    ).rejects.toThrow(/already exists/i);
    expect(RNFS.copyFile).not.toHaveBeenCalled();
  });

  it('lists workspace files recursively with display paths', async () => {
    const fs = new WorkspaceFileSystem('/app/Documents/llmm-workspace');
    asMock(RNFS.readDir).mockImplementation(async (path: string) => {
      if (path.endsWith('/docs')) {
        return [
          {
            name: 'note.md',
            path: '/app/Documents/llmm-workspace/docs/note.md',
            size: 12,
            mtime: new Date('2026-06-21T12:00:00Z'),
            isDirectory: () => false,
          },
        ];
      }
      return [
        {
          name: 'docs',
          path: '/app/Documents/llmm-workspace/docs',
          size: 0,
          isDirectory: () => true,
        },
        {
          name: 'root.txt',
          path: '/app/Documents/llmm-workspace/root.txt',
          size: 8,
          mtime: new Date('2026-06-21T11:00:00Z'),
          isDirectory: () => false,
        },
      ];
    });

    const result = await fs.listFiles();

    expect(result.map(entry => entry.path)).toEqual([
      '/docs/note.md',
      '/root.txt',
    ]);
  });

  it('deletes non-root workspace paths only', async () => {
    const fs = new WorkspaceFileSystem('/app/Documents/llmm-workspace');
    asMock(RNFS.stat).mockResolvedValue({
      isDirectory: () => false,
    });

    await expect(fs.deletePath('/')).rejects.toThrow(/workspace root/i);
    const result = await fs.deletePath('/docs/note.md');

    expect(RNFS.unlink).toHaveBeenCalledWith(
      '/app/Documents/llmm-workspace/docs/note.md',
    );
    expect(result).toEqual({path: '/docs/note.md', type: 'file'});
  });

  it('returns an available display path without overwriting', async () => {
    const fs = new WorkspaceFileSystem('/app/Documents/llmm-workspace');
    asMock(RNFS.exists)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(fs.getAvailablePath('docs/note.md')).resolves.toBe(
      '/docs/note (2).md',
    );
  });

  it('checks whether a workspace path exists relative to cwd', async () => {
    const fs = new WorkspaceFileSystem('/app/Documents/llmm-workspace');
    asMock(RNFS.exists).mockResolvedValueOnce(true);

    await expect(fs.exists('note.md', '/docs')).resolves.toBe(true);
    expect(RNFS.exists).toHaveBeenCalledWith(
      '/app/Documents/llmm-workspace/docs/note.md',
    );
  });
});
