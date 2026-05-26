# coLearn-AI Ubuntu Installer (v2)

This installer is meant to take a new or existing Ubuntu 24.04 server and bring it to a working coLearn-AI deployment.

It is designed to be rerunnable and safer than the earlier versions.

## What it does

- installs missing system packages: MariaDB, nginx, Node.js, PM2, Docker when needed for the C++ runner
- creates or reuses an application user to own the repo
- clones or updates the coLearn-AI repo
- writes or updates `server/.env`
- creates the application database and database user
- imports `schema.sql` from the repo root only if the database is empty
- runs `migrations/run-all.sh` after bootstrap so the schema lands on the latest version
- creates or updates a coLearn-AI `root` user in the `users` table
- configures nginx to serve the built client and proxy `/api/`
- optionally requests a Let’s Encrypt certificate with certbot
- optionally clones, builds, and starts the C++ runner from git

## What it does not do

It does not try to fully configure Google or AI vendor secrets automatically.
Those should be gathered carefully and added to the environment after install.

## Assumptions

- Ubuntu 24.04 or similar
- DNS for the target domain points to this server before requesting TLS
- the app repo contains `server/`, `client/`, and a repo-root `schema.sql`
- the app’s server uses a `users` table with at least these columns:
  - `name`
  - `email`
  - `password_hash`
  - `role`

## Typical run

```bash
sudo bash install_colearn_ai.sh
```

You can also preseed values through environment variables.

Example:

```bash
sudo DOMAIN=colearn.example.edu \
WWW_DOMAIN=www.colearn.example.edu \
APP_USER=colearn \
APP_DIR=/opt/coLearn-AI \
REPO_URL=https://github.com/jimskon/coLearn-AI.git \
REPO_BRANCH=main \
PORT=4000 \
ENABLE_CERTBOT=1 \
ADMIN_EMAIL=you@example.edu \
ENABLE_CXX_RUNNER=1 \
CXX_RUNNER_REPO_URL=https://github.com/your-org/cxx-runner.git \
DB_NAME=colearn_db \
DB_USER=colearn_user \
NONINTERACTIVE=1 \
APP_ROOT_NAME="Administrator" \
APP_ROOT_EMAIL=admin@example.edu \
APP_ROOT_PASSWORD='replace-me' \
DB_ROOT_PASSWORD='replace-me-too' \
bash install_colearn_ai.sh
```

## Important prompts during install

The script may ask for:

- domain and www alias
- app repo URL and branch
- app database name, user, and password
- whether to install the C++ runner and from which repo
- whether to request TLS
- coLearn-AI root account name, email, and password
- MariaDB root password if MariaDB already exists and socket login is not available
- whether to set or reset a MariaDB root password

## MariaDB behavior

The script handles two common cases:

1. Fresh or default Ubuntu MariaDB setup where `sudo mariadb` works via socket auth.
2. Existing MariaDB setup where the root account uses a password.

It binds MariaDB to `127.0.0.1`.

It does **not** drop and recreate the app database on rerun.
It creates the database if missing, creates or updates the app DB user, and imports schema only when the DB is empty.

## Post-install manual steps

After the script completes, open and review:

```bash
sudo nano /opt/coLearn-AI/server/.env
```

Add the secrets and settings your deployment needs.

### 1. Google service account JSON

Place the JSON in a secure location readable by the app user, for example:

```bash
sudo mkdir -p /opt/coLearn-AI/server/secure
sudo chown colearn:colearn /opt/coLearn-AI/server/secure
sudo chmod 700 /opt/coLearn-AI/server/secure
```

Then copy the JSON file there and set any related env vars your app expects.

### 2. Google email / mailer settings

Collect the exact sender account and any required credentials or app password.
Do not guess these in the installer.
Add the mail-related env vars your app expects to `server/.env`.

### 3. AI provider key

Add your AI API key to `server/.env` using the exact variable name your server code expects.
Do not hardcode the key in the installer.

### 4. Restart after env changes

```bash
sudo -u colearn pm2 restart colearn-ai
sudo -u colearn pm2 save
```

## Useful checks

App process:

```bash
sudo -u colearn pm2 list
sudo -u colearn pm2 logs colearn-ai
```

nginx:

```bash
sudo nginx -t
sudo systemctl status nginx
```

MariaDB:

```bash
sudo systemctl status mariadb
sudo mariadb
```

Application DB connectivity:

```bash
mariadb -u colearn_user -p colearn_db
```

C++ runner:

```bash
docker ps
ss -ltn | grep 5055
```

## Why this version is better than the earlier ones

- It keeps the first-run convenience from the VM-style script by generating `.env` and importing schema only when the database is empty. fileciteturn1file0turn0file0
- It avoids the dangerous behavior in the newer installer that dropped and recreated the entire database on every run. fileciteturn0file1
- It avoids the duplicated C++ runner setup logic that was present in the newer installer. fileciteturn0file1
- It still preserves the good idea of prompting for the application root account during install. fileciteturn0file1
