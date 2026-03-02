# Deploy chess online len Render

## 1) Chuan bi repo

- Dam bao ban da push toan bo thu muc len GitHub:
  - `chess/`
  - `chess-server/`
  - `render.yaml`

## 2) Tao service bang Blueprint

1. Vao Render Dashboard -> `New` -> `Blueprint`.
2. Chon repo chua project nay.
3. Render se doc file `render.yaml` va tao 1 Web Service.

Service nay se:
- build frontend + backend bang `npm ci --prefix chess && npm run build --prefix chess && npm ci --prefix chess-server`
- start bang `node chess-server/server.js`
- serve frontend tu `chess/dist` (fallback ve `chess/public/legacy` neu chua build)
- expose API/socket tren cung domain

## 3) Cau hinh Environment Variables

Trong service vua tao, dien cac bien sau:

- `CORS_ORIGIN`: bat buoc la domain that (vi du `https://chess-online.onrender.com`), KHONG dung `*`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_WEB_API_KEY`
- `FIREBASE_WEB_AUTH_DOMAIN`
- `FIREBASE_WEB_PROJECT_ID`
- `FIREBASE_WEB_APP_ID`
- `FIREBASE_WEB_MESSAGING_SENDER_ID` (optional)
- `FIREBASE_WEB_MEASUREMENT_ID` (optional)
- `DB_BACKUP_ENABLED` (`true`)
- `DB_BACKUP_INTERVAL_HOURS` (`24`)
- `DB_BACKUP_RETENTION_DAYS` (`14`)
- `DB_BACKUP_DIR` (`/var/data/backups`)

Goi y map tu file `firebase-admin.json`:

- `project_id` -> `FIREBASE_PROJECT_ID`
- `client_email` -> `FIREBASE_CLIENT_EMAIL`
- `private_key` -> `FIREBASE_PRIVATE_KEY`

Luu y:
- Khong commit secret vao git.
- `FIREBASE_PRIVATE_KEY` can dung format key. Neu Render khong nhan multi-line, dung dang escaped `\n`.
- Khong dat `CORS_ORIGIN=*` tren production.
- Khuyen nghi dat secret Firebase trong Render Environment, khong luu file JSON key trong repo.

## 4) Cau hinh Firebase Auth cho domain Render

Trong Firebase Console:

1. Authentication -> Settings -> Authorized domains
2. Them domain Render cua ban, vi du:
   - `chess-online.onrender.com`

Neu khong them domain nay, dang nhap Google popup se bi chan.

## 5) Verify sau khi deploy

- Mo `https://<your-service>.onrender.com`
- Kiem tra API:
  - `https://<your-service>.onrender.com/api/stats`
  - `https://<your-service>.onrender.com/api/client-config`
- Vao mode Online:
  - dang nhap Google thanh cong
  - bam `Tim tran` de vao queue

## 6) Ghi chu van hanh

- `CHESS_DB_PATH` da tro ve `/var/data/chess-online.sqlite` trong `render.yaml`.
- Backup SQLite tu dong chay trong server theo lich (`DB_BACKUP_INTERVAL_HOURS`), file backup nam o `DB_BACKUP_DIR`.
- Co the backup thu cong bat ky luc nao: `npm --prefix chess-server run backup:db`
- Render Free co the sleep khi khong dung; phien realtime co the bi ngat khi service ngu.

## 7) Rollback nhanh bang release tag

Muc tieu: moi lan deploy production deu co 1 git tag de quay lai nhanh.

1. Tao tag sau khi code da commit:
   - `npm --prefix chess-server run release:tag -- release-20260301-1430`
2. Push tag:
   - `git push origin release-20260301-1430`
3. Khi can rollback:
   - checkout tag: `git checkout release-20260301-1430`
   - redeploy commit cua tag do tren Render.
