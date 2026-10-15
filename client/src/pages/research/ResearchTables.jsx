import React from 'react';
import { Table } from 'react-bootstrap';
import { formatMetric } from '../../utils/researchFormat';

function MetricCell({ metric, strong = false }) {
  const { main, detail } = formatMetric(metric);
  return (
    <>
      <div className={strong ? 'fw-semibold' : undefined}>{main}</div>
      {detail ? <div className="small text-muted">{detail}</div> : null}
    </>
  );
}

/** One section: a row per metric, with its definition under the label. */
export function MetricTable({ metrics = [] }) {
  if (!metrics.length) return <div className="text-muted">No metrics.</div>;
  return (
    <Table responsive className="mb-0 align-middle">
      <tbody>
        {metrics.map((m) => (
          <tr key={m.key}>
            <td style={{ width: '58%' }}>
              <div>{m.label}</div>
              <div className="small text-muted">{m.description}</div>
            </td>
            <td className="text-end">
              <MetricCell metric={m} strong />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/**
 * Side-by-side comparison: a column per group (group size, question type,
 * week...), a row per metric. `groups` = [{ key, label, runs?, questions?, metrics }].
 */
export function BreakdownTable({ groups = [], countLabel = 'runs', countKey = 'runs' }) {
  if (!groups.length) return <div className="text-muted">No data for this breakdown.</div>;
  const rows = groups[0].metrics.map((m) => ({ key: m.key, label: m.label, description: m.description }));
  return (
    <Table responsive bordered className="mb-0 align-middle">
      <thead>
        <tr>
          <th style={{ minWidth: 220 }}>Metric</th>
          {groups.map((g) => (
            <th key={g.key} className="text-end" style={{ minWidth: 140 }}>
              <div>{g.label}</div>
              <div className="small text-muted fw-normal">
                {countLabel}: {g[countKey] ?? '—'}
              </div>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td>
              <div>{row.label}</div>
              <div className="small text-muted">{row.description}</div>
            </td>
            {groups.map((g) => (
              <td key={g.key} className="text-end">
                <MetricCell metric={g.metrics.find((m) => m.key === row.key)} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
