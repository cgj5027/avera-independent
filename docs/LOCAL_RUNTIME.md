# Stage 3: independent server and durable storage

## Run locally

Requires Node.js 22.18 or newer (Node 24 LTS recommended). Native desktop packages
and a bundled runtime arrive in Stage 7; this stage is a source-based preview.

```sh
npm ci --ignore-scripts
npm run build:local
npm run start:local
```

Open the loopback URL printed by the server (normally http://127.0.0.1:4175).
Create a local account with an email identifier and a 12–128 character password.
Email ownership is not verified in this stage. Google sign-in, email verification,
password recovery and consent grants remain compatibility/provider work for Stage
4 and are unavailable in independent mode. Forgotten local passwords currently
have no recovery flow; do not use production data before recovery acceptance.

The local build uses `src/api/httpApplication.js`, excludes the SDK bootstrap from
its module graph, and does not load the Base44 Vite plugin. It bundles the existing
Inter font and a local favicon. The compatibility build (`npm run build`) remains
available for regression testing during migration; SDK dependencies still exist
in package.json until the compatibility path is retired.

## Configuration and data

The CLI loads `.env.local` if present. Copy/adapt `config/server.example.env`, or
set backend variables in the process environment. Do not commit `.env.local`.

- `AVERA_DATA_STORE=sqlite` by default; `AVERA_SQLITE_PATH=data/avera.sqlite`.
- `AVERA_DATA_STORE=postgres` selects the real PostgreSQL adapter and requires
  `AVERA_DATABASE_URL`. Configure production TLS through the connection settings;
  credentials are backend-only. Neither database falls back to the other.
- `AVERA_PORT=4175` by default; `0` selects a free loopback port.
- `AVERA_PUBLIC_ORIGIN` is optional for a TLS reverse proxy and must be an exact
  HTTPS origin. The server itself binds loopback only; hosted deployment/auth
  hardening is not certified by this stage.
- Gateway remains the default integration setting, but online forwarding is not
  implemented until Stage 4. Even a configured gateway does not yet enable it.
- `AVERA_FILES_PATH` reserves the private-file location for Stage 4. Resume
  processing currently returns unavailable; it does not store uploads.

SQLite records, account password hashes, hashed session tokens, schema versions,
record revisions, deletion markers and a change journal are stored on disk. Local
files receive restrictive permissions where supported. Database encryption,
encrypted backup, export/import and guided recovery are Stage 6 work. Do not copy
an actively changing SQLite file as a backup; no backup guarantee is claimed yet.
Changing a storage variable selects a destination; it does not move existing data.

The common SQL storage contract is exercised against SQLite and PostgreSQL. SQL
parameters are bound; queries support the application's equality/and/or/in/exists
filters, limited sorting and owner/query-bound keyset cursors. Bulk inserts are
atomic. Category duplicates are constrained within each owner/dataset. Goal
contribution retries are serialized/idempotent; deleting goals/properties removes
their dependent contributions/mortgages in the same transaction. Schema versions
newer than this binary are refused without downgrading data.

The HTTP adapter declares `records.cascadesDependents`, so the UI delegates goal
and property deletion to that single transaction. The compatibility adapter keeps
its existing client-side cleanup. This avoids mixing legacy child-by-child deletion
with the independent server's protected contribution ledger.

## API and security boundaries

The browser calls same-origin `/api/v1` endpoints for public settings, password
registration/login/logout/profile, records/query/bulk operations and services.
Opaque HttpOnly/SameSite=Strict cookies replace localStorage bearer tokens in
independent mode. Session tokens are hashed in storage and expire after eight
hours; logout revokes them before navigating away. Passwords use salted scrypt.
Authentication attempts have a bounded process-local limit; persistent production
abuse controls and full account recovery remain later acceptance gates.

Every record operation derives its owner from the server session, regardless of
caller-supplied filters or IDs. Role/ownership/metadata mass assignment is rejected.
Private credential collections are not exposed. Demo tags cannot be changed on
existing records, references must share an owner and dataset, and imported bank
amounts are protected while category/annotation edits remain possible. Goal
contributions are service-created; demo contributions may be removed by demo
cleanup, while ordinary contribution removal occurs with goal deletion.

Mutating JSON requests require the correct Origin and Host. The server does not
enable cross-origin API access; JSON responses are not cached. Static files remain
within the built frontend root, with CSP, nosniff, frame and referrer protections.
The current CSP intentionally permits no external provider scripts or frames;
Stage 4 must add only the required provider origins before enabling Plaid Link.

`logGoalContribution`, deterministic `projectAnnualIncome`, and consented local
feedback persistence are implemented. Plaid, AI, job search and AI suggestion
operations return an explicit unavailable response. No external provider request,
Base44 fallback or fabricated financial response is performed in independent mode.

## Checks

```sh
npm test
npm run test:local
npm run typecheck
npm run typecheck:backend
npm run typecheck:platform
npm run lint
npm run build:local
npm run test:local:browser
```

Native storage tests always exercise real SQLite. Set `AVERA_TEST_POSTGRES_URL`
to a disposable test database to also exercise PostgreSQL; without it those tests
are explicitly skipped. CI provisions an isolated PostgreSQL service, not a live
user database. These tests create synthetic users and records.

The real browser suite creates temporary SQLite data, tests eight viewport/theme
combinations, record persistence, goal contributions, household updates and sample
seeding, then terminates/restarts the actual Node process and signs back in. It
rejects Base44/external browser requests and checks overflow and axe results.
Set `CHROMIUM_PATH` to an installed browser executable; CI uses Playwright's
installed Chromium. Temporary data is removed afterwards.

The original fixture browser suite remains a separate compatibility gate. Automated
accessibility checks do not certify manual screen-reader/device conformance.
Multi-device synchronization is not implemented or configurable in version 1.
