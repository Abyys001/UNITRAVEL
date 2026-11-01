#!/usr/bin/env python3
"""Claude Code PreToolUse gate: each session and subagent must query the graph first.

Denies code searches and code reads until that agent has run `graphify query`,
`path` or `explain`. Any error, or a missing graph or CLI, allows the call, so a
fault here can never strand a session. See docs/runbooks/graphify.md.
"""
import hashlib
import json
import os
import re
import shutil
import sys
from pathlib import Path

CODE_EXTS = {
    ".cjs", ".css", ".dart", ".html", ".js", ".json", ".jsx", ".kt", ".mjs", ".py",
    ".sh", ".sql", ".swift", ".ts", ".tsx", ".yaml", ".yml",
}
EXEMPT_DIRS = {".claude", ".git", "graphify-out", "node_modules"}
QUERY = re.compile(r"\bgraphify\s+(query|path|explain)\b")
SEARCH_COMMANDS = {"ack", "ag", "awk", "cat", "find", "grep", "head", "less", "rg", "sed", "tail"}
SEPARATOR = re.compile(r"\|\||&&|[;|\n(]")
PREFIX = re.compile(r"^(?:\w+=\S*\s+|(?:rtk|proxy|sudo|command|xargs)\s+|timeout\s+\S+\s+)*")
REASON = (
    "UniTravel policy: run `graphify query \"<your question>\"` (or `graphify path \"A\" \"B\"`, "
    "`graphify explain \"X\"`) in the Bash tool before searching or reading code. This applies "
    "once to each session and subagent. Then retry this call."
)


def agent_marker(root: Path, payload: dict) -> Path:
    # Subagents share the parent's session id but start with an empty context.
    identity = f'{payload.get("session_id", "")}:{payload.get("agent_id", "")}'
    name = hashlib.sha256(identity.encode()).hexdigest()[:32]
    return root / "graphify-out" / ".gate" / name


def runs_search(command: str) -> bool:
    for segment in SEPARATOR.split(command):
        words = PREFIX.sub("", segment.strip()).split()
        if not words:
            continue
        if os.path.basename(words[0]) in SEARCH_COMMANDS:
            return True
        if words[:2] == ["git", "grep"]:
            return True
    return False


def targets_code(path_text: str, root: Path) -> bool:
    path = Path(path_text)
    if not path.is_absolute():
        path = root / path
    try:
        relative = path.resolve().relative_to(root)
    except (OSError, ValueError):
        return False
    if EXEMPT_DIRS.intersection(relative.parts):
        return False
    return path.suffix.lower() in CODE_EXTS


def should_gate(tool: str, tool_input: dict, root: Path) -> bool:
    if tool == "Grep":
        return True
    if tool == "Bash":
        return runs_search(str(tool_input.get("command") or ""))
    if tool == "Read":
        return targets_code(str(tool_input.get("file_path") or ""), root)
    if tool == "Glob":
        target = str(tool_input.get("path") or ".")
        try:
            return not EXEMPT_DIRS.intersection(Path(target).resolve().relative_to(root).parts)
        except (OSError, ValueError):
            return False
    return False


def main() -> None:
    if os.environ.get("GRAPHIFY_GATE") == "0":
        return
    payload = json.load(sys.stdin)
    root = Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()).resolve()
    if not (root / "graphify-out" / "graph.json").is_file() or not shutil.which("graphify"):
        return
    tool = payload.get("tool_name", "")
    tool_input = payload.get("tool_input") or {}
    marker = agent_marker(root, payload)
    if tool == "Bash" and QUERY.search(str(tool_input.get("command") or "")):
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.touch()
        return
    if marker.exists() or not should_gate(tool, tool_input, root):
        return
    json.dump(
        {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": REASON,
            }
        },
        sys.stdout,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
