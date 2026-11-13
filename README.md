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
| Migration `027` (`activity_instances.ended_at`) | Ended – incomplete | `migrations/run-all.sh`. The server also adds the column on first use. |
| `RESEARCH_ID_SECRET` in `server/.env` (16+ characters, keep private) | The four row-level research datasets on the Exports tab (the aggregate CSV does not need it) | Set once and never change it: changing it changes every research ID. |
| Server restart and client build | Any update to these features | As for any deploy. |

Everything else uses existing tables. Turn changes and instructor actions are written to the existing `audit_log`.

### What is recorded

All recording is fire-and-forget and never blocks or fails a classroom request. **No answer content is added by these features.**

| Recorded | Where | When |
|---|---|---|
| Active-student changes, with the reason (`rotation_after_submit`, `instructor_rotate`, `absent_reassigned`, `all_absent`, `claimed`, `group_setup`, `solo_join`, `cleared_on_completion`) | `audit_log` (`active_student_changed`) | Every change |
| Instructor force-advance | `audit_log` (`instructor_force_advance`) | Every force-advance |
| Instructor pause and resume | `audit_log` (`activity_paused`, `activity_resumed`) | For each run whose pause state changes. Paused time is removed from every duration, idle timer, and section clock: students cannot act while paused, so it never counts as idle or as time spent. |
| Students arriving in and leaving a run (first heartbeat after 90+ s away, with their previous heartbeat; leave beacon) | `audit_log` (`member_joined`, `member_left`) | Each arrival and departure. Time when no student member is in the activity is removed from every duration, like a pause, so a group that leaves an unfinished activity and returns later is not credited with the time between. |
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

**Exports tab:** `aggregate_statistics.csv` (every statistic on the pages) and four row-level datasets for the same selection:

| Dataset | One row per |
|---|---|
| `question_attempts.csv` | AI-evaluated attempt: submitter, decision, time since the previous attempt, how the question ended |
| `feedback_revision_pairs.csv` | Answer the AI sent back: answer before, feedback, answer after, change size, next decision (contains answer text) |
| `group_participation.csv` | Run: submit and turn balance, skipped turns, interventions, question outcomes, time |
| `student_longitudinal.csv` | Student per run: submits, share of group submits, attempts and decisions, turns |

Students, groups, and instructors appear only as pseudonymous IDs (`S-…`, `G-…`, `I-…`, HMAC with `RESEARCH_ID_SECRET`), the same in every export; names and emails are never exported. Times are UTC. Turn columns are blank for runs without full turn data.

**Checking one run:** `GET /api/research/runs/<instanceId>` returns how a single run was reconstructed (submits, attempts and outcomes, turns, interventions), for comparing against what happened in class.

### Observation view (View Groups page)

Use the **Classic | Observation** switch at the top of View Groups (remembered per browser). Classic is unchanged. Observation adds, for each group:

- **Section status:** the current section and its time (for example *6:30 of 12 min*), or *+4:10 over* in amber.
- **Idle timer:** time since the group's last activity, red after 2 minutes. AI evaluation counts as activity, not idle. While the activity is paused, the timer reads *paused* and stops; section clocks stop too, and paused time shows on the strip as gray hatching.
- **Activity strip**, from the start (left) to now (right), scaled to the activity's planned time (the sum of `\section{...}{minutes}`):
  - green: the group was active; light green: only teammates working in their Local Sandbox; white: idle;
  - yellow: activity after the group passed its current section's minutes (the section clock starts when the group enters the section);
  - once the activity runs past its planned time, the strip compresses to fit and a dashed line marks the planned end;
  - dots below: submits (blue accepted, red sent back).

**Observation tags.** Each group card has eight buttons for what you see: **Talk** (discussing), **Code** (all coding; only when the current question group has code), **Watch** (one drives, others watch), **Quiet** (silent, on task), **Help** (asking for help), **Frust** (frustrated), **Off** (off topic), **?** (can't tell). A tag is saved at once, shows as a small square above the strip, and can be undone for 10 seconds. The round **i** button next to a group's timer badge opens a key to the strip colors and the tags, with the cues for each tag.

The view refreshes every 10 seconds. If it says recording or observations are not set up, migration `025` or `026` has not been run on that server.

---

## Ended – incomplete

A **group activity** run is ended when every student member has been away for **15 minutes** before finishing. The run must have at least one group submit. "Away" means no heartbeat; closing the page counts at once.

- **Students** see *Ended – incomplete*. They can open the run, review their answers, the AI feedback, and the history, and run or edit code in their Local Sandbox (not saved). They can't change answers, submit, or use the AI assistant; the server rejects these with `409 ACTIVITY_ENDED`.
- **Instructors** see *Ended – incomplete* on View Groups (and "ended" on the course progress grid). **Reopen** lets the group continue where they stopped.
- **Not included:** tests, assignments, demos, playgrounds, demo classes, sandbox runs, and runs whose students left more than a day before this feature was deployed.
- **Research statistics:** each run is *completed*, *ended incomplete*, or *in progress* (Overview → Runs by status; `run_status` in every export). Activity after a run ended is not counted.

The check runs every minute (`server/research/autoEnd.js`). Events: `activity_ended_incomplete`, `activity_reopened` in `audit_log`.

---

## AI models

Every AI model the system uses is set in `server/.env`; restart the server after changing one. Model names change as OpenAI retires them, so update these lists rather than the code. A missing setting uses the default shown.

| Setting | Default | Used for |
|---|---|---|
| `OPENAI_MODEL` | `gpt-6-luna` | Group activities: checking written answers and code (**Check**). |
| `OPENAI_GRADING_MODEL` | `OPENAI_MODEL` | Grading tests, assignments, and practice checks (including **Grade This Question** and **Regrade**); answering a student's question in a group activity; the **Summary** AI review. |
| `AI_BLOCK_MODELS` | `gpt-6-luna,gpt-4o-mini` | Models an `\ai` block may use, comma-separated. The **first is the default**. |
| `CREATOR_MODELS` | `gpt-6-luna,gpt-6.1-terra` | The activity creator's model menu, comma-separated. The **first is the default**, and the only choice for demo creators. |

**Lists and retired models.** The editor and creator menus show these lists (from `/api/runtime/config`). An activity's `\aimodel{...}`, or a creator choice, that is **not in the list** — for example a model OpenAI has retired — quietly uses the list's first model, so old activities keep working. New activities leave out `\aimodel` unless the author picks a non-default model.

**Reasoning effort.** Reasoning models accept a `reasoning effort` that trades thinking (time, cost, output tokens) for quality. The accepted values depend on the model: `gpt-6` models take `none`, `low`, `medium`, `high`, `xhigh`, `max` (default `medium`); `gpt-5` models take `minimal`, `low`, `medium`, `high`. Blank means not sent (the model's own default). A value a model does not accept makes its calls fail, so check the model's page when changing models.

| Setting | Default | Used for |
|---|---|---|
| `AI_BLOCK_REASONING_EFFORT` | `low` | `\ai` blocks: short classroom help. |
| `FEEDBACK_REASONING_EFFORT` | blank | Group **Check** feedback (`OPENAI_MODEL`). |
| `GRADING_REASONING_EFFORT` | blank | Everything that uses `OPENAI_GRADING_MODEL`. |
| `CREATOR_REASONING_EFFORT` | blank | The activity creator. |

Older models (GPT-4 and earlier, e.g. `gpt-4o-mini`) are not reasoning models: they get no reasoning effort and use a temperature instead.

**Changing models** may call for new token limits (below): a model that reasons more needs more output tokens. The `AI tokens: used/limit` line on graded questions and the warnings in View Groups → **Summary** show when a limit is close or reached.

---

## AI token limits

Each AI call has a limit on how many tokens the model may produce (its *output tokens*). Reasoning models (everything newer than GPT-4: the `gpt-5` and `gpt-6` families and `o` models) count their hidden reasoning against this limit, so a large input — long code plus supporting files — can use it all up before any answer is written. The call then returns nothing.

Every limit can be set in `server/.env`; restart the server after changing one. A missing value, a value that is not a number, or a value under 100 uses the default.

| Setting | Default | Used for |
|---|---|---|
| `GRADING_TOKENS` | 2500 | AI grading of tests, assignments, and practice checks: one call for code and output, one for the written answer. Also **Grade This Question** and **Regrade**. |
| `PRACTICE_HINT_TOKENS` | 300 | The hint shown in practice mode after a wrong multiple-choice pick. |
| `GROUP_FEEDBACK_TOKENS` | 700 | Group activities: checking a written answer and writing feedback. |
| `CODE_FEEDBACK_TOKENS` | 700 | Group activities: checking code (with its output and supporting files) and writing feedback. |
| `QUESTION_HELP_TOKENS` | 350 | Group activities: answering when a student asks a question instead of answering one. |
| `AI_BLOCK_TOKENS` | 1600 | `\ai` blocks (the inline AI assistant), for reasoning models. Older models such as `gpt-4o-mini` are capped at 500 or this value, whichever is smaller. |
| `CREATOR_DRAFT_TOKENS` | 3500 | Activity creator: writing a first draft of an activity. |
| `CREATOR_REVISION_TOKENS` | 3200 | Activity creator: revising one question. If the result is cut off, it retries once at double the limit. |
| `ACTIVITY_SUMMARY_TOKENS` | 4000 | View Groups → **Summary** → **Generate AI summary**. |

Raising a limit costs nothing on ordinary calls: the model uses only what it needs. It only allows long answers to finish.

**Token use on graded questions.** Instructors see a small line under each AI-graded score, e.g. `AI tokens: 840/2500` (tokens used by the last AI grade / `GRADING_TOKENS`); it turns red at 80% of the limit. **Grade This Question** shows the same in its preview. Students do not see it. It is saved with the grade as `<qid>AiTokens`, so it appears after the next grade or regrade.

**When a limit is reached**, it is recorded as an `ai_token_limit` event in `audit_log` (with the setting, its value, the model, and the run) and logged on the server as `[ai-token-limit]`. Instructors see it:

- **Graded questions** (tests, assignments, practice): the feedback says the grade did not finish, names the setting to raise, and asks for a regrade, instead of showing a silent 0. A failed grade is never reused as a cached result.
- **Group activities**: View Groups → **Summary** shows a warning listing how many times each setting ran out during that activity.
- **Activity creator** and **AI summary**: the error message names the setting.

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
