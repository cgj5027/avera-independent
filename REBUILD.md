# Avera independent

This is the starting repository for the independent Avera rebuild, preserving the
newer working branch's history. See [the agreed rebuild plan](docs/INDEPENDENT_REBUILD_PLAN.md).

The copied code still requires Base44. The README retains historical baseline
instructions; AGENTS.md follows the independent rebuild direction. Track delivery
and validation in [stage checkpoints](docs/STAGED_DELIVERY.md). Do not deploy or
link this copy to the original production Base44 application as part of setup.

Target: React/Tailwind, TypeScript/Node.js, local SQLite/hosted PostgreSQL,
gateway-based online integrations, portable desktop operation and encrypted
backup/recovery. Multi-device sync is deferred to version 2.

Repository setup does not implement the migration. Keep the existing application
available until Base44-free operation and recovery have been verified.
