# Architect Refactor Report — 2026-05-06

## Scope

リポジトリ全体（src/ / firestore.rules / scripts/ / .claude/rules/）を Architect + Security 二眼で監査し、計画 [.claude/PRPs/plans/architect-refactor-20260506.plan.md](../plans/architect-refactor-20260506.plan.md) に従って **11 commit の atomic refactor** を実施。観察可能な動作変更は 0。

- Branch: `feature/hole-refactor`
- Baseline commit: `1c00ad4`
- Final commit: `a1220c2`
- 計 11 commit / 約 +1,474 行 / 約 -287 行（うち test 追加 +30 件、新規 helper 3 ファイル）

## Findings 概要

監査レポート: [.claude/PRPs/reviews/architect-refactor-20260506.md](../reviews/architect-refactor-20260506.md)

| Severity | 件数 | 解決 | 見送り |
| --- | --- | --- | --- |
| critical | 0 | 0 | 0 |
| high | 0 | 0 | 0 |
| medium | 5 | 5 | 0 |
| low | 4 | 4 | 0 |
| info / 既知 | 1 | 0 | 1 |
| **合計** | **10** | **9** | **1** |

## 実施した変更（11 commit）

### Phase 0 — 安全網拡張（先行）

- `503793e` — test: refactor 先行 characterization と helper 仮実装を追加
  - schemas/group.ts に `isOrganizerRole` / `isOwnerRole` 仮実装 + 8 件 test
  - tournament-state.ts に `isBeforeStart` 仮実装 + 1 件 test
  - 新設 same-table.ts と test（2 helper + 6 件）
  - 計 +15 件 characterization 投入

### Phase 1 — 命名・小集約（risk 低）

- `fe3e30f` — refactor(role): `isOrganizerRole` helper を 4 callsite に展開して drift を解消 → finding-A4
- `3f3f1fe` — refactor(tournament-state): `isBeforeStart` helper で 3 component の state 直比較を集約 → finding-A3
- `3297536` — refactor(tournament-clone): 手書き型ガードを `unwrapOrFrom` に置換 → finding-A6

### Phase 2 — 同卓 helper 集約

- `7023109` — refactor(seating): 同卓 ID 計算の重複を same-table helper に集約（3 callsite） → finding-A2

### Phase 3 — tx-helpers 集約（risk 中）

- `d80ac3b` — feat(firebase): `tx-helpers.ts` に `loadTournamentInTx` / `playerFromSnap` 追加 + 6 件 test
- `dbce6fb` — refactor(seating): orchestrator の 6 関数で tx prelude を `loadTournamentInTx` に集約 → finding-A5
- `301d6fa` — refactor(tournaments): repository の 4 関数で tx prelude を `loadTournamentInTx` に集約 → finding-A5
- `f7b4705` — refactor(seating): orchestrator の 11 箇所で player snap 復元を `playerFromSnap` に集約 → finding-A7

### Phase 4 — dashboard-client 肥大化解消

- `fdf43c2` — refactor(dashboard): D&D 手動席移動 state を `useManualSeatChange` hook に抽出（80 行 → hook 化）+ 5 件 test → finding-A1
- `a1220c2` — refactor(dashboard): audio toggle inline handler を局所関数に抽出 → finding-A8

## 見送った提案

- **finding-S1**（`groupJoinCodes.usesCount` の DoS 空消費） — Cloud Functions（Callable）化が前提のため Phase 5+ の根本対応に持ち越し（前回 refactor の finding-11 と同じく既知）。`security.md` および `group-membership.md` の「既知のセキュリティリスク」に既記。`maxUses: null` 運用が続く限り顕在化しない

## 追加したテスト

| ファイル | 件数 | カバーした振る舞い |
| --- | --- | --- |
| `src/lib/firebase/schemas/index.test.ts`（追加分） | 8 | `isOrganizerRole` / `isOwnerRole` の 4 ロール × 2 関数 |
| `src/lib/services/tournament-state.test.ts`（追加分） | 1 | `isBeforeStart` の 5 state characterization |
| `src/lib/services/seating/same-table.test.ts` | 6 | 同卓 active / PD active 抽出の filter 仕様 |
| `src/lib/firebase/tx-helpers.test.ts` | 6 | `loadTournamentInTx` 4 ケース + `playerFromSnap` 2 ケース |
| `src/lib/hooks/useManualSeatChange.test.tsx` | 5 | busy / undoBanner / 30 秒 timeout / undo / unmount cleanup |

合計: **新規 + 追加で 26 件**（vitest ベースは 789 → 819 で +30、内 4 件は重複 it.each 展開によるカウント差）。

既存テストの skip / disable / 削除は **0 件**。`note-screenshots.spec.ts` の `CAPTURE_SCREENSHOTS` 環境変数 gate と `anonymous-self-delete.spec.ts` の runtime 条件 skip は本リファクタ対象外（baseline からの skip）。

## ベースライン vs 最終

| 項目 | Baseline (`1c00ad4`) | After (`a1220c2`) |
| --- | --- | --- |
| typecheck | pass | pass |
| lint | pass (warnings 0) | pass (warnings 0) |
| unit test | 789 pass / 0 fail | **819 pass** / 0 fail |
| `npm run test:rules-limits` | 6/6 pass | 6/6 pass |
| `npm run test:rules-clone-players` | 7/7 pass | 7/7 pass |
| build | pass | pass |
| e2e (playwright) | 56 pass / 0 fail / 2 skipped (5.4 分) | **56 pass / 0 fail / 2 skipped**（5.1 分） |

skip 2 件は両回とも同じ意図的 gate（`note-screenshots`: CAPTURE_SCREENSHOTS env、`anonymous-self-delete:19`: runtime 条件）。

## 主要ファイルの行数変化

| ファイル | Before | After | 削減率 |
| --- | --- | --- | --- |
| `src/lib/services/seating/orchestrator.ts` | 1107 | 1060 | -4.2% |
| `src/lib/firebase/repositories/tournaments.ts` | 736 | 712 | -3.3% |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | **597** | **491** | **-17.8%** |

新規ファイル合計（helper / hook）: 約 330 行（責務ごとに分散、各 100〜200 行）。

## bundle 変化

| route | Before | After |
| --- | --- | --- |
| `/tournaments/[tid]` | 27.7 kB / First Load 351 kB | 27.6 kB / First Load 351 kB |
| `/tournaments/[tid]/clone` | 3.65 kB / 324 kB | 3.63 kB / 324 kB |

dashboard 系で僅かに減少。orchestrator は 1107 → 1060 に減ったが import / re-export 経路は不変のため bundle 影響なし。

## 観察可能な動作変更が無いことの根拠

1. **全 E2E 56 件**（anonymous / append-blind-level / audio-settings / clone-tournament-with-players / dashboard-polish / dynamic-blind-adjustment / member-role-split / nav-and-sound-toggle / playing-dealer / structure-templates / timer-control-polish / winner-banner-and-auto-finish 等）が baseline と final で同じ pass/skip 構成を維持
2. **既存 unit test 789 件**を skip / disable / 削除なし。新規 30 件は追加のみ
3. **観測点**（aria-label / DOM 構造 / URL / Firestore schema / 環境変数 / 招待コードフォーマット）に破壊的変更なし
4. **rule emulator 検査**（rules-limits 6/6、rules-clone-players 7/7）で permission 境界の不変性を確認

## プロジェクト規約との整合

- [`.claude/rules/firebase-patterns.md`](../../rules/firebase-patterns.md): tx 内 boilerplate を `tx-helpers.ts` の `loadTournamentInTx` / `playerFromSnap` に集約。前回 refactor の `wrapFirestoreWrite` / `wrapFirestoreRead` と同じ「関数境界での error / read 集約」思想を継承。**準拠 + 拡張**
- [`.claude/rules/error-logging.md`](../../rules/error-logging.md): `tournament-clone.ts` の手書き型ガードを `unwrapOrFrom` 経由に置換し、規約の禁止パターン例を 1 件解消。**準拠**
- [`.claude/rules/group-membership.md`](../../rules/group-membership.md): `isOrganizerRole` / `isOwnerRole` を `schemas/group.ts` に追加し、`deriveRole` の隣で「3 階層ロール判定の関数化」を完成。4 callsite の drift を解消。**準拠 + 拡張**

## 次回 refactor までに観察したい drift

- **dashboard-client.tsx の再肥大化監視** — Phase 5.x で 394 → 597 行に逆流した先例があるため、Phase 6 以降で 500 行を超えたら次の hook 抽出候補を見出す
- **tx-helpers の汎用化候補** — `loadGroupInTx` / `loadPlayerInTx` 等の追加 helper が出てきたら同 file に集約する
- **`isOrganizerRole` の更なる callsite 増加** — 監視が必要。schema 拡張で 4 階層化が来た場合は helper の signature だけ変えれば caller は変更不要

## 関連

- 計画: [.claude/PRPs/plans/architect-refactor-20260506.plan.md](../plans/architect-refactor-20260506.plan.md)
- 監査レポート: [.claude/PRPs/reviews/architect-refactor-20260506.md](../reviews/architect-refactor-20260506.md)
- 前回レポート: [.claude/PRPs/reports/architect-refactor-20260430.md](architect-refactor-20260430.md)
- 規約: [.claude/rules/](../../rules/)
