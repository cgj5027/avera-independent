# Avera repository instructions

Read `README.md`, `CONTRIBUTING.md` and the relevant guide in `docs/` before making changes.

- Preserve financial calculations, source labels, user/dataset isolation and established colors.
- React/Tailwind is the UI; TypeScript/Node.js serves SQLite locally or PostgreSQL hosted.
- Keep storage, auth, files and providers behind interfaces. Gateway integrations are the default.
- Never put credentials in frontend variables or ship installation data/keys in desktop packages.
- Production must not import test fixtures or a proprietary platform SDK/runtime.
- Keep local startup loopback-only; public hosting requires explicit canonical HTTPS configuration.
- LocalStorage is for preferences. V1 has no automatic desktop/online synchronization.
- Demo/personal switching isolates datasets and refreshes views; reset is a separate action.
- Target WCAG 2.2 AA and four-click access to important information.
- Use synthetic data for tests; never treat fixtures as live provider certification.

Follow the checks in CONTRIBUTING.md. For backend changes run native tests against
disposable SQLite and PostgreSQL with no PostgreSQL skips, build and run real local
browser checks. Run relevant MCP checks for authorization changes and hosted TLS
checks for public-host changes. Keep dependencies locked and report advisories.
Use Node 22.18+ and erasable TypeScript for native server entrypoints.

Use conventional commits and focused branches/PRs. Do not change the separate
original repository or production deployments as a side effect of source changes.
