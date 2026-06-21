import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useRoute} from '@react-navigation/native';
import RNDeviceInfo from 'react-native-device-info';
import {
  addNativeLogListener,
  initLlama,
  toggleNativeLog,
  type ContextParams,
  type LlamaContext,
} from 'llama.rn';
import {observer} from 'mobx-react';

import {modelStore} from '../../store';
import NativeHardwareInfo from '../../specs/NativeHardwareInfo';
import {getDeviceOptions} from '../../utils/deviceSelection';
import {getRecommendedThreadCount} from '../../utils/deviceCapabilities';
import {applyIOSMetalSafetyPolicy} from '../../utils/iosMetalPolicy';
import type {Model} from '../../utils/types';
import {
  BENCH_LOG_RE,
  deriveEffectiveBackend,
  deriveLogSignals,
  emptyLogSignals,
  requestSatisfiedBy,
  type LogSignals,
} from '../logSignals';
import {
  DEFAULT_BENCH_BASE_PARAMS,
  composeCellParams,
  type BenchBaseParams,
} from '../benchParams';
import {
  calculateQualityScore,
  deriveQualityCapabilities,
  runQualityTasks,
  type QualityCapability,
  type QualityTask,
  type QualityTaskResult,
} from '../qualityTasks';
import {buildDefaultIosFitConfig} from '../defaultIosFitConfig';
import {
  buildDynamicIosFitConfig,
  isIosFitCandidateCatalog,
  isIosFitDeviceFitProfile,
  type IosFitCandidateCatalog,
} from '../iosFitDiscovery';
import {
  updateFitProfileFromReport,
  type IosFitDeviceFitProfile,
} from '../iosFitProfile';
import {getUnsafeIosTurbo2BenchmarkReason} from '../iosBenchmarkSafety';

// Top-level require keeps RNFS access DCE-friendly (matches the
// MemoryAdapter pattern). The whole module is gated behind __E2E__ at
// every reachable import site (App.tsx, deepLink.ts, useDeepLinking.ts),
// so this require is unreachable in prod.

const RNFS = require('@dr.pogodin/react-native-fs');

// Runtime-referenced marker for the CI bundle-grep — see .github/workflows/ci.yml.
// MUST be referenced INSIDE a runtime branch (not just JSDoc) so Hermes cannot
// DCE the literal as dead code. We log it from onRun below.
const BENCH_RUN_MATRIX = 'BENCH_RUN_MATRIX';

function getBenchStorageRoot(): string {
  const candidates =
    Platform.OS === 'android'
      ? [
          RNFS.ExternalDirectoryPath,
          RNFS.DocumentDirectoryPath,
          RNFS.CachesDirectoryPath,
        ]
      : [
          RNFS.DocumentDirectoryPath,
          RNFS.LibraryDirectoryPath,
          RNFS.CachesDirectoryPath,
          RNFS.TemporaryDirectoryPath,
          RNFS.ExternalDirectoryPath,
        ];
  const root = candidates.find(
    (path: unknown): path is string =>
      typeof path === 'string' && path.length > 0 && path !== 'null',
  );
  if (!root) {
    throw new Error(`bench-storage-root-missing:${Platform.OS}`);
  }
  return root;
}

const configPath = () => `${getBenchStorageRoot()}/bench-config.json`;
const reportPath = (timestamp: string) =>
  `${getBenchStorageRoot()}/benchmark-report-${timestamp}.json`;
const latestReportPath = () =>
  `${getBenchStorageRoot()}/benchmark-latest-report.json`;
const bestCandidatePath = () =>
  `${getBenchStorageRoot()}/benchmark-best-candidate.json`;
const resultCachePath = () =>
  `${getBenchStorageRoot()}/benchmark-result-cache.json`;
const completedCellCachePath = () =>
  `${getBenchStorageRoot()}/benchmark-completed-cell-cache.json`;
const candidateCatalogPath = () =>
  `${getBenchStorageRoot()}/benchmark-candidate-catalog.json`;
const deviceFitProfilePath = () =>
  `${getBenchStorageRoot()}/benchmark-device-fit-profile.json`;

type Status = string; // 'idle' | 'preparing:<phase>' | 'downloading:<f>[ <pct>%]' | 'running:<i/n>:<tag>' (tag may include /<key=val;...> override suffix) | 'cell-failed:<i/n>:<msg>' | 'skipped:<i/n>:<reason>' | 'complete' | 'error:<msg>'

/** Closed enum for the requested-backend axis. Hexagon (Qualcomm NPU) is a
 * third backend value, distinct from cpu/gpu, and gated by the same
 * fail-fast pattern as `gpu` — if the device has no Hexagon, hexagon cells
 * fail and the matrix continues. (WHAT §1a, §8 D1.) */
export type Backend = 'cpu' | 'gpu' | 'hexagon';

/** Closed enum of fingerprint-eligible knobs. Adding a knob is a
 * fingerprint-version bump (WHAT §4d.1 — fixed contract). */
export type SettingsKnob =
  | 'cache_type_k'
  | 'cache_type_v'
  | 'flash_attn_type'
  | 'no_extra_bufts'
  | 'use_mmap'
  | 'n_threads';

/** Value domain for sweep axes. The actual per-knob domain is enforced at
 * config-build time (WHAT §4b.4); values reach the screen pre-validated. */
export type SettingsValue = string | number | boolean;

export interface SettingsAxis {
  name: SettingsKnob;
  values: SettingsValue[];
}

export interface BenchContextVariant {
  id: string;
  label?: string;
  init_params?: Partial<ContextParams>;
}

interface BenchVariant {
  quant: string;
  filename: string;
  /** Optional GGUF size in bytes. Bypasses the pre-flight space check when
   * absent (set to 1). Provide it from bench-config to honour the real
   * disk-space gate; the implementer can fetch it from HF's API if needed. */
  size?: number;
  /** Optional per-variant context variants. Overrides model/global variants. */
  context_variants?: BenchContextVariant[];
}

interface BenchModelEntry {
  id: string;
  hfModelId: string;
  quants: BenchVariant[];
  /** Optional per-entry backend override. When omitted, the top-level
   * `backends` list is used. This lets the iOS fit ladder run Metal for the
   * full model set while adding a tiny CPU reference set without doubling the
   * entire matrix. */
  backends?: Backend[];
  /** Optional per-model context variants. Overrides global variants. */
  context_variants?: BenchContextVariant[];
}

export interface BenchConfig {
  models: BenchModelEntry[];
  backends: Backend[];
  bench?: {pp: number; tg: number; pl: number; nr: number};
  /** Optional suite metadata. Used by generated iOS fit configs to record
   * the target profile and promotion/scoring intent without changing the
   * existing matrix shape. */
  suite?: {
    id: string;
    label?: string;
    target_device?: Record<string, unknown>;
    selection?: {
      mode: 'promote_best';
      min_quality_score?: number;
      scorer?: string;
    };
    candidate_discovery?: Record<string, unknown>;
  };
  /** Optional base context overrides for a whole run. Per-cell settings_axes
   * still win. This lets device profiles raise n_ctx / mmap defaults without
   * turning those into cartesian-product axes. */
  base_params?: Partial<BenchBaseParams>;
  /** Optional post-throughput quality tasks. Rows stay status:ok when the
   * throughput bench succeeds; quality_passed/quality_score decide baseline
   * eligibility. */
  quality_tasks?: QualityTask[];
  /** Sweep axes for per-cell context-init overrides. Optional/absent means
   * "no sweep" — the matrix produces one cell per (model, variant, backend)
   * with empty overrides and the reserved `app-default` fingerprint
   * (WHAT §1a, §2, §4d D7). */
  settings_axes?: SettingsAxis[];
  /** Optional context-init variants. Used for quality-gated probes like
   * MTP speculative decoding without overloading settings_axes, which is
   * reserved for user-facing fingerprint knobs. */
  context_variants?: BenchContextVariant[];
  /** Wall-time (ms) to wait between cells, after `ctx.release()` resolves.
   * Two purposes layered together:
   *   1. Backend drivers (Adreno OpenCL command-queue tear-down on a worker
   *      thread, Hexagon HTP FastRPC teardown) defer their final memory
   *      release a few hundred ms past the JSI-promise boundary. ≥200ms is
   *      enough for that.
   *   2. **Thermal stabilisation** — long matrix runs see CPU/SoC/battery
   *      temperatures climb monotonically across cells (≈1°C per cell on
   *      Snapdragon under sustained pp+tg load), and a hot device throttles
   *      mid-cell, distorting pp/tg numbers. Setting this to e.g. 15-60s
   *      gives the cooling system a window to bring temperatures back to a
   *      stable working range before the next cell.
   * Default 2000ms when absent (driver-release insurance only — does NOT
   * stabilise thermals on hot devices). Operators tune higher in the
   * pushed bench-config.json without rebuilding the APK. The effective
   * value is echoed in the report's top-level `inter_cell_settle_ms`. */
  inter_cell_settle_ms?: number;
}

/** Effective backend after parsing native-log signals. Mirrors the
 * parser enum in logSignals.ts. `gpu` cells resolve to OpenCL on Android
 * or Metal on iOS. */
export type EffectiveBackend =
  | 'cpu'
  | 'opencl'
  | 'cpu+opencl-partial'
  | 'metal'
  | 'cpu+metal-partial'
  | 'hexagon'
  | 'cpu+hexagon-partial'
  | 'unknown';

interface BenchmarkRunRow {
  model_id: string;
  quant: string;
  requested_backend: Backend;
  effective_backend: EffectiveBackend;
  context_variant_id?: string;
  context_variant_label?: string;
  context_variant_params?: Record<string, unknown>;
  pp_avg: number | null;
  tg_avg: number | null;
  completion_tg_avg?: number | null;
  wall_ms: number;
  peak_memory_mb: number | null;
  memory_before?: MemorySample | null;
  memory_after?: MemorySample | null;
  memory_peak?: MemorySample | null;
  memory_snapshots?: MemorySnapshotRefs;
  log_signals: LogSignals;
  init_settings: Record<string, unknown>;
  /** Exact params passed to llama.rn's initLlama, captured BEFORE
   * initContext fires. Distinct from `init_settings` (which snapshots
   * `modelStore.contextInitParams` AFTER init). The store may carry
   * symbolic values like `use_mmap='smart'` that resolve to concrete
   * booleans only via `getEffectiveContextInitParams(filePath)`. This
   * field captures what the runtime actually saw. Diagnostic for
   * cross-cell or cross-session state leaks. */
  effective_init_params: Record<string, unknown>;
  native_context?: {
    gpu: boolean;
    devices: string[];
    reasonNoGPU: string;
    systemInfo?: string;
  };
  /** What the cell asked for. Always present (possibly `{}`) — single
   * writer is `runMatrix` (WHAT §4h I1, §5). */
  settings_overrides: Partial<Record<SettingsKnob, SettingsValue>>;
  /** Canonical fingerprint identifying the cell's settings configuration.
   * Pure function of `init_settings` (success / post-init failure path) or
   * the matrix-level pre-run snapshot overlaid with overrides (pre-init
   * failure path, prefixed `req:`). The reserved literal `app-default` is
   * minted only when no `settings_axes` was passed in config and the cell
   * has empty overrides (WHAT §4d, §4h I2/I3, §9c). */
  settings_fingerprint: string;
  quality_results?: QualityTaskResult[];
  quality_score?: number | null;
  quality_passed?: boolean | null;
  quality_capabilities?: QualityCapability[];
  status: 'ok' | 'skipped' | 'failed';
  reason?: string;
  error?: string;
  timestamp: string;
}

export interface BenchmarkBestCandidate {
  model_id: string;
  hf_model_id: string;
  model_store_id: string;
  filename: string;
  quant: string;
  requested_backend: Backend;
  effective_backend: EffectiveBackend;
  context_variant_id?: string;
  context_variant_label?: string;
  settings_fingerprint: string;
  file_path?: string;
  size_bytes?: number;
  rank_score: number;
  quality_score: number | null;
  quality_passed: boolean | null;
  quality_capabilities?: QualityCapability[];
  pp_avg: number;
  tg_avg: number;
  completion_tg_avg?: number | null;
  peak_memory_mb: number | null;
  promoted_at: string;
}

interface BenchmarkStorageState {
  kept_model_id: string | null;
  kept_filename: string | null;
  deleted_model_ids: string[];
  deleted_count: number;
  reclaimed_bytes_estimate: number;
  last_deleted_model_ids?: string[];
  last_deleted_count?: number;
  last_reclaimed_bytes_estimate?: number;
  last_cleanup_at: string;
  errors?: string[];
}

interface BenchmarkResultCacheEntry {
  key: string;
  outcome: 'quality_failed';
  model_id: string;
  quant: string;
  filename: string;
  requested_backend: Backend;
  context_variant_id?: string;
  context_variant_label?: string;
  settings_fingerprint: string;
  settings_overrides: Partial<Record<SettingsKnob, SettingsValue>>;
  quality_task_signature: string;
  quality_score: number | null;
  quality_results: QualityTaskResult[];
  failed_task_ids: string[];
  quality_capabilities?: QualityCapability[];
  effective_backend: EffectiveBackend;
  pp_avg: number;
  tg_avg: number;
  completion_tg_avg?: number | null;
  peak_memory_mb: number | null;
  first_seen_at: string;
  last_seen_at: string;
  hits: number;
}

interface BenchmarkResultCache {
  version: 1;
  updated_at: string;
  entries: BenchmarkResultCacheEntry[];
}

interface BenchmarkResultCacheState {
  path: string;
  loaded_entries: number;
  quality_failure_entries: number;
  skipped_quality_failures: number;
  completed_entries?: number;
  skipped_completed_cells?: number;
  last_skip_key?: string;
  last_completed_skip_key?: string;
  last_written_at?: string;
  errors?: string[];
}

interface BenchmarkCompletedCellCacheEntry {
  key: string;
  outcome: 'completed_cell';
  model_id: string;
  quant: string;
  filename: string;
  requested_backend: Backend;
  context_variant_id?: string;
  context_variant_label?: string;
  settings_fingerprint: string;
  settings_overrides: Partial<Record<SettingsKnob, SettingsValue>>;
  quality_task_signature: string;
  row: BenchmarkRunRow;
  first_seen_at: string;
  last_seen_at: string;
  hits: number;
}

interface BenchmarkCompletedCellCache {
  version: 1;
  updated_at: string;
  entries: BenchmarkCompletedCellCacheEntry[];
}

interface BenchmarkLeaderboardEntry extends BenchmarkBestCandidate {
  source: 'persisted-best' | 'run';
}

interface BenchmarkLiveUpdate {
  pp?: number;
  tg?: number;
  cells?: number;
  total?: number;
  failed?: number;
  skipped?: number;
  latest?: BenchmarkLatestCellSummary | null;
  best?: BenchmarkBestCandidate | null;
  leaderboard?: BenchmarkLeaderboardEntry[];
  storage?: BenchmarkStorageState | null;
  cache?: BenchmarkResultCacheState | null;
}

interface BenchmarkLatestCellSummary {
  model_id: string;
  filename: string;
  quant: string;
  requested_backend: Backend;
  effective_backend: EffectiveBackend;
  context_variant_id?: string;
  context_variant_label?: string;
  settings_fingerprint: string;
  status: BenchmarkRunRow['status'];
  reason?: string;
  error?: string;
  pp_avg: number | null;
  tg_avg: number | null;
  completion_tg_avg?: number | null;
  quality_score?: number | null;
  quality_passed?: boolean | null;
  quality_capabilities?: QualityCapability[];
  rank_score?: number | null;
}

interface BenchmarkCellMarker {
  cell_index: number;
  total_cells: number;
  tag: string;
  model_id: string;
  quant: string;
  requested_backend: Backend;
  context_variant_id?: string;
  context_variant_label?: string;
  settings_overrides: Partial<Record<SettingsKnob, SettingsValue>>;
  started_at: string;
  phase?: 'running' | 'releasing';
  status?: BenchmarkRunRow['status'];
  completed_at?: string;
  release_started_at?: string;
  release_completed_at?: string;
  error?: string;
}

interface BenchmarkReport {
  version: '1.1';
  platform: typeof Platform.OS;
  timestamp: string;
  preseeded: boolean;
  bench: {pp: number; tg: number; pl: number; nr: number};
  /** Echo of the effective inter-cell settle (ms) actually used by this
   * run. Always present; resolves the config's `inter_cell_settle_ms`
   * with the 2000ms default. Useful for thermal-throttling forensics
   * when comparing two reports captured under different settle values. */
  inter_cell_settle_ms: number;
  /** Echo of `config.settings_axes` when the run had axes. Omitted when the
   * config had none (WHAT §1e, §9a — empty array MUST NOT be emitted). */
  settings_axes_used?: SettingsAxis[];
  context_variants_used?: BenchContextVariant[];
  suite?: BenchConfig['suite'];
  base_params_used?: Partial<BenchBaseParams>;
  quality_tasks_used?: QualityTask[];
  device_profile?: RuntimeDeviceProfile;
  /** Crash breadcrumb. Written before each cell starts so a process death
   * during init/bench/quality can still be attributed to an exact matrix
   * cell when the partial JSON is pulled from the device. Cleared after
   * the cell row is appended. */
  current_cell?: BenchmarkCellMarker | null;
  last_started_cell?: BenchmarkCellMarker;
  last_completed_cell?: BenchmarkCellMarker;
  best_candidate?: BenchmarkBestCandidate | null;
  leaderboard?: BenchmarkLeaderboardEntry[];
  storage?: BenchmarkStorageState | null;
  result_cache?: BenchmarkResultCacheState | null;
  fit_profile?: {
    path: string;
    observations: number;
    updated_at?: string;
    errors?: string[];
  } | null;
  runs: BenchmarkRunRow[];
}

const DEFAULT_BENCH = {pp: 512, tg: 128, pl: 1, nr: 3};
const TRUNCATE_ERROR = 200; // status string error length
const TRUNCATE_ROW_ERROR = 500; // row.error length
const PEAK_POLL_MS = 1000;
const DEFAULT_INTER_CELL_SETTLE_MS = 2000;
const RESULT_CACHE_VERSION = 1;
const MAX_RESULT_CACHE_ENTRIES = 512;
const COMPLETED_CELL_CACHE_VERSION = 1;
const MAX_COMPLETED_CELL_CACHE_ENTRIES = 1024;

async function readJsonIfExists<T>(
  path: string,
  guard: (value: unknown) => value is T,
): Promise<T | null> {
  try {
    if (!(await RNFS.exists(path))) {
      return null;
    }
    const parsed = JSON.parse(await RNFS.readFile(path, 'utf8'));
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPersistedBestCandidateSeed(value: unknown): value is {
  model_id: string;
  hf_model_id: string;
  filename: string;
  quant: string;
  size_bytes?: number;
} {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.model_id === 'string' &&
    typeof candidate.hf_model_id === 'string' &&
    typeof candidate.filename === 'string' &&
    typeof candidate.quant === 'string'
  );
}

async function readCandidateCatalog(): Promise<IosFitCandidateCatalog | null> {
  return readJsonIfExists(candidateCatalogPath(), isIosFitCandidateCatalog);
}

async function readDeviceFitProfile(): Promise<IosFitDeviceFitProfile | null> {
  return readJsonIfExists(deviceFitProfilePath(), isIosFitDeviceFitProfile);
}

async function readPersistedBestCandidateSeed() {
  return readJsonIfExists(bestCandidatePath(), isPersistedBestCandidateSeed);
}

async function writeCandidateCatalog(catalog: IosFitCandidateCatalog) {
  await RNFS.writeFile(
    candidateCatalogPath(),
    JSON.stringify(catalog, null, 2),
    'utf8',
  );
}

async function writeDeviceFitProfile(profile: IosFitDeviceFitProfile) {
  await RNFS.writeFile(
    deviceFitProfilePath(),
    JSON.stringify(profile, null, 2),
    'utf8',
  );
}

function isJestRuntime(): boolean {
  return (
    typeof process !== 'undefined' && process.env?.JEST_WORKER_ID !== undefined
  );
}

function shouldRefreshRemoteCandidateCatalog(): boolean {
  return !isJestRuntime();
}

function shouldPersistDeviceFitProfile(): boolean {
  return !isJestRuntime();
}

function isRefreshableGeneratedConfig(value: unknown): value is BenchConfig {
  const discovery = (value as BenchConfig | undefined)?.suite
    ?.candidate_discovery;
  if (discovery?.generated_by === 'ios-fit-dynamic-discovery') {
    return true;
  }
  const suite = (value as BenchConfig | undefined)?.suite;
  const notes = suite?.target_device?.notes;
  return (
    suite?.id === 'ios-fit-ladder' &&
    Array.isArray(notes) &&
    notes.some(
      note =>
        typeof note === 'string' &&
        note.includes(
          'Generated in-app when no pushed bench-config.json exists',
        ),
    )
  );
}

async function buildAndWriteGeneratedConfig(
  path: string,
): Promise<BenchConfig> {
  const deviceProfile = await captureRuntimeDeviceProfile();
  const [fitProfile, cachedCatalog, persistedBest] = await Promise.all([
    readDeviceFitProfile(),
    readCandidateCatalog(),
    readPersistedBestCandidateSeed(),
  ]);
  try {
    const generated = await buildDynamicIosFitConfig({
      deviceProfile,
      fitProfile,
      cachedCatalog,
      persistedBest,
      refreshRemote: shouldRefreshRemoteCandidateCatalog(),
    });
    await RNFS.writeFile(
      path,
      JSON.stringify(generated.config, null, 2),
      'utf8',
    );
    await writeCandidateCatalog(generated.catalog).catch(() => undefined);
    return generated.config;
  } catch {
    const cfg = buildDefaultIosFitConfig();
    await RNFS.writeFile(path, JSON.stringify(cfg, null, 2), 'utf8');
    return cfg;
  }
}

async function loadConfig(): Promise<BenchConfig> {
  const path = configPath();
  const exists = await RNFS.exists(path);
  if (!exists) {
    return buildAndWriteGeneratedConfig(path);
  }
  const raw = await RNFS.readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as BenchConfig;
  return isRefreshableGeneratedConfig(parsed)
    ? buildAndWriteGeneratedConfig(path)
    : parsed;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  const primitive = JSON.stringify(value);
  return primitive === undefined ? 'undefined' : primitive;
}

function qualityTaskSignature(tasks: QualityTask[] | undefined): string {
  return stableJson(
    (tasks ?? []).map(task => ({
      id: task.id,
      kind: task.kind,
      weight: task.weight ?? null,
      timeout_ms: task.timeout_ms ?? null,
      n_predict: task.n_predict ?? null,
      context_chars: task.context_chars ?? null,
    })),
  );
}

interface MemorySample {
  total_bytes: number | null;
  used_bytes: number | null;
  available_bytes: number | null;
  used_pct: number | null;
}

interface MemorySnapshotRef {
  label: string;
  status: string;
}

interface MemorySnapshotRefs {
  pre_init?: MemorySnapshotRef | null;
  post_init?: MemorySnapshotRef | null;
  post_quality?: MemorySnapshotRef | null;
}

interface RuntimeDeviceProfile {
  platform: typeof Platform.OS;
  device_id: string | null;
  model: string | null;
  device: string | null;
  system_name: string | null;
  system_version: string | null;
  total_memory_bytes: number | null;
  available_memory_bytes: number | null;
  cpu: unknown | null;
  gpu: unknown | null;
  metal: unknown | null;
}

function safeSync<T>(fn: (() => T) | undefined): T | null {
  try {
    return typeof fn === 'function' ? fn() : null;
  } catch {
    return null;
  }
}

async function safeAsync<T>(
  fn: (() => Promise<T>) | undefined,
): Promise<T | null> {
  try {
    return typeof fn === 'function' ? await fn() : null;
  } catch {
    return null;
  }
}

async function captureRuntimeDeviceProfile(): Promise<RuntimeDeviceProfile> {
  const [device, totalMemory, availableMemory, cpu, gpu, metal] =
    await Promise.all([
      safeAsync(RNDeviceInfo.getDevice?.bind(RNDeviceInfo)),
      safeAsync(RNDeviceInfo.getTotalMemory?.bind(RNDeviceInfo)),
      safeAsync(
        NativeHardwareInfo.getAvailableMemory?.bind(NativeHardwareInfo),
      ),
      safeAsync(NativeHardwareInfo.getCPUInfo?.bind(NativeHardwareInfo)),
      safeAsync(NativeHardwareInfo.getGPUInfo?.bind(NativeHardwareInfo)),
      safeAsync(NativeHardwareInfo.getMetalInfo?.bind(NativeHardwareInfo)),
    ]);
  return {
    platform: Platform.OS,
    device_id: safeSync(RNDeviceInfo.getDeviceId?.bind(RNDeviceInfo)),
    model: safeSync(RNDeviceInfo.getModel?.bind(RNDeviceInfo)),
    device,
    system_name: safeSync(RNDeviceInfo.getSystemName?.bind(RNDeviceInfo)),
    system_version: safeSync(RNDeviceInfo.getSystemVersion?.bind(RNDeviceInfo)),
    total_memory_bytes: totalMemory,
    available_memory_bytes: availableMemory,
    cpu,
    gpu,
    metal,
  };
}

async function sampleMemory(): Promise<MemorySample | null> {
  try {
    const [total, used, available] = await Promise.all([
      safeAsync(RNDeviceInfo.getTotalMemory?.bind(RNDeviceInfo)),
      safeAsync(RNDeviceInfo.getUsedMemory?.bind(RNDeviceInfo)),
      safeAsync(
        NativeHardwareInfo.getAvailableMemory?.bind(NativeHardwareInfo),
      ),
    ]);
    if (total == null && used == null && available == null) {
      return null;
    }
    return {
      total_bytes: total,
      used_bytes: used,
      available_bytes: available,
      used_pct:
        typeof total === 'number' && total > 0 && typeof used === 'number'
          ? Math.round((used / total) * 10_000) / 100
          : null,
    };
  } catch {
    return null;
  }
}

async function writeMemorySnapshot(
  label: string,
): Promise<MemorySnapshotRef | null> {
  try {
    const result = await NativeHardwareInfo.writeMemorySnapshot(label);
    return {label: result.label, status: result.status};
  } catch {
    return null;
  }
}

function pickPeakMemory(
  current: MemorySample | null,
  candidate: MemorySample | null,
): MemorySample | null {
  if (!candidate) {
    return current;
  }
  if (!current) {
    return candidate;
  }
  const currentUsed = current.used_bytes ?? -1;
  const candidateUsed = candidate.used_bytes ?? -1;
  if (candidateUsed > currentUsed) {
    return candidate;
  }
  return current;
}

function memoryPeakMb(sample: MemorySample | null): number | null {
  const usedBytes = sample?.used_bytes;
  return typeof usedBytes === 'number'
    ? Math.round((usedBytes / (1024 * 1024)) * 100) / 100
    : null;
}

function safeLabel(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 96);
}

function benchmarkModelStoreId(
  model: BenchModelEntry,
  variant: BenchVariant,
): string {
  return `${model.hfModelId}/${variant.filename}`;
}

function collectBenchmarkModelIds(config: BenchConfig): Set<string> {
  const ids = new Set<string>();
  for (const model of config.models) {
    for (const variant of model.quants) {
      ids.add(benchmarkModelStoreId(model, variant));
    }
  }
  return ids;
}

function findBenchVariant(
  config: BenchConfig,
  row: Pick<BenchmarkRunRow, 'model_id' | 'quant'>,
): {model: BenchModelEntry; variant: BenchVariant} | null {
  const model = config.models.find(entry => entry.id === row.model_id);
  const variant = model?.quants.find(entry => entry.quant === row.quant);
  return model && variant ? {model, variant} : null;
}

function findDownloadedBenchmarkModel(
  model: BenchModelEntry,
  variant: BenchVariant,
): Model | undefined {
  const expectedId = benchmarkModelStoreId(model, variant);
  return (
    modelStore.models.find(
      (candidate: Model) =>
        candidate.id === expectedId && candidate.isDownloaded,
    ) ??
    modelStore.models.find(
      (candidate: Model) =>
        candidate.filename === variant.filename && candidate.isDownloaded,
    )
  );
}

function rowEligibleForPromotion(
  row: BenchmarkRunRow,
  _config: BenchConfig,
): boolean {
  if (row.status !== 'ok' || row.pp_avg == null || row.tg_avg == null) {
    return false;
  }
  // Quality is a scoring signal, not a visibility/storage gate. If every
  // early row fails quality, the operator still needs live ranking and the
  // disk-pruner still needs a best-so-far model to preserve. Passing quality
  // receives a large score bonus in scoreBenchmarkRow().
  return true;
}

function averageCompletionTg(
  qualityResults: QualityTaskResult[] | undefined,
): number | null {
  const speeds = (qualityResults ?? [])
    .map(result => result.predicted_per_second)
    .filter(
      (speed): speed is number =>
        typeof speed === 'number' && Number.isFinite(speed) && speed > 0,
    );
  if (speeds.length === 0) {
    return null;
  }
  const average = speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length;
  return Math.round(average * 1000) / 1000;
}

function rankGenerationSpeed(
  row: Pick<BenchmarkRunRow, 'tg_avg' | 'completion_tg_avg'>,
): number {
  const benchTg = typeof row.tg_avg === 'number' ? row.tg_avg : 0;
  const completionTg =
    typeof row.completion_tg_avg === 'number' ? row.completion_tg_avg : 0;
  return Math.max(benchTg, completionTg);
}

export function scoreBenchmarkRow(row: BenchmarkRunRow): number | null {
  if (row.status !== 'ok' || row.pp_avg == null || row.tg_avg == null) {
    return null;
  }

  const quality =
    row.quality_score ??
    (row.quality_passed === false ? 0 : row.quality_passed === true ? 1 : 1);
  const memoryPenalty =
    typeof row.peak_memory_mb === 'number' ? row.peak_memory_mb * 0.1 : 0;
  const score =
    quality * 1_000_000 +
    rankGenerationSpeed(row) * 1000 +
    row.pp_avg -
    memoryPenalty;
  return Math.round(score * 1000) / 1000;
}

function compareCandidates(
  a: Pick<
    BenchmarkBestCandidate,
    | 'rank_score'
    | 'quality_score'
    | 'tg_avg'
    | 'completion_tg_avg'
    | 'pp_avg'
    | 'peak_memory_mb'
  >,
  b: Pick<
    BenchmarkBestCandidate,
    | 'rank_score'
    | 'quality_score'
    | 'tg_avg'
    | 'completion_tg_avg'
    | 'pp_avg'
    | 'peak_memory_mb'
  >,
): number {
  if (a.rank_score !== b.rank_score) {
    return a.rank_score - b.rank_score;
  }
  const qualityDelta = (a.quality_score ?? -1) - (b.quality_score ?? -1);
  if (qualityDelta !== 0) {
    return qualityDelta;
  }
  const aRankTg = Math.max(a.tg_avg, a.completion_tg_avg ?? 0);
  const bRankTg = Math.max(b.tg_avg, b.completion_tg_avg ?? 0);
  if (aRankTg !== bRankTg) {
    return aRankTg - bRankTg;
  }
  if (a.pp_avg !== b.pp_avg) {
    return a.pp_avg - b.pp_avg;
  }
  return (
    (b.peak_memory_mb ?? Number.MAX_SAFE_INTEGER) -
    (a.peak_memory_mb ?? Number.MAX_SAFE_INTEGER)
  );
}

function buildCandidateFromRow(args: {
  row: BenchmarkRunRow;
  config: BenchConfig;
  resolvedModel?: Model;
  filePath?: string;
  source?: BenchmarkLeaderboardEntry['source'];
}): BenchmarkLeaderboardEntry | null {
  const {row, config, resolvedModel, filePath, source = 'run'} = args;
  if (!rowEligibleForPromotion(row, config)) {
    return null;
  }
  const match = findBenchVariant(config, row);
  if (!match || row.pp_avg == null || row.tg_avg == null) {
    return null;
  }
  const rankScore = scoreBenchmarkRow(row);
  if (rankScore == null) {
    return null;
  }
  return {
    source,
    model_id: row.model_id,
    hf_model_id: match.model.hfModelId,
    model_store_id:
      resolvedModel?.id ?? benchmarkModelStoreId(match.model, match.variant),
    filename: resolvedModel?.filename ?? match.variant.filename,
    quant: row.quant,
    requested_backend: row.requested_backend,
    effective_backend: row.effective_backend,
    context_variant_id: row.context_variant_id ?? BASELINE_CONTEXT_VARIANT_ID,
    context_variant_label:
      row.context_variant_label ?? formatContextVariant(row),
    settings_fingerprint: row.settings_fingerprint,
    file_path: filePath,
    size_bytes: resolvedModel?.size ?? match.variant.size,
    rank_score: rankScore,
    quality_score: row.quality_score ?? null,
    quality_passed: row.quality_passed ?? null,
    quality_capabilities: row.quality_capabilities,
    pp_avg: row.pp_avg,
    tg_avg: row.tg_avg,
    completion_tg_avg: row.completion_tg_avg ?? null,
    peak_memory_mb: row.peak_memory_mb,
    promoted_at: new Date().toISOString(),
  };
}

function buildLeaderboard(
  config: BenchConfig,
  runs: BenchmarkRunRow[],
  bestCandidate: BenchmarkBestCandidate | null,
): BenchmarkLeaderboardEntry[] {
  const byKey = new Map<string, BenchmarkLeaderboardEntry>();
  const put = (candidate: BenchmarkLeaderboardEntry) => {
    const key = [
      candidate.model_store_id,
      candidate.requested_backend,
      candidate.context_variant_id ?? BASELINE_CONTEXT_VARIANT_ID,
      candidate.settings_fingerprint,
    ].join('|');
    const existing = byKey.get(key);
    if (!existing || compareCandidates(candidate, existing) > 0) {
      byKey.set(key, candidate);
    }
  };

  if (bestCandidate) {
    put({...bestCandidate, source: 'persisted-best'});
  }

  for (const row of runs) {
    const candidate = buildCandidateFromRow({row, config});
    if (candidate) {
      put(candidate);
    }
  }

  return Array.from(byKey.values())
    .sort((a, b) => compareCandidates(b, a))
    .slice(0, 8);
}

function isCandidateFromConfig(
  candidate: BenchmarkBestCandidate | null,
  config: BenchConfig,
): candidate is BenchmarkBestCandidate {
  return (
    !!candidate &&
    collectBenchmarkModelIds(config).has(candidate.model_store_id)
  );
}

async function readBestCandidate(
  config: BenchConfig,
): Promise<BenchmarkBestCandidate | null> {
  try {
    const path = bestCandidatePath();
    if (!(await RNFS.exists(path))) {
      return null;
    }
    const parsed = JSON.parse(
      await RNFS.readFile(path, 'utf8'),
    ) as BenchmarkBestCandidate;
    if (!isCandidateFromConfig(parsed, config)) {
      return null;
    }
    if (parsed.file_path && !(await RNFS.exists(parsed.file_path))) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeBestCandidate(candidate: BenchmarkBestCandidate) {
  await RNFS.writeFile(
    bestCandidatePath(),
    JSON.stringify(candidate, null, 2),
    'utf8',
  );
}

function isProtectedBenchmarkModel(
  model: Model,
  bestCandidate: BenchmarkBestCandidate | null,
  protectedIds: Set<string>,
): boolean {
  if (protectedIds.has(model.id)) {
    return true;
  }
  if (!bestCandidate) {
    return false;
  }
  return (
    model.id === bestCandidate.model_store_id ||
    (model.filename === bestCandidate.filename &&
      bestCandidate.file_path !== undefined)
  );
}

async function pruneBenchmarkModels(args: {
  config: BenchConfig;
  bestCandidate: BenchmarkBestCandidate | null;
  protectedModelIds?: string[];
}): Promise<BenchmarkStorageState> {
  const benchmarkIds = collectBenchmarkModelIds(args.config);
  const protectedIds = new Set(args.protectedModelIds ?? []);
  const deletedModelIds: string[] = [];
  const errors: string[] = [];
  let reclaimedBytesEstimate = 0;

  for (const model of [...modelStore.models] as Model[]) {
    if (!model.isDownloaded || !benchmarkIds.has(model.id)) {
      continue;
    }
    if (isProtectedBenchmarkModel(model, args.bestCandidate, protectedIds)) {
      continue;
    }
    try {
      reclaimedBytesEstimate +=
        typeof model.size === 'number' && Number.isFinite(model.size)
          ? model.size
          : 0;
      await modelStore.deleteModel(model);
      deletedModelIds.push(model.id);
    } catch (error) {
      errors.push(`${model.id}:${String(error).slice(0, TRUNCATE_ERROR)}`);
    }
  }

  return {
    kept_model_id: args.bestCandidate?.model_store_id ?? null,
    kept_filename: args.bestCandidate?.filename ?? null,
    deleted_model_ids: deletedModelIds,
    deleted_count: deletedModelIds.length,
    reclaimed_bytes_estimate: reclaimedBytesEstimate,
    last_deleted_model_ids: deletedModelIds,
    last_deleted_count: deletedModelIds.length,
    last_reclaimed_bytes_estimate: reclaimedBytesEstimate,
    last_cleanup_at: new Date().toISOString(),
    errors: errors.length > 0 ? errors : undefined,
  };
}

function accumulateStorageState(
  previous: BenchmarkStorageState | null | undefined,
  latest: BenchmarkStorageState,
): BenchmarkStorageState {
  if (!previous) {
    return latest;
  }
  const errors = [...(previous.errors ?? []), ...(latest.errors ?? [])];
  return {
    ...latest,
    deleted_model_ids: [
      ...previous.deleted_model_ids,
      ...latest.deleted_model_ids,
    ],
    deleted_count: previous.deleted_count + latest.deleted_count,
    reclaimed_bytes_estimate:
      previous.reclaimed_bytes_estimate + latest.reclaimed_bytes_estimate,
    last_deleted_model_ids: latest.deleted_model_ids,
    last_deleted_count: latest.deleted_count,
    last_reclaimed_bytes_estimate: latest.reclaimed_bytes_estimate,
    errors: errors.length > 0 ? errors : undefined,
  };
}

function buildLatestCellSummary(
  config: BenchConfig,
  row: BenchmarkRunRow | undefined,
): BenchmarkLatestCellSummary | null {
  if (!row) {
    return null;
  }
  const match = findBenchVariant(config, row);
  return {
    model_id: row.model_id,
    filename: match?.variant.filename ?? row.quant,
    quant: row.quant,
    requested_backend: row.requested_backend,
    effective_backend: row.effective_backend,
    context_variant_id: row.context_variant_id ?? BASELINE_CONTEXT_VARIANT_ID,
    context_variant_label:
      row.context_variant_label ?? formatContextVariant(row),
    settings_fingerprint: row.settings_fingerprint,
    status: row.status,
    reason: row.reason,
    error: row.error,
    pp_avg: row.pp_avg,
    tg_avg: row.tg_avg,
    completion_tg_avg: row.completion_tg_avg ?? null,
    quality_score: row.quality_score ?? null,
    quality_passed: row.quality_passed ?? null,
    quality_capabilities: row.quality_capabilities,
    rank_score: scoreBenchmarkRow(row),
  };
}

function emptyResultCache(): BenchmarkResultCache {
  return {
    version: RESULT_CACHE_VERSION,
    updated_at: new Date().toISOString(),
    entries: [],
  };
}

function normalizeResultCache(parsed: unknown): BenchmarkResultCache {
  const maybe = parsed as Partial<BenchmarkResultCache> | null;
  if (
    !maybe ||
    maybe.version !== RESULT_CACHE_VERSION ||
    !Array.isArray(maybe.entries)
  ) {
    return emptyResultCache();
  }
  return {
    version: RESULT_CACHE_VERSION,
    updated_at:
      typeof maybe.updated_at === 'string'
        ? maybe.updated_at
        : new Date().toISOString(),
    entries: maybe.entries.filter(
      (entry): entry is BenchmarkResultCacheEntry =>
        entry?.outcome === 'quality_failed' &&
        typeof entry.key === 'string' &&
        typeof entry.model_id === 'string' &&
        typeof entry.quant === 'string' &&
        typeof entry.filename === 'string' &&
        typeof entry.requested_backend === 'string' &&
        typeof entry.settings_fingerprint === 'string' &&
        typeof entry.quality_task_signature === 'string' &&
        Array.isArray(entry.quality_results),
    ),
  };
}

async function readResultCache(): Promise<{
  cache: BenchmarkResultCache;
  errors: string[];
}> {
  const errors: string[] = [];
  try {
    const path = resultCachePath();
    if (!(await RNFS.exists(path))) {
      return {cache: emptyResultCache(), errors};
    }
    const parsed = JSON.parse(await RNFS.readFile(path, 'utf8'));
    return {cache: normalizeResultCache(parsed), errors};
  } catch (error) {
    errors.push(String(error).slice(0, TRUNCATE_ERROR));
    return {cache: emptyResultCache(), errors};
  }
}

async function writeResultCache(cache: BenchmarkResultCache): Promise<void> {
  cache.updated_at = new Date().toISOString();
  if (cache.entries.length > MAX_RESULT_CACHE_ENTRIES) {
    cache.entries = [...cache.entries]
      .sort((a, b) => a.last_seen_at.localeCompare(b.last_seen_at))
      .slice(-MAX_RESULT_CACHE_ENTRIES);
  }
  await RNFS.writeFile(
    resultCachePath(),
    JSON.stringify(cache, null, 2),
    'utf8',
  );
}

function buildResultCacheState(
  cache: BenchmarkResultCache,
  skippedQualityFailures: number,
  lastSkipKey: string | undefined,
  completedCache?: BenchmarkCompletedCellCache,
  skippedCompletedCells = 0,
  lastCompletedSkipKey?: string,
  errors: string[] = [],
): BenchmarkResultCacheState {
  return {
    path: resultCachePath(),
    loaded_entries: cache.entries.length,
    quality_failure_entries: cache.entries.filter(
      entry => entry.outcome === 'quality_failed',
    ).length,
    skipped_quality_failures: skippedQualityFailures,
    completed_entries: completedCache?.entries.length,
    skipped_completed_cells: skippedCompletedCells,
    last_skip_key: lastSkipKey,
    last_completed_skip_key: lastCompletedSkipKey,
    last_written_at: cache.updated_at,
    errors: errors.length > 0 ? errors : undefined,
  };
}

function emptyCompletedCellCache(): BenchmarkCompletedCellCache {
  return {
    version: COMPLETED_CELL_CACHE_VERSION,
    updated_at: new Date().toISOString(),
    entries: [],
  };
}

function normalizeCompletedCellCache(
  parsed: unknown,
): BenchmarkCompletedCellCache {
  const maybe = parsed as Partial<BenchmarkCompletedCellCache> | null;
  if (
    !maybe ||
    maybe.version !== COMPLETED_CELL_CACHE_VERSION ||
    !Array.isArray(maybe.entries)
  ) {
    return emptyCompletedCellCache();
  }
  return {
    version: COMPLETED_CELL_CACHE_VERSION,
    updated_at:
      typeof maybe.updated_at === 'string'
        ? maybe.updated_at
        : new Date().toISOString(),
    entries: maybe.entries.filter(
      (entry): entry is BenchmarkCompletedCellCacheEntry =>
        entry?.outcome === 'completed_cell' &&
        typeof entry.key === 'string' &&
        typeof entry.model_id === 'string' &&
        typeof entry.quant === 'string' &&
        typeof entry.filename === 'string' &&
        typeof entry.requested_backend === 'string' &&
        typeof entry.settings_fingerprint === 'string' &&
        typeof entry.quality_task_signature === 'string' &&
        !!entry.row &&
        typeof entry.row.model_id === 'string' &&
        typeof entry.row.quant === 'string' &&
        typeof entry.row.requested_backend === 'string' &&
        typeof entry.row.status === 'string',
    ),
  };
}

async function readCompletedCellCache(): Promise<{
  cache: BenchmarkCompletedCellCache;
  errors: string[];
}> {
  const errors: string[] = [];
  try {
    const path = completedCellCachePath();
    if (!(await RNFS.exists(path))) {
      return {cache: emptyCompletedCellCache(), errors};
    }
    const parsed = JSON.parse(await RNFS.readFile(path, 'utf8'));
    return {cache: normalizeCompletedCellCache(parsed), errors};
  } catch (error) {
    errors.push(String(error).slice(0, TRUNCATE_ERROR));
    return {cache: emptyCompletedCellCache(), errors};
  }
}

async function writeCompletedCellCache(
  cache: BenchmarkCompletedCellCache,
): Promise<void> {
  cache.updated_at = new Date().toISOString();
  if (cache.entries.length > MAX_COMPLETED_CELL_CACHE_ENTRIES) {
    cache.entries = [...cache.entries]
      .sort((a, b) => a.last_seen_at.localeCompare(b.last_seen_at))
      .slice(-MAX_COMPLETED_CELL_CACHE_ENTRIES);
  }
  await RNFS.writeFile(
    completedCellCachePath(),
    JSON.stringify(cache, null, 2),
    'utf8',
  );
}

function findCompletedCellCacheEntry(
  cache: BenchmarkCompletedCellCache,
  key: string,
): BenchmarkCompletedCellCacheEntry | null {
  return cache.entries.find(entry => entry.key === key) ?? null;
}

function upsertCompletedCellCacheEntry(args: {
  cache: BenchmarkCompletedCellCache;
  key: string;
  model: BenchModelEntry;
  variant: BenchVariant;
  backend: Backend;
  row: BenchmarkRunRow;
  qualityTaskSignature: string;
}): boolean {
  const {cache, key, model, variant, backend, row, qualityTaskSignature} = args;
  const now = new Date().toISOString();
  const existing = cache.entries.find(entry => entry.key === key);
  const next: BenchmarkCompletedCellCacheEntry = {
    key,
    outcome: 'completed_cell',
    model_id: model.id,
    quant: variant.quant,
    filename: variant.filename,
    requested_backend: backend,
    context_variant_id: row.context_variant_id ?? BASELINE_CONTEXT_VARIANT_ID,
    context_variant_label:
      row.context_variant_label ?? formatContextVariant(row),
    settings_fingerprint: row.settings_fingerprint,
    settings_overrides: row.settings_overrides,
    quality_task_signature: qualityTaskSignature,
    row,
    first_seen_at: existing?.first_seen_at ?? now,
    last_seen_at: now,
    hits: existing?.hits ?? 0,
  };

  if (existing) {
    Object.assign(existing, next);
  } else {
    cache.entries.push(next);
  }
  return true;
}

function buildResultCacheKey(args: {
  model: BenchModelEntry;
  variant: BenchVariant;
  backend: Backend;
  settingsFingerprint: string;
  contextVariantId?: string;
  qualityTaskSignature: string;
}): string {
  const parts = [
    'v1',
    args.model.id,
    args.variant.quant,
    args.variant.filename,
    args.backend,
    args.settingsFingerprint,
  ];
  const contextPart = contextVariantCachePart(args.contextVariantId);
  if (contextPart) {
    parts.push(contextPart);
  }
  parts.push(`qt=${args.qualityTaskSignature}`);
  return parts.join('|');
}

function findCachedQualityFailure(
  cache: BenchmarkResultCache,
  key: string,
): BenchmarkResultCacheEntry | null {
  return cache.entries.find(entry => entry.key === key) ?? null;
}

function upsertQualityFailureCacheEntry(args: {
  cache: BenchmarkResultCache;
  key: string;
  model: BenchModelEntry;
  variant: BenchVariant;
  backend: Backend;
  row: BenchmarkRunRow;
  qualityTaskSignature: string;
}): boolean {
  const {cache, key, model, variant, backend, row, qualityTaskSignature} = args;
  if (
    row.status !== 'ok' ||
    row.quality_passed !== false ||
    row.pp_avg == null ||
    row.tg_avg == null ||
    !row.quality_results ||
    row.quality_results.length === 0
  ) {
    return false;
  }

  const now = new Date().toISOString();
  const failedTaskIds = row.quality_results
    .filter(result => !result.passed)
    .map(result => result.id);
  const existing = cache.entries.find(entry => entry.key === key);
  const next: BenchmarkResultCacheEntry = {
    key,
    outcome: 'quality_failed',
    model_id: model.id,
    quant: variant.quant,
    filename: variant.filename,
    requested_backend: backend,
    context_variant_id: row.context_variant_id ?? BASELINE_CONTEXT_VARIANT_ID,
    context_variant_label:
      row.context_variant_label ?? formatContextVariant(row),
    settings_fingerprint: row.settings_fingerprint,
    settings_overrides: row.settings_overrides,
    quality_task_signature: qualityTaskSignature,
    quality_score: row.quality_score ?? null,
    quality_results: row.quality_results,
    failed_task_ids: failedTaskIds,
    quality_capabilities: row.quality_capabilities,
    effective_backend: row.effective_backend,
    pp_avg: row.pp_avg,
    tg_avg: row.tg_avg,
    completion_tg_avg: row.completion_tg_avg ?? null,
    peak_memory_mb: row.peak_memory_mb,
    first_seen_at: existing?.first_seen_at ?? now,
    last_seen_at: now,
    hits: existing?.hits ?? 0,
  };

  if (existing) {
    Object.assign(existing, next);
  } else {
    cache.entries.push(next);
  }
  return true;
}

type SettingsOverrides = Partial<Record<SettingsKnob, SettingsValue>>;
const BASELINE_CONTEXT_VARIANT_ID = 'baseline';
const BASELINE_CONTEXT_VARIANT: BenchContextVariant = {
  id: BASELINE_CONTEXT_VARIANT_ID,
  label: 'baseline',
};

function contextVariantId(variant: BenchContextVariant | undefined): string {
  const id =
    typeof variant?.id === 'string' && variant.id.trim().length > 0
      ? variant.id.trim()
      : BASELINE_CONTEXT_VARIANT_ID;
  return id.replace(/[^a-zA-Z0-9_.-]+/g, '-').toLowerCase();
}

function contextVariantLabel(
  variant: BenchContextVariant | undefined,
): string | undefined {
  if (typeof variant?.label === 'string' && variant.label.trim().length > 0) {
    return variant.label.trim();
  }
  const id = contextVariantId(variant);
  return id === BASELINE_CONTEXT_VARIANT_ID ? 'baseline' : id;
}

function contextVariantsForCell(
  config: BenchConfig,
  model: BenchModelEntry,
  variant: BenchVariant,
): BenchContextVariant[] {
  const configured =
    variant.context_variants ??
    model.context_variants ??
    config.context_variants;
  if (!configured || configured.length === 0) {
    return [BASELINE_CONTEXT_VARIANT];
  }
  return configured.map(item => ({
    ...item,
    id: contextVariantId(item),
    label: contextVariantLabel(item),
  }));
}

function stripUnsafeContextVariantParams(
  variant: BenchContextVariant,
): Partial<ContextParams> {
  const {
    model: _model,
    devices: _devices,
    n_gpu_layers: _nGpuLayers,
    no_gpu_devices: _noGpuDevices,
    ...safe
  } = variant.init_params ?? {};
  return safe;
}

function contextVariantParamsSnapshot(
  variant: BenchContextVariant,
): Record<string, unknown> {
  return stripUnsafeContextVariantParams(variant) as Record<string, unknown>;
}

function contextVariantCachePart(variantId: string | undefined): string | null {
  const id = variantId ?? BASELINE_CONTEXT_VARIANT_ID;
  return id === BASELINE_CONTEXT_VARIANT_ID ? null : `ctx=${id}`;
}

function formatContextVariant(
  value:
    | Pick<BenchmarkRunRow, 'context_variant_id' | 'context_variant_label'>
    | Pick<
        BenchmarkBestCandidate,
        'context_variant_id' | 'context_variant_label'
      >
    | null
    | undefined,
): string {
  const id = value?.context_variant_id ?? BASELINE_CONTEXT_VARIANT_ID;
  return value?.context_variant_label ?? id;
}

/**
 * Pre-run snapshot of all six fingerprint-eligible knobs (WHAT 4c.1).
 * The matrix-level fixed point used for both restoration (4c.3) and
 * the pre-init failure-path fingerprint construction (9c).
 *
 * Keys missing on the platform stay missing in the snapshot (e.g. iOS
 * `no_extra_bufts`); the canonicaliser treats absence as `"-"`.
 */
type PreRunSnapshot = Partial<Record<SettingsKnob, SettingsValue>>;

/**
 * Expand sweep axes into a list of per-cell override maps. WHAT §2:
 * absent / empty axes returns `[{}]` — single cell, empty overrides,
 * which is the only path that produces the `app-default` fingerprint
 * (D7). With axes, returns the full cartesian product preserving axis
 * order (WHAT 4b.3 — fixed declaration order).
 *
 * Pure: no closure capture, no side effects. Exported for unit tests.
 */
export function expandAxes(
  axes: SettingsAxis[] | undefined,
): SettingsOverrides[] {
  if (!axes || axes.length === 0) {
    return [{}];
  }
  // Iteratively grow the cartesian product, axis by axis. Reads more
  // naturally than a recursive variant for the small N we expect (six
  // axes max, typically two or three values each).
  let result: SettingsOverrides[] = [{}];
  for (const axis of axes) {
    const next: SettingsOverrides[] = [];
    for (const acc of result) {
      for (const value of axis.values) {
        next.push({...acc, [axis.name]: value});
      }
    }
    result = next;
  }
  return result;
}

/**
 * Project the bench's matrix-level base params onto the six
 * fingerprint-eligible knobs (WHAT 4d.1 — fixed contract). This is the
 * fixed point used to build `req:`-prefixed failure fingerprints when a
 * cell throws BEFORE init params are composed (e.g. download timeout,
 * GPU/Hexagon pre-check failure).
 *
 * Reads only from the bench's own base params — never from
 * `modelStore.contextInitParams`. The runner is fully isolated from the
 * rest of the app's state, so the fingerprint reflects the bench's
 * declared base, not whatever the user happens to have in Settings.
 */
function snapshotFingerprintKeys(base: BenchBaseParams): PreRunSnapshot {
  return {
    cache_type_k: base.cache_type_k as SettingsValue,
    cache_type_v: base.cache_type_v as SettingsValue,
    flash_attn_type: base.flash_attn_type as SettingsValue,
    no_extra_bufts: base.no_extra_bufts as SettingsValue,
    use_mmap: base.use_mmap as SettingsValue,
    n_threads: base.n_threads as SettingsValue,
  };
}

/**
 * Project a cell's composed `ContextParams` onto the fingerprint-eligible
 * knobs. Used to build the success-path fingerprint AND to populate the
 * report's `init_settings` field. Replaces the prior post-init snapshot
 * read from `modelStore.contextInitParams`: under the isolated lifecycle
 * the runner never goes through ModelStore, so the cell's composed
 * params ARE the post-init reality (no in-store mutation can shadow
 * them).
 *
 * `model` and other non-fingerprint fields are dropped so the snapshot
 * is shaped to feed `canonicaliseFingerprint` directly.
 */
function snapshotCellInitSettings(
  cellParams: Record<string, unknown>,
): Record<string, unknown> {
  const keys: SettingsKnob[] = [
    'cache_type_k',
    'cache_type_v',
    'flash_attn_type',
    'no_extra_bufts',
    'use_mmap',
    'n_threads',
  ];
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (cellParams[k] !== undefined) {
      out[k] = cellParams[k];
    }
  }
  return out;
}

/**
 * `n_gpu_layers` and `devices` together control which backend ggml dispatches
 * to. The runner sets them per cell based on `backend`. Without this snapshot
 * + per-cell pin, persisted state from a prior session can leak: e.g. a
 * previous Hexagon run leaves `n_gpu_layers=99` in MMKV; a later cell with
 * `requested_backend='cpu'` sets `devices=['CPU']` but inherits `n_gpu_layers=99`,
 * and ggml routes the model through Hexagon anyway because the Hexagon
 * backend is registered (observed on Snapdragon 8 Elite Gen 5).
 */
/**
 * Map a cell's `backend` to its concrete (`devices`, `n_gpu_layers`) slot.
 * Both fields are pinned per cell; pinning `n_gpu_layers` is required
 * because `devices=['CPU']` alone does NOT prevent ggml from routing
 * layers to other registered backends when `n_gpu_layers > 0` — verified
 * on Snapdragon 8 Elite Gen 5 where `devices=['CPU']` + `n_gpu_layers=99`
 * + Hexagon registered results in full Hexagon offload.
 *
 * Caller MUST gate `gpu` / `hexagon` on the corresponding device-options
 * being available (see GPU/Hexagon pre-checks in `runMatrix`). On iOS, GPU
 * rows intentionally omit `devices` so llama.cpp auto-selects the real Metal
 * device name; CPU rows additionally set `no_gpu_devices=true` to keep Metal
 * mapped buffers out of the CPU baseline.
 */
function backendSlot(
  backend: Backend,
  adrenoDevices: string[] | null,
  hexagonDevices: string[] | null,
): {devices?: string[]; n_gpu_layers: number; no_gpu_devices?: boolean} {
  if (backend === 'cpu') {
    return {
      devices: ['CPU'],
      n_gpu_layers: 0,
      no_gpu_devices: Platform.OS === 'ios' ? true : undefined,
    };
  }
  if (backend === 'gpu') {
    if (Platform.OS === 'ios') {
      return {n_gpu_layers: 99};
    }
    return {devices: adrenoDevices as string[], n_gpu_layers: 99};
  }
  return {devices: hexagonDevices as string[], n_gpu_layers: 99};
}

function nativeContextSnapshot(
  ctx: LlamaContext | null,
): BenchmarkRunRow['native_context'] | undefined {
  if (!ctx) {
    return undefined;
  }
  return {
    gpu: !!ctx.gpu,
    devices: Array.isArray(ctx.devices) ? ctx.devices : [],
    reasonNoGPU: ctx.reasonNoGPU ?? '',
    systemInfo: ctx.systemInfo,
  };
}

function inferBackendFromNativeContext(
  nativeContext: BenchmarkRunRow['native_context'] | undefined,
): EffectiveBackend | null {
  if (!nativeContext?.gpu || nativeContext.devices.length === 0) {
    return null;
  }
  if (nativeContext.devices.some(device => device.startsWith('HTP'))) {
    return 'hexagon';
  }
  if (Platform.OS === 'ios') {
    return 'metal';
  }
  return 'opencl';
}

function deriveEffectiveBackendForCell(args: {
  requested: Backend;
  signals: LogSignals;
  nativeContext: BenchmarkRunRow['native_context'] | undefined;
  effectiveInitParams: Record<string, unknown>;
}): EffectiveBackend {
  const parsed = deriveEffectiveBackend(args.signals);
  const inferredNative = inferBackendFromNativeContext(args.nativeContext);
  const nGpuLayers = Number(args.effectiveInitParams.n_gpu_layers);
  const requestedCpuWithoutOffload =
    args.requested === 'cpu' &&
    (args.effectiveInitParams.no_gpu_devices === true || nGpuLayers === 0);

  if (requestedCpuWithoutOffload) {
    if (inferredNative) {
      return parsed === 'cpu' || parsed === 'unknown' ? inferredNative : parsed;
    }
    return 'cpu';
  }

  if (parsed !== 'cpu' && parsed !== 'unknown') {
    return parsed;
  }
  return inferredNative ?? parsed;
}

/**
 * Fingerprint canonical-form key list (WHAT 4d.1 — fixed contract).
 * Adding a knob here is a fingerprint-version bump.
 */
export const FINGERPRINT_KEYS: readonly SettingsKnob[] = [
  'cache_type_k',
  'cache_type_v',
  'flash_attn_type',
  'no_extra_bufts',
  'use_mmap',
  'n_threads',
];

/**
 * Reserved literal that distinguishes "no settings sweep was active"
 * from "the canonicalised default fingerprint happens to match"
 * (WHAT D7). Minted only by `buildSuccessFingerprint` /
 * `buildFailureFingerprint` when the cell came from a no-axes config
 * with empty overrides — and by the v1.0->v1.1 migration script for
 * legacy rows.
 */
export const APP_DEFAULT_FINGERPRINT = 'app-default';

/**
 * Canonicalise an init_settings-shaped record into the deterministic
 * fingerprint string. WHAT 4d.1-4:
 *   1. Iterate FINGERPRINT_KEYS in fixed order.
 *   2. Missing keys -> literal '-' (covers iOS's omitted no_extra_bufts).
 *   3. Coerce: bool -> 'true'|'false', number -> decimal string,
 *      string -> as-is lowercased.
 *   4. Join 'key=value' pairs with ';'.
 *
 * Pure: no closure capture, no mutation of input. Exported for unit
 * tests so the WHAT 4d examples can be byte-equality asserted.
 */
export function canonicaliseFingerprint(
  record: Record<string, unknown> | PreRunSnapshot,
): string {
  const parts: string[] = [];
  for (const key of FINGERPRINT_KEYS) {
    const v = (record as Record<string, unknown>)[key];
    let coerced: string;
    if (v === undefined || v === null) {
      coerced = '-';
    } else if (typeof v === 'boolean') {
      coerced = v ? 'true' : 'false';
    } else if (typeof v === 'number') {
      coerced = String(v);
    } else {
      coerced = String(v).toLowerCase();
    }
    parts.push(`${key}=${coerced}`);
  }
  return parts.join(';');
}

/**
 * Build the fingerprint for the success path (or post-init failure
 * path, WHAT 9d). Reads from the post-init snapshot — the source of
 * truth for what the engine actually applied.
 *
 * Special case (WHAT D7, I2): when the cell came from a no-axes
 * config AND overrides are empty, return the reserved
 * `app-default` literal regardless of the canonicalised content. This
 * keeps the legacy migration story (D8) from minting indistinguishable
 * fingerprints from explicit "swept and landed on defaults" cells.
 */
export function buildSuccessFingerprint(
  postInitSnapshot: Record<string, unknown>,
  hadAxesInConfig: boolean,
  isEmptyOverrides: boolean,
): string {
  if (!hadAxesInConfig && isEmptyOverrides) {
    return APP_DEFAULT_FINGERPRINT;
  }
  return canonicaliseFingerprint(postInitSnapshot);
}

/**
 * Build the fingerprint for the pre-init failure path (WHAT 9c, I3
 * exception (b)). Constructed from the matrix-level pre-run snapshot
 * (4c.1) overlaid with the cell's requested overrides — no constraint
 * replay (no setter calls); the spread is mechanical so the result is
 * reproducible without re-running setter logic.
 *
 * Result is prefixed `req:` to mark "derived from intent + pre-run
 * snapshot, not from applied state." The reserved `app-default`
 * literal is still minted in the no-axes-empty-overrides case so a
 * failed `app-default` cell still buckets correctly with its
 * successful peers (WHAT 6.C).
 */
export function buildFailureFingerprint(
  preRunSnapshot: PreRunSnapshot,
  requestedOverrides: SettingsOverrides,
  hadAxesInConfig: boolean,
): string {
  if (!hadAxesInConfig && Object.keys(requestedOverrides).length === 0) {
    return APP_DEFAULT_FINGERPRINT;
  }
  const merged = {...preRunSnapshot, ...requestedOverrides};
  return 'req:' + canonicaliseFingerprint(merged);
}

function buildPlannedFingerprint(args: {
  base: BenchBaseParams;
  overrides: SettingsOverrides;
  hadAxesInConfig: boolean;
}): string {
  const cellParams = composeCellParams({
    filePath: '__benchmark_cache_key__',
    base: args.base,
    overrides: args.overrides,
    n_gpu_layers: 0,
  });
  const snapshot = snapshotCellInitSettings(
    cellParams as unknown as Record<string, unknown>,
  );
  return buildSuccessFingerprint(
    snapshot,
    args.hadAxesInConfig,
    Object.keys(args.overrides).length === 0,
  );
}

/**
 * Run the matrix. Pure-async, takes setStatus as a parameter so that unit
 * tests can drive the state machine without a real React tree.
 *
 * Side effects:
 *   - Updates the screen's status string at every transition.
 *   - Writes the report JSON file after every cell (append-as-you-go).
 *   - Owns benchmark mode, native log capture, direct initLlama contexts,
 *     per-cell bench/quality tasks, and per-cell context release.
 *
 * Per-cell error containment: a throw in cell N is captured into the row,
 * status is set to cell-failed:<msg>, but the loop continues to cell N+1.
 */
export async function runMatrix(
  config: BenchConfig,
  setStatus: (s: Status) => void,
  setLastCell: (c: BenchmarkLiveUpdate) => void,
): Promise<void> {
  setStatus('preparing:resolving runtime settings');
  const bench = config.bench ?? DEFAULT_BENCH;
  // Resolve inter-cell settle once per matrix. Validates: must be a finite
  // non-negative number; anything else falls back to the default rather
  // than throwing — keeps the matrix robust to a typo'd config value
  // (e.g. "30000" string instead of 30000 number).
  const interCellSettleMs =
    typeof config.inter_cell_settle_ms === 'number' &&
    Number.isFinite(config.inter_cell_settle_ms) &&
    config.inter_cell_settle_ms >= 0
      ? config.inter_cell_settle_ms
      : DEFAULT_INTER_CELL_SETTLE_MS;
  const hadAxesInConfig = !!(
    config.settings_axes && config.settings_axes.length > 0
  );

  // Resolve the device-appropriate thread count ONCE for the matrix.
  // `getRecommendedThreadCount()` is a pure utility (no modelStore
  // coupling), so the bench's base stays isolated from the user's
  // persisted Settings while still picking a sensible per-device
  // default (80% of cores when >4, otherwise all cores).
  const recommendedThreads = await getRecommendedThreadCount();
  const benchBase: BenchBaseParams = {
    ...DEFAULT_BENCH_BASE_PARAMS,
    n_threads: recommendedThreads,
    ...(config.base_params ?? {}),
  };
  const qualityTasks = config.quality_tasks ?? [];
  const qualityCacheEnabled = qualityTasks.length > 0;
  const qualitySignature = qualityTaskSignature(qualityTasks);

  // Matrix-level fingerprint snapshot (WHAT 4c.1). Derived from the
  // bench's own base — NOT from `modelStore.contextInitParams` — so the
  // fingerprint reflects what the bench would have run, independent of
  // whatever the user has in Settings.
  const preRunSnapshot = snapshotFingerprintKeys(benchBase);

  setStatus('preparing:probing device backends');
  // Resolve the GPU and Hexagon device sets ONCE at run start. Reuses the
  // canonical helper (`getDeviceOptions` from src/utils/deviceSelection.ts)
  // instead of duplicating the getBackendDevicesInfo() filter logic.
  // Cells with backend:'gpu' fail fast (status:'failed') if no GPU option
  // is returned (e.g. supportsOpenCL=false device); same shape for hexagon.
  let adrenoDevices: string[] | null = null;
  let hexagonDevices: string[] | null = null;
  const requestedBackends = new Set<Backend>(config.backends);
  for (const model of config.models) {
    model.backends?.forEach(backend => requestedBackends.add(backend));
  }
  const wantsGpu = requestedBackends.has('gpu');
  const wantsHexagon = requestedBackends.has('hexagon');
  if (wantsGpu || wantsHexagon) {
    try {
      const opts = await getDeviceOptions();
      if (wantsGpu) {
        const gpu = opts.find(o => o.id === 'gpu');
        adrenoDevices = gpu?.devices ?? null;
      }
      if (wantsHexagon) {
        const hex = opts.find(o => o.id === 'hexagon');
        hexagonDevices = hex?.devices ?? null;
      }
    } catch {
      adrenoDevices = wantsGpu ? null : adrenoDevices;
      hexagonDevices = wantsHexagon ? null : hexagonDevices;
    }
  }

  setStatus('preparing:building matrix');
  // Expand the sweep-axes into per-cell override maps. Empty / absent
  // axes produces `[{}]` — one cell per (model, variant, backend), empty
  // overrides — the only path that mints `app-default` fingerprints
  // (WHAT §2, §4d D7).
  const overridesList = expandAxes(config.settings_axes);

  // Build a flat cell list (4-deep cartesian product per WHAT §2).
  const cells: Array<{
    model: BenchModelEntry;
    variant: BenchVariant;
    backend: Backend;
    overrides: SettingsOverrides;
    contextVariant: BenchContextVariant;
  }> = [];
  for (const m of config.models) {
    for (const v of m.quants) {
      const modelBackends = m.backends ?? config.backends;
      const contextVariants = contextVariantsForCell(config, m, v);
      for (const b of modelBackends) {
        for (const contextVariant of contextVariants) {
          for (const overrides of overridesList) {
            cells.push({
              model: m,
              variant: v,
              backend: b,
              overrides,
              contextVariant,
            });
          }
        }
      }
    }
  }
  setLastCell({
    cells: 0,
    total: cells.length,
    failed: 0,
    skipped: 0,
  });

  // From here on the runner acquires global state (native logging,
  // benchmark-mode flag, exclusive context ownership). Wrap the entire
  // acquisition+work span in try/finally so a rejection during
  // toggleNativeLog or enterBenchmarkMode can't strand the app with
  // logging on or benchmarkActive=true. Both cleanup calls in the
  // finally are idempotent — safe to call even if their setup
  // counterpart never ran or only partially ran.
  try {
    setStatus('preparing:enabling native logs');
    // Native log capture is global state in llama.rn — flip it on once for
    // the whole matrix. Per-cell scoping is done by attaching a fresh
    // listener around each init+bench window.
    await toggleNativeLog(true).catch(() => undefined);

    // Take exclusive ownership of the native context lifecycle. This:
    //   - Sets `modelStore.benchmarkActive = true` synchronously so any
    //     in-flight or new auto-load (e.g. ChatView's pal-default
    //     selectModel on cold-launch) is gated.
    //   - Releases any context the rest of the app loaded so no stale
    //     LlamaContext occupies the native context list while the matrix
    //     is creating its own.
    // The runner from this point on calls `initLlama` directly per cell;
    // it never touches `modelStore.context` / `modelStore.activeModelId`.
    setStatus('preparing:entering benchmark mode');
    await modelStore.enterBenchmarkMode();
    const startTimestamp = new Date().toISOString();
    const safeStamp = startTimestamp.replace(/[:.]/g, '-');
    const path = reportPath(safeStamp);
    setStatus('preparing:capturing device profile');
    const deviceProfile = await captureRuntimeDeviceProfile();
    setStatus('preparing:loading result caches');
    let bestCandidate = await readBestCandidate(config);
    const resultCacheRead = await readResultCache();
    const resultCache = resultCacheRead.cache;
    const resultCacheErrors = [...resultCacheRead.errors];
    const completedCacheRead = await readCompletedCellCache();
    const completedCellCache = completedCacheRead.cache;
    const completedCellCacheErrors = [...completedCacheRead.errors];
    let fitProfile = await readDeviceFitProfile();
    const fitProfileErrors: string[] = [];
    let skippedQualityFailures = 0;
    let lastCacheSkipKey: string | undefined;
    let skippedCompletedCells = 0;
    let lastCompletedSkipKey: string | undefined;
    const report: BenchmarkReport = {
      version: '1.1',
      platform: Platform.OS,
      timestamp: startTimestamp,
      preseeded: true, // pessimistic — flips false on first downloading: transition
      bench,
      inter_cell_settle_ms: interCellSettleMs,
      suite: config.suite,
      base_params_used: benchBase,
      quality_tasks_used:
        config.quality_tasks && config.quality_tasks.length > 0
          ? config.quality_tasks
          : undefined,
      device_profile: deviceProfile,
      best_candidate: bestCandidate,
      leaderboard: buildLeaderboard(config, [], bestCandidate),
      storage: null,
      result_cache: buildResultCacheState(
        resultCache,
        skippedQualityFailures,
        lastCacheSkipKey,
        completedCellCache,
        skippedCompletedCells,
        lastCompletedSkipKey,
        [...resultCacheErrors, ...completedCellCacheErrors],
      ),
      fit_profile: {
        path: deviceFitProfilePath(),
        observations: fitProfile?.observations.length ?? 0,
        updated_at: fitProfile?.updated_at,
      },
      runs: [],
    };
    const downloadedModelCache = new Map<string, Model>();
    // settings_axes_used echoes config.settings_axes only when the run
    // had axes (WHAT 1e, 9a — empty array MUST NOT be emitted).
    if (hadAxesInConfig && config.settings_axes) {
      report.settings_axes_used = config.settings_axes;
    }
    if (config.context_variants && config.context_variants.length > 0) {
      report.context_variants_used = config.context_variants;
    }

    const updateStorageState = async (protectedModelIds: string[] = []) => {
      const latestStorage = await pruneBenchmarkModels({
        config,
        bestCandidate,
        protectedModelIds,
      });
      report.storage = accumulateStorageState(report.storage, latestStorage);
      for (const deletedId of latestStorage.deleted_model_ids) {
        for (const [cacheKey, cachedModel] of downloadedModelCache.entries()) {
          if (cachedModel.id === deletedId) {
            downloadedModelCache.delete(cacheKey);
          }
        }
      }
      return report.storage;
    };

    setStatus('preparing:reclaiming benchmark storage');
    report.storage = await updateStorageState();

    const persistFitProfile = async () => {
      if (!shouldPersistDeviceFitProfile()) {
        report.fit_profile = {
          path: deviceFitProfilePath(),
          observations: fitProfile?.observations.length ?? 0,
          updated_at: fitProfile?.updated_at,
        };
        return;
      }
      try {
        fitProfile = updateFitProfileFromReport({
          existing: fitProfile,
          report,
          config,
        });
        await writeDeviceFitProfile(fitProfile);
      } catch (error) {
        fitProfileErrors.push(String(error).slice(0, TRUNCATE_ERROR));
      } finally {
        report.fit_profile = {
          path: deviceFitProfilePath(),
          observations: fitProfile?.observations.length ?? 0,
          updated_at: fitProfile?.updated_at,
          ...(fitProfileErrors.length > 0 ? {errors: fitProfileErrors} : {}),
        };
      }
    };

    const writeReport = async () => {
      const body = JSON.stringify(report, null, 2);
      await RNFS.writeFile(path, body, 'utf8');
      await RNFS.writeFile(latestReportPath(), body, 'utf8');
      await persistFitProfile();
    };

    // Write the shell up front so even an early crash leaves a JSON file.
    await writeReport();

    const refreshResultCacheState = () => {
      report.result_cache = buildResultCacheState(
        resultCache,
        skippedQualityFailures,
        lastCacheSkipKey,
        completedCellCache,
        skippedCompletedCells,
        lastCompletedSkipKey,
        [...resultCacheErrors, ...completedCellCacheErrors],
      );
    };

    const persistResultCache = async () => {
      try {
        await writeResultCache(resultCache);
      } catch (error) {
        resultCacheErrors.push(String(error).slice(0, TRUNCATE_ERROR));
      } finally {
        refreshResultCacheState();
      }
    };

    const persistCompletedCellCache = async () => {
      try {
        await writeCompletedCellCache(completedCellCache);
      } catch (error) {
        completedCellCacheErrors.push(String(error).slice(0, TRUNCATE_ERROR));
      } finally {
        refreshResultCacheState();
      }
    };

    const recordCompletedCell = async (args: {
      key: string;
      model: BenchModelEntry;
      variant: BenchVariant;
      backend: Backend;
      row: BenchmarkRunRow;
    }) => {
      upsertCompletedCellCacheEntry({
        cache: completedCellCache,
        key: args.key,
        model: args.model,
        variant: args.variant,
        backend: args.backend,
        row: args.row,
        qualityTaskSignature: qualitySignature,
      });
      await persistCompletedCellCache();
    };

    const updateLiveState = (
      latest?: Pick<BenchmarkLiveUpdate, 'pp' | 'tg'>,
    ) => {
      const latestRow = report.runs[report.runs.length - 1];
      report.best_candidate = bestCandidate;
      report.leaderboard = buildLeaderboard(config, report.runs, bestCandidate);
      refreshResultCacheState();
      setLastCell({
        pp: latest?.pp ?? latestRow?.pp_avg ?? undefined,
        tg: latest?.tg ?? latestRow?.tg_avg ?? undefined,
        cells: report.runs.length,
        total: cells.length,
        failed: report.runs.filter(row => row.status === 'failed').length,
        skipped: report.runs.filter(row => row.status === 'skipped').length,
        latest: buildLatestCellSummary(config, latestRow),
        best: bestCandidate,
        leaderboard: report.leaderboard,
        storage: report.storage ?? null,
        cache: report.result_cache ?? null,
      });
    };
    updateLiveState();

    const markCellFinished = (
      marker: BenchmarkCellMarker,
      row: BenchmarkRunRow,
    ) => {
      report.current_cell = null;
      report.last_completed_cell = {
        ...marker,
        status: row.status,
        completed_at: new Date().toISOString(),
        error: row.error,
      };
    };

    for (let i = 0; i < cells.length; i++) {
      const {model, variant, backend, overrides, contextVariant} = cells[i];
      const ctxVariantId = contextVariantId(contextVariant);
      const ctxVariantLabel = contextVariantLabel(contextVariant);
      const ctxVariantParams = contextVariantParamsSnapshot(contextVariant);
      const tStart = Date.now();
      // Status `<tag>` extension (WHAT §3, §8 D9): when overrides are
      // non-empty, append a short `key=value;...` summary so the WDIO
      // spec can disambiguate identical (model,quant,backend) cells with
      // different settings. Truncated to 60 chars to keep the polled
      // status string bounded. The summary uses the REQUESTED overrides
      // (not the post-init canonicalised fingerprint) — operators care
      // about what they asked for in the live status.
      const overrideEntries = Object.entries(overrides);
      const tagSuffix =
        overrideEntries.length === 0
          ? ''
          : '/' +
            overrideEntries
              .map(([k, v]) => `${k}=${String(v)}`)
              .join(';')
              .slice(0, 60);
      const contextTag =
        ctxVariantId === BASELINE_CONTEXT_VARIANT_ID
          ? ''
          : `/ctx=${ctxVariantId}`;
      const tag = `${i + 1}/${cells.length}:${model.id}/${variant.quant}/${backend}${contextTag}${tagSuffix}`;
      setStatus(`running:${tag}`);
      const cellStartedAt = new Date().toISOString();
      const cellMarker: BenchmarkCellMarker = {
        cell_index: i + 1,
        total_cells: cells.length,
        tag,
        model_id: model.id,
        quant: variant.quant,
        requested_backend: backend,
        context_variant_id: ctxVariantId,
        context_variant_label: ctxVariantLabel,
        settings_overrides: overrides,
        started_at: cellStartedAt,
        phase: 'running',
      };
      report.current_cell = cellMarker;
      report.last_started_cell = cellMarker;
      await writeReport();

      const rowBase: Pick<
        BenchmarkRunRow,
        | 'model_id'
        | 'quant'
        | 'requested_backend'
        | 'context_variant_id'
        | 'context_variant_label'
        | 'context_variant_params'
        | 'timestamp'
      > = {
        model_id: model.id,
        quant: variant.quant,
        requested_backend: backend,
        context_variant_id: ctxVariantId,
        context_variant_label: ctxVariantLabel,
        context_variant_params: ctxVariantParams,
        timestamp: cellStartedAt,
      };
      const plannedFingerprint = buildPlannedFingerprint({
        base: benchBase,
        overrides,
        hadAxesInConfig,
      });
      const resultCacheKey = buildResultCacheKey({
        model,
        variant,
        backend,
        settingsFingerprint: plannedFingerprint,
        contextVariantId: ctxVariantId,
        qualityTaskSignature: qualitySignature,
      });
      const unsafeTurbo2Reason = getUnsafeIosTurbo2BenchmarkReason({
        deviceProfile,
        backend,
        baseCacheTypeV: benchBase.cache_type_v,
        overrides,
      });
      if (unsafeTurbo2Reason) {
        const row: BenchmarkRunRow = {
          ...rowBase,
          effective_backend: 'unknown',
          pp_avg: null,
          tg_avg: null,
          wall_ms: Date.now() - tStart,
          peak_memory_mb: null,
          log_signals: emptyLogSignals(),
          init_settings: {},
          effective_init_params: {},
          settings_overrides: overrides,
          settings_fingerprint: plannedFingerprint,
          status: 'skipped',
          reason: 'unsafe-ios-turbo2-metal-profile',
          error: unsafeTurbo2Reason,
        };
        report.runs.push(row);
        markCellFinished(cellMarker, row);
        await recordCompletedCell({
          key: resultCacheKey,
          model,
          variant,
          backend,
          row,
        });
        report.best_candidate = bestCandidate;
        report.leaderboard = buildLeaderboard(
          config,
          report.runs,
          bestCandidate,
        );
        await writeReport();
        updateLiveState();
        setStatus(
          `skipped:${i + 1}/${cells.length}:unsafe-ios-turbo2-metal-profile`,
        );
        continue;
      }

      // Per-cell log buffer + listener handle. Declared outside the try so the
      // catch path can still surface partial signals (and the finally can
      // detach the listener) when a cell throws mid-init.
      const logBuffer: string[] = [];
      let logSub: {remove: () => void} | null = null;
      // The native context the runner owns for this cell. Stored at outer
      // scope so the `finally` block can release it regardless of where in
      // the try body a throw lands. Distinct from `modelStore.context` —
      // the runner never assigns to that.
      let ctx: LlamaContext | null = null;
      // Post-init snapshot, hoisted so the catch path can pick between the
      // standard fingerprint (post-init available) and the `req:`-prefixed
      // fingerprint (pre-init failure). WHAT 9d explicitly requires this
      // hoist as part of the contract. Read by Step 7's fingerprint
      // helpers in the catch block.
      let postInitSnapshot: Record<string, unknown> | null = null;
      let effectiveInitParams: Record<string, unknown> = {};
      const snapshotLabelBase = safeLabel(
        `bench-${i + 1}-${model.id}-${variant.quant}-${backend}-${ctxVariantId}`,
      );
      const memorySnapshots: MemorySnapshotRefs = {};
      let memoryBefore: MemorySample | null = null;
      let memoryAfter: MemorySample | null = null;
      let peakMemory: MemorySample | null = null;
      let resolvedModelForCleanup: Model | undefined;

      try {
        const cachedCompleted = findCompletedCellCacheEntry(
          completedCellCache,
          resultCacheKey,
        );
        if (cachedCompleted) {
          cachedCompleted.hits += 1;
          cachedCompleted.last_seen_at = new Date().toISOString();
          skippedCompletedCells += 1;
          lastCompletedSkipKey = resultCacheKey;

          const row: BenchmarkRunRow = {
            ...cachedCompleted.row,
            timestamp: cellStartedAt,
            reason: cachedCompleted.row.reason ?? 'cached-completed-cell',
          };
          report.runs.push(row);
          markCellFinished(cellMarker, row);

          const candidate = buildCandidateFromRow({row, config});
          if (
            candidate &&
            (!bestCandidate || compareCandidates(candidate, bestCandidate) > 0)
          ) {
            const {source: _source, ...promotedCandidate} = candidate;
            bestCandidate = promotedCandidate;
            await writeBestCandidate(bestCandidate);
          }

          report.best_candidate = bestCandidate;
          report.leaderboard = buildLeaderboard(
            config,
            report.runs,
            bestCandidate,
          );
          await persistCompletedCellCache();
          await writeReport();
          updateLiveState();
          setStatus(`skipped:${i + 1}/${cells.length}:cached-completed-cell`);
          continue;
        }

        if (qualityCacheEnabled) {
          const cachedFailure = findCachedQualityFailure(
            resultCache,
            resultCacheKey,
          );
          if (cachedFailure) {
            cachedFailure.hits += 1;
            cachedFailure.last_seen_at = new Date().toISOString();
            skippedQualityFailures += 1;
            lastCacheSkipKey = resultCacheKey;

            const row: BenchmarkRunRow = {
              ...rowBase,
              effective_backend: cachedFailure.effective_backend,
              pp_avg: null,
              tg_avg: null,
              wall_ms: Date.now() - tStart,
              peak_memory_mb: cachedFailure.peak_memory_mb,
              log_signals: emptyLogSignals(),
              init_settings: {},
              effective_init_params: {},
              settings_overrides: overrides,
              settings_fingerprint: plannedFingerprint,
              quality_results: cachedFailure.quality_results,
              quality_score: cachedFailure.quality_score,
              quality_passed: false,
              quality_capabilities: cachedFailure.quality_capabilities,
              status: 'skipped',
              reason: 'cached-quality-failure',
              error: `cached-quality-failure:${cachedFailure.failed_task_ids.join(
                ',',
              )}`,
            };
            report.runs.push(row);
            markCellFinished(cellMarker, row);
            report.best_candidate = bestCandidate;
            report.leaderboard = buildLeaderboard(
              config,
              report.runs,
              bestCandidate,
            );
            await persistResultCache();
            await writeReport();
            updateLiveState();
            setStatus(
              `skipped:${i + 1}/${cells.length}:cached-quality-failure`,
            );
            continue;
          }
        }

        // 1. GPU pre-check: cell fails fast if backend=gpu but no GPU option.
        if (backend === 'gpu' && !adrenoDevices) {
          const row: BenchmarkRunRow = {
            ...rowBase,
            effective_backend: 'unknown',
            pp_avg: null,
            tg_avg: null,
            wall_ms: Date.now() - tStart,
            peak_memory_mb: null,
            log_signals: emptyLogSignals(),
            init_settings: {},
            effective_init_params: {},
            settings_overrides: overrides,
            settings_fingerprint: buildFailureFingerprint(
              preRunSnapshot,
              overrides,
              hadAxesInConfig,
            ),
            status: 'failed',
            error: 'GPU device not available',
          };
          report.runs.push(row);
          markCellFinished(cellMarker, row);
          await recordCompletedCell({
            key: resultCacheKey,
            model,
            variant,
            backend,
            row,
          });
          report.best_candidate = bestCandidate;
          report.leaderboard = buildLeaderboard(
            config,
            report.runs,
            bestCandidate,
          );
          await writeReport();
          updateLiveState();
          continue;
        }

        // 1b. Hexagon pre-check (mirror of GPU): cell fails fast if the
        // device has no Hexagon backend. WHAT 4a.7, I7, 6.C.
        if (backend === 'hexagon' && !hexagonDevices) {
          const row: BenchmarkRunRow = {
            ...rowBase,
            effective_backend: 'unknown',
            pp_avg: null,
            tg_avg: null,
            wall_ms: Date.now() - tStart,
            peak_memory_mb: null,
            log_signals: emptyLogSignals(),
            init_settings: {},
            effective_init_params: {},
            settings_overrides: overrides,
            settings_fingerprint: buildFailureFingerprint(
              preRunSnapshot,
              overrides,
              hadAxesInConfig,
            ),
            status: 'failed',
            error: 'Hexagon device not available',
          };
          report.runs.push(row);
          markCellFinished(cellMarker, row);
          await recordCompletedCell({
            key: resultCacheKey,
            model,
            variant,
            backend,
            row,
          });
          report.best_candidate = bestCandidate;
          report.leaderboard = buildLeaderboard(
            config,
            report.runs,
            bestCandidate,
          );
          await writeReport();
          updateLiveState();
          continue;
        }

        // 2. Resolve / download the model file.
        const downloadCacheKey = benchmarkModelStoreId(model, variant);
        let resolvedModel =
          downloadedModelCache.get(downloadCacheKey) ??
          findDownloadedBenchmarkModel(model, variant);
        if (
          resolvedModel &&
          !modelStore.models.some(
            (candidate: Model) =>
              candidate.id === resolvedModel?.id && candidate.isDownloaded,
          )
        ) {
          downloadedModelCache.delete(downloadCacheKey);
          resolvedModel = findDownloadedBenchmarkModel(model, variant);
        }
        if (!resolvedModel) {
          report.preseeded = false;
          setStatus(`downloading:${variant.filename}`);
          // Strategy: rely on the existing app download path. The screen
          // pushes a minimal HuggingFaceModel + ModelFile descriptor into
          // modelStore, kicks off the download via downloadHFModel, and
          // polls modelStore.models for isDownloaded=true.
          const hfModel = {
            _id: model.hfModelId,
            id: model.hfModelId,
            author: model.hfModelId.split('/')[0] ?? 'unknown',
            gated: false,
            inference: '',
            lastModified: '',
            likes: 0,
            trendingScore: 0,
            private: false,
            sha: '',
            downloads: 0,
            tags: [],
            library_name: '',
            createdAt: '',
            model_id: model.hfModelId,
            siblings: [{rfilename: variant.filename} as any],
          } as any;
          // url is REQUIRED — hfAsModel reads modelFile.url into model.downloadUrl,
          // and ModelStore.checkSpaceAndDownload early-returns when !downloadUrl,
          // silently never starting the download. Construct the canonical HF
          // resolve URL inline; if the bench-config ever needs a different host
          // (private repo, mirror, etc.) we'd take it from the variant instead.
          // size is REQUIRED — hasEnoughSpace returns false for size <= 0
          // (malformed model), and DownloadManager.startDownload then throws
          // "Not enough storage space". The variant.size from bench-config
          // wins; otherwise fall back to 1 to bypass the pre-check (the actual
          // download will fail late if the device is genuinely full).
          const modelFile = {
            rfilename: variant.filename,
            size: variant.size ?? 1,
            url: `https://huggingface.co/${model.hfModelId}/resolve/main/${variant.filename}`,
          } as any;
          // Clear stale download error so we only observe failures from THIS
          // cell's download. The matrix is serial so one error slot is enough.
          modelStore.clearDownloadError?.();
          await modelStore.downloadHFModel(hfModel, modelFile);
          // Status updates with download progress: poll modelStore.models for
          // the entry and surface percentage. The DownloadManager updates
          // model.progress as bytes arrive; we read it on each poll tick.
          // We also watch modelStore.downloadError so a failed download fails
          // the cell within ~500 ms instead of burning the full 30-min deadline.
          const progressFilename = variant.filename;
          const progressModelId = benchmarkModelStoreId(model, variant);
          const downloadDeadline = Date.now() + 30 * 60 * 1000;
          while (Date.now() < downloadDeadline) {
            const entry =
              modelStore.models.find(
                (m: Model) => m.id === progressModelId && m.isDownloaded,
              ) ??
              modelStore.models.find((m: Model) => m.id === progressModelId) ??
              modelStore.models.find(
                (m: Model) => m.filename === progressFilename && m.isDownloaded,
              ) ??
              modelStore.models.find(
                (m: Model) => m.filename === progressFilename,
              );
            if (entry?.isDownloaded) {
              resolvedModel = entry;
              downloadedModelCache.set(downloadCacheKey, entry);
              break;
            }
            const dlErr = (modelStore as any).downloadError;
            if (dlErr) {
              const reason =
                dlErr?.message ??
                dlErr?.error?.message ??
                JSON.stringify(dlErr).slice(0, TRUNCATE_ERROR);
              throw new Error(`download-failed:${progressFilename}:${reason}`);
            }
            const pct = entry?.progress ?? 0;
            setStatus(`downloading:${progressFilename} ${Math.round(pct)}%`);
            await new Promise(r => setTimeout(r, 500));
          }
          if (!resolvedModel) {
            throw new Error(`download-timeout:${progressFilename}`);
          }
          setStatus(`running:${tag}`);
        } else {
          downloadedModelCache.set(downloadCacheKey, resolvedModel);
        }
        resolvedModelForCleanup = resolvedModel;

        // 3. Compose the literal `ContextParams` for this cell. No store
        //    mutation: per-cell overrides + backend slot land directly in
        //    the dict we hand to `initLlama`. This is the single source of
        //    truth for `init_settings` AND `effective_init_params`.
        const filePath = await modelStore.getModelFullPath(resolvedModel);
        const slot = backendSlot(backend, adrenoDevices, hexagonDevices);
        const cellParams = composeCellParams({
          filePath,
          base: benchBase,
          overrides,
          devices: slot.devices,
          n_gpu_layers: slot.n_gpu_layers,
          no_gpu_devices: slot.no_gpu_devices,
        });
        Object.assign(cellParams, ctxVariantParams);
        if (Platform.OS === 'ios' && backend === 'gpu') {
          const {model: _modelPath, ...policyParams} = cellParams;
          const safetyDecision = applyIOSMetalSafetyPolicy({
            params: policyParams,
            model: resolvedModel,
            totalMemoryBytes: deviceProfile.total_memory_bytes,
            metalInfo: deviceProfile.metal as any,
            deviceId: deviceProfile.device_id,
            priorFailureCount: 0,
          });
          if (safetyDecision.applied) {
            Object.assign(cellParams, safetyDecision.params);
            console.warn(
              `[BenchmarkRunner] iOS Metal safety adjusted n_gpu_layers ${safetyDecision.requestedGpuLayers} -> ${safetyDecision.effectiveGpuLayers} for "${model.id}/${variant.quant}": ${safetyDecision.reason}`,
            );
          }
        }

        // The fingerprint snapshot (and the `init_settings` field) is the
        // composed params projected onto the six fingerprint-eligible
        // knobs. Captured here so a throw in `initLlama` still yields a
        // standard (non-`req:`) fingerprint via `postInitSnapshot`.
        const initSettings = snapshotCellInitSettings(
          cellParams as unknown as Record<string, unknown>,
        );
        postInitSnapshot = initSettings;
        // `effective_init_params` is what hit native, with the model path
        // dropped (operator-private and not load-bearing for analysis).
        effectiveInitParams = Object.fromEntries(
          Object.entries(cellParams).filter(([k]) => k !== 'model'),
        );

        memoryBefore = await sampleMemory();
        peakMemory = pickPeakMemory(peakMemory, memoryBefore);
        memorySnapshots.pre_init = await writeMemorySnapshot(
          `${snapshotLabelBase}-pre-init`,
        );

        // 4. Attach native-log listener so the cell's load output lands in
        //    `logBuffer`. The `BENCH_LOG_RE` pre-filter keeps the buffer
        //    bounded for long runs.
        logSub = addNativeLogListener((_level, text) => {
          if (BENCH_LOG_RE.test(text)) {
            logBuffer.push(text);
          }
        });

        // 5. Init the native context directly. `initLlama` is the runner's
        //    ONLY native-load entrypoint — `modelStore.initContext` /
        //    `selectModel` are gated by `benchmarkActive` and would throw
        //    if accidentally invoked.
        ctx = await initLlama(cellParams);
        memorySnapshots.post_init = await writeMemorySnapshot(
          `${snapshotLabelBase}-post-init`,
        );

        // 6. Validate the actual backend satisfies the requested backend.
        //    Partial offload (cpu+opencl-partial, cpu+metal-partial,
        //    cpu+hexagon-partial) IS considered satisfied — the cell landed
        //    on the requested backend, just incompletely. A fundamentally
        //    different backend (e.g. requested gpu, model loaded entirely on
        //    CPU) is a hard failure: under shared-state designs this could
        //    silently land in baselines as `status:ok` with
        //    `effective_backend:cpu` — the redesign disallows that.
        const okSignals = deriveLogSignals(logBuffer);
        const nativeCtx = nativeContextSnapshot(ctx);
        const okBackend = deriveEffectiveBackendForCell({
          requested: backend,
          signals: okSignals,
          nativeContext: nativeCtx,
          effectiveInitParams,
        });
        if (!requestSatisfiedBy(backend, okBackend)) {
          throw new Error(`backend-mismatch:${backend}:${okBackend}`);
        }

        // 7. Peak memory tracking. Keep this window open through both the
        // throughput bench and optional quality tasks, since larger mmap /
        // no-mmap cells often fail only when KV + completion load is added.
        const memInterval = setInterval(async () => {
          peakMemory = pickPeakMemory(peakMemory, await sampleMemory());
        }, PEAK_POLL_MS);

        let speedPp: number | undefined;
        let speedTg: number | undefined;
        let qualityResults: QualityTaskResult[] | undefined;
        let qualityScore: number | null = null;
        let qualityPassed: boolean | null = null;
        try {
          const benchResult = await ctx.bench(
            bench.pp,
            bench.tg,
            bench.pl,
            bench.nr,
          );
          speedPp = benchResult.speedPp;
          speedTg = benchResult.speedTg;
          const qualityStopWords =
            resolvedModel.stopWords && resolvedModel.stopWords.length > 0
              ? resolvedModel.stopWords
              : resolvedModel.defaultStopWords;
          qualityResults = await runQualityTasks(ctx, config.quality_tasks, {
            constrainedJson: false,
            stop: qualityStopWords,
          });
          qualityScore = calculateQualityScore(
            config.quality_tasks,
            qualityResults,
          );
          qualityPassed =
            qualityResults.length > 0
              ? qualityResults.every(result => result.passed)
              : null;
          memorySnapshots.post_quality = await writeMemorySnapshot(
            `${snapshotLabelBase}-post-quality`,
          );
        } finally {
          clearInterval(memInterval);
        }

        // Invariant: status:'ok' rows must always carry non-null pp_avg and
        // tg_avg. If ctx.bench() resolves with either metric undefined (e.g.
        // partial native failure), force the catch path so the row is recorded
        // as 'failed' with an explanatory error string. Without this, the
        // success-row builder below would write status:'ok' pp_avg:null which
        // makes regressions invisible to the compare script.
        if (speedPp == null || speedTg == null) {
          throw new Error(
            `bench returned null metric(s): speedPp=${speedPp}, speedTg=${speedTg}`,
          );
        }

        const wall = Date.now() - tStart;
        memoryAfter = await sampleMemory();
        peakMemory = pickPeakMemory(peakMemory, memoryAfter);
        const completionTgAvg = averageCompletionTg(qualityResults);
        const qualityCapabilities = deriveQualityCapabilities({
          status: 'ok',
          ppAvg: speedPp,
          tgAvg: speedTg,
          qualityResults,
          qualityPassed,
        });
        const row: BenchmarkRunRow = {
          ...rowBase,
          effective_backend: okBackend,
          pp_avg: speedPp,
          tg_avg: speedTg,
          completion_tg_avg: completionTgAvg,
          wall_ms: wall,
          peak_memory_mb: memoryPeakMb(peakMemory),
          memory_before: memoryBefore,
          memory_after: memoryAfter,
          memory_peak: peakMemory,
          memory_snapshots: memorySnapshots,
          log_signals: okSignals,
          init_settings: initSettings,
          effective_init_params: effectiveInitParams,
          native_context: nativeCtx,
          settings_overrides: overrides,
          settings_fingerprint: buildSuccessFingerprint(
            initSettings,
            hadAxesInConfig,
            Object.keys(overrides).length === 0,
          ),
          quality_results: qualityResults,
          quality_score: qualityScore,
          quality_passed: qualityPassed,
          quality_capabilities: qualityCapabilities,
          status: 'ok',
        };
        report.runs.push(row);
        markCellFinished(cellMarker, row);
        await recordCompletedCell({
          key: resultCacheKey,
          model,
          variant,
          backend,
          row,
        });
        const candidate = buildCandidateFromRow({
          row,
          config,
          resolvedModel,
          filePath,
        });
        if (
          candidate &&
          (!bestCandidate || compareCandidates(candidate, bestCandidate) > 0)
        ) {
          const {source: _source, ...promotedCandidate} = candidate;
          bestCandidate = promotedCandidate;
          await writeBestCandidate(bestCandidate);
        }
        if (
          upsertQualityFailureCacheEntry({
            cache: resultCache,
            key: resultCacheKey,
            model,
            variant,
            backend,
            row,
            qualityTaskSignature: qualitySignature,
          })
        ) {
          await persistResultCache();
        }
        report.best_candidate = bestCandidate;
        report.leaderboard = buildLeaderboard(
          config,
          report.runs,
          bestCandidate,
        );
        await writeReport();
        updateLiveState({pp: speedPp, tg: speedTg});
      } catch (e) {
        // Salvage whatever load lines we captured before the throw — useful
        // for debugging "why did this cell fail" without re-running. The log
        // listener is detached in the finally block (sole detach site).
        const partialSignals = deriveLogSignals(logBuffer);
        const nativeCtx = nativeContextSnapshot(ctx);
        const msg = (e as Error).message ?? 'unknown';
        const short = msg.slice(0, TRUNCATE_ERROR);
        const long = msg.slice(0, TRUNCATE_ROW_ERROR);
        // Fingerprint provenance per WHAT 9c/9d, I3:
        //   - postInitSnapshot null (pre-init failure)  -> req:-prefixed
        //     fingerprint built from pre-run snapshot + requested overrides.
        //   - postInitSnapshot non-null (post-init throw) -> standard
        //     fingerprint from the post-init snapshot, NO 'req:' prefix.
        const fingerprint =
          postInitSnapshot !== null
            ? buildSuccessFingerprint(
                postInitSnapshot,
                hadAxesInConfig,
                Object.keys(overrides).length === 0,
              )
            : buildFailureFingerprint(
                preRunSnapshot,
                overrides,
                hadAxesInConfig,
              );
        const row: BenchmarkRunRow = {
          ...rowBase,
          effective_backend: deriveEffectiveBackendForCell({
            requested: backend,
            signals: partialSignals,
            nativeContext: nativeCtx,
            effectiveInitParams,
          }),
          pp_avg: null,
          tg_avg: null,
          wall_ms: Date.now() - tStart,
          peak_memory_mb: memoryPeakMb(peakMemory),
          memory_before: memoryBefore,
          memory_after: memoryAfter,
          memory_peak: peakMemory,
          memory_snapshots: memorySnapshots,
          log_signals: partialSignals,
          init_settings: postInitSnapshot ?? {},
          // Hoisted at runMatrix scope so the catch path sees whatever was
          // captured at step 4b. `{}` if the cell threw before 4b ran.
          effective_init_params: effectiveInitParams,
          native_context: nativeCtx,
          settings_overrides: overrides,
          settings_fingerprint: fingerprint,
          status: 'failed',
          error: long,
        };
        report.runs.push(row);
        markCellFinished(cellMarker, row);
        try {
          await recordCompletedCell({
            key: resultCacheKey,
            model,
            variant,
            backend,
            row,
          });
        } catch {
          // Report write below still records the failure row; cache persistence
          // is best-effort and reflected in result_cache.errors.
        }
        report.best_candidate = bestCandidate;
        report.leaderboard = buildLeaderboard(
          config,
          report.runs,
          bestCandidate,
        );
        try {
          await writeReport();
        } catch {
          // best-effort
        }
        updateLiveState();
        // Per-cell failure: use a non-terminal status so the WDIO spec keeps
        // polling until the loop ends with `complete`. `error:` is reserved
        // for fatal runner failures (caught by onRun's outer try/catch).
        // Without this distinction, a single cell failure would make the spec
        // pull a partial report mid-run while the screen is still iterating.
        setStatus(`cell-failed:${i + 1}/${cells.length}:${short}`);
        // continue to the next cell — per-cell error containment.
      } finally {
        // Sole release site for the runner-owned context. If `initLlama`
        // threw, `ctx` stays null and we skip release. If anything between
        // `initLlama` and the success-row throws, the local `ctx` is the
        // only handle to the native context — we MUST release it here or
        // the native context list grows on every failed cell.
        if (ctx) {
          // Lifecycle log lines so logcat (`ReactNativeJS:V`) gives us a
          // timestamped record of release timing per cell. Diagnostic for
          // process-death debugging: pairing alloc-time with release-time
          // lets us tell "release call never fired" from "release call
          // fired but native heap didn't drop". The N/total + tag fields
          // are the same shape as the on-screen status string so reports
          // and logs cross-reference cleanly.
          const releaseStart = Date.now();
          console.log(`[BENCH] cell ${tag}: releasing ctx`);
          const releaseMarker: BenchmarkCellMarker = {
            ...(report.last_completed_cell?.tag === tag
              ? report.last_completed_cell
              : cellMarker),
            phase: 'releasing',
            release_started_at: new Date().toISOString(),
          };
          report.current_cell = releaseMarker;
          await writeReport();
          try {
            await ctx.release();
            const {phase: _phase, ...releasedMarker} = releaseMarker;
            report.last_completed_cell = {
              ...releasedMarker,
              release_completed_at: new Date().toISOString(),
            };
            report.current_cell = null;
            await writeReport();
            console.log(
              `[BENCH] cell ${tag}: released ctx in ${Date.now() - releaseStart}ms`,
            );
          } catch (e) {
            // Best-effort: a release throwing here doesn't abort the matrix.
            // The next cell creates a fresh context; if the leak persists
            // the cumulative `g_context_limit` check in RNLlamaJSI will
            // surface it as a hard error on a later cell.
            console.log(
              `[BENCH] cell ${tag}: release threw after ${Date.now() - releaseStart}ms: ${String(e)}`,
            );
            report.current_cell = null;
            await writeReport().catch(() => undefined);
          }
          // Cells release model weights/KV/compute through the native
          // allocator, which on Android may retain freed pages in its
          // arena rather than returning them to the kernel. Without a
          // purge between cells, RSS climbs across the matrix and the
          // process can be reaped before later cells finish. The rss
          // before/after fields make the effect observable in reports.
          try {
            const purgeStart = Date.now();
            const purgeResult = await NativeHardwareInfo.purgeNativeAllocator();
            const reclaimedKb =
              purgeResult.rss_kb_before - purgeResult.rss_kb_after;
            console.log(
              `[BENCH] cell ${tag}: purge purged=${purgeResult.purged} ` +
                `rss_before_kb=${purgeResult.rss_kb_before} ` +
                `rss_after_kb=${purgeResult.rss_kb_after} ` +
                `reclaimed_kb=${reclaimedKb} ` +
                `wall_ms=${Date.now() - purgeStart}`,
            );
          } catch (e) {
            // Non-fatal — we'd rather continue the matrix than abort
            // because a memory hint failed.
            console.log(`[BENCH] cell ${tag}: purge threw: ${String(e)}`);
          }
          // Inter-cell settle. Two purposes:
          //   1. `ctx.release()` resolves once ~llama_rn_context() returns,
          //      but some backend drivers (Adreno OpenCL command-queue
          //      tear-down on a worker thread, Hexagon HTP FastRPC
          //      teardown) defer their final memory release a few hundred
          //      ms past that boundary. The pre-redesign code carried a
          //      100ms `setTimeout` inside `ModelStore._releaseContextInternal`
          //      — added in response to actual failures, not preemptively.
          //   2. Thermal stabilisation across long matrix runs — operators
          //      tune `config.inter_cell_settle_ms` (default 2000ms) up
          //      to 15-60s when the device is throttling mid-cell.
          // Skipped when ctx is null (cell failed before init) since there
          // is nothing to settle.
          await new Promise(resolve => setTimeout(resolve, interCellSettleMs));
        }
        try {
          report.storage = await updateStorageState(
            resolvedModelForCleanup?.id ? [resolvedModelForCleanup.id] : [],
          );
          report.best_candidate = bestCandidate;
          report.leaderboard = buildLeaderboard(
            config,
            report.runs,
            bestCandidate,
          );
          await writeReport();
          updateLiveState();
        } catch (error) {
          report.storage = accumulateStorageState(report.storage, {
            kept_model_id: bestCandidate?.model_store_id ?? null,
            kept_filename: bestCandidate?.filename ?? null,
            deleted_model_ids: [],
            deleted_count: 0,
            reclaimed_bytes_estimate: 0,
            last_deleted_model_ids: [],
            last_deleted_count: 0,
            last_reclaimed_bytes_estimate: 0,
            last_cleanup_at: new Date().toISOString(),
            errors: [String(error).slice(0, TRUNCATE_ERROR)],
          });
          await writeReport().catch(() => undefined);
          updateLiveState();
        }
        // Sole listener-detach site. Idempotent: no-op when null.
        logSub?.remove();
        logSub = null;
      }
    }

    report.storage = await updateStorageState();
    report.best_candidate = bestCandidate;
    report.leaderboard = buildLeaderboard(config, report.runs, bestCandidate);
    await writeReport();
    updateLiveState();
    setStatus('complete');
  } finally {
    // Outer matrix-level finally: success and failure paths converge here.
    // No "restore settings" step is required — under the isolated
    // lifecycle the runner never wrote to `modelStore.contextInitParams`,
    // so there is nothing to undo. The single side-effect we own is
    // native-log toggle (matrix-scoped) and benchmark-mode (matrix-scoped).
    await toggleNativeLog(false).catch(() => undefined);
    modelStore.exitBenchmarkMode();
  }
}

interface BenchmarkRunnerScreenProps {
  // Test-only seam: lets unit tests replace the runner with a mock to
  // assert single-flight gating and call counts without driving a real
  // matrix. Production code never passes this prop.
  __runner?: typeof runMatrix;
  __loadConfig?: typeof loadConfig;
}

function formatMetric(value: number | undefined, digits = 1): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(digits)
    : '-';
}

function formatGenerationMetric(value: {
  tg_avg?: number | null;
  completion_tg_avg?: number | null;
}): string {
  const completion =
    typeof value.completion_tg_avg === 'number' &&
    Number.isFinite(value.completion_tg_avg)
      ? value.completion_tg_avg
      : null;
  const bench =
    typeof value.tg_avg === 'number' && Number.isFinite(value.tg_avg)
      ? value.tg_avg
      : null;
  if (
    completion != null &&
    bench != null &&
    Math.abs(completion - bench) > 0.05
  ) {
    return `gen ${formatMetric(completion)} / bench ${formatMetric(bench)}`;
  }
  if (completion != null) {
    return `gen ${formatMetric(completion)}`;
  }
  return `tg ${formatMetric(bench ?? undefined)}`;
}

function formatBytes(bytes: number | undefined | null): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) {
    return '-';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function compactFilename(filename: string | undefined): string {
  if (!filename) {
    return '-';
  }
  return filename.replace(/\.gguf$/i, '');
}

function formatQuality(
  qualityPassed: boolean | null | undefined,
  qualityScore: number | null | undefined,
): string {
  if (qualityPassed === true) {
    return `quality pass ${formatMetric(qualityScore ?? undefined, 2)}`;
  }
  if (qualityPassed === false) {
    return `quality fail ${formatMetric(qualityScore ?? undefined, 2)}`;
  }
  return 'quality n/a';
}

function formatCapabilities(
  capabilities: QualityCapability[] | null | undefined,
): string {
  if (!capabilities || capabilities.length === 0) {
    return 'tiers: -';
  }
  return `tiers: ${capabilities.join(', ')}`;
}

function statusKind(status: Status): 'idle' | 'running' | 'done' | 'error' {
  if (status === 'complete') {
    return 'done';
  }
  if (status.startsWith('error:')) {
    return 'error';
  }
  if (
    status.startsWith('restored:') ||
    status.startsWith('restored-interrupted:')
  ) {
    return 'idle';
  }
  if (
    status.startsWith('running:') ||
    status.startsWith('preparing:') ||
    status.startsWith('downloading:') ||
    status.startsWith('cell-failed:') ||
    status.startsWith('skipped:')
  ) {
    return 'running';
  }
  return 'idle';
}

function statusTitle(status: Status): string {
  if (status === 'idle') {
    return 'Ready';
  }
  if (status === 'complete') {
    return 'Complete';
  }
  if (status.startsWith('downloading:')) {
    return 'Downloading model';
  }
  if (status.startsWith('preparing:')) {
    return 'Preparing benchmark';
  }
  if (status.startsWith('cell-failed:')) {
    return 'Cell failed, continuing';
  }
  if (status.startsWith('skipped:')) {
    return 'Cached result skipped';
  }
  if (status.startsWith('restored-interrupted:')) {
    return 'Recovered interrupted run';
  }
  if (status.startsWith('restored:')) {
    return 'Recovered previous run';
  }
  if (status.startsWith('running:')) {
    return 'Running cell';
  }
  if (status.startsWith('error:')) {
    return 'Runner error';
  }
  return 'Benchmark';
}

function statusDetail(status: Status): string {
  if (status === 'idle') {
    return 'Waiting for a benchmark run.';
  }
  if (status === 'complete') {
    return 'The matrix finished and the best candidate was preserved.';
  }
  if (status.startsWith('preparing:')) {
    const phase = status.slice('preparing:'.length);
    return `Preparing: ${phase.replace(/-/g, ' ')}.`;
  }
  if (status.startsWith('restored-interrupted:')) {
    return 'Loaded the latest partial report from disk. Start will skip exact cached cells.';
  }
  if (status.startsWith('restored:')) {
    return 'Loaded the latest benchmark report from disk.';
  }
  const separator = status.indexOf(':');
  return separator >= 0 ? status.slice(separator + 1) : status;
}

function progressRatio(lastCell: BenchmarkLiveUpdate): number {
  const total = lastCell.total ?? 0;
  if (total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, (lastCell.cells ?? 0) / total));
}

async function readLatestReport(): Promise<BenchmarkReport | null> {
  try {
    const path = latestReportPath();
    if (!(await RNFS.exists(path))) {
      return null;
    }
    const parsed = JSON.parse(await RNFS.readFile(path, 'utf8'));
    if (!parsed || !Array.isArray(parsed.runs)) {
      return null;
    }
    return parsed as BenchmarkReport;
  } catch {
    return null;
  }
}

function liveUpdateFromReport(report: BenchmarkReport): BenchmarkLiveUpdate {
  const lastRun = [...report.runs]
    .reverse()
    .find(row => row.pp_avg != null || row.tg_avg != null);
  const total =
    report.current_cell?.total_cells ??
    report.last_started_cell?.total_cells ??
    report.last_completed_cell?.total_cells ??
    report.runs.length;

  return {
    pp: lastRun?.pp_avg ?? undefined,
    tg: lastRun?.tg_avg ?? undefined,
    cells: report.runs.length,
    total,
    failed: report.runs.filter(row => row.status === 'failed').length,
    skipped: report.runs.filter(row => row.status === 'skipped').length,
    best: report.best_candidate ?? null,
    leaderboard: report.leaderboard ?? [],
    storage: report.storage ?? null,
    cache: report.result_cache ?? null,
  };
}

function statusFromLatestReport(report: BenchmarkReport): Status {
  if (report.current_cell) {
    return `restored-interrupted:${report.current_cell.tag}`;
  }
  const total =
    report.last_started_cell?.total_cells ??
    report.last_completed_cell?.total_cells ??
    report.runs.length;
  if (total > 0 && report.runs.length >= total) {
    return 'complete';
  }
  if (report.runs.length > 0) {
    return `restored:${report.runs.length}/${total || '-'}`;
  }
  return 'idle';
}

export const BenchmarkRunnerScreen: React.FC<BenchmarkRunnerScreenProps> =
  observer(({__runner, __loadConfig}) => {
    const [status, setStatus] = useState<Status>('idle');
    const [lastCell, setLastCell] = useState<BenchmarkLiveUpdate>({});
    const runningRef = useRef(false);

    // Autostart trigger source: the two deep-link delivery sites set
    // `autostart` on the navigation route params via parseBenchmarkAutostart;
    // we just read it here. Tests mock @react-navigation/native's useRoute
    // to inject the desired params (the codebase's existing per-file
    // navigation-mock pattern; see SquarePalCard / ModelCard / useDeepLinking
    // test files).
    const route = useRoute();
    const autostart = (route.params as {autostart?: boolean} | undefined)
      ?.autostart;

    const onRun = useCallback(async () => {
      // Single-flight: ignore taps while a run is in progress.
      if (runningRef.current) {
        return;
      }
      if (
        status !== 'idle' &&
        status !== 'complete' &&
        !status.startsWith('restored:') &&
        !status.startsWith('restored-interrupted:') &&
        !status.startsWith('error:')
      ) {
        return;
      }
      runningRef.current = true;
      setStatus('preparing:loading config');
      // Runtime reference to the marker constant — protects against Hermes
      // DCE. Without this, the literal would be stripped from the e2e
      // bundle and the CI grep "must be present" check would falsely pass.
      console.log(`[${BENCH_RUN_MATRIX}] starting matrix run`);
      try {
        const cfg = await (__loadConfig ?? loadConfig)();
        await (__runner ?? runMatrix)(cfg, setStatus, setLastCell);
      } catch (e) {
        const msg = (e as Error).message ?? 'unknown';
        setStatus(`error:${msg.slice(0, TRUNCATE_ERROR)}`);
      } finally {
        runningRef.current = false;
      }
    }, [status, __loadConfig, __runner]);

    const onReset = useCallback(() => {
      if (runningRef.current) {
        return;
      }
      setStatus('idle');
      setLastCell({});
    }, []);

    useEffect(() => {
      if (autostart || runningRef.current) {
        return;
      }
      let cancelled = false;
      readLatestReport()
        .then(report => {
          if (!report || cancelled || runningRef.current) {
            return;
          }
          setLastCell(liveUpdateFromReport(report));
          setStatus(statusFromLatestReport(report));
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [autostart]);

    // Autostart: when the route carries autostart=true, invoke the SAME
    // onRun the button uses — no second start path, same use of the
    // already-pushed bench-config.json. Fired at most once per mount via the
    // ref latch, so MobX-observer re-renders (this is an `observer`) cannot
    // re-trigger it; onRun's single-flight gate (runningRef + status guard)
    // remains the authoritative backstop. A falsey/absent autostart leaves
    // the screen idle, waiting for a tap, exactly as before.
    const autostartFiredRef = useRef(false);
    useEffect(() => {
      if (autostart && !autostartFiredRef.current) {
        autostartFiredRef.current = true;
        // onRun owns its own try/catch (it sets status='error:...' on
        // failure), so the catch here is only a floating-promise guard.
        onRun().catch(() => undefined);
      }
    }, [autostart, onRun]);

    const kind = statusKind(status);
    const running =
      kind === 'running' ||
      (runningRef.current &&
        status !== 'complete' &&
        !status.startsWith('error:'));
    const canRun =
      !running &&
      (status === 'idle' ||
        status === 'complete' ||
        status.startsWith('restored:') ||
        status.startsWith('restored-interrupted:') ||
        status.startsWith('error:'));
    const canReset = !running;
    const progress = progressRatio(lastCell);
    const completed = lastCell.cells ?? 0;
    const total = lastCell.total ?? 0;
    const best = lastCell.best ?? null;
    const leaderboard = lastCell.leaderboard ?? [];
    const storage = lastCell.storage ?? null;
    const cache = lastCell.cache ?? null;
    const latest = lastCell.latest ?? null;

    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.container}
        testID="bench-runner-screen">
        <View style={styles.header}>
          <Text style={styles.title}>Benchmark Runner</Text>
          <Text style={styles.subtitle}>
            {completed}/{total || '-'} cells
          </Text>
        </View>

        <View style={styles.statusPanel}>
          <View style={styles.statusHeader}>
            <View style={styles.statusTextBlock}>
              <Text style={styles.statusTitle}>{statusTitle(status)}</Text>
              <Text
                testID="bench-runner-screen-status"
                accessibilityLabel={status}
                style={styles.rawStatus}>
                {status}
              </Text>
            </View>
            <View
              style={[
                styles.statusPill,
                kind === 'done'
                  ? styles.statusPillDone
                  : kind === 'error'
                    ? styles.statusPillError
                    : kind === 'running'
                      ? styles.statusPillRunning
                      : styles.statusPillIdle,
              ]}>
              <Text style={styles.statusPillText}>
                {kind === 'done'
                  ? 'done'
                  : kind === 'error'
                    ? 'error'
                    : kind === 'running'
                      ? 'live'
                      : 'idle'}
              </Text>
            </View>
          </View>
          <Text style={styles.statusDetail} numberOfLines={3}>
            {statusDetail(status)}
          </Text>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {width: `${Math.round(progress * 100)}%`},
              ]}
            />
          </View>
        </View>

        <View
          testID="bench-runner-screen-result-preview"
          style={styles.metricsGrid}>
          <View style={styles.metricTile}>
            <Text style={styles.metricValue}>{completed}</Text>
            <Text style={styles.metricLabel}>completed</Text>
          </View>
          <View style={styles.metricTile}>
            <Text style={styles.metricValue}>{lastCell.failed ?? 0}</Text>
            <Text style={styles.metricLabel}>failed</Text>
          </View>
          <View style={styles.metricTile}>
            <Text style={styles.metricValue}>{lastCell.skipped ?? 0}</Text>
            <Text style={styles.metricLabel}>skipped</Text>
          </View>
          <View style={styles.metricTile}>
            <Text style={styles.metricValue}>{formatMetric(lastCell.pp)}</Text>
            <Text style={styles.metricLabel}>last pp</Text>
          </View>
          <View style={styles.metricTile}>
            <Text style={styles.metricValue}>{formatMetric(lastCell.tg)}</Text>
            <Text style={styles.metricLabel}>last tg</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Latest Cell</Text>
          {latest ? (
            <View testID="bench-latest-cell" style={styles.latestPanel}>
              <View style={styles.latestHeader}>
                <Text style={styles.latestName} numberOfLines={1}>
                  {compactFilename(latest.filename)}
                </Text>
                <Text
                  style={[
                    styles.latestStatus,
                    latest.status === 'ok'
                      ? styles.latestStatusOk
                      : latest.status === 'failed'
                        ? styles.latestStatusFailed
                        : styles.latestStatusSkipped,
                  ]}>
                  {latest.status}
                </Text>
              </View>
              <View style={styles.bestStats}>
                <Text style={styles.bestStat}>
                  pp {formatMetric(latest.pp_avg ?? undefined)}
                </Text>
                <Text style={styles.bestStat}>
                  {formatGenerationMetric(latest)}
                </Text>
                <Text style={styles.bestStat}>
                  score {formatMetric(latest.rank_score ?? undefined, 0)}
                </Text>
                <Text
                  style={[
                    styles.bestStat,
                    latest.quality_passed === false && styles.qualityFailed,
                    latest.quality_passed === true && styles.qualityPassed,
                  ]}>
                  {formatQuality(latest.quality_passed, latest.quality_score)}
                </Text>
              </View>
              <Text style={styles.bestMeta} numberOfLines={2}>
                {latest.effective_backend} / {latest.quant} /{' '}
                {formatContextVariant(latest)} / {latest.settings_fingerprint}
              </Text>
              <Text style={styles.capabilityText} numberOfLines={3}>
                {formatCapabilities(latest.quality_capabilities)}
              </Text>
              {latest.reason || latest.error ? (
                <Text
                  style={[
                    styles.latestReason,
                    latest.status === 'failed' && styles.storageError,
                  ]}
                  numberOfLines={3}>
                  {latest.reason ?? latest.error}
                </Text>
              ) : null}
            </View>
          ) : (
            <Text style={styles.emptyText}>No cell has finished yet.</Text>
          )}
        </View>

        <View style={styles.controls}>
          <Pressable
            testID="bench-run-button"
            accessibilityRole="button"
            disabled={!canRun}
            style={({pressed}) => [
              styles.primaryButton,
              !canRun && styles.buttonDisabled,
              pressed && canRun && styles.buttonPressed,
            ]}
            onPress={onRun}>
            <Text style={styles.primaryButtonText}>
              {running
                ? 'Running'
                : status === 'complete'
                  ? 'Run again'
                  : 'Start'}
            </Text>
          </Pressable>
          <Pressable
            testID="bench-reset-button"
            accessibilityRole="button"
            disabled={!canReset}
            style={({pressed}) => [
              styles.secondaryButton,
              !canReset && styles.buttonDisabled,
              pressed && canReset && styles.buttonPressed,
            ]}
            onPress={onReset}>
            <Text style={styles.secondaryButtonText}>Reset</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Best Candidate</Text>
          {best ? (
            <View style={styles.bestPanel}>
              <Text style={styles.bestName} numberOfLines={2}>
                {compactFilename(best.filename)}
              </Text>
              <View style={styles.bestStats}>
                <Text style={styles.bestStat}>
                  score {formatMetric(best.rank_score, 0)}
                </Text>
                <Text style={styles.bestStat}>
                  pp {formatMetric(best.pp_avg)}
                </Text>
                <Text style={styles.bestStat}>
                  {formatGenerationMetric(best)}
                </Text>
                <Text style={styles.bestStat}>
                  mem {formatMetric(best.peak_memory_mb ?? undefined, 0)} MB
                </Text>
                <Text
                  style={[
                    styles.bestStat,
                    best.quality_passed === false && styles.qualityFailed,
                    best.quality_passed === true && styles.qualityPassed,
                  ]}>
                  {formatQuality(best.quality_passed, best.quality_score)}
                </Text>
              </View>
              <Text style={styles.bestMeta} numberOfLines={2}>
                {best.effective_backend} / {formatContextVariant(best)} /{' '}
                {best.settings_fingerprint}
              </Text>
              <Text style={styles.capabilityText} numberOfLines={3}>
                {formatCapabilities(best.quality_capabilities)}
              </Text>
            </View>
          ) : (
            <Text style={styles.emptyText}>No promoted model yet.</Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Live Ranking</Text>
          {leaderboard.length > 0 ? (
            leaderboard.map((entry, index) => (
              <View
                key={`${entry.model_store_id}-${entry.context_variant_id ?? BASELINE_CONTEXT_VARIANT_ID}-${entry.settings_fingerprint}-${index}`}
                style={styles.rankRow}>
                <Text style={styles.rankIndex}>{index + 1}</Text>
                <View style={styles.rankBody}>
                  <Text style={styles.rankName} numberOfLines={1}>
                    {compactFilename(entry.filename)}
                  </Text>
                  <Text style={styles.rankMeta} numberOfLines={1}>
                    {entry.effective_backend} / {entry.quant} /{' '}
                    {formatContextVariant(entry)} /{' '}
                    {formatQuality(entry.quality_passed, entry.quality_score)}
                  </Text>
                  <Text style={styles.rankMeta} numberOfLines={1}>
                    {formatCapabilities(entry.quality_capabilities)}
                  </Text>
                </View>
                <View style={styles.rankMetrics}>
                  <Text style={styles.rankScore}>
                    {formatMetric(entry.rank_score, 0)}
                  </Text>
                  <Text style={styles.rankSpeed}>
                    {formatGenerationMetric(entry)}
                  </Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No ranked cells yet.</Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Storage</Text>
          <View style={styles.storagePanel}>
            <Text style={styles.storageText} numberOfLines={2}>
              Keeping{' '}
              {compactFilename(storage?.kept_filename ?? best?.filename)}
            </Text>
            <Text style={styles.storageSubtext}>
              Deleted {storage?.deleted_count ?? 0} models / reclaimed{' '}
              {formatBytes(storage?.reclaimed_bytes_estimate)}
            </Text>
            <Text style={styles.storageSubtext}>
              Last cleanup deleted {storage?.last_deleted_count ?? 0} /{' '}
              {formatBytes(storage?.last_reclaimed_bytes_estimate)}
            </Text>
            {storage?.errors && storage.errors.length > 0 ? (
              <Text style={styles.storageError} numberOfLines={2}>
                {storage.errors.join(' | ')}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Result Cache</Text>
          <View style={styles.storagePanel}>
            <Text style={styles.storageText}>
              {cache?.quality_failure_entries ?? 0} quality failures cached
            </Text>
            <Text style={styles.storageSubtext}>
              {cache?.completed_entries ?? 0} completed cells cached
            </Text>
            <Text style={styles.storageSubtext}>
              Skipped {cache?.skipped_completed_cells ?? 0} completed /{' '}
              {cache?.skipped_quality_failures ?? 0} quality repeats
            </Text>
            {cache?.last_skip_key ? (
              <Text style={styles.storageSubtext} numberOfLines={2}>
                Last skip {cache.last_skip_key}
              </Text>
            ) : null}
            {cache?.last_completed_skip_key ? (
              <Text style={styles.storageSubtext} numberOfLines={2}>
                Last completed skip {cache.last_completed_skip_key}
              </Text>
            ) : null}
            {cache?.errors && cache.errors.length > 0 ? (
              <Text style={styles.storageError} numberOfLines={2}>
                {cache.errors.join(' | ')}
              </Text>
            ) : null}
          </View>
        </View>
      </ScrollView>
    );
  });

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0e1116',
  },
  container: {
    padding: 16,
    paddingBottom: 28,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  title: {
    color: '#f5f7fa',
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    color: '#9aa8b7',
    fontSize: 13,
    fontWeight: '600',
  },
  statusPanel: {
    backgroundColor: '#171d25',
    borderColor: '#263241',
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  statusHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  statusTextBlock: {
    flex: 1,
  },
  statusTitle: {
    color: '#f5f7fa',
    fontSize: 18,
    fontWeight: '700',
  },
  rawStatus: {
    color: '#7f8b99',
    fontSize: 11,
    lineHeight: 15,
    marginTop: 4,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusPillIdle: {
    backgroundColor: '#2b3542',
  },
  statusPillRunning: {
    backgroundColor: '#175a78',
  },
  statusPillDone: {
    backgroundColor: '#1c6b4b',
  },
  statusPillError: {
    backgroundColor: '#7c2430',
  },
  statusPillText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  statusDetail: {
    color: '#c6d0dc',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 12,
  },
  progressTrack: {
    backgroundColor: '#283241',
    borderRadius: 999,
    height: 8,
    marginTop: 14,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: '#45b8d8',
    borderRadius: 999,
    height: '100%',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  metricTile: {
    backgroundColor: '#161b22',
    borderColor: '#263241',
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: '48%',
    flexGrow: 1,
    minHeight: 70,
    padding: 12,
  },
  metricValue: {
    color: '#f5f7fa',
    fontSize: 22,
    fontWeight: '800',
  },
  metricLabel: {
    color: '#8d9aab',
    fontSize: 12,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  controls: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#45b8d8',
    borderRadius: 8,
    flex: 1,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 12,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#232d3b',
    borderColor: '#354255',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 18,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonPressed: {
    opacity: 0.78,
  },
  primaryButtonText: {
    color: '#061016',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryButtonText: {
    color: '#e6edf5',
    fontSize: 15,
    fontWeight: '700',
  },
  section: {
    marginTop: 18,
  },
  sectionTitle: {
    color: '#f5f7fa',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 8,
  },
  bestPanel: {
    backgroundColor: '#171d25',
    borderColor: '#2b3a4b',
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  bestName: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 21,
  },
  bestStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  bestStat: {
    backgroundColor: '#243041',
    borderRadius: 6,
    color: '#dbe7f3',
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  qualityPassed: {
    backgroundColor: '#1c6b4b',
  },
  qualityFailed: {
    backgroundColor: '#5b2a32',
  },
  bestMeta: {
    color: '#8d9aab',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 10,
  },
  capabilityText: {
    color: '#aac7d6',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 8,
  },
  rankRow: {
    alignItems: 'center',
    backgroundColor: '#151a21',
    borderColor: '#253141',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
    minHeight: 64,
    padding: 10,
  },
  rankIndex: {
    color: '#45b8d8',
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
    width: 28,
  },
  rankBody: {
    flex: 1,
    minWidth: 0,
  },
  rankName: {
    color: '#f5f7fa',
    fontSize: 14,
    fontWeight: '800',
  },
  rankMeta: {
    color: '#8794a5',
    fontSize: 12,
    marginTop: 3,
  },
  rankMetrics: {
    alignItems: 'flex-end',
    minWidth: 62,
  },
  rankScore: {
    color: '#f5f7fa',
    fontSize: 15,
    fontWeight: '900',
  },
  rankSpeed: {
    color: '#8d9aab',
    fontSize: 12,
    marginTop: 2,
  },
  emptyText: {
    backgroundColor: '#151a21',
    borderColor: '#253141',
    borderRadius: 8,
    borderWidth: 1,
    color: '#8997a7',
    fontSize: 13,
    padding: 14,
  },
  latestPanel: {
    backgroundColor: '#151a21',
    borderColor: '#253141',
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  latestHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  latestName: {
    color: '#ffffff',
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
  },
  latestStatus: {
    borderRadius: 999,
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 5,
    textTransform: 'uppercase',
  },
  latestStatusOk: {
    backgroundColor: '#1c6b4b',
  },
  latestStatusFailed: {
    backgroundColor: '#7c2430',
  },
  latestStatusSkipped: {
    backgroundColor: '#5b4b1e',
  },
  latestReason: {
    color: '#9aa8b7',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 8,
  },
  storagePanel: {
    backgroundColor: '#151a21',
    borderColor: '#253141',
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  storageText: {
    color: '#e6edf5',
    fontSize: 14,
    fontWeight: '700',
  },
  storageSubtext: {
    color: '#8d9aab',
    fontSize: 12,
    marginTop: 6,
  },
  storageError: {
    color: '#ffb4bd',
    fontSize: 12,
    marginTop: 6,
  },
});
