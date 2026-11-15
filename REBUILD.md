# Avera independent

The application builds and runs independently of Base44. The sole production
adapter is the same-origin Avera HTTP API. The independent default build writes
`dist-local`; no Base44 SDK/plugin or platform-hosted asset is required.

Target architecture remains React/Tailwind, TypeScript/Node.js, local SQLite or
hosted PostgreSQL, gateway integrations by default, OS-independent desktop use and
encrypted backup/recovery. Multi-device synchronization remains deferred to V2.

See the [approved rebuild plan](docs/INDEPENDENT_REBUILD_PLAN.md),
[stage evidence](docs/STAGED_DELIVERY.md), [desktop guide](docs/STAGE_7_DISTRIBUTION.md)
and [independent OAuth/MCP guide](docs/INDEPENDENT_MCP.md). Root README has current
startup instructions. Older stage audits are historical evidence, not current
runtime instructions. Historical platform regression fixtures are test-only.

Stage 7 supplies the independent MCP replacement and removes compatibility runtime
code/dependencies. The owner reported Mac/Windows/Linux desktop checks passed on
the prior preview. Final candidate CI, updated-installation checks, any original
data reconciliation and external MCP-client acceptance remain distinct from code
implementation. Keep the original service available until cutover is accepted.
Do not deploy/relink this copy into the original production platform application,
share backend keys, or cancel provider/platform subscriptions automatically.
