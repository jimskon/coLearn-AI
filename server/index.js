// In server/index.js

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '.env'),
  override: true
});

//const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const session = require('express-session');

const app = express();                 // ✅ app is created FIRST
const PORT = process.env.PORT || 4000;
const aiRoutes = require('./ai/routes');

require('./heartbeatCleaner');
const db = require('./db'); // Make sure db is accessible

const staticDir = path.join(__dirname, '../client/dist');
app.use(express.json());

// ✅ CORS config goes AFTER app exists
const allowedOrigins = new Set([
  "https://colearn-ai.com",
  "https://www.colearn-ai.com",
  "https://jimskon.com",
  "https://csits.kenyon.edu",
    "https://csdev.kenyon.edu",
  "https://snhu.colearn-ai.com"
]);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow curl/health checks
    if (allowedOrigins.has(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET","POST","PUT","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"]
}));

app.options("*", cors());
app.use((req, res, next) => {
  res.setHeader('X-POGIL-PID', String(process.pid));
  next();
});

app.use('/api/ai', (req, res, next) => {
  console.log('*** HIT /api/ai ***', req.method, req.originalUrl, 'pid=', process.pid);
  next();
});

app.use('/api/ai', aiRoutes);

app.use(session({
  secret: process.env.SESSION_SECRET || 'supersecret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false, // Set to true in production if using HTTPS
    maxAge: 1000 * 60 * 60 * 24, // 1 day
  }
}));

// ✅ Restore req.user from session if available
app.use(async (req, res, next) => {
  if (req.session.userId && !req.user) {
    try {
      const [[user]] = await db.query(
        'SELECT id, name, email, role FROM users WHERE id = ?',
        [req.session.userId]
      );
      if (user) {
        req.user = user;
        //console.log('✅ req.user restored from session:', req.user);
      }
    } catch (err) {
      console.error('❌ Error restoring user from session:', err);
    }
  }
  next();
});

console.log('Resolved staticDir:', staticDir);

// Serve Skulpt and other static assets
app.use(express.static(path.join(__dirname, '../public')));

// ✅ Serve frontend static assets
app.use(express.static(staticDir));

// ✅ Register API routes
app.use('/api/auth', require('./auth/routes'));
app.use('/api/users', require('./users/routes'));
app.use('/api/courses', require('./courses/routes'));
app.use('/api/activities', require('./activities/routes'));
app.use('/api/groups', require('./groups/routes'));
app.use('/api/responses', require('./responses/routes'));
app.use('/api/events', require('./events/routes'));
app.use('/api/classes', require('./classes/routes'));
app.use('/api/activity-instances', require('./activity_instances/routes'));


// Log and handle unmatched API routes first
app.use('/api', (req, res, next) => {
  console.warn(`⚠️ Unknown API route accessed: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: 'API route not found' });
});

// Let React handle all non-API paths
app.all('*', (req, res) => {
  console.log(`📦 React route hit: ${req.method} ${req.originalUrl}`);
  res.sendFile(path.resolve(staticDir, 'index.html'));
});

const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // 🔐 Change this to your frontend URL in production
    methods: ['GET', 'POST']
  }
});

global.io = io;

function roomOfInstance(instanceId) {
  return `instance-${instanceId}`;
}

global.emitInstanceState = function emitInstanceState(instanceId, patch) {
  global.io.to(roomOfInstance(instanceId)).emit('instance:state', {
    instanceId,
    patch,
    ts: Date.now(),
  });
};

global.emitResponsePatch = function emitResponsePatch(instanceId, key, value, meta = {}) {
  global.io.to(roomOfInstance(instanceId)).emit('response:patch', {
    instanceId,
    key,
    value,
    ...meta,
    ts: Date.now(),
  });
};

global.emitAIPatch = function emitAIPatch(instanceId, qid, patch) {
  global.io.to(roomOfInstance(instanceId)).emit('ai:patch', {
    instanceId,
    qid,
    ...patch, // { f1, fm, af }
    ts: Date.now(),
  });
};



io.on('connection', (socket) => {
  console.log('🔌 Socket.IO client connected', socket.id);

  socket.on('instance:join', ({ instanceId }) => {
    socket.join(`instance-${instanceId}`);
    console.log(`👥 Client joined room instance-${instanceId}`);
  });

  // Back-compat: old joinRoom
  socket.on('joinRoom', (instanceId) => {
    socket.join(`instance-${instanceId}`);
    console.log(`👥 Client joined room instance-${instanceId} (legacy)`);
  });

  // Typing / observer sync (not authoritative)
  socket.on('response:update', ({ instanceId, responseKey, value, answeredBy }) => {
    socket.to(`instance-${instanceId}`).emit('response:update', {
      instanceId,
      responseKey,
      value,
      answeredBy,
      ts: Date.now(),
    });
  });

  // New name (preferred)
  socket.on('response:upsert', ({ instanceId, key, value, answeredBy }) => {
    socket.to(`instance-${instanceId}`).emit('response:patch', {
      instanceId,
      key,
      value,
      answeredBy,
      ts: Date.now(),
    });
  });

  // Code feedback / AI guidance relay (non-authoritative UI hints)
  socket.on('feedback:update', ({ instanceId, responseKey, feedback, followup }) => {
    socket.to(`instance-${instanceId}`).emit('feedback:update', {
      instanceId,
      responseKey,
      feedback,
      followup,
      ts: Date.now(),
    });
  });

  // Optional: socket-based presence ping
  socket.on('presence:ping', ({ instanceId, userId }) => {
    // implement presence map later; for now just accept
  });

  socket.on('disconnect', () => {
    console.log('❌ Socket.IO client disconnected', socket.id);
  });
});


server.listen(PORT, '0.0.0.0', () => {
  console.log(`ITS server with Socket.IO running on port ${PORT}`);
});

