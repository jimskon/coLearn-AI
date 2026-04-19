#!/usr/bin/env node
/**
 * add_qids_to_test.js
 *
 * Prompts for:
 *  - input text file path (exported from Google Doc)
 *  - view-tests path like /view-tests/52/264
 *
 * Then:
 *  - finds a "best" activity_instance for that course+activity (most responses)
 *  - extracts question_ids from responses in FIRST-SEEN ORDER (stable)
 *  - inserts a \qid{...} line immediately AFTER each \question{...} line
 *
 * Output:
 *  - writes a new file next to input: <input>.qid.txt
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mysql = require("mysql2/promise");

function ask(rl, prompt) {
  return new Promise((resolve) => rl.question(prompt, (ans) => resolve(ans.trim())));
}

function parseViewTestsPath(p) {
  // Accept: "/view-tests/52/264" or "view-tests/52/264"
  const m = String(p || "").match(/view-tests\/(\d+)\/(\d+)/);
  if (!m) return null;
  return { courseId: Number(m[1]), activityId: Number(m[2]) };
}

function isQuestionLine(line) {
  // matches exactly: \question{...}
  // (this is what your exported plain-text format uses)
  return /^\s*\\question\{[\s\S]*\}\s*$/.test(line);
}

function isQidLine(line) {
  return /^\s*\\qid\{[\s\S]*\}\s*$/.test(line);
}

function baseFromQuestionId(qid) {
  const s = String(qid || "").trim();

  // Grab leading number + letters chunk
  const m = s.match(/^(\d+)([a-z]+)(.*)$/);
  if (!m) return null;

  const num = m[1];
  const lettersAll = m[2];   // e.g. "pcode" or "ztable"
  const rest = m[3] || "";   // remainder after letters chunk (digits/_/etc)

  // Known suffix starters that are NOT part of the Excel-letter base
  const suffixStarters = ["code", "run", "response", "table", "score", "feedback"];

  // Choose the SHORTEST Excel-letter base that leaves a known suffix (or nothing)
  // Iterate k=1..lettersAll.length and see if remainder starts with a known suffix
  for (let k = 1; k <= lettersAll.length; k++) {
    const baseLetters = lettersAll.slice(0, k);              // "p"
    const tailLetters = lettersAll.slice(k);                 // "code"
    const tail = tailLetters + rest;                         // "code1" or "table0cell..."

    if (tail.length === 0) return num + baseLetters;

    const ok = suffixStarters.some(st => tail.startsWith(st));
    if (ok) return num + baseLetters;
  }

  // Fallback: treat ALL letters as the base (covers plain "1aa" etc)
  return num + lettersAll;
}

// Excel-style letters: 1->a, 2->b, ... 26->z, 27->aa, ...
function indexToLetters(i) {
  let n = i;
  let s = "";
  while (n > 0) {
    n--; // 1-based
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

// For tests: always "1a, 1b, ..." unless you change prefix later
function genTestQid(i) {
  return "1" + indexToLetters(i);
}

function lettersToIndex(s) {
  // 'a'->1, 'z'->26, 'aa'->27, ...
  let n = 0;
  for (const ch of s) {
    n = n * 26 + (ch.charCodeAt(0) - 96);
  }
  return n;
}

function parseBaseQid(qid) {
  // "12ab" -> { num: "12", letters: "ab" }
  const m = String(qid).match(/^(\d+)([a-z]+)$/);
  if (!m) return null;
  return { num: m[1], letters: m[2] };
}


async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const inputPath = await ask(rl, "Input test text file path: ");
    if (!inputPath) throw new Error("No input file provided.");

    const viewTests = await ask(rl, "view-tests path (e.g. /view-tests/52/264): ");
    const parsed = parseViewTestsPath(viewTests);
    if (!parsed) throw new Error("Could not parse view-tests path. Expected something like /view-tests/52/264");

    const { courseId, activityId } = parsed;

    // Read file
    const absInput = path.resolve(inputPath);
    if (!fs.existsSync(absInput)) throw new Error(`File not found: ${absInput}`);
    const raw = fs.readFileSync(absInput, "utf8");
    const lines = raw.split(/\r?\n/);

    // Find question lines
    const questionLineIdxs = [];
    for (let i = 0; i < lines.length; i++) {
      if (isQuestionLine(lines[i])) questionLineIdxs.push(i);
    }
    if (!questionLineIdxs.length) {
      throw new Error("No \\question{...} lines found in the file.");
    }

    // DB connect from server/.env
    const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT } = process.env;

    if (!DB_HOST || !DB_USER || !DB_NAME) {
      throw new Error(
        "Missing DB env vars. Need DB_HOST, DB_USER, DB_NAME (and likely DB_PASSWORD) in server/.env"
      );
    }

    const conn = await mysql.createConnection({
      host: DB_HOST,
      user: DB_USER,
      password: DB_PASSWORD || "",
      database: DB_NAME,
      port: DB_PORT ? Number(DB_PORT) : 3306,
    });

    try {
      // Find the instance for this course/activity with the most responses
      const [instRows] = await conn.query(
        `
  SELECT ai.id AS instance_id,
         COUNT(DISTINCT REGEXP_SUBSTR(r.question_id, '^[0-9]+[a-z]+')) AS base_count,
         COUNT(r.id) AS resp_count
  FROM activity_instances ai
  LEFT JOIN responses r ON r.activity_instance_id = ai.id
  WHERE ai.course_id = ? AND ai.activity_id = ?
  GROUP BY ai.id
  ORDER BY base_count DESC, resp_count DESC, ai.id ASC
  LIMIT 1
  `,
        [courseId, activityId]
      );


      const bestInstanceId = instRows?.[0]?.instance_id;
      const bestRespCount = Number(instRows?.[0]?.resp_count || 0);

      if (!bestInstanceId) {
        throw new Error(`No activity_instances found for course_id=${courseId}, activity_id=${activityId}`);
      }

      console.log(`Using instance ${bestInstanceId} (resp_count=${bestRespCount})`);

      // Pull question_ids in *first-seen* order (stable), not string sort.
      // This is the key fix for 1z -> 1aa issues, and for any non-numeric ids.
      const [qidRows] = await conn.query(
        `
  SELECT question_id, MIN(id) AS first_seen
  FROM responses
  WHERE activity_instance_id = ?
  GROUP BY question_id
  ORDER BY first_seen ASC
  `,
        [bestInstanceId]
      );


      const seen = new Set();
      let qids = [];

      for (const r of qidRows) {
        const base = baseFromQuestionId(r.question_id);
        if (!base) continue;
        if (seen.has(base)) continue;
        seen.add(base);
        qids.push(base);
      }

      console.log(`Found ${qids.length} base qids in DB (normalized, first-seen).`);
      console.log("First 10 qids:", qids.slice(0, 10));

      if (!qids.length) {
        console.log("No base qids found in DB; generating 1a.. from file order.");
      } else {
        console.log(`Found ${qids.length} base qids in DB (first-seen order).`);
      }


      // Ensure we have enough qids for all questions in the file.
      // If DB has fewer (e.g., student didn't reach the end), extend.
      if (qids.length < questionLineIdxs.length) {
        let startIndex = qids.length + 1; // fallback
        let prefixNum = "1";

        if (qids.length > 0) {
          const last = parseBaseQid(qids[qids.length - 1]);
          if (last) {
            prefixNum = last.num;
            startIndex = lettersToIndex(last.letters) + 1;
          }
        }

        const need = questionLineIdxs.length - qids.length;
        for (let k = 0; k < need; k++) {
          qids.push(prefixNum + indexToLetters(startIndex + k));
        }
        console.log(`Extended qids to ${qids.length} to match file question count.`);
      }

      // Insert \qid{...} lines.
      // We insert in a forward loop but track an offset because we're mutating the lines array.
      let inserted = 0;
      let skippedAlreadyHad = 0;

      let offset = 0;
      for (let qi = 0; qi < questionLineIdxs.length; qi++) {
        const origIdx = questionLineIdxs[qi];
        const idx = origIdx + offset;

        // If next line is already a \qid{...}, skip
        if (idx + 1 < lines.length && isQidLine(lines[idx + 1])) {
          skippedAlreadyHad++;
          continue;
        }

        const qidLine = `\\qid{${qids[qi] || genTestQid(qi + 1)}}`;
        lines.splice(idx + 1, 0, qidLine);
        inserted++;
        offset++;
      }

      const outPath = absInput.replace(/\.(txt|text|md)$/i, "") + ".qid.txt";
      fs.writeFileSync(outPath, lines.join("\n"), "utf8");

      console.log(`Done. Inserted ${inserted} \\qid{...} lines. Skipped ${skippedAlreadyHad} already-present.`);
      console.log(`Wrote: ${outPath}`);
    } finally {
      await conn.end();
    }
  } catch (err) {
    console.error("ERROR:", err.message || err);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}

main();
