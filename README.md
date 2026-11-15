# Avera independent

Avera is a user-owned household finance website with a portable Node.js backend,
SQLite locally, optional PostgreSQL hosting and gateway-based connected services.
React and Tailwind provide the browser interface. No Base44 account, SDK, plugin,
authentication, storage or hosted asset is required to build or run this application.

## Run from source

Use a supported Node.js LTS release, at least 22.18 (CI exercises Node 22 and 24).

```sh
npm ci --ignore-scripts
npm run build
npm run start:local
```

Open the displayed loopback URL. Keep your installation's `.env.local`, database,
private files and key files outside version control. New source installations
use `data/avera.sqlite` by default. To configure existing gateway/provider settings,
see [connected services](docs/CONNECTED_SERVICES.md) and the backend-only template
[config/server.example.env](config/server.example.env). Existing settings remain
valid; gateway mode is the default. Financial records are never stored in browser
localStorage, and selecting a new data path does not migrate records.

`npm run dev` starts the independent Vite development UI and proxies backend paths
to an already running local server on port 4175. An alternate development
backend can be selected with the loopback-only `AVERA_DEV_BACKEND_URL`. `npm run build:local` remains an
alias for the independent build; both builds write `dist-local`.

## Desktop downloads

[Desktop distribution and upgrade guide](docs/STAGE_7_DISTRIBUTION.md). Packages
include the built website/backend and locked JavaScript runtime libraries, without
installation data or credentials. They currently require Node.js LTS; they are not
self-contained signed installers. User data lives separately from replaceable app
folders. Existing desktop gateway settings and original keys must be preserved.

```sh
npm run build
npm run package:desktop
```

Use a successful trusted GitHub Actions run's archive and checksum. Do not deploy
this repository into or relink it to the original production platform application.

## Backup, sharing and release acceptance

[Encrypted backup/migration/recovery](docs/STAGE_6_RECOVERY.md) covers portable
exports and explicit restoration/reconciliation. [Independent MCP](docs/INDEPENDENT_MCP.md)
is optional, read-only, off by default and separately consented; it is not Ask Avera
and does not turn the provider gateway into a financial data host. Multi-device
sync remains disabled in version 1.

Migration 5 signs users out once and adds independent MCP authorization tables.
Take a fresh backup before upgrade, retain original keys and sign in again.
The owner's Mac/Windows/Linux desktop acceptance and live gateway AI reports are
recorded separately from fixture/CI checks. Real-data reconciliation and final
external-client/cutover acceptance remain operator decisions before cancelling
the old service. No production deployment or cancellation is automatic.

Validation and stage evidence: [STAGED_DELIVERY.md](docs/STAGED_DELIVERY.md).
The old platform fixtures under `tests/fixtures/legacy-platform` exist only to
preserve historical regression cases; they are not deployable production code,
build inputs or dependencies and are never packaged into a desktop download.
