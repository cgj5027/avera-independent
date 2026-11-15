# Testing Avera

All automated tests use synthetic records. Never point test commands at a live
user database or provide production provider credentials.

## Unit and contract tests

```sh
npm ci --ignore-scripts
npm test
```

React tests inject an in-memory application at `@/api/application`. Test-only
`fixtures/contracts` contains service behavior/schema fixtures and provider mocks;
`test:service-client` and `test:service-runtime` are local Vitest aliases, not
installed SDKs or deployment targets. They preserve finance/auth/error regression
coverage. Production code and desktop packages must not import these fixtures.
Real HTTP/native suites separately test current storage and authorization.

## Real backend tests

Set `AVERA_TEST_POSTGRES_URL` to a **disposable PostgreSQL 16 database**, then run
`npm run test:local`. SQLite always runs; missing PostgreSQL explicitly skips its
cases, which does not count as complete validation. CI provisions its own database.
The suite covers owner/dataset isolation, transactions, providers, samples,
recovery, hosted configuration and OAuth/MCP.

## Browser checks

Install Chromium with `npx playwright install chromium`. Set `CHROMIUM_PATH` to
its executable (CI uses Playwright's path; Linux scripts default to `/usr/bin/chromium`).
On macOS, obtain it with `node -p "require('playwright').chromium.executablePath()"`.
Build first with `npm run build`, then run the relevant suites:

| Command | Coverage |
| --- | --- |
| `npm run test:local:browser` | Real SQLite finance UI, persistence and process restart |
| `npm run test:samples:browser` | Welcome/sample navigation, isolation and reset |
| `npm run test:recovery:browser` | Encrypted export, preview, restore and reconciliation |
| `npm run test:mcp:browser` | Read-only OAuth consent and revocation |
| `npm run test:hosted:browser` | PostgreSQL through a temporary TLS proxy; synthetic email |
| `npm run test:desktop` | Copied package, upgrades, integrity and offline recovery |

The hosted browser suite requires `AVERA_TEST_POSTGRES_URL` and OpenSSL. Real
browser suites create/clean temporary data and do not need a separately running
application. Set `AVERA_TEST_DESKTOP_PACKAGE` for finance checks against a copied package.

For synthetic responsive/layout checks, start `npm run preview -- --host 127.0.0.1 --port 4173`
and run `npm run test:ui:browser`, `node tests/chat-layout-browser.cjs`, or
`node tests/overview-charts-browser.cjs`. `AUDIT_BASE_URL` overrides the preview URL.
The workflow runs these same named suites on pull requests.

Tests cover light/dark themes, mobile/desktop widths and axe accessibility rules.
Manual keyboard, screen-reader and zoom testing and real provider/email acceptance
remain separate checks. Dependency audits and secret scanning run in CI.
