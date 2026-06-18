#!/usr/bin/env bash
# Run the standalone ACP host — OCRC against a spawned ACP agent (kimi/gemini/…),
# no opencode. Config comes from .env.acp (overrides) layered over .env.
# See .env.acp.example. Usage: scripts/run-acp-host.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# Build if the host bundle is missing.
if [ ! -f dist/cli/host.js ]; then
  echo "→ building (dist/cli/host.js missing)…"
  npm run build
fi

# Layer .env.acp overrides on top of the process env (these win over .env, which
# the host loads via dotenv with override:false). Secrets live in .env.acp only.
if [ -f .env.acp ]; then
  set -a; . ./.env.acp; set +a
else
  echo "⚠  no .env.acp found — copy .env.acp.example to .env.acp and fill it in."
fi

: "${OCRC_ACP_CMD:=kimi acp}"
export OCRC_ACP_CMD

echo "→ starting ACP host: agent='${OCRC_ACP_CMD}' web=:${WEB_PORT:-?} telegram=$([ -n "${TELEGRAM_BOT_TOKEN:-}" ] && echo on || echo off)"
exec node dist/cli/index.js host
