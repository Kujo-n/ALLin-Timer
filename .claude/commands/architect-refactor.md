---
description: 全体構造を Web Architect + Security Specialist の二眼で監査し、既存テスト（E2E 含む）を常に green に保ちながら段階的に大規模リファクタリングする
argument-hint: [対象スコープ — 例: 全体 | src/lib/firebase | seating]
---

# /architect-refactor

明示的呼び出し専用のリファクタリングフロー。**機能開発（テスト含む）が落ち着いた後**に、全体構造を見直す目的で起動する。

**Input**: $ARGUMENTS

---

## 起動条件チェック（最初に確認）

ユーザー（あなた）に以下を確認してから Phase 1 へ進む。曖昧な点が 1 つでもあれば、勝手に進めず短く質問する。

1. **対象スコープ** — `$ARGUMENTS` が指定されていればそれ。未指定なら「全体 / 特定ディレクトリ / 特定レイヤ」を聞く
2. **機能開発が落ち着いている確証** — `git status` がクリーン、in-flight ブランチや進行中の `.claude/PRPs/plans/` が無いか
3. **テスト網が十分か** — 少なくとも E2E が critical path をカバーしているか
4. **観測可能な動作変更の許容範囲** — 原則 0。例外があれば明示

## 既存スキルとの違い

このフローを使うべきでないケースは以下に流す:

- 直近差分のレビューだけ → `/code-review`
- 直近差分のセキュリティ確認 → `/security-review`
- dead code / 未使用 export 削除 → `/refactor-clean`
- 新規機能の TDD → `tdd-workflow`
- E2E テスト自体の追加・修正 → `e2e-testing`

## 実行

詳細手順は **`.claude/skills/architect-refactor/SKILL.md`** に集約してある。スラッシュコマンドが起動したら、Skill ツールで `architect-refactor` を呼び、SKILL.md の Phase 1〜5 を順に実施する。

```
Skill(architect-refactor) を起動
 → Phase 1: Baseline 確立（typecheck / lint / test / e2e / build を全 green に）
 → Phase 2: 構造監査（Architect レンズ＋Security レンズ、所見リスト作成）
 → Phase 3: リファクタリング計画（atomic な変更タスク化、ユーザー承認）
 → Phase 4: 段階実行（1 タスク = 1 commit、各回テスト全件 green）
 → Phase 5: 最終検証＋レポート（`.claude/PRPs/reports/architect-refactor-<yyyymmdd>.md`）
```

## 不変条件（最重要）

- 既存テストは常に green。red のまま次に進まない
- 新機能追加・公開 API の破壊的変更は禁止（事前承認時のみ）
- 1 commit = 1 atomic refactor。revert で安全に戻せる粒度
- `.claude/rules/` の規約が本フローの一般論より優先（`firebase-patterns.md` / `error-logging.md` / `security.md` / `group-membership.md`）
- やり取り・コミットメッセージ・レポートはすべて日本語
