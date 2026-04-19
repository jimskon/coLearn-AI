// clearDatabase.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const db = require('../db');

async function clearDatabase() {
  const tableOrder = [
    'activity_heartbeats',
    'event_log',
    'followups',
    'feedback',
    'responses',
    'group_members',
    'activity_instances',
    'pogil_activities',
    'course_enrollments',
    'courses',
    'pogil_classes',
    'users'
  ];

  try {
    const conn = await db.getConnection();

    console.log("🔄 Disabling foreign key checks...");
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');

    for (const table of tableOrder) {
      console.log(`🧹 Clearing table: ${table}`);
      await conn.query(`DELETE FROM ${table}`);
    }

    console.log("✅ All tables cleared.");

    console.log("🔄 Re-enabling foreign key checks...");
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    conn.release();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error clearing database:', err);
    process.exit(1);
  }
}

clearDatabase();
