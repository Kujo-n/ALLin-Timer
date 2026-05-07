# Architect Refactor Report — 2026-04-30

## Scope

リポジトリ全体（src/ / firestore.rules / scripts/ / .claude/rules/）を Architect + Security 二眼で監査し、計画 [.claude/PRPs/plans/completed/architect-refactor-20260430.plan.md](../plans/completed/architect-refactor-20260430.plan.md) に従って 18 commit の atomic refactor を実施。観測可能な動作変更は 0。

- Branch: `feature/hole-refactor`
- Baseline commit: `7e8ab3b`
- Final commit: `dd81a51`
- 計 18 commit / 約 +2,800 行 / 約 -2,300 行

## Findings 概要

監査レポート: [.claude/PRPs/reviews/architect-refactor-20260430.md](../reviews/architect-refactor-20260430.md)

| Severity | 件数 | 解決 | 見送り |
| --- | --- | --- | --- |
| critical | 0 | 0 | 0 |
| high | 1 | 1 | 0 |
| medium | 7 | 6 | 1 |
| low | 8 | 8 | 0 |
| **合計** | **16** | **15** | **1** |

## 実施した変更（18 commit）

### Phase 0 — prerequisite 修復

- `b34ff66` — fix(timer-controls): 同期中バッジが「終了」ボタンに重なるレグレッションを解消
  - baseline E2E で発覚した既存バグの修復。`sm:absolute sm:right-0` を `sm:grid sm:grid-cols-[1fr_auto_1fr]` に置換し空間配分で重なりを排除。
  - 影響範囲: TimerControls running/paused state のレイアウトのみ。E2E 2 件（`dashboard-polish:92`, `timer-control-polish:200`）が baseline で fail していたものを green に戻す。

### Phase 1 — 安全網拡張（先行）

- `d59917c` — test(tournament-state): characterization test 先行追加（80 件）
- `1bcfe72` — test(rules): `firestore.rules` の数値リテラル静的検査スクリプト追加（6 件）

### Phase 2 — 共通基盤（定数 + errors）

- `b422394` — refactor(limits): `MAX_TABLES` / `MIN/MAX_SEATS_PER_TABLE` / `DEFAULT_SEATS_PER_TABLE` を `src/lib/limits.ts` に集約 → finding-2
- `8b96b7f` — refactor(errors): `unwrapOrFrom` / `getErrorCode` helper を追加し重複型ガード 5 箇所を解消 → finding-9 / 14

### Phase 3 — repository wrap helper

- `8cee143` — refactor(firebase): `wrapFirestoreWrite` / `wrapFirestoreRead` helper + 5 件 test 追加
- `5dff864` — refactor(repositories): small 5 file（users / groupJoinCodes / structures / structureTemplates / templateAdmins）を wrap 経由に統一
- `e9bdb7c` — refactor(repositories): players / tables を wrap 経由に統一
- `bb74256` — refactor(repositories): groups / tournaments を wrap 経由に統一 → finding-4

### Phase 4 — state-machine 純関数化

- `3cb0bd4` — refactor(tournament-state): repositories/tournaments の state guards / dashboard / TimerControls の表示判定を `tournament-state.ts` 純関数に集約 → finding-5

### Phase 5 — 大物 component 分割

- `5cc2b54` — refactor(group-detail): `useInlineNumberEdit` hook（11 件 test）+ `InlineNumberEditCard` + 4 子 component に分割。`group-detail-client.tsx` 791 → 354 行 → finding-1
- `1e55c88` — refactor(dashboard): `useFullscreen` / `useAutoFinish` / `useGroupRole` hook 抽出。`dashboard-client.tsx` 459 → 394 行 → finding-3 / 8
- `f9e79f7` — refactor(timer-controls): state branch を 4 sub-components に分割。`TimerControls.tsx` 379 → 222 行 → finding-13

### Phase 6 — 微修正 5 件

- `32740fd` — refactor(timer-hook): `useTournamentTimer` の autoAdvance dep を primitive fingerprint 化 → finding-6
- `4071b4e` — refactor(anon-cleanup): `attemptAnonymousSelfDelete` を auth-actions に集約。3 か所の重複を helper 化 → finding-7
- `513e650` — fix(security): 招待コード長を 16 → 25 文字（82bit → 129bit）に拡張 → finding-12
- `4b1b6c4` — refactor(dead-code): `defaultSeatsPerTable` / `finishedTournamentCount` の dead fallback `?? 0` / `?? DEFAULT_SEATS_PER_TABLE` を削除 → finding-16
- `dd81a51` — docs(rules): `firebase-patterns.md` に `groups/{gid}` update branch ごとの allowed-keys 一覧表を追加 → finding-15

## 見送った提案

- **finding-11**（`groupJoinCodes.usesCount` の DoS 空消費） — Cloud Firestore Security Rules 単独では複数 doc 同期検証が表現困難。Cloud Functions（Callable）化が前提のため Phase 5+ の根本対応に持ち越し。`security.md` および `group-membership.md` の「既知のセキュリティリスク」に既記。`maxUses: null` 運用が続く限り顕在化しない。

## 追加したテスト

| ファイル | 件数 | カバーした振る舞い |
| --- | --- | --- |
| `src/lib/services/tournament-state.test.ts` | 80 | 13 純関数 × 5 state + level 境界の characterization |
| `src/lib/hooks/useInlineNumberEdit.test.tsx` | 11 | inline 数値編集の state machine |
| `src/lib/firebase/wrap.test.ts` | 5 | wrap helper の AppError 透過・warn ログ・meta 付与 |
| `src/lib/errors.test.ts`（追加分） | 8 | `unwrapOrFrom` / `getErrorCode` |
| `scripts/test-rules-limits.mjs` | 6 | `firestore.rules` の数値リテラル検査（emulator 不要） |

合計: **新規 + 追加で 110 件以上**。

既存 receipt.test.ts は内部実装（`deleteUserProfile` 直接呼出）に依存していた 1 件を `attemptAnonymousSelfDelete` 経由の検証に書き換え（commit message に明記）。

## ベースライン vs 最終

| 項目 | Baseline (`7e8ab3b`) | After (`dd81a51`) |
| --- | --- | --- |
| typecheck | pass | pass |
| lint | pass (warnings 0) | pass (warnings 0) |
| unit test | 523 pass / 0 fail | **626 pass** / 0 fail |
| `npm run test:rules-limits` | （未導入） | 6/6 pass |
| build | pass | pass |
| e2e (playwright) | 44 pass / **2 fail**（既存バグ） | **44 pass / 0 fail**（3.8 分） |

Baseline の E2E 2 件 fail は **既存バグ**（Phase 4.14 の `sm:absolute` レイアウト regression）であり、本リファクタとは無関係。P0 の prerequisite 修復で先に green に戻してから本編に着手した。

## 主要ファイルの行数変化

| ファイル | Before | After | 削減率 |
| --- | --- | --- | --- |
| `src/app/groups/[gid]/group-detail-client.tsx` | 791 | 354 | -55% |
| `src/components/tournament/TimerControls.tsx` | 379 | 222 | -41% |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | 459 | 394 | -14% |

新規ファイル合計（hook / shared component / sub-components）: 約 1,000 行（責務ごとに分散、各 100 行未満）。

## 観測可能な動作変更が無いことの根拠

1. **全 E2E 22+ 件**（`groups-navigation` / `member-role-split` / `dashboard-polish` / `timer-control-polish` / `winner-banner-and-auto-finish` / `audio-settings` / `nav-and-sound-toggle` / `anonymous-self-delete`）がリファクタ各 commit を挟んで pass を維持。
2. **既存 unit test 523 件**を skip / disable / 削除なし。新規 110 件は追加のみ。
3. **観測点（aria-label / DOM 構造 / URL / Firestore schema / 環境変数 / 招待コードフォーマット）**に破壊的変更なし。
4. 例外: receipt.test.ts の 1 件のみ、内部実装に依存していたため helper 経由の assert に書き換え（commit message に明記）。
5. 例外: `logger.info` のメッセージ文字列が 1 行（`anonymous logout (self-delete) ok` → `anonymous self-delete ok` + `context: "logout"`）変わったが、code / 出力レベル / 構造化 fields は等価。

## プロジェクト規約との整合

- [`.claude/rules/firebase-patterns.md`](../../rules/firebase-patterns.md): 全 repository 経由 / `zodConverter` / `wrap` helper / 数値リテラル drift 検出 / allowed-keys 一覧。**準拠 + 拡張**。
- [`.claude/rules/error-logging.md`](../../rules/error-logging.md): `AppError` ラップ + domain code prefix + `logger` 経由（`unwrapOrFrom` / `getErrorCode` で拡張）。**準拠**。
- [`.claude/rules/security.md`](../../rules/security.md): 招待コード 128bit 以上の要件を満たすよう base36 × 25 文字に更新。**準拠**。
- [`.claude/rules/group-membership.md`](../../rules/group-membership.md): 3 階層ロール / `affectedKeys` 強制 / `joinCodeId` consumption proof。**準拠**。

## 残課題 / Next Step

- **finding-11**（招待コード DoS）: Cloud Functions 化と一緒に Phase 5+ で対応。
- **schema invariants**: `defaultSeatsPerTable` / `finishedTournamentCount` 等の zod default が確実に hydrate される invariant を、新規フィールド追加時にも壊さないこと（dead fallback 削除の前提）。
- **rule 言語制約**: `groups/{gid}` の `affectedKeys` 列挙は 6 ブランチで重複しているが、Cloud Firestore Rules では helper 関数化が困難。`firebase-patterns.md` の表で代替し、新フィールド追加時は表 → schema → rule → emulator test の順で更新する運用を徹底する。
- **次回の `/architect-refactor` までの観察ポイント**:
  - 大きい file（300 行+）の再発有無
  - rule 内ハードコード値の追加
  - try/catch + AppError.from の手書き再発（wrap.ts を経由しないコード）

## 補足

- 本リファクタは E2E を 3 回フル走行（P0 baseline / P5-2 完了直後 / P7 最終）した。中間 commit では typecheck + lint + unit + build で代替。
- 各 commit は revert 1 件で安全に戻せる粒度。`feature/hole-refactor` ブランチをそのまま PR にする想定。
- PR 説明には本レポートの「実施した変更」セクションを出発点にできる。
