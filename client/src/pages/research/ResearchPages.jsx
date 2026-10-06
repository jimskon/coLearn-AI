import React from 'react';
import { Alert, Button, ButtonGroup, Card, Col, Row, Table } from 'react-bootstrap';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { BreakdownTable, MetricTable } from './ResearchTables';
import { formatMetric, toAggregateCsv } from '../../utils/researchFormat';

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
};

// ---------------------------------------------------------------------------
export function OverviewPage() {
  return (
    <NeedsResult>
      {(r) => {
        const coverage = find(r.sections.participation, 'turn_instrumented_runs');
        const partial = find(r.sections.participation, 'turn_partial_runs');
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
                note="Turn, session-start, and intervention-rate statistics need turn logging for the whole run. Submit-based statistics use every run."
              >
                <Table className="mb-0" size="sm">
                  <tbody>
                    <tr>
                      <td>Runs with full turn data</td>
                      <td className="text-end">{formatMetric(coverage).main}<div className="small text-muted">{formatMetric(coverage).detail}</div></td>
                    </tr>
                    <tr><td>Runs with partial turn data (set aside)</td><td className="text-end">{partial?.value ?? '—'}</td></tr>
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
                Generated {new Date(r.generatedAt).toLocaleString()} · idle threshold {r.filters.idleMinutes} min
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
          note={`Gaps longer than the idle threshold (${r.filters.idleMinutes} min) count only up to the threshold. Medians are shown first because timing is skewed. Activity duration needs full turn data; "first to last submit" covers every run.`}
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

function download(filename, text) {
  const blob = new Blob([text], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const RESEARCH_DATASETS = [
  ['question_attempts.csv', 'One row per AI-evaluated attempt'],
  ['feedback_revision_pairs.csv', 'Answer before feedback, the feedback, answer after, next decision, outcome'],
  ['group_participation.csv', 'One row per run: size, submits per member, turns, interventions'],
  ['student_longitudinal.csv', 'One row per student and activity, pseudonymous IDs'],
];

export function ExportsPage() {
  return (
    <NeedsResult>
      {(r) => (
        <Section title="Exports" note="Exports use the courses and filters selected above.">
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
              {RESEARCH_DATASETS.map(([name, description]) => (
                <tr key={name}>
                  <td>
                    <div>{name}</div>
                    <div className="small text-muted">{description}</div>
                  </td>
                  <td className="text-end"><Button size="sm" variant="outline-secondary" disabled>Coming soon</Button></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}
    </NeedsResult>
  );
}
