import {Platform} from 'react-native';

import iosRulesRaw from '../store/bundledDeviceRules/rules.ios.json';
import {classify} from '../services/deviceRules/classify';
import {parseDeviceRules} from '../services/deviceRules/parse';
import type {RuleCandidate, Tier} from '../services/deviceRules/types';

import {DEFAULT_IOS_FIT_QUALITY_TASKS} from './qualityTasks';
import type {
  Backend,
  BenchConfig,
  BenchContextVariant,
} from './screens/BenchmarkRunnerScreen';
import {
  getFitEvidence,
  type FitEvidence,
  type IosFitDeviceFitProfile,
  type IosFitRuntimeDeviceProfile,
} from './iosFitProfile';
import {
  iosTurboVLadderForDevice,
  isConstrainedIosTurbo2Device,
} from './iosBenchmarkSafety';

const GIB = 1024 * 1024 * 1024;
const DEFAULT_MTP_CONTEXT_VARIANTS: BenchContextVariant[] = [
  {id: 'baseline', label: 'baseline'},
  {
    id: 'mtp-n3',
    label: 'MTP draft n=3',
    init_params: {
      speculative: {
        type: 'draft-mtp',
        n_max: 3,
      },
      spec_draft_n_max: 3,
    },
  },
];
const DEFAULT_TARGET_MEMORY_BYTES = 6 * GIB;
const MAX_DYNAMIC_MODELS = 18;
const MAX_REMOTE_REPOS = 24;
const HF_TIMEOUT_MS = 8000;

type CandidateSource =
  | 'persisted-best'
  | 'profile'
  | 'static'
  | 'device-rules'
  | 'hf-cache'
  | 'hf-refresh';

export interface IosFitDiscoveryVariant {
  quant: string;
  filename: string;
  size?: number;
  source?: CandidateSource;
}

export interface IosFitDiscoveryCandidate {
  id: string;
  displayName?: string;
  hfModelId: string;
  params?: number;
  tags?: string[];
  downloads?: number;
  likes?: number;
  lastModified?: string;
  variants: IosFitDiscoveryVariant[];
  sources: CandidateSource[];
  priority: number;
  estimated_peak_bytes?: number;
  fit_class?:
    | 'known-good'
    | 'likely-good'
    | 'boundary'
    | 'likely-fail'
    | 'unknown';
}

export interface IosFitCandidateCatalog {
  version: 1;
  updated_at: string;
  candidates: IosFitDiscoveryCandidate[];
  queries: string[];
}

export interface PersistedBestCandidateSeed {
  model_id: string;
  hf_model_id: string;
  filename: string;
  quant: string;
  size_bytes?: number;
}

export interface BuildDynamicIosFitConfigOptions {
  deviceProfile?: IosFitRuntimeDeviceProfile | null;
  fitProfile?: IosFitDeviceFitProfile | null;
  cachedCatalog?: IosFitCandidateCatalog | null;
  persistedBest?: PersistedBestCandidateSeed | null;
  refreshRemote?: boolean;
  fetchImpl?: typeof fetch;
  now?: string;
}

export interface BuildDynamicIosFitConfigResult {
  config: BenchConfig;
  catalog: IosFitCandidateCatalog;
  diagnostics: {
    generated_by: 'ios-fit-dynamic-discovery';
    generated_at: string;
    source_counts: Record<string, number>;
    selected_model_count: number;
    candidate_count: number;
    target_tier: Tier;
    remote_refreshed: boolean;
    turbo_v_ladder: string[];
    turbo2_disabled_for_device: boolean;
  };
}

interface StaticSeed {
  id: string;
  hfModelId: string;
  params?: number;
  quants: IosFitDiscoveryVariant[];
}

const STATIC_SEEDS: StaticSeed[] = [
  {
    id: 'qwen3.5-0.8b',
    hfModelId: 'bartowski/Qwen_Qwen3.5-0.8B-GGUF',
    params: 800_000_000,
    quants: [
      {quant: 'q4_0', filename: 'Qwen_Qwen3.5-0.8B-Q4_0.gguf'},
      {quant: 'q4_k_m', filename: 'Qwen_Qwen3.5-0.8B-Q4_K_M.gguf'},
      {quant: 'q6_k', filename: 'Qwen_Qwen3.5-0.8B-Q6_K.gguf'},
      {quant: 'q8_0', filename: 'Qwen_Qwen3.5-0.8B-Q8_0.gguf'},
    ],
  },
  {
    id: 'gemma-3-1b',
    hfModelId: 'bartowski/google_gemma-3-1b-it-GGUF',
    params: 1_000_000_000,
    quants: [
      {quant: 'q4_0', filename: 'google_gemma-3-1b-it-Q4_0.gguf'},
      {quant: 'q4_k_m', filename: 'google_gemma-3-1b-it-Q4_K_M.gguf'},
      {quant: 'q6_k', filename: 'google_gemma-3-1b-it-Q6_K.gguf'},
      {quant: 'q8_0', filename: 'google_gemma-3-1b-it-Q8_0.gguf'},
    ],
  },
  {
    id: 'lfm2.5-1.2b-instruct',
    hfModelId: 'LiquidAI/LFM2.5-1.2B-Instruct-GGUF',
    params: 1_170_340_608,
    quants: [
      {quant: 'q4_0', filename: 'LFM2.5-1.2B-Instruct-Q4_0.gguf'},
      {quant: 'q4_k_m', filename: 'LFM2.5-1.2B-Instruct-Q4_K_M.gguf'},
      {quant: 'q6_k', filename: 'LFM2.5-1.2B-Instruct-Q6_K.gguf'},
      {quant: 'q8_0', filename: 'LFM2.5-1.2B-Instruct-Q8_0.gguf'},
    ],
  },
  {
    id: 'deepseek-r1-distill-qwen-1.5b',
    hfModelId: 'bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF',
    params: 1_500_000_000,
    quants: [
      {quant: 'q3_k_m', filename: 'DeepSeek-R1-Distill-Qwen-1.5B-Q3_K_M.gguf'},
      {quant: 'q4_0', filename: 'DeepSeek-R1-Distill-Qwen-1.5B-Q4_0.gguf'},
      {quant: 'q4_k_m', filename: 'DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf'},
      {quant: 'q6_k', filename: 'DeepSeek-R1-Distill-Qwen-1.5B-Q6_K.gguf'},
    ],
  },
  {
    id: 'qwen3-1.7b',
    hfModelId: 'bartowski/Qwen_Qwen3-1.7B-GGUF',
    params: 2_031_739_904,
    quants: [
      {quant: 'q3_k_m', filename: 'Qwen_Qwen3-1.7B-Q3_K_M.gguf'},
      {quant: 'q4_0', filename: 'Qwen_Qwen3-1.7B-Q4_0.gguf'},
      {quant: 'q4_k_m', filename: 'Qwen_Qwen3-1.7B-Q4_K_M.gguf'},
      {quant: 'q6_k', filename: 'Qwen_Qwen3-1.7B-Q6_K.gguf'},
    ],
  },
  {
    id: 'qwen3.5-2b',
    hfModelId: 'bartowski/Qwen_Qwen3.5-2B-GGUF',
    params: 1_881_825_088,
    quants: [
      {quant: 'q3_k_m', filename: 'Qwen_Qwen3.5-2B-Q3_K_M.gguf'},
      {quant: 'q4_0', filename: 'Qwen_Qwen3.5-2B-Q4_0.gguf'},
      {quant: 'q4_k_m', filename: 'Qwen_Qwen3.5-2B-Q4_K_M.gguf'},
      {quant: 'q5_k_m', filename: 'Qwen_Qwen3.5-2B-Q5_K_M.gguf'},
      {quant: 'q6_k', filename: 'Qwen_Qwen3.5-2B-Q6_K.gguf'},
    ],
  },
  {
    id: 'smollm3-3b',
    hfModelId: 'bartowski/HuggingFaceTB_SmolLM3-3B-GGUF',
    params: 3_075_098_624,
    quants: [
      {
        quant: 'q4_k_m',
        filename: 'HuggingFaceTB_SmolLM3-3B-Q4_K_M.gguf',
        size: 1_915_305_792,
      },
    ],
  },
  {
    id: 'phi-3.5-mini',
    hfModelId: 'bartowski/Phi-3.5-mini-instruct-GGUF',
    params: 3_821_000_000,
    quants: [
      {quant: 'iq2_m', filename: 'Phi-3.5-mini-instruct-IQ2_M.gguf'},
      {quant: 'q2_k', filename: 'Phi-3.5-mini-instruct-Q2_K.gguf'},
      {quant: 'q3_k_m', filename: 'Phi-3.5-mini-instruct-Q3_K_M.gguf'},
      {quant: 'q4_0', filename: 'Phi-3.5-mini-instruct-Q4_0.gguf'},
    ],
  },
  {
    id: 'phi-4-mini',
    hfModelId: 'bartowski/microsoft_Phi-4-mini-instruct-GGUF',
    params: 3_800_000_000,
    quants: [
      {quant: 'iq2_m', filename: 'microsoft_Phi-4-mini-instruct-IQ2_M.gguf'},
      {quant: 'q2_k', filename: 'microsoft_Phi-4-mini-instruct-Q2_K.gguf'},
      {quant: 'q3_k_m', filename: 'microsoft_Phi-4-mini-instruct-Q3_K_M.gguf'},
      {quant: 'q4_0', filename: 'microsoft_Phi-4-mini-instruct-Q4_0.gguf'},
    ],
  },
];

const HF_SEARCH_QUERIES = [
  'prism-ml Bonsai gguf',
  'Ternary Bonsai gguf',
  'Qwen3.5 GGUF',
  'SmolLM3 GGUF',
  'LFM2.5 GGUF on-device',
  'Ministral 3B GGUF',
  'Gemma 4 GGUF',
];
const ALL_TIERS: Tier[] = ['low', 'mid', 'high', 'flagship'];

const QUANT_RANK: Record<string, number> = {
  q1_0: 10,
  pq2_0: 12,
  q2_0: 14,
  q2_0_g64: 15,
  iq2_m: 20,
  q2_k: 22,
  q3_k_m: 30,
  q4_0: 40,
  q4_k_m: 42,
  q5_k_m: 50,
  q6_k: 60,
  q8_0: 80,
  f16: 160,
};

function safeId(raw: string): string {
  return raw
    .replace(/-gguf$/i, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 64);
}

function parseQuant(filename: string): string | null {
  const name = filename.replace(/\.gguf$/i, '');
  const match = name.match(
    /(?:^|[-_.])(IQ2_M|Q1_0|PQ2_0|Q2_0_g64|Q2_0|Q2_K|Q3_K_M|Q4_0|Q4_K_M|Q5_K_M|Q6_K|Q8_0|F16)$/i,
  );
  return match ? match[1].toLowerCase() : null;
}

function quantRank(quant: string): number {
  return QUANT_RANK[quant.toLowerCase()] ?? 999;
}

function candidateSearchText(candidate: IosFitDiscoveryCandidate): string {
  return [
    candidate.id,
    candidate.displayName,
    candidate.hfModelId,
    ...(candidate.tags ?? []),
    ...candidate.variants.map(variant => variant.filename),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function shouldProbeMtp(candidate: IosFitDiscoveryCandidate): boolean {
  const text = candidateSearchText(candidate);
  const compact = text.replace(/[^a-z0-9]+/g, '');
  return (
    text.includes('nextn') ||
    text.includes('mtp') ||
    compact.includes('qwen35') ||
    compact.includes('qwen36')
  );
}

function contextVariantsForCandidate(
  candidate: IosFitDiscoveryCandidate,
): BenchContextVariant[] | undefined {
  if (!shouldProbeMtp(candidate)) {
    return undefined;
  }
  return DEFAULT_MTP_CONTEXT_VARIANTS.map(variant => ({
    ...variant,
    init_params: variant.init_params ? {...variant.init_params} : undefined,
  }));
}

function tierRank(tier: Tier): number {
  return ['low', 'mid', 'high', 'flagship'].indexOf(tier);
}

function deviceSignalsFromProfile(profile?: IosFitRuntimeDeviceProfile | null) {
  return {
    ramBytes: profile?.total_memory_bytes ?? DEFAULT_TARGET_MEMORY_BYTES,
    machine: profile?.device_id ?? profile?.device ?? undefined,
  };
}

function targetTierFromProfile(
  profile?: IosFitRuntimeDeviceProfile | null,
): Tier {
  try {
    const rules = parseDeviceRules(iosRulesRaw);
    return classify(deviceSignalsFromProfile(profile), rules.classifier, 'ios');
  } catch {
    return 'high';
  }
}

function totalMemoryBytes(profile?: IosFitRuntimeDeviceProfile | null): number {
  return profile?.total_memory_bytes ?? DEFAULT_TARGET_MEMORY_BYTES;
}

function estimatedVariantSizeBytes(
  candidate: IosFitDiscoveryCandidate,
  variant: IosFitDiscoveryVariant,
): number | undefined {
  if (typeof variant.size === 'number' && variant.size > 0) {
    return variant.size;
  }
  if (!candidate.params) {
    return undefined;
  }
  const quant = variant.quant.toLowerCase();
  const bits =
    quant === 'q1_0'
      ? 1.35
      : quant === 'pq2_0' || quant === 'q2_0' || quant === 'q2_0_g64'
        ? 2.1
        : quant === 'iq2_m' || quant === 'q2_k'
          ? 2.4
          : quant === 'q3_k_m'
            ? 3.4
            : quant === 'q4_0' || quant === 'q4_k_m'
              ? 4.6
              : quant === 'q5_k_m'
                ? 5.6
                : quant === 'q6_k'
                  ? 6.6
                  : quant === 'q8_0'
                    ? 8.6
                    : quant === 'f16'
                      ? 16
                      : 4.8;
  return Math.round((candidate.params * bits) / 8 + 96 * 1024 * 1024);
}

function estimatePeakBytes(args: {
  candidate: IosFitDiscoveryCandidate;
  evidence: FitEvidence;
  memoryBytes: number;
}): number {
  if (typeof args.evidence.observed_peak_memory_mb === 'number') {
    return Math.round(
      args.evidence.observed_peak_memory_mb * 1024 * 1024 * 1.08,
    );
  }
  const sizes = args.candidate.variants
    .map(variant => estimatedVariantSizeBytes(args.candidate, variant))
    .filter((size): size is number => typeof size === 'number' && size > 0);
  const minSize = sizes.length > 0 ? Math.min(...sizes) : undefined;
  const paramsB = (args.candidate.params ?? 1_500_000_000) / 1_000_000_000;
  const kv = Math.min(
    1.2 * GIB,
    Math.max(192 * 1024 * 1024, paramsB * 128 * 1024 * 1024),
  );
  const mmapWeight = 1.12;
  const overhead = 420 * 1024 * 1024;
  return Math.round(
    (minSize ?? paramsB * 650 * 1024 * 1024) * mmapWeight + kv + overhead,
  );
}

function fitClassForEstimate(args: {
  estimatedPeakBytes: number;
  evidence: FitEvidence;
  memoryBytes: number;
}): IosFitDiscoveryCandidate['fit_class'] {
  if (args.evidence.exact_passes > 0) {
    return 'known-good';
  }
  if (args.evidence.likely_hard_fail) {
    return 'likely-fail';
  }
  const budget = args.memoryBytes * 0.72;
  if (args.estimatedPeakBytes <= budget * 0.88) {
    return 'likely-good';
  }
  if (args.estimatedPeakBytes <= budget * 1.12) {
    return 'boundary';
  }
  return 'likely-fail';
}

function sourceWeight(sources: CandidateSource[]): number {
  let score = 0;
  if (sources.includes('persisted-best')) {
    score += 10_000;
  }
  if (sources.includes('profile')) {
    score += 4000;
  }
  if (sources.includes('device-rules')) {
    score += 3000;
  }
  if (sources.includes('hf-refresh')) {
    score += 1800;
  }
  if (sources.includes('hf-cache')) {
    score += 1200;
  }
  if (sources.includes('static')) {
    score += 900;
  }
  return score;
}

function scoreCandidate(args: {
  candidate: IosFitDiscoveryCandidate;
  evidence: FitEvidence;
  memoryBytes: number;
}): number {
  const {candidate, evidence, memoryBytes} = args;
  const fitClass = candidate.fit_class ?? 'unknown';
  const fitScore =
    fitClass === 'known-good'
      ? 8000
      : fitClass === 'likely-good'
        ? 4500
        : fitClass === 'boundary'
          ? 2500
          : fitClass === 'likely-fail'
            ? -7000
            : 0;
  const tags = candidate.tags ?? [];
  const tagText = tags.join(' ').toLowerCase();
  const bonsaiBonus =
    candidate.hfModelId.toLowerCase().includes('bonsai') ||
    tagText.includes('bonsai')
      ? 2200
      : 0;
  const mobileBonus =
    tagText.includes('on-device') || tagText.includes('metal') ? 650 : 0;
  const speedBonus = (evidence.fastest_tg_avg ?? 0) * 40;
  const popularity =
    Math.log10(Math.max(1, candidate.downloads ?? 0) + 1) * 120 +
    Math.log10(Math.max(1, candidate.likes ?? 0) + 1) * 180;
  const recency =
    candidate.lastModified &&
    Date.now() - Date.parse(candidate.lastModified) < 120 * 24 * 60 * 60 * 1000
      ? 450
      : 0;
  const sizePenalty =
    candidate.estimated_peak_bytes &&
    candidate.estimated_peak_bytes > memoryBytes * 0.72
      ? ((candidate.estimated_peak_bytes - memoryBytes * 0.72) / GIB) * 900
      : 0;
  return (
    candidate.priority +
    sourceWeight(candidate.sources) +
    fitScore +
    bonsaiBonus +
    mobileBonus +
    speedBonus +
    popularity +
    recency -
    sizePenalty
  );
}

function normalizeVariant(
  variant: IosFitDiscoveryVariant,
): IosFitDiscoveryVariant | null {
  if (!/\.gguf$/i.test(variant.filename)) {
    return null;
  }
  const quant = (
    variant.quant ||
    parseQuant(variant.filename) ||
    ''
  ).toLowerCase();
  if (!quant || quant === 'f16') {
    return null;
  }
  return {
    ...variant,
    quant,
    size:
      typeof variant.size === 'number' &&
      Number.isFinite(variant.size) &&
      variant.size > 0
        ? variant.size
        : undefined,
  };
}

function mergeCandidate(
  map: Map<string, IosFitDiscoveryCandidate>,
  next: IosFitDiscoveryCandidate,
) {
  const key = next.hfModelId;
  const current = map.get(key);
  if (!current) {
    map.set(key, {
      ...next,
      id: next.id || safeId(next.hfModelId.split('/')[1] ?? next.hfModelId),
      variants: next.variants
        .map(normalizeVariant)
        .filter((v): v is IosFitDiscoveryVariant => Boolean(v)),
      sources: [...new Set(next.sources)],
    });
    return;
  }
  const variants = new Map(
    current.variants.map(variant => [variant.filename, variant]),
  );
  for (const variant of next.variants) {
    const normalized = normalizeVariant(variant);
    if (!normalized) {
      continue;
    }
    const existing = variants.get(normalized.filename);
    variants.set(normalized.filename, {
      ...(existing ?? normalized),
      ...normalized,
      size: normalized.size ?? existing?.size,
      source: normalized.source ?? existing?.source,
    });
  }
  current.displayName = current.displayName ?? next.displayName;
  current.params = current.params ?? next.params;
  current.tags = [...new Set([...(current.tags ?? []), ...(next.tags ?? [])])];
  current.downloads = Math.max(current.downloads ?? 0, next.downloads ?? 0);
  current.likes = Math.max(current.likes ?? 0, next.likes ?? 0);
  current.lastModified =
    !current.lastModified ||
    (next.lastModified && next.lastModified > current.lastModified)
      ? next.lastModified
      : current.lastModified;
  current.priority = Math.max(current.priority, next.priority);
  current.sources = [...new Set([...current.sources, ...next.sources])];
  current.variants = [...variants.values()];
}

function staticCandidates(): IosFitDiscoveryCandidate[] {
  return STATIC_SEEDS.map(seed => ({
    id: seed.id,
    hfModelId: seed.hfModelId,
    params: seed.params,
    variants: seed.quants.map(variant => ({...variant, source: 'static'})),
    sources: ['static'],
    priority: 100,
  }));
}

function candidateFromRule(
  candidate: RuleCandidate,
  priority: number,
): IosFitDiscoveryCandidate {
  const quant = parseQuant(candidate.hfFilename) ?? 'rule';
  return {
    id: candidate.model,
    displayName: candidate.displayName,
    hfModelId: candidate.hfRepo,
    params: candidate.params,
    variants: [
      {
        quant,
        filename: candidate.hfFilename,
        size: candidate.sizeBytes,
        source: 'device-rules',
      },
    ],
    sources: ['device-rules'],
    priority,
  };
}

function deviceRuleCandidates(profile?: IosFitRuntimeDeviceProfile | null): {
  tier: Tier;
  candidates: IosFitDiscoveryCandidate[];
} {
  try {
    const rules = parseDeviceRules(iosRulesRaw);
    const tier = classify(
      deviceSignalsFromProfile(profile),
      rules.classifier,
      'ios',
    );
    const maxRank = Math.min(tierRank(tier) + 1, tierRank('flagship'));
    const tiers = ALL_TIERS.filter(item => tierRank(item) <= maxRank);
    return {
      tier,
      candidates: tiers.flatMap(item =>
        rules.tiers[item].models.map(candidate =>
          candidateFromRule(candidate, 800 + tierRank(item) * 200),
        ),
      ),
    };
  } catch {
    return {tier: 'high', candidates: []};
  }
}

function profileCandidates(
  profile?: IosFitDeviceFitProfile | null,
): IosFitDiscoveryCandidate[] {
  if (!profile) {
    return [];
  }
  const rows = profile.observations
    .filter(obs => obs.hf_model_id && obs.filename)
    .filter(obs => obs.status === 'fit' || obs.status === 'quality-failed')
    .slice(0, 80);
  return rows.map(obs => ({
    id: obs.model_id,
    hfModelId: obs.hf_model_id!,
    variants: [
      {
        quant: obs.quant,
        filename: obs.filename!,
        size: obs.file_size_bytes,
        source: 'profile',
      },
    ],
    sources: ['profile'],
    priority: obs.status === 'fit' ? 1400 : 900,
  }));
}

function persistedBestCandidate(
  best?: PersistedBestCandidateSeed | null,
): IosFitDiscoveryCandidate[] {
  if (!best) {
    return [];
  }
  return [
    {
      id: best.model_id,
      hfModelId: best.hf_model_id,
      variants: [
        {
          quant: best.quant,
          filename: best.filename,
          size: best.size_bytes,
          source: 'persisted-best',
        },
      ],
      sources: ['persisted-best'],
      priority: 3000,
    },
  ];
}

function cachedCandidates(
  catalog?: IosFitCandidateCatalog | null,
): IosFitDiscoveryCandidate[] {
  return (catalog?.candidates ?? []).map(candidate => ({
    ...candidate,
    variants: candidate.variants.map(variant => ({
      ...variant,
      source: variant.source ?? 'hf-cache',
    })),
    sources: [
      ...new Set([...candidate.sources, 'hf-cache']),
    ] as CandidateSource[],
    priority: Math.max(0, candidate.priority - 100),
  }));
}

function isTextGenerationRepo(raw: any): boolean {
  const id = String(raw?.id ?? '').toLowerCase();
  const tags = Array.isArray(raw?.tags)
    ? raw.tags.map((tag: unknown) => String(tag).toLowerCase())
    : [];
  const haystack = `${id} ${tags.join(' ')}`;
  if (!haystack.includes('gguf')) {
    return false;
  }
  if (
    /(image|flux|diffusion|stable-diffusion|embedding|embed|rerank|whisper|audio|tts)/.test(
      haystack,
    )
  ) {
    return false;
  }
  return (
    haystack.includes('text-generation') ||
    haystack.includes('conversational') ||
    haystack.includes('llama.cpp') ||
    haystack.includes('llama-cpp') ||
    haystack.includes('on-device') ||
    haystack.includes('bonsai')
  );
}

async function fetchJsonWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<any | null> {
  const controller =
    typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timeout = setTimeout(() => controller?.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller?.signal,
    } as RequestInit);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchResolveSize(
  fetchImpl: typeof fetch,
  repo: string,
  filename: string,
): Promise<number | undefined> {
  const controller =
    typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timeout = setTimeout(() => controller?.abort(), HF_TIMEOUT_MS);
  try {
    const response = await fetchImpl(
      `https://huggingface.co/${repo}/resolve/main/${encodeURIComponent(filename)}`,
      {
        method: 'HEAD',
        redirect: 'follow',
        signal: controller?.signal,
      } as RequestInit,
    );
    const linked = response.headers.get('x-linked-size');
    const length = response.headers.get('content-length');
    const parsed = Number(linked ?? length);
    return Number.isFinite(parsed) && parsed > 1024 ? parsed : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function siblingFilename(sibling: any): string | null {
  const raw = sibling?.rfilename;
  return typeof raw === 'string' && /\.gguf$/i.test(raw) ? raw : null;
}

function siblingSize(sibling: any): number | undefined {
  const direct = sibling?.size;
  const lfs = sibling?.lfs?.size;
  const value =
    typeof direct === 'number'
      ? direct
      : typeof lfs === 'number'
        ? lfs
        : undefined;
  return value && Number.isFinite(value) && value > 0 ? value : undefined;
}

async function candidateFromHfDetail(
  fetchImpl: typeof fetch,
  detail: any,
): Promise<IosFitDiscoveryCandidate | null> {
  if (!detail?.id || !isTextGenerationRepo(detail)) {
    return null;
  }
  const siblings = Array.isArray(detail.siblings) ? detail.siblings : [];
  const rawVariants = siblings
    .map(sibling => {
      const filename = siblingFilename(sibling);
      const quant = filename ? parseQuant(filename) : null;
      if (!filename || !quant || quant === 'f16') {
        return null;
      }
      return {
        quant,
        filename,
        size: siblingSize(sibling),
        source: 'hf-refresh' as const,
      };
    })
    .filter((v): v is IosFitDiscoveryVariant => Boolean(v))
    .sort((a, b) => quantRank(a.quant) - quantRank(b.quant));
  if (rawVariants.length === 0) {
    return null;
  }

  const selected = rawVariants.slice(0, 6);
  for (const variant of selected) {
    if (!variant.size) {
      variant.size = await fetchResolveSize(
        fetchImpl,
        detail.id,
        variant.filename,
      );
    }
  }

  const tags = Array.isArray(detail.tags) ? detail.tags.map(String) : [];
  return {
    id: safeId(String(detail.id).split('/')[1] ?? String(detail.id)),
    displayName: String(detail.id).split('/')[1],
    hfModelId: String(detail.id),
    tags,
    downloads:
      typeof detail.downloads === 'number' && Number.isFinite(detail.downloads)
        ? detail.downloads
        : undefined,
    likes:
      typeof detail.likes === 'number' && Number.isFinite(detail.likes)
        ? detail.likes
        : undefined,
    lastModified:
      typeof detail.lastModified === 'string' ? detail.lastModified : undefined,
    variants: selected,
    sources: ['hf-refresh'],
    priority: 500,
  };
}

async function discoverHfCandidates(
  fetchImpl: typeof fetch | undefined,
): Promise<IosFitDiscoveryCandidate[]> {
  if (!fetchImpl || typeof fetchImpl !== 'function') {
    return [];
  }
  const repos = new Map<string, any>();
  for (const query of HF_SEARCH_QUERIES) {
    const url =
      `https://huggingface.co/api/models?search=${encodeURIComponent(query)}` +
      '&limit=10&sort=lastModified&direction=-1';
    const json = await fetchJsonWithTimeout(fetchImpl, url, HF_TIMEOUT_MS);
    if (!Array.isArray(json)) {
      continue;
    }
    for (const model of json) {
      if (
        model?.id &&
        isTextGenerationRepo(model) &&
        repos.size < MAX_REMOTE_REPOS
      ) {
        repos.set(model.id, model);
      }
    }
  }

  const out: IosFitDiscoveryCandidate[] = [];
  for (const repo of [...repos.keys()].slice(0, MAX_REMOTE_REPOS)) {
    const detail = await fetchJsonWithTimeout(
      fetchImpl,
      `https://huggingface.co/api/models/${repo}`,
      HF_TIMEOUT_MS,
    );
    const candidate = await candidateFromHfDetail(fetchImpl, detail);
    if (candidate) {
      out.push(candidate);
    }
  }
  return out;
}

function selectVariants(
  candidate: IosFitDiscoveryCandidate,
): IosFitDiscoveryVariant[] {
  const sorted = candidate.variants
    .filter(variant => normalizeVariant(variant))
    .sort((a, b) => quantRank(a.quant) - quantRank(b.quant));
  const isBonsai = candidate.hfModelId.toLowerCase().includes('bonsai');
  const params = candidate.params ?? 0;
  const maxVariants = isBonsai ? 4 : params > 3_000_000_000 ? 4 : 5;
  const protectedVariants = sorted.filter(variant =>
    ['persisted-best', 'profile', 'device-rules'].includes(
      variant.source ?? '',
    ),
  );
  const merged = new Map<string, IosFitDiscoveryVariant>();
  for (const variant of [...protectedVariants, ...sorted]) {
    if (merged.size >= maxVariants && !protectedVariants.includes(variant)) {
      continue;
    }
    merged.set(variant.filename, variant);
  }
  return [...merged.values()].sort(
    (a, b) => quantRank(a.quant) - quantRank(b.quant),
  );
}

function enrichAndSelect(args: {
  candidates: IosFitDiscoveryCandidate[];
  profile?: IosFitDeviceFitProfile | null;
  deviceProfile?: IosFitRuntimeDeviceProfile | null;
}): IosFitDiscoveryCandidate[] {
  const memoryBytes = totalMemoryBytes(args.deviceProfile);
  const enriched = args.candidates
    .map(candidate => {
      const selectedVariants = selectVariants(candidate);
      const evidence = getFitEvidence(args.profile, {
        modelId: candidate.id,
        hfModelId: candidate.hfModelId,
        filenames: selectedVariants.map(variant => variant.filename),
      });
      const estimatedPeak = estimatePeakBytes({
        candidate: {...candidate, variants: selectedVariants},
        evidence,
        memoryBytes,
      });
      const fitClass = fitClassForEstimate({
        estimatedPeakBytes: estimatedPeak,
        evidence,
        memoryBytes,
      });
      return {
        ...candidate,
        variants: selectedVariants,
        estimated_peak_bytes: estimatedPeak,
        fit_class: fitClass,
        _score: scoreCandidate({
          candidate: {
            ...candidate,
            variants: selectedVariants,
            estimated_peak_bytes: estimatedPeak,
            fit_class: fitClass,
          },
          evidence,
          memoryBytes,
        }),
      };
    })
    .filter(candidate => candidate.variants.length > 0)
    .filter(
      candidate =>
        candidate.fit_class !== 'likely-fail' ||
        candidate.sources.includes('persisted-best'),
    );

  const selected: typeof enriched = [];
  const familyCounts = new Map<string, number>();
  for (const candidate of enriched.sort((a, b) => b._score - a._score)) {
    const family = candidate.id.split('-')[0];
    const count = familyCounts.get(family) ?? 0;
    const isProtected =
      candidate.sources.includes('persisted-best') ||
      candidate.sources.includes('profile') ||
      candidate.hfModelId.toLowerCase().includes('bonsai');
    if (selected.length >= MAX_DYNAMIC_MODELS && !isProtected) {
      continue;
    }
    if (count >= 4 && !isProtected) {
      continue;
    }
    selected.push(candidate);
    familyCounts.set(family, count + 1);
    if (selected.length >= MAX_DYNAMIC_MODELS + 3) {
      break;
    }
  }
  return selected
    .sort((a, b) => {
      const aRank =
        a.fit_class === 'known-good'
          ? -2
          : a.fit_class === 'likely-good'
            ? -1
            : 0;
      const bRank =
        b.fit_class === 'known-good'
          ? -2
          : b.fit_class === 'likely-good'
            ? -1
            : 0;
      return (
        aRank - bRank ||
        (a.estimated_peak_bytes ?? 0) - (b.estimated_peak_bytes ?? 0)
      );
    })
    .map(({_score, ...candidate}) => candidate as IosFitDiscoveryCandidate);
}

function buildCatalog(
  candidates: IosFitDiscoveryCandidate[],
  now: string,
): IosFitCandidateCatalog {
  return {
    version: 1,
    updated_at: now,
    queries: HF_SEARCH_QUERIES,
    candidates: candidates
      .map(candidate => ({
        ...candidate,
        variants: candidate.variants.map(variant => ({...variant})),
      }))
      .sort((a, b) => a.hfModelId.localeCompare(b.hfModelId)),
  };
}

function sourceCounts(
  candidates: IosFitDiscoveryCandidate[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const candidate of candidates) {
    for (const source of candidate.sources) {
      counts[source] = (counts[source] ?? 0) + 1;
    }
  }
  return counts;
}

function buildConfigFromCandidates(args: {
  selected: IosFitDiscoveryCandidate[];
  targetTier: Tier;
  diagnostics: BuildDynamicIosFitConfigResult['diagnostics'];
}): BenchConfig {
  const notes = [
    'Generated from bundled device rules, cached benchmark fit observations, and Hugging Face GGUF discovery.',
    'Static model math is only a cold-start estimate; future runs refine this list from benchmark-device-fit-profile.json.',
    'Mmap remains the default; no-mmap should be reserved for explicit boundary sweeps.',
    'Likely NextN/MTP candidates get an extra speculative decoding context variant; promotion remains quality-gated.',
  ];
  if (args.diagnostics.turbo2_disabled_for_device) {
    notes.push(
      'Turbo2 V-cache cells are disabled for this iPad-class Metal profile because prior A16/low-memory iPads process-killed during those benchmark loads.',
    );
  }
  return {
    suite: {
      id: 'ios-fit-dynamic-ladder',
      label: 'iOS dynamic model fit ladder',
      target_device: {
        slug: 'dynamic-ios-device',
        tier: args.targetTier,
        notes,
      },
      selection: {
        mode: 'promote_best',
        min_quality_score: 1,
        scorer: 'quality-speed-memory-v3-real-generation',
      },
      candidate_discovery: args.diagnostics,
    },
    models: args.selected.map(candidate => {
      const contextVariants = contextVariantsForCandidate(candidate);
      return {
        id: candidate.id,
        hfModelId: candidate.hfModelId,
        ...(contextVariants ? {context_variants: contextVariants} : {}),
        quants: candidate.variants.map(variant => ({
          quant: variant.quant,
          filename: variant.filename,
          ...(variant.size ? {size: variant.size} : {}),
        })),
      };
    }),
    backends: ['gpu'] as Backend[],
    bench: {pp: 256, tg: 96, pl: 1, nr: 2},
    base_params: {
      n_ctx: 4096,
      n_batch: 512,
      n_ubatch: 512,
      use_mmap: true,
      flash_attn_type: 'on',
      cache_type_k: 'q8_0',
      cache_type_v: 'turbo4',
    },
    settings_axes: [
      {name: 'cache_type_v', values: args.diagnostics.turbo_v_ladder},
    ],
    inter_cell_settle_ms: 5000,
    quality_tasks: DEFAULT_IOS_FIT_QUALITY_TASKS.map(task => ({...task})),
  };
}

export async function buildDynamicIosFitConfig(
  options: BuildDynamicIosFitConfigOptions = {},
): Promise<BuildDynamicIosFitConfigResult> {
  const now = options.now ?? new Date().toISOString();
  const targetTier = targetTierFromProfile(options.deviceProfile);
  const rules = deviceRuleCandidates(options.deviceProfile);
  const all = new Map<string, IosFitDiscoveryCandidate>();
  const addAll = (candidates: IosFitDiscoveryCandidate[]) =>
    candidates.forEach(candidate => mergeCandidate(all, candidate));

  addAll(staticCandidates());
  addAll(rules.candidates);
  addAll(profileCandidates(options.fitProfile));
  addAll(persistedBestCandidate(options.persistedBest));
  addAll(cachedCandidates(options.cachedCatalog));

  let remoteRefreshed = false;
  if (options.refreshRemote !== false) {
    const remote = await discoverHfCandidates(
      options.fetchImpl ?? globalThis.fetch,
    );
    if (remote.length > 0) {
      addAll(remote);
      remoteRefreshed = true;
    }
  }

  const allCandidates = [...all.values()];
  const selected = enrichAndSelect({
    candidates: allCandidates,
    profile: options.fitProfile,
    deviceProfile: options.deviceProfile,
  });
  const turboVLadder = iosTurboVLadderForDevice(options.deviceProfile);
  const catalog = buildCatalog(allCandidates, now);
  const diagnostics = {
    generated_by: 'ios-fit-dynamic-discovery' as const,
    generated_at: now,
    source_counts: sourceCounts(allCandidates),
    selected_model_count: selected.length,
    candidate_count: allCandidates.length,
    target_tier: targetTier,
    remote_refreshed: remoteRefreshed,
    turbo_v_ladder: turboVLadder,
    turbo2_disabled_for_device: isConstrainedIosTurbo2Device(
      options.deviceProfile,
    ),
  };

  return {
    config: buildConfigFromCandidates({
      selected,
      targetTier,
      diagnostics,
    }),
    catalog,
    diagnostics,
  };
}

export function buildStaticIosFitConfig(
  options: Pick<
    BuildDynamicIosFitConfigOptions,
    'deviceProfile' | 'fitProfile' | 'cachedCatalog' | 'persistedBest' | 'now'
  > = {},
): BuildDynamicIosFitConfigResult {
  const targetTier = targetTierFromProfile(options.deviceProfile);
  const rules = deviceRuleCandidates(options.deviceProfile);
  const all = new Map<string, IosFitDiscoveryCandidate>();
  const addAll = (candidates: IosFitDiscoveryCandidate[]) =>
    candidates.forEach(candidate => mergeCandidate(all, candidate));
  addAll(staticCandidates());
  addAll(rules.candidates);
  addAll(profileCandidates(options.fitProfile));
  addAll(persistedBestCandidate(options.persistedBest));
  addAll(cachedCandidates(options.cachedCatalog));

  const allCandidates = [...all.values()];
  const selected = enrichAndSelect({
    candidates: allCandidates,
    profile: options.fitProfile,
    deviceProfile: options.deviceProfile,
  });
  const turboVLadder = iosTurboVLadderForDevice(options.deviceProfile);
  const catalog = buildCatalog(
    allCandidates,
    options.now ?? new Date().toISOString(),
  );
  const diagnostics = {
    generated_by: 'ios-fit-dynamic-discovery' as const,
    generated_at: options.now ?? new Date().toISOString(),
    source_counts: sourceCounts(allCandidates),
    selected_model_count: selected.length,
    candidate_count: allCandidates.length,
    target_tier: targetTier,
    remote_refreshed: false,
    turbo_v_ladder: turboVLadder,
    turbo2_disabled_for_device: isConstrainedIosTurbo2Device(
      options.deviceProfile,
    ),
  };
  return {
    config: buildConfigFromCandidates({selected, targetTier, diagnostics}),
    catalog,
    diagnostics,
  };
}

export function isIosFitCandidateCatalog(
  value: unknown,
): value is IosFitCandidateCatalog {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as {version?: unknown}).version === 1 &&
    Array.isArray((value as {candidates?: unknown}).candidates)
  );
}

export function isIosFitDeviceFitProfile(
  value: unknown,
): value is IosFitDeviceFitProfile {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as {version?: unknown}).version === 1 &&
    Array.isArray((value as {observations?: unknown}).observations)
  );
}

export const IOS_FIT_DISCOVERY_QUERIES = HF_SEARCH_QUERIES;

// Keep the module deterministic under non-iOS unit tests. Android still has its
// own matrix path; this dynamic generator is explicitly for the iOS fit ladder.
export const IOS_FIT_DISCOVERY_PLATFORM = Platform.OS;
