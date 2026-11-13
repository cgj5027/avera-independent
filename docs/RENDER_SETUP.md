# Render gateway deployment

Use the reviewed Stage 4 branch (`feat/stage-4-integrations` until PR #11 is
merged), then main after merge. This deploys a headless gateway, not the website.
Do not deploy the older main branch without Stage 4.

Create paid PostgreSQL 16 and a paid always-on Node web service in the same region.
Build: `npm ci --ignore-scripts`. Start: `npm run start:gateway`.
Health check: `/api/v1/health`. Use Node 24 (`NODE_VERSION=24`). Disable automatic
deployment initially; deploy only a commit whose checks have passed.

Gateway environment:

- `AVERA_LISTEN_HOST=0.0.0.0`: explicit gateway-only container binding. Desktop
  startup remains loopback-only and ignores this setting.
- Render supplies `PORT`, `RENDER_EXTERNAL_URL` and `RENDER_EXTERNAL_HOSTNAME`.
  Leave `AVERA_PORT` unset to use `PORT`.
- `AVERA_PUBLIC_ORIGIN` can initially be omitted: the gateway uses Render's HTTPS
  external URL. Later set it to the exact custom HTTPS origin after domain setup.
- Render's own service hostname is accepted only for GET `/api/v1/health`, allowing
  health probes when the public gateway uses a custom domain. Other endpoints
  still require the configured public Host. Forwarded host headers are not trusted.
- `AVERA_DATA_STORE=postgres`, `AVERA_DATABASE_URL`: database's private internal URL.
- `AVERA_INTEGRATION_MODE=direct` on the gateway; desktops use `gateway` mode.
- `AVERA_VAULT_KEY`: generated private 32-byte base64 key; preserve in a secret manager.
- `AVERA_GATEWAY_GRANTS_FILE=/etc/secrets/avera-grants.json`: add the complete private
  installation-grant JSON as a Render Secret File named `avera-grants.json`.
- `AVERA_AUTH_EMAIL=false`, `AVERA_SYNC_ENABLED=false` on the headless gateway.
- Configure the retained provider keys as described in CONNECTED_SERVICES.md.
- `AVERA_EMAIL_FROM=Avera <noreply@avera.run>` after Resend domain verification.
- Set `GEOCODIO_API_KEY` to your Geocodio API key in Render Environment. Never use a `VITE_` prefix or copy it into gateway-mode desktop installations.
- Leave `OPENWEBNINJA_API_KEY` unset for OpenAI web-search-only job discovery.

Do not commit secret values or put them in frontend variables. No persistent disk
is required with PostgreSQL, an explicit vault key and a Render secret grant file;
resumes do not persist as local documents. The database and vault key must both
survive restarts. Preserve separate key recovery material and verify Render's
backup retention and restoration. Database migrations run at startup.

Verify health, authenticated provider calls, unauthorized rejection, restart
persistence, account email delivery and the complete Stage 4 live gate. A green
health endpoint establishes HTTP availability, not provider or recovery acceptance.
Use synthetic records/Plaid Sandbox; keep Base44 available until final exit gates.
