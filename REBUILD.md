# Avera independent

This is the starting repository for the independent Avera rebuild, preserving the
newer working branch's history. See [the agreed rebuild plan](docs/INDEPENDENT_REBUILD_PLAN.md).

The compatibility build still requires Base44. The independent local build uses
its own server and storage. The README retains historical baseline
instructions; AGENTS.md follows the independent rebuild direction. Track delivery
and validation in [stage checkpoints](docs/STAGED_DELIVERY.md). Do not deploy or
link this copy to the original production Base44 application as part of setup.

Target: React/Tailwind, TypeScript/Node.js, local SQLite/hosted PostgreSQL,
gateway-based online integrations, portable desktop operation and encrypted
backup/recovery. Multi-device sync is deferred to version 2.

Repository setup does not implement the migration. Keep the existing application
available until Base44-free operation and recovery have been verified.

Stage 2 introduced [replaceable application ports](docs/SERVICE_BOUNDARIES.md).
Stage 3 adds the [independent local runtime](docs/LOCAL_RUNTIME.md), with SQLite
and PostgreSQL storage. `npm run build:local` and `npm run start:local` run it.
Stage 4 supplies [independent connected services](docs/CONNECTED_SERVICES.md);
live provider acceptance is pending. Packaging and production migration acceptance remain later gates; selecting
storage never automatically migrates records.

Stage 5 adds the [website landing/navigation and isolated sample flow](docs/STAGE_5_WEBSITE.md), including account-free samples in the independent runtime.

Stage 6 implements [encrypted backups, guided recovery and export migration](docs/STAGE_6_RECOVERY.md). Real-data migration and off-device/hosted recovery acceptance still require owner actions.

Stage 7 is in progress. Its first checkpoint adds [portable desktop preview
packages and launchers](docs/STAGE_7_DISTRIBUTION.md). They require Node.js LTS;
MCP replacement, compatibility dependency retirement and final desktop/cutover
acceptance remain open gates.
