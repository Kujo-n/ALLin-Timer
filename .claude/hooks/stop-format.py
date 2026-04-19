"""Stop hook: read the pending-format list and run prettier on all files
collected during this turn, then clear the list.

Only formats files Claude touched this turn (tracked by post-edit-track.py),
never the entire working tree — so existing un-formatted files stay untouched
until they are edited.

Fail-safe policy: exits 0 silently on any error.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

PRETTIER_EXTS = {
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
    ".md",
    ".css",
    ".scss",
    ".html",
    ".yml",
    ".yaml",
}

CHUNK_SIZE = 200
PRETTIER_TIMEOUT_SEC = 90


def _load_pending(pending_file: Path, cwd: Path) -> list[str]:
    try:
        raw = pending_file.read_text(encoding="utf-8")
    except Exception:
        return []

    seen: set[str] = set()
    out: list[str] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        p = Path(line)
        if not p.is_absolute():
            p = cwd / p
        try:
            resolved = p.resolve()
            rel = resolved.relative_to(cwd)
        except (OSError, ValueError):
            continue
        if resolved.suffix.lower() not in PRETTIER_EXTS:
            continue
        if not resolved.exists():
            continue
        rel_posix = str(rel).replace("\\", "/")
        if rel_posix in seen:
            continue
        seen.add(rel_posix)
        out.append(rel_posix)
    return out


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

    pending_file = cwd / "tmp" / ".claude-format-pending.txt"
    if not pending_file.exists():
        return 0

    targets = _load_pending(pending_file, cwd)

    try:
        pending_file.unlink()
    except Exception:
        pass

    if not targets:
        return 0

    try:
        for i in range(0, len(targets), CHUNK_SIZE):
            chunk = targets[i : i + CHUNK_SIZE]
            subprocess.run(
                [
                    "npx",
                    "--no-install",
                    "prettier",
                    "--write",
                    "--log-level",
                    "warn",
                    *chunk,
                ],
                capture_output=True,
                text=True,
                cwd=cwd,
                timeout=PRETTIER_TIMEOUT_SEC,
                check=False,
            )
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())