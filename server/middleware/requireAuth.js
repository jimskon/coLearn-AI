// server/middleware/requireAuth.js

module.exports = (req, res, next) => {
  if (req.user) {
    return next();
  }

  res.status(401).json({ error: 'Unauthorized. Please log in.' });
};
