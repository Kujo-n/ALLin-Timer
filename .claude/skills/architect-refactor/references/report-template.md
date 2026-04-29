# Architect Refactor — レポートテンプレート

Phase 5 の最終検証で `.claude/PRPs/reports/architect-refactor-<yyyymmdd>.md` に書き出すフォーマット。

```markdown
# Architect Refactor Report — <yyyymmdd>

## Scope
<対象ディレクトリ・レイヤ>

## Findings 概要
- critical: N 件 / high: N 件 / medium: N 件 / low: N 件
- 詳細監査結果: `.claude/PRPs/reviews/architect-refactor-<yyyymmdd>.md`

## 実施した変更
- <commit hash> — <一文要約> — <影響範囲>
- ...

## 見送った提案（理由付き）
- <findings の id> — <なぜ今回は触らなかったか>

## 追加したテスト
- <ファイル / 件数> — <カバーした振る舞い>

## ベースライン vs 最終
| 項目 | Baseline | After |
| --- | --- | --- |
| typecheck | pass | pass |
| lint | pass | pass |
| unit test | N pass / 0 fail | N pass / 0 fail |
| e2e test | N pass / 0 fail | N pass / 0 fail |
| build | pass | pass |

## 残課題 / Next Step
- <将来のフォローアップとして残したもの>
```

## 補足

- **観測可能な動作変更が無い** ことの根拠を記載すること（テスト全 green の他に、必要なら手動 smoke の結果）
- 「見送った提案」を必ず書く。スコープ外と判断したものを残さないと、次回また同じ finding が再発する
- PR を起こす場合は、本レポートの「実施した変更」セクションを PR 本文の出発点にできる
