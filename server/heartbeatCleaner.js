const db = require('./db');

async function disconnectStaleUsers() {
  //console.log('🔄 Disconnecting stale users...');
  try {
    await db.query(`
      UPDATE group_members
      SET connected = FALSE
      WHERE last_heartbeat < NOW() - INTERVAL 1 MINUTE
    `);
  } catch (err) {
    console.error('❌ Failed to disconnect stale users:', err);
  }
}

setInterval(disconnectStaleUsers, 30000); // every 30s
