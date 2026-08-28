#!/usr/bin/env bash
#
# BigMind database maintenance (baseline-safe: no pruning, autovacuum keeps bloat in check).
#
# - Weekly:  VACUUM (ANALYZE) to refresh planner stats and reclaim dead tuples.
# - Monthly: REINDEX the FTS GIN index, which can bloat over time.
#
# Requires a DATABASE_URL in /etc/bigmind/bigmind.env (used via the API env file),
# or set it here. The bigmind user must have access to the DB.
#
# Install with the accompanying timer:
#   sudo cp deploy/bigmind-maintenance.{service,timer} /etc/systemd/system/
#   sudo systemctl daemon-reload
#   sudo systemctl enable --now bigmind-maintenance.timer

set -euo pipefail

CONF="/etc/bigmind/bigmind.env"

if [[ -f "$CONF" ]]; then
  # shellcheck source=/dev/null
  source "$CONF"
fi

DB_URL="${DATABASE_URL:-}"

# Fall back to decomposed PG* variables if DATABASE_URL is not set.
if [[ -z "$DB_URL" ]]; then
  if [[ -z "${PGUSER:-}" || -z "${PGPASSWORD:-}" ]]; then
    echo "ERROR: set DATABASE_URL (or PGUSER/PGPASSWORD) in $CONF" >&2
    exit 1
  fi
  DB_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST:-localhost}:${PGPORT:-5432}/${PGDATABASE:-bigmind}"
fi

PSQL=(psql "$DB_URL" --set ON_ERROR_STOP=1)

echo "[bigmind-maintenance] $(date -Is) VACUUM (ANALYZE)"
"${PSQL[@]}" -c "VACUUM (ANALYZE);"

DAY_OF_MONTH="$(date +%d)"
if [[ "$DAY_OF_MONTH" == "01" ]]; then
  echo "[bigmind-maintenance] $(date -Is) REINDEX notes_search_idx"
  "${PSQL[@]}" -c "REINDEX INDEX notes_search_idx;"
fi

echo "[bigmind-maintenance] done"