# Avera guides

## Use Avera

- [Hosted website](https://avera.run): create an online account.
- [Desktop downloads](DESKTOP.md): download, verify, launch and upgrade on macOS, Windows or Linux.
- [Local setup](LOCAL_SETUP.md): clone, build and configure a source installation.
- [Backup and recovery](BACKUP_RECOVERY.md): encrypted backups, safe previews and data transfers.

## Host and operate Avera

- [Hosted website setup](HOSTED_APP_SETUP.md): Render, PostgreSQL, private storage, DNS and recovery.
- [Connected services](CONNECTED_SERVICES.md): credentials, consent and provider data sharing.
- [Gateway setup](GATEWAY_SETUP.md): run the provider gateway separately from the website.
- [Geocodio setup](GEOCODIO_SETUP.md): location lookup for job search.
- [MCP](MCP.md): optional read-only OAuth client access to your financial application.

## Develop Avera

- [Contributing](../CONTRIBUTING.md): development commands, architecture and checks.
- [Tests](../tests/README.md): unit, real storage, browser and desktop validation.
- [Design system](DESIGN.md): colors, navigation and accessibility conventions.
- [Security](../SECURITY.md): vulnerability reporting and credential handling.

Start with one installation guide. Desktop packages use `installation.env` in their
private data home; source installations load `.env.local`; hosted services use
backend environment variables and secret files. These locations are not interchangeable.
