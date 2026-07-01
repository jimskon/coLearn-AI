# coLearn-AI Two-Stage Install

This install flow is intentionally split into two stages.

That is not extra ceremony. It fixes the exact class of failures that came from trying to do everything in one giant script.

Stage 1 is machine provisioning as root.
Stage 2 is application deployment as the application user.
Stage 3 is a verification pass.

This separation avoids:
- root-owned `.git` directories
- Git `safe.directory` problems
- SSH/HTTPS repo confusion inside sudo contexts
- app files being rewritten by root
- mixed failures that are hard to diagnose

## Files

- `01_server_bootstrap.sh` — run with `sudo`
- `02_app_deploy.sh` — run as the app user
- `03_post_install_check.sh` — run after deployment to verify the system

## What stage 1 does

Run as root.

It:
- installs base packages
- installs Node and PM2
- installs and enables nginx
- installs and enables MariaDB
- binds MariaDB to `127.0.0.1`
- creates the application OS user if needed
- creates the application database and DB user
- optionally sets a real MariaDB root password
- configures nginx for the coLearn-AI frontend and `/api/`
- optionally requests a Let's Encrypt certificate
- optionally installs Docker and adds the app user to the docker group
- writes a `deploy.conf.template` for stage 2

It does **not** clone or update the app repo.
It does **not** run npm inside the app repo.
It does **not** manage the app working tree.

## What stage 2 does

Run as the application user.

It:
- clones or updates the coLearn-AI repo
- forces `origin` to the configured repo URL
- installs server and client dependencies
- builds the client
- writes `server/.env`
- writes `client/.env`
- imports repo-root `schema.sql` if the application database is empty
- runs `migrations/run-all.sh` so the DB reaches the latest schema
- creates or updates the coLearn-AI root application user in the app database
- optionally clones/builds the C++ runner from git
- starts the Node app with PM2

It does **not** use `sudo` for repo operations.
That is the whole point.

## What stage 3 does

It checks:
- MariaDB service
- nginx service
- Node port
- optional C++ runner port
- application DB connectivity
- PM2 status
- HTTP/HTTPS response

---

# Prerequisites

Before you begin, decide these values:

- domain name, for example `its.example.edu`
- alias or `www` domain, if any
- app OS user, for example `colearn`
- app install directory, for example `/opt/coLearn-AI`
- app DB name, user, and password
- Node port, usually `4000`
- whether you want Certbot to request a real certificate now
- whether you want Docker installed now
- whether you want nginx to proxy `/cxx-run/`

You also need the repo URL for stage 2.

For a robust unattended setup, prefer an **HTTPS repo URL** unless you have already set up SSH deploy keys for the app user.

## Common student/lab setup

For local classroom or lab installs on firewalled machines, the simplest working setup is usually:

- no SSL
- Docker enabled for the C++ runner
- `/cxx-run/` proxy enabled when students will use the runner
- one local hostname used consistently in the browser and config files

In that case:

- set `ENABLE_CERTBOT=0`
- set `ENABLE_DOCKER=1`
- set `ENABLE_CXX_RUNNER_PROXY=1`
- use `http://...` for `CLIENT_ORIGIN`

The hostname in `CLIENT_ORIGIN` must match the exact address students use in the browser, or CORS can fail.

---

# Secrets and manual items

## Used during stage 1

- MariaDB root password, if needed
- application DB password
- Certbot admin email

## Used during stage 2

- session secret
- coLearn-AI root user password
- optional C++ runner repo credentials

## Manual after install

These are intentionally **not** baked into the installer:

- Google service account JSON file placement
- AI provider API key
- SMTP relay settings and sender address
- any post-install sharing of Google Docs / Sheets with the service account email

That material belongs in your operational docs, not hardcoded into a bootstrap script.

---

# Recommended config files

You can run the scripts interactively, but config files make the process more repeatable.

The repo includes starter templates you can copy and edit:

- `install.conf.template`
- `deploy.conf.template`

## Example `install.conf` for stage 1

```bash
DOMAIN=its.example.edu
WWW_DOMAIN=www.its.example.edu
APP_USER=colearn
APP_DIR=/opt/coLearn-AI
DB_NAME=colearn_db
DB_USER=colearn_user
DB_PASSWORD=replace_me
SET_DB_ROOT_PASSWORD=ask
PORT=4000
SITE_NAME=colearn-ai
ENABLE_CERTBOT=ask
ADMIN_EMAIL=admin@example.edu
ENABLE_DOCKER=1
ENABLE_CXX_RUNNER_PROXY=1
CXX_RUNNER_PORT=5055
NODE_MAJOR=20
```

## Example `install.conf` for a local firewalled lab server

```bash
DOMAIN=colearn.local
WWW_DOMAIN=colearn.local
APP_USER=colearn
APP_DIR=/opt/coLearn-AI
DB_NAME=colearn_db
DB_USER=colearn_user
DB_PASSWORD=replace_me
SET_DB_ROOT_PASSWORD=ask
PORT=4000
SITE_NAME=colearn-ai
ENABLE_CERTBOT=0
ENABLE_DOCKER=1
ENABLE_CXX_RUNNER_PROXY=1
CXX_RUNNER_PORT=5055
NODE_MAJOR=20
```

If students will browse by IP address instead of a local hostname, use the IP
for both `DOMAIN` and `WWW_DOMAIN`. For example:

```bash
DOMAIN=10.192.145.179
WWW_DOMAIN=10.192.145.179
```

## Example `deploy.conf` for stage 2

```bash
REPO_URL=https://github.com/your-org/coLearn-AI.git
REPO_BRANCH=main
APP_USER=colearn
APP_DIR=/opt/coLearn-AI
PORT=4000
DOMAIN=its.example.edu
WWW_DOMAIN=www.its.example.edu
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=colearn_db
DB_USER=colearn_user
DB_PASSWORD=replace_me
CLIENT_ORIGIN=https://its.example.edu
SESSION_SECRET=replace_with_a_long_random_secret
SERVICE_ACCOUNT_EMAIL=pogil-sheets-reader@colearn-ai.iam.gserviceaccount.com
APP_ROOT_NAME=Administrator
APP_ROOT_EMAIL=admin@its.example.edu
APP_ROOT_PASSWORD=replace_me
BOOTSTRAP_APP_ROOT=1
SERVER_ENTRY=server/index.js
ENABLE_CXX_RUNNER=0
CXX_RUNNER_REPO_URL=
CXX_RUNNER_DIR=/opt/cxx-runner
CXX_RUNNER_BRANCH=main
CXX_RUNNER_PORT=5055
```

## Example `deploy.conf` for a local firewalled lab server

```bash
REPO_URL=https://github.com/jimskon/coLearn-AI.git
REPO_BRANCH=main
APP_USER=colearn
APP_DIR=/opt/coLearn-AI
PORT=4000
DOMAIN=colearn.local
WWW_DOMAIN=colearn.local
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=colearn_db
DB_USER=colearn_user
DB_PASSWORD=replace_me
CLIENT_ORIGIN=http://colearn.local
SESSION_SECRET=replace_with_a_long_random_secret
OPENAI_API_KEY=replace_me
SMTP_HOST=smtp.example.edu
SMTP_PORT=587
SMTP_SECURE=0
SMTP_SERVICE=
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=colearn-ai@example.edu
EMAIL_USER=replace_me
EMAIL_PASS=replace_me
SERVICE_ACCOUNT_EMAIL=pogil-sheets-reader@colearn-ai.iam.gserviceaccount.com
APP_ROOT_NAME=Administrator
APP_ROOT_EMAIL=admin@colearn.local
APP_ROOT_PASSWORD=replace_me
BOOTSTRAP_APP_ROOT=1
SERVER_ENTRY=server/index.js
ENABLE_CXX_RUNNER=1
CXX_RUNNER_REPO_URL=https://github.com/your-org/cxx-runner.git
CXX_RUNNER_DIR=/opt/cxx-runner
CXX_RUNNER_BRANCH=main
CXX_RUNNER_PORT=5055
```

If students browse by IP address, keep the same exact IP in all three places:

```bash
DOMAIN=10.192.145.179
WWW_DOMAIN=10.192.145.179
CLIENT_ORIGIN=http://10.192.145.179
```

## Mapping note: `deploy.conf` vs `server/.env`

`deploy.conf` is the installer input file. It contains both:

- deploy-only values such as `REPO_URL`, `REPO_BRANCH`, `APP_USER`, and `APP_DIR`
- runtime values that are written into `server/.env`

Common runtime values students will recognize from `server/.env` include:

- `PORT`
- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `SESSION_SECRET`
- `OPENAI_API_KEY`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_SERVICE`
- `SMTP_USER`
- `SMTP_PASS`
- `EMAIL_FROM`
- `EMAIL_USER`
- `EMAIL_PASS`
- `CLIENT_ORIGIN`

So the names do not have to match perfectly across every variable. The goal is for `deploy.conf` to contain enough information for stage 2 to generate the correct runtime env files.

---

# Stage 1: server bootstrap

Copy `01_server_bootstrap.sh` to the server and run:

```bash
sudo bash 01_server_bootstrap.sh /path/to/install.conf
```

If you do not pass a config file, the script will prompt for values.

At the end, it writes:
- `${APP_DIR}/deploy.conf.template`
- `${APP_DIR}/bootstrap-summary.txt`

The template gives the app user a starting point for stage 2.

---

# Stage 2: app deploy

Log in as the app user:

```bash
sudo su - colearn
```

Copy the template if needed:

```bash
cp /opt/coLearn-AI/deploy.conf.template /opt/coLearn-AI/deploy.conf
chmod 600 /opt/coLearn-AI/deploy.conf
```

Edit it and fill in the repo URL and secrets.

Then run:

```bash
bash 02_app_deploy.sh /opt/coLearn-AI/deploy.conf
```

If you prefer, you can also keep the script elsewhere and point it at the config file.

---

# Stage 3: verify

Run:

```bash
sudo bash 03_post_install_check.sh /opt/coLearn-AI/deploy.conf
```

This gives you a quick operational check after deployment or after updates.

---

# Typical update flow later

Once the server is already provisioned, you usually do **not** rerun stage 1.

For normal updates:

```bash
sudo su - colearn
cd /opt/coLearn-AI
bash /path/to/02_app_deploy.sh /opt/coLearn-AI/deploy.conf
```

That updates the repo, reinstalls dependencies if needed, rebuilds the client, refreshes env files, and restarts PM2.

---

# Notes about repo authentication

If the repo is public, use HTTPS.

If the repo is private and you want unattended pulls, set up one of these **before** running stage 2:
- an SSH deploy key for the app user
- or an HTTPS credential strategy you explicitly trust

The stage-2 script will set `origin` to whatever `REPO_URL` you provide. That is deliberate, so an old SSH remote does not keep breaking updates.

---

# Google and AI setup after install

Do these after the app is deployed:

1. Place the Google service account JSON in a secure location on the server.
2. Add the relevant env var(s) in `server/.env`.
3. Add your AI provider key to `server/.env`.
4. Configure the SMTP relay settings your app uses for registration and password-reset email.
5. Share required Google Docs / Sheets with the service account email.
6. Restart the app:

```bash
sudo -u colearn pm2 restart colearn-ai
sudo -u colearn pm2 save
```

---

# Final advice

Do not try to turn stage 2 back into a root script.

That was the original design mistake.

Keep machine provisioning and app deployment separate. That is what makes this flow maintainable.
