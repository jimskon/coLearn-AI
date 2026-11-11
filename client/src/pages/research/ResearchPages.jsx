import React from 'react';
import { Alert, Button, ButtonGroup, Card, Col, Form, Row, Table } from 'react-bootstrap';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { BreakdownTable, MetricTable } from './ResearchTables';
import { formatMetric, toAggregateCsv } from '../../utils/researchFormat';
import { API_BASE_URL } from '../../config';

function useResearch() {
  return useOutletContext() || {};
}

function NeedsResult({ children }) {
  const { result } = useResearch();
  if (!result) {
    return <Alert variant="light" className="border">Choose one or more courses and press <strong>Generate</strong>.</Alert>;
  }
  return children(result);
}

function Section({ title, note, children }) {
  return (
    <Card className="mb-3">
      <Card.Header className="fw-semibold">{title}</Card.Header>
      {note ? <Card.Body className="py-2 small text-muted border-bottom">{note}</Card.Body> : null}
      <Card.Body className="p-0">{children}</Card.Body>
    </Card>
  );
}

const pick = (list, keys) => keys.map((k) => list.find((m) => m.key === k)).filter(Boolean);
const omit = (list, keys) => list.filter((m) => !keys.includes(m.key));
const find = (list, key) => list.find((m) => m.key === key);

const EXCLUSION_LABELS = {
  tests: 'Test runs',
  sandboxRuns: 'Instructor sandbox runs',
  demoClasses: 'Runs in demo classes',
  noStudentMembers: 'Groups with no student members',
  outsideDateRange: 'Runs outside the date range',
  duplicateRows: 'Duplicate trace rows',
  activityTypeNotSelected: 'Runs of activity types not selected',
};

// ---------------------------------------------------------------------------
export function OverviewPage() {
  return (
    <NeedsResult>
      {(r) => {
        const coverage = find(r.sections.participation, 'turn_instrumented_runs');
        const partial = find(r.sections.participation, 'turn_partial_runs');
        const afterClass = find(r.sections.time, 'runs_with_after_class_work');
        const afterClassSubmits = find(r.sections.time, 'after_class_submits');
        const cutAtMax = find(r.sections.time, 'runs_cut_at_max_session');
        return (
          <Row className="g-3">
            <Col lg={7}>
              <Section title="Scale"><MetricTable metrics={r.sections.scale} /></Section>
              <Section title="Headline results">
                <MetricTable metrics={[
                  ...pick(r.sections.aiGating, ['first_attempt_acceptance_rate', 'continue_button_rate', 'instructor_override_rate']),
                  ...pick(r.sections.revision, ['revised_at_least_once']),
                  ...pick(r.sections.participation, ['response_balance_0_1']),
                ]} />
              </Section>
            </Col>
            <Col lg={5}>
              <Section
                title="Data coverage"
                note={`Turn, session-start, and intervention-rate statistics need turn logging for the whole run. Submit-based statistics use every run. Only in-class work counts: a run's session ends at the last activity before a gap of more than ${r.filters.breakMinutes ?? 30} min, and never later than ${r.filters.maxSessionMinutes ?? 60} min after it starts.`}
              >
                <Table className="mb-0" size="sm">
                  <tbody>
                    <tr>
                      <td>Runs with full turn data</td>
                      <td className="text-end">{formatMetric(coverage).main}<div className="small text-muted">{formatMetric(coverage).detail}</div></td>
                    </tr>
                    <tr><td>Runs with partial turn data (set aside)</td><td className="text-end">{partial?.value ?? '—'}</td></tr>
                    <tr>
                      <td>Runs with after-class work (set aside)</td>
                      <td className="text-end">{formatMetric(afterClass).main}<div className="small text-muted">{formatMetric(afterClass).detail}</div></td>
                    </tr>
                    <tr><td>Group submits after class (set aside)</td><td className="text-end">{afterClassSubmits?.value ?? '—'}</td></tr>
                    <tr><td>Runs cut at the longest class session</td><td className="text-end">{cutAtMax?.value ?? '—'}</td></tr>
                    <tr>
                      <td>Runs by activity type (before selection)</td>
                      <td className="text-end">{Object.entries(r.runsByActivityType || {}).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'}</td>
                    </tr>
                    <tr><td>Activities whose markup could not be read</td><td className="text-end">{r.activitiesWithoutMetadata}</td></tr>
                  </tbody>
                </Table>
              </Section>
              <Section title="Excluded" note="Never silently dropped: each excluded record is counted here.">
                <Table className="mb-0" size="sm">
                  <tbody>
                    {Object.entries(r.excluded || {}).map(([k, v]) => (
                      <tr key={k}><td>{EXCLUSION_LABELS[k] || k}</td><td className="text-end">{v}</td></tr>
                    ))}
                  </tbody>
                </Table>
              </Section>
              <div className="small text-muted">
                Generated {new Date(r.generatedAt).toLocaleString()} · idle threshold {r.filters.idleMinutes} min · break {r.filters.breakMinutes ?? 30} min · class {r.filters.maxSessionMinutes ?? 60} min
                {r.filters.activityTypes ? ` · activity types ${r.filters.activityTypes.join(', ')}` : ''}
                {r.filters.groupSize !== 'all' ? ` · group size ${r.filters.groupSize}` : ''}
                {r.filters.questionType !== 'all' ? ` · question type ${r.filters.questionType}` : ''}
              </div>
            </Col>
          </Row>
        );
      }}
    </NeedsResult>
  );
}

const TURN_KEYS = ['turn_instrumented_runs', 'turn_partial_runs', 'turn_balance_0_1', 'skipped_turn_rate', 'reassigned_turn_rate', 'turn_to_first_submit'];

export function ParticipationPage() {
  return (
    <NeedsResult>
      {(r) => (
        <>
          <Section title="Submit-based participation" note="Who clicked Submit for the group. Available for every run.">
            <MetricTable metrics={omit(r.sections.participation, TURN_KEYS)} />
          </Section>
          <Section title="Turn-based participation" note="Who was given the turn, and what they did with it. Only runs with full turn data; turns inside a rapid instructor rotation burst are ignored.">
            <MetricTable metrics={pick(r.sections.participation, TURN_KEYS)} />
          </Section>
        </>
      )}
    </NeedsResult>
  );
}

const OUTCOME_KEYS = ['outcome_ai_accepted', 'continue_button_rate', 'instructor_override_rate', 'outcome_advanced_other', 'outcome_unresolved'];

export function AiGatingPage() {
  return (
    <NeedsResult>
      {(r) => (
        <>
          <Section title="How each question was resolved" note="Every AI-evaluated question has exactly one outcome. AI acceptance, Continue, and instructor advance are kept separate.">
            <MetricTable metrics={pick(r.sections.aiGating, OUTCOME_KEYS)} />
          </Section>
          <Section title="Attempts and decisions" note="Surveys (ungraded multiple choice) are not AI decisions and are excluded.">
            <MetricTable metrics={omit(r.sections.aiGating, OUTCOME_KEYS)} />
          </Section>
        </>
      )}
    </NeedsResult>
  );
}

export function RevisionPage() {
  return (
    <NeedsResult>
      {(r) => (
        <Section title="Revision" note="Size measures describe how much an answer changed, not whether it improved.">
          <MetricTable metrics={r.sections.revision} />
        </Section>
      )}
    </NeedsResult>
  );
}

export function TimePage() {
  return (
    <NeedsResult>
      {(r) => (
        <Section
          title="Time"
          note={`Gaps longer than the idle threshold (${r.filters.idleMinutes} min) count only up to the threshold. Only in-class work counts: work after a break of more than ${r.filters.breakMinutes ?? 30} min, or more than ${r.filters.maxSessionMinutes ?? 60} min after the session started, is set aside. Medians are shown first because timing is skewed. Activity duration needs full turn data; "first to last submit" covers every run.`}
        >
          <MetricTable metrics={r.sections.time} />
        </Section>
      )}
    </NeedsResult>
  );
}

export function GroupSizePage() {
  return (
    <NeedsResult>
      {(r) => (
        <Section title="By group size" note="Student members per run. Each column is computed only from runs of that size.">
          <BreakdownTable groups={r.breakdowns.groupSize} />
        </Section>
      )}
    </NeedsResult>
  );
}

export function QuestionTypePage() {
  return (
    <NeedsResult>
      {(r) => (
        <Section
          title="By question type"
          note={'Types come from \\questiontype{...} in the activity. Untagged questions are "unknown"; nothing is classified automatically.'}
        >
          <BreakdownTable groups={r.breakdowns.questionType} countLabel="questions" countKey="questions" />
        </Section>
      )}
    </NeedsResult>
  );
}

const OVER_TIME = [
  { key: 'week', label: 'Week' },
  { key: 'activity', label: 'Activity order' },
  { key: 'course', label: 'Course' },
];

export function OverTimePage() {
  const [params, setParams] = useSearchParams();
  const by = OVER_TIME.some((o) => o.key === params.get('by')) ? params.get('by') : 'week';
  const setBy = (key) => {
    const next = new URLSearchParams(params);
    if (key === 'week') next.delete('by');
    else next.set('by', key);
    setParams(next, { replace: true });
  };
  return (
    <NeedsResult>
      {(r) => (
        <Section
          title="Over time"
          note="Each column uses only the runs in that week, activity (in the order each course first ran it), or course. Weeks start on Monday."
        >
          <div className="p-2 border-bottom">
            <ButtonGroup size="sm">
              {OVER_TIME.map((o) => (
                <Button key={o.key} variant={by === o.key ? 'secondary' : 'outline-secondary'} onClick={() => setBy(o.key)}>
                  {o.label}
                </Button>
              ))}
            </ButtonGroup>
          </div>
          <BreakdownTable groups={r.breakdowns.overTime[by]} />
        </Section>
      )}
    </NeedsResult>
  );
}

export function InterventionsPage() {
  return (
    <NeedsResult>
      {(r) => (
        <Section
          title="Instructor interventions"
          note="Instructor-caused transitions, kept separate from student and AI outcomes. Recorded only from the deployment of turn logging; runs without full turn data are not counted."
        >
          <MetricTable metrics={r.sections.interventions} />
        </Section>
      )}
    </NeedsResult>
  );
}

function download(filename, text, type = 'text/csv') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const RESEARCH_DATASETS = [
  ['question_attempts', 'One row per AI-evaluated attempt: who submitted it, the decision, time since the previous attempt, and how the question ended.'],
  ['feedback_revision_pairs', 'One row per answer the AI sent back: the answer, the feedback, the next answer, how much it changed, and the next decision. Contains answer text.'],
  ['group_participation', 'One row per run: group size, submit and turn balance, skipped turns, interventions, question outcomes, and time.'],
  ['student_longitudinal', 'One row per student per run: submits, share of the group\'s submits, attempts and decisions, and turns.'],
  ['response_history', 'JSON Lines for coding answers (by hand or with an AI). One activity record with the full markup, then one record per question per group: the question\'s markup and the text before it in its question group, then every submitted version, AI decision, and AI feedback in order. In-class work only; surveys left out. Contains answer text: students may have written names, so review before sharing.', 'jsonl'],
];

function DatasetButton({ dataset, selection, stamp, format = 'csv' }) {
  const [state, setState] = React.useState({ busy: false, error: '', rows: null });
  const run = async () => {
    setState({ busy: true, error: '', rows: null });
    try {
      const res = await fetch(`${API_BASE_URL}/api/research/exports/${dataset}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selection),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || 'Export failed');
      }
      const text = await res.text();
      download(`${dataset}_${stamp}.${format}`, text, format === 'jsonl' ? 'application/x-ndjson' : 'text/csv');
      setState({ busy: false, error: '', rows: Number(res.headers.get('X-Row-Count')) });
    } catch (err) {
      setState({ busy: false, error: err?.message || 'Export failed', rows: null });
    }
  };
  return (
    <>
      <Button size="sm" onClick={run} disabled={state.busy}>{state.busy ? 'Building…' : 'Download'}</Button>
      {state.error ? <div className="small text-danger mt-1">{state.error}</div> : null}
      {state.rows != null && Number.isFinite(state.rows) ? <div className="small text-muted mt-1">{state.rows.toLocaleString()} {format === 'jsonl' ? 'records' : 'rows'}</div> : null}
    </>
  );
}

// Which activities the row-level exports include (all by default).
function ExportActivityPicker({ activities, picked, setPicked }) {
  const all = picked == null;
  const isOn = (id) => all || picked.includes(id);
  const toggle = (id) => {
    const current = all ? activities.map((a) => a.id) : picked;
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    setPicked(next.length === activities.length ? null : next);
  };
  return (
    <Section
      title="Activities to export"
      note="Row-level exports include only the checked activities. The statistics pages always use every activity in the selection above."
    >
      <div className="px-3 py-2 small border-bottom">
        <Button size="sm" variant="link" className="p-0 me-3" onClick={() => setPicked(null)}>Select all</Button>
        <Button size="sm" variant="link" className="p-0" onClick={() => setPicked([])}>Clear</Button>
        <span className="text-muted ms-3">{all ? activities.length : picked.length} of {activities.length} selected</span>
      </div>
      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
        <Table size="sm" className="mb-0">
          <tbody>
            {activities.map((a) => (
              <tr key={a.id} onClick={() => toggle(a.id)} style={{ cursor: 'pointer' }}>
                <td style={{ width: 36 }}>
                  <Form.Check checked={isOn(a.id)} onChange={() => toggle(a.id)} onClick={(e) => e.stopPropagation()} aria-label={`Export ${a.title}`} />
                </td>
                <td>{a.title}</td>
                <td className="small text-muted">{a.firstRunAt ? new Date(a.firstRunAt).toLocaleDateString() : ''}</td>
                <td className="small text-muted text-end">{a.runs} run{a.runs === 1 ? '' : 's'}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </Section>
  );
}

export function ExportsPage() {
  const { selection } = useResearch();
  const [picked, setPicked] = React.useState(null); // null = every activity
  return (
    <NeedsResult>
      {(r) => (
        <>
        {r.activities?.length ? <ExportActivityPicker activities={r.activities} picked={picked} setPicked={setPicked} /> : null}
        <Section
          title="Exports"
          note="Exports use the courses and filters selected above. In the row-level datasets, students, groups, and instructors appear only as pseudonymous IDs (stable across exports); names and emails are never included. Times are UTC."
        >
          <Table className="mb-0 align-middle">
            <tbody>
              <tr>
                <td>
                  <div>aggregate_statistics.csv</div>
                  <div className="small text-muted">Every statistic on these pages, with numerator, denominator, N, mean, and median, plus the breakdowns and exclusion counts.</div>
                </td>
                <td className="text-end">
                  <Button size="sm" onClick={() => download(`aggregate_statistics_${r.generatedAt.slice(0, 10)}.csv`, toAggregateCsv(r))}>
                    Download
                  </Button>
                </td>
              </tr>
              {RESEARCH_DATASETS.map(([name, description, format = 'csv']) => (
                <tr key={name}>
                  <td>
                    <div>{name}.{format}</div>
                    <div className="small text-muted">{description}</div>
                  </td>
                  <td className="text-end">
                    {picked != null && !picked.length ? (
                      <span className="small text-muted">No activities checked</span>
                    ) : (
                      <DatasetButton
                        dataset={name}
                        format={format}
                        selection={picked == null ? selection : { ...selection, exportActivityIds: picked }}
                        stamp={r.generatedAt.slice(0, 10)}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>
        </>
      )}
    </NeedsResult>
  );
}
