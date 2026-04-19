"""PreToolUse hook for Write / Edit / MultiEdit: scan the content being
written for high-confidence secret patterns and deny the write on match.

Public repo defense-in-depth: blocks obvious hard-coded secrets before they
ever reach disk. Complements settings.local.json deny rules (which only
block by file path) and guard-bash.py (which only covers Bash).

High-confidence patterns only — false positives are more disruptive than
occasional misses, and settings.local.json + .env.local already cover the
baseline. To bypass for a legitimate case, temporarily disable the hook in
.claude/settings.local.json.

Fail-safe policy: exits 0 (permissive) on any error.
"""

from __future__ import annotations

import json
import re
import sys

# (pattern, label) — keep patterns tight to minimise false positives.
_RAW_PATTERNS: list[tuple[str, str]] = [
    (r"-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----", "Private key block"),
    (r"\bAKIA[0-9A-Z]{16}\b", "AWS access key ID"),
    (r"\bASIA[0-9A-Z]{16}\b", "AWS temporary access key ID"),
    (r"\bghp_[A-Za-z0-9]{36,}\b", "GitHub personal access token"),
    (r"\bgithub_pat_[A-Za-z0-9_]{22,}\b", "GitHub fine-grained PAT"),
    (r"\bgho_[A-Za-z0-9]{36,}\b", "GitHub OAuth token"),
    (r"\bghs_[A-Za-z0-9]{36,}\b", "GitHub server-to-server token"),
    (r"\bsk_(?:live|test)_[A-Za-z0-9]{24,}\b", "Stripe secret key"),
    (r"\"type\"\s*:\s*\"service_account\"", "GCP service account JSON"),
    (r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b", "Slack token"),
    (r"\bAIza[0-9A-Za-z\-_]{35}\b(?=[^\"']*\"\s*,?\s*\n[^\n]*(?:private_key|client_email))",
     "Google API key in service account context"),
]

_COMPILED = [(re.compile(p, re.MULTILINE), label) for p, label in _RAW_PATTERNS]


def _extract_text(tool_input: dict) -> str:
    parts: list[str] = []
    if isinstance(tool_input.get("content"), str):
        parts.append(tool_input["content"])
    if isinstance(tool_input.get("new_string"), str):
        parts.append(tool_input["new_string"])
    edits = tool_input.get("edits")
    if isinstance(edits, list):
        for e in edits:
            if isinstance(e, dict) and isinstance(e.get("new_string"), str):
                parts.append(e["new_string"])
    return "\n".join(parts)


def _emit_deny(reason: str) -> None:
    payload = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }
    # ensure_ascii=True to avoid Windows cp932 mojibake on stdout.
    json.dump(payload, sys.stdout, ensure_ascii=True)


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0

    tool_input = data.get("tool_input") or {}
    if not isinstance(tool_input, dict):
        return 0

    try:
        text = _extract_text(tool_input)
    except Exception:
        return 0
    if not text:
        return 0

    matches: list[str] = []
    for rx, label in _COMPILED:
        try:
            if rx.search(text):
                matches.append(label)
        except Exception:
            continue

    if not matches:
        return 0

    reason = (
        "Secret-like content detected in write payload and blocked by "
        "pre-write-secret-scan hook. "
        "Matched patterns: " + ", ".join(matches) + ". "
        "If this is a false positive, rephrase the content or store the "
        "value in .env.local / Vercel env and reference it at runtime."
    )
    try:
        _emit_deny(reason)
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())