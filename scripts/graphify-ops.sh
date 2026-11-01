#!/usr/bin/env bash
# Keeps the UniTravel knowledge graph and the graphify tool current.
#   setup    install and start the systemd user units
#   upgrade  move graphify to the newest release, rolling back if it cannot query
#   status   print the policy and anything needing attention (Claude Code SessionStart hook)
# See docs/runbooks/graphify.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$HOME/.local/bin/graphify"
WATCH=graphify-watch-unitravel.service
UPGRADE=graphify-upgrade

package_version() { "$BIN" --version | awk '{print $2}'; }
pip_install() { python3 -m pip install --quiet --user --break-system-packages "$@"; }

setup() {
  local units="$HOME/.config/systemd/user"
  mkdir -p "$units"
  cat > "$units/$WATCH" <<EOF
[Unit]
Description=Rebuild the UniTravel knowledge graph when code changes

[Service]
WorkingDirectory=$ROOT
Environment=PYTHONUNBUFFERED=1
Nice=15
IOSchedulingClass=idle
# The watcher only sees live events, so catch up on anything edited while it was down.
ExecStartPre=-$BIN update .
ExecStart=/usr/bin/python3 -m graphify.watch $ROOT --debounce 30
TimeoutStartSec=900
Restart=on-failure
RestartSec=60

[Install]
WantedBy=default.target
EOF
  cat > "$units/$UPGRADE.service" <<EOF
[Unit]
Description=Upgrade graphify to the newest release

[Service]
Type=oneshot
ExecStart=$ROOT/scripts/graphify-ops.sh upgrade
EOF
  cat > "$units/$UPGRADE.timer" <<EOF
[Unit]
Description=Daily graphify upgrade

[Timer]
OnCalendar=daily
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now "$WATCH" "$UPGRADE.timer"
}

upgrade() {
  local before after
  before="$(package_version)"
  pip_install --upgrade 'graphifyy[sql]'
  after="$(package_version)"
  if [[ "$before" != "$after" ]]; then
    if ! (cd "$ROOT" && "$BIN" query "session" --budget 100 >/dev/null); then
      echo "graphify $after failed its query check; restoring $before" >&2
      pip_install "graphifyy[sql]==$before"
      exit 1
    fi
    echo "graphify upgraded: $before -> $after"
  fi
  # The skill is versioned separately from the package, so refresh it on every run.
  "$BIN" install --platform claude >/dev/null
  if [[ "$before" != "$after" ]]; then
    systemctl --user try-restart "$WATCH"
  fi
}

status() {
  command -v "$BIN" >/dev/null || { echo "graphify: not installed at $BIN."; return 0; }
  echo "graphify is mandatory here: run \`graphify query \"<question>\"\` before searching or reading code, and tell every subagent to do the same. Code searches and reads are denied until this agent has queried."
  systemctl --user is-active --quiet "$WATCH" ||
    echo "graphify: the graph watcher is not running, so the graph may be stale. Run scripts/graphify-ops.sh setup."
  if systemctl --user is-failed --quiet "$UPGRADE.service"; then
    echo "graphify: the last automatic upgrade failed. See: journalctl --user -u $UPGRADE.service"
  fi
  if [[ -f "$ROOT/graphify-out/needs_update" ]]; then
    echo "graphify: documents changed since the last semantic extraction. Run /graphify . --update, then rm graphify-out/needs_update. Skip this if graphify-out/.graphify_chunk_* files exist, because another session is already doing it."
  fi
}

case "${1:-}" in
  setup) setup ;;
  upgrade) upgrade ;;
  status) status ;;
  *) echo "usage: $0 setup|upgrade|status" >&2; exit 2 ;;
esac
