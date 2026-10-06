# coLearn-AI

coLearn-AI is a collaborative, AI-assisted learning platform designed to support **process-oriented, group-based learning** (POGIL-style) in programming and computer science education.

Unlike traditional systems that evaluate only final answers, coLearn-AI captures the **entire reasoning process**—including intermediate attempts, revisions, and AI-guided feedback—creating what we call a **persistent epistemic trace** of student learning.

---

## Core Idea

Modern AI tools make it easy for students to generate correct answers without engaging in the reasoning process. This creates a risk of **cognitive bypass**—students arriving at correct outputs without understanding how or why.

coLearn-AI addresses this by:

- Structuring collaboration through **group roles and turn-taking**
- Restricting AI to a **scaffolding role (not answer generation)**
- Recording all interactions in an **append-only history**
- Requiring reasoning as a condition for progress

---

## Key Features

- Small-group collaborative workflow
- Single active participant model
- AI-assisted feedback (not answers)
- Persistent submission history
- Multi-modal activities (text, Python, C++)

---

## Architecture (High-Level)

Browser → nginx → Node/Express → MariaDB  
                 ↘ Socket.IO  
                 ↘ C++ Runner (Docker)

---

## Installation

The recommended install method is the three-stage server install flow in this repo:

- [colearn_install_README.md](colearn_install_README.md)
- [install.conf.template](install.conf.template)
- [deploy.conf.template](deploy.conf.template)
- [01_server_bootstrap.sh](01_server_bootstrap.sh)
- [02_app_deploy.sh](02_app_deploy.sh)
- [03_post_install_check.sh](03_post_install_check.sh)

For a fresh install or a brand-new server, the repo must include an up-to-date `schema.sql` snapshot at the repo root. After importing that snapshot, the install scripts also run `migrations/run-all.sh` so the database lands on the latest schema.

Typical install flow:

1. Run [01_server_bootstrap.sh](01_server_bootstrap.sh) as `root`
2. Run [02_app_deploy.sh](02_app_deploy.sh) as the application user
3. Run [03_post_install_check.sh](03_post_install_check.sh) to verify the deployment

The older one-shot installer, [install_colearn_ai.sh](install_colearn_ai.sh), is still in the repo, but it is not the recommended default path for new installs.

For local classroom or lab servers behind a firewall, it is normal to run without SSL while still enabling the Docker-based C++ runner:

- set `ENABLE_CERTBOT=0` in `install.conf`
- keep Docker and the C++ runner enabled if students need local code execution
- use `http://...` for `CLIENT_ORIGIN` in `deploy.conf`
- make `DOMAIN`, `WWW_DOMAIN`, and `CLIENT_ORIGIN` match the exact hostname students will use in their browser

For example, if students will browse to `http://10.192.145.179`, then use:

```bash
DOMAIN=10.192.145.179
WWW_DOMAIN=10.192.145.179
CLIENT_ORIGIN=http://10.192.145.179
```

---

## Research Statistics and Observation View

coLearn-AI reconstructs research measures (participation, AI gating, revision, timing, instructor interventions) from the interaction trace it already keeps. Raw events stay the source of truth; statistics are computed on request. Design decisions and phases: [docs/research-statistics-plan.md](docs/research-statistics-plan.md).

### Who can use it

- **Root:** all courses.
- **Instructors and creators:** the courses they teach and the courses of classes they created.
- Students never see it.

### Requirements

| Requirement | Needed for | How |
|---|---|---|
| Migration `025` (`group_activity_slices` table) | Observation view activity strip, idle timer, time-on-task data | `migrations/run-all.sh`, or `bash migrations/025_2026-10-06_add_group_activity_slices.sh`. **Run it before restarting the server**: without the table, recording turns itself off (one log warning) until the next restart. |
| Migration `026` (`instructor_observations` table) | Observation tags | `migrations/run-all.sh`, or `bash migrations/026_2026-10-06_add_instructor_observations.sh` |
| `RESEARCH_ID_SECRET` in `server/.env` (16+ characters, keep private) | The row-level research datasets with pseudonymous student IDs (coming; the aggregate CSV available now does not need it) | Set once and never change it: changing it changes every research ID. |
| Server restart and client build | Any update to these features | As for any deploy. |

Everything else uses existing tables. Turn changes and instructor actions are written to the existing `audit_log`.

### What is recorded

All recording is fire-and-forget and never blocks or fails a classroom request. **No answer content is added by these features.**

| Recorded | Where | When |
|---|---|---|
| Active-student changes, with the reason (`rotation_after_submit`, `instructor_rotate`, `absent_reassigned`, `all_absent`, `claimed`, `group_setup`, `solo_join`, `cleared_on_completion`) | `audit_log` (`active_student_changed`) | Every change |
| Instructor force-advance | `audit_log` (`instructor_force_advance`) | Every force-advance |
| Activity per student per 10-second slice: edits, code runs, submits, Local Sandbox work, AI evaluation in progress | `group_activity_slices` | At most one write per student, kind, and slice |
| Instructor observation tags, with context (question group, whether it has code, active student, seconds since last activity, AI evaluation in progress, last AI decision) | `instructor_observations` | When an instructor taps a tag (undo deletes it) |

These records exist only from the day they were deployed. Runs that began before then are labeled as having **no** or **partial** turn data, and turn-based statistics leave them out; submit-based statistics (AI gating, revision, submit balance) cover all history.

### Research Statistics pages (`/research`, "Research" in the navigation bar)

1. Choose courses, and optionally a date range, group size, question type, and idle threshold (default 10 minutes: longer gaps count only up to the threshold).
2. Press **Generate**.
3. Use the tabs: **Overview** (scale, data coverage, excluded records), **Participation**, **AI Gating**, **Revision**, **Time**, **Group Size**, **Question Type**, **Over Time** (by week, activity order, or course), **Interventions**, **Exports**.

Every rate shows its numerator and denominator (for example *23.2% · 527 / 2,269*); distributions show median, mean, range, and N. The selection is kept in the page address, so a view can be bookmarked or shared.

**Excluded, and counted on the Overview tab:** tests, instructor sandbox runs, demo classes, groups with no student members, runs outside the date range, duplicate trace rows. Surveys (ungraded multiple choice) are not counted as AI decisions.

**Question types** come from the optional `\questiontype{...}` tag (see [MarkUp.md](MarkUp.md)); untagged questions count as `unknown`.

**Checking one run:** `GET /api/research/runs/<instanceId>` returns how a single run was reconstructed (submits, attempts and outcomes, turns, interventions), for comparing against what happened in class.

### Observation view (View Groups page)

Use the **Classic | Observation** switch at the top of View Groups (remembered per browser). Classic is unchanged. Observation adds, for each group:

- **Section status:** the current section and its time (for example *6:30 of 12 min*), or *+4:10 over* in amber.
- **Idle timer:** time since the group's last activity, red after 2 minutes. AI evaluation counts as activity, not idle.
- **Activity strip**, from the start (left) to now (right), scaled to the activity's planned time (the sum of `\section{...}{minutes}`):
  - green: the group was active; light green: only teammates working in their Local Sandbox; white: idle;
  - yellow: activity after the group passed its current section's minutes (the section clock starts when the group enters the section);
  - once the activity runs past its planned time, the strip compresses to fit and a dashed line marks the planned end;
  - dots below: submits (blue accepted, red sent back).

**Observation tags.** Each group card has eight buttons for what you see: **Talk** (discussing), **Code** (all coding; only when the current question group has code), **Watch** (one drives, others watch), **Quiet** (silent, on task), **Help** (asking for help), **Frust** (frustrated), **Off** (off topic), **?** (can't tell). A tag is saved at once, shows as a small square above the strip, and can be undone for 10 seconds. The round **i** button next to a group's timer badge opens a key to the strip colors and the tags, with the cues for each tag.

The view refreshes every 10 seconds. If it says recording or observations are not set up, migration `025` or `026` has not been run on that server.

---

## Notes

- Fresh installs depend on a current repo-root `schema.sql` snapshot
- Install scripts also run `migrations/run-all.sh` to reach the latest schema
- Frontend uses same-origin API (`/api`)
- Database tests (`npm run test:db` in `server/`) refuse to run unless the database name ends in `_test`, so they cannot write into a real database. On a server, set `TEST_DB_NAME=<name>_test` in `server/.env` and create that database with `DB_NAME=<name>_test node -r dotenv/config scripts/setup-test-db.js`. CI uses its own `colearn_test` database.

---

## Author

James Skon  
Kenyon College
