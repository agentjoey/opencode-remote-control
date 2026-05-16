#!/usr/bin/env bash
set -euo pipefail

PLIST="$HOME/Library/LaunchAgents/ai.opencode.remote-control.telegram.plist"
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "Uninstalled."
