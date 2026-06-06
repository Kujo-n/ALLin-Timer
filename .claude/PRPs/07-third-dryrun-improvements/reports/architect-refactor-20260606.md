# Architect Refactor Report — 20260606

## Scope

受付代理（proxy-receipt）＋直近変更領域中心（`07-third-dryrun-improvements` の `main..HEAD` work-stream）。

- service: `proxy-receipt.ts` / `entry-guards.ts` / `tournament-state.ts`
- repository: `repositories/players.ts`
- component: `PlayerList.tsx` / `EditPlayerNameDialog.tsx`（新規）
- 作業ブランチ: `feat/phase-1-proxy-receipt-data-layer`（現ブランチ上で続行）

## Findings 概要

- critical: 0 件 / high: 0 件 / medium: 3 件 / low: 2 件
- 詳細監査結果: [.claude/PRPs/07-third-dryrun-improvements/reviews/architect-refactor-20260606.md](../reviews/architect-refactor-20260606.md)

## 実施した変更

- `3a0aa9a` — **finding-1** 新規 player doc 生成を `newPlayerBody` factory に集約 — `repositories/players.ts`（upsert create / named-only / clone の 3 経路の fresh-doc literal を単一化。merge 分岐は据え置き。-3 net 行・drift WARNING の機械的担保）
- `c28d807` — **finding-2** organizer 再認可を `resolveOrganizerContext` に集約 — `services/proxy-receipt.ts`（3 経路の `getTournament → getGroup → assertOrganizer` を helper 化。ゼロトラスト不変条件「gid を tournament.groupId から再導出」を単一真実源化）
- `e0573a8` — **finding-3** 表示名編集ダイアログを `EditPlayerNameDialog` に抽出 — `components/tournament/PlayerList.tsx` + 新規 `EditPlayerNameDialog.tsx`（editName/editError/editSaving の 3 state を子 component に移管。PlayerList は editTarget の結線のみに縮小）
- `959b2f5` — **finding-4** stale コメント修正 — `services/tournament-state.ts:205`（存在しない `assertAcceptingProxyEntry` 参照を実関数 `assertAcceptingEntries` に訂正）

すべて 1 commit = 1 finding の atomic 単位。revert 1 つで個別に戻せる。

## 見送った提案（理由付き）

- **finding-5**（`firestore.rules` の member-proxy / name-only ブランチの 6 invariant 行重複）— rule 変更は emulator validation（`test-rules-proxy-create.mjs`）の再走行コストと OR 評価の落とし穴（Phase 5.4 wildcard bug 先例）があり、6 行重複の費用対効果が低いため本サイクルは defer。次に players rule を触る機会に `function` 抽出を再評価する。

## 追加したテスト

- なし（新規 characterization test は不要と判断）。
  - finding-1: `players.test.ts` が 3 経路の `setDoc` 引数形（tableNum null / isPlayingDealer false 等）を既に assert
  - finding-2: `proxy-receipt.test.ts` が getTournament→getGroup mock + 非 organizer / 非 member / finished / late-entry の throw を既に assert
  - finding-3: `PlayerList.test.tsx`（編集導線 6 件）＋ `proxy-receipt.spec.ts` E2E が DOM 面・service 呼出を既に固定（抽出後も**無改変で green**）
  - finding-4: コメントのみ
- いずれも既存テストが観測点を固定済みで、抽出・集約後も同テストが pass することで観測同値を担保した。

## ベースライン vs 最終

| 項目 | Baseline | After |
| --- | --- | --- |
| typecheck | pass | pass |
| lint | pass | pass |
| unit test | 1517 pass / 0 fail（95 files） | 1517 pass / 0 fail（95 files） |
| e2e test（scope: proxy-receipt / clone / playing-dealer） | 6 pass / 0 fail | 6 pass / 0 fail |
| build | pass | pass |

## 観測可能な動作変更が無いことの根拠

- 全変更が内部抽出（factory / helper / component 分割）またはコメント修正で、書込フィールド値・read 順序・read 回数・DOM 面・service 呼出引数を保存。
- 既存 unit 1517 件・scope E2E 6 件（受付代理の名前のみ登録→表示名編集 / メンバー代理登録 / clone / PD を含む）が無改変で全 green。
- 手動 smoke は E2E が受付代理の core フロー（編集ダイアログ含む）を end-to-end で網羅しているため不要と判断。

## 残課題 / Next Step

- finding-5（rule ブランチ重複）の `function` 抽出は将来 players rule を触る際に対応。
- `firebase-patterns.md` の DRIFT WARNING（players 新フィールド追加は 3 ブランチ同期）は finding-1 の factory で repository 側は機械化されたが、**rule 側 3 ブランチは依然手動同期**である点は不変（rule に const/function 機構の制約があるため）。
- 本ブランチは未マージの feature branch のため、受付代理 feature の PR に本 refactor commit 4 件が同梱される。PR 説明には「observable change なし / 全テスト green 維持」を明記すること。
