#!/usr/bin/env node
'use strict';

/*
 * Remove activity instances that nobody ever used.
 *
 * These are the empty "Group 7 … Group 24" cards on a roster: rows left behind
 * by a previous setup with a different group count, or by an author opening
 * Test Run. What makes them worth a script rather than a button is that they
 * are indistinguishable from real groups on screen, so the only safe way to
 * clear them is to state the rule once, print what it matched, and let a person
 * look before anything is deleted.
 *
 * Reports by default. Deletes only with --apply.
 *
 *   node server/scripts/pruneAbandonedInstances.js
 *   node server/scripts/pruneAbandonedInstances.js --course=12
 *   node server/scripts/pruneAbandonedInstances.js --course=12 --activity=87 --apply
 *
 * The rule lives in server/utils/emptyInstances.js and is shared with the setup
 * path, so this script cannot delete anything setup would have kept, or keep
 * anything setup would have deleted.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const db = require('../db');
const {
  findAbandonedInstances,
  deleteAbandonedInstances,
} = require('../utils/emptyInstances');

function parseArgs(argv) {
  const args = { apply: false, courseId: null, activityId: null, verbose: false };
  for (const raw of argv) {
    const arg = String(raw);
    if (arg === '--apply') args.apply = true;
    else if (arg === '--verbose') args.verbose = true;
    else if (arg.startsWith('--course=')) args.courseId = Number(arg.slice('--course='.length));
    else if (arg.startsWith('--activity=')) args.activityId = Number(arg.slice('--activity='.length));
    else {
      console.error(`Unknown argument: ${arg}`);
      console.error('Usage: pruneAbandonedInstances.js [--course=ID] [--activity=ID] [--verbose] [--apply]');
      process.exit(2);
    }
  }
  if (args.courseId != null && !Number.isFinite(args.courseId)) {
    console.error('--course must be a number');
    process.exit(2);
  }
  if (args.activityId != null && !Number.isFinite(args.activityId)) {
    console.error('--activity must be a number');
    process.exit(2);
  }
  return args;
}

function printTable(rows, columns) {
  if (!rows.length) {
    console.log('(none)');
    return;
  }
  const widths = columns.map((column) => Math.max(
    column.length,
    ...rows.map((row) => String(row[column] ?? '').length),
  ));
  console.log(columns.map((column, i) => column.padEnd(widths[i])).join('  '));
  console.log(widths.map((width) => '-'.repeat(width)).join('  '));
  for (const row of rows) {
    console.log(columns.map((column, i) => String(row[column] ?? '').padEnd(widths[i])).join('  '));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scope = { courseId: args.courseId, activityId: args.activityId };

  const rows = await findAbandonedInstances(db, scope);

  if (!rows.length) {
    console.log('No abandoned instances found. Nothing to do.');
    return;
  }

  // Grouped by the roster a person actually looks at, because that is how they
  // will recognise whether the count is right.
  const byRoster = new Map();
  for (const row of rows) {
    const key = `${row.course_id}:${row.activity_id}`;
    if (!byRoster.has(key)) {
      byRoster.set(key, {
        course_id: row.course_id,
        activity_id: row.activity_id,
        course_name: row.course_name || '(unknown course)',
        activity_title: row.activity_title || '(unknown activity)',
        rows: [],
      });
    }
    byRoster.get(key).rows.push(row);
  }

  console.log(
    `Found ${rows.length} abandoned instance(s) across ${byRoster.size} roster(s).\n`
    + 'Abandoned means: no members, no responses, no drafts, never submitted,\n'
    + 'never graded, no recorded progress.\n',
  );

  for (const roster of byRoster.values()) {
    console.log(`\n=== ${roster.course_name} — ${roster.activity_title} `
      + `(course ${roster.course_id}, activity ${roster.activity_id}) ===`);
    console.log(`${roster.rows.length} abandoned instance(s)`);

    const sandbox = roster.rows.filter((row) => row.active_rotation_mode === 'sandbox').length;
    if (sandbox) console.log(`  of which ${sandbox} came from Test Run (sandbox)`);

    const numbers = roster.rows
      .map((row) => row.group_number)
      .filter((n) => n != null)
      .sort((a, b) => a - b);
    if (numbers.length) console.log(`  group numbers: ${numbers.join(', ')}`);

    if (args.verbose) {
      console.log('');
      printTable(roster.rows, [
        'id', 'group_number', 'active_rotation_mode', 'progress_status', 'created_at',
      ]);
    }
  }

  if (!args.apply) {
    console.log('\nDry run. Nothing was deleted. Re-run with --apply to remove these rows.');
    return;
  }

  // Delete per roster so a failure part-way leaves a comprehensible state, and
  // so the counts printed above line up with the counts reported here.
  let removed = 0;
  for (const roster of byRoster.values()) {
    const count = await deleteAbandonedInstances(db, {
      courseId: roster.course_id,
      activityId: roster.activity_id,
    });
    removed += count;
    console.log(`Removed ${count} from course ${roster.course_id}, activity ${roster.activity_id}.`);
  }

  console.log(`\nRemoved ${removed} abandoned instance(s).`);
  if (removed !== rows.length) {
    // Not an error: a row can stop being abandoned between the report and the
    // delete, and the predicate is re-checked inside the DELETE precisely so
    // that it survives.
    console.log(`${rows.length - removed} were no longer abandoned by the time they were deleted, and were kept.`);
  }
}

main()
  .then(() => db.end())
  .catch(async (err) => {
    console.error('prune failed:', err);
    try { await db.end(); } catch { /* already closing */ }
    process.exit(1);
  });
