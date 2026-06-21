import {Platform} from 'react-native';

import {
  applyIOSMetalSafetyPolicy,
  isIOSMetalRequested,
} from '../iosMetalPolicy';
import {Model, ModelOrigin} from '../types';

const originalOS = Platform.OS;

function setPlatformOS(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: os,
  });
}

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'test/model.gguf',
    name: 'Test Model',
    author: 'test',
    origin: ModelOrigin.HF,
    isDownloaded: true,
    isLocal: false,
    size: 1_700_000_000,
    params: 3_000_000_000,
    downloadUrl: 'https://example.com/model.gguf',
    hfUrl: 'https://huggingface.co/test/model',
    progress: 100,
    filename: 'model.gguf',
    ggufMetadata: {
      n_layers: 32,
      context_length: 32768,
    },
    defaultChatTemplate: {
      name: '',
      addBosToken: false,
      addEosToken: false,
      bosToken: '',
      eosToken: '',
      chatTemplate: '',
      addGenerationPrompt: false,
    },
    chatTemplate: {
      name: '',
      addBosToken: false,
      addEosToken: false,
      bosToken: '',
      eosToken: '',
      chatTemplate: '',
      addGenerationPrompt: false,
    },
    defaultStopWords: [],
    stopWords: [],
    defaultCompletionSettings: {},
    completionSettings: {},
    ...overrides,
  } as Model;
}

describe('iosMetalPolicy', () => {
  afterEach(() => {
    setPlatformOS(originalOS);
  });

  it('detects iOS Metal requests and ignores CPU/non-iOS requests', () => {
    setPlatformOS('ios');
    expect(isIOSMetalRequested({n_gpu_layers: 99})).toBe(true);
    expect(isIOSMetalRequested({n_gpu_layers: 99, devices: ['CPU']})).toBe(
      false,
    );
    expect(isIOSMetalRequested({n_gpu_layers: 0})).toBe(false);

    setPlatformOS('android');
    expect(isIOSMetalRequested({n_gpu_layers: 99})).toBe(false);
  });

  it('caps Metal layers and batch size for 4 GB-class iPhones', () => {
    setPlatformOS('ios');

    const decision = applyIOSMetalSafetyPolicy({
      params: {
        n_ctx: 32768,
        n_batch: 512,
        n_ubatch: 512,
        n_gpu_layers: 99,
        use_mmap: false,
        use_mlock: true,
      },
      model: makeModel(),
      totalMemoryBytes: 4 * 1024 * 1024 * 1024,
      metalInfo: {
        isSupported: true,
        recommendedMaxWorkingSetSize: 3 * 1024 * 1024 * 1024,
      },
    });

    expect(decision.applied).toBe(true);
    expect(decision.effectiveGpuLayers).toBeGreaterThan(0);
    expect(decision.effectiveGpuLayers).toBeLessThanOrEqual(16);
    expect(decision.params.n_batch).toBe(128);
    expect(decision.params.n_ubatch).toBe(128);
    expect(decision.params.use_mmap).toBe(true);
    expect(decision.params.use_mlock).toBe(false);
    expect(decision.params.no_extra_bufts).toBe(true);
    expect(decision.params.warmup).toBe(false);
  });

  it('falls back to CPU after repeated interrupted Metal loads', () => {
    setPlatformOS('ios');

    const decision = applyIOSMetalSafetyPolicy({
      params: {
        n_ctx: 8192,
        n_batch: 512,
        n_ubatch: 512,
        n_gpu_layers: 99,
      },
      model: makeModel(),
      totalMemoryBytes: 6 * 1024 * 1024 * 1024,
      priorFailureCount: 2,
    });

    expect(decision.applied).toBe(true);
    expect(decision.effectiveGpuLayers).toBe(0);
    expect(decision.params.n_gpu_layers).toBe(0);
    expect(decision.params.devices).toEqual(['CPU']);
  });

  it('falls back to CPU when the native bridge reports Metal unsupported', () => {
    setPlatformOS('ios');

    const decision = applyIOSMetalSafetyPolicy({
      params: {
        n_gpu_layers: 99,
      },
      model: makeModel(),
      metalInfo: {
        isSupported: false,
        reason: 'Metal family requirements not met',
      },
    });

    expect(decision.applied).toBe(true);
    expect(decision.reason).toBe('Metal family requirements not met');
    expect(decision.params.devices).toEqual(['CPU']);
    expect(decision.params.n_gpu_layers).toBe(0);
  });

  it('caps full offload on older Apple GPU families even when RAM is ample', () => {
    setPlatformOS('ios');

    const decision = applyIOSMetalSafetyPolicy({
      params: {
        n_ctx: 32768,
        n_batch: 512,
        n_ubatch: 512,
        n_gpu_layers: 99,
      },
      model: makeModel({
        size: 3_000_000_000,
        params: 8_000_000_000,
      }),
      totalMemoryBytes: 6 * 1024 * 1024 * 1024,
      metalInfo: {
        isSupported: true,
        highestAppleFamily: 7,
      },
    });

    expect(decision.applied).toBe(true);
    expect(decision.effectiveGpuLayers).toBeLessThanOrEqual(16);
    expect(decision.reason).toContain('Apple GPU family 7');
    expect(decision.params.n_batch).toBe(128);
  });

  it('downgrades turbo2 cache on A16 iPads before native init', () => {
    setPlatformOS('ios');

    const decision = applyIOSMetalSafetyPolicy({
      params: {
        n_ctx: 8192,
        n_batch: 512,
        n_ubatch: 512,
        n_gpu_layers: 99,
        cache_type_k: 'q8_0' as any,
        cache_type_v: 'turbo2' as any,
        use_mmap: false,
        use_mlock: true,
        warmup: true,
      },
      model: makeModel(),
      totalMemoryBytes: 6 * 1024 * 1024 * 1024,
      deviceId: 'iPad15,7',
    });

    expect(decision.applied).toBe(true);
    expect(decision.effectiveGpuLayers).toBe(99);
    expect(decision.params.cache_type_k).toBe('q8_0');
    expect(decision.params.cache_type_v).toBe('turbo3');
    expect(decision.params.n_batch).toBe(128);
    expect(decision.params.n_ubatch).toBe(128);
    expect(decision.params.use_mmap).toBe(true);
    expect(decision.params.use_mlock).toBe(false);
    expect(decision.params.warmup).toBe(false);
    expect(decision.reason).toContain('turbo2 disabled');
  });

  it('leaves turbo2 cache enabled on non-constrained iPhones', () => {
    setPlatformOS('ios');

    const decision = applyIOSMetalSafetyPolicy({
      params: {
        n_ctx: 8192,
        n_batch: 512,
        n_ubatch: 512,
        n_gpu_layers: 99,
        cache_type_k: 'q8_0' as any,
        cache_type_v: 'turbo2' as any,
      },
      model: makeModel(),
      totalMemoryBytes: 6 * 1024 * 1024 * 1024,
      deviceId: 'iPhone15,3',
    });

    expect(decision.applied).toBe(false);
    expect(decision.params.cache_type_v).toBe('turbo2');
  });
});
