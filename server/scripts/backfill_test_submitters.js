const db = require('../db');

async function resolveOwner(instanceId) {
  const [[instance]] = await db.query(
    `SELECT ai.id, ai.submitted_by_user_id, ai.course_id, ai.activity_id, a.title
       FROM activity_instances ai
       JOIN pogil_activities a ON a.id = ai.activity_id
      WHERE ai.id = ?`,
    [instanceId]
  );

  if (!instance) return { status: 'missing_instance', instanceId };
  if (instance.submitted_by_user_id) {
    return {
      status: 'already_set',
      instanceId,
      studentId: Number(instance.submitted_by_user_id),
      title: instance.title,
    };
  }

  const [members] = await db.query(
    `SELECT DISTINCT student_id
       FROM group_members
      WHERE activity_instance_id = ?
      ORDER BY id ASC`,
    [instanceId]
  );

  if (members.length === 1 && members[0].student_id) {
    return {
      status: 'resolved',
      source: 'single_group_member',
      instanceId,
      studentId: Number(members[0].student_id),
      title: instance.title,
    };
  }

  const [answerers] = await db.query(
    `SELECT answered_by_user_id AS student_id, COUNT(*) AS response_count
       FROM responses
      WHERE activity_instance_id = ?
        AND answered_by_user_id IS NOT NULL
      GROUP BY answered_by_user_id
      ORDER BY response_count DESC, answered_by_user_id ASC`,
    [instanceId]
  );

  if (answerers.length === 1 && answerers[0].student_id) {
    return {
      status: 'resolved',
      source: 'single_response_owner',
      instanceId,
      studentId: Number(answerers[0].student_id),
      title: instance.title,
    };
  }

  return {
    status: 'ambiguous',
    instanceId,
    title: instance.title,
    memberIds: members.map((m) => Number(m.student_id)),
    responseOwners: answerers.map((a) => ({
      studentId: Number(a.student_id),
      responseCount: Number(a.response_count),
    })),
  };
}

async function main() {
  const apply = process.argv.includes('--apply');

  const [rows] = await db.query(
    `SELECT ai.id
       FROM activity_instances ai
       JOIN pogil_activities a ON a.id = ai.activity_id
      WHERE a.is_test = 1
        AND ai.submitted_at IS NOT NULL
        AND ai.submitted_by_user_id IS NULL
      ORDER BY ai.id ASC`
  );

  const results = [];
  for (const row of rows) {
    results.push(await resolveOwner(Number(row.id)));
  }

  const resolved = results.filter((r) => r.status === 'resolved');
  const ambiguous = results.filter((r) => r.status === 'ambiguous');
  const alreadySet = results.filter((r) => r.status === 'already_set');

  console.log(`Found ${rows.length} submitted test instances with NULL submitted_by_user_id.`);
  console.log(`Resolvable: ${resolved.length}`);
  console.log(`Ambiguous: ${ambiguous.length}`);
  console.log(`Already set during scan: ${alreadySet.length}`);

  if (resolved.length) {
    console.log('\nResolvable rows:');
    for (const r of resolved) {
      console.log(
        `  instance ${r.instanceId} (${r.title}) -> student ${r.studentId} via ${r.source}`
      );
    }
  }

  if (ambiguous.length) {
    console.log('\nAmbiguous rows (not updated):');
    for (const r of ambiguous) {
      console.log(
        `  instance ${r.instanceId} (${r.title}) members=${JSON.stringify(r.memberIds)} responses=${JSON.stringify(r.responseOwners)}`
      );
    }
  }

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to backfill resolvable rows.');
    return;
  }

  let updated = 0;
  for (const r of resolved) {
    const [result] = await db.query(
      `UPDATE activity_instances
          SET submitted_by_user_id = ?
        WHERE id = ?
          AND submitted_by_user_id IS NULL`,
      [r.studentId, r.instanceId]
    );
    updated += Number(result.affectedRows || 0);
  }

  console.log(`\nUpdated ${updated} activity_instances rows.`);
}

main()
  .catch((err) => {
    console.error('backfill_test_submitters failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.end?.();
    } catch {}
  });
