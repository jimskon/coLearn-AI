# coLearn-AI Production Deployment Guide

This document describes how to deploy colearn-its in **production** on Ubuntu 24.04 using:

- Node.js (Express backend)
- Vite (React frontend build)
- nginx (reverse proxy + static hosting)
- PM2 (process manager)
- Optional TLS (Let's Encrypt or internal CA)

This guide assumes:
- Ubuntu 24.04
- Firewall enabled (only 80/443 exposed)
- Backend runs locally on port 4000

---
# 0. Domain Name and DNS Setup

Before deploying the server, obtain a domain name and configure DNS so that it points to your server.

Example domain:

```
csits.kenyon.edu
```

Create a DNS record:

Type: A  
Name: csits.kenyon.edu  
Value: <your server public IP>

Verify DNS resolution:

```bash
dig +short csits.kenyon.edu
```

The command should return the public IP of your server.

Do not continue until DNS resolves correctly.

---

# 1. Remove Apache (if installed)

```bash
sudo systemctl stop apache2
sudo systemctl disable apache2
```

---

# 2. Install Required Packages

```bash
sudo apt update
sudo apt install -y nginx
sudo apt install -y curl
sudo npm install -g pm2
```

Install Node LTS (if not already installed):

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

Verify:

```bash
node -v
npm -v
```
---
# 2.5 Install MariaDB

Install the MariaDB database server.

```bash
sudo apt update
sudo apt install -y mariadb-server mariadb-client
```

Enable and start the service:

```bash
sudo systemctl enable mariadb
sudo systemctl start mariadb
```

Verify:

```bash
sudo systemctl status mariadb
```

---

# 2.6 Secure MariaDB Installation

Run the security configuration script:

```bash
sudo mariadb-secure-installation
```

Recommended responses:

Set root password: **Yes**  
Remove anonymous users: **Yes**  
Disallow root login remotely: **Yes**  
Remove test database: **Yes**  
Reload privilege tables: **Yes**

---

# 2.7 Create coLearn-AI Database and User

Login to MariaDB as root:

```bash
sudo mariadb
```

Create the database:

```sql
CREATE DATABASE colearnai_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

Create an application user:

```sql
CREATE USER 'colearnai_user'@'localhost'
IDENTIFIED BY 'STRONG_PASSWORD_HERE';
```

Grant privileges:

```sql
GRANT ALL PRIVILEGES ON colearnai_db.* 
TO 'colearnai_user'@'localhost';

FLUSH PRIVILEGES;
```

Verify:

```sql
SHOW DATABASES;
SELECT user,host FROM mysql.user;
```

Exit:

```sql
exit;
```

---

# 2.8 Import the Database Schema

Import the schema used by the application.

Example:

```bash
mariadb -u colearnai_user -p colearnai_db < schema.sql
```

If you exported the schema from an existing system:

```bash
mariadb -u colearnai_user -p colearnai_db < schema.sql
```

Verify tables:

```bash
mariadb -u colearnai_user -p colearnai_db
```

Then:

```sql
SHOW TABLES;
```

---

# 2.9 Configure Firewall (UFW)

Enable the firewall and allow only required ports.

Allow SSH:

```bash
sudo ufw allow OpenSSH
```

Allow HTTP and HTTPS:

```bash
sudo ufw allow 'Nginx Full'
```

Enable firewall:

```bash
sudo ufw enable
```

Check status:

```bash
sudo ufw status
```

Only the following ports should be open:

- 22 (SSH)
- 80 (HTTP)
- 443 (HTTPS)

The Node backend on port 4000 remains private.
---

# 3. Clone Repository

```bash
git clone https://github.com/jimskon/coLearn-AI.git
cd coLearn-AI
```

---

# 4. Backend Setup

Install dependencies:

```bash
cd server
npm ci
cd ..
```

Create `server/.env`:

```env
PORT=4000
NODE_ENV=production

SESSION_SECRET=generate_a_secure_random_string

DB_HOST=localhost
DB_PORT=3306
DB_USER=pogil_user
DB_PASSWORD=strong_password_here
DB_NAME=pogil_db

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=

OPENAI_API_KEY=
```

---

# 5. Build Frontend

```bash
cd client
npm ci
npm run build
cd ..
```

This generates:

```
client/dist
```

Optional (recommended):  
In `client/.env`, set:

```env
VITE_API_BASE_URL=/api
```

This keeps API calls same-origin behind nginx.

---

---

# 6. Install PM2 (Node Process Manager)

PM2 keeps the backend server running in the background and automatically restarts it if it crashes or the server reboots.

Install PM2 globally using npm:

```bash
sudo npm install -g pm2
```

Verify installation:

```bash
pm2 -v
```

---

# 7. Start Backend with PM2

From the project root directory:

```bash
PORT=4000 NODE_ENV=production pm2 start server/index.js --name colearn-ai
```

Check status:

```bash
pm2 status
```

View logs:

```bash
pm2 logs colearn-ai
```

---

# 7.1 Configure PM2 to Start on Boot

Save the current process list:

```bash
pm2 save
```

Enable PM2 startup:

```bash
pm2 startup
```

PM2 will print a command that must be run with `sudo`.  
Run the command exactly as shown.

Example:

```bash
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

After running the command, save again:

```bash
pm2 save
```

This ensures the coLearn-AI backend automatically starts when the server reboots.

---

# 7.2 Restarting the Backend After Updates

After updating the code or rebuilding the frontend:

```bash
pm2 restart colearn-ai
```

To reload without downtime:

```bash
pm2 reload colearn-ai
```

# 6. Start Backend with PM2

From project root:

```bash
PORT=4000 NODE_ENV=production pm2 start server/index.js --name colearn-ai
pm2 save
pm2 startup
```

Run the one-time `sudo` command PM2 prints.

Check status:

```bash
pm2 status
pm2 logs colearn-ai
```

Restart later with:

```bash
pm2 restart colearn-ai
```

---

# 7. nginx Configuration

Create:

```bash
sudo nano /etc/nginx/sites-available/colearn-ai
```

Example config:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name csits.kenyon.edu;

    root /path/to/coLearn-AI/client/dist;
    index index.html;

    # React Router fallback
    location / {
        try_files $uri /index.html;
    }

    # Proxy API requests
    location /api/ {
        proxy_pass http://127.0.0.1:4000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 60s;
    }

    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
}
```

Enable site:

```bash
sudo ln -s /etc/nginx/sites-available/colearn-ai /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Application is now available at:

```
http://csits.kenyon.edu
```

---

# 8. Enable HTTPS (Choose One)

## Option A: Let's Encrypt (DNS-01)

Best if public DNS is available.

```bash
sudo apt install -y certbot
sudo certbot certonly --manual --preferred-challenges dns \
  -d csits.kenyon.edu --agree-tos -m you@kenyon.edu --no-eff-email
```

Add certificate to nginx:

```nginx
listen 443 ssl http2;

ssl_certificate     /etc/letsencrypt/live/csits.kenyon.edu/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/csits.kenyon.edu/privkey.pem;
```

Reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## Option B: Institutional Internal CA (Recommended for Campus)

Generate CSR:

```bash
sudo openssl req -new -newkey rsa:2048 -nodes \
  -keyout /etc/ssl/private/csits.kenyon.edu.key \
  -out /etc/ssl/csits.kenyon.edu.csr \
  -subj "/CN=csits.kenyon.edu" \
  -addext "subjectAltName=DNS:csits.kenyon.edu"
```

Submit CSR to internal CA.

Install returned cert:

```
/etc/ssl/certs/csits.kenyon.edu.crt
/etc/ssl/private/csits.kenyon.edu.key
```

Add to nginx:

```nginx
listen 443 ssl http2;

ssl_certificate     /etc/ssl/certs/csits.kenyon.edu.crt;
ssl_certificate_key /etc/ssl/private/csits.kenyon.edu.key;
```

Reload nginx.

---

# 9. Verify Deployment

```bash
sudo nginx -t
sudo systemctl reload nginx

curl -I http://csits.kenyon.edu
curl -I https://csits.kenyon.edu
```

Check backend:

```bash
pm2 status
pm2 logs colearn-ai
```

---

# 10. Updating the System

Pull updates:

```bash
git pull
```

Rebuild frontend:

```bash
cd client
npm run build
cd ..
```

Restart backend:

```bash
pm2 restart colearn-ai
```

---

# 11. Production Checklist

- [ ] Apache disabled
- [ ] nginx installed
- [ ] Database created
- [ ] Backend `.env` configured
- [ ] Frontend built
- [ ] PM2 running
- [ ] nginx proxy configured
- [ ] TLS configured
- [ ] Firewall allows 80/443 only

---

coLearn-AI production deployment complete.
