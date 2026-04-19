// /server/responses/controller.js
const db = require('../db');
const { evaluateCode } = require('../ai/controller');



exports.createResponse = async (req, res) => {
  const { instanceId, questionId, responseText, answeredBy } = req.body;

  try {
    await db.query(
      `INSERT INTO responses (activity_instance_id, question_id, response_type, response, answered_by_user_id)
       VALUES (?, ?, 'text', ?, ?)`,
      [instanceId, questionId, responseText, answeredBy]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error saving response:", err);
    res.status(500).json({ error: "Failed to save response" });
  }
};

exports.createOrUpdateCodeResponse = async (req, res) => {
  const { activity_instance_id, question_id, user_id, response } = req.body;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Step 1: Insert or update the response
    const [result] = await conn.query(
      `INSERT INTO responses (activity_instance_id, question_id, response_type, response, answered_by_user_id)
       VALUES (?, ?, 'python', ?, ?)
       ON DUPLICATE KEY UPDATE response = VALUES(response)`,
      [activity_instance_id, question_id, response, user_id]
    );

    const [responseRow] = await conn.query(
      `SELECT id FROM responses
       WHERE activity_instance_id = ? AND question_id = ? AND answered_by_user_id = ?`,
      [activity_instance_id, question_id, user_id]
    );

    const responseId = responseRow?.[0]?.id;
    if (!responseId) throw new Error('Missing response ID');

    // Step 2: Call AI to evaluate code
    const aiData = await evaluateCode({
      questionText: "Review the student's code and offer helpful feedback if needed.",
      studentCode: response,
      codeVersion: question_id,
    });

    const feedbackText = aiData.feedback || '';


    // Step 3: Save feedback to feedback table
    await conn.query(
      `INSERT INTO feedback (response_id, feedback_text)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE feedback_text = VALUES(feedback_text)`,
      [responseId, feedbackText]
    );

    // ✅ Emit AI feedback to all group members
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
    console.error("❌ Error saving code or feedback:", err);
    await conn.rollback();
    res.status(500).json({ error: "Failed to save code response or feedback" });
  } finally {
    conn.release();
  }
};




exports.getResponsesByInstanceId = async (req, res) => {
  const { instanceId } = req.params;

  try {
    const [rows] = await db.query(
      `SELECT question_id, response, response_type
       FROM responses
       WHERE activity_instance_id = ?`,
      [instanceId]
    );

    const result = {};
    for (const row of rows) {
      result[row.question_id] = {
        response: row.response,
        type: row.response_type,
        python_feedback: null,
      };
    }

    res.json(result);
  } catch (err) {
    console.error("❌ Error fetching responses:", err);
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
    const [rows] = await db.query(
      `SELECT question_id, response, response_type
           FROM responses
           WHERE activity_instance_id = ?`,
      [instanceId, instanceId]
    );

    const result = {};
    for (const row of rows) {
      result[row.question_id] = {
        response: row.response,
        type: row.response_type
      };
    }

    res.json(result);
  } catch (err) {
    console.error("❌ Failed to get group responses:", err);
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

  // Stable order => stable lock order
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

        // Build one multi-row insert
        const values = [];
        const placeholders = entries.map(([questionId, responseText]) => {
          values.push(instanceId, questionId, 'text', responseText, userId);
          return '(?, ?, ?, ?, ?)';
        }).join(',');

        // IMPORTANT: conditional overwrite to avoid stomping followups if they were already written
        // - For normal questions: always upsert response
        // - For followups (F* or FA*): only set response if it's currently empty
        //   (no SELECT required)
        const sql = `
          INSERT INTO responses
            (activity_instance_id, question_id, response_type, response, answered_by_user_id)
          VALUES ${placeholders}
          ON DUPLICATE KEY UPDATE
            response = CASE
              WHEN question_id REGEXP '^[0-9]+[a-zA-Z]F[0-9]+$'
                OR question_id REGEXP '^[0-9]+[a-zA-Z]FA[0-9]+$'
              THEN IF(responses.response IS NULL OR responses.response = '', VALUES(response), responses.response)
              ELSE VALUES(response)
            END,
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

        // small backoff and retry
        await new Promise(r => setTimeout(r, 30 * attempt));
      }
    }
  } catch (err) {
    console.error('❌ Failed to bulk save responses:', err);
    return res.status(500).json({ error: 'Failed to bulk save' });
  } finally {
    conn.release();
  }
};


exports.saveFeedback = async (req, res) => {
  const {
    question_id,
    activity_instance_id,
    user_id,
    response_type,
    feedback,
  } = req.body;

  try {
    // Step 1: Find the response ID to attach feedback to
    const [rows] = await db.query(
      `SELECT id FROM responses
            WHERE activity_instance_id = ? AND question_id = ?`,
      [activity_instance_id, question_id, user_id]
    );

    const responseId = rows?.[0]?.id;
    if (!responseId) {
      return res.status(404).json({ error: "Response not found" });
    }

    // Step 2: Save feedback into the feedback table
    await db.query(
      `INSERT INTO feedback (response_id, feedback_text)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE feedback_text = VALUES(feedback_text)`,
      [responseId, feedback]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error saving feedback:", err);
    res.status(500).json({ error: "Failed to save feedback" });
  }
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

