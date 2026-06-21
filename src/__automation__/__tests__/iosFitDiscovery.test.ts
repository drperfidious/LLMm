import {
  buildDynamicIosFitConfig,
  buildStaticIosFitConfig,
} from '../iosFitDiscovery';
import {getUnsafeIosTurbo2BenchmarkReason} from '../iosBenchmarkSafety';
import type {IosFitDeviceFitProfile} from '../iosFitProfile';

const IPHONE_14_PRO_MAX = {
  platform: 'ios',
  device_id: 'iPhone15,3',
  model: 'iPhone',
  total_memory_bytes: 6 * 1024 * 1024 * 1024,
  available_memory_bytes: 3 * 1024 * 1024 * 1024,
};

const A16_IPAD = {
  platform: 'ios',
  device_id: 'iPad15,7',
  model: 'iPad',
  total_memory_bytes: 4 * 1024 * 1024 * 1024,
  available_memory_bytes: 2 * 1024 * 1024 * 1024,
};

describe('iosFitDiscovery', () => {
  it('keeps the full turbo V ladder for iPhone 14 Pro Max class devices', () => {
    const result = buildStaticIosFitConfig({
      deviceProfile: IPHONE_14_PRO_MAX,
      now: '2026-06-20T00:00:00.000Z',
    });

    expect(result.config.settings_axes).toEqual([
      {name: 'cache_type_v', values: ['turbo4', 'turbo3', 'turbo2']},
    ]);
    expect(result.diagnostics.turbo2_disabled_for_device).toBe(false);
  });

  it('removes turbo2 cells from constrained A16 iPad ladders', () => {
    const result = buildStaticIosFitConfig({
      deviceProfile: A16_IPAD,
      now: '2026-06-20T00:00:00.000Z',
    });

    expect(result.config.settings_axes).toEqual([
      {name: 'cache_type_v', values: ['turbo4', 'turbo3']},
    ]);
    expect(result.diagnostics.turbo_v_ladder).toEqual(['turbo4', 'turbo3']);
    expect(result.diagnostics.turbo2_disabled_for_device).toBe(true);
    expect(result.config.suite?.target_device?.notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Turbo2 V-cache cells are disabled'),
      ]),
    );
  });

  it('flags stale turbo2 benchmark cells as unsafe on constrained iPads', () => {
    expect(
      getUnsafeIosTurbo2BenchmarkReason({
        deviceProfile: A16_IPAD,
        backend: 'gpu',
        baseCacheTypeV: 'turbo4',
        overrides: {cache_type_v: 'turbo2'},
      }),
    ).toContain('unsafe-ios-turbo2-metal-profile');
    expect(
      getUnsafeIosTurbo2BenchmarkReason({
        deviceProfile: IPHONE_14_PRO_MAX,
        backend: 'gpu',
        baseCacheTypeV: 'turbo4',
        overrides: {cache_type_v: 'turbo2'},
      }),
    ).toBeNull();
  });

  it('seeds the generated ladder from bundled iOS rules, including Bonsai 8B', () => {
    const result = buildStaticIosFitConfig({
      deviceProfile: IPHONE_14_PRO_MAX,
      now: '2026-06-20T00:00:00.000Z',
    });

    const bonsai = result.config.models.find(
      model => model.hfModelId === 'prism-ml/Bonsai-8B-gguf',
    );
    expect(bonsai).toBeTruthy();
    expect(bonsai?.quants).toContainEqual({
      quant: 'q1_0',
      filename: 'Bonsai-8B-Q1_0.gguf',
      size: 1158654496,
    });
    expect(result.config.suite?.id).toBe('ios-fit-dynamic-ladder');
    expect(['mid', 'high']).toContain(result.diagnostics.target_tier);
  });

  it('uses cached fit observations as candidate evidence', () => {
    const fitProfile: IosFitDeviceFitProfile = {
      version: 1,
      device_key: 'ios:iPhone15,3:6144mb',
      updated_at: '2026-06-20T00:00:00.000Z',
      observations: [
        {
          key: 'experimental|Experimental-Q4_K_M.gguf|gpu|cache_type_v=turbo4',
          model_id: 'experimental-2b',
          hf_model_id: 'example/Experimental-2B-GGUF',
          model_store_id:
            'example/Experimental-2B-GGUF/Experimental-Q4_K_M.gguf',
          filename: 'Experimental-Q4_K_M.gguf',
          quant: 'q4_k_m',
          requested_backend: 'gpu',
          effective_backend: 'metal',
          settings_fingerprint: 'cache_type_v=turbo4',
          status: 'fit',
          quality_score: 1,
          quality_passed: true,
          pp_avg: 500,
          tg_avg: 40,
          peak_memory_mb: 1200,
          first_seen_at: '2026-06-20T00:00:00.000Z',
          last_seen_at: '2026-06-20T00:00:00.000Z',
          hits: 1,
        },
      ],
    };

    const result = buildStaticIosFitConfig({
      deviceProfile: IPHONE_14_PRO_MAX,
      fitProfile,
      now: '2026-06-20T00:00:00.000Z',
    });

    expect(
      result.config.models.some(
        model => model.hfModelId === 'example/Experimental-2B-GGUF',
      ),
    ).toBe(true);
  });

  it('adds an MTP context probe only to likely NextN candidates', () => {
    const result = buildStaticIosFitConfig({
      deviceProfile: IPHONE_14_PRO_MAX,
      now: '2026-06-20T00:00:00.000Z',
    });

    const qwen35 = result.config.models.find(model =>
      model.hfModelId.toLowerCase().includes('qwen_qwen3.5'),
    );
    expect(qwen35?.context_variants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({id: 'baseline'}),
        expect.objectContaining({
          id: 'mtp-n3',
          init_params: expect.objectContaining({
            speculative: {type: 'draft-mtp', n_max: 3},
          }),
        }),
      ]),
    );

    const smollm = result.config.models.find(model =>
      model.hfModelId.toLowerCase().includes('smollm3'),
    );
    expect(smollm?.context_variants).toBeUndefined();
  });

  it('refreshes Hugging Face search results and keeps newer supported Bonsai GGUF variants', async () => {
    const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/api/models?')) {
        return {
          ok: true,
          json: async () => [
            {
              id: 'prism-ml/Ternary-Bonsai-8B-gguf',
              tags: ['gguf', 'on-device', 'bonsai', 'text-generation'],
              downloads: 100,
              likes: 20,
              lastModified: '2026-06-10T00:00:00.000Z',
            },
          ],
        } as Response;
      }
      if (String(url).includes('/api/models/prism-ml/Ternary-Bonsai-8B-gguf')) {
        return {
          ok: true,
          json: async () => ({
            id: 'prism-ml/Ternary-Bonsai-8B-gguf',
            tags: ['gguf', 'on-device', 'bonsai', 'text-generation'],
            downloads: 100,
            likes: 20,
            lastModified: '2026-06-10T00:00:00.000Z',
            siblings: [
              {rfilename: 'Ternary-Bonsai-8B-PQ2_0.gguf'},
              {rfilename: 'Ternary-Bonsai-8B-Q2_0.gguf'},
              {rfilename: 'Ternary-Bonsai-8B-Q2_0_g64.gguf'},
              {rfilename: 'Ternary-Bonsai-8B-F16.gguf'},
            ],
          }),
        } as Response;
      }
      if (init?.method === 'HEAD') {
        return {
          ok: true,
          headers: {
            get: (name: string) =>
              name.toLowerCase() === 'x-linked-size' ? '1536000000' : null,
          },
        } as Response;
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await buildDynamicIosFitConfig({
      deviceProfile: IPHONE_14_PRO_MAX,
      refreshRemote: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: '2026-06-20T00:00:00.000Z',
    });

    const ternary = result.config.models.find(
      model => model.hfModelId === 'prism-ml/Ternary-Bonsai-8B-gguf',
    );
    expect(ternary).toBeTruthy();
    expect(ternary?.quants).toEqual(
      expect.arrayContaining([
        {
          quant: 'pq2_0',
          filename: 'Ternary-Bonsai-8B-PQ2_0.gguf',
          size: 1536000000,
        },
        {
          quant: 'q2_0',
          filename: 'Ternary-Bonsai-8B-Q2_0.gguf',
          size: 1536000000,
        },
        {
          quant: 'q2_0_g64',
          filename: 'Ternary-Bonsai-8B-Q2_0_g64.gguf',
          size: 1536000000,
        },
      ]),
    );
    expect(result.diagnostics.remote_refreshed).toBe(true);
  });
});
