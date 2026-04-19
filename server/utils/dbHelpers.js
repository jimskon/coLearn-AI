// server/utils/dbHelpers.js

/**
 * Converts mysql2 RowDataPacket[] into plain objects
 * @param {*} rows 
 * @returns array of plain objects or single object
 */
function toPlain(rows) {
  if (Array.isArray(rows)) {
    return rows.map(r => ({ ...r }));
  } else if (rows && typeof rows === 'object') {
    return { ...rows };
  } else {
    return rows;
  }
}

module.exports = { toPlain };
