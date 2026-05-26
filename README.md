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

For example, if students will browse to `http://colearn.local`, then use:

```bash
DOMAIN=colearn.local
WWW_DOMAIN=colearn.local
CLIENT_ORIGIN=http://colearn.local
```

---

## Notes

- Fresh installs depend on a current repo-root `schema.sql` snapshot
- Install scripts also run `migrations/run-all.sh` to reach the latest schema
- Frontend uses same-origin API (`/api`)

---

## Author

James Skon  
Kenyon College
