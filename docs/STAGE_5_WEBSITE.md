# Stage 5: website navigation and sample workspaces

The independent application now has a single landing page at `/welcome` (visitors
opening `/` arrive there). **Get started** opens personal finances for a signed-in
owner or account creation for a visitor. **Try sample data** is a secondary
control that reveals the three scenarios on that same page. There is no separate
demo landing page. The established forest, cream and dark-theme tokens are kept.

The website header links directly to Overview, Bills & Budget, Yearly Plan,
Opportunities, Properties, Ask Avera and Settings. Smaller screens use one Menu
with those same destinations. A footer links to preferences/privacy. The former
fixed sidebar and bottom app bar are replaced. Page titles, route focus and a
keyboard skip link identify the current destination. Bills/Budget/Goals/
Transactions use shareable `?tab=` links (including the empty transactions view); the overview goal shortcut opens Goals.

## Sample and personal behavior

- A small, always-visible sample label names the active scenario. Its disclosure
  contains Change scenario, Reset sample scenario and Return to personal finances.
- Leaving or changing scenarios keeps saved records. Reset is a separate,
  confirmed action and replaces only that owner/scenario. It covers forecasts,
  dismissals and contributions as well as the seeded finance records.
- A database manifest distinguishes an initialized but emptied scenario from one
  that has never been loaded. Existing legacy sample records are adopted on first
  selection. A legacy scenario emptied before manifests existed cannot be
  distinguished from a never-loaded scenario and will be initialized once.
- Selection/reset runs in one SQLite/PostgreSQL transaction. The selected
  preference changes only after success. A failed reset rolls back both deleted
  records and new records, including revisions/change tracking. Concurrent first
  loads for one owner serialize without creating duplicate scenarios.
- The mode and selected scenario are one owner-scoped browser preference. Legacy
  preferences migrate on first read. A storage event updates other tabs. Financial
  records remain in SQLite/PostgreSQL, never browser localStorage.
- Changing dataset remounts the dataset-dependent shell, forms, chart data and
  conversations; pending requests and query caches are cleared. Responses and
  selections that complete after a dataset/account change are rejected. Browser
  preference synchronization between tabs is not multi-device record sync.
- A scenario with an attached test-bank connection can be resumed. Disconnect its
  test bank in Settings before resetting it. The gateway/provider operations are
  retained. Plaid Sandbox controls live in an advanced Settings disclosure.

## Account-free samples

A visitor gets a random, private HttpOnly sample session and an isolated owner;
there is no shared guest dataset. No email, password, bank account or provider
key is required. An additional HttpOnly cookie remembers the sample session when
returning to the landing page. It expires within eight hours (sign-out/idle expiry
can end it earlier). Expired guest-only data is pruned on subsequent guest entry.
Guest records are not a permanent personal workspace and are not transferred to a
newly created account. Registered owners retain their saved sample scenarios.

The server rejects guest personal-data creation and connected services, profile
changes, feedback and AI consent. Guest sample CRUD, deterministic planning and
sample goal contributions remain available. AI and current job-search screens
explain the account requirement. Existing accounts retain their current provider
consent, bank tokens, email verification/recovery and integration settings.

This is implemented by the independent HTTP adapter/server. The historical
Base44 compatibility adapter still requires authentication and retains its older
advanced seeding path; it is not certified for atomic sample reset or guest entry.
The independent build does not invoke that path for basic samples.

## Navigation acceptance paths

Counts start from a loaded Overview, excluding registration and text entry.

| Information/action | Desktop | Smaller screens |
| --- | --- | --- |
| Upcoming bills / yearly plan / properties / Ask Avera | destination link: 1 | Menu + destination: 2 |
| Budget, goals or transactions | Bills & Budget + tab: 2 | Menu + Bills & Budget + tab: 3 |
| Edit a bill/category/goal | destination + tab when needed + edit: up to 3 | Menu + destination + tab + edit: up to 4 |
| Bank status | Settings + advanced testing disclosure: 2 | Menu + Settings + disclosure: 3 |
| Switch from sample to personal | sample options + Return: 2 | same: 2 |
| Start a sample from landing | Try sample data + scenario: 2 | same: 2 |

Browser checks exercise these controls, keyboard skip/focus behavior, overflow,
light/dark themes and 320/390/768/1440 CSS-pixel widths. Automated axe checks target
WCAG 2.2 AA tags. They do not establish complete WCAG conformance. Manual screen
reader, actual browser zoom, touch-device and Windows/macOS acceptance remain
release gates; Linux automated keyboard/reflow checks supplement them.

## Upgrade and rollback

1. Stop the local application. Make a private offline copy of its existing data
   directory, including the SQLite database and any WAL/SHM files, attachments and
   vault key. Keep that backup outside the checkout. Do not copy a running SQLite
   database. Hosted operators should take a provider snapshot before upgrading.
   Automated encrypted recovery remains Stage 6 work.
2. After CI/review, update the local checkout, run `npm ci --ignore-scripts`, then
   `npm run build:local` and restart `npm run start:local`.
3. Startup applies migration 3, adding only the sample-workspace manifest table.
   No provider keys or new subscriptions are required. The headless Render gateway
   does not serve the landing page; the sample API runs on the installation's
   application server. Existing gateway integration calls are unchanged.
4. Refresh the browser. Try guest sample entry in a private browser window, then
   verify your signed-in personal data is unchanged when switching samples on/off.
   Test changing scenarios, reloading and opening a second tab. Reset only sample
   data you intend to replace.
5. Older servers reject schema version 3. To roll back, stop the new application
   and restore the matching pre-upgrade data backup with the prior application
   version. Do not remove a migration number or manually retag financial records.

No Base44 cancellation, real-data migration, public deployment or multi-device
synchronization is part of this stage. Stage 6 covers migration, portable encrypted
backup and guided restoration; Stage 7 covers distribution and the Base44 exit.
