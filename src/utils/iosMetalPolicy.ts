import {Platform} from 'react-native';
import {ContextParams} from 'llama.rn';

import {MetalInfo} from '../specs/NativeHardwareInfo';
import {ContextInitParams, Model} from './types';
import {getModelMemoryRequirement} from './memoryEstimator';
import {CURRENT_CONTEXT_INIT_PARAMS_VERSION} from './contextInitParamsVersions';

const GIB = 1024 * 1024 * 1024;
const MIB = 1024 * 1024;
const SMALL_IOS_BATCH_CAP = 128;
const METAL_WORKING_SET_HEADROOM = 0.72;
const FULL_OFFLOAD_SENTINEL = 99;
const A16_IPAD_DEVICE_IDS = new Set(['iPad15,7', 'iPad15,8']);

export interface IOSMetalSafetyDecision {
  params: Partial<Omit<ContextParams, 'model'>>;
  requestedGpuLayers: number;
  effectiveGpuLayers: number;
  applied: boolean;
  reason?: string;
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

function getLayerCount(model?: Model): number | undefined {
  const layers = Number(model?.ggufMetadata?.n_layers);
  return Number.isFinite(layers) && layers > 0 ? Math.floor(layers) : undefined;
}

function getSmallDeviceLayerCap(args: {
  requestedGpuLayers: number;
  model?: Model;
  totalMemoryBytes?: number | null;
}): {cap: number; reason?: string} {
  const totalMemoryBytes = args.totalMemoryBytes ?? 0;
  if (!Number.isFinite(totalMemoryBytes) || totalMemoryBytes <= 0) {
    return {cap: args.requestedGpuLayers};
  }

  const ramGiB = totalMemoryBytes / GIB;
  const modelSize = args.model?.size ?? 0;
  const modelParams = args.model?.params ?? 0;
  let cap = args.requestedGpuLayers;
  const reasons: string[] = [];

  if (ramGiB < 3.5) {
    cap = Math.min(cap, 8);
    reasons.push('<3.5 GiB RAM');
  } else if (ramGiB < 4.25) {
    cap = Math.min(cap, 16);
    reasons.push('<4.25 GiB RAM');
  } else if (ramGiB < 4.75) {
    cap = Math.min(cap, 24);
    reasons.push('<4.75 GiB RAM');
  } else if (ramGiB < 5.75) {
    cap = Math.min(cap, 32);
    reasons.push('<5.75 GiB RAM');
  }

  if (ramGiB < 5.75 && modelSize >= 2.5 * GIB) {
    cap = Math.min(cap, 8);
    reasons.push('large model on constrained RAM');
  } else if (ramGiB < 5.75 && modelSize >= 2.0 * GIB) {
    cap = Math.min(cap, 12);
    reasons.push('boundary model on constrained RAM');
  } else if (ramGiB < 4.75 && modelSize >= 1.5 * GIB) {
    cap = Math.min(cap, 16);
    reasons.push('3B-class model on 4 GiB-class device');
  }

  if (ramGiB < 5.75 && modelParams >= 6_000_000_000) {
    cap = Math.min(cap, 8);
    reasons.push('6B+ params on constrained RAM');
  }

  return {
    cap,
    reason: reasons.length > 0 ? reasons.join(', ') : undefined,
  };
}

function getMetalFamilyLayerCap(args: {
  requestedGpuLayers: number;
  model?: Model;
  metalInfo?: MetalInfo | null;
}): {cap: number; reason?: string} {
  const highestAppleFamily = Number(args.metalInfo?.highestAppleFamily);
  if (!Number.isFinite(highestAppleFamily) || highestAppleFamily <= 0) {
    return {cap: args.requestedGpuLayers};
  }

  const modelSize = args.model?.size ?? 0;
  const modelParams = args.model?.params ?? 0;
  let cap = args.requestedGpuLayers;
  const reasons: string[] = [];

  if (highestAppleFamily <= 7) {
    cap = Math.min(cap, 32);
    reasons.push(`Apple GPU family ${highestAppleFamily}`);

    if (modelSize >= 2.5 * GIB || modelParams >= 6_000_000_000) {
      cap = Math.min(cap, 16);
      reasons.push('large model on older Apple GPU');
    } else if (modelSize >= 2.0 * GIB) {
      cap = Math.min(cap, 24);
      reasons.push('boundary model on older Apple GPU');
    }
  } else if (highestAppleFamily === 8) {
    cap = Math.min(cap, 48);
    reasons.push('Apple GPU family 8');

    if (modelSize >= 2.5 * GIB || modelParams >= 6_000_000_000) {
      cap = Math.min(cap, 32);
      reasons.push('large model on A15-class GPU');
    }
  }

  return {
    cap,
    reason: reasons.length > 0 ? reasons.join(', ') : undefined,
  };
}

function capByMetalWorkingSet(args: {
  cap: number;
  model?: Model;
  params: Partial<Omit<ContextParams, 'model'>>;
  metalInfo?: MetalInfo | null;
}): {cap: number; reason?: string} {
  const metalBudget = args.metalInfo?.recommendedMaxWorkingSetSize;
  const layerCount = getLayerCount(args.model);
  if (
    !args.model ||
    !layerCount ||
    !Number.isFinite(metalBudget) ||
    !metalBudget ||
    metalBudget <= 0 ||
    args.cap <= 0
  ) {
    return {cap: args.cap};
  }

  const safeBudget = metalBudget * METAL_WORKING_SET_HEADROOM;
  const useMmapValue = (args.params as any).use_mmap;
  const contextSettings = {
    ...args.params,
    version: CURRENT_CONTEXT_INIT_PARAMS_VERSION,
    n_ctx: positiveIntegerOrFallback((args.params as any).n_ctx, 2048),
    n_batch: positiveIntegerOrFallback((args.params as any).n_batch, 512),
    n_ubatch: positiveIntegerOrFallback((args.params as any).n_ubatch, 512),
    n_threads: positiveIntegerOrFallback((args.params as any).n_threads, 4),
    cache_type_k: (args.params as any).cache_type_k ?? 'f16',
    cache_type_v: (args.params as any).cache_type_v ?? 'f16',
    use_mmap:
      useMmapValue === 'false' || useMmapValue === false ? 'false' : 'true',
  } as ContextInitParams;
  const totalEstimate = getModelMemoryRequirement(
    args.model,
    undefined,
    contextSettings,
  );
  const nonWeightResident = Math.max(
    totalEstimate - args.model.size,
    384 * MIB,
  );
  const maxLayers = Math.min(args.cap, layerCount);

  for (let layers = maxLayers; layers > 0; layers -= 1) {
    const residentEstimate =
      nonWeightResident + args.model.size * (layers / layerCount);
    if (residentEstimate <= safeBudget) {
      return layers === args.cap
        ? {cap: args.cap}
        : {
            cap: layers,
            reason: `Metal working-set headroom (${Math.round(safeBudget / MIB)} MiB budget)`,
          };
    }
  }

  return {
    cap: 0,
    reason: `Metal working-set headroom (${Math.round(safeBudget / MIB)} MiB budget)`,
  };
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

  const smallDevice = getSmallDeviceLayerCap({
    requestedGpuLayers,
    model: args.model,
    totalMemoryBytes: args.totalMemoryBytes,
  });
  let cap = smallDevice.cap;
  const reasons = smallDevice.reason ? [smallDevice.reason] : [];
  let params = args.params;

  const turbo2Guard = applyConstrainedIpadTurbo2Guard({
    params,
    deviceId: args.deviceId,
    totalMemoryBytes: args.totalMemoryBytes,
  });
  params = turbo2Guard.params;
  if (turbo2Guard.reason) {
    reasons.push(turbo2Guard.reason);
  }

  const metalFamily = getMetalFamilyLayerCap({
    requestedGpuLayers: cap,
    model: args.model,
    metalInfo: args.metalInfo,
  });
  cap = metalFamily.cap;
  if (metalFamily.reason) {
    reasons.push(metalFamily.reason);
  }

  const priorFailureCount = args.priorFailureCount ?? 0;
  if (priorFailureCount >= 2) {
    cap = 0;
    reasons.push('repeated interrupted Metal loads on this device');
  } else if (priorFailureCount === 1) {
    cap = Math.min(cap, 8);
    reasons.push('previous interrupted Metal load on this device');
  }

  const workingSet = capByMetalWorkingSet({
    cap,
    model: args.model,
    params,
    metalInfo: args.metalInfo,
  });
  cap = workingSet.cap;
  if (workingSet.reason) {
    reasons.push(workingSet.reason);
  }

  if (cap >= requestedGpuLayers && !turbo2Guard.reason) {
    return {
      params,
      requestedGpuLayers,
      effectiveGpuLayers: requestedGpuLayers,
      applied: false,
    };
  }

  const stableParams: Partial<Omit<ContextParams, 'model'>> = {
    ...params,
    n_gpu_layers: cap,
    n_batch: Math.min(
      positiveIntegerOrFallback(args.params.n_batch, 512),
      SMALL_IOS_BATCH_CAP,
    ),
    n_ubatch: Math.min(
      positiveIntegerOrFallback(args.params.n_ubatch, 512),
      SMALL_IOS_BATCH_CAP,
    ),
    use_mmap: true,
    use_mlock: false,
    no_extra_bufts: true,
    warmup: false,
  };

  if (cap <= 0) {
    stableParams.devices = ['CPU'];
  }

  return {
    params: stableParams,
    requestedGpuLayers,
    effectiveGpuLayers: cap,
    applied: true,
    reason: reasons.join('; ') || 'iOS Metal compatibility cap',
  };
}
