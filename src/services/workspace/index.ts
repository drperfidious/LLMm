export {
  WorkspaceFileSystem,
  workspaceFileSystem,
  type WorkspaceDirectoryCleanupResult,
  type WorkspaceDeleteResult,
  type WorkspaceEntry,
  type WorkspaceImportResult,
  type WorkspaceReadResult,
  type WorkspaceSearchMatch,
} from './WorkspaceFileSystem';
export {
  WorkspaceShell,
  workspaceShell,
  type WorkspaceShellResult,
} from './WorkspaceShell';
export {workspaceSessionState} from './WorkspaceSessionState';
export {
  WORKSPACE_ROOT_DIR,
  dirname,
  displayWorkspacePath,
  normalizeWorkspacePath,
  resolveWorkspacePath,
} from './pathUtils';
export {
  extensionForPath,
  formatBytes,
  formatDocumentForChat,
  isPdfWorkspacePath,
  isReadableWorkspacePath,
  isTextLikeWorkspacePath,
  languageForWorkspacePath,
  sanitizeWorkspaceFileName,
} from './documentUtils';
export {extractPdfText, type PdfTextExtractionResult} from './PdfTextExtractor';
