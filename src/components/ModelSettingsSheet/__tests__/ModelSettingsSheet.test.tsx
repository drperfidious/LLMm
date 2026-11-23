import React from 'react';
import {fireEvent, render, act} from '../../../../jest/test-utils';
import {ModelSettingsSheet} from '../ModelSettingsSheet';
import {modelStore} from '../../../store';
import {Model, ModelOrigin} from '../../../utils/types';
import {defaultCompletionParams} from '../../../utils/completionSettingsVersions';

// Mock the ModelSettings component
jest.mock('../../../screens/ModelsScreen/ModelSettings', () => {
  const {View} = require('react-native');
  return {
    ModelSettings: ({onChange, onStopWordsChange, onModelNameChange}) => (
      <View testID="model-settings">
        <View
          testID="mock-settings-update"
          onPress={() => onChange('chatTemplate', 'new template')}
        />
        <View
          testID="mock-stop-words-update"
          onPress={() => onStopWordsChange(['stop1', 'stop2'])}
        />
        <View
          testID="mock-model-name-update"
          onPress={() => onModelNameChange('new model name')}
        />
      </View>
    ),
  };
});

// Mock Sheet component
jest.mock('../../../components/Sheet', () => {
  const {View, Button} = require('react-native');
  const MockSheet = ({children, isVisible, onClose, title}) => {
    if (!isVisible) {
      return null;
    }
    return (
      <View testID="sheet">
        <View testID="sheet-title">{title}</View>
        <Button title="Close" onPress={onClose} testID="sheet-close-button" />
        {children}
      </View>
    );
  };
  MockSheet.ScrollView = ({children}) => (
    <View testID="sheet-scroll-view">{children}</View>
  );
  MockSheet.Actions = ({children}) => (
    <View testID="sheet-actions">{children}</View>
  );
  return {Sheet: MockSheet};
});

describe('ModelSettingsSheet', () => {
  const defaultTemplate = {
    name: 'custom',
    addGenerationPrompt: true,
    bosToken: '<|START|>',
    eosToken: '<|END|>',
    chatTemplate: 'User: {{prompt}}\nAssistant:',
    systemPrompt: 'You are a helpful assistant',
    addBosToken: true,
    addEosToken: true,
  };

  const mockModel: Model = {
    id: 'test-model',
    author: 'test-author',
    name: 'Test Model',
    size: 1000,
    params: 1000000,
    isDownloaded: true,
    downloadUrl: 'https://example.com/model',
    hfUrl: 'https://huggingface.co/test-model',
    progress: 100,
    filename: 'test-model.bin',
    isLocal: false,
    origin: ModelOrigin.PRESET,
    defaultChatTemplate: defaultTemplate,
    chatTemplate: defaultTemplate,
    defaultStopWords: ['test'],
    stopWords: ['test'],
    defaultCompletionSettings: defaultCompletionParams,
    completionSettings: defaultCompletionParams,
  };

  const defaultProps = {
    isVisible: true,
    onClose: jest.fn(),
    model: mockModel,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    modelStore.contextInitParams = {
      ...modelStore.contextInitParams,
      n_ctx: 2048,
      n_batch: 512,
      n_ubatch: 512,
      n_threads: 4,
      n_gpu_layers: 99,
      image_max_tokens: 512,
      flash_attn_type: 'auto',
      cache_type_k: 'f16',
      cache_type_v: 'f16',
      use_mmap: 'true',
      use_mlock: false,
      kv_unified: true,
    };
    modelStore.allowUnsafeContextLimits = false;
    modelStore.requestedContextSize = undefined;
    modelStore.modelInitProfiles = {};
    modelStore.models = [mockModel];
    modelStore.activeModelId = undefined;
  });

  it('renders correctly when visible', () => {
    const {getByTestId} = render(<ModelSettingsSheet {...defaultProps} />);

    expect(getByTestId('sheet')).toBeTruthy();
    expect(getByTestId('model-settings')).toBeTruthy();
    expect(getByTestId('sheet-title')).toBeTruthy();
  });

  it('does not render when not visible', () => {
    const {queryByTestId} = render(
      <ModelSettingsSheet {...defaultProps} isVisible={false} />,
    );

    expect(queryByTestId('sheet')).toBeNull();
  });

  it('returns null when no model is provided', () => {
    const {queryByTestId} = render(
      <ModelSettingsSheet {...defaultProps} model={undefined} />,
    );

    expect(queryByTestId('sheet')).toBeNull();
  });

  it('handles save settings correctly', async () => {
    const {getByText} = render(<ModelSettingsSheet {...defaultProps} />);

    await act(async () => {
      fireEvent.press(getByText('Save Changes'));
    });

    expect(modelStore.updateModelChatTemplate).toHaveBeenCalledWith(
      mockModel.id,
      mockModel.chatTemplate,
    );
    expect(modelStore.updateModelStopWords).toHaveBeenCalledWith(
      mockModel.id,
      mockModel.stopWords,
    );
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('handles cancel correctly', async () => {
    const {getByText} = render(<ModelSettingsSheet {...defaultProps} />);

    await act(async () => {
      fireEvent.press(getByText('Cancel'));
    });

    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('handles reset correctly', async () => {
    const {getByText} = render(<ModelSettingsSheet {...defaultProps} />);

    await act(async () => {
      fireEvent.press(getByText('Reset'));
    });

    expect(modelStore.resetModelChatTemplate).toHaveBeenCalledWith(
      mockModel.id,
    );
    expect(modelStore.resetModelStopWords).toHaveBeenCalledWith(mockModel.id);
    expect(modelStore.clearModelInitProfile).toHaveBeenCalledWith(mockModel.id);
  });

  it('handles reset model name correctly', async () => {
    const {getByText} = render(<ModelSettingsSheet {...defaultProps} />);

    await act(async () => {
      fireEvent.press(getByText('Reset'));
    });

    expect(modelStore.resetModelName).toHaveBeenCalledWith(mockModel.id);
  });

  it('handles model name change correctly for local models', async () => {
    // Use a local model (not preset) to allow name changes
    const localModel: Model = {
      ...mockModel,
      id: 'local-model',
      origin: ModelOrigin.LOCAL,
    };

    const {getByTestId, getByText} = render(
      <ModelSettingsSheet {...defaultProps} model={localModel} />,
    );

    // Trigger the mock model name update
    await act(async () => {
      fireEvent.press(getByTestId('mock-model-name-update'));
    });

    // Then save
    await act(async () => {
      fireEvent.press(getByText('Save Changes'));
    });

    expect(modelStore.updateModelName).toHaveBeenCalledWith(
      localModel.id,
      'new model name',
    );
  });

  it('updates settings when model changes', () => {
    const {rerender} = render(<ModelSettingsSheet {...defaultProps} />);

    const newModel = {
      ...mockModel,
      chatTemplate: {
        ...defaultTemplate,
        systemPrompt: 'New system prompt',
      },
      stopWords: ['new-stop-word'],
    };

    rerender(<ModelSettingsSheet {...defaultProps} model={newModel} />);

    // The state updates are handled by useEffect, which is tested implicitly
    // through the save/cancel/reset tests
  });

  it('saves per-model load profile settings without loading the model', async () => {
    const {getByTestId, getByText} = render(
      <ModelSettingsSheet {...defaultProps} />,
    );

    fireEvent.changeText(getByTestId('profile-n-ctx'), '8192');
    fireEvent.changeText(getByTestId('profile-n-batch'), '128');
    fireEvent(getByTestId('profile-use-mmap'), 'valueChange', false);

    await act(async () => {
      fireEvent.press(getByText('Save Changes'));
    });

    expect(modelStore.selectModel).not.toHaveBeenCalled();
    expect(modelStore.saveModelInitProfileSettings).toHaveBeenCalledWith(
      mockModel.id,
      expect.objectContaining({
        n_ctx: 8192,
        n_batch: 128,
        use_mmap: 'false',
      }),
      true,
      'manual',
      8192,
    );
  });

  it('saves inactive per-model cache profile changes', async () => {
    modelStore.modelInitProfiles = {
      [mockModel.id]: {
        version: 1,
        settings: {
          ...modelStore.contextInitParams,
          cache_type_k: 'turbo4' as any,
          cache_type_v: 'turbo4' as any,
        },
        allowUnsafeContextLimits: true,
        requestedContextSize: modelStore.contextInitParams.n_ctx,
        updatedAt: '2026-06-20T00:00:00.000Z',
        source: 'manual',
      },
    };

    const {getByTestId, getByText} = render(
      <ModelSettingsSheet {...defaultProps} />,
    );

    await act(async () => {
      fireEvent.press(getByTestId('profile-cache-k-turbo3'));
    });
    await act(async () => {
      fireEvent.press(getByTestId('profile-cache-v-turbo3'));
    });
    await act(async () => {
      fireEvent.press(getByText('Save Changes'));
    });

    expect(modelStore.saveModelInitProfileSettings).toHaveBeenCalledWith(
      mockModel.id,
      expect.objectContaining({
        cache_type_k: 'turbo3',
        cache_type_v: 'turbo3',
      }),
      true,
      'manual',
      modelStore.contextInitParams.n_ctx,
    );
    expect(
      modelStore.modelInitProfiles[mockModel.id].settings.cache_type_k,
    ).toBe('turbo3');
    expect(
      modelStore.modelInitProfiles[mockModel.id].settings.cache_type_v,
    ).toBe('turbo3');
  });

  it('saves offloaded cache profile changes over ownerless global defaults', async () => {
    modelStore.activeModelId = undefined;
    modelStore.contextInitParams = {
      ...modelStore.contextInitParams,
      cache_type_k: 'iq4_nl' as any,
      cache_type_v: 'iq4_nl' as any,
    };
    modelStore.modelInitProfiles = {};

    const {getByTestId, getByText} = render(
      <ModelSettingsSheet {...defaultProps} />,
    );

    await act(async () => {
      fireEvent.press(getByTestId('profile-cache-k-turbo4'));
    });
    await act(async () => {
      fireEvent.press(getByTestId('profile-cache-v-turbo4'));
    });
    await act(async () => {
      fireEvent.press(getByText('Save Changes'));
    });

    expect(modelStore.saveModelInitProfileSettings).toHaveBeenCalledWith(
      mockModel.id,
      expect.objectContaining({
        cache_type_k: 'turbo4',
        cache_type_v: 'turbo4',
      }),
      true,
      'manual',
      modelStore.contextInitParams.n_ctx,
    );
    expect(
      modelStore.modelInitProfiles[mockModel.id].settings.cache_type_k,
    ).toBe('turbo4');
    expect(
      modelStore.modelInitProfiles[mockModel.id].settings.cache_type_v,
    ).toBe('turbo4');
    expect(modelStore.contextInitParams.cache_type_k).toBe('turbo4');
    expect(modelStore.contextInitParams.cache_type_v).toBe('turbo4');
  });

  it('allows profile number inputs to be cleared while editing', async () => {
    const {getByTestId, getByText} = render(
      <ModelSettingsSheet {...defaultProps} />,
    );

    const contextInput = getByTestId('profile-n-ctx');
    fireEvent.changeText(contextInput, '');

    expect(getByTestId('profile-n-ctx').props.value).toBe('');

    fireEvent.changeText(getByTestId('profile-n-ctx'), '50000');

    await act(async () => {
      fireEvent.press(getByText('Save Changes'));
    });

    expect(modelStore.saveModelInitProfileSettings).toHaveBeenCalledWith(
      mockModel.id,
      expect.objectContaining({
        n_ctx: 50000,
      }),
      true,
      'manual',
      50000,
    );
  });

  it('saves high profile context values directly', async () => {
    const boundaryModel: Model = {
      ...mockModel,
      id: 'bonsai',
      name: 'Ternary Bonsai 8B',
      params: 8_188_548_096,
      size: 2_182_184_672,
      ggufMetadata: {context_length: 65536} as any,
    };
    modelStore.models = [boundaryModel];

    const {getByTestId, getByText} = render(
      <ModelSettingsSheet {...defaultProps} model={boundaryModel} />,
    );

    fireEvent.changeText(getByTestId('profile-n-ctx'), '50000');

    await act(async () => {
      fireEvent.press(getByText('Save Changes'));
    });

    expect(modelStore.saveModelInitProfileSettings).toHaveBeenCalledWith(
      boundaryModel.id,
      expect.objectContaining({
        n_ctx: 50000,
      }),
      true,
      'manual',
      50000,
    );
    expect(modelStore.modelInitProfiles[boundaryModel.id].settings.n_ctx).toBe(
      50000,
    );
    expect(
      modelStore.modelInitProfiles[boundaryModel.id].requestedContextSize,
    ).toBe(50000);
  });
});
