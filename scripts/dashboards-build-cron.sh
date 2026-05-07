#!/usr/bin/env bash
# Wrapper invoked by ~/Library/LaunchAgents/com.nickcherry.alea.dashboards-build.plist.
# Re-runs `bun alea dashboards:build --deploy` on a schedule so the live trading
# dashboard at https://alea.nickcherryjiggz.workers.dev/ stays fresh without manual
# pushes. Logs to tmp/cron-dashboards-build.log next to the repo.
#
# launchd auto-skips overlapping runs (next StartInterval tick is dropped if the
# prior invocation is still active), so a slow build can't double-fire. Dashboard
# builds typically finish in 30–60s; the 5-minute interval has plenty of headroom.

set -euo pipefail

REPO_ROOT="/Users/nickcherry/src/alea"
LOG_FILE="${REPO_ROOT}/tmp/cron-dashboards-build.log"
BUN_BIN="/Users/nickcherry/.bun/bin/bun"

cd "${REPO_ROOT}"
mkdir -p "$(dirname "${LOG_FILE}")"

# Load .env if present so the build picks up POLYMARKET_PRIVATE_KEY,
# POLYMARKET_FUNDER_ADDRESS, DATABASE_URL, etc. `set -a` auto-exports each var
# the file defines; `set +a` flips it back so anything we set later isn't
# accidentally exported.
if [[ -f "${REPO_ROOT}/.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "${REPO_ROOT}/.env"
  set +a
fi

export PATH="$(dirname "${BUN_BIN}"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:${PATH:-}"

{
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) start ==="
  "${BUN_BIN}" alea dashboards:build --deploy
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) end ==="
  echo
} >>"${LOG_FILE}" 2>&1
