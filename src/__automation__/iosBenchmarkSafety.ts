const GIB = 1024 * 1024 * 1024;
const A16_IPAD_DEVICE_IDS = new Set(['iPad15,7', 'iPad15,8']);

export const DEFAULT_TURBO_V_LADDER = ['turbo4', 'turbo3', 'turbo2'];
export const CONSTRAINED_IOS_TURBO_V_LADDER = ['turbo4', 'turbo3'];

export interface IosBenchmarkDeviceProfile {
  platform?: string | null;
  device_id?: string | null;
  model?: string | null;
  device?: string | null;
  total_memory_bytes?: number | null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isIosProfile(profile?: IosBenchmarkDeviceProfile | null): boolean {
  const platform = stringValue(profile?.platform).toLowerCase();
  return platform === '' || platform === 'ios';
}

function isIpadProfile(profile?: IosBenchmarkDeviceProfile | null): boolean {
  const deviceId = stringValue(profile?.device_id);
  const model = stringValue(profile?.model);
  const device = stringValue(profile?.device);
  return (
    deviceId.startsWith('iPad') ||
    model.toLowerCase().includes('ipad') ||
    device.toLowerCase().includes('ipad')
  );
}

export function isConstrainedIosTurbo2Device(
  profile?: IosBenchmarkDeviceProfile | null,
): boolean {
  if (!isIosProfile(profile) || !isIpadProfile(profile)) {
    return false;
  }

  const deviceId = stringValue(profile?.device_id);
  if (A16_IPAD_DEVICE_IDS.has(deviceId)) {
    return true;
  }

  const totalMemoryBytes = Number(profile?.total_memory_bytes ?? 0);
  return Number.isFinite(totalMemoryBytes) && totalMemoryBytes > 0
    ? totalMemoryBytes < 5.75 * GIB
    : false;
}

export function iosTurboVLadderForDevice(
  profile?: IosBenchmarkDeviceProfile | null,
): string[] {
  return isConstrainedIosTurbo2Device(profile)
    ? [...CONSTRAINED_IOS_TURBO_V_LADDER]
    : [...DEFAULT_TURBO_V_LADDER];
}

export function getUnsafeIosTurbo2BenchmarkReason(args: {
  deviceProfile?: IosBenchmarkDeviceProfile | null;
  backend: string;
  baseCacheTypeV?: unknown;
  overrides?: {cache_type_v?: unknown};
}): string | null {
  if (args.backend !== 'gpu') {
    return null;
  }
  if (!isConstrainedIosTurbo2Device(args.deviceProfile)) {
    return null;
  }
  const cacheTypeV = String(
    args.overrides?.cache_type_v ?? args.baseCacheTypeV ?? '',
  ).toLowerCase();
  if (cacheTypeV !== 'turbo2') {
    return null;
  }
  return 'unsafe-ios-turbo2-metal-profile:A16/low-memory iPad Metal benchmark cells skip turbo2 to avoid process-kill crashes';
}
