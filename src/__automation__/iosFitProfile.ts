import type {
  Backend,
  EffectiveBackend,
  SettingsValue,
} from './screens/BenchmarkRunnerScreen';

export interface IosFitRuntimeDeviceProfile {
  platform?: string;
  device_id?: string | null;
  model?: string | null;
  device?: string | null;
  system_name?: string | null;
  system_version?: string | null;
  total_memory_bytes?: number | null;
  available_memory_bytes?: number | null;
}

export interface IosFitProfileObservation {
  key: string;
  model_id: string;
  hf_model_id?: string;
  model_store_id?: string;
  filename?: string;
  quant: string;
  requested_backend: Backend;
  effective_backend?: EffectiveBackend;
  settings_fingerprint: string;
  settings_overrides?: Record<string, SettingsValue>;
  status: 'fit' | 'quality-failed' | 'failed' | 'skipped';
  failure_class?:
    | 'memory'
    | 'download'
    | 'backend'
    | 'load'
    | 'crash'
    | 'other';
  quality_score?: number | null;
  quality_passed?: boolean | null;
  pp_avg?: number | null;
  tg_avg?: number | null;
  peak_memory_mb?: number | null;
  total_memory_bytes?: number | null;
  available_memory_before_bytes?: number | null;
  file_size_bytes?: number;
  n_ctx?: number;
  use_mmap?: boolean;
  cache_type_k?: string;
  cache_type_v?: string;
  error?: string;
  first_seen_at: string;
  last_seen_at: string;
  hits: number;
}

export interface IosFitDeviceFitProfile {
  version: 1;
  device_key: string;
  updated_at: string;
  observations: IosFitProfileObservation[];
}

interface BenchVariantLike {
  quant: string;
  filename: string;
  size?: number;
}

interface BenchModelLike {
  id: string;
  hfModelId: string;
  quants: BenchVariantLike[];
}

export interface BenchConfigLike {
  models: BenchModelLike[];
  base_params?: Record<string, unknown>;
}

interface MemorySampleLike {
  available_bytes?: number | null;
}

interface BenchmarkRowLike {
  model_id: string;
  quant: string;
  requested_backend: Backend;
  effective_backend?: EffectiveBackend;
  settings_fingerprint: string;
  settings_overrides?: Record<string, SettingsValue>;
  status: 'ok' | 'skipped' | 'failed';
  reason?: string;
  error?: string;
  quality_score?: number | null;
  quality_passed?: boolean | null;
  pp_avg?: number | null;
  tg_avg?: number | null;
  peak_memory_mb?: number | null;
  memory_before?: MemorySampleLike | null;
  effective_init_params?: Record<string, unknown>;
  timestamp: string;
}

export interface BenchmarkReportLike {
  device_profile?: IosFitRuntimeDeviceProfile;
  runs?: BenchmarkRowLike[];
}

export interface FitEvidence {
  exact_passes: number;
  exact_failures: number;
  family_passes: number;
  family_failures: number;
  quality_failures: number;
  observed_peak_memory_mb?: number;
  fastest_tg_avg?: number;
  latest_status?: IosFitProfileObservation['status'];
  likely_hard_fail: boolean;
}

const MAX_PROFILE_OBSERVATIONS = 1200;

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

export function deviceKeyFromRuntimeProfile(
  profile?: IosFitRuntimeDeviceProfile | null,
): string {
  const platform = profile?.platform ?? 'unknown';
  const machine = profile?.device_id ?? profile?.device ?? profile?.model;
  const memory =
    typeof profile?.total_memory_bytes === 'number'
      ? Math.round(profile.total_memory_bytes / (1024 * 1024))
      : 'unknown';
  return `${platform}:${machine ?? 'unknown'}:${memory}mb`;
}

function classifyFailure(
  row: BenchmarkRowLike,
): IosFitProfileObservation['failure_class'] {
  const text = `${row.reason ?? ''} ${row.error ?? ''}`.toLowerCase();
  if (
    text.includes('memory') ||
    text.includes('storage') ||
    text.includes('space') ||
    text.includes('oom')
  ) {
    return 'memory';
  }
  if (text.includes('download')) {
    return 'download';
  }
  if (
    text.includes('gpu') ||
    text.includes('hexagon') ||
    text.includes('backend')
  ) {
    return 'backend';
  }
  if (text.includes('crash') || text.includes('interrupted')) {
    return 'crash';
  }
  if (text.includes('load') || text.includes('init')) {
    return 'load';
  }
  return row.status === 'failed' ? 'other' : undefined;
}

function observationStatus(
  row: BenchmarkRowLike,
): IosFitProfileObservation['status'] {
  if (row.status === 'ok') {
    return row.quality_passed === false ? 'quality-failed' : 'fit';
  }
  if (row.status === 'skipped') {
    return 'skipped';
  }
  return 'failed';
}

function findVariant(
  config: BenchConfigLike,
  row: BenchmarkRowLike,
): {model: BenchModelLike; variant: BenchVariantLike} | null {
  const model = config.models.find(entry => entry.id === row.model_id);
  const variant = model?.quants.find(entry => entry.quant === row.quant);
  return model && variant ? {model, variant} : null;
}

function observedKey(args: {
  modelId: string;
  filename?: string;
  backend: Backend;
  fingerprint: string;
}): string {
  return [
    args.modelId,
    args.filename ?? 'unknown-file',
    args.backend,
    args.fingerprint,
  ].join('|');
}

function observedCacheTypes(row: BenchmarkRowLike, config: BenchConfigLike) {
  const params = row.effective_init_params ?? config.base_params ?? {};
  return {
    n_ctx: finiteNumber(params.n_ctx),
    use_mmap:
      typeof params.use_mmap === 'boolean' ? params.use_mmap : undefined,
    cache_type_k:
      typeof params.cache_type_k === 'string' ? params.cache_type_k : undefined,
    cache_type_v:
      typeof params.cache_type_v === 'string' ? params.cache_type_v : undefined,
  };
}

export function updateFitProfileFromReport(args: {
  existing: IosFitDeviceFitProfile | null;
  report: BenchmarkReportLike;
  config: BenchConfigLike;
  now?: string;
}): IosFitDeviceFitProfile {
  const now = args.now ?? new Date().toISOString();
  const deviceKey = deviceKeyFromRuntimeProfile(args.report.device_profile);
  const profile: IosFitDeviceFitProfile =
    args.existing && args.existing.version === 1
      ? {
          ...args.existing,
          device_key: args.existing.device_key || deviceKey,
          observations: [...args.existing.observations],
        }
      : {
          version: 1,
          device_key: deviceKey,
          updated_at: now,
          observations: [],
        };

  const byKey = new Map(profile.observations.map(obs => [obs.key, obs]));
  for (const row of args.report.runs ?? []) {
    const match = findVariant(args.config, row);
    const filename = match?.variant.filename;
    const key = observedKey({
      modelId: row.model_id,
      filename,
      backend: row.requested_backend,
      fingerprint: row.settings_fingerprint,
    });
    const seenAt = row.timestamp || now;
    const status = observationStatus(row);
    const observed = byKey.get(key);
    const cache = observedCacheTypes(row, args.config);
    const next: IosFitProfileObservation = {
      ...(observed ?? {
        key,
        model_id: row.model_id,
        quant: row.quant,
        requested_backend: row.requested_backend,
        settings_fingerprint: row.settings_fingerprint,
        first_seen_at: seenAt,
        hits: 0,
      }),
      hf_model_id: match?.model.hfModelId,
      model_store_id:
        match && filename ? `${match.model.hfModelId}/${filename}` : undefined,
      filename,
      effective_backend: row.effective_backend,
      settings_overrides: row.settings_overrides,
      status,
      failure_class: status === 'failed' ? classifyFailure(row) : undefined,
      quality_score: row.quality_score ?? null,
      quality_passed: row.quality_passed ?? null,
      pp_avg: row.pp_avg ?? null,
      tg_avg: row.tg_avg ?? null,
      peak_memory_mb: row.peak_memory_mb ?? null,
      total_memory_bytes:
        args.report.device_profile?.total_memory_bytes ?? null,
      available_memory_before_bytes:
        row.memory_before?.available_bytes ??
        args.report.device_profile?.available_memory_bytes ??
        null,
      file_size_bytes: match?.variant.size,
      ...cache,
      error: row.error,
      last_seen_at: seenAt,
      hits:
        observed?.last_seen_at === seenAt
          ? observed.hits
          : (observed?.hits ?? 0) + 1,
    };
    byKey.set(key, next);
  }

  profile.observations = [...byKey.values()]
    .sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at))
    .slice(0, MAX_PROFILE_OBSERVATIONS);
  profile.updated_at = now;
  return profile;
}

export function getFitEvidence(
  profile: IosFitDeviceFitProfile | null | undefined,
  candidate: {
    modelId: string;
    hfModelId: string;
    filenames: string[];
  },
): FitEvidence {
  const evidence: FitEvidence = {
    exact_passes: 0,
    exact_failures: 0,
    family_passes: 0,
    family_failures: 0,
    quality_failures: 0,
    likely_hard_fail: false,
  };
  if (!profile) {
    return evidence;
  }

  const filenames = new Set(candidate.filenames);
  const peaks: number[] = [];
  const speeds: number[] = [];
  for (const obs of profile.observations) {
    const sameExact =
      (obs.filename && filenames.has(obs.filename)) ||
      (obs.model_store_id &&
        candidate.filenames.some(filename =>
          obs.model_store_id?.endsWith(filename),
        ));
    const sameFamily =
      obs.model_id === candidate.modelId ||
      obs.hf_model_id === candidate.hfModelId;
    if (!sameExact && !sameFamily) {
      continue;
    }
    const fit = obs.status === 'fit' || obs.status === 'quality-failed';
    const hardFail =
      obs.status === 'failed' &&
      ['memory', 'load', 'crash'].includes(obs.failure_class ?? '');
    if (sameExact) {
      if (fit) {
        evidence.exact_passes += obs.hits || 1;
      } else if (hardFail) {
        evidence.exact_failures += obs.hits || 1;
      }
    }
    if (sameFamily) {
      if (fit) {
        evidence.family_passes += obs.hits || 1;
      } else if (hardFail) {
        evidence.family_failures += obs.hits || 1;
      }
    }
    if (obs.status === 'quality-failed') {
      evidence.quality_failures += obs.hits || 1;
    }
    if (typeof obs.peak_memory_mb === 'number') {
      peaks.push(obs.peak_memory_mb);
    }
    if (typeof obs.tg_avg === 'number') {
      speeds.push(obs.tg_avg);
    }
    evidence.latest_status = evidence.latest_status ?? obs.status;
  }
  if (peaks.length > 0) {
    evidence.observed_peak_memory_mb = Math.min(...peaks);
  }
  if (speeds.length > 0) {
    evidence.fastest_tg_avg = Math.max(...speeds);
  }
  evidence.likely_hard_fail =
    evidence.exact_failures > evidence.exact_passes ||
    (evidence.exact_passes === 0 && evidence.family_failures >= 2);
  return evidence;
}
