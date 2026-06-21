interface FitRow {
  model_id: string;
  quant: string;
  requested_backend: string;
  status: string;
  pp_avg: number | null;
  tg_avg: number | null;
  peak_memory_mb: number | null;
  quality_score?: number | null;
  quality_passed?: boolean | null;
  quality_capabilities?: string[];
  settings_fingerprint?: string;
  settings_overrides?: Record<string, unknown>;
  error?: string;
}

interface FitReport {
  suite?: {
    id?: string;
    target_device?: Record<string, unknown>;
    selection?: {
      min_quality_score?: number;
    };
  };
  device_profile?: Record<string, unknown>;
  runs: FitRow[];
}

export interface ScoredFitRow {
  row: FitRow;
  key: string;
  eligible: boolean;
  reason: string | null;
  score: number;
  quality_score: number;
  quality_capabilities: string[];
  tg_avg: number;
  pp_avg: number;
  peak_memory_mb: number | null;
}

export interface IosFitSummary {
  total_rows: number;
  ok_rows: number;
  eligible_rows: number;
  failed_rows: number;
  skipped_rows: number;
  best: ScoredFitRow | null;
  max_fit: ScoredFitRow | null;
  promotions: ScoredFitRow[];
  scored_rows: ScoredFitRow[];
  capability_counts: Record<string, number>;
  failed_samples: FitRow[];
}

function rowKey(row: FitRow): string {
  const override = row.settings_fingerprint
    ? `/${row.settings_fingerprint}`
    : '';
  return `${row.model_id}/${row.quant}/${row.requested_backend}${override}`;
}

function minQualityScore(report: FitReport): number {
  return report.suite?.selection?.min_quality_score ?? 1;
}

function rowEligibility(row: FitRow, minQuality: number): string | null {
  if (row.status !== 'ok') {
    return `status:${row.status}`;
  }
  if (typeof row.pp_avg !== 'number' || typeof row.tg_avg !== 'number') {
    return 'missing-speed';
  }
  const quality = row.quality_score ?? 0;
  if (quality < minQuality) {
    return `quality:${quality}`;
  }
  if (row.quality_passed === false) {
    return 'quality-failed';
  }
  return null;
}

function normalized(value: number, max: number): number {
  return max > 0 ? value / max : 0;
}

function deriveRowCapabilities(row: FitRow): string[] {
  if (Array.isArray(row.quality_capabilities)) {
    return row.quality_capabilities;
  }
  const capabilities: string[] = [];
  if (
    row.status === 'ok' &&
    typeof row.pp_avg === 'number' &&
    typeof row.tg_avg === 'number'
  ) {
    capabilities.push('fit');
  }
  if (row.quality_passed === true) {
    capabilities.push('baseline-eligible');
  }
  return capabilities;
}

export function summarizeIosFitReport(report: FitReport): IosFitSummary {
  const minQuality = minQualityScore(report);
  const okRows = report.runs.filter(row => row.status === 'ok');
  const skippedRows = report.runs.filter(row => row.status === 'skipped');
  const failedRows = report.runs.filter(
    row => row.status !== 'ok' && row.status !== 'skipped',
  );
  const eligibleRaw = report.runs.filter(
    row => rowEligibility(row, minQuality) === null,
  );
  const maxTg = Math.max(0, ...eligibleRaw.map(row => row.tg_avg ?? 0));
  const maxPp = Math.max(0, ...eligibleRaw.map(row => row.pp_avg ?? 0));
  const memoryValues = eligibleRaw
    .map(row => row.peak_memory_mb)
    .filter((v): v is number => typeof v === 'number');
  const minMemory = Math.min(...memoryValues);
  const maxMemory = Math.max(...memoryValues);

  const scoredRows = report.runs.map(row => {
    const reason = rowEligibility(row, minQuality);
    const quality = row.quality_score ?? 0;
    const qualityCapabilities = deriveRowCapabilities(row);
    const tg = row.tg_avg ?? 0;
    const pp = row.pp_avg ?? 0;
    let memoryComponent = 0;
    if (
      typeof row.peak_memory_mb === 'number' &&
      Number.isFinite(minMemory) &&
      Number.isFinite(maxMemory)
    ) {
      memoryComponent =
        maxMemory === minMemory
          ? 1
          : 1 - (row.peak_memory_mb - minMemory) / (maxMemory - minMemory);
    }
    const score =
      reason === null
        ? quality * 100 +
          normalized(tg, maxTg) * 35 +
          normalized(pp, maxPp) * 10 +
          memoryComponent * 10
        : 0;
    return {
      row,
      key: rowKey(row),
      eligible: reason === null,
      reason,
      score: Math.round(score * 1000) / 1000,
      quality_score: quality,
      quality_capabilities: qualityCapabilities,
      tg_avg: tg,
      pp_avg: pp,
      peak_memory_mb: row.peak_memory_mb,
    };
  });

  const eligible = scoredRows.filter(row => row.eligible);
  const capabilityCounts: Record<string, number> = {};
  for (const row of scoredRows) {
    for (const capability of row.quality_capabilities) {
      capabilityCounts[capability] = (capabilityCounts[capability] ?? 0) + 1;
    }
  }
  const best = [...eligible].sort((a, b) => b.score - a.score)[0] ?? null;
  const maxFit = eligible.length > 0 ? eligible[eligible.length - 1] : null;
  const promotions: ScoredFitRow[] = [];
  let incumbent: ScoredFitRow | null = null;
  for (const row of scoredRows) {
    if (!row.eligible) {
      continue;
    }
    if (!incumbent || row.score > incumbent.score) {
      promotions.push(row);
      incumbent = row;
    }
  }

  return {
    total_rows: report.runs.length,
    ok_rows: okRows.length,
    eligible_rows: eligible.length,
    failed_rows: failedRows.length,
    skipped_rows: skippedRows.length,
    best,
    max_fit: maxFit,
    promotions,
    scored_rows: scoredRows,
    capability_counts: capabilityCounts,
    failed_samples: report.runs
      .filter(row => row.status !== 'ok' || row.quality_passed === false)
      .slice(0, 10),
  };
}

function fmtNumber(value: number | null | undefined, digits = 2): string {
  return typeof value === 'number' ? value.toFixed(digits) : '-';
}

function renderRow(row: ScoredFitRow): string {
  return [
    row.key,
    `score=${fmtNumber(row.score, 3)}`,
    `quality=${fmtNumber(row.quality_score, 2)}`,
    `capabilities=${row.quality_capabilities.join(',') || '-'}`,
    `tg=${fmtNumber(row.tg_avg)}`,
    `pp=${fmtNumber(row.pp_avg)}`,
    `peak_mb=${fmtNumber(row.peak_memory_mb)}`,
  ].join(' | ');
}

export function renderIosFitSummaryMarkdown(
  report: FitReport,
  summary: IosFitSummary = summarizeIosFitReport(report),
): string {
  const target = report.suite?.target_device?.label ?? 'unknown target';
  const runtime =
    report.device_profile?.model ?? report.device_profile?.device_id;
  const lines = [
    '# iOS Fit Summary',
    '',
    `Target: ${target}`,
    `Runtime: ${runtime ?? 'unknown runtime'}`,
    `Rows: ${summary.total_rows} total, ${summary.ok_rows} loaded, ${summary.eligible_rows} baseline-eligible, ${summary.failed_rows} failed, ${summary.skipped_rows} cache-skipped`,
    `Capabilities: ${Object.entries(summary.capability_counts)
      .map(([name, count]) => `${name}=${count}`)
      .join(', ') || 'none'}`,
    '',
    `Best: ${summary.best ? renderRow(summary.best) : 'none'}`,
    `Max fit in ladder order: ${summary.max_fit ? renderRow(summary.max_fit) : 'none'}`,
    '',
    'Promotions:',
  ];

  if (summary.promotions.length === 0) {
    lines.push('- none');
  } else {
    for (const row of summary.promotions) {
      lines.push(`- ${renderRow(row)}`);
    }
  }

  const failed = summary.failed_samples;
  lines.push('', 'Failure Samples:');
  if (failed.length === 0) {
    lines.push('- none');
  } else {
    for (const row of failed) {
      const reason =
        row.status === 'ok'
          ? 'quality failed'
          : String(row.error ?? row.status).slice(0, 120);
      lines.push(`- ${rowKey(row)} | ${reason}`);
    }
  }

  return `${lines.join('\n')}\n`;
}
