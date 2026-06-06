"""PreToolUse hook: nudge Claude off `npx <tool>` toward the locally-installed
binary, without the hook itself rewriting the command.

Motivation
----------
Claude Code frequently reaches for `npx <tool>`. Because `npx` can trigger a
package download, `Bash(npx*)` sits in the permissions `ask` list and stalls
automated work for approval. In practice the tool is almost always already
present in the project's `node_modules/.bin`, so the npx download never happens.

Design (Plan A — "detect & advise", chosen by the user)
-------------------------------------------------------
This hook does NOT rewrite the command (shell pipelines / redirections make
mechanical rewriting risky). Instead:

  1. It scans the command for `npx <tool>` invocations.
  2. For any tool that is ALREADY installed under the nearest `node_modules/.bin`
     (and is not on the exclusion list), it returns `permissionDecision: "deny"`
     with a reason that instructs Claude to re-run the command with `npx <tool>`
     replaced by `./node_modules/.bin/<tool>`, preserving any pipes / redirects.
  3. Claude rewrites the (possibly compound) command itself and re-issues it.
     The rewritten `./node_modules/.bin/<tool> ...` invocation is then approved
     NATIVELY by the permissions allow rule `Bash(./node_modules/.bin/*)` —
     Claude Code decomposes compound commands and evaluates each sub-command
     independently, so pipelines stay safe (every segment must be allowed and
     any `deny` match still wins).
  4. If the tool is NOT installed locally, the hook stays silent (exit 0, no
     output) so the normal permission flow runs — the user approves the `npx`
     install once, after which the binary is present and auto-resolved.

Why no rewriting / no self-`allow` here:
  - The hook never parses or reconstructs the pipeline, so it can't corrupt it.
  - Permission for the rewritten form lives in settings.json (allow
    `Bash(./node_modules/.bin/*)`, deny the sensitive ones below), which is the
    single, auditable security boundary — not scattered into hook logic.

Exclusions (must keep going through normal approval):
  - playwright / playwright-core: bare `test` runs are gated by guard-bash.py
    (production Firebase write protection) and by the deny rule
    `Bash(./node_modules/.bin/playwright*)`. Legit e2e goes via `npm run test:e2e`.
  - firebase / firebase-tools / vercel: deploy/auth are intentionally `ask`,
    backed by deny rules `Bash(./node_modules/.bin/{firebase,vercel}*)`.

Fail-safe policy: on any parse error / unexpected input the hook exits 0 with
no output (permissive: falls through to the normal permission flow).
"""

from __future__ import annotations

import json
import os
import shlex
import sys

EXCLUDED_TOOLS = {
    "playwright",
    "playwright-core",
    "firebase",
    "firebase-tools",
    "vercel",
}

# npx boolean flags (no value) that may appear before the tool name.
_NPX_BOOL_FLAGS = {
    "-y",
    "--yes",
    "--no",
    "--no-install",
    "--offline",
    "--prefer-offline",
    "--prefer-online",
    "--ignore-existing",
    "-q",
    "--quiet",
}


def _find_local_bin(tool: str, start_dir: str) -> str | None:
    """Walk up from start_dir looking for node_modules/.bin/<tool> (the
    extensionless shell-script wrapper that bash can execute). Return the
    found path, or None."""
    cur = os.path.abspath(start_dir)
    while True:
        candidate = os.path.join(cur, "node_modules", ".bin", tool)
        if os.path.isfile(candidate):
            return candidate
        parent = os.path.dirname(cur)
        if parent == cur:
            return None
        cur = parent


def _scan_npx_tools(tokens: list[str]) -> list[str]:
    """Tool names invoked via `npx <tool>` anywhere in the token stream.

    Conservative: an occurrence whose npx flags are value-taking / unknown, or
    whose tool is version-pinned (`pkg@1`) or scoped (`@scope/pkg`), is skipped
    so we never advise rewriting an ambiguous invocation."""
    tools: list[str] = []
    n = len(tokens)
    for idx, tok in enumerate(tokens):
        if tok != "npx":
            continue
        j = idx + 1
        ok = True
        while j < n and tokens[j].startswith("-"):
            if tokens[j] in _NPX_BOOL_FLAGS:
                j += 1
            else:
                ok = False  # value-taking / unknown npx flag -> ambiguous
                break
        if not ok or j >= n:
            continue
        tool = tokens[j]
        if tool.startswith("@") or "@" in tool:
            continue  # scoped or version-pinned -> wants real npx resolution
        tools.append(tool)
    return tools


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return

    if (data.get("tool_name") or "") != "Bash":
        return

    cmd = (data.get("tool_input") or {}).get("command") or ""
    if "npx" not in cmd:
        return

    try:
        tokens = shlex.split(cmd)
    except ValueError:
        return
    if not tokens:
        return

    cwd = data.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()

    # Map of installed, non-excluded npx tools -> their ./node_modules/.bin path.
    resolved: dict[str, str] = {}
    for tool in _scan_npx_tools(tokens):
        if tool in EXCLUDED_TOOLS or tool in resolved:
            continue
        bin_path = _find_local_bin(tool, cwd)
        if not bin_path:
            continue  # not installed locally -> leave to normal ask (install)
        resolved[tool] = "./node_modules/.bin/" + tool

    if not resolved:
        return  # nothing locally installed to advise -> silent pass-through

    mapping = "、".join(f"`npx {t}` → `{p}`" for t, p in resolved.items())
    reason = (
        "次のツールはローカル導入済みです（npx でのインストール不要・承認も不要）: "
        f"{mapping}。"
        "該当する `npx <tool>` の部分だけを対応する `./node_modules/.bin/<tool>` に置換し、"
        "パイプ・リダイレクト・引数・その他のコマンドはそのままにして再実行してください。"
        "（settings.json の allow `Bash(./node_modules/.bin/*)` により明示パスは自動承認されます）"
    )
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


if __name__ == "__main__":
    main()
