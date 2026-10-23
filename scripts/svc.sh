#!/usr/bin/env bash
# Start/stop local processes with pid files: scripts/svc.sh start|stop|restart api|worker|web|console|mobile
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="${SVC_RUN_DIR:-$ROOT/.run}"
mkdir -p "$RUN"
cmd_for() {
  case "$1" in
    api) echo "cd $ROOT/apps/api && exec node --env-file=$ROOT/.env dist/main.api.js" ;;
    worker) echo "cd $ROOT/apps/api && exec node --env-file=$ROOT/.env dist/main.worker.js" ;;
    web) echo "cd $ROOT/apps/web && exec node_modules/.bin/next start --port 4000" ;;
    console) echo "cd $ROOT/apps/console && exec node_modules/.bin/next start --port 4200" ;;
    mobile) echo "cd $ROOT/apps/mobile/build/web && exec python3 -m http.server 4300" ;;
    *) echo "unknown service $1" >&2; exit 2 ;;
  esac
}
stop() {
  local f="$RUN/$1.pid"
  if [[ -f "$f" ]]; then kill "$(cat "$f")" 2>/dev/null || true; rm -f "$f"; fi
}
start() {
  stop "$1"
  nohup bash -c "$(cmd_for "$1")" > "$RUN/$1.log" 2>&1 &
  echo $! > "$RUN/$1.pid"
}
action="$1"; shift
for s in "$@"; do
  case "$action" in
    start) start "$s" ;;
    stop) stop "$s" ;;
    restart) stop "$s"; start "$s" ;;
  esac
done
