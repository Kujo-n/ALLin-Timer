"""PreToolUse hook: rewrite `npx <tool> ...` to the locally-installed binary.

Motivation
----------
Claude Code frequently reaches for `npx <tool>`. Because `npx` can trigger a
package download, `Bash(npx*)` sits in the permissions `ask` list and stalls
automated work for approval. In practice the tool is almost always already
present in the project's `node_modules/.bin`, so the npx download never happens.

This hook detects a *simple* `npx <tool> ...` invocation, and if `<tool>` is
already installed under the nearest `node_modules/.bin` (walking up from the
command cwd), it rewrites the command to run that binary directly and returns
an explicit `permissionDecision: "allow"` so the call proceeds without a prompt.

If the tool is NOT installed locally, the hook stays silent (exit 0, no output)
so the normal permission flow runs — the user is asked, approves the `npx`
install once, and from then on the binary is present and auto-resolved.

Design constraints (see investigation notes):
- The "modifiedInput re-evaluation against the allow-list" behaviour and the
  "merge order of multiple parallel hooks" behaviour are BOTH undocumented in
  Claude Code. So we do not depend on either: we return an explicit `allow`
  ourselves, and we rewrite to an explicit relative binary path (not a bare
  name) so it runs regardless of whether `node_modules/.bin` is on PATH.
- The output field for PreToolUse input modification is documented as
  `modifiedInput`, but the installed Claude Code / co-installed RTK hook emit
  `updatedInput`. We emit BOTH to hedge the field-name uncertainty.
- Safety boundary chosen by the user: any binary present in `node_modules/.bin`
  is auto-allowed, EXCEPT `playwright` (its bare `test` run is gated by
  guard-bash.py to prevent writes to production Firebase).

Fail-safe policy: on any parse error / unexpected input the hook exits 0 with
no output (permissive: falls through to the normal permission flow).
"""

from __future__ import annotations

import json
import os
import shlex
import sys

# Tools we must NOT auto-resolve even when installed locally, because the
# permissions config deliberately routes them through `ask`/`deny` (deploy /
# auth / external side effects) or a dedicated guard. Auto-allowing these would
# silently bypass an intentional approval gate.
#   - playwright / playwright-core: bare `test` runs are gated by guard-bash.py
#     (production Firebase write protection); leave to allow-list entry + guard.
#   - firebase / firebase-tools / vercel: `firebase deploy*` / `vercel*` are in
#     the `ask` list on purpose. (Not present in node_modules/.bin today, but
#     excluded pre-emptively in case they become project deps.)
EXCLUDED_TOOLS = {
    "playwright",
    "playwright-core",
    "firebase",
    "firebase-tools",
    "vercel",
}

# Shell metacharacters whose presence means the command is more than a single
# `npx ...` invocation. We only rewrite the simple, unambiguous case; anything
# with chaining / redirection / substitution is left untouched (silent pass).
_SHELL_OPERATORS = ("&&", "||", ";", "|", ">", "<", "`", "$(", "&")

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


def _emit_allow(new_command: str, tool: str) -> None:
    inner = {"command": new_command}
    payload = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "permissionDecisionReason": (
                f"npx {tool} はローカル導入済みのため {tool} に切替（承認不要）"
            ),
            # Documented PreToolUse field.
            "modifiedInput": inner,
            # Field actually emitted by the co-installed RTK hook / some CC
            # versions. Emit both to hedge the field-name uncertainty.
            "updatedInput": inner,
        }
    }
    # ensure_ascii=True to avoid Windows cp932 mojibake on stdout.
    json.dump(payload, sys.stdout, ensure_ascii=True)
    sys.exit(0)


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


def _to_posix_rel(path: str, base: str) -> str:
    """Relative POSIX path with a leading ./ or ../ so bash executes the file
    directly regardless of whether node_modules/.bin is on PATH."""
    rel = os.path.relpath(path, base)
    rel = rel.replace(os.sep, "/")
    if not rel.startswith("."):
        rel = "./" + rel
    return rel


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return

    if (data.get("tool_name") or "") != "Bash":
        return

    cmd = (data.get("tool_input") or {}).get("command") or ""
    if not cmd.strip():
        return

    # Only handle a single, unchained command.
    if any(op in cmd for op in _SHELL_OPERATORS):
        return

    try:
        tokens = shlex.split(cmd)
    except ValueError:
        return
    if not tokens:
        return

    # Allow leading `VAR=value` env assignments before npx; keep them verbatim.
    env_prefix: list[str] = []
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if "=" in tok and tok.split("=", 1)[0].replace("_", "a").isalnum() and (
            tok[0].isalpha() or tok[0] == "_"
        ):
            env_prefix.append(tok)
            i += 1
            continue
        break

    if i >= len(tokens) or tokens[i] != "npx":
        return
    i += 1  # consume 'npx'

    # Skip npx's own boolean flags. Bail on any value-taking / unknown flag so
    # we never misidentify the tool (conservative).
    while i < len(tokens) and tokens[i].startswith("-"):
        if tokens[i] in _NPX_BOOL_FLAGS:
            i += 1
            continue
        return  # unknown / value-taking npx flag -> let normal flow handle it
    if i >= len(tokens):
        return

    tool = tokens[i]

    # Version-pinned (`pkg@1.2`) or scoped (`@scope/pkg`) requests explicitly
    # want npx resolution -> do not hijack.
    if tool.startswith("@") or ("@" in tool):
        return
    if tool in EXCLUDED_TOOLS:
        return

    cwd = data.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    bin_path = _find_local_bin(tool, cwd)
    if not bin_path:
        return  # not installed locally -> fall through to normal ask flow

    rest = tokens[i + 1:]
    bin_rel = _to_posix_rel(bin_path, cwd)
    new_command = shlex.join(env_prefix + [bin_rel] + rest)
    _emit_allow(new_command, tool)


if __name__ == "__main__":
    main()
