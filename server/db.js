const mysql = require('mysql2/promise');
const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '.env'),
  override: false,
});

console.log("Connecting to DB as:", process.env.DB_USER, "with pass?", !!process.env.DB_PASSWORD);

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  dateStrings: true, // return DATETIME as 'YYYY-MM-DD HH:MM:SS', not JS Date
  timezone: 'Z',     // treat times as UTC when needed
});

module.exports = pool;
