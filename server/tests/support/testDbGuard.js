'use strict';
// Preloaded into every database test (see "test:db" in package.json).
//
// Database tests create and delete users, classes, and courses. Run against a
// real database they leave residue (and could delete real rows), so they only
// run against a database whose name ends in "_test":
//   - CI sets DB_NAME=colearn_test.
//   - On a server, set TEST_DB_NAME (e.g. pogil_test) in server/.env; it
//     replaces DB_NAME for the tests only.
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../../.env'), override: false });

if (process.env.TEST_DB_NAME) process.env.DB_NAME = process.env.TEST_DB_NAME;

const name = String(process.env.DB_NAME || '');
if (!/_test$/i.test(name)) {
  console.error(
    `\nRefusing to run database tests against "${name || '(no DB_NAME)'}".\n` +
    'Database tests need a separate database whose name ends in "_test".\n' +
    'Set TEST_DB_NAME=<name>_test in server/.env (see server/tests/support/testDbGuard.js).\n'
  );
  process.exit(1);
}
