# NAS + Cloudflare Tunnel Setup

This setup expects the API image to be published from GitHub Actions to GHCR.

## 1) One-Time GitHub Setup

1. Keep this repository on GitHub.
2. Use branch `main` for deployable changes.
3. Confirm workflow exists at `.github/workflows/docker-publish.yml`.
4. Push one commit to trigger the first image build.
5. Wait for workflow success in GitHub Actions.
6. Confirm image exists in GHCR:
   - `ghcr.io/rapha-carvalho/blast_api:latest`

If the package is private, run `docker login ghcr.io` on NAS with a GitHub token that has `read:packages`.

## 2) Why This Compose Works Better on NAS

- The API uses a Docker named volume (`ga4_inspector_data`) for SQLite.
- This avoids common NAS bind-mount permission errors.
- DB is disabled by default (`ENABLE_DB=false`) because it is optional.

## 3) Files Needed on NAS

Only these files are required on NAS:

- `docker-compose.yml`
- `.env`

`docker-compose.yml` already contains both services:

- `api` (backend image from GHCR)
- `cloudflared` (tunnel connector)

## 4) Create `.env` on NAS

Use this template:

```env
API_IMAGE=ghcr.io/rapha-carvalho/blast_api:latest
PORT=3001
NODE_ENV=production
MAX_BODY_MB=5
RATE_LIMIT_MAX=20
RATE_LIMIT_WINDOW_MS=60000
ENABLE_DB=false
DB_PATH=/app/data/ga4-inspector.db
ALLOWED_ORIGINS=https://blastgroup.org
ALLOW_CHROME_EXTENSION_ORIGINS=true
ALLOWED_EXTENSION_IDS=
LOGO_PATH=/app/blast-logo.png
CLOUDFLARE_TUNNEL_TOKEN=
```

Set `CLOUDFLARE_TUNNEL_TOKEN` after creating the tunnel.

## 5) Create Cloudflare Tunnel

In Cloudflare Zero Trust:

1. `Networks` -> `Tunnels` -> `Create a tunnel`
2. Connector type: `Cloudflared`
3. Name it (example `blast-api-nas`)
4. Choose Docker environment
5. Copy tunnel token
6. Put token into NAS `.env`:
   - `CLOUDFLARE_TUNNEL_TOKEN=<token>`

## 6) Add Public Hostname in Tunnel

Create one public hostname route:

- Subdomain: `api`
- Domain: `blastgroup.org`
- Service type: `HTTP`
- URL: `http://api:3001`

`api` is the backend service name in `docker-compose.yml`.

## 7) Start on NAS

```bash
docker compose --env-file .env up -d
```

Check status:

```bash
docker compose ps
docker compose logs -f api cloudflared
```

## 8) Update on Every New Change

After each new push to `main` and successful GitHub Action build:

```bash
docker compose --env-file .env pull
docker compose --env-file .env up -d --remove-orphans
```

## 9) Verify

```bash
curl https://api.blastgroup.org/api/health
```

```bash
curl -X POST "https://api.blastgroup.org/api/v1/ga4-inspector/reports" \
  -H "Content-Type: application/json" \
  -H "Accept: application/pdf" \
  --data @payload.json \
  --output ga4-inspector-report.pdf
```

## 10) If You Still See `db_init_failed`

1. Restart API:
   - `docker compose --env-file .env restart api`
2. Inspect error detail:
   - `docker compose logs --tail=100 api`
3. Keep DB disabled (`ENABLE_DB=false`) unless you explicitly need request audit storage.
