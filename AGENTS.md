# Avera independent

This repository rebuilds the user-owned Avera application independently of Base44.
Read `REBUILD.md`, `docs/INDEPENDENT_REBUILD_PLAN.md` and
`docs/STAGED_DELIVERY.md` before implementation. The README describes the independent runtime; older stage audits and
Base44-only restrictions are historical.

## Implementation rules

- Deliver bounded stages, running their checks before the next stage. Record
  evidence and unresolved gates; never turn fixture results into live certification.
- Preserve financial calculations, source labels, user/dataset isolation and the
  established color tokens. Test financial behavior rather than implementation shape.
- Target React/Tailwind and TypeScript/Node.js, SQLite locally/PostgreSQL hosted,
  with gateway integrations by default. LocalStorage is for preferences only.
- Keep storage, auth, files and providers behind replaceable interfaces. Retain
  all agreed online integrations. Never ship shared credentials to the browser or
  downloadable package; never print or commit secrets or real financial records.
- Production code and packages must remain independent of Base44. Historical
  platform fixtures are test-only; never reintroduce the SDK/plugin or import
  those fixtures in runtime code. Do not link/deploy into the original application.
- Version 1 has no multi-device synchronization; prepare identity, ownership,
  revisions and change tracking without claiming synchronization is implemented.
- Demo/personal switching must isolate datasets and refresh dependent views.
  Switching away must not delete sample records; resetting is a separate action.
- Target WCAG 2.2 AA and four-click access to important information. Automated
  accessibility checks supplement manual validation, not replace it.

## Checks

Install with `npm ci --ignore-scripts`. Run `npm test`, `npm run lint`,
`npm run typecheck`, `npm run typecheck:backend`, `npm run typecheck:platform`
and `npm run build` for a release
checkpoint. Run relevant browser suites against a local preview with synthetic
API fixtures; never use production records for destructive tests.

For independent backend changes also run `npm run test:local` against disposable
SQLite/PostgreSQL databases, `npm run build:local`, and `npm run test:local:browser`.
The latter uses real temporary SQLite data and a server-process restart. CI
requires PostgreSQL tests; a skipped local PostgreSQL case is not a pass.
Use Node 22.18+ and erasable TypeScript syntax for the native server entrypoint.

The default build is independent and writes dist-local. Run npm run
check:independent after building, and run the MCP native/browser checks for
authorization changes. Keep dependencies pinned by the lockfile and report
advisories rather than hiding them. Live external-client/provider acceptance
is distinct from synthetic protocol tests.

Use conventional commits and stage-specific branches/PRs. Keep the original
`cgj5027/avera` repository unchanged during this rebuild.
