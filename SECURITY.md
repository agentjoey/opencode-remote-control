# Security Policy

Report vulnerabilities privately via GitHub's **[Private vulnerability
reporting](https://github.com/agentjoey/opencode-remote-control/security/advisories/new)**
(Security tab → Report a vulnerability). Please do not open public issues for
security vulnerabilities.

## Response targets
- Acknowledge within 48 hours
- Patch high-severity issues within 14 days
- Patch other issues within 30 days

## Scope
This project is single-user-per-install. The boundaries are the Telegram
allowlist (`ALLOWED_USER_IDS`) and the Web auth token (`WEB_AUTH=token`, or
Cloudflare Access). Reports about bypassing the allowlist or token, exposing the
opencode server, or leaking the Telegram bot token / web token are in scope.

Out of scope: anything in opencode itself — report those upstream.
