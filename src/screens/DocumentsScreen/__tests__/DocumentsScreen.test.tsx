import React from 'react';
import * as RNFS from '@dr.pogodin/react-native-fs';
import Clipboard from '@react-native-clipboard/clipboard';

import {fireEvent, render, waitFor} from '../../../../jest/test-utils';
import {chatSessionStore} from '../../../store';
import {DocumentsScreen} from '../DocumentsScreen';

const mockNavigate = jest.fn();

jest.mock('@react-native-clipboard/clipboard', () => ({
  setString: jest.fn(),
}));

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const ReactActual = jest.requireActual('react');
  return {
    ...actual,
    useNavigation: () => ({navigate: mockNavigate}),
    useFocusEffect: (callback: () => void | (() => void)) => {
      ReactActual.useEffect(() => callback(), [callback]);
    },
  };
});

const asMock = <T extends (...args: any[]) => any>(fn: T) =>
  fn as unknown as jest.Mock;

describe('DocumentsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    asMock(RNFS.readDir).mockResolvedValue([
      {
        name: 'note.md',
        path: '/path/to/documents/llmm-workspace/documents/note.md',
        size: 24,
        mtime: new Date('2026-06-21T12:00:00Z'),
        isDirectory: () => false,
      },
    ]);
    asMock(RNFS.stat).mockResolvedValue({
      size: 24,
      isDirectory: () => false,
    });
    asMock(RNFS.readFile).mockResolvedValue('# Hello\n\nWorkspace note.');
    jest
      .spyOn(chatSessionStore, 'addMessageToCurrentSession')
      .mockResolvedValue(undefined);
  });

  it('previews markdown and clones it into the active chat', async () => {
    const {getByTestId, getByText} = render(<DocumentsScreen />);

    await waitFor(() => {
      expect(getByTestId('documents-row-/note.md')).toBeTruthy();
    });

    fireEvent.press(getByTestId('documents-row-/note.md'));

    await waitFor(() => {
      expect(getByText('Clone to chat')).toBeTruthy();
    });
    fireEvent.press(getByText('Clone to chat'));

    await waitFor(() => {
      expect(chatSessionStore.addMessageToCurrentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('Workspace document: /note.md'),
        }),
      );
      expect(mockNavigate).toHaveBeenCalledWith('Chat');
    });
  });

  it('copies preview text from the document reader', async () => {
    const {getByTestId, getByText} = render(<DocumentsScreen />);

    await waitFor(() => {
      expect(getByTestId('documents-row-/note.md')).toBeTruthy();
    });

    fireEvent.press(getByTestId('documents-row-/note.md'));

    await waitFor(() => {
      expect(RNFS.readFile).toHaveBeenCalledWith(
        '/path/to/documents/llmm-workspace/note.md',
        'utf8',
      );
    });
    fireEvent.press(getByTestId('documents-copy'));

    await waitFor(() => {
      expect(Clipboard.setString).toHaveBeenCalledWith(
        '# Hello\n\nWorkspace note.',
      );
    });
  });

  it('creates folders from the document folder manager', async () => {
    const {getByTestId, getByText} = render(<DocumentsScreen />);

    await waitFor(() => {
      expect(getByTestId('documents-row-/note.md')).toBeTruthy();
    });

    fireEvent.press(getByText('Manage folders'));
    await waitFor(() => {
      expect(getByTestId('documents-dir-manager')).toBeTruthy();
    });

    fireEvent.changeText(getByTestId('documents-folder-path'), 'projects/app');
    fireEvent.press(getByTestId('documents-create-folder'));

    await waitFor(() => {
      expect(RNFS.mkdir).toHaveBeenCalledWith(
        '/path/to/documents/llmm-workspace/projects/app',
        {NSURLIsExcludedFromBackupKey: false},
      );
    });
  });
});
