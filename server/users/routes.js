
const express = require('express');
const router = express.Router();
const db = require('../db'); // Adjust path if needed

// Get all users (root only)
router.get('/admin/users', async (req, res) => {
  console.log("✅ /admin/users route hit");
  try {
    const [users] = await db.query('SELECT id, email, name, role FROM users'); // ✅ correct query

    //console.log("✅ Users fetched:", users);
    res.json(users); // directly send the array
  } catch (err) {
    console.error("❌ DB error:", err.message);
    res.status(500).json({ error: "DB query failed" });
  }
});

// Update user role
router.put('/admin/users/:id/role', async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  await db.query('UPDATE users SET role = ? WHERE id = ?', [role, id]);

  res.json({ success: true });
});

router.get('/:id', async (req, res) => {
  const userId = req.params.id;
  try {
    const [[user]] = await db.query(
      'SELECT id, name, email, role FROM users WHERE id = ?',
      [userId]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (err) {
    console.error('❌ Failed to fetch user by ID:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

module.exports = router;

