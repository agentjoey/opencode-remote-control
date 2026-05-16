# Security Policy

Report security issues privately to <security-email-to-confirm>.
Please do not open public issues for security vulnerabilities.

## Response targets
- Acknowledge within 48 hours
- Patch high-severity issues within 14 days
- Patch other issues within 30 days

## Scope
This project is single-user-per-install. The bot's allowlist (`ALLOWED_USER_ID`)
is the primary boundary. Reports about bypassing the allowlist, exposing the
opencode HTTP server, or leaking the Telegram bot token are in scope.

Out of scope: anything in opencode itself — report those upstream.
