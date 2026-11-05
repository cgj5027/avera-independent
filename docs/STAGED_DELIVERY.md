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

Checkpoint status: complete locally, ready for review. Final validation used a
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
Next: stage 2 API/configuration boundaries, followed by durable storage and
provider replacements before the full account-free demo entry is accepted.
