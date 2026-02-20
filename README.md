# Inspector Backend (Self-Hosted)

Dockerized Node.js backend for GA4 Inspector and Mixpanel Inspector PDF report generation.

## API Endpoints

- `POST /api/v1/ga4-inspector/reports` returns `application/pdf`
- `POST /api/v1/mixpanel-inspector/reports` returns `application/pdf`
- `GET /api/health` returns `{ "ok": true }`
- Backward-compatible alias: `POST /api/v1/reports/ga4-inspector`
- Backward-compatible alias: `POST /api/v1/reports/mixpanel-inspector`

## CI/CD Flow (GitHub Actions + GHCR)

1. Push code to `main`.
2. GitHub Actions builds a multi-arch image (`linux/amd64`, `linux/arm64`).
3. Image is published to GHCR:
   - `ghcr.io/rapha-carvalho/blast_api:latest`
   - `ghcr.io/rapha-carvalho/blast_api:sha-<commit>`
4. On NAS run:
   - `docker compose --env-file .env pull`
   - `docker compose --env-file .env up -d --remove-orphans`

Every new change becomes a pull-and-restart on NAS.

## Local Development

Run directly:

```bash
npm install
npm start
```

Or with local Docker build:

```bash
docker compose -f docker-compose.local.yml up --build -d
```

## NAS Deployment

- NAS deploy file: `docker-compose.yml`
- Full setup: `NAS_CLOUDFLARE_TUNNEL_SETUP.md`
- SQLite persistence uses Docker named volume `ga4_inspector_data` (NAS permission-safe default)

## Environment Variables

Copy `.env.example` and adjust:

- `API_IMAGE` default `ghcr.io/rapha-carvalho/blast_api:latest`
- `PORT` default `3001`
- `NODE_ENV` default `production`
- `MAX_BODY_MB` default `5`
- `RATE_LIMIT_MAX` default `20`
- `RATE_LIMIT_WINDOW_MS` default `60000`
- `ENABLE_DB` default `false`
- `DB_PATH` default `/app/data/ga4-inspector.db`
- `ALLOWED_ORIGINS` default `https://blastgroup.org`
- `ALLOW_CHROME_EXTENSION_ORIGINS` default `true`
- `ALLOWED_EXTENSION_IDS` default empty
- `LOGO_PATH` default `/app/blast-logo.png`
- `CLOUDFLARE_TUNNEL_TOKEN` required for `cloudflared`

## References

- GA4 integration examples: `INTEGRATION_INSTRUCTIONS.md`
- Mixpanel integration examples: `MIXPANEL_INTEGRATION_INSTRUCTIONS.md`
- NAS + Cloudflare Tunnel setup: `NAS_CLOUDFLARE_TUNNEL_SETUP.md`
