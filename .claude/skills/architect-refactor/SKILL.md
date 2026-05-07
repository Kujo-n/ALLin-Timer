---
name: architect-refactor
description: User-invoked holistic architectural refactor that combines a Senior Web Architect lens (SoC / DRY / KISS / YAGNI / a11y / perf) with a Security Specialist lens (zero-trust / least-privilege / defense-in-depth / OWASP). Trigger ONLY when the user explicitly runs `/architect-refactor`, or explicitly asks to perform a "structural review and refactor preserving existing tests" / "全体構造の見直し" / "大規模リファクタリング". Use AFTER feature development (including unit / integration / E2E tests) has stabilized, when the goal is a large-scale structural refactor whose safety net is the existing test suite. Do NOT auto-trigger on routine cleanup, dead-code removal, recent-diff review, or pre-merge security checks — those have dedicated skills (refactor-clean, code-review, security-review). When in doubt about whether the user wants this skill vs. a smaller-scope skill, ask.
origin: project
---

# Architect Refactor — 全体構造見直し＋テスト網による安全な大規模リファクタリング

このスキルは **機能開発（テスト含む）が落ち着いたタイミング** で、Web アーキテクトとセキュリティスペシャリストの 2 レンズで全体構造を監査し、**既存テスト（unit / integration / E2E）を常に green に保ちながら段階的にリファクタリング** するためのワークフロー。

## 起動条件（明示呼び出し限定）

description のとおり雰囲気だけでの自動起動は禁止。以下のいずれかが満たされたときだけ動く:

- ユーザーが `/architect-refactor` を実行した
- 「全体構造を見直したい」「大規模リファクタリングしたい」「テスト落ちないようにアーキテクチャ整理したい」など、本スキルの目的そのものが言語化された

該当しない場合は次の代替を案内する:

| ユーザーの状況 | 推奨スキル |
| --- | --- |
| 直近のコミット差分／ローカル変更を見たい | `code-review` |
| 直近変更のセキュリティ的観点が知りたい | `security-review` |
| 未使用 export / dead code を消したい | `refactor-clean` |
| 新機能を TDD で追加したい | `tdd-workflow` |
| 既存 E2E テストの追加・修正をしたい | `e2e-testing` |

テストが乏しい段階で本スキルを起動するのは危険。その場合は先にテスト整備（`tdd-workflow` / `e2e-testing`）を提案する。

## 起動時の必須確認（4 点）

呼び出されたら、最初にこの 4 点を確認してから Phase 1 に進む。曖昧な点が 1 つでもあれば短く質問する:

1. **対象スコープ** — 全体 / 特定ディレクトリ / 特定レイヤ
2. **機能開発が落ち着いている確証** — `git status` がクリーン、in-flight ブランチや進行中の `.claude/PRPs/<NN>-<prd-slug>/plans/` が無いか
3. **テスト網が十分か** — 少なくとも E2E が critical path をカバーしているか
4. **観測可能な動作変更の許容範囲** — 原則 0。例外があれば明示

## 二つのレンズ（参照）

監査時は両レンズを必ず両方適用する。詳細はペルソナファイルを Read してから観点を抽出すること（記憶頼みで簡略化しない）:

- **Lens A: Senior Web Architect** — [`references/web_architect.md`](references/web_architect.md)
  カバー領域: アーキテクチャ原則 / コンポーネント設計 / 状態管理 / パフォーマンス / セキュリティ / a11y / エラーハンドリング / テスタビリティ / コード品質 / スケーラビリティ
- **Lens B: Security Specialist** — [`references/security_specialist.md`](references/security_specialist.md)
  カバー領域: ゼロトラスト・最小権限・多層防御 / OWASP Top 10 / 認証認可 / データ保護 / インフラ・API / セキュアコーディング / 監視

## 集約先（参照）

監査で抽出した所見をどこに集約するかの基準。Phase 2 / Phase 3 で必ず Read:

- **Refactor Conventions** — [`references/refactor-conventions.md`](references/refactor-conventions.md)
  ファイル分割閾値 / `_components` co-location / hook 抽出基準 / primitive fingerprint パターン / 既存共通 hook と shared component の一覧 / tournament-state 純関数 / 数値リミット集約。**通常開発（ステップ 1）には強制せず、refactor 時の集約先**として使う

## 不変条件（Invariants）

ワークフロー全体を通じて **絶対に守る** ルール。違反したら作業を停止してユーザーに報告する。

1. **既存の自動テスト（unit / integration / E2E）は常に green に戻す。** どの中間コミットでも red のまま次に進まない
2. **新機能は追加しない。** バグ修正・性能改善・セキュリティ修正以外の振る舞い変更はしない。観測可能な動作変更が必要なら別タスクとして相談
3. **公開 API / 外部契約（URL / Firestore スキーマ / 環境変数 / 永続化フォーマット）の破壊的変更は事前承認制**
4. **1 コミット = 1 リファクタの atomic 性。** revert 1 つで安全に戻せる粒度を維持
5. **プロジェクト固有ルール（`.claude/rules/`）を最優先。** 本スキルの一般論より `firebase-patterns.md` / `error-logging.md` / `security-base.md` / `security-env.md` / `group-membership.md` / `testing.md` の規約が常に優先する。Firebase / `try`/`catch` / `.env*` / `groups/` を触る前に該当ルールを Read する
6. **CLAUDE.md の言語設定に従う。** 日本語でやり取りし、コミットメッセージも日本語（type prefix のみ英語）

## ワークフロー（5 フェーズ）

各フェーズの成果物を順に積み上げ、後段で参照する。

### Phase 1 — 準備（Baseline 確立）

- [ ] `git status` がクリーンか確認。汚れていればユーザーに対応を確認
- [ ] 作業用ブランチに切り替え（例: `refactor/<scope>-<yyyymmdd>`）
- [ ] テスト全件をベースライン実行し、**全て green** を確認:
  - `npm run typecheck` / `npm run lint` / `npm test`（vitest）/ `npm run test:e2e`（playwright）/ `npm run build`
  - E2E が重い場合はユーザーと相談して critical path だけ先に回す
- [ ] 1 件でも fail があれば、リファクタリング前に修復するか、ユーザーに継続可否を確認

> **なぜ：** 後段で「テストが落ちた」が refactor 由来か元から壊れていたかを切り分けるため、開始時点で全 green を確定させる必要がある。

### Phase 2 — 構造監査

両レンズで現状をスキャンし、**所見リスト** を作る。コードはまだ触らない。

- 監査範囲をユーザーと合意（全体 / 特定ディレクトリ / 特定レイヤ）
- 範囲内の主要ファイルを Read で実際に開いて観察。grep / glob の件数だけで判断しない
- レンズ適用前に `references/web_architect.md` と `references/security_specialist.md` を Read
- 各所見を以下の構造で記録:

```markdown
### finding-N: <一文タイトル>
- Lens: architect | security | both
- Severity: critical | high | medium | low
- 場所: src/path/to/file.ts:123-145 ほか
- 観察事実: <何が起きているか>
- 影響: <なぜ問題か>
- 案: <候補となるリファクタ方針 1〜2 件>
- テスト保護: <この変更を守る既存テスト名／不足しているなら何を足すか>
- リスク: <観測可能な動作変更が起き得る箇所>
```

- Severity 基準:
  - **critical** — セキュリティ脆弱性、データ破損リスク、本番障害につながり得る設計欠陥
  - **high** — 開発速度を著しく落とす構造的負債、明確な OWASP 系脆弱性候補
  - **medium** — 保守性の改善、KISS/DRY 違反
  - **low** — 命名／コメント／微小な一貫性
- 監査結果は `.claude/PRPs/<NN>-<prd-slug>/reviews/architect-refactor-<yyyymmdd>.md` に保存（PRD は架空のリファクタを引き起こした work-stream の所属 PRD）

### Phase 3 — リファクタリング計画

所見を **atomic な変更タスク** に分解。実装前にユーザー承認を取る。

- 各タスクは以下を満たすこと:
  - 1 commit に収まる粒度（典型的に 1〜30 ファイル、+/- 数百行以内）
  - 観測可能な振る舞いを変えない（純粋な内部リファクタ）
  - 既存のどのテストが安全網になるか明示
  - 安全網が無い場合は **先に characterization test を足すタスク** をペアで作る
- 順序付け:
  1. 安全網不足を埋める（characterization test 追加）
  2. critical / security 修正（最優先・小さく分割）
  3. 構造的な土台（型・スキーマ・共通 util）の整理
  4. それに依存するレイヤ（service → repository → component の順、依存方向の上流から）
  5. 末端の cosmetic（命名・並び替え）
- 計画は `.claude/PRPs/<NN>-<prd-slug>/plans/architect-refactor-<yyyymmdd>.plan.md` として書き出し、**ユーザー承認を得てから Phase 4 へ**

> **なぜ：** 大規模リファクタを 1 PR にまとめると、テストが落ちたとき原因切り分けが極端に難しくなる。atomic に切り分けて 1 つずつ commit する設計が「テスト網による安全保証」の前提条件。

### Phase 4 — 段階実行

計画の各タスクを順に実行する。**1 タスク = 1 ループ** で以下を回す:

```
ループ:
  1. タスクの変更を実装（Edit / Write / 必要に応じて移動・分割）
  2. npm run typecheck
  3. npm run lint
  4. npm test
  5. （タスク内容に応じて）npm run test:e2e
  6. npm run build
  7. 全部 green なら：
       git add -p で意図したファイルだけステージし、日本語の詳細コミットメッセージを残す
       例: refactor(seating): orchestrator から engine 純粋ロジックを分離
  8. 1 つでも red なら：
       a. revert を検討（git restore / git reset --hard HEAD）
       b. 原因を分析。タスク自体が誤りなら計画から外す
       c. タスクを再分割できるなら細分化して再挑戦
       d. テストが間違っていた可能性があるならユーザーに確認
       ※ テスト側を refactor に合わせて書き換えるのは原則禁止。
         例外は「テストが実装の内部詳細に依存していた」と明確に説明できる場合のみ、
         同 commit で記録した上で行う。
```

ループ内の遵守事項:

- **観測可能な動作変更を見つけたら停止して報告。** リファクタの定義から外れる
- **「テストが通らないので無効化／skip」は禁止。** 失敗の根本原因に向き合う
- **commit メッセージは「なぜ」を含める** — 後で revert する人のために

### Phase 5 — 最終検証＆レポート

- [ ] `npm run typecheck` / `npm run lint` / `npm test` / `npm run test:e2e` / `npm run build` を全件再実行し、green を確認
- [ ] `git log --oneline <baseline>..HEAD` で commit が atomic な単位で並んでいることを確認
- [ ] 観測可能な動作変更が無いことを最終確認（手動 smoke test の必要性をユーザーに提案）
- [ ] レポートを `.claude/PRPs/<NN>-<prd-slug>/reports/architect-refactor-<yyyymmdd>.md` に書き出す。フォーマットは [`references/report-template.md`](references/report-template.md) を参照
- 必要なら PR を `/prp-pr` で起票する。PR 説明には「観測可能な動作変更なし」と「全テスト green を維持」を明記

## プロジェクト固有の重ね合わせ

ALLin-PokerTimer 固有の規約。`.claude/rules/` の各ファイルが正本。詳細は該当ルールを Read してから提案を作る:

- [`firebase-patterns.md`](../../rules/firebase-patterns.md) — Firestore / repositories 経由 / zodConverter / Security Rules deny-by-default / 複合 index 回避
- [`error-logging.md`](../../rules/error-logging.md) — `AppError` ラップ・ドメインコード prefix・`logger` 経由のみ・`console.*` 残置の掃除好機
- [`security-base.md`](../../rules/security-base.md) — 公開リポジトリ運用・サークル固有データの非コミット（常時適用）
- [`security-env.md`](../../rules/security-env.md) — `.env*` 混入・`NEXT_PUBLIC_*` のサーバ秘密混入（`.env*` / `next.config.*` / `firebase/client.ts` 編集時）
- 招待コード設計原則は [`group-membership.md`](../../rules/group-membership.md) に、Structure Templates / templateAdmins 運用は [`firebase-patterns.md`](../../rules/firebase-patterns.md) に集約済み
- [`group-membership.md`](../../rules/group-membership.md) — `groupId` / `memberUids` / `ownerUids` / `organizerUids` の不変条件、`affectedKeys` 漏れの再発防止、`get()` rule read コスト
