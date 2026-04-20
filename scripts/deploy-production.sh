cd /opt/coLearn-AI

git pull

cd server
npm install
npm run test:ci

cd ../client
npm ci
npm run build

cd ..
pm2 restart colearn-ai --update-env
pm2 save

sudo nginx -t
sudo systemctl reload nginx
