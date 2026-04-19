"""PreToolUse hook: inspect Bash commands and block writes/reads targeting
sensitive paths (credentials, private keys, env files, etc).

Reads a Claude Code hook JSON payload from stdin and, on match, writes a
PreToolUse "deny" decision JSON to stdout. On no match, exits 0 silently
so the normal permission flow continues.

Fail-safe policy: if the payload is malformed or anything raises, the
script exits 0 (permissive). Hard denial is handled by the existing
permissions.deny rules; this hook is an additional best-effort layer.
"""

from __future__ import annotations

import json
import re
import sys

# Word-boundary tail used after path fragments whose extension/name must be
# a whole token (e.g. ".env" should not match "README.env.md").
_TAIL = r'(?:[\s"\'<>|&;]|$)'

# Boundary that must precede a command name so "grep" doesn't match inside
# "foogrep".
_HEAD = r'(?:^|[\s|&;])'

# Negative look-behind that prevents matching when the token is preceded
# by an identifier character. Keeps "README.env.md" from matching ".env".
_NOT_IDENT = r'(?<![A-Za-z0-9_])'

# Sensitive-path patterns. Each entry is a single regex alternative; the
# full regex is the OR of all of these.
_SENSITIVE_PATTERNS = [
    # .env, .env.production, .env.local, etc. — must end at a token boundary
    _NOT_IDENT + r'\.env(?:\.[A-Za-z0-9_-]+)?' + _TAIL,

    # Config directories under any root (relative, absolute, or ~)
    r'(?:^|[/~])\.ssh/',
    r'(?:^|[/~])\.aws/',
    r'(?:^|[/~])\.gnupg/',
    r'(?:^|[/~])\.docker/',
    r'(?:^|[/~])\.config/gcloud/',

    # Single-file dotfiles
    r'(?:^|[/~])\.netrc' + _TAIL,
    r'(?:^|[/~])\.npmrc' + _TAIL,

    # Key / certificate extensions — no _NOT_IDENT since any filename
    # may legitimately end in .pem/.key (e.g. "server.pem").
    r'\.pem' + _TAIL,
    r'\.key' + _TAIL,

    # Common private key filenames
    _NOT_IDENT + r'id_rsa' + _TAIL,
    _NOT_IDENT + r'id_ed25519' + _TAIL,
    _NOT_IDENT + r'id_ecdsa' + _TAIL,

    # Credentials files
    _NOT_IDENT + r'credentials(?:\.json|\.csv)?' + _TAIL,
]

SENSITIVE = '(?:' + '|'.join(_SENSITIVE_PATTERNS) + ')'

# Each rule: (description, compiled regex). First match wins.
RULES = [
    (
        "機密パスへのリダイレクト書き込み (>, >>) を検出しました",
        re.compile(r'>>?\s*[^|;&]*' + SENSITIVE),
    ),
    (
        "tee による機密パスへの書き込みを検出しました",
        re.compile(_HEAD + r'tee(?:\s+-[aA])?\s+[^|;&]*' + SENSITIVE),
    ),
    (
        "sed -i による機密ファイルの改変を検出しました",
        re.compile(_HEAD + r'sed\s+[^|;&]*-i[^|;&]*' + SENSITIVE),
    ),
    (
        "cp/mv/rm/install/ln による機密パスの操作を検出しました",
        re.compile(
            _HEAD
            + r'(?:cp|mv|rm|install|ln)(?:\s+-[A-Za-z]+)*\s+[^|;&]*'
            + SENSITIVE
        ),
    ),
    (
        "機密ファイルの読み取りを検出しました",
        re.compile(
            _HEAD
            + r'(?:cat|less|more|head|tail|xxd|od|strings|hexdump|bat|type)'
            + r'(?:\s+-[A-Za-z]+)*\s+[^|;&]*'
            + SENSITIVE
        ),
    ),
]

# printenv / bare env rule handled separately because it must allow the
# "env VAR=value cmd" prefix form.
_ENV_DUMP = re.compile(_HEAD + r'(?:printenv|env)(?=\s|$|[|&;])')
_ENV_PREFIX_USAGE = re.compile(
    _HEAD + r'env\s+[A-Za-z_][A-Za-z0-9_]*='
)


def deny(reason: str) -> None:
    payload = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }
    # ensure_ascii=True to avoid Windows cp932 mojibake on stdout.
    json.dump(payload, sys.stdout, ensure_ascii=True)
    sys.exit(0)


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return

    cmd = (data.get("tool_input") or {}).get("command") or ""
    if not cmd:
        return

    for reason, pattern in RULES:
        if pattern.search(cmd):
            deny(reason)

    if _ENV_DUMP.search(cmd) and not _ENV_PREFIX_USAGE.search(cmd):
        deny("環境変数の一括出力 (printenv/env) を検出しました")


if __name__ == "__main__":
    main()
