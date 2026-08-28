# Deploy BigMind on Debian (modest home server)

Production deployment runbook for a low-power box (e.g. ASRock J3710-ITX,
256GB SSD, 8GB RAM, Debian 13 "trixie").

Architecture on the server:

```
Caddy (:80/:443) ── /api* ──► NestJS API (:3000) ──► PostgreSQL 16 (native, systemd)
     │                                                     │
     └── serves apps/web/dist (static PWA)               VACUUM/REINDEX timer
```

All config files live in the repo under `deploy/`. This guide copies them into
place and wires everything up. The API and web are built on a dev machine (or
on the server itself) and copied to `/opt/bigmind`.

---

## 1. Prerequisites

```bash
sudo apt update
sudo apt install -y postgresql-16 caddy nodejs npm git
# Or install Node via a proper channel; BigMind targets Node 24 (see .nvmrc).
```

Optional system tuning for a low-power box (recommended):

```bash
# Reduce swapping
echo 'vm.swappiness = 10' | sudo tee /etc/sysctl.d/99-bigmind.conf
sudo sysctl --system

# SSD: disable atime (edit /etc/fstab, add noatime to the data partition)
# Example line: UUID=xxxx  /  ext4  defaults,noatime  0  1

# Optional: zram swap (compressed RAM instead of SSD wear)
sudo apt install -y zram-tools
echo 'ALGO=zstd
SIZE=2048' | sudo tee /etc/default/zramswap
sudo systemctl restart zramswap
```

---

## 2. PostgreSQL 16 (native)

```bash
sudo systemctl enable --now postgresql@16-main

# Apply the tuning for modest hardware
sudo mkdir -p /etc/postgresql/16/main/conf.d
sudo cp deploy/postgresql.conf /etc/postgresql/16/main/conf.d/99-bigmind.conf
sudo systemctl restart postgresql@16-main

# Create the application role and database
sudo -u postgres psql <<'SQL'
CREATE ROLE bigmind LOGIN PASSWORD 'CHANGE_ME_STRONG_PASSWORD';
CREATE DATABASE bigmind OWNER bigmind;
SQL
```

Note: `shared_preload_libraries = 'pg_stat_statements'` takes effect on the next
restart (already done above). Verify the extension is usable:

```bash
sudo -u postgres psql -d bigmind -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
```

---

## 3. Build and install the application

Build on a machine with the workspace checked out (or on the server):

```bash
pnpm install
pnpm exec nx run @bigmind/api:build
pnpm exec nx run @bigmind/web:build
```

Install on the server:

```bash
sudo mkdir -p /opt/bigmind
sudo useradd -r -s /usr/sbin/nologin bigmind 2>/dev/null || true

# Copy the built artifacts (adjust source paths to your build machine)
sudo cp -r apps/api/dist apps/web/dist /opt/bigmind/
sudo cp -r deploy docs package.json /opt/bigmind/

# Environment file (secrets live here; never commit it)
sudo mkdir -p /etc/bigmind
sudo tee /etc/bigmind/bigmind.env >/dev/null <<'ENV'
DATABASE_URL=postgresql://bigmind:CHANGE_ME_STRONG_PASSWORD@localhost:5432/bigmind
JWT_SECRET=CHANGE_ME_SECURE_RANDOM_STRING
CORS_ORIGINS=http://bigmind.local
PORT=3000
ENV
sudo chmod 600 /etc/bigmind/bigmind.env
sudo chown -R bigmind:bigmind /opt/bigmind
```

## 4. Run database migrations

The API refuses to start without `JWT_SECRET`, but migrations run through
drizzle-kit. From the workspace on the build machine:

```bash
DATABASE_URL='postgresql://bigmind:CHANGE_ME_STRONG_PASSWORD@localhost:5432/bigmind' \
  pnpm exec nx run @bigmind/api:migrate
```

(or copy the `drizzle/` folder to the server and run `drizzle-kit migrate` there).

## 5. systemd service for the API

```bash
sudo cp deploy/bigmind-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bigmind-api
sudo systemctl status bigmind-api --no-pager
```

Health check:

```bash
curl -s http://127.0.0.1:3000/health
```

## 6. Caddy (web + reverse proxy)

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
# Edit /etc/caddy/Caddyfile: replace http://bigmind.local with your hostname/IP
sudo systemctl reload caddy
```

Verify:

```bash
curl -sI http://<server-ip>/ | head
curl -s http://<server-ip>/api/health   # if the API exposes it behind /api
```

## 7. Database maintenance timer

```bash
sudo cp deploy/bigmind-maintenance.sh /usr/local/bin/bigmind-maintenance.sh
sudo chmod +x /usr/local/bin/bigmind-maintenance.sh
sudo cp deploy/bigmind-maintenance.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bigmind-maintenance.timer
```

The timer runs weekly (`Sun 03:30`) and runs `VACUUM (ANALYZE)`; on the 1st of
each month it also reindexes the FTS GIN index. It does **not** prune the sync
tables — autovacuum keeps bloat in check.

## 8. Point your devices at it

- Set `VITE_API_URL` to `http://<server-ip>/api` and `VITE_SYNC_TRANSPORT=http`
  before building the web app (see `apps/web/src/sync/create-sync-transport.ts`).
- Register the first account from a device; the web app will sync via the API.

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| API won't start, "JWT_SECRET required" | `/etc/bigmind/bigmind.env` missing/not readable |
| `ECONNREFUSED 5432` | `systemctl status postgresql@16-main`; `pg_hba.conf` allows the `bigmind` role |
| Slow queries | `pg_stat_statements`: `SELECT query, calls, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;` |
| Static app 404s on deep links | Caddy `try_files {path} /index.html` is required for SPA routing (already in `deploy/Caddyfile`) |