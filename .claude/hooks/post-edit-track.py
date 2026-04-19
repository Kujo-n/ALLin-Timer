"""PostToolUse hook: append the file path just written/edited to a
session-local pending list so the Stop hook can format the batch.

Fail-safe policy: exits 0 silently on any error.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0

    cwd_raw = data.get("cwd") or "."
    try:
        cwd = Path(cwd_raw).resolve()
    except Exception:
        return 0

    tool_input = data.get("tool_input") or {}
    file_path = tool_input.get("file_path")
    if not isinstance(file_path, str) or not file_path:
        return 0

    pending_dir = cwd / "tmp"
    try:
        pending_dir.mkdir(exist_ok=True)
        pending_file = pending_dir / ".claude-format-pending.txt"
        with pending_file.open("a", encoding="utf-8") as f:
            f.write(file_path + "\n")
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())