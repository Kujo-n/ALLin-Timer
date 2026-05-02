# Local Code Review: Phase 5.1 — ドライラン #1 UX / バグ Polish

**Reviewed**: 2026-05-02
**Branch**: `feature/phase5`（uncommitted、HEAD = `5ad1039`）
**Scope**: `git diff --name-only HEAD` → 32 ファイル変更 + 7 ファイル新規（実装計画 / 報告含む）
**Decision**: **REQUEST CHANGES**（HIGH 1 件 / MEDIUM 4 件。Validation はすべて green）

---

## Summary

Phase 5.1 は PD（プレイングディーラー）モデル導入・初回席決め / late entry のランダム化・匿名ゲスト動線完結・暗黙音声 unlock・参加中トーナメント nav の 6 系統を additive に重ねた大規模 polish。Service / engine / orchestrator / repository / rule / UI のすべてに広範な変更があるが、

- 既存テスト 33 ファイル / 649 ケース全 green、typecheck / lint / build もクリーン
- 純関数（`pd.ts` / `engine.ts`）を**先行 characterization** し、tx 副作用を `orchestrator.ts` に集約する設計分離は規約通り
- `firestore.rules` の self / organizer 分岐に `isPlayingDealer` を additive に統合し、self-immutable + organizer bool 強制 + legacy `.get(..., false)` 互換まで網羅

実装品質は高い一方、**`subscribePlayersByUid` の collectionGroup query に必要な Firestore single-field index が `firestore.indexes.json` に追加されていない**ため、本番で `JoinedTournamentsNav` が黙って壊れる懸念があり HIGH 扱い。加えて `players` create rule に `isPlayingDealer` 制約が無いため self-stamp PD を許してしまう MEDIUM の rule 抜けがある。

---

## Findings

### CRITICAL
None.

### HIGH

#### H1. `firestore.indexes.json` に `players.uid` の collectionGroup インデックスが無い → 本番 `JoinedTournamentsNav` 破綻

**File**: [firestore.indexes.json](firestore.indexes.json) / [src/lib/firebase/repositories/playersByUid.ts:34](src/lib/firebase/repositories/playersByUid.ts#L34)

`subscribePlayersByUid` は次のクエリを発行する:

```ts
query(collectionGroup(firestore, "players"), where("uid", "==", uid))
```

Firestore の collection-scope の単一フィールド index は自動で作成されるが、**collection-group scope の単一フィールド index は明示的に opt-in する必要がある**（firestore.indexes.json の `fieldOverrides` 経由、または Firebase Console で手動作成）。現状 `firestore.indexes.json` は空 (`indexes: []` / `fieldOverrides: []`) のため、ローカルエミュレータでは動くが**本番で初回 query 時に `failed-precondition: The query requires an index` で reject される**。

`JoinedTournamentsNav.tsx` の `onError` は `setJoinedTids([])` に倒すため UI には何も出ず、ユーザー視点では「参加中のトーナメント section が空のまま」という silent failure になる。Firebase Console の error 通知を見るまで気付かない。

**Suggested fix**: `firestore.indexes.json` に以下を追加し、デプロイ手順（README）にも記載:

```json
{
  "indexes": [],
  "fieldOverrides": [
    {
      "collectionGroup": "players",
      "fieldPath": "uid",
      "indexes": [
        { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }
      ]
    }
  ]
}
```

E2E に「他 group のトーナメント参加 → サイドバーに表示」を含めるか、最低限デプロイ前に index 反映確認を手順化する。

---

### MEDIUM

#### M1. `players` create ルールに `isPlayingDealer` 制約が無い → self-stamp PD で setup 同卓制約をバイパス可能

**File**: [firestore.rules:323-328](firestore.rules#L323-L328)

```cel
allow create: if isSignedIn()
              && pid == request.auth.uid
              && request.resource.data.uid == request.auth.uid
              && request.resource.data.isBusted == false
              && request.resource.data.tableNum == null
              && request.resource.data.seatNum == null;
```

create 経路で `isPlayingDealer` をチェックしていないため、認証済みクライアントが SDK 直叩きで `isPlayingDealer: true` を含む player doc を作成できる。self-update 分岐は immutable 強制（[firestore.rules:353-354](firestore.rules#L353-L354)）するが、create 時の値は通る。

具体的シナリオ: 匿名ゲストが `/join/{tid}` を介さず `addDoc` を直接呼んで自分を PD として作成 → 同卓 1 PD 制約は orchestrator の `setIsPlayingDealer` tx でしか効かない → 複数 PD が登録されると `commitInitialSeating` で `TooManyPlayingDealersError` が発生し席決めが進められない（DoS）。

なお `upsertPlayer` ([repositories/players.ts:85-95](src/lib/firebase/repositories/players.ts#L85-L95)) は正しく `isPlayingDealer: false` で初期化しているため通常経路では問題ない。あくまで「rules 単体で防衛できているか」の問題。

**Suggested fix**: create 分岐に `request.resource.data.get('isPlayingDealer', false) == false` を追加（legacy doc 互換のため `.get(..., false)` 形）。

```cel
allow create: if isSignedIn()
              && pid == request.auth.uid
              && request.resource.data.uid == request.auth.uid
              && request.resource.data.isBusted == false
              && request.resource.data.tableNum == null
              && request.resource.data.seatNum == null
              && request.resource.data.get('isPlayingDealer', false) == false;
```

`scripts/test-rules-pd.mjs` に「ケース 7: self が isPlayingDealer=true で create → deny」を追加する。

---

#### M2. `PlayerList.onTogglePd` が `tableMates=[]` を常に渡す前提が壊れたとき同卓 PD 制約が働かない

**File**: [src/app/tournaments/[tid]/dashboard-client.tsx:382-392](src/app/tournaments/[tid]/dashboard-client.tsx#L382-L392) / [src/lib/services/seating/orchestrator.ts:613-617](src/lib/services/seating/orchestrator.ts#L613-L617)

dashboard が `<PlayerList onTogglePd>` に渡す callback は **無条件で `tableMates=[]`** を渡している:

```tsx
onTogglePd={async (player, value) => {
  // setup 中は tableNum=null のため tableMates は空配列でよい。
  await setIsPlayingDealer(tid, user.uid, groupIds, player.id, value, []);
}}
```

`PlayerList.tsx:75-76` で「showPdCheckbox は setup 中のみ」と UI gate されているため**実運用では問題が出ない**が、`setIsPlayingDealer` の setup 分岐 ([orchestrator.ts:613-617](src/lib/services/seating/orchestrator.ts#L613-L617)) は「`p.tableNum === null` ならフラグだけ立てる」という挙動で、もし将来 `PlayerList` の visibility 条件が変わって seating 以降にも露出した場合、空 `tableMates` が渡って同卓検証が完全 skip される。

```ts
// ON: setup 中なら tableNum=null で同卓検証は不要（フラグだけ立てる）。
if (p.tableNum === null) {
  tx.update(pRef, { isPlayingDealer: true });
  return;
}
```

UI と service の両方に gate がある二重防御の意図はわかるが、PlayerList 側で **player の `tableNum` を見て同卓 ID 配列を組み立てる**構造（SeatingBoard 側と同じ実装）に揃えると安全寄り。

**Suggested fix**: 簡単な方は dashboard-client の `onTogglePd` で `player.tableNum !== null` のときに同卓 ID を埋める:

```tsx
onTogglePd={async (player, value) => {
  const tableMates = player.tableNum !== null
    ? players.filter(q => q.id !== player.id && !q.isBusted && q.tableNum === player.tableNum).map(q => q.id)
    : [];
  await setIsPlayingDealer(tid, user.uid, groupIds, player.id, value, tableMates);
}}
```

これで PlayerList の visibility が将来変わっても安全側に倒せる。SeatingBoard 経路 ([dashboard-client.tsx:350-369](src/app/tournaments/[tid]/dashboard-client.tsx#L350-L369)) と同じ構造。

---

#### M3. `setIsPlayingDealer` の `tablePlayerIds` snapshot に「直前の同卓追加」が含まれない race window

**File**: [src/lib/services/seating/orchestrator.ts:574-672](src/lib/services/seating/orchestrator.ts#L574-L672)

呼出側（dashboard-client）が subscribe snapshot から「同卓 player ID（自身を除く）」を抽出して引数で渡すパターン。tx 内で各 ID を tx.get で再 read することで PD 重複は検出できるが、**snapshot 取得後・本 tx の tx.get 開始前に同卓へ別 player が新規 add され、その新 player が `isPlayingDealer=true` をすでに保持している**race は捕まえられない。

具体的には:

1. 端末 A が snapshot で `tableMates = [b, c]` を取得
2. 端末 B が同卓に新 player `d` を `isPlayingDealer=true` で seat（M1 経路で create + organizer が seat assign など）
3. 端末 A の tx が `[b, c]` だけを tx.get で確認 → 他 PD 不在と判定
4. 端末 A が自分を PD ON → 同卓に PD 2 名

実際には PD ON は organizer 操作前提（rule で member は他人 PD 触れない）+ PD ON 操作頻度は低いため発生確率は低い。**ただし 1 卓 1 PD は engine の前提条件**であり、ここが壊れると `planBalancingMove` の PD 除外ロジック等が想定外の挙動になる可能性。

**Suggested fix**（軽量）: tx 内で「対象 player の tableNum を再 read」した後、**その tableNum で `players` collection を where("tableNum","==", n) で再 query する** か、または **少なくとも `tablePlayerIds` 引数を渡さず tx 内で読み直す** 形に変更する。20 人スケールでは 9 read/tx でも許容範囲。あるいは「PD ON は organizer のみ」+「organizer 同士の同卓 race は手動運用で防ぐ」と割り切るなら、**コメントで race window を明記する**だけでもよい（現状はコメントがない）。

---

#### M4. `pinPlayingDealersToSeat1` が production code から呼ばれていない（dead code）

**File**: [src/lib/services/seating/pd.ts:27-49](src/lib/services/seating/pd.ts#L27-L49)

```ts
/**
 * 既に Task 3 で `planInitialSeating` 内部に PD 配分ロジックを組み込むため、
 * このヘルパは単独では呼び出さない（互換 / 拡張用に export しておく）。
 */
export function pinPlayingDealersToSeat1(...) {
```

コメントで「将来用」と明示されており、テストもあるが、現時点で `engine.planInitialSeating` 自体が PD 配分を内製しているため呼び出し元がない。CLAUDE.md「Don't add features beyond what the task requires」「YAGNI」方針から見て削除候補。

**Suggested fix**: 削除する（テストも併せて削除。`planPlayingDealerShift` は `setIsPlayingDealer` から呼ばれているので残す）。あるいは「将来 `planInitialSeating` を 2 段階分離する場合の hook」として明示的に Phase 5.2+ の TODO に紐付けて残す。

---

### LOW

#### L1. `bustPlayer` が同卓全員に `isPlayingDealer=false` を無条件 batch 書込（PD 不在卓でも）

**File**: [src/lib/firebase/repositories/players.ts:144-150](src/lib/firebase/repositories/players.ts#L144-L150)

同卓 PD は最大 1 名しか居ないが、現実装は `sameTablePlayerIds` 全員に `{ isPlayingDealer: false }` を書く。9 席満卓で bust するたび 9 writes（自分 + 同卓 8 名分）になる。20 人 / 月 1〜2 回スケールでは無視可能だが、PD ID を呼出側で 1 件抽出して渡せば書込 2 件で済む。

**Suggested fix**: 呼出側（`dashboard-client.tsx` の `onTogglePd` のような場所、もしくは `PlayerList.tsx:136-147` の bust button への引数）で `players.find(q => q.tableNum === p.tableNum && q.isPlayingDealer)` 1 名だけ ID として渡す。LOW 扱いなので保留可。

#### L2. `subscribePlayersByUid` が `zodConverter` を使わず `playerBodySchema.parse` を直接呼ぶ

**File**: [src/lib/firebase/repositories/playersByUid.ts:41](src/lib/firebase/repositories/playersByUid.ts#L41)

[firebase-patterns.md](.claude/rules/firebase-patterns.md#L43-L48) は「各 collection は `zodConverter(schema, "collectionName")` で withConverter 適用」を要求している。collectionGroup は path が動的なので converter を使い辛い事情はあるが、ファイル冒頭コメントで理由を明示してあるため許容範囲。invalid doc 単一スキップ + warn ロジックも妥当。**情報共有**として記録のみ、修正必須ではない。

#### L3. `applyTableBreak` が閉鎖卓 player の `isPlayingDealer=false` を強制 → 移動先で再 PD 指定が必要

**File**: [src/lib/services/seating/orchestrator.ts:528-535](src/lib/services/seating/orchestrator.ts#L528-L535)

```ts
// Phase 5.1: 閉鎖卓 player は移動先で PD 衝突を起こさないよう isPlayingDealer=false に倒す。
tx.update(doc(playersRef(tid), m.playerId), {
  tableNum: m.to.tableNum,
  seatNum: m.to.seatNum,
  lastMovedAt: ts,
  isPlayingDealer: false,
});
```

設計選択として正しい（移動先卓の PD と衝突しないため）が、運営者視点では「閉鎖前の卓で PD だった player がそのまま移動先で PD のままだと思っていた」という UX ギャップが生じうる。Phase 5.1 報告の Deviations にも明記なし。**運営者向けマニュアル / リリースノートに「卓閉鎖時は PD 指定がリセットされます」を 1 行記載**するだけで十分。

---

## Validation Results

| Check                          | Result | Notes |
| ------------------------------ | ------ | ----- |
| Type check (`tsc --noEmit`)    | Pass   | 0 errors |
| Lint (`next lint`)             | Pass   | 0 warnings |
| Tests (`vitest`)               | Pass   | 33 files / 649 tests |
| Build (`next build`)           | Pass   | 全ルート（15 routes）正常生成 |
| Rules limits drift (`test:rules-limits`) | Pass | 6/6 OK |
| Firestore Rules emulator (`scripts/test-rules-pd.mjs`) | Skipped | 手動実行（emulator 起動が必要）。本レビュー対象外 |
| E2E (`playwright`)             | Skipped | コマンド指定なし。Phase 5.1 計画でも本レビューでは不要 |

---

## Files Reviewed (重点)

### 新規 (7)
- `src/lib/services/seating/pd.ts` / `pd.test.ts` — 純関数 PD ロジック（characterization 11 ケース、十分網羅）
- `src/lib/firebase/repositories/playersByUid.ts` — collectionGroup 経由の参加 tournament 購読 → **H1 該当**
- `src/lib/hooks/useImplicitAudioUnlock.ts` — 暗黙 audio unlock。`{ once: true, capture: true }` 経由で listener 自己解除し React strict mode 二重 mount に強い設計
- `src/components/nav/JoinedTournamentsNav.tsx` — tids 集合 → 個別 tournament subscribe の差分管理。memory leak なし（`unsubsRef` cleanup 確認）
- `scripts/test-rules-pd.mjs` — emulator validator 6 ケース。**M1 該当の create deny ケースを 1 件追加推奨**

### 既存更新（重点 32 のうち）
- `firestore.rules` — players self / organizer 分岐 `isPlayingDealer` 統合。**create 分岐の追加 M1**
- `src/lib/firebase/schemas/player.ts` — `isPlayingDealer: z.boolean().default(false)` additive、互換性 OK
- `src/lib/firebase/repositories/players.ts` — `bustPlayer` writeBatch 化、self skip + 同卓 OFF。LOW L1
- `src/lib/services/seating/engine.ts` — PD 配分 + random seat、`TooManyPlayingDealersError`、`planLateEntrySeat` seed 引数。テスト網羅性高い
- `src/lib/services/seating/orchestrator.ts` — `setIsPlayingDealer`（**M3**）、`commitInitialSeating` PD ID 抽出、`autoSeatLateEntry` state guard 緩和、`applyTableBreak` PD reset（L3）
- `src/lib/services/tournament-state.ts` — `isAcceptingLateSeats` 純関数追加、コメント明確
- `src/components/nav/AppShell.tsx` / `HeaderMenuButton.tsx` / `PrimaryNav.tsx` — 匿名 gate 設計。整合あり
- `src/components/tournament/SeatingBoard.tsx` / `PlayerList.tsx` — PD checkbox 出し分け。**M2 該当**（PlayerList の onTogglePd 引数）
- `src/app/tournaments/[tid]/live/live-client.tsx` — 匿名 redirect + self-delete 並行設計。レポートの Deviations 通り
- `src/app/join/[tid]/join-client.tsx` — 匿名は受付完了画面で動線完結。OK
- `src/lib/services/auth-actions.ts` — `signInWithGoogle` 戻り値に `needsDisplayNameSetup` 追加、fail-safe で best-effort

---

## Required Actions (merge gate)

1. **[H1]** `firestore.indexes.json` に `players.uid` の collection-group field override を追加し、**本番デプロイ前に index 反映を確認**する手順を README に記載する
2. **[M1]** `firestore.rules` の players create 分岐に `isPlayingDealer` 制約を追加 + `scripts/test-rules-pd.mjs` に self create deny ケース追加

## Recommended Actions (post-merge OK)

3. **[M2]** `dashboard-client.tsx` の PlayerList 用 `onTogglePd` を SeatingBoard 経路と同じ構造（`tableMates` 計算）に揃える
4. **[M3]** `setIsPlayingDealer` の race window をコメントで明示するか、tx 内で同卓 player を再 query する設計に切り替えるか判断
5. **[M4]** `pinPlayingDealersToSeat1` の dead code を削除するか TODO で将来用途に紐付ける
6. **[L3]** リリースノート / 運営マニュアルに「卓閉鎖時は PD 指定がリセットされる」と記載

---

## Notes

- `pd.ts` / `engine.ts` の characterization test を**先行投入**してから副作用層を切り替える流れは、CLAUDE.md および [testing.md](.claude/rules/testing.md#L48-L66) の architect-refactor 原則そのもの。今回は新機能だが同じ流儀で組まれており品質高い
- `useSeatingAutoOrchestrator` の `useEffect` deps は fingerprint 化済みで Phase 4 の H3 fix と同じ防御パターン
- `firestore.rules` の self-* 分岐 `affectedKeys().hasOnly([...])` は Phase 4.16 で塞いだ穴を継承しており、`isPlayingDealer` 追加でも穴が空かない設計
- `attemptAnonymousSelfDelete` は best-effort + 戻り値で signOut skip 判定、二重 throw 防止できている
