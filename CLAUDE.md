# ALLin-PokerTimer

## 言語設定

- **ユーザーとのやり取りは日本語で行うこと。**
- 質問・要約・提案・確認・エラーメッセージを含め、すべて日本語で出力する。
- コード内のコメント・識別子は英語を基本とする（プロジェクト規約に従う）。
- **コミットメッセージは日本語で記述する**（`feat` / `fix` / `docs` 等の type prefix のみ英語）。詳細ルールは [.claude/commands/prp-commit.md](.claude/commands/prp-commit.md) 参照。
- `.claude/PRPs/` 配下に生成するドキュメント（PRD・実装計画など）は**日本語で記述する**。

## プロジェクト概要

- **ALLin-PokerTimer** — NLH（ノーリミットテキサスホールデム）小規模サークル向けトーナメント進行支援 Web アプリ
- 核心価値: **熟練者不在でも TDA ルール通りに回せる**（席決め・テーブルバランシングをアプリが自動指示）
- 対象規模: 6 テーブル以下、20 人前後のサークル（月 1〜2 回開催）
- 配布: MIT ライセンスで GitHub 公開。サークル固有情報は Firestore にのみ保存

### スタック（確定）

| 層               | 採用                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| フロントエンド   | Next.js 15（App Router / TypeScript）                                                          |
| UI               | Tailwind CSS + shadcn/ui                                                                       |
| DB / 認証        | Firebase Firestore + Firebase Authentication（匿名／メール＋PW／Google の 3 方式）             |
| リアルタイム同期 | Firestore `onSnapshot`                                                                         |
| デプロイ         | Vercel Hobby（GitHub 連携）                                                                    |

詳細は [.claude/PRPs/01-allin-timer/prds/01-allin-timer.prd.md](.claude/PRPs/01-allin-timer/prds/01-allin-timer.prd.md) を参照。

## ドキュメント構成

PRD と plan は **2 桁ゼロパディング sequential 番号** で対応付ける。`<NN>-<slug>/prds/<NN>-<slug>.prd.md` ↔ `<NN>-<slug>/plans/...`。番号は要件定義（PRD 作成）順で、開発順序を示す。

各 PRD はトップレベルの `<NN>-<slug>/` フォルダに集約され、配下に `prds/` / `plans/` / `reports/` / `reviews/` の 4 種類のサブフォルダを持つ。

- **PRD**: [.claude/PRPs/](.claude/PRPs/) 配下の `<NN>-<slug>/prds/<NN>-<slug>.prd.md` に生成。各 PRD 内 Phase 進捗表が最新状況の真実源
  - **01**: [01-allin-timer.prd.md](.claude/PRPs/01-allin-timer/prds/01-allin-timer.prd.md) — Foundation 〜 Phase 5.x（基盤・席決め・タイマー・サークル管理）
  - **02**: [02-season-stats-and-share.prd.md](.claude/PRPs/02-season-stats-and-share/prds/02-season-stats-and-share.prd.md) — シーズン戦績・結果カード・テーブル呼称カスタム（Phase A〜D）
- **実装計画**: [.claude/PRPs/<NN>-<slug>/plans/](.claude/PRPs/) に PRD 別フォルダで生成
  - 進行中: `<NN>-<slug>/plans/<phase>.plan.md`
  - 完了: `<NN>-<slug>/plans/completed/<phase>.plan.md` に移動
  - **すべての plan は必ずいずれかの PRD に帰属させる**。帰属先は「その作業が発生した PRD コンテキスト」で決める。例えば `02-season-stats-and-share` の実装中に派生した architect-refactor は `02-season-stats-and-share/plans/` 配下、`01-allin-timer` の安定後に行う全体リファクタは `01-allin-timer/plans/` 配下、というように **どの PRD の流れで発生した作業か** で振り分ける（「対象コードがどこにあるか」ではない）
- **実装レポート**: [.claude/PRPs/<NN>-<slug>/reports/](.claude/PRPs/) に Phase 完了毎に生成（PRD と同じ `<NN>-<slug>` フォルダ配下）
- **レビュー記録**: [.claude/PRPs/<NN>-<slug>/reviews/](.claude/PRPs/) に同じ規約で配置
- **PRD 内の Phase 進捗表**が最新状況の真実源。個別リンクは PRD を参照

## ワークフロー

要件定義〜実装は PRP フローを使用:

1. `/prp-prd` — 要件定義（Q&A で PRD 生成）。次の sequential 番号 `<NN>-<slug>.prd.md` で `<NN>-<slug>/prds/` に生成
2. `/prp-plan <prd>` — フェーズ別の実装計画を `.claude/PRPs/<NN>-<slug>/plans/` に生成し、PRD のフェーズを `in-progress` に更新
3. `/prp-implement <plan>` — 実装
4. `/prp-pr` / `/prp-commit` — PR 作成・コミット

## 実装規約

各ルールファイル先頭の YAML frontmatter（`applyAlways` / `applyOnPaths` / `applyOnPathsExclude`）が適用範囲の**真実源**。コード変更・新規作成を行う前に、該当するファイルを必ず Read してから作業を開始する（記憶に頼らず毎回読む）。

| ルールファイル                                             | 適用形態    | 主な対象（要約・詳細は frontmatter）                                                           |
| ---------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| [security-base.md](.claude/rules/security-base.md)         | 常時適用    | 公開リポジトリ運用、サークル固有情報の Firestore 限定保存、依存追加 ask モード                 |
| [security-env.md](.claude/rules/security-env.md)           | path-scoped | `.env*` / `next.config.*` / `vercel.json` / `src/lib/firebase/client.ts` 編集時                |
| [error-logging.md](.claude/rules/error-logging.md)         | path-scoped | `src/**/*.{ts,tsx}` 編集時（test / schema 除く）                                               |
| [firebase-patterns.md](.claude/rules/firebase-patterns.md) | path-scoped | `src/lib/firebase/**` / `firestore.rules` / 関連 script 編集時。Structure Templates 運用も含む |
| [group-membership.md](.claude/rules/group-membership.md)   | path-scoped | group モデル定義層・招待コード設計編集時。Phase 2.5 完了・Phase 3 以降はここを参照             |
| [testing.md](.claude/rules/testing.md)                     | path-scoped | `*.test.{ts,tsx}` / `tests/e2e/**` / `vitest.config.ts` / `playwright.config.ts` 編集時        |

複数領域にまたがる変更は該当するすべてのルールを読むこと。ルールと PRD の実装方針が矛盾する場合は作業を止めてユーザーに確認する。

# 注意事項

- 作成された成果物は Codex によってレビューされます。
