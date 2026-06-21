import React from 'react';
import {Alert} from 'react-native';
import {runInAction} from 'mobx';

import {
  render as baseRender,
  fireEvent,
  act,
} from '../../../../../../../jest/test-utils';
import {
  hfModel1,
  createModel,
  mockHFModel1,
  modelsList,
} from '../../../../../../../jest/fixtures/models';

import {ModelFileCard} from '../ModelFileCard';

import {downloadManager} from '../../../../../../services/downloads';

import {modelStore} from '../../../../../../store';

const render = (ui: React.ReactElement, options: any = {}) =>
  baseRender(ui, {withBottomSheetProvider: true, ...options});

describe('ModelFileCard', () => {
  const mockModelFile = {
    rfilename: 'test-model.gguf',
    size: 1000 * 1000 * 500, // 1GB
    oid: 'test-oid',
    canFitInStorage: true,
  };
  let downloadedHFModel;

  beforeEach(() => {
    downloadedHFModel = createModel({
      ...hfModel1,
      isDownloaded: true,
    });
    modelStore.models = modelsList;
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert');

    (downloadManager.isDownloading as jest.Mock).mockReset();
  });

  it('renders correctly with initial props', () => {
    const {getByTestId, getByText} = render(
      <ModelFileCard modelFile={mockModelFile} hfModel={mockHFModel1} />,
    );

    // Check that the card and file name are rendered using testIDs
    expect(getByTestId('model-file-card-test-model.gguf')).toBeDefined();
    expect(getByTestId('model-file-name-test-model.gguf')).toBeDefined();
    expect(getByText('500 MB')).toBeDefined();
  });

  it('handles bookmark toggle when not bookmarked', async () => {
    const {getByTestId} = render(
      <ModelFileCard modelFile={mockModelFile} hfModel={mockHFModel1} />,
    );

    await act(async () => {
      fireEvent.press(getByTestId('bookmark-button'));
    });

    expect(modelStore.addHFModel).toHaveBeenCalledWith(
      mockHFModel1,
      mockModelFile,
    );
  });

  it('shows alert when trying to remove downloaded model', async () => {
    modelStore.models = [downloadedHFModel];

    const {getByTestId} = render(
      <ModelFileCard
        modelFile={downloadedHFModel.hfModelFile!}
        hfModel={downloadedHFModel.hfModel!}
      />,
    );

    await act(async () => {
      fireEvent.press(getByTestId('bookmark-button'));
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Cannot Remove',
      'The model is downloaded. Please delete the file first.',
    );
  });

  it('handles download initiation', async () => {
    const {getByTestId} = render(
      <ModelFileCard
        modelFile={mockHFModel1.siblings[0]}
        hfModel={mockHFModel1}
      />,
    );

    await act(async () => {
      fireEvent.press(getByTestId('download-button'));
    });

    expect(modelStore.downloadHFModel).toHaveBeenCalledWith(
      mockHFModel1,
      mockHFModel1.siblings[0],
      {enableVision: true},
    );
  });

  it('handles download cancellation', async () => {
    modelStore.models = [{...hfModel1, isDownloading: true}];

    (downloadManager.isDownloading as jest.Mock).mockImplementation(modelId => {
      return modelId === hfModel1.id;
    });
    const {getByTestId} = render(
      <ModelFileCard
        modelFile={hfModel1.hfModelFile!}
        hfModel={hfModel1.hfModel!}
      />,
    );

    await act(async () => {
      fireEvent.press(getByTestId('cancel-button'));
    });

    expect(modelStore.cancelDownload).toHaveBeenCalledWith(hfModel1.id);
  });

  it('updates progress for a newly added downloading model without remounting', async () => {
    modelStore.models = modelStore.models.filter(
      model => model.id !== hfModel1.id,
    );

    const downloadingHFModel = createModel({
      ...hfModel1,
      isDownloaded: false,
      isDownloading: true,
      progress: 37,
      downloadSpeed: '185 MB (4.2 MB/s) ETA: 2 min',
    });

    const {getByTestId, getByText, rerender} = render(
      <ModelFileCard
        modelFile={mockHFModel1.siblings[0]}
        hfModel={mockHFModel1}
      />,
    );

    expect(getByTestId('download-button')).toBeTruthy();

    act(() => {
      runInAction(() => {
        modelStore.models = [...modelStore.models, downloadingHFModel];
        modelStore.downloadRevision += 1;
      });
    });

    rerender(
      <ModelFileCard
        modelFile={mockHFModel1.siblings[0]}
        hfModel={mockHFModel1}
      />,
    );

    expect(getByTestId('cancel-button')).toBeTruthy();
    expect(getByText(/4.2 MB\/s/)).toBeTruthy();
  });

  it('updates progress when an existing HF model enters downloading state', async () => {
    const {getByTestId, getByText, rerender} = render(
      <ModelFileCard
        modelFile={mockHFModel1.siblings[0]}
        hfModel={mockHFModel1}
      />,
    );

    expect(getByTestId('download-button')).toBeTruthy();

    act(() => {
      runInAction(() => {
        const existingModel = modelStore.models.find(
          model => model.id === hfModel1.id,
        );
        if (existingModel) {
          existingModel.isDownloaded = false;
          existingModel.isDownloading = true;
          existingModel.progress = 51;
          existingModel.downloadSpeed = '260 MB (5.1 MB/s) ETA: 1 min';
        }
        modelStore.downloadRevision += 1;
      });
    });

    rerender(
      <ModelFileCard
        modelFile={mockHFModel1.siblings[0]}
        hfModel={mockHFModel1}
      />,
    );

    expect(getByTestId('cancel-button')).toBeTruthy();
    expect(getByText(/5.1 MB\/s/)).toBeTruthy();
  });

  it('disables download button when storage is insufficient', () => {
    const insufficientStorageFile = {
      ...mockModelFile,
      canFitInStorage: false,
    };

    const {getByTestId} = render(
      <ModelFileCard
        modelFile={insufficientStorageFile}
        hfModel={mockHFModel1}
      />,
    );

    expect(
      getByTestId('download-button').props.accessibilityState.disabled,
    ).toBe(true);
  });

  it('shows delete confirmation for downloaded model', async () => {
    modelStore.models = [downloadedHFModel];

    const {getByTestId} = render(
      <ModelFileCard
        modelFile={downloadedHFModel.hfModelFile!}
        hfModel={downloadedHFModel.hfModel!}
      />,
    );

    await act(async () => {
      fireEvent.press(getByTestId('download-button'));
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Delete Model',
      'Are you sure you want to delete this downloaded model?',
      expect.any(Array),
    );
  });
});
