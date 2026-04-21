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

### 1. Configure Environment

Create:

/opt/coLearn-AI/server/.env

Include:

PORT=4000  
NODE_ENV=production  
DB_HOST=localhost  
DB_PORT=3306  
DB_USER=...  
DB_PASSWORD=...  
DB_NAME=...  
SESSION_SECRET=...  

---

### 2. Run Installer

chmod +x install_colearn_ai_from_env.sh

sudo DOMAIN=jimskon.com \
WWW_DOMAIN=www.jimskon.com \
APP_USER=skon \
APP_DIR=/opt/coLearn-AI \
ENABLE_CERTBOT=0 \
ENABLE_CXX_RUNNER=1 \
CXX_RUNNER_DIR=/opt/cxx-runner \
CXX_RUNNER_REPO_URL=https://github.com/jimskon/coLearn-AI-cxx-runner.git \
./install_colearn_ai_from_env.sh

---

### 3. Verify

pm2 status  
pm2 logs colearn-ai  
sudo nginx -t  
curl -I http://jimskon.com  

---

### 4. Enable HTTPS

Rerun installer with ENABLE_CERTBOT=1

---

## Notes

- Installer recreates database from scratch  
- Not safe for upgrading a live system  
- Frontend uses same-origin API (/api)

---

## Author

James Skon  
Kenyon College
