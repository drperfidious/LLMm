import * as RNFS from '@dr.pogodin/react-native-fs';

import {WorkspaceFileSystem} from '../WorkspaceFileSystem';
import {extractPdfText} from '../PdfTextExtractor';

jest.mock('../PdfTextExtractor', () => ({
  extractPdfText: jest.fn(),
}));

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

  it('lists prunable empty directories from deepest to shallowest', async () => {
    const fs = new WorkspaceFileSystem('/app/Documents/llmm-workspace');
    asMock(RNFS.readDir).mockImplementation(async (path: string) => {
      if (path.endsWith('/empty/nested')) {
        return [];
      }
      if (path.endsWith('/empty')) {
        return [
          {
            name: 'nested',
            path: '/app/Documents/llmm-workspace/empty/nested',
            size: 0,
            isDirectory: () => true,
          },
        ];
      }
      if (path.endsWith('/docs')) {
        return [
          {
            name: 'note.md',
            path: '/app/Documents/llmm-workspace/docs/note.md',
            size: 12,
            isDirectory: () => false,
          },
        ];
      }
      return [
        {
          name: 'empty',
          path: '/app/Documents/llmm-workspace/empty',
          size: 0,
          isDirectory: () => true,
        },
        {
          name: 'docs',
          path: '/app/Documents/llmm-workspace/docs',
          size: 0,
          isDirectory: () => true,
        },
      ];
    });

    await expect(fs.listEmptyDirectories()).resolves.toEqual([
      expect.objectContaining({path: '/empty/nested', type: 'directory'}),
      expect.objectContaining({path: '/empty', type: 'directory'}),
    ]);
  });

  it('deletes only empty directories selected by the prune scan', async () => {
    const fs = new WorkspaceFileSystem('/app/Documents/llmm-workspace');
    asMock(RNFS.readDir).mockImplementation(async (path: string) => {
      if (path.endsWith('/empty/nested')) {
        return [];
      }
      if (path.endsWith('/empty')) {
        return [
          {
            name: 'nested',
            path: '/app/Documents/llmm-workspace/empty/nested',
            size: 0,
            isDirectory: () => true,
          },
        ];
      }
      return [
        {
          name: 'empty',
          path: '/app/Documents/llmm-workspace/empty',
          size: 0,
          isDirectory: () => true,
        },
      ];
    });
    asMock(RNFS.stat).mockResolvedValue({
      size: 0,
      isDirectory: () => true,
    });

    const result = await fs.deleteEmptyDirectories();

    expect(result.deleted.map(entry => entry.path)).toEqual([
      '/empty/nested',
      '/empty',
    ]);
    expect(RNFS.unlink).toHaveBeenCalledWith(
      '/app/Documents/llmm-workspace/empty/nested',
    );
    expect(RNFS.unlink).toHaveBeenCalledWith(
      '/app/Documents/llmm-workspace/empty',
    );
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

  it('extracts PDF text through the native PDF extractor', async () => {
    const fs = new WorkspaceFileSystem('/app/Documents/llmm-workspace');
    asMock(RNFS.stat).mockResolvedValue({
      size: 48 * 1024,
      isDirectory: () => false,
    });
    asMock(extractPdfText).mockResolvedValue({
      text: 'Page 1:\nReport text',
      pageCount: 2,
      truncated: false,
    });

    const result = await fs.readFile('/docs/report.pdf', '/', 256 * 1024);

    expect(extractPdfText).toHaveBeenCalledWith(
      '/app/Documents/llmm-workspace/docs/report.pdf',
      256 * 1024,
    );
    expect(result.content).toContain('PDF pages: 2');
    expect(result.content).toContain('Report text');
    expect(result.size).toBe(48 * 1024);
  });
});
