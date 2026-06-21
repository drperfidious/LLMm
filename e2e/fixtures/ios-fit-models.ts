import {DEFAULT_IOS_FIT_QUALITY_TASKS} from '../../src/__automation__/qualityTasks';

import {
  BENCHMARK_FULL_MODELS,
  BenchmarkMatrixBackend,
  BenchmarkMatrixQuant,
  BenchSettingsAxis,
} from './benchmark-models';

type IosFitTier = 'smoke' | 'ladder' | 'max';

interface IosFitRung {
  id: string;
  quants: BenchmarkMatrixQuant[];
}

export interface IosFitConfig {
  suite: {
    id: string;
    label: string;
    target_device: typeof IOS_14_PRO_MAX_PROFILE;
    selection: {
      mode: 'promote_best';
      min_quality_score: number;
      scorer: string;
    };
  };
  models: Array<{
    id: string;
    hfModelId: string;
    quants: Array<{quant: string; filename: string}>;
    backends?: BenchmarkMatrixBackend[];
  }>;
  backends: BenchmarkMatrixBackend[];
  bench: {pp: number; tg: number; pl: number; nr: number};
  base_params: {
    n_ctx: number;
    n_batch: number;
    n_ubatch: number;
    use_mmap: boolean;
    flash_attn_type: 'auto' | 'on' | 'off';
    cache_type_k?: string;
    cache_type_v?: string;
  };
  inter_cell_settle_ms: number;
  quality_tasks: Array<(typeof DEFAULT_IOS_FIT_QUALITY_TASKS)[number]>;
  settings_axes?: BenchSettingsAxis[];
}

const GIB = 1024 * 1024 * 1024;
const DEFAULT_TURBO_V_LADDER = ['turbo4', 'turbo3', 'turbo2'];

export const IOS_14_PRO_MAX_PROFILE = {
  slug: 'iphone-14-pro-max',
  label: 'iPhone 14 Pro Max',
  machine: 'iPhone15,3',
  chip: 'A16 Bionic',
  expected_total_memory_bytes: 6 * GIB,
  notes: [
    'Apple publishes the A16 CPU/GPU/Neural Engine specs, but not RAM.',
    '6 GiB is a seed value; runtime reports use DeviceInfo.getTotalMemory().',
    'Default backend is iOS Metal with TurboQuant KV cache (q8_0 K / turbo4->turbo3->turbo2 V ladder).',
    'Default ladder is mmap-only; no-mmap is an explicit boundary/stress sweep.',
    'CPU reference cells are opt-in so they do not inherit the Metal Turbo baseline.',
  ],
};

const DEFAULT_CPU_REFERENCES: Array<{
  id: string;
  quant: BenchmarkMatrixQuant;
}> = [
  {id: 'qwen3.5-0.8b', quant: 'q4_0'},
  {id: 'smollm3-3b', quant: 'q4_k_m'},
];

const IOS_FIT_SMOKE: IosFitRung[] = [
  {id: 'qwen3.5-0.8b', quants: ['q4_0']},
  {id: 'gemma-3-1b', quants: ['q4_0']},
  {id: 'qwen3-1.7b', quants: ['q4_0']},
  {id: 'smollm3-3b', quants: ['q4_k_m']},
];

const IOS_FIT_LADDER: IosFitRung[] = [
  {id: 'qwen3.5-0.8b', quants: ['q4_0', 'q4_k_m', 'q6_k', 'q8_0']},
  {id: 'gemma-3-1b', quants: ['q4_0', 'q4_k_m', 'q6_k', 'q8_0']},
  {
    id: 'lfm2.5-1.2b-instruct',
    quants: ['q4_0', 'q4_k_m', 'q6_k', 'q8_0'],
  },
  {
    id: 'deepseek-r1-distill-qwen-1.5b',
    quants: ['q3_k_m', 'q4_0', 'q4_k_m', 'q6_k'],
  },
  {id: 'qwen3-1.7b', quants: ['q3_k_m', 'q4_0', 'q4_k_m', 'q6_k']},
  {
    id: 'qwen3.5-2b',
    quants: ['q3_k_m', 'q4_0', 'q4_k_m', 'q5_k_m', 'q6_k'],
  },
  {id: 'smollm3-3b', quants: ['q4_k_m']},
  {id: 'phi-3.5-mini', quants: ['iq1_s', 'q2_k', 'q3_k_m', 'q4_0']},
  {id: 'phi-4-mini', quants: ['iq1_s', 'q2_k', 'q3_k_m', 'q4_0']},
  {id: 'gemma-4-e2b', quants: ['iq1_s', 'q2_k', 'q3_k_m', 'q4_0']},
];

function parseCsv(raw: string | undefined): string[] | undefined {
  return raw
    ? raw
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)
    : undefined;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${raw} is not a positive integer`);
  }
  return n;
}

function tierFromEnv(env: NodeJS.ProcessEnv): IosFitTier {
  const raw = (env.IOS_FIT_TIER || 'ladder').toLowerCase();
  if (raw === 'smoke' || raw === 'ladder' || raw === 'max') {
    return raw;
  }
  return 'ladder';
}

function rungsForTier(tier: IosFitTier): IosFitRung[] {
  if (tier === 'smoke') {
    return IOS_FIT_SMOKE;
  }
  if (tier === 'max') {
    return IOS_FIT_LADDER.map(rung => {
      const model = BENCHMARK_FULL_MODELS.find(m => m.id === rung.id);
      return {
        id: rung.id,
        quants: (model?.quants?.map(q => q.quant) ?? rung.quants).filter(
          (q): q is BenchmarkMatrixQuant => Boolean(q),
        ),
      };
    });
  }
  return IOS_FIT_LADDER;
}

function parseBackends(env: NodeJS.ProcessEnv): BenchmarkMatrixBackend[] {
  const requested = parseCsv(env.IOS_FIT_BACKENDS);
  const all: BenchmarkMatrixBackend[] = ['cpu', 'gpu', 'hexagon'];
  if (!requested) {
    return ['gpu'];
  }
  return all.filter(backend => requested.includes(backend));
}

function parseCpuReferences(env: NodeJS.ProcessEnv) {
  const raw = env.IOS_FIT_CPU_REFERENCES;
  if (!raw) {
    return [];
  }
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === '0' ||
    normalized === 'false' ||
    normalized === 'none' ||
    normalized === 'off'
  ) {
    return [];
  }
  if (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'default' ||
    normalized === 'on'
  ) {
    return DEFAULT_CPU_REFERENCES;
  }
  return raw
    .split(',')
    .map(token => {
      const [id, quant] = token.split(':').map(part => part.trim());
      return id && quant
        ? ({id: id.toLowerCase(), quant: quant.toLowerCase()} as {
            id: string;
            quant: BenchmarkMatrixQuant;
          })
        : null;
    })
    .filter((ref): ref is (typeof DEFAULT_CPU_REFERENCES)[number] =>
      Boolean(ref),
    );
}

function parseSettingsAxes(env: NodeJS.ProcessEnv): BenchSettingsAxis[] {
  const axes: BenchSettingsAxis[] = [];
  const mmap = parseCsv(env.IOS_FIT_USE_MMAP);
  if (mmap && mmap.length > 0) {
    axes.push({name: 'use_mmap', values: mmap});
  }

  const cacheK = parseCsv(env.IOS_FIT_CACHE_K);
  if (cacheK && cacheK.length > 0) {
    axes.push({name: 'cache_type_k', values: cacheK});
  }

  const cacheV = parseCsv(env.IOS_FIT_CACHE_V);
  if (cacheV && cacheV.length > 0) {
    axes.push({name: 'cache_type_v', values: cacheV});
  } else if (!env.IOS_FIT_BASE_CACHE_V) {
    axes.push({name: 'cache_type_v', values: DEFAULT_TURBO_V_LADDER});
  }

  const threads = parseCsv(env.IOS_FIT_N_THREADS);
  if (threads && threads.length > 0) {
    axes.push({
      name: 'n_threads',
      values: threads.map(t => parsePositiveInt(t, 1)),
    });
  }

  return axes;
}

function parseCacheType(raw: string | undefined): string | undefined {
  const values = parseCsv(raw);
  if (!values || values.length === 0) {
    return undefined;
  }
  if (values.length > 1) {
    throw new Error('Base cache type accepts a single value; use IOS_FIT_CACHE_K/V for sweeps');
  }
  return values[0];
}

function hfModelId(searchQuery: string, selectorText: string): string {
  return `${searchQuery.trim().split(/\s+/)[0]}/${selectorText}-GGUF`;
}

export function buildIosFitConfig(
  env: NodeJS.ProcessEnv = process.env,
): IosFitConfig {
  const tier = tierFromEnv(env);
  const modelFilter = parseCsv(env.IOS_FIT_MODELS);
  const quantFilter = parseCsv(env.IOS_FIT_QUANTS);
  const backends = parseBackends(env);
  const cpuReferences =
    backends.includes('gpu') && !backends.includes('cpu')
      ? parseCpuReferences(env)
      : [];
  const rungs = rungsForTier(tier).filter(rung =>
    modelFilter ? modelFilter.includes(rung.id.toLowerCase()) : true,
  );

  const primaryModels = rungs
    .map(rung => {
      const model = BENCHMARK_FULL_MODELS.find(m => m.id === rung.id);
      if (!model) {
        return null;
      }
      const quants = rung.quants
        .filter(q => (quantFilter ? quantFilter.includes(q) : true))
        .map(q => model.quants?.find(v => v.quant === q))
        .filter((v): v is NonNullable<typeof v> => Boolean(v))
        .map(v => ({quant: v.quant, filename: v.downloadFile}));

      return {
        id: model.id,
        hfModelId: hfModelId(model.searchQuery, model.selectorText),
        quants,
      };
    })
    .filter((model): model is NonNullable<typeof model> =>
      Boolean(model && model.quants.length > 0),
    );

  const cpuReferenceModels = cpuReferences
    .filter(ref => (modelFilter ? modelFilter.includes(ref.id) : true))
    .filter(ref => (quantFilter ? quantFilter.includes(ref.quant) : true))
    .map(ref => {
      const model = BENCHMARK_FULL_MODELS.find(m => m.id === ref.id);
      const variant = model?.quants?.find(q => q.quant === ref.quant);
      if (!model || !variant) {
        return null;
      }
      return {
        id: model.id,
        hfModelId: hfModelId(model.searchQuery, model.selectorText),
        quants: [{quant: variant.quant, filename: variant.downloadFile}],
        backends: ['cpu'] as BenchmarkMatrixBackend[],
      };
    })
    .filter((model): model is NonNullable<typeof model> => Boolean(model));

  const models = [...primaryModels, ...cpuReferenceModels];

  const settingsAxes = parseSettingsAxes(env);
  const cfg: IosFitConfig = {
    suite: {
      id: `ios-fit-${tier}`,
      label: 'iOS model fit ladder',
      target_device: IOS_14_PRO_MAX_PROFILE,
      selection: {
        mode: 'promote_best' as const,
        min_quality_score: Number(env.IOS_FIT_MIN_QUALITY_SCORE || 1),
        scorer: 'quality-speed-memory-v1',
      },
    },
    models,
    backends,
    bench: {
      pp: parsePositiveInt(env.IOS_FIT_PP, 256),
      tg: parsePositiveInt(env.IOS_FIT_TG, 96),
      pl: 1,
      nr: parsePositiveInt(env.IOS_FIT_NR, 2),
    },
    base_params: {
      n_ctx: parsePositiveInt(env.IOS_FIT_N_CTX, 4096),
      n_batch: parsePositiveInt(env.IOS_FIT_N_BATCH, 512),
      n_ubatch: parsePositiveInt(env.IOS_FIT_N_UBATCH, 512),
      use_mmap: true,
      flash_attn_type:
        (parseCsv(env.IOS_FIT_FLASH_ATTN_TYPE)?.[0] as
          | 'auto'
          | 'on'
          | 'off'
          | undefined) ?? 'on',
      cache_type_k: parseCacheType(env.IOS_FIT_BASE_CACHE_K) ?? 'q8_0',
      cache_type_v: parseCacheType(env.IOS_FIT_BASE_CACHE_V) ?? 'turbo4',
    },
    inter_cell_settle_ms: parsePositiveInt(env.IOS_FIT_SETTLE_MS, 5000),
    quality_tasks:
      env.IOS_FIT_QUALITY === '0'
        ? []
        : DEFAULT_IOS_FIT_QUALITY_TASKS.map(task => ({...task})),
  };

  if (settingsAxes.length > 0) {
    cfg.settings_axes = settingsAxes;
  }
  return cfg;
}
