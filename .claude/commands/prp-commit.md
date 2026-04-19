---
description: "Quick commit with natural language file targeting — describe what to commit in plain English"
argument-hint: "[target description] (blank = all changes)"
---

# Smart Commit

> Adapted from PRPs-agentic-eng by Wirasm. Part of the PRP workflow series.

**Input**: $ARGUMENTS

---

## Phase 1 — ASSESS

```bash
git status --short
```

If output is empty → stop: "Nothing to commit."

Show the user a summary of what's changed (added, modified, deleted, untracked).

---

## Phase 2 — INTERPRET & STAGE

Interpret `$ARGUMENTS` to determine what to stage:

| Input | Interpretation | Git Command |
|---|---|---|
| *(blank / empty)* | Stage everything | `git add -A` |
| `staged` | Use whatever is already staged | *(no git add)* |
| `*.ts` or `*.py` etc. | Stage matching glob | `git add '*.ts'` |
| `except tests` | Stage all, then unstage tests | `git add -A && git reset -- '**/*.test.*' '**/*.spec.*' '**/test_*' 2>/dev/null \|\| true` |
| `only new files` | Stage untracked files only | `git ls-files --others --exclude-standard \| grep . && git ls-files --others --exclude-standard \| xargs git add` |
| `the auth changes` | Interpret from status/diff — find auth-related files | `git add <matched files>` |
| Specific filenames | Stage those files | `git add <files>` |
| `機能単位` / `task 別` / `feature-based` / `split` / `分割` | **マルチコミット分割モード** — Phase 2b へ | *(後述)* |

For natural language inputs (like "the auth changes"), cross-reference the `git status` output and `git diff` to identify relevant files. Show the user which files you're staging and why.

```bash
git add <determined files>
```

After staging, verify:
```bash
git diff --cached --stat
```

If nothing staged, stop: "No files matched your description."

---

## Phase 2b — MULTI-COMMIT SPLIT（機能単位・依存順）

`$ARGUMENTS` に `機能単位` / `task 別` / `feature-based` / `split` / `分割` が含まれる場合は、単一コミットではなく**変更を複数コミットに分割**する。それ以外なら Phase 3 へ。

### 分割計画

1. `git status --short` と `git diff`（必要なら `git diff --stat`）で全変更を把握
2. 役割が近いファイル同士を 1 コミットにまとめる（凝集性ルール）:
   - `package.json` / `package-lock.json` → deps 単位で 1 コミット
   - スキーマ / converter / repository → Firestore foundation 1 コミット
   - `firestore.rules` / `firestore.indexes.json` → Security Rules 1 コミット
   - shadcn UI 追加（`src/components/ui/*`）→ UI プリミティブ 1 コミット
   - 認証サービス（`src/lib/services/auth-*`, `redirect`）→ 認証サービス 1 コミット
   - 認証コンポーネント（`src/components/auth/*`）→ 認証 UI 1 コミット
   - ドメインサービス（`receipt` など）→ サービス別に 1 コミット
   - ページ（`src/app/<feature>/`）→ feature 単位で 1 コミット
   - レイアウト／トップ（`layout.tsx` / `page.tsx`）→ 1 コミット
   - ドキュメント（`README.md`, `.claude/PRPs/`）→ 最後に 1 コミット

3. **依存順**に並べる（下位層 → 上位層 → docs）:

   ```
   chore: deps
     ↓
   foundation（schema / converter / repositories / rules / UI プリミティブ）
     ↓
   services（認証 / ドメイン）
     ↓
   components（認証 UI / 機能別共通コンポーネント）
     ↓
   pages（各 feature 画面、依存する service/components より後）
     ↓
   layout / トップページ（すべての共通 UI に依存）
     ↓
   docs（最後）
   ```

   ガイドライン: 各コミット単体で **tsc が通る状態に近づける**（best-effort、完全保証は不要）。例えば古い API を削除したコミットは、その API を使うコード修正を含める。

4. 実行前に分割プランを 1 行ずつ提示せず、**そのまま順次実行**する（auto mode では待たない）。ただしコミットを実行するたびにコミットハッシュとメッセージは都度表示する。

### 実行ループ

各グループについて順に:

```bash
git add <files-for-this-group>
git diff --cached --stat   # 何を stage したか確認
git commit -m "{type}: {日本語の説明}"
```

### ガードレール

- **.gitignore 衝突**: `git add` が `paths are ignored` で失敗したら、対象パスをプランから除外して再実行（ユーザーへは「.gitignore により除外」とだけ報告）
- **空 stage**: 既に前のコミットに含まれていて stage 対象が 0 件なら、そのグループはスキップしログで通知
- **順序再検討**: 計画の途中で「A が B に依存していた」と気付いた場合は、未コミットのグループ順を入れ替える
- **最終検証**: 全コミット後に `git status --short` が空であること、`git log --oneline -N` で作成したコミットが並んでいることを確認
- **ビルド検証は任意**: 最終状態での `typecheck` / `build` が pass していれば OK（中間コミット単位の pass は best-effort）

### 出力（マルチコミットモード時）

```
Committed N commits on {branch}:
  {hash1} {type}: {desc1}   ({files1} files)
  {hash2} {type}: {desc2}   ({files2} files)
  ...

Working tree: clean
Skipped: {ignored paths, if any}
```

その後 Phase 4 の単一コミット出力は省略する。

---

## Phase 3 — COMMIT

コミットメッセージは **1 行、日本語**で記述する。type prefix のみ英語（Conventional Commits 準拠）。

```
{type}: {日本語の説明}
```

Types（英語のまま使用）:
- `feat` — 新機能・新しい能力
- `fix` — バグ修正
- `refactor` — 挙動を変えないリファクタ
- `docs` — ドキュメント変更
- `test` — テストの追加・更新
- `chore` — ビルド・設定・依存関係
- `perf` — パフォーマンス改善
- `ci` — CI/CD 変更

Rules:
- 日本語で簡潔に書く（体言止め または 「〜を追加／修正／更新する」形）
- 文末のピリオド・句点は付けない
- 全体で 72 文字（半角換算）以内を目安に
- WHAT（何を変えたか）を書く。HOW（どう実装したか）は書かない
- type prefix 直後は半角コロン + 半角スペース（`feat: 〜`）
- 固有名詞（コンポーネント名・ファイル名・コマンド）は原文のまま（例: `Next.js`、`Firestore`、`AppError`）

良い例:
- `feat: トーナメント作成フォームを追加`
- `fix: Firebase 初期化時の動的 env 参照を修正`
- `refactor: AuthProvider を useMemo 経由に整理`
- `docs: Phase 1 (Foundation) の実装レポートを追加`
- `chore: firebase-tools を dev 依存に追加`

避ける例:
- `feat: add tournament form`（英語のみ）
- `feat: 色々修正しました。`（句点・敬体・曖昧）
- `feat: トーナメント作成フォーム（useState と useEffect を使って状態管理を行う形で実装）を追加`（HOW を書きすぎ）

```bash
git commit -m "{type}: {日本語の説明}"
```

---

## Phase 4 — OUTPUT

Report to user:

```
Committed: {hash_short}
Message:   {type}: {description}
Files:     {count} file(s) changed

Next steps:
  - git push           → push to remote
  - /prp-pr            → create a pull request
  - /code-review       → review before pushing
```

---

## Examples

| 入力 | 挙動 |
|---|---|
| `/prp-commit` | 全変更を stage してメッセージ自動生成 |
| `/prp-commit staged` | すでに stage 済みのものだけコミット |
| `/prp-commit *.ts` | TypeScript ファイルのみ stage してコミット |
| `/prp-commit except tests` | テスト以外を stage |
| `/prp-commit 認証関連の変更だけ` | status / diff から認証関連ファイルを抽出 |
| `/prp-commit 新規ファイルのみ` | 未追跡ファイルのみ stage |
| `/prp-commit 機能単位` / `task 別` / `split` | **Phase 2b マルチコミット分割モード**（依存順に複数コミット） |

自動生成されるメッセージの例:

| 変更内容 | 生成されるメッセージ |
|---|---|
| Next.js + Firebase 基盤一式を新規追加 | `feat: Phase 1 Foundation の土台（Next.js 15 + Firebase）を追加` |
| `src/lib/firebase/client.ts` の env 参照を修正 | `fix: Firebase 初期化時の動的 env 参照を静的アクセスへ修正` |
| Phase 2 の実装計画ドキュメント追加 | `docs: Phase 2 (Tournament Setup) の実装計画を追加` |
| `npm install firebase-tools` 追加 | `chore: firebase-tools を dev 依存に追加` |
