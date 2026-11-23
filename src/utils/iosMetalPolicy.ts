import {Platform} from 'react-native';
import {ContextParams} from 'llama.rn';

import {MetalInfo} from '../specs/NativeHardwareInfo';
import {ContextInitParams, Model} from './types';

const GIB = 1024 * 1024 * 1024;
const MIB = 1024 * 1024;
const FULL_OFFLOAD_SENTINEL = 99;
const A16_IPAD_DEVICE_IDS = new Set(['iPad15,7', 'iPad15,8']);
const MODEL_REPEATING_WEIGHT_RATIO = 0.86;
const MODEL_NON_REPEATING_WEIGHT_RATIO = 1 - MODEL_REPEATING_WEIGHT_RATIO;
const METAL_TOTAL_MEMORY_RATIO = 0.72;
const METAL_BUDGET_SAFETY_RATIO = 0.92;
const METAL_FIXED_OVERHEAD_BYTES = 192 * MIB;

export interface IOSMetalSafetyDecision {
  params: Partial<Omit<ContextParams, 'model'>>;
  requestedGpuLayers: number;
  effectiveGpuLayers: number;
  applied: boolean;
  reason?: string;
  logLevel?: 'info' | 'warn';
}

function positiveIntegerOrFallback(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0
    ? Math.floor(numeric)
    : fallback;
}

function isCPUDevice(devices?: string[]) {
  return devices?.some(device => device.toLowerCase() === 'cpu') ?? false;
}

function isTurbo2Cache(cacheType: unknown): boolean {
  return String(cacheType ?? '').toLowerCase() === 'turbo2';
}

function finitePositiveNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function integerMetadataValue(value: unknown): number | undefined {
  const numeric = finitePositiveNumber(value);
  return numeric ? Math.floor(numeric) : undefined;
}

function kvCacheBytesPerElement(cacheType: unknown): number {
  switch (String(cacheType ?? 'f16').toLowerCase()) {
    case 'f32':
      return 4;
    case 'q8_0':
      return 1.0625;
    case 'q5_1':
      return 0.75;
    case 'q5_0':
      return 0.6875;
    case 'q4_1':
      return 0.625;
    case 'q4_0':
    case 'iq4_nl':
      return 0.5625;
    case 'turbo4':
      return 0.53125;
    case 'turbo3':
      return 0.390625;
    case 'turbo2':
      return 0.265625;
    case 'bf16':
    case 'f16':
    default:
      return 2;
  }
}

function isConstrainedIpadTurbo2MetalDevice(args: {
  deviceId?: string | null;
  totalMemoryBytes?: number | null;
}): boolean {
  const deviceId = typeof args.deviceId === 'string' ? args.deviceId : '';
  if (A16_IPAD_DEVICE_IDS.has(deviceId)) {
    return true;
  }

  const totalMemoryBytes = Number(args.totalMemoryBytes ?? 0);
  return (
    deviceId.startsWith('iPad') &&
    Number.isFinite(totalMemoryBytes) &&
    totalMemoryBytes > 0 &&
    totalMemoryBytes < 5.75 * GIB
  );
}

function applyConstrainedIpadTurbo2Guard(args: {
  params: Partial<Omit<ContextParams, 'model'>>;
  deviceId?: string | null;
  totalMemoryBytes?: number | null;
}): {params: Partial<Omit<ContextParams, 'model'>>; reason?: string} {
  if (
    !isConstrainedIpadTurbo2MetalDevice({
      deviceId: args.deviceId,
      totalMemoryBytes: args.totalMemoryBytes,
    })
  ) {
    return {params: args.params};
  }

  if (
    !isTurbo2Cache((args.params as any).cache_type_k) &&
    !isTurbo2Cache((args.params as any).cache_type_v)
  ) {
    return {params: args.params};
  }

  const params = {...args.params};
  if (isTurbo2Cache((params as any).cache_type_k)) {
    (params as any).cache_type_k = 'turbo3';
  }
  if (isTurbo2Cache((params as any).cache_type_v)) {
    (params as any).cache_type_v = 'turbo3';
  }

  return {
    params,
    reason:
      'turbo2 disabled on A16/low-memory iPad Metal due native ggml load aborts',
  };
}

function getSafeMetalWorkingSetBudget(args: {
  metalInfo?: MetalInfo | null;
  totalMemoryBytes?: number | null;
}): number | undefined {
  const recommended = finitePositiveNumber(
    args.metalInfo?.recommendedMaxWorkingSetSize,
  );
  const totalMemory = finitePositiveNumber(args.totalMemoryBytes);
  const fallbackFromTotal = totalMemory
    ? totalMemory * METAL_TOTAL_MEMORY_RATIO
    : undefined;

  const rawBudget =
    recommended && fallbackFromTotal
      ? Math.min(recommended, fallbackFromTotal)
      : (recommended ?? fallbackFromTotal);

  return rawBudget ? rawBudget * METAL_BUDGET_SAFETY_RATIO : undefined;
}

function estimateKVCacheBytes(
  model: Model | undefined,
  params: Partial<Omit<ContextParams, 'model'>>,
): number {
  const metadata = model?.ggufMetadata;
  if (!metadata) {
    return 0;
  }

  const nLayers = finitePositiveNumber(metadata.n_layers);
  const nHeadKv = finitePositiveNumber(metadata.n_head_kv);
  const nEmbdHeadK = finitePositiveNumber(metadata.n_embd_head_k);
  const nEmbdHeadV = finitePositiveNumber(metadata.n_embd_head_v);
  const nCtx = finitePositiveNumber((params as any).n_ctx);
  if (!nLayers || !nHeadKv || !nEmbdHeadK || !nEmbdHeadV || !nCtx) {
    return 0;
  }

  const slidingWindow = finitePositiveNumber(metadata.sliding_window);
  const effectiveCtx = slidingWindow ? Math.min(nCtx, slidingWindow) : nCtx;
  const bytesPerK = kvCacheBytesPerElement((params as any).cache_type_k);
  const bytesPerV = kvCacheBytesPerElement((params as any).cache_type_v);

  return (
    nLayers *
    effectiveCtx *
    nHeadKv *
    (nEmbdHeadK * bytesPerK + nEmbdHeadV * bytesPerV)
  );
}

function estimateComputeBytes(
  model: Model | undefined,
  params: Partial<Omit<ContextParams, 'model'>>,
): number {
  const metadata = model?.ggufMetadata;
  if (!metadata) {
    return 0;
  }

  const nVocab = finitePositiveNumber(metadata.n_vocab);
  const nEmbd = finitePositiveNumber(metadata.n_embd);
  const nUBatch = finitePositiveNumber((params as any).n_ubatch);
  if (!nVocab || !nEmbd || !nUBatch) {
    return 0;
  }

  return (nVocab + nEmbd) * nUBatch * 4;
}

function resolveIOSMetalAutoGpuLayers(args: {
  requestedGpuLayers: number;
  params: Partial<Omit<ContextParams, 'model'>>;
  model?: Model;
  totalMemoryBytes?: number | null;
  metalInfo?: MetalInfo | null;
}): {effectiveGpuLayers: number; reason?: string; logLevel?: 'info' | 'warn'} {
  if (args.requestedGpuLayers < FULL_OFFLOAD_SENTINEL) {
    return {effectiveGpuLayers: args.requestedGpuLayers};
  }

  const nLayers = integerMetadataValue(args.model?.ggufMetadata?.n_layers);
  if (!nLayers) {
    return {effectiveGpuLayers: args.requestedGpuLayers};
  }

  const fullOffloadLayers = nLayers + 1;
  const modelSize = finitePositiveNumber(args.model?.size);
  const safeMetalBudget = getSafeMetalWorkingSetBudget({
    metalInfo: args.metalInfo,
    totalMemoryBytes: args.totalMemoryBytes,
  });

  if (!modelSize || !safeMetalBudget) {
    return {
      effectiveGpuLayers: fullOffloadLayers,
      reason: `resolved Metal auto layers ${args.requestedGpuLayers} -> ${fullOffloadLayers}/${fullOffloadLayers} from GGUF layer count`,
      logLevel: 'info',
    };
  }

  const kvCacheBytes = estimateKVCacheBytes(args.model, args.params);
  const computeBytes = estimateComputeBytes(args.model, args.params);
  const fullOffloadEstimate =
    modelSize + kvCacheBytes + computeBytes + METAL_FIXED_OVERHEAD_BYTES;

  if (fullOffloadEstimate <= safeMetalBudget) {
    return {
      effectiveGpuLayers: fullOffloadLayers,
      reason: `resolved Metal auto layers ${args.requestedGpuLayers} -> ${fullOffloadLayers}/${fullOffloadLayers} (full offload fits estimated working set)`,
      logLevel: 'info',
    };
  }

  const nonRepeatingBytes =
    modelSize * MODEL_NON_REPEATING_WEIGHT_RATIO +
    kvCacheBytes +
    computeBytes +
    METAL_FIXED_OVERHEAD_BYTES;
  const repeatingLayerBytes =
    (modelSize * MODEL_REPEATING_WEIGHT_RATIO) / nLayers;
  const availableForRepeating = safeMetalBudget - nonRepeatingBytes;
  const repeatingLayers = Math.floor(
    Math.max(0, availableForRepeating) / repeatingLayerBytes,
  );
  const cappedRepeatingLayers = Math.min(nLayers, repeatingLayers);
  const effectiveGpuLayers =
    cappedRepeatingLayers > 0 ? cappedRepeatingLayers + 1 : 0;

  return {
    effectiveGpuLayers,
    reason:
      effectiveGpuLayers > 0
        ? `resolved Metal auto layers ${args.requestedGpuLayers} -> ${effectiveGpuLayers}/${fullOffloadLayers} from estimated working set`
        : `resolved Metal auto layers ${args.requestedGpuLayers} -> CPU fallback because estimated working set cannot fit one Metal layer`,
    logLevel: effectiveGpuLayers > 0 ? 'info' : 'warn',
  };
}

export function isIOSMetalRequested(
  params: Partial<Omit<ContextParams, 'model'>> | ContextInitParams,
): boolean {
  if (Platform.OS !== 'ios') {
    return false;
  }
  if ((params as any).no_gpu_devices) {
    return false;
  }
  if (isCPUDevice((params as any).devices)) {
    return false;
  }
  return positiveIntegerOrFallback((params as any).n_gpu_layers, 0) > 0;
}

export function applyIOSMetalSafetyPolicy(args: {
  params: Partial<Omit<ContextParams, 'model'>>;
  model?: Model;
  totalMemoryBytes?: number | null;
  metalInfo?: MetalInfo | null;
  deviceId?: string | null;
  priorFailureCount?: number;
}): IOSMetalSafetyDecision {
  const requestedGpuLayers = positiveIntegerOrFallback(
    args.params.n_gpu_layers,
    FULL_OFFLOAD_SENTINEL,
  );
  if (
    !isIOSMetalRequested({...args.params, n_gpu_layers: requestedGpuLayers})
  ) {
    return {
      params: args.params,
      requestedGpuLayers,
      effectiveGpuLayers: requestedGpuLayers,
      applied: false,
    };
  }

  if (args.metalInfo && args.metalInfo.isSupported === false) {
    return {
      params: {
        ...args.params,
        devices: ['CPU'],
        n_gpu_layers: 0,
      },
      requestedGpuLayers,
      effectiveGpuLayers: 0,
      applied: true,
      reason: args.metalInfo.reason ?? 'Metal unavailable',
    };
  }

  let params = args.params;
  const reasons: string[] = [];
  let logLevel: 'info' | 'warn' = 'info';
  let effectiveGpuLayers = requestedGpuLayers;

  const autoLayers = resolveIOSMetalAutoGpuLayers({
    requestedGpuLayers,
    params,
    model: args.model,
    totalMemoryBytes: args.totalMemoryBytes,
    metalInfo: args.metalInfo,
  });
  effectiveGpuLayers = autoLayers.effectiveGpuLayers;
  if (autoLayers.reason) {
    reasons.push(autoLayers.reason);
  }
  if (autoLayers.logLevel === 'warn') {
    logLevel = 'warn';
  }

  const turbo2Guard = applyConstrainedIpadTurbo2Guard({
    params,
    deviceId: args.deviceId,
    totalMemoryBytes: args.totalMemoryBytes,
  });
  params = turbo2Guard.params;
  if (turbo2Guard.reason) {
    reasons.push(turbo2Guard.reason);
    logLevel = 'warn';
  }

  if (effectiveGpuLayers === requestedGpuLayers && !turbo2Guard.reason) {
    return {
      params,
      requestedGpuLayers,
      effectiveGpuLayers: requestedGpuLayers,
      applied: false,
    };
  }

  const stableParams: Partial<Omit<ContextParams, 'model'>> = {
    ...params,
    n_gpu_layers: effectiveGpuLayers,
  };

  if (effectiveGpuLayers <= 0) {
    stableParams.devices = ['CPU'];
  }

  return {
    params: stableParams,
    requestedGpuLayers,
    effectiveGpuLayers,
    applied: true,
    reason: reasons.join('; ') || 'iOS Metal compatibility cap',
    logLevel,
  };
}
