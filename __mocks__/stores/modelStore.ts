import {computed, makeAutoObservable, observable} from 'mobx';

import {modelsList} from '../../jest/fixtures/models';

import {downloadManager} from '../services/downloads';

import {Model, ContextInitParams} from '../../src/utils/types';
import type {ModelInitProfile} from '../../src/store/ModelStore';
import {LlamaContext} from 'llama.rn';
import {CompletionEngine} from '../../src/utils/completionTypes';
import {createDefaultContextInitParams} from '../../src/utils/contextInitParamsVersions';

class MockModelStore {
  models = modelsList;
  contextInitParams: ContextInitParams = createDefaultContextInitParams();
  requestedContextSize: number | undefined = undefined;
  max_threads = 4;
  MIN_CONTEXT_SIZE = 200;
  useAutoRelease = true;
  allowUnsafeContextLimits = false;
  modelInitProfiles: Record<string, ModelInitProfile> = {};
  modelInitProfileRevision = 0;
  downloadRevision = 0;
  activeModelId: string | undefined;
  inferencing = false;
  isStreaming = false;
  context: LlamaContext | undefined = undefined;
  engine: CompletionEngine | undefined = undefined;

  // Memory calibration variables
  availableMemoryCeiling: number | undefined = 5 * 1e9; // 5GB ceiling
  largestSuccessfulLoad: number | undefined = 4 * 1e9; // 4GB largest successful load

  refreshDownloadStatuses: jest.Mock;
  addLocalModel: jest.Mock;
  removeModelByFullPath: jest.Mock;
  setNContext: jest.Mock;
  setAllowUnsafeContextLimits: jest.Mock;
  updateUseAutoRelease: jest.Mock;
  setNoGpuDevices: jest.Mock;
  setDevices: jest.Mock;
  setFlashAttnType: jest.Mock;
  setNGPULayers: jest.Mock;
  resetModels: jest.Mock;
  initContext: jest.Mock;
  selectModel: jest.Mock;
  setRemoteModel: jest.Mock;
  lastUsedModelId: any;
  checkSpaceAndDownload: jest.Mock;
  getDownloadProgress: jest.Mock;
  manualReleaseContext: jest.Mock;
  addHFModel: jest.Mock;
  downloadHFModel: jest.Mock;
  cancelDownload: jest.Mock;
  disableAutoRelease: jest.Mock;
  enableAutoRelease: jest.Mock;
  deleteModel: jest.Mock;
  removeModelFromList: jest.Mock;
  canDeleteProjectionModel: jest.Mock;
  setDefaultProjectionModel: jest.Mock;
  updateModelChatTemplate: jest.Mock;
  resetModelChatTemplate: jest.Mock;
  updateModelStopWords: jest.Mock;
  resetModelStopWords: jest.Mock;
  updateModelName: jest.Mock;
  resetModelName: jest.Mock;
  setImageMaxTokens: jest.Mock;
  setNThreads: jest.Mock;
  setNBatch: jest.Mock;
  setNUBatch: jest.Mock;
  setCacheTypeK: jest.Mock;
  setCacheTypeV: jest.Mock;
  setUseMmap: jest.Mock;
  setNoExtraBufts: jest.Mock;
  getModelInitProfileDraft: jest.Mock;
  saveModelInitProfileSettings: jest.Mock;
  clearModelInitProfile: jest.Mock;
  enterBenchmarkMode: jest.Mock;
  exitBenchmarkMode: jest.Mock;
  benchmarkActive: boolean = false;
  isContextLoading: boolean = false;
  loadingModel: Model | undefined;

  constructor() {
    makeAutoObservable(this, {
      engine: observable.ref,
      refreshDownloadStatuses: false,
      addLocalModel: false,
      removeModelByFullPath: false,
      setNContext: false,
      setAllowUnsafeContextLimits: false,
      updateUseAutoRelease: false,

      setNGPULayers: false,
      resetModels: false,
      initContext: false,
      selectModel: false,
      setRemoteModel: false,
      checkSpaceAndDownload: false,
      getDownloadProgress: false,
      manualReleaseContext: false,
      addHFModel: false,
      downloadHFModel: false,
      cancelDownload: false,
      disableAutoRelease: false,
      enableAutoRelease: false,
      deleteModel: false,
      removeModelFromList: false,
      canDeleteProjectionModel: false,
      setDefaultProjectionModel: false,
      updateModelChatTemplate: false,
      resetModelChatTemplate: false,
      updateModelStopWords: false,
      resetModelStopWords: false,
      updateModelName: false,
      resetModelName: false,
      setImageMaxTokens: false,
      setNThreads: false,
      setNBatch: false,
      setNUBatch: false,
      setCacheTypeK: false,
      setCacheTypeV: false,
      setUseMmap: false,
      setNoExtraBufts: false,
      getModelInitProfileDraft: false,
      saveModelInitProfileSettings: false,
      clearModelInitProfile: false,
      enterBenchmarkMode: false,
      exitBenchmarkMode: false,
      contextId: computed,
      lastUsedModel: computed,
      activeModel: computed,
      displayModels: computed,
      availableModels: computed,
      isDownloading: computed,
    });
    this.refreshDownloadStatuses = jest.fn();
    this.addLocalModel = jest.fn();
    this.removeModelByFullPath = jest.fn();
    this.setNContext = jest.fn(
      (
        n_ctx: number,
        options: {allowUnsafeContextLimits?: boolean; model?: Model} = {},
      ) => {
        const limitInfo = this.getContextLimitInfo(n_ctx, options.model, {
          allowUnsafeContextLimits: options.allowUnsafeContextLimits,
        });
        this.requestedContextSize = limitInfo.requested;
        this.contextInitParams = {
          ...this.contextInitParams,
          n_ctx: limitInfo.effective,
        };
      },
    );
    this.setAllowUnsafeContextLimits = jest.fn((value: boolean) => {
      const requestedContext =
        this.requestedContextSize ?? this.contextInitParams.n_ctx;
      this.allowUnsafeContextLimits = value;
      this.requestedContextSize = requestedContext;
      const limitInfo = this.getContextLimitInfo(
        value ? requestedContext : this.contextInitParams.n_ctx,
        undefined,
        {allowUnsafeContextLimits: value},
      );
      if (limitInfo.effective !== this.contextInitParams.n_ctx) {
        this.contextInitParams = {
          ...this.contextInitParams,
          n_ctx: limitInfo.effective,
        };
      }
    });
    this.updateUseAutoRelease = jest.fn();
    this.setNoGpuDevices = jest.fn();
    this.setDevices = jest.fn();
    this.setFlashAttnType = jest.fn();
    this.setNGPULayers = jest.fn();
    this.resetModels = jest.fn();
    this.initContext = jest.fn().mockResolvedValue(Promise.resolve());
    this.selectModel = jest.fn().mockResolvedValue(Promise.resolve());
    this.setRemoteModel = jest.fn().mockResolvedValue(Promise.resolve());
    this.checkSpaceAndDownload = jest.fn();
    this.getDownloadProgress = jest.fn();
    this.manualReleaseContext = jest.fn();
    this.addHFModel = jest.fn();
    this.downloadHFModel = jest.fn();
    this.cancelDownload = jest.fn();
    this.disableAutoRelease = jest.fn();
    this.enableAutoRelease = jest.fn();
    this.deleteModel = jest.fn().mockResolvedValue(Promise.resolve());
    this.removeModelFromList = jest.fn();
    this.canDeleteProjectionModel = jest.fn().mockReturnValue({
      canDelete: true,
      reason: null,
      dependentModels: [],
    });
    this.setDefaultProjectionModel = jest.fn();
    this.updateModelChatTemplate = jest.fn();
    this.resetModelChatTemplate = jest.fn();
    this.updateModelStopWords = jest.fn();
    this.resetModelStopWords = jest.fn();
    this.updateModelName = jest.fn();
    this.resetModelName = jest.fn();
    this.setImageMaxTokens = jest.fn();
    this.setNThreads = jest.fn();
    this.setNBatch = jest.fn();
    this.setNUBatch = jest.fn();
    this.setCacheTypeK = jest.fn();
    this.setCacheTypeV = jest.fn();
    this.setUseMmap = jest.fn();
    this.setNoExtraBufts = jest.fn();
    this.getModelInitProfileDraft = jest.fn((modelId: string) => {
      const profile = this.modelInitProfiles[modelId];
      const settings = profile?.settings ?? this.contextInitParams;
      const allowUnsafeContextLimits =
        profile?.allowUnsafeContextLimits ?? this.allowUnsafeContextLimits;
      const requestedContextSize =
        profile?.requestedContextSize ??
        this.requestedContextSize ??
        settings.n_ctx;
      const model = this.models.find(m => m.id === modelId);
      const limitInfo = this.getContextLimitInfo(requestedContextSize, model, {
        allowUnsafeContextLimits,
      });

      return {
        version: 1,
        settings: {
          ...JSON.parse(JSON.stringify(settings)),
          n_ctx: limitInfo.effective,
        },
        allowUnsafeContextLimits,
        requestedContextSize: limitInfo.requested,
        updatedAt: profile?.updatedAt ?? new Date(0).toISOString(),
        source: profile?.source ?? 'manual',
        modelId,
      };
    });
    this.saveModelInitProfileSettings = jest.fn(
      (
        modelId: string,
        settings: ContextInitParams,
        allowUnsafe: boolean,
        _source = 'manual',
        requestedContextSize: number | undefined = settings.n_ctx,
      ) => {
        const model = this.models.find(m => m.id === modelId);
        const limitInfo = this.getContextLimitInfo(
          requestedContextSize ?? settings.n_ctx,
          model,
          {allowUnsafeContextLimits: allowUnsafe},
        );
        const normalizedSettings = {
          ...settings,
          n_ctx: limitInfo.effective,
        };
        this.modelInitProfiles = {
          ...this.modelInitProfiles,
          [modelId]: {
            version: 1,
            settings: normalizedSettings,
            allowUnsafeContextLimits: allowUnsafe,
            requestedContextSize: limitInfo.requested,
            updatedAt: new Date().toISOString(),
            source: 'manual',
          },
        };
        if (this.activeModelId === modelId || !this.activeModelId) {
          this.contextInitParams = normalizedSettings;
          this.requestedContextSize = limitInfo.requested;
          this.allowUnsafeContextLimits = allowUnsafe;
        }
        return true;
      },
    );
    this.clearModelInitProfile = jest.fn((modelId: string) => {
      const {[modelId]: _removed, ...remaining} = this.modelInitProfiles;
      this.modelInitProfiles = remaining;
      if (this.activeModelId === modelId || !this.activeModelId) {
        this.contextInitParams = createDefaultContextInitParams();
        this.requestedContextSize = this.contextInitParams.n_ctx;
        this.allowUnsafeContextLimits = false;
      }
    });
    this.enterBenchmarkMode = jest.fn().mockResolvedValue(undefined);
    this.exitBenchmarkMode = jest.fn();
  }

  setActiveModel = (modelId: string) => {
    this.activeModelId = modelId;
  };

  setInferencing = (value: boolean) => {
    this.inferencing = value;
  };

  setIsStreaming = (value: boolean) => {
    this.isStreaming = value;
  };

  // Safe context release methods
  registerCompletionPromise = jest.fn();
  clearCompletionPromise = jest.fn();

  get contextId(): string | undefined {
    if (this.context) {
      return String(this.context.id);
    }
    return undefined;
  }

  get lastUsedModel(): Model | undefined {
    return this.lastUsedModelId
      ? this.models.find(m => m.id === this.lastUsedModelId)
      : undefined;
  }

  get isDownloading() {
    return (modelId: string) => {
      const model = this.models.find(m => m.id === modelId);
      return Boolean(
        model?.isDownloading || downloadManager.isDownloading(modelId),
      );
    };
  }

  get activeModel() {
    return this.models.find(model => model.id === this.activeModelId);
  }

  get displayModels(): Model[] {
    // Filter out projection models for display purposes
    return this.models.filter(model => model.modelType !== 'projection');
  }

  get availableModels() {
    return this.models.filter(model => model.isDownloaded);
  }

  isModelAvailable(modelId: string) {
    return this.availableModels.some(model => model.id === modelId);
  }

  async isMultimodalEnabled(): Promise<boolean> {
    // Mock implementation - return false by default for tests
    return false;
  }

  async getModelFullPath(model: Model): Promise<string> {
    // Mock implementation - return a simple path for tests
    return `/mock/path/${model.filename || model.name}`;
  }

  async getEffectiveContextInitParams(
    _filePath: string,
  ): Promise<Record<string, unknown>> {
    // Mock returns the current contextInitParams as the resolved view.
    // Tests can spy on this if they need to assert what got passed to
    // initLlama.
    return JSON.parse(JSON.stringify(this.contextInitParams));
  }

  getContextLimitInfo(
    requestedContext: number,
    model?: Model,
    options: {allowUnsafeContextLimits?: boolean} = {},
  ) {
    const selectedModel = model ?? this.activeModel ?? this.lastUsedModel;
    const allowUnsafeContextLimits =
      options.allowUnsafeContextLimits ?? this.allowUnsafeContextLimits;
    const requested =
      Number.isFinite(requestedContext) && requestedContext > 0
        ? Math.floor(requestedContext)
        : this.contextInitParams.n_ctx;
    const metadataLimit = Number(selectedModel?.ggufMetadata?.context_length);
    const normalizedMetadataLimit =
      Number.isFinite(metadataLimit) && metadataLimit > 0
        ? Math.floor(metadataLimit)
        : undefined;
    const boundaryModel =
      !!selectedModel &&
      ((selectedModel.params ?? 0) >= 6_000_000_000 ||
        (selectedModel.size ?? 0) >= 2_000_000_000);
    const effective = requested;

    return {
      requested,
      effective,
      metadataLimit: normalizedMetadataLimit,
      deviceLimit: undefined,
      limit: undefined,
      boundaryModel,
      unsafeLimitsEnabled: allowUnsafeContextLimits,
      metadataConstrained: false,
      deviceConstrained: false,
      isConstrained: false,
    };
  }

  getCompatibleProjectionModels = jest.fn().mockReturnValue([]);
  hasRequiredProjectionModel = jest.fn().mockReturnValue(true);
  getProjectionModelStatus = jest.fn().mockReturnValue({
    isAvailable: true,
    state: 'not_needed',
  });
  getModelVisionPreference = jest.fn().mockReturnValue(true);
  setModelVisionEnabled = jest.fn().mockResolvedValue(undefined);
  getDownloadedLLMsUsingProjectionModel = jest.fn().mockReturnValue([]);
}

export const mockModelStore = new MockModelStore();
