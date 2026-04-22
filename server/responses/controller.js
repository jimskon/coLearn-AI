// /server/responses/controller.js
const db = require('../db');
const { evaluateCode } = require('../ai/controller');


exports.createResponse = async (req, res) => {
  const { instanceId, questionId, responseText, answeredBy } = req.body;

  try {
    await db.query(
      `INSERT INTO response_drafts
         (activity_instance_id, question_id, response_type, response, answered_by_user_id)
       VALUES (?, ?, 'text', ?, ?)
       ON DUPLICATE KEY UPDATE
         response = VALUES(response),
         response_type = VALUES(response_type),
         answered_by_user_id = VALUES(answered_by_user_id),
         updated_at = CURRENT_TIMESTAMP`,
      [instanceId, questionId, responseText, answeredBy]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error saving response draft:", err);
    res.status(500).json({ error: "Failed to save response draft" });
  }
};

exports.createOrUpdateCodeResponse = async (req, res) => {
  const { activity_instance_id, question_id, user_id, response } = req.body;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      `INSERT INTO response_drafts
         (activity_instance_id, question_id, response_type, response, answered_by_user_id)
       VALUES (?, ?, 'python', ?, ?)
       ON DUPLICATE KEY UPDATE
         response = VALUES(response),
         response_type = VALUES(response_type),
         answered_by_user_id = VALUES(answered_by_user_id),
         updated_at = CURRENT_TIMESTAMP`,
      [activity_instance_id, question_id, response, user_id]
    );

    const aiData = await evaluateCode({
      questionText: "Review the student's code and offer helpful feedback if needed.",
      studentCode: response,
      codeVersion: question_id,
    });

    const feedbackText = aiData.feedback || '';

    if (global.io) {
      global.io.to(`instance-${activity_instance_id}`).emit('feedback:update', {
        instanceId: activity_instance_id,
        responseKey: question_id,
        feedback: feedbackText,
      });
    }

    await conn.commit();
    res.json({ success: true, feedback: feedbackText });
  } catch (err) {
    console.error("❌ Error saving code draft or feedback:", err);
    await conn.rollback();
    res.status(500).json({ error: "Failed to save code draft or feedback" });
  } finally {
    conn.release();
  }
};



exports.getResponsesByInstanceId = async (req, res) => {
  const { instanceId } = req.params;

  try {
    const [submittedRows] = await db.query(
      `SELECT r.question_id, r.response, r.response_type
       FROM responses r
       JOIN (
         SELECT question_id, MAX(id) AS max_id
         FROM responses
         WHERE activity_instance_id = ?
         GROUP BY question_id
       ) latest
         ON r.question_id = latest.question_id AND r.id = latest.max_id
       WHERE r.activity_instance_id = ?`,
      [instanceId, instanceId]
    );

    const [draftRows] = await db.query(
      `SELECT question_id, response, response_type
       FROM response_drafts
       WHERE activity_instance_id = ?`,
      [instanceId]
    );

    const result = {};

    for (const row of submittedRows) {
      result[row.question_id] = {
        response: row.response,
        type: row.response_type,
        python_feedback: null,
      };
    }

    for (const row of draftRows) {
      result[row.question_id] = {
        response: row.response,
        type: row.response_type,
        python_feedback: result[row.question_id]?.python_feedback ?? null,
      };
    }

    res.json(result);
  } catch (err) {
    console.error("❌ Error fetching merged responses:", err);
    res.status(500).json({ error: "Failed to fetch responses" });
  }
};


exports.getResponsesByAnsweredBy = async (req, res) => {
  const { instanceId, answeredBy } = req.params;

  try {
    const [rows] = await db.query(
      `SELECT * FROM responses WHERE activity_instance_id = ? AND answered_by_user_id = ?`,
      [instanceId, answeredBy]
    );

    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching responses:", err);
    res.status(500).json({ error: "Failed to fetch responses" });
  }
};

// Updated getGroupResponses function to remove old group_id reference
exports.getGroupResponses = async (req, res) => {
  const { instanceId } = req.params;

  try {
    const [submittedRows] = await db.query(
      `SELECT r.question_id, r.response, r.response_type
       FROM responses r
       JOIN (
         SELECT question_id, MAX(id) AS max_id
         FROM responses
         WHERE activity_instance_id = ?
         GROUP BY question_id
       ) latest
         ON r.question_id = latest.question_id AND r.id = latest.max_id
       WHERE r.activity_instance_id = ?`,
      [instanceId, instanceId]
    );

    const [draftRows] = await db.query(
      `SELECT question_id, response, response_type
       FROM response_drafts
       WHERE activity_instance_id = ?`,
      [instanceId]
    );

    const result = {};
    for (const row of submittedRows) {
      result[row.question_id] = {
        response: row.response,
        type: row.response_type
      };
    }
    for (const row of draftRows) {
      result[row.question_id] = {
        response: row.response,
        type: row.response_type
      };
    }

    res.json(result);
  } catch (err) {
    console.error("❌ Failed to get merged group responses:", err);
    res.status(500).json({ error: 'Failed to fetch group responses' });
  }
};

exports.bulkSaveResponses = async (req, res) => {
  const instanceId = Number(req.body?.instanceId);
  const userId = Number(req.body?.userId);
  const answers = req.body?.answers;

  if (!instanceId || !userId || !answers || typeof answers !== 'object') {
    return res.status(400).json({ error: 'Missing/invalid instanceId, userId, or answers' });
  }

  const entries = Object.entries(answers)
    .map(([qid, val]) => [String(qid).trim(), String(val ?? '')])
    .filter(([qid]) => qid.length > 0)
    .sort((a, b) => a[0].localeCompare(b[0]));

  if (entries.length === 0) return res.json({ success: true, saved: 0 });

  const conn = await db.getConnection();
  try {
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await conn.beginTransaction();

        const values = [];
        const placeholders = entries.map(([questionId, responseText]) => {
          values.push(instanceId, questionId, 'text', responseText, userId);
          return '(?, ?, ?, ?, ?)';
        }).join(',');

        const sql = `
          INSERT INTO response_drafts
            (activity_instance_id, question_id, response_type, response, answered_by_user_id)
          VALUES ${placeholders}
          ON DUPLICATE KEY UPDATE
            response = VALUES(response),
            response_type = VALUES(response_type),
            answered_by_user_id = VALUES(answered_by_user_id),
            updated_at = CURRENT_TIMESTAMP
        `;

        await conn.query(sql, values);

        await conn.commit();
        return res.json({ success: true, saved: entries.length });
      } catch (err) {
        await conn.rollback();

        const deadlock = err && (err.code === 'ER_LOCK_DEADLOCK' || err.errno === 1213);
        if (!deadlock || attempt === MAX_RETRIES) throw err;

        await new Promise(r => setTimeout(r, 30 * attempt));
      }
    }
  } catch (err) {
    console.error('❌ Failed to bulk save response drafts:', err);
    return res.status(500).json({ error: 'Failed to bulk save response drafts' });
  } finally {
    conn.release();
  }
};

exports.saveFeedback = async (req, res) => {
  return res.json({ success: true, persisted: false });
};

exports.markActivityInstanceComplete = async (req, res) => {
  const { instanceId } = req.body;

  try {
    await db.query(
      `UPDATE activity_instances SET status = 'completed' WHERE id = ?`,
      [instanceId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error marking instance complete:", err);
    res.status(500).json({ error: "Failed to mark instance as complete" });
  }
};

