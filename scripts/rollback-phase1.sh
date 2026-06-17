#!/usr/bin/env bash
#
# rollback-phase1.sh — roll the running OCRC hub back to the PRE-Phase-1
# (pre-AgentBackend-seam) build, e.g. if the Phase 1 smoke test fails.
#
# Phase 1 (the AgentBackend seam) only goes live when you `npm run build` + restart
# the hub. The hub loads the plugin from `dist/` and serves the PWA from `web/dist/`,
# and `dist/` is a gitignored build artifact — so the fast rollback is simply to
# restore the known-good builds and restart. This script does the restore; you
# restart the hub afterwards.
#
# Two recovery paths:
#   1. Restore the build backups saved before the smoke test
#      (/tmp/ocrc-dist-pre-phase1, /tmp/ocrc-webdist-pre-phase1) — fast, no rebuild.
#   2. If those are gone, rebuild from the `pre-phase1` git tag (durable). Pass
#      --rebuild (or let the script fall back to it).
#
# Usage:
#   scripts/rollback-phase1.sh            # restore from /tmp backups
#   scripts/rollback-phase1.sh --rebuild  # ignore backups; rebuild from the tag
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BAK_DIST="/tmp/ocrc-dist-pre-phase1"
BAK_WEB="/tmp/ocrc-webdist-pre-phase1"
TAG="pre-phase1"
MODE="${1:-restore}"

echo "── OCRC Phase 1 rollback ─────────────────────────────────────────────"
echo "repo: $REPO"

rebuild_from_tag() {
  echo "▶ Rebuilding the pre-Phase-1 source from tag '$TAG' in an isolated worktree…"
  if ! git -C "$REPO" rev-parse "$TAG" >/dev/null 2>&1; then
    echo "✗ tag '$TAG' not found. Fetch it:  git fetch origin tag $TAG"
    exit 1
  fi
  local wt="/tmp/ocrc-rollback-$TAG"
  rm -rf "$wt"
  git -C "$REPO" worktree add --force "$wt" "$TAG" >/dev/null
  ( cd "$wt" && npm install >/dev/null 2>&1 && npm run build:all >/dev/null 2>&1 )
  stash_current
  cp -r "$wt/dist"     "$REPO/dist"
  cp -r "$wt/web/dist" "$REPO/web/dist"
  git -C "$REPO" worktree remove --force "$wt" >/dev/null 2>&1 || true
  echo "✓ restored plugin dist + web/dist rebuilt from '$TAG'"
}

stash_current() {
  local ts; ts="$(date +%Y%m%d-%H%M%S)"
  if [ -d "$REPO/dist" ];     then mv "$REPO/dist"     "/tmp/ocrc-dist-broken-$ts";    echo "→ saved current dist     → /tmp/ocrc-dist-broken-$ts"; fi
  if [ -d "$REPO/web/dist" ]; then mv "$REPO/web/dist" "/tmp/ocrc-webdist-broken-$ts"; echo "→ saved current web/dist → /tmp/ocrc-webdist-broken-$ts"; fi
}

restore_from_backup() {
  if [ ! -d "$BAK_DIST" ] || [ ! -d "$BAK_WEB" ]; then
    echo "⚠ build backups not found ($BAK_DIST / $BAK_WEB) — falling back to rebuild."
    rebuild_from_tag
    return
  fi
  stash_current
  cp -r "$BAK_DIST" "$REPO/dist"
  cp -r "$BAK_WEB"  "$REPO/web/dist"
  echo "✓ restored plugin dist + web/dist from the pre-Phase-1 backup"
}

case "$MODE" in
  --rebuild) rebuild_from_tag ;;
  *)         restore_from_backup ;;
esac

cat <<'NEXT'

── Done. Final step (this script can't do it — the hub is launched interactively) ──
  RESTART the hub from a FRESH terminal so it reloads the old dist:
    • quit the running opencode / hub, then relaunch it.

The running OCRC is now back on the pre-Phase-1 (pre-AgentBackend) build.
To re-attempt Phase 1 later:  npm run build:all  → restart.
NEXT
