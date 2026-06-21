import {
  renderIosFitSummaryMarkdown,
  summarizeIosFitReport,
} from '../../e2e/helpers/ios-fit-summary';

describe('iOS fit summary', () => {
  const report = {
    suite: {
      target_device: {label: 'iPhone 14 Pro Max'},
      selection: {min_quality_score: 1},
    },
    device_profile: {model: 'iPhone 14 Pro Max'},
    runs: [
      {
        model_id: 'tiny',
        quant: 'q4_0',
        requested_backend: 'gpu',
        status: 'ok',
        pp_avg: 20,
        tg_avg: 12,
        peak_memory_mb: 900,
        quality_score: 1,
        quality_passed: true,
        quality_capabilities: [
          'fit',
          'chat-capable',
          'format-capable',
          'agent-capable',
          'long-context-capable',
          'baseline-eligible',
        ],
        settings_fingerprint: 'use_mmap=true',
      },
      {
        model_id: 'mid',
        quant: 'q4_0',
        requested_backend: 'gpu',
        status: 'ok',
        pp_avg: 24,
        tg_avg: 18,
        peak_memory_mb: 1400,
        quality_score: 1,
        quality_passed: true,
        quality_capabilities: [
          'fit',
          'chat-capable',
          'format-capable',
          'agent-capable',
          'long-context-capable',
          'baseline-eligible',
        ],
        settings_fingerprint: 'use_mmap=true',
      },
      {
        model_id: 'large',
        quant: 'q4_0',
        requested_backend: 'gpu',
        status: 'ok',
        pp_avg: 26,
        tg_avg: 14,
        peak_memory_mb: 2200,
        quality_score: 0.75,
        quality_passed: false,
        quality_capabilities: [
          'fit',
          'chat-capable',
          'format-capable',
          'long-context-capable',
        ],
        settings_fingerprint: 'use_mmap=true',
      },
      {
        model_id: 'too-large',
        quant: 'q4_0',
        requested_backend: 'gpu',
        status: 'failed',
        pp_avg: null,
        tg_avg: null,
        peak_memory_mb: null,
        error: 'init failed',
      },
    ],
  };

  it('promotes only eligible rows that beat the incumbent', () => {
    const summary = summarizeIosFitReport(report);
    expect(summary.total_rows).toBe(4);
    expect(summary.eligible_rows).toBe(2);
    expect(summary.best?.row.model_id).toBe('mid');
    expect(summary.max_fit?.row.model_id).toBe('mid');
    expect(summary.capability_counts).toMatchObject({
      fit: 3,
      'chat-capable': 3,
      'agent-capable': 2,
      'baseline-eligible': 2,
    });
    expect(summary.promotions.map(row => row.row.model_id)).toEqual([
      'tiny',
      'mid',
    ]);
  });

  it('renders a compact markdown report', () => {
    const markdown = renderIosFitSummaryMarkdown(report);
    expect(markdown).toContain('Target: iPhone 14 Pro Max');
    expect(markdown).toContain('Capabilities:');
    expect(markdown).toContain('chat-capable=3');
    expect(markdown).toContain('Best: mid/q4_0/gpu');
    expect(markdown).toContain('Failure Samples:');
    expect(markdown).toContain('too-large/q4_0/gpu');
  });
});
