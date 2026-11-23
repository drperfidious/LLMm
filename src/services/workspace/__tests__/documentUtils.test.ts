import {
  formatBytes,
  formatDocumentForChat,
  isPdfWorkspacePath,
  isReadableWorkspacePath,
  isTextLikeWorkspacePath,
  languageForWorkspacePath,
  pathWithInferredTextExtension,
  sanitizeWorkspaceFileName,
} from '../documentUtils';

describe('workspace document utils', () => {
  it('detects text-like document paths', () => {
    expect(isTextLikeWorkspacePath('/documents/note.md')).toBe(true);
    expect(isTextLikeWorkspacePath('/documents/data.json')).toBe(true);
    expect(isTextLikeWorkspacePath('/documents/report.pdf')).toBe(false);
  });

  it('detects readable workspace document paths', () => {
    expect(isPdfWorkspacePath('/documents/report.pdf')).toBe(true);
    expect(isReadableWorkspacePath('/documents/report.pdf')).toBe(true);
    expect(isReadableWorkspacePath('/documents/note.md')).toBe(true);
    expect(isReadableWorkspacePath('/documents/archive.zip')).toBe(false);
  });

  it('maps common extensions to code fence languages', () => {
    expect(languageForWorkspacePath('/documents/note.md')).toBe('markdown');
    expect(languageForWorkspacePath('/documents/app.tsx')).toBe('typescript');
    expect(languageForWorkspacePath('/documents/plain')).toBe('text');
  });

  it('infers .md for extensionless markdown content', () => {
    expect(
      pathWithInferredTextExtension('docs/python-reference', '# Python'),
    ).toBe('docs/python-reference.md');
    expect(pathWithInferredTextExtension('docs/plain', 'hello world')).toBe(
      'docs/plain',
    );
    expect(pathWithInferredTextExtension('docs/readme.txt', '# Title')).toBe(
      'docs/readme.txt',
    );
  });

  it('sanitizes import filenames for workspace paths', () => {
    expect(sanitizeWorkspaceFileName('bad/name:here?.md')).toBe(
      'name-here-.md',
    );
    expect(sanitizeWorkspaceFileName('')).toBe('document.txt');
  });

  it('formats readable byte counts', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2 MB');
  });

  it('formats a document as chat context', () => {
    expect(
      formatDocumentForChat({
        path: '/documents/note.md',
        content: '# Hello',
      }),
    ).toContain('```markdown\n# Hello\n```');
  });

  it('labels PDFs as PDF document context', () => {
    expect(
      formatDocumentForChat({
        path: '/documents/report.pdf',
        content: 'PDF text',
      }),
    ).toContain('Workspace PDF document: /documents/report.pdf');
  });
});
