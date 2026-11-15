# Contributing to Avera

Use Node.js 24 LTS (minimum 22.18). Install locked dependencies with
`npm ci --ignore-scripts`. Work on a focused branch and submit a pull request;
merge only after Security and validation passes. Never use production records
for destructive tests or commit credentials, exports, databases or private keys.

## Repository map

| Path | Purpose |
| --- | --- |
| `src/` | React/Tailwind interface and same-origin HTTP application adapter |
| `server/` | Node backend, auth, storage, recovery, integrations and MCP |
| `shared/` | Shared record schemas, sample profiles and planning logic |
| `desktop/` | OS-specific launchers and packaged user instructions |
| `scripts/` | Build, packaging, verification and private credential helpers |
| `config/` | Backend configuration template |
| `tests/` | Synthetic contracts, real storage and browser acceptance checks |
| `docs/` | User and operator guides |
| `render.yaml` | Full financial website deployment; gateway deployed separately |

## Development

Run `npm run build` and `npm run start:local` in one terminal. In another, run
`npm run dev`. Vite proxies backend requests to port 4175; use the loopback-only
`AVERA_DEV_BACKEND_URL` for another backend address. `npm run build:local` is an
alias for the independent build; both builds write `dist-local`.

The production application uses the HTTP adapter only. Financial data lives in
SQLite locally or PostgreSQL when hosted, never localStorage. Storage, files,
auth and integrations remain behind interfaces. The gateway holds provider
credentials/handles and operational state; it is not a replica of finances.
Preserve owner/dataset isolation, source labels, exact money calculations and
explicit AI consent. V1 does not implement desktop/cloud synchronization.

## Validation

```sh
npm test
npm run lint
npm run typecheck
npm run typecheck:backend
npm run typecheck:platform
npm run build
npm run check:independent
```

For backend changes also run `npm run test:local` with a disposable PostgreSQL
URL in `AVERA_TEST_POSTGRES_URL` (SQLite always runs), plus relevant real browser
checks. A skipped PostgreSQL test is not a pass. See [test instructions](tests/README.md)
for suites, browser setup and hosted TLS tests. CI validates desktop packages on
macOS, Windows and Linux with Node 22 and 24. Do not treat fixture tests as live
provider certification or automated axe checks as full accessibility certification.

Target WCAG 2.2 AA and access to important information within four clicks.
Follow [the design system](docs/DESIGN.md) and preserve established color tokens.
Use conventional commits and report what changed, validation and remaining limitations.
