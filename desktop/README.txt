AVERA DESKTOP — STAGE 7 PREVIEW

Install Node.js 22.18 or newer supported LTS from https://nodejs.org first.
This package includes the built website, backend and runtime JavaScript libraries.
It does not require npm install, a build, Base44 access or a provider key to use
manual finances and samples. This is not a signed installer and does not bundle Node.

Extract the whole package into a new folder. Do not run from inside an archive.
Windows: double-click Start Avera.cmd.
macOS: open Start Avera.command (your OS may ask you to approve a downloaded script).
Linux: run sh start-avera.sh.
All systems: node scripts/desktop-launcher.mjs
Use --no-browser to open the displayed loopback URL yourself. Leave the terminal
open; press Ctrl+C to stop. Avera listens only on your own computer.

User data lives separately from the application:
Windows: %APPDATA%\Avera
macOS: ~/Library/Application Support/Avera
Linux: $XDG_DATA_HOME/avera or ~/.local/share/avera
AVERA_HOME may select another absolute path on a writable private drive.
Back up this folder and keep vault/recovery keys separately and securely.
The package folder is replaceable. Never overwrite your data folder with a release.

The first start creates installation.env in the data folder. Configure your HTTPS
AVERA_GATEWAY_URL and unique AVERA_GATEWAY_TOKEN there for connected services;
never put shared provider keys into a downloadable package. Restart after editing.
Local storage does not make AI/bank/job services local; those need connectivity.
The gateway is the default; multi-device sync is not enabled.

UPGRADE / EXISTING INSTALLATION
Keep an encrypted portable backup and the original key files before changing apps.
Stop the previous app. Extract the new package into a new folder and use the same
AVERA_HOME. Existing repository installations use different default paths: either
restore an encrypted backup into a new account, or explicitly configure absolute
AVERA_SQLITE_PATH, AVERA_FILES_PATH, AVERA_VAULT_KEY_PATH, AVERA_BACKUP_DIR and
AVERA_BACKUP_KEY_PATH for the existing installation. Preserve every original key
and your gateway grant. Selecting a new path does not migrate data.
Verify counts/totals after an upgrade; leave the old app and backup available.

CHECKS / RECOVERY
node scripts/verify-desktop.mjs checks packaged-file hashes against its manifest.
Hashes detect changes, not publisher identity; obtain packages from your trusted
repository's CI artifacts and verify the published archive checksum as well.
Settings > Backups & recovery exports encrypted portable backups and previews
restoration with a verified safety copy. Keep the passphrase off-device separately.
Remote bank authorizations do not transfer. Review restored bank history before
reconnecting to prevent overlapping imports. Full disaster recovery also requires
separately retained credentials/keys and a hosted database backup where applicable.

This preview requires real Windows/macOS/Linux acceptance before public release.
Base44 cancellation, public installers/signing, and inbound MCP replacement and
client acceptance remain separate release gates. Keep the original service until
all gates are accepted. No live financial data or credentials are in this package.

Third-party runtime libraries retain their bundled licenses. Frontend attribution
is in dist-local/third-party-notices.txt. After a crash, confirm Avera is stopped
before removing a stale desktop.lock from the private data home.
