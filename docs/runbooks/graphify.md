# Knowledge graph (graphify)

`graphify-out/` holds a queryable graph of the code and project documents. It is committed so a fresh clone has the graph; machine-local state (`.gate/`, `.graphify_*`, `needs_update`, dated snapshots) stays gitignored. The usage policy for AI sessions is in `CLAUDE.md`.

## What keeps it current

| Part | How it is refreshed | LLM cost |
|---|---|---|
| Code, including uncommitted edits | `graphify-watch-unitravel.service` starts a rebuild 30 seconds after files stop changing; a rebuild took 1 to 4 minutes when tested | None |
| Documents | The watcher writes `graphify-out/needs_update`. The next Claude Code session is told to run `/graphify . --update` | Yes, for changed documents only |
| The graphify tool and its skill | `graphify-upgrade.timer` runs daily and rolls back if the new version cannot answer a query | None |

Documents cannot refresh unattended: semantic extraction runs inside a Claude Code session, because no LLM API key is configured for graphify.

`.graphifyignore` keeps images, media, the booklet PDF, licence files and tool output out of the graph.

## Enforcement in Claude Code

`.claude/settings.json` holds the hooks:

- **Gate (`scripts/graphify-gate.py`):** denies Grep, Glob, reads of code files and shell searches (`grep`, `rg`, `find`, `cat`, `sed` and similar) until that session or subagent has run `graphify query`, `path` or `explain`. Each subagent must query for itself. Documents such as Markdown stay readable, and so do files outside the project. The gate allows the call if it errors, or if the graph or CLI is missing. It checks that a query command was issued, not that the agent used the answer.
- **Reminders:** `graphify hook-guard` adds suggestions to searches and reads, up to 5 per agent (`GRAPHIFY_HOOK_NUDGE_CAP`).
- **SessionStart:** runs `scripts/graphify-ops.sh status`, which prints the policy and any problem: watcher down, failed upgrade, or documents waiting.

To turn the gate off, start Claude Code with `GRAPHIFY_GATE=0`. Query markers are per agent in `graphify-out/.gate/`, and deleting them makes agents query again.

## Operations

```bash
scripts/graphify-ops.sh setup     # install and start the units; run once on a new machine
scripts/graphify-ops.sh upgrade   # upgrade now
scripts/graphify-ops.sh status    # the policy line, plus any problem
systemctl --user status graphify-watch-unitravel.service
journalctl --user -u graphify-watch-unitravel.service -n 50
journalctl --user -u graphify-upgrade.service -n 50
```

A new machine also needs `python3 -m pip install --user --break-system-packages 'graphifyy[sql]'`, `graphify install --platform claude` and a first `/graphify .` build.

## Known limits

- **Refused rebuilds:** if a rebuild would lose nodes extracted from documents that still exist, graphify refuses to overwrite the graph. The refusal appears in the watcher log and the graph stops updating. Run `/graphify . --update`.
- **Unpinned upgrades:** the daily upgrade installs whatever PyPI publishes, on the developer machine only. The rollback covers a broken release, not a malicious one. To pin a version, disable the timer with `systemctl --user disable --now graphify-upgrade.timer`.
- **Exact lookups:** the graph finds structure and relationships. Use grep for exact strings once the graph has located the area.
