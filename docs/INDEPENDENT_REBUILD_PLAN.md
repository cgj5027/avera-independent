# Avera independent rebuild

Status: approved direction; implementation pending. This repository preserves the
history and code of `cgj5027/avera`, branch `work`, through
`6729017694c87345cdc0b52e645d77867f613808`.

## Accepted decisions

- Retain React and Tailwind; use TypeScript/Node.js for new backend work.
- Build an operating-system-independent browser interface and portable backend.
  Validate local packages/launchers on Windows, macOS and Linux; define supported
  versions and architectures before release.
- Support SQLite locally and PostgreSQL for hosted installations through a common
  application API and storage adapters. Browser localStorage is for preferences.
- Use the Avera integration gateway by default for local installations. Support
  direct provider connections as an advanced operator configuration. Never bundle
  shared production credentials in downloads or frontend variables.
- Retain Plaid, AI assistance and suggestions, AI web search, OpenWeb Ninja/LinkedIn
  data, and geocoding. Provide gateway hosting and transactional email where hosted
  authentication/recovery needs it. Validate subscriptions and production terms.
- Exclude multi-device synchronization from version 1. Prepare stable IDs,
  ownership, revisions, timestamps and deletion/change tracking for version 2.
  Version 2 still needs a sync service, device authentication and conflict rules.
- Preserve the established colors, create a website-style layout, and validate key
  information paths within four clicks on desktop and mobile.
- Target WCAG 2.2 AA, using automated checks plus manual keyboard, screen reader,
  zoom/reflow, contrast, focus and actual-device validation.

## Local and connected behavior

Financial records and attachments live in the selected storage destination.
Plaid imports update that destination with duplicate-safe retries. Ask Avera reads
relevant selected-database context through the backend. Deterministic suggestions
and manual finance workflows work offline. Hosted AI, bank refresh and current job
search require connectivity; show status, stale-data labels and last-update times.
Selecting a storage adapter does not migrate data: use explicit import/export.
Provider refresh is distinct from multi-device application synchronization.

## Demo entry

Use one main landing page with a primary Get started action and a secondary
Use sample data control. Offer a compact scenario picker; open the ordinary
Overview shell using an isolated sample workspace. The basic local demo should
not require an account. Keep sample labels visible, with a compact active-mode
control for changing scenario, resetting, and returning to personal finances.

Switching off restores personal finances without deleting sample records. Reset
is a separate confirmed action. Stage scenario loading before activation; retain
the previous state on failure. Reload/remount every dataset-dependent screen,
cancel stale requests, and clear incompatible forms and conversations. Unify mode
and workspace state across reloads/tabs. Include ForecastRecord in cleanup.
Keep Plaid Sandbox in advanced testing rather than as a primary landing choice.

## Backup and recovery

- Create a consistent SQLite backup daily when running, and before upgrades/imports.
  Use supported database backup facilities rather than copying an active file.
- Keep seven daily and four weekly backups, with storage-limit handling.
- Include records, attachments, schema version and relationship metadata.
- Encrypt portable backups with a recovery passphrase/key. Exclude provider secrets
  from ordinary exports; document any separate credential recovery mechanism.
- Offer optional user-selected off-device backup; same-disk copies do not protect
  against disk loss. Display the last successful backup and failures.
- Provide guided restoration: validate integrity/compatibility, show backup date,
  preserve current data before replacement, and test cross-OS restoration.
- Use automated hosted backups and point-in-time recovery where available, with
  defined retention and regular restoration rehearsals.
- Restore financial records independently of bank authorization. Explain when
  reconnection is needed and that losing encryption recovery material can make a
  backup unrecoverable.
- Initial targets, pending validation: at most one day of lost local work when
  backups ran; restoration within an hour once a valid backup and working device
  are available. These are targets, not guarantees.

## AI privacy proposal (requires final product-policy approval)

Make AI optional; disclose gateway/provider processing at first use. Send only
needed context, never credentials/full account numbers. Verify provider training,
retention and deletion terms. Default to no persistent conversation history,
separate resume-processing consent, temporary-file deletion, generic web queries,
and operational logs without financial contents/prompts. Compute money in code.
Local storage does not mean local AI processing.

## Delivery sequence and acceptance

1. Repair the spending-edit test failure and establish a reproducible baseline.
2. Implement application API, storage/auth/file boundaries and migrations.
3. Replace Base44 services; implement gateway and direct-provider adapters.
4. Implement offline behavior, landing/demo flow, website navigation and accessibility.
5. Export/migrate authorized data and files, reconcile ownership, relationships,
   counts and totals; verify password/token portability or plan reconnection.
6. Implement backups, encrypted transfer, restore and recovery-key handling.
7. Package/test across supported desktops, including clean-machine operation.
8. Rehearse recovery and test all retained workflows with Base44 access disabled.
9. Cut over; cancel Base44 only after acceptance and recovery checks pass.

Base44 exit gates: no SDK/plugin/runtime dependencies, Base44-hosted assets,
authentication, storage, functions, AI/file services or secrets required for
operation; Avera-owned provider accounts; migrated data reconciled. The current
copied application still depends on Base44 until this work is complete.

## Assessment baseline

Working-branch checks using installed workspace dependencies: 398 tests passed,
one failed (spending-edit UI, also failed in isolation). Lint, frontend/backend
type checks and build passed. The fixture browser suite passed 200 checks across
four widths/two themes, with no axe violations. Live integrations, hosted
authorization and manual accessibility were not certified. Repeat with a clean
lockfile installation before using these results as release evidence.

## Owner tasks

Provide authorized exports and provider accounts securely; approve navigation,
supported OS versions/architectures, retention and final AI-sharing policy;
participate in desktop acceptance. Supply signing identities if public installers
require them. Multi-device sync remains out of scope for version 1.
