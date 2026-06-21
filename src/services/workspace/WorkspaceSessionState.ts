import {displayWorkspacePath, resolveWorkspacePath} from './pathUtils';

class WorkspaceSessionState {
  private _cwd = '/';

  get cwd(): string {
    return this._cwd;
  }

  setCwd(path: string): string {
    const next = displayWorkspacePath(resolveWorkspacePath(path || '/'));
    this._cwd = next;
    return next;
  }
}

export const workspaceSessionState = new WorkspaceSessionState();
