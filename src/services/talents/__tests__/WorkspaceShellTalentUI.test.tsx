import React from 'react';

import {fireEvent, render, waitFor} from '../../../../jest/test-utils';

import {workspaceFileSystem} from '../../workspace';
import {WorkspaceShellTalentUI} from '../WorkspaceShellTalentUI';

const Share = require('react-native-share').default;

describe('WorkspaceShellTalentUI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders exported file rows from workspace shell write output', async () => {
    jest.spyOn(workspaceFileSystem, 'resolve').mockReturnValue({
      relativePath: 'notes.md',
      absolutePath: '/tmp/notes.md',
    });
    const ui = new WorkspaceShellTalentUI();
    const node = ui.renderResult({
      type: 'text',
      summary:
        'workspace_shell cwd=/\ncommand: write notes.md hello\nMutation: yes\noutput:\nWrote 5 bytes to /notes.md',
    });

    const {getByTestId, getByText} = render(<>{node}</>);

    expect(getByTestId('workspace-shell-result')).toBeTruthy();
    expect(getByText('/notes.md')).toBeTruthy();
    fireEvent.press(getByTestId('workspace-export-/notes.md'));

    await waitFor(() => {
      expect(Share.open).toHaveBeenCalledWith(
        expect.objectContaining({url: 'file:///tmp/notes.md'}),
      );
    });
  });

  it('exports the target path from copy and move output', () => {
    const ui = new WorkspaceShellTalentUI();
    const node = ui.renderResult({
      type: 'text',
      summary:
        'workspace_shell cwd=/\ncommand: cp notes.md docs/notes.md\nMutation: yes\noutput:\nCopied /notes.md to /docs/notes.md',
    });

    const {getByTestId, getByText, queryByText} = render(<>{node}</>);

    expect(getByText('/docs/notes.md')).toBeTruthy();
    expect(queryByText('/notes.md')).toBeNull();
    expect(getByTestId('workspace-export-/docs/notes.md')).toBeTruthy();
  });

  it('renders nothing for non-mutating workspace shell output', () => {
    const ui = new WorkspaceShellTalentUI();
    const node = ui.renderResult({
      type: 'text',
      summary: 'workspace_shell cwd=/\ncommand: ls\noutput:\n(empty)',
    });

    const {queryByTestId} = render(<>{node}</>);

    expect(queryByTestId('workspace-shell-result')).toBeNull();
  });
});
