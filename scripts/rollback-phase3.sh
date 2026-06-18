#!/usr/bin/env bash
#
# rollback-phase3.sh — abandon Phase 3 (multi-backend) and return to the verified
# Phase 2 state (tag `pre-phase3`, the AcpBackend + standalone host release).
#
# Phase 3 is developed on the `phase3-multi-backend` branch and is NOT merged to
# main until verified, so the primary rollback is simply: don't merge, stay on
# main. This script is the belt-and-suspenders path if Phase 3 was already merged
# or you want to hard-reset a working tree.
#
# The running opencode hub only changes when you `npm run build` + restart it; the
# standalone ACP host only runs when you launch it. Neither auto-updates, so a
# rollback is: restore source to `pre-phase3`, rebuild, restart whatever you run.
#
# Usage:
#   scripts/rollback-phase3.sh           # show how to roll back (safe, no changes)
#   scripts/rollback-phase3.sh --hard    # hard-reset current branch to pre-phase3 + rebuild
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAG="pre-phase3"
MODE="${1:-dry}"

cd "$REPO"
echo "── OCRC Phase 3 rollback ─────────────────────────────────────────────"
echo "repo: $REPO"
echo "rollback target: tag $TAG = $(git rev-parse --short "$TAG" 2>/dev/null || echo '??? (tag missing)')"
echo

if [ "$MODE" != "--hard" ]; then
  cat <<EOF
Safe rollback (recommended) — Phase 3 lives on its own branch, main is untouched:

  git checkout main          # main is still at pre-phase3 (Phase 2, verified)
  npm run build:all          # rebuild dist + web from the clean state
  # restart the hub / relaunch the ACP host as usual

If Phase 3 was already MERGED to main and you want it gone:

  scripts/rollback-phase3.sh --hard

This dry run made NO changes.
EOF
  exit 0
fi

echo "!! --hard: resetting the CURRENT branch ($(git rev-parse --abbrev-ref HEAD)) to $TAG"
echo "   uncommitted changes will be lost. Ctrl-C within 5s to abort."
sleep 5
git reset --hard "$TAG"
echo "→ rebuilding (build:all)…"
npm run build:all
echo "✓ rolled back to $TAG and rebuilt. Restart the hub / relaunch the ACP host."
