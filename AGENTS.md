# Avera independent

This repository rebuilds the user-owned Avera application independently of Base44.
Read `REBUILD.md`, `docs/INDEPENDENT_REBUILD_PLAN.md` and
`docs/STAGED_DELIVERY.md` before implementation. The README describes the existing
application; older stage audits and Base44-only restrictions are historical.

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
- Base44 is a temporary compatibility backend, not the target architecture.
  Do not link or deploy this copy to the original production application.
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

Current frontend preview/build still uses the Base44 Vite plugin. A successful
build does not establish standalone operation. Keep dependencies pinned by the
lockfile and report dependency advisories rather than hiding them.

Use conventional commits and stage-specific branches/PRs. Keep the original
`cgj5027/avera` repository unchanged during this rebuild.
