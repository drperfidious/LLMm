import {getFitEvidence, updateFitProfileFromReport} from '../iosFitProfile';
import type {BenchConfig} from '../screens/BenchmarkRunnerScreen';

const CONFIG: BenchConfig = {
  models: [
    {
      id: 'qwen3.5-0.8b',
      hfModelId: 'bartowski/Qwen_Qwen3.5-0.8B-GGUF',
      quants: [
        {
          quant: 'q4_0',
          filename: 'Qwen_Qwen3.5-0.8B-Q4_0.gguf',
          size: 522000000,
        },
      ],
    },
  ],
  backends: ['gpu'],
};

describe('iosFitProfile', () => {
  it('records completed benchmark rows and exposes exact fit evidence', () => {
    const profile = updateFitProfileFromReport({
      existing: null,
      config: CONFIG,
      report: {
        device_profile: {
          platform: 'ios',
          device_id: 'iPhone15,3',
          total_memory_bytes: 6 * 1024 * 1024 * 1024,
          available_memory_bytes: 3 * 1024 * 1024 * 1024,
        },
        runs: [
          {
            model_id: 'qwen3.5-0.8b',
            quant: 'q4_0',
            requested_backend: 'gpu',
            effective_backend: 'metal',
            settings_fingerprint: 'cache_type_v=turbo3',
            settings_overrides: {cache_type_v: 'turbo3'},
            status: 'ok',
            quality_score: 1,
            quality_passed: true,
            pp_avg: 850,
            tg_avg: 48,
            peak_memory_mb: 834,
            memory_before: {available_bytes: 3 * 1024 * 1024 * 1024},
            effective_init_params: {
              n_ctx: 4096,
              use_mmap: true,
              cache_type_k: 'q8_0',
              cache_type_v: 'turbo3',
            },
            timestamp: '2026-06-20T00:00:00.000Z',
          },
        ],
      },
      now: '2026-06-20T00:00:01.000Z',
    });

    expect(profile.observations).toHaveLength(1);
    expect(profile.observations[0]).toMatchObject({
      model_id: 'qwen3.5-0.8b',
      hf_model_id: 'bartowski/Qwen_Qwen3.5-0.8B-GGUF',
      filename: 'Qwen_Qwen3.5-0.8B-Q4_0.gguf',
      file_size_bytes: 522000000,
      status: 'fit',
      peak_memory_mb: 834,
      cache_type_v: 'turbo3',
    });

    const evidence = getFitEvidence(profile, {
      modelId: 'qwen3.5-0.8b',
      hfModelId: 'bartowski/Qwen_Qwen3.5-0.8B-GGUF',
      filenames: ['Qwen_Qwen3.5-0.8B-Q4_0.gguf'],
    });
    expect(evidence.exact_passes).toBe(1);
    expect(evidence.observed_peak_memory_mb).toBe(834);
    expect(evidence.fastest_tg_avg).toBe(48);
  });
});
