import {
  buildIosFitConfig,
  IOS_14_PRO_MAX_PROFILE,
} from '../../e2e/fixtures/ios-fit-models';

describe('iOS fit config builder', () => {
  it('defaults to the iPhone 14 Pro Max Metal Turbo mmap-backed ladder', () => {
    const cfg = buildIosFitConfig({});
    expect(cfg.suite.target_device).toMatchObject(IOS_14_PRO_MAX_PROFILE);
    expect(cfg.backends).toEqual(['gpu']);
    expect(cfg.base_params).toMatchObject({
      n_ctx: 4096,
      use_mmap: true,
      flash_attn_type: 'on',
      cache_type_k: 'q8_0',
      cache_type_v: 'turbo4',
    });
    expect(cfg.settings_axes).toEqual([
      {name: 'cache_type_v', values: ['turbo4', 'turbo3', 'turbo2']},
    ]);
    expect(cfg.quality_tasks).toHaveLength(4);
    expect(cfg.models.length).toBeGreaterThan(3);
    expect(
      cfg.models
        .filter(model => model.backends?.includes('cpu'))
        .map(model => `${model.id}:${model.quants[0]?.quant}`),
    ).toEqual([]);
  });

  it('adds the small CPU reference set only when requested', () => {
    const cfg = buildIosFitConfig({IOS_FIT_CPU_REFERENCES: 'default'});

    expect(
      cfg.models
        .filter(model => model.backends?.includes('cpu'))
        .map(model => `${model.id}:${model.quants[0]?.quant}`),
    ).toEqual(['qwen3.5-0.8b:q4_0', 'smollm3-3b:q4_k_m']);
  });

  it('emits verified Qwen3.5 GGUF filenames while keeping bartowski repo ids', () => {
    const cfg = buildIosFitConfig({
      IOS_FIT_MODELS: 'qwen3.5-0.8b,qwen3.5-2b',
      IOS_FIT_QUANTS: 'q4_0,q6_k',
      IOS_FIT_CPU_REFERENCES: '0',
    });

    expect(cfg.models).toEqual([
      {
        id: 'qwen3.5-0.8b',
        hfModelId: 'bartowski/Qwen_Qwen3.5-0.8B-GGUF',
        quants: [
          {quant: 'q4_0', filename: 'Qwen_Qwen3.5-0.8B-Q4_0.gguf'},
          {quant: 'q6_k', filename: 'Qwen_Qwen3.5-0.8B-Q6_K.gguf'},
        ],
      },
      {
        id: 'qwen3.5-2b',
        hfModelId: 'bartowski/Qwen_Qwen3.5-2B-GGUF',
        quants: [
          {quant: 'q4_0', filename: 'Qwen_Qwen3.5-2B-Q4_0.gguf'},
          {quant: 'q6_k', filename: 'Qwen_Qwen3.5-2B-Q6_K.gguf'},
        ],
      },
    ]);
  });

  it('supports a small smoke tier and model/quant filters', () => {
    const cfg = buildIosFitConfig({
      IOS_FIT_TIER: 'smoke',
      IOS_FIT_MODELS: 'qwen3-1.7b',
      IOS_FIT_QUANTS: 'q4_0',
      IOS_FIT_BACKENDS: 'cpu,gpu',
      IOS_FIT_QUALITY: '0',
    });
    expect(cfg.models).toHaveLength(1);
    expect(cfg.models[0]).toMatchObject({
      id: 'qwen3-1.7b',
      quants: [{quant: 'q4_0'}],
    });
    expect(cfg.backends).toEqual(['cpu', 'gpu']);
    expect(cfg.quality_tasks).toEqual([]);
  });

  it('lets the caller raise context size for max-fit testing', () => {
    const cfg = buildIosFitConfig({
      IOS_FIT_N_CTX: '8192',
      IOS_FIT_USE_MMAP: 'true',
      IOS_FIT_SETTLE_MS: '1',
    });
    expect(cfg.base_params.n_ctx).toBe(8192);
    expect(cfg.inter_cell_settle_ms).toBe(1);
    expect(cfg.settings_axes).toEqual([
      {name: 'use_mmap', values: ['true']},
      {name: 'cache_type_v', values: ['turbo4', 'turbo3', 'turbo2']},
    ]);
  });

  it('lets the caller override the Turbo base cache pair', () => {
    const cfg = buildIosFitConfig({
      IOS_FIT_BASE_CACHE_K: 'f16',
      IOS_FIT_BASE_CACHE_V: 'f16',
      IOS_FIT_FLASH_ATTN_TYPE: 'auto',
    });
    expect(cfg.base_params).toMatchObject({
      cache_type_k: 'f16',
      cache_type_v: 'f16',
      flash_attn_type: 'auto',
    });
    expect(cfg.settings_axes).toBeUndefined();
  });

  it('lets the caller force a single conservative Turbo V cache profile', () => {
    const cfg = buildIosFitConfig({
      IOS_FIT_CACHE_V: 'turbo4',
      IOS_FIT_CPU_REFERENCES: '0',
    });
    expect(cfg.settings_axes).toEqual([
      {name: 'cache_type_v', values: ['turbo4']},
    ]);
  });

  it('keeps no-mmap as an explicit stress sweep only', () => {
    const cfg = buildIosFitConfig({
      IOS_FIT_USE_MMAP: 'true,false',
      IOS_FIT_CACHE_V: 'turbo4',
      IOS_FIT_CPU_REFERENCES: '0',
    });
    expect(cfg.settings_axes).toEqual([
      {name: 'use_mmap', values: ['true', 'false']},
      {name: 'cache_type_v', values: ['turbo4']},
    ]);
  });
});
