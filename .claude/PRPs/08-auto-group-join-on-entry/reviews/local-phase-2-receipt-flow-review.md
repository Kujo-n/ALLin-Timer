# ローカルレビュー: 08 Phase 2 — 受付フロー統合（トーナメント受付によるサークル自動所属）

**レビュー日**: 2026-08-01
**対象**: 未コミットの working tree 差分（`feture/auto-group-join` ブランチ）
**判定**: **APPROVE（コメント付き）** — CRITICAL / HIGH なし。検証 4 種すべて Pass

## Summary

Phase 1 の `joinGroupViaTournament` を `receipt.ts` の内部 helper `receiveEntry` に集約し、
通常アカウントの 3 経路（Google / メールログイン / ログイン済み継続）から best-effort で自動所属させる実装。
順序制約（player 作成 → self-add）・匿名除外・失敗時の非ブロッキング化・戻り値の additive 拡張
（`ReceiptResult` → `ReceiptOutcome`）はいずれも設計どおりで、rule 側の前提と矛盾しない。
`firestore.rules` は 1 行も変更されておらず、権限境界の拡大はない（Phase 1 で deploy 済み）。

指摘は MEDIUM 2 件 / LOW 6 件で、いずれもマージをブロックする性質のものではない。

## 対応状況（レビュー後の修正）

| # | 指摘 | 対応 |
| --- | --- | --- |
| M-1 | 自動所属メッセージにダークモード指定がない | **修正済** — `border-emerald-300` + `dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-100` を追加し `SpectateLateEntryBanner` に揃えた |
| M-2 | stale な load でも破壊的 drift 修復が走る | **修正済** — `removeGroupIdFromUser` ループを stale guard の後（かつ state 反映の後）へ移動。回帰テスト 2 件を追加し、**旧順序では落ちること**を実測確認済み |
| L-1 | prettier 未整形 3 件 | **修正済** — 変更 6 ファイルすべて `prettier --check` green |
| L-2 | `groupIds` 補修だけ失敗すると成功表示なのにサークルが見えない | **見送り** — `AutoJoinResult` の API 拡張が必要。直前に同 doc へ `upsertUserProfile` が成功しているため発生窓が極めて狭く、次回受付で自己修復する。将来 Phase で文言分岐が要れば再検討 |
| L-3 | 成功メッセージが「汎用 → サークル名入り」に入れ替わる | **見送り（意図的）** — `await refreshGroups()` を `setStatus` の前に出すと、**受付完了の表示が非クリティカルな group refresh の完了待ちになる**。受付は当日オペレーションのクリティカルパスであり、best-effort 設計の趣旨に反するため現状維持 |
| L-4 | `skipped-anonymous` の UI 分岐に test がない | **修正済** — join-client.test.tsx に 1 件追加（5 状態を網羅） |
| L-5 | E2E のコメントが検証内容と一致していない | **修正済** — 「フルリロード後の永続状態の検証」であることを明記 |
| L-6 | `current-group.tsx` の import 順 | **修正済** — `AuthProvider` → `client` のアルファベット順に修正 |

### 修正後の検証

| Check | Result |
| --- | --- |
| Type check | Pass（0 error） |
| Lint | Pass（0 warning） |
| Tests | Pass — **1615 passed / 103 files**（+3 tests） |
| Build | Pass |
| Format | Pass（変更 6 ファイル green） |

M-2 の回帰テストは、修正前の順序に一時的に戻した状態で
`expect(removeGroupIdFromUser).not.toHaveBeenCalled()` が
`Number of calls: 1` で失敗することを確認済み（vacuous test ではない）。

---

## Findings

### CRITICAL

なし。

- 秘密情報・認証情報のハードコードなし
- 新しい書込経路はすべて Phase 1 で rule 化済み。`firestore.rules` / `firestore.indexes.json` の差分ゼロ
- 匿名アカウント除外は「呼出側が `receiveEntry` を通さない」＋「`joinGroupViaTournament` 内の
  `isAnonymous` ガード」＋「rule の `isSignedInNotAnon()`」の三重防御になっている
- 自動所属の失敗を握りつぶす箇所は `logger.warn` + `code: "group/auto-join-failed"` で記録済み
  （[error-logging.md](../../../rules/error-logging.md) の「握りつぶし禁止」を満たす）

### HIGH

なし。

### MEDIUM

#### M-1: 自動所属メッセージにダークモード指定がない

[src/app/join/\[tid\]/join-client.tsx:218](../../../../src/app/join/%5Btid%5D/join-client.tsx#L218)

```tsx
<p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800">
```

`bg-emerald-50` / `text-emerald-800` に `dark:` variant がないため、ダークテーマ時に
明るい緑のブロックがそのまま出て周囲から浮く。同種の**全幅ステータスバナー**である
[SpectateLateEntryBanner.tsx:62](../../../../src/app/spectate/%5Btid%5D/_components/SpectateLateEntryBanner.tsx#L62) は
`border-emerald-300 bg-emerald-50 ... dark:border-emerald-700 dark:bg-emerald-900/20` を付けており、
`UnseatedPlayersGuide` / `SoundUnlockBanner` / `OfflineBanner` も同じ規約に揃っている
（`bg-emerald-100 text-emerald-800` を dark 指定なしで使っている先例は
`MemberRoleList` / `groups-client` の小さな badge のみ）。

バナー内部のコントラスト比自体は保たれるので WCAG 違反ではないが、Track D で入れたテーマ切替の
一貫性が崩れる。

**修正案**:

```tsx
className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-100"
```

#### M-2: 破棄された（stale な）load でも `removeGroupIdFromUser` の破壊的書込が走る

[src/lib/services/current-group.tsx:96-136](../../../../src/lib/services/current-group.tsx#L96-L136)

`loadFor` の drift 修復ループが、stale 判定（`if (reqIdRef.current !== reqId) return;`）の**前**にある:

```ts
for (const gid of failedGids) {
  await removeGroupIdFromUser(uid, gid).catch(...);   // ← 破壊的書込
}
const liveIds = loadedGroups.map((g) => g.id);
if (reqIdRef.current !== reqId) return;               // ← ガードはこの後
```

本 diff は `inflightUidRef`（uid 一致）→ `reqIdRef`（単調増加カウンタ）へガードを作り替えたが、
このループは対象外のまま。**追い越された古い load でも `users/{uid}.groupIds` から gid を消す**ため、
`getGroup` が一時的に失敗した（permission-denied ではない）ケースで、ユーザーが実際にはメンバーの
サークルが一覧から消える。復旧手段は再受付 / 再招待のみ。

発生条件が「`getGroup` は失敗するが `removeGroupIdFromUser` は成功する」という狭い窓であり、
pre-existing な構造でもあるため MEDIUM 止まりだが、修正はガードをループの前に移すだけで済む:

```ts
const liveIds = loadedGroups.map((g) => g.id);
if (reqIdRef.current !== reqId) return;
for (const gid of failedGids) { ... }   // ← 最新要求のときだけ修復する
```

### LOW

#### L-1: 新規 / 変更ファイル 3 件が prettier 未整形

`./node_modules/.bin/prettier --check` で以下が warn:

- [src/lib/services/receipt.ts](../../../../src/lib/services/receipt.ts) — `auto-group-join` の import が 1 行に収まる
- [src/lib/services/current-group.test.tsx](../../../../src/lib/services/current-group.test.tsx) — `getUserProfile` の mock chain
- [tests/e2e/auto-group-join.spec.ts](../../../../tests/e2e/auto-group-join.spec.ts) — `expect(...)` の折返し多数

差分は整形のみでロジック影響なし。リポジトリ全体では 273 ファイルが未整形（CI で `format:check` は
走っていない）ため既存状況と整合してはいるが、同 diff 内の
[join-client.tsx](../../../../src/app/join/%5Btid%5D/join-client.tsx) /
[join-client.test.tsx](../../../../src/app/join/%5Btid%5D/join-client.test.tsx) は整形済みで揃っていない。
コミット前に該当 3 ファイルだけ `prettier --write` するのが望ましい。

#### L-2: `groupIds` 補修だけ失敗すると「メンバーになりました」と出るのにサークルが見えない

`joinGroupViaTournament` は `addGroupIdToUser` の失敗を内部で warn して握るため、
`outcome === "joined"` のまま返る。この場合 UI は成功メッセージを出すが、
`loadFor` は `users/{uid}.groupIds` を起点にするので `/groups` にもサイドバーにも当該サークルは出ない
（`joinedGroupName` も引けず汎用文言にフォールバックする）。

`status === "failed"` のときだけ出している「次回の受付時に自動で再試行されます」の注記が、
このケースにはかからない。次回受付で `addGroupIdToUser` が無条件リトライされるので自己修復はするが、
その場のユーザーには何も伝わらない。

`AutoJoinResult` に `groupIdsBackfilled: boolean` を足して UI 文言を分けるのが素直だが、
発生確率が低い（直前に `upsertUserProfile` で同じ doc に成功している）ため据え置きでも可。

#### L-3: 成功メッセージが「汎用 → サークル名入り」に一瞬入れ替わる

[join-client.tsx:87-101](../../../../src/app/join/%5Btid%5D/join-client.tsx#L87-L101) は
`setStatus` を先に呼び、その後 `await refreshGroups()` する。初回描画時点では `groups` に新サークルが
まだ無いため「サークルのメンバーになりました。」が出て、refresh 後に
「◯◯ のメンバーになりました。」へ差し替わる。`role="status"` は live region なので、
スクリーンリーダーが 2 回読み上げる可能性がある。

`await refreshGroups()` を `setStatus` の前に置く（または `autoJoin.status === "joined"` のときだけ
先に await する）と 1 回で確定する。

#### L-4: `skipped-anonymous` の UI 分岐に unit test がない

[join-client.test.tsx](../../../../src/app/join/%5Btid%5D/join-client.test.tsx) は
`joined` / `failed` / `already-member` / `null` の 4 状態を網羅しているが、`skipped-anonymous` がない。
`/join/[tid]` の現行 UI では非匿名ガードにより到達しないものの、
`joinAsCurrentUser` は `/live` の「参加する」から匿名でも呼ばれ得る型なので、
「メッセージを出さない・`setCurrentGroupId` も `refreshGroups` も呼ばない」を固定しておくと安全。

#### L-5: E2E のコメントが検証内容と一致していない

[tests/e2e/auto-group-join.spec.ts:76-79](../../../../tests/e2e/auto-group-join.spec.ts#L76-L79)

```ts
// サイドバーにも即反映されている（setCurrentGroupId + refreshGroups の効果）
await expect(memberPage.getByRole("link", { name: GROUP_NAME })).toBeVisible();
```

直前に `memberPage.goto("/groups")` でフルリロードしているため、この assert が見ているのは
**Firestore に永続化された結果**であって、`setCurrentGroupId` / `refreshGroups` によるページ内即時反映ではない
（即時反映は join-client の unit test が呼出 assert で担保している）。
コメントを実態に合わせるか、`goto` を挟まずステータス画面のままサイドバーを見るのが正確。

#### L-6: `current-group.tsx` の import 順

[current-group.tsx:15-16](../../../../src/lib/services/current-group.tsx#L15-L16) で
`@/lib/firebase/client` が `@/lib/firebase/AuthProvider` の前に入り、同ファイル内の
アルファベット順が崩れている（lint ルールはないので機械検出されない）。

### 情報共有（指摘ではない）

- **`/live`「参加する」/ setup「自分も参加する」も自動所属する** — `joinAsCurrentUser` 経由のため
  service 層では効くが、フィードバック表示も `refreshGroups` もない。
  これは plan の「NOT Building」で明示的にスコープ外と宣言されており、意図どおり。
  非メンバーが `/live` 直リンクから参加した場合、サイドバーへの反映は次回ナビゲーションまで遅れる
- **`firestore.rules` 変更ゼロ** — 本 Phase は rule に触れていないため、追加の
  `firebase deploy --only firestore:rules` は不要。Phase 1 分は実行済みとレポートに記録あり
- **[group-membership.md](../../../rules/group-membership.md) への追記は妥当** — 呼出経路・順序制約・
  best-effort 方針・DRIFT WARNING（Phase 3 は `receiveEntry` を経由させる）が揃っている

## Validation Results

| Check       | Result | 備考 |
| ----------- | ------ | ---- |
| Type check  | Pass   | `npm run typecheck` — 0 error |
| Lint        | Pass   | `npm run lint` — 0 warning / 0 error |
| Tests       | Pass   | `npm test` — **1612 passed / 103 files**（レポート記載と一致） |
| Build       | Pass   | `npm run build` — 成功 |
| Format      | Fail   | `format:check` で変更 3 ファイルが warn（L-1・整形のみ） |
| E2E         | 未実行 | 本レビューでは走らせていない。レポートは 111 passed / 3 skipped と記載 |
| Rules       | 変更なし | `git diff firestore.rules` 空 |

## Files Reviewed

| ファイル | 種別 |
| --- | --- |
| [src/lib/services/receipt.ts](../../../../src/lib/services/receipt.ts) | Modified |
| [src/lib/services/receipt.test.ts](../../../../src/lib/services/receipt.test.ts) | Modified |
| [src/lib/services/current-group.tsx](../../../../src/lib/services/current-group.tsx) | Modified |
| [src/lib/services/current-group.test.tsx](../../../../src/lib/services/current-group.test.tsx) | Added |
| [src/app/join/\[tid\]/join-client.tsx](../../../../src/app/join/%5Btid%5D/join-client.tsx) | Modified |
| [src/app/join/\[tid\]/join-client.test.tsx](../../../../src/app/join/%5Btid%5D/join-client.test.tsx) | Added |
| [src/app/tournaments/\[tid\]/live/live-client.test.tsx](../../../../src/app/tournaments/%5Btid%5D/live/live-client.test.tsx) | Modified（mock 追従のみ） |
| [tests/e2e/auto-group-join.spec.ts](../../../../tests/e2e/auto-group-join.spec.ts) | Added |
| [.claude/rules/group-membership.md](../../../rules/group-membership.md) | Modified |
| [.claude/PRPs/08-auto-group-join-on-entry/prds/08-auto-group-join-on-entry.prd.md](../prds/08-auto-group-join-on-entry.prd.md) | Modified（Phase 2 を complete に） |
| [.claude/PRPs/08-auto-group-join-on-entry/plans/completed/phase-2-receipt-flow-integration.plan.md](../plans/completed/phase-2-receipt-flow-integration.plan.md) | Added |
| [.claude/PRPs/08-auto-group-join-on-entry/reports/phase-2-receipt-flow-integration-report.md](../reports/phase-2-receipt-flow-integration-report.md) | Added |
