export {
  WorkspaceFileSystem,
  workspaceFileSystem,
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
  isTextLikeWorkspacePath,
  languageForWorkspacePath,
  sanitizeWorkspaceFileName,
} from './documentUtils';
