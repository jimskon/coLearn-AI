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

## Installation (Production)

Use the documented installer scripts that are in this repo:

- [colearn_install_README.md](/tmp/colearn-main-prep/colearn_install_README.md) for the recommended two-stage flow
- [install_colearn_ai.sh](/tmp/colearn-main-prep/install_colearn_ai.sh) for the all-in-one installer

For a fresh install or a brand-new server, the repo must include an up-to-date `schema.sql` snapshot at the repo root. After importing that snapshot, the install scripts also run `migrations/run-all.sh` so the database lands on the latest schema.

Typical two-stage flow:

1. Run [01_server_bootstrap.sh](/tmp/colearn-main-prep/01_server_bootstrap.sh) as `root`
2. Run [02_app_deploy.sh](/tmp/colearn-main-prep/02_app_deploy.sh) as the application user
3. Run [03_post_install_check.sh](/tmp/colearn-main-prep/03_post_install_check.sh) to verify the deployment

---

## Notes

- Fresh installs depend on a current repo-root `schema.sql` snapshot
- Install scripts also run `migrations/run-all.sh` to reach the latest schema
- Frontend uses same-origin API (`/api`)

---

## Author

James Skon  
Kenyon College
