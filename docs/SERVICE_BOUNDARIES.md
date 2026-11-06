# Stage 2: application and configuration boundaries

This records the Stage 2 checkpoint. Stage 3 now installs the independent HTTP
adapter and durable server; see [current local runtime instructions](LOCAL_RUNTIME.md).

The frontend uses `src/api/application.js`. Its typed ports are declared in
`src/platform/contracts.ts`; only the composition root and the temporary Base44
adapter know how the current backend is implemented. The existing SDK client and
token bootstrap remain compatibility dependencies, not target infrastructure.

| Port | Responsibility |
| --- | --- |
| auth | Session verification, login/register/verification, password recovery, profile updates and sign out |
| records | Cursor-based collection reads, CRUD and bulk seeding; preserve response/source/ownership fields |
| services | Provider operations including Plaid, Ask Avera, suggestions and job search |
| files | Consent-bearing resume processing; storage location remains a backend decision |
| settings | Public application configuration |
| consent | Opaque authorization handles with cookie/bearer transport and original response statuses |

`createApplication` accepts adapter factories and instantiates only the selected
factory. The production composition currently registers **only Base44**. Setting
`VITE_AVERA_BACKEND=http` currently stops startup with an explicit missing-adapter
error; it does not provide a working local backend or silently contact a fallback.
Stage 3 supplies the independent transport/server and durable storage.

The temporary records adapter accepts the fourteen public financial collections,
not credential vaults or service counters. This allowlist is defense in depth, not
authorization. The active server must enforce identity and row ownership on every
operation, including bulk actions and record IDs. Existing frontend owner/demo
filters remain unchanged. A session hint is never proof of authorization.

The SDK exposes collections through a Proxy. The compatibility adapter resolves
collections and identity on each call rather than caching a user or a fixed entity
object. SDK errors are preserved for existing auth and service error handling.
Consent statuses remain Responses so expired/single-use handles keep their
existing UI recovery semantics; cookie-only requests do not send Bearer null.

## Configuration

Examples are in `config/client.example.env` and `config/server.example.env`.
These are documentation templates, not automatically loaded files.

`readClientConfig` exposes only the backend selection. The backend-only parser in
`server/config.ts` accepts:

- `AVERA_DATA_STORE=sqlite|postgres` (default sqlite).
- `AVERA_SQLITE_PATH` and `AVERA_FILES_PATH` for portable filesystem locations.
- `AVERA_DATABASE_URL` for postgres; required when postgres is selected.
- `AVERA_INTEGRATION_MODE=gateway|direct` (default gateway).
- `AVERA_GATEWAY_URL`: HTTPS, or HTTP on loopback for development; no embedded
  credentials, query string or fragment. Operators must control the gateway.
- `AVERA_SYNC_ENABLED=false`: enabling synchronization is rejected in version 1.

A missing gateway URL means online services are unconfigured, not permission to
fall back to a direct provider. The future backend must report that condition
while allowing local finance workflows. Configuration does not migrate records.
Changing storage requires explicit export/import and reconciliation.

Never return the server configuration to a browser or log it: the postgres
connection string may contain credentials. Paths/providers are backend decisions;
no `VITE_` provider secrets or database URLs are supported. Invalid configuration
errors name the setting without echoing its supplied value.

## Validation and remaining work

Contract tests cover adapter selection/failure, configuration rejection, dynamic
SDK collections, pagination/write forwarding, changing identity, error propagation,
resume payloads, and cookie-only/expired consent handling. An import-boundary test
prevents feature code from adding new SDK imports or platform endpoint URLs.
`npm run typecheck:platform` checks the new ports, adapter and server parser under
strict TypeScript settings and runs in CI.

The Base44 SDK, build plugin, hosted assets and existing backend functions remain.
No SQLite/PostgreSQL driver, independent login server, gateway deployment or
multi-device synchronization is claimed by this stage. Live provider/auth and
manual accessibility gates remain unverified until their later stages.
