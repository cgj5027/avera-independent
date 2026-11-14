# Independent rebuild checkpoints

Each stage ends with documented checks and a separate commit/PR. Checks are gates
for proceeding, not implicit certification of services that were not exercised.
The approved scope is in [the rebuild plan](INDEPENDENT_REBUILD_PLAN.md).

| Stage | Scope | Required gate |
| --- | --- | --- |
| 1 | Reproducible baseline, regression repair, independent repository instructions | Clean lockfile install, existing tests, lint, both type checks, build, fixture browser audit |
| 2 | Application API and configuration boundaries for storage, authentication, private files and providers | Adapter contract tests, invalid-configuration checks, unchanged existing financial behavior |
| 3 | Local Node.js/SQLite backend, ownership/validation, schema migrations and hosted storage adapter | Durable CRUD/restart tests, ownership rejection, transaction/constraint tests, clean-machine startup |
| 4 | Gateway/default and direct-provider integrations; replace Base44 auth, AI/files/functions | Mocked failure/retry tests plus separately recorded live provider/auth acceptance with authorized test accounts |
| 5 | Landing-page sample-data option, dataset switching, website navigation and accessibility | Sample/personal isolation, failure recovery, complete reset coverage, four-click tasks and browser/accessibility matrix |
| 6 | Data migration, encrypted backup, portable export and guided restore | Counts/totals/relationship reconciliation, corruption/wrong-key rejection, rollback and recovery rehearsals |
| 7 | OS-independent distribution and Base44 exit | Clean Windows/macOS/Linux package tests, offline workflows, Base44-disabled integration acceptance and recovery gates |

Small fixes needed to support a later stage may land earlier, but that stage must
not be marked complete until its full gate passes. No production deployment,
Base44 cancellation or destructive migration is part of baseline preparation.

## Stage 1: baseline

Source baseline: `6729017694c87345cdc0b52e645d77867f613808` from the newer `work`
branch, with the approved plan added in `5db8ff6`.

The existing spending-edit regression seeded October 2026 but opened the current
budget month. Once the calendar moved forward, the correctly filtered dialog no
longer contained the test's transaction. The fixture now seeds current and previous
months and checks that editing/deleting current spending preserves older spending.
No production financial behavior was changed for this repair.

Dependency auditing found GHSA-mrwp-f3q8-3g9p in transitive `follow-redirects`
1.16.1. The lockfile now selects 1.16.2 within the existing dependency range; no
top-level dependency range was changed. The final advisory scan reports zero
known vulnerabilities. CI now also installs Chromium and runs the responsive
accessibility fixture suite after the existing validation/security steps.

Checkpoint status: local and GitHub CI passed; [PR #8](https://github.com/cgj5027/avera-independent/pull/8)
is open for review. Final local validation used a
fresh lockfile installation with lifecycle scripts disabled on Node 24.19.0 /
npm 11.9.0:

- `npm test`: 19 files / 399 tests passed.
- Lint, frontend type check, backend type check and production build: passed.
- `npm audit`: zero known vulnerabilities after the dependency patch.
- Pinned Gitleaks 8.24.3 Git-history scan with redaction: no leaks found.
- `tests/stage3-browser.cjs`: 200 fixture checks passed across 320, 390, 768 and
  1440-pixel widths, both themes; zero reported axe violations.
- Updated workflow YAML and browser-step shell syntax validated.
- `git diff --check`: passed.

The browser suite was rerun after the final dependency installation/build. CI
uses Node 22 and a Playwright-installed Chromium; its remote result is separate
from these local results. Known build warnings remain: missing Base44 runtime
configuration and a large (~1.36 MB uncompressed) frontend bundle.

Live integrations, authorization, manual assistive technology and cross-OS
packaging remain separate later gates. The copied code still requires Base44.
Stage 2 follows below; durable storage and provider replacements precede full
account-free demo acceptance.

## Stage 2: application and configuration boundaries

Frontend record, auth, settings, service, private resume and consent operations
now use typed application ports through one composition root. The compatibility
adapter preserves current Base44 behavior. Configuration defaults are SQLite
and gateway for the future server; unsupported adapters/configuration fail
explicitly without falling back to cloud data. The new strict platform type check
runs in CI. See [service boundaries](SERVICE_BOUNDARIES.md) and `config/` examples.

This stage does not implement a working independent HTTP server or database
driver. The only production adapter registered today is Base44. Stage 3 supplies
durable storage, transport, validation and ownership enforcement. Version 1 sync
remains unavailable; live providers and manual accessibility remain later gates.

Local checkpoint results:

- 21 test files / 430 tests passed, including 28 boundary/configuration tests and
  three consent-page port integration tests.
- Lint, frontend/backend type checks, the new strict platform type check, and
  production build passed.
- 200 responsive/browser fixture checks passed across four widths and both
  themes, with zero reported axe violations.
- npm audit: zero known vulnerabilities. Staged-diff secret scan: no leaks found.
- Workflow YAML and `git diff --check` passed. The interface import guard also
  checks that frontend source does not import the backend configuration module.

The existing build warnings remain (Base44 configuration absent in this isolated
workspace and the large frontend bundle). Stage 2 is based on the Stage 1 branch
while PR #8 is still open; merge/rebase order must preserve that baseline.

## Stage 3: independent server and durable storage

Stage 2 GitHub CI passed before this stage began. The independent HTTP entry now
uses a loopback Node server with local password accounts, HttpOnly sessions,
validated ownership-scoped CRUD, cursor pagination, atomic batches and migrations.
Both real SQLite and PostgreSQL adapters share the storage contract. Revisions,
deletion markers and a change journal prepare future sync work without enabling it.
Goal contributions, deterministic income projection and local feedback persistence
are implemented; online-provider calls explicitly return unavailable until Stage 4.

Use `npm run build:local` and `npm run start:local`; see
[local runtime instructions and limitations](LOCAL_RUNTIME.md). The local build
does not load the Base44 plugin or include SDK bootstrap chunks, and bundles the
existing font and local branding. Compatibility code/dependencies remain for the
transition; SDK retirement is a later gate.

Local checkpoint:

- 22 unit/integration files / 433 tests passed.
- 21 native HTTP/database checks passed with temporary SQLite data and an isolated
  PostgreSQL 16 container; no PostgreSQL cases were skipped.
- 33 real independent browser cases passed: four widths, both themes, local
  registration, durable bills, household updates, goal contributions and deletion,
  property/mortgage deletion, multi-income sample seeding, accessibility/overflow,
  and full Node-process restart/login.
  No Base44/external browser requests or browser exceptions were reported.
- 200 compatibility browser fixture checks passed with zero reported axe violations.
- Lint, frontend/backend/strict platform type checks, compatibility and independent
  builds passed. The independent build has no Base44 configuration warning; both
  retain the existing large-bundle warning.
- npm audit: zero known vulnerabilities. Staged-diff secret scan: no leaks found.
- Workflow YAML/shell syntax and `git diff --check` passed. CI now provisions a
  disposable PostgreSQL service and runs native storage and real browser checks.

Validation ran on Linux/Node 24. CI additionally exercises Node 22.18+; Windows and
macOS packaging/manual accessibility remain later gates. Local accounts are not
email-verified and have no recovery flow yet. Live integrations, encrypted backup,
guided restore, Base44 data migration and production hosted acceptance are not
claimed here. Stage 1 is on main. Stage 2 (#9) was merged into the old Stage 1
branch after that branch's PR had merged, so its commit had not reached main.
Stage 3 targets main and includes that already-reviewed Stage 2 commit; merging
the Stage 3 PR brings both stages onto main without losing their history.

## Stage 4: independent connected services and account flows

Stage 3 is merged into main (PR #10). This stage implements gateway-default and
advanced direct transports without SDK/runtime imports in the independent server.
The retained Plaid Sandbox, Ask Avera, category/bill suggestions, AI web search,
optional LinkedIn source, Photon and separately consented resume processing now
use the selected database and independent provider boundary. Missing credentials
never cause fallback to Base44. A headless gateway entry point and private
installation-grant helper are included; no public gateway was deployed.

The migration adds encrypted private storage, persistent minute/day quotas,
bank-operation leases, sharing preferences, account challenges and Google
identities. Real bank tokens stay at the gateway; downloaded installations hold
owner-bound opaque handles. Retry-safe imports retain the cursor on failures.
AI/profile sharing defaults off, can be revoked in Settings, and does not persist
assistant conversations. Local recurring-payment estimates remain available
without AI and require user review.

Account flows include configurable email verification, encrypted asynchronous
email retries, single-use password reset with session revocation, and Google OIDC
with PKCE/state/nonce/signature verification. Existing local accounts remain
usable. Private resume uploads request provider expiration and deletion; failed
cleanup is queued encrypted for retry rather than described as zero retention.
See [operator setup, privacy/recovery details and live gates](CONNECTED_SERVICES.md).

Local checkpoint on Linux/Node 24:

- 22 regression files / 433 tests passed.
- 46 native checks passed against temporary SQLite and PostgreSQL 16, with no
  skips: owner/dataset isolation, provider failure/cursor retry, import dedupe,
  bank-operation exclusion, gateway grant/actor isolation, offline bill review,
  retained job sources, resume validation/deletion retry, persisted quotas,
  verification/reset, Google callback rejection and encrypted mail-update races.
- 41 independent browser cases passed across four widths and both themes,
  including consent save/revoke/reload, durable finance workflows and full server
  process restart. No Base44/external requests or browser errors; no reported axe
  violations or overflow in the audited screens.
- The 200-case compatibility browser matrix passed with no reported axe violations.
- Lint, frontend/backend/strict platform checks, both builds and diff checks passed.
  Production and full dependency audits report zero known vulnerabilities.
- Redacted Git-history and staged-source secret scans passed. A module import
  repeated an existing LinkedIn-rule identifier false positive; only that exact
  historical finding is ignored, and the import was rewritten. Existing large-bundle
  warnings remain; the compatibility build still reports missing Base44 config.

**Status: implementation and fixture acceptance complete; live acceptance pending.**
No provider credentials/authorized live accounts were available. Gateway hosting,
real provider/email/Google/resume acceptance and final AI-sharing policy approval
remain owner/operator tasks in the linked guide. Fixture results do not certify
live subscriptions or production security/availability. CI must separately pass
on Node 22 before merge.

Base44's historical inbound MCP publishing is still compatibility infrastructure,
separate from Ask Avera/outgoing integrations. Independent MCP publishing remains
an explicit Stage 7 exit gate. Backups/restore/migration, account-free sample mode,
website navigation and manual accessibility/desktop packaging remain in their
scheduled stages. No Base44 cancellation or production cutover is authorized by
this checkpoint.

### Render deployment preparation

The headless gateway now supports an explicit `AVERA_LISTEN_HOST=0.0.0.0`,
Render's `PORT` and HTTPS external URL, while desktop startup keeps its existing
loopback-only listener. A configured Render hostname is accepted only for GET
health probes, so custom-domain deployments do not broaden gateway authorization.
Invalid ports/origins and unsupported public binding are rejected. Manual service,
PostgreSQL and secret settings are documented in RENDER_SETUP.md. No Render
resources or deployments are created by this change; live acceptance remains open.

### Job search: availability filtering

Following user acceptance, email verification/recovery, OpenAI answers (after API
funding) and Plaid Sandbox imports were reported working by the owner. Job search
returned stale/closed postings. Independent search now requires public-page
availability evidence before returning a job, with expiration/closure checks,
explicit treatment of unverified pages, bounded DNS-pinned HTTPS fetching and
source-check timestamps/exclusion counts in the UI. OpenAI web search is required
for discovery; optional LinkedIn results use the same availability gate.
See JOB_AVAILABILITY.md for the algorithm, limitations and coordinated gateway /
local-update steps. Live posting freshness must still be accepted after rollout.
The initial location proposal was stopped. The subsequent authorized Geocodio
replacement is described below; live location acceptance remains pending.

### Geocodio and transaction table follow-up

Independent distance filtering now uses Geocodio API v2.1 instead of Photon.
The gateway/direct server injects GEOCODIO_API_KEY into a freshly constructed fixed
HTTPS request, rejects caller credentials/extra parameters, and returns only the
location/match fields. Keys never go to browser/downloads. Request-scoped caching
and thirteen-lookups-per-search budget remain; persistent caching is deferred.
Matches require local city information, finite coordinates and accuracy >=0.8;
similarly scored distant matches need a more specific origin. Country/state-only,
unknown, quota failures and timeouts never silently broaden the selected radius.
Distances remain approximate straight-line distances. Legacy Base44 compatibility
logic is unchanged; the independent build uses Geocodio exclusively.

The transaction table removes recurring status, recurring controls and warning
highlights; recurring bill estimation remains in its separate review workflow.
It adds a collapsible filter panel, clear-filters action, result count, cleaner
spacing/headers, signed amounts and larger category-edit targets. Old column
preferences discard removed status; at least one column stays visible. CSV uses
visible columns and excludes the removed status. Financial calculations, stored
transactions, category assignment and source labels are preserved.

Rollout: configure a capped Geocodio account, add GEOCODIO_API_KEY on Render,
deploy the updated gateway, then update/rebuild/restart the desktop installation.
Test a specific city/state or postal code plus nearby/out-of-radius locations.
Live Geocodio connectivity and quota settings require operator acceptance; fixture
results do not certify them. No new database migration is required.

Local checkpoint for this follow-up (Linux/Node 24): 25 regression files / 442
tests passed; 57 native checks passed across SQLite and PostgreSQL 16, no skips;
41 independent-runtime browser cases and 208 responsive compatibility fixture
checks passed, with no reported axe violations. Lint, all three type checks and
both production builds passed. Existing large-bundle and compatibility-only
Base44 configuration warnings remain. Manual assistive-technology validation,
cross-OS packaging and live Geocodio acceptance are separate gates.

## Stage 5: landing page, website navigation and isolated samples

PRs #12 and #13 are merged; the owner reported Geocodio lookup working after
rollout. That report is live owner acceptance, distinct from fixture tests.

The independent application now uses the secondary landing-page sample picker,
website header/mobile menu and compact scenario controls described in
[Stage 5 behavior, navigation paths and upgrade steps](STAGE_5_WEBSITE.md).
Account-free samples use expiring, isolated cookie identities with no provider
access. Registered scenarios persist across selection changes. Migration 3 adds a
manifest; loading/reset is transactional and covers forecasts/contributions.
One owner-scoped preference, cross-tab events, full dataset remounting, request
cancellation and late-response/late-selection rejection protect switching.
Get started prioritizes personal finances; advanced Plaid testing stays in Settings.

Local checkpoint on Linux/Node 24: 26 regression files / 448 tests passed; 71 native
SQLite/PostgreSQL 16 checks passed with no skips; 41 existing independent-runtime
browser cases, 49 new real Stage 5 browser checks and 252 responsive compatibility
fixture checks plus 84 chat/drawer layout checks passed, with no reported axe violations or external requests in the
independent browser suites. New checks cover guest isolation/expiry, preserved
edits, empty scenarios, transactional rollback, shared-tab switching and clearing
unsent assistant drafts. Dependency audits report zero advisories; redacted staged/history secret scans
passed. Lint and all three type checks passed. Both builds pass
with existing large-bundle / compatibility-only Base44 configuration warnings.

Status: implementation and automated acceptance complete, subject to final CI.
Manual assistive-technology/device/zoom acceptance and user review of the new
navigation remain separate release gates. The historical SDK advanced seeding
path is not certified for independent atomic/guest behavior. Stage 6 implementation is recorded below; no production deployment was performed.

### Manual transaction save correction

The Transactions table owned its add dialog but received a callback that opened a
second parent dialog instead of persisting its payload. Submitting cleared the
first form without creating a transaction. The table now calls the actual
create/reload handler; the unused parent dialog/state have been removed.
Financial calculations, dataset tags and source-label rules are unchanged.

Regression tests reproduce the previous failure and now verify expense/income
creation in personal and sample modes, monthly spending updates, and preserving
form values on a failed write followed by one successful retry. The real SQLite
browser flow checks HTTP failures/retry, exactly two saved rows per dataset,
list/reload persistence, budget spending and Overview tracked-income totals.
Local checkpoint: 451 regression tests and 43 real independent browser cases
passed, with no reported axe violations, external browser requests or page
exceptions. Lint, all three type checks and both builds passed. Existing build
warnings remain. No database/provider change, migration or production deployment.
Previously submitted entries that were never written must be entered again.

## Stage 6: encrypted backups and guided recovery

Implementation and operator/owner steps are in [Stage 6 recovery](STAGE_6_RECOVERY.md).
Migration 4 adds recovery metadata and owner-scoped retained attachments. Daily/weekly
encrypted archives, portable passphrase exports, optional off-device copying and
verified pre-upgrade SQLite snapshots are independent of Base44. Guided restore and
prepared authorized-export import reconcile counts, exact saved money totals, file
hashes and relationships; verified safety copies precede transactional replacement.
Sessions end after recovery. Bank history stays disconnected until explicitly
reviewed/removed before fresh imports. Sync remains disabled.

No production records, credentials or deployment are changed. Real source export
acceptance, separate-device recovery, provider backup/PITR configuration and
cross-OS/manual accessibility checks remain explicit release gates.

Local checkpoint (Linux/Node 24): 454 regression tests passed; 95 native checks
passed on disposable SQLite/PostgreSQL 16 with no skips. Final recovery-only
verification passed 24 checks on both engines, including legacy bank provenance,
read-only history labels and installation private-file extraction/traversal
rejection. The real recovery browser suite passed 33 checks across four widths
and both themes; the existing independent browser suite passed 43 checks, Stage 5 sample/navigation
checks passed 49 cases, and responsive compatibility fixtures passed 252 checks, with no reported axe
violations. Independent browser suites reported no external requests/page errors.
Lint, all three type checks and both builds passed. Dependency audits reported
zero advisories; redacted history and staged-change secret scans found no leaks.
Existing large-bundle and compatibility-only Base44 configuration warnings remain.
CI and the owner acceptance steps above are separate from this local checkpoint.

## Stage 7: distribution and Base44 exit (in progress)

The owner reported the Stage 6 restore rehearsal and Render PostgreSQL backup
completed, and the Settings subtabs merged/tested. Stage 7 starts on its own branch.
Checkpoint A is the [portable desktop preview](STAGE_7_DISTRIBUTION.md): allowlisted
packages without Base44 runtime/dependencies or installation secrets; OS launchers;
a private data home separate from app files; integrity checks; graceful IPC shutdown;
and copied-package upgrade/offline/recovery automation. The sample generator now
lives in shared code so the backend does not require frontend source files.

This preview requires Node.js LTS; it is not a self-contained signed installer.
The new desktop CI matrix targets Windows/macOS/Linux with Node 22/24. Final
physical-device/cross-architecture acceptance, inbound MCP replacement, repository
SDK/plugin retirement, real migration/provider acceptance and Base44 cancellation
remain open. Stage 7 is not marked complete by this checkpoint.

Checkpoint A local evidence (Linux/Node 24): 454 regression tests passed; all 95
native SQLite/PostgreSQL 16 checks passed with no skips. A copied-package test
passed with external Node traffic blocked, covering real shell-launcher checks,
tamper rejection, manual writes, deterministic suggestions, unavailable gateway/AI,
exclusive data-home use, preserved data/keys across app-folder replacement and
backup/export/restore/session revocation. All 43 existing independent finance
browser checks passed against the copied package, including process restart,
with no reported axe violations, external requests or browser exceptions. Lint,
all three type checks, both builds, workflow YAML/shell/script syntax checks and
dependency audits passed (zero known advisories). The independent build keeps the
existing large-bundle warning; compatibility builds also warn about absent Base44
configuration. Cross-OS CI and owner/device acceptance are separate gates.
