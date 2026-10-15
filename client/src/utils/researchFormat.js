// Display and CSV formatting for research metrics (server/research/metrics.js).
// Plain JS so it can be unit-tested with node.

export function formatSeconds(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const sign = seconds < 0 ? '−' : '';
  const total = Math.round(Math.abs(seconds));
  if (total < 60) return `${sign}${total}s`;
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  if (minutes < 60) return `${sign}${minutes}m ${String(secs).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${sign}${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export function formatNumber(value, digits = 2) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (Number.isInteger(value)) return value.toLocaleString('en-US');
  return Number(value.toFixed(digits)).toLocaleString('en-US');
}

function formatByUnit(value, unit) {
  return unit === 'seconds' ? formatSeconds(value) : formatNumber(value);
}

/**
 * One metric -> { main, detail } for display. Rates always show their
 * numerator and denominator; distributions show N.
 */
export function formatMetric(metric) {
  if (!metric) return { main: '—', detail: '' };
  switch (metric.kind) {
    case 'rate':
      return {
        main: metric.value == null ? '—' : `${(100 * metric.value).toFixed(1)}%`,
        detail: `${formatNumber(metric.numerator)} / ${formatNumber(metric.denominator)}`,
      };
    case 'summary':
      return metric.n
        ? {
          main: `median ${formatByUnit(metric.median, metric.unit)}`,
          detail: `mean ${formatByUnit(metric.mean, metric.unit)} · range ${formatByUnit(metric.min, metric.unit)}–${formatByUnit(metric.max, metric.unit)} · n=${formatNumber(metric.n)}`,
        }
        : { main: '—', detail: 'n=0' };
    case 'count':
      return { main: formatNumber(metric.value), detail: '' };
    case 'value':
      return { main: formatByUnit(metric.value, metric.unit), detail: '' };
    case 'distribution':
      return {
        main: Object.entries(metric.values || {}).map(([k, v]) => `${k}: ${formatNumber(v)}`).join(' · '),
        detail: '',
      };
    default:
      return { main: '—', detail: '' };
  }
}

// ---------------------------------------------------------------------------
// aggregate_statistics.csv
// ---------------------------------------------------------------------------
const CSV_COLUMNS = [
  'section', 'breakdown', 'group', 'key', 'label', 'kind', 'unit',
  'value', 'numerator', 'denominator', 'n', 'mean', 'median', 'min', 'max', 'description',
];

function metricRow(section, breakdown, group, m) {
  return {
    section,
    breakdown,
    group,
    key: m.key,
    label: m.label,
    kind: m.kind,
    unit: m.unit ?? '',
    value: m.kind === 'distribution' ? JSON.stringify(m.values) : (m.value ?? ''),
    numerator: m.numerator ?? '',
    denominator: m.denominator ?? '',
    n: m.n ?? '',
    mean: m.mean ?? '',
    median: m.median ?? '',
    min: m.min ?? '',
    max: m.max ?? '',
    description: m.description ?? '',
  };
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Every metric in a /api/research/metrics result, one row each. */
export function toAggregateCsv(result) {
  const rows = [];
  for (const [section, list] of Object.entries(result?.sections || {})) {
    for (const m of list) rows.push(metricRow(section, '', '', m));
  }
  const b = result?.breakdowns || {};
  const addGroups = (name, groups) => {
    for (const g of groups || []) for (const m of g.metrics) rows.push(metricRow('breakdown', name, g.label, m));
  };
  addGroups('group_size', b.groupSize);
  addGroups('question_type', b.questionType);
  for (const [by, groups] of Object.entries(b.overTime || {})) addGroups(`over_time_${by}`, groups);
  for (const [key, value] of Object.entries(result?.excluded || {})) {
    rows.push(metricRow('excluded', '', '', { key, label: key, kind: 'count', value }));
  }

  const header = CSV_COLUMNS.join(',');
  const body = rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(','));
  return [header, ...body].join('\n');
}
