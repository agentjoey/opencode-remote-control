#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST_SRC="$PROJECT_DIR/deploy/ai.opencode.remote-control.telegram.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/ai.opencode.remote-control.telegram.plist"

if ! command -v node &> /dev/null; then
  echo "node not found on PATH; install Node 20+ and retry"
  exit 1
fi
if ! command -v opencode &> /dev/null; then
  echo "opencode not found on PATH; install opencode CLI first"
  echo "  https://opencode.ai/docs/install"
  exit 1
fi

if [ ! -f "$PROJECT_DIR/dist/launcher.js" ]; then
  echo "dist/launcher.js missing — running npm run build"
  ( cd "$PROJECT_DIR" && npm run build )
fi

sed "s|PROJECT_DIR|$PROJECT_DIR|g" "$PLIST_SRC" > "$PLIST_DEST"
launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST" 2>/dev/null || launchctl load "$PLIST_DEST"

echo "Installed. Service: ai.opencode.remote-control.telegram"
echo "Logs: /tmp/opencode-remote-control-telegram.{log,err}"
echo "Stop:  launchctl bootout gui/$(id -u) $PLIST_DEST"
