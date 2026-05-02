# Plan: Phase 5.1 — ドライラン #1 で判明した UX / バグ Polish 一括対応

## Summary

Phase 5（Field Test & Polish）の **1 回目のドライランで実際に発生した** UX 摩擦・バグ 9 件（[tmp/13_Phase5_memo.md](../../../tmp/13_Phase5_memo.md)）と、追加ヒアリングで深掘りされた 2 件の方針確定（**座席確定後 (state=seating) の自動配席遅延の解消**・**ゲスト匿名は受付完了画面のみで `/live` には進ませない設計に転換**）を 1 つのサブフェーズに集約して片付ける。schema / Firestore Rules / Service / UI の各層を最小限の差分で更新し、既存の architect-refactor で確立した規約（`useGroupRole` / `wrap.ts` / `tournament-state.ts` の純関数 / characterization test ファースト）に沿わせる。Phase 5.1 完了後に **2 回目のドライラン**を実施し、PRD Success Metric「サークルで 3 回連続使用」の積み上げを継続する。

## User Story

As a サークル運営者および参加者,
I want 初回 Google ログイン時の displayName 設定・運営機能のゲスト隠蔽・ハンバーガー導線・参加トーナメントの即時アクセス・PD（プレイングディーラー）フラグでの席 1 固定・席配置の TDA 準拠化・座席確定後 (seating 状態) の即時自動配席・autoplay unlock の暗黙化・ゲスト匿名は受付完了画面のみで完結するシンプル動線,
So that 2 回目以降のドライランでトーナメント運営と参加体験が破綻せず、Phase 5 仮説検証（3 回連続使用）の積み上げを継続できる状態にする。

## Problem → Solution

[現状] **1 回目のドライランで** memo の 9 件のペインが顕在化し、運営者・参加者双方の動線にブロッカーが残っている。追加ヒアリングで 2 件の方針が確定した:

1. **memo 9 件（ドライラン #1 で発生した実問題）**（initial seating 連番 / PD 未対応 / sound unlock の必須クリック / `/live` の hamburger 死 / 一般メンバーの参加トーナメント sidebar 不在 / ゲストにメニュー露出 / 初回 Google ログインの displayName dialog 未表示 / 座席確定後 late entry の遅延 / 招待コード参加者の戻り経路欠如）
2. **追加方針 1 — 座席確定後の自動配席遅延**: `useSeatingAutoOrchestrator` は `state === "running" || "paused"` のときのみ発火するため、**座席確定 (state="seating") 後にレイトエントリーがあっても、運営者がトーナメント開始 (state="running") に遷移するまで未配席のまま**。Task 6.5 で `seating` 発火条件を加える
3. **追加方針 2 — ゲスト匿名は `/live` 不要**: memo 9（招待コード参加で戻れない）の根本解決として、**ゲスト匿名は受付完了画面で動線完結**、`/live` を見せない設計に転換

→ [目標] サブフェーズ Phase 5.1 で 11 件全てを additive な schema 拡張＋既存パターン踏襲で解消し、**2 回目のドライラン**に進める状態にする。

## Metadata

- **Complexity**: Large
- **Source PRD**: [.claude/PRPs/prds/allin-timer.prd.md](../prds/allin-timer.prd.md)
- **PRD Phase**: Phase 5（Field Test & Polish）— 1 回目のドライラン後の bug fix / UX 磨き込みサブフェーズ
- **Estimated Files**: 約 25 ファイル（schema 1 / rules 1 / repositories 3 / services 3 / hooks 3 / components 8 / pages 3 / tests 12）
- **Trace**: [tmp/13_Phase5_memo.md](../../../tmp/13_Phase5_memo.md)（ドライラン #1 で運営者から出た改善要望 9 件のメモ）+ 追加ヒアリング 2 件（座席確定後の遅延・ゲスト匿名は受付完了のみ）+ PD ヒアリング（player フラグ方式 + 席 1 固定 + bust 時 PD auto-OFF + 1 卓 1 PD 制約）

---

## UX Design

### Before（ドライラン #1 で発生した状態）

```
┌───────────────────────────────────────────────────────────────────────┐
│ 初回 Google ログイン                                                   │
│   → DisplayNameDialog が出ない（既存ユーザー扱いで isNewUser=false）   │
│ /live を開いた参加者                                                   │
│   → ハンバーガーボタン押下 → 何も起きない（AppShell が早期 return）   │
│ ゲスト匿名（receipt 経由）                                             │
│   → 受付完了 → 「タイマー画面へ」ボタン → /live 遷移                   │
│   → ハンバーガー＋ホームのみのサイドバーが見える                       │
│   → 画面を閉じると復帰経路なし（招待コード起点なら特に詰む）           │
│ 一般メンバー                                                           │
│   → サイドバーは「サークル / トーナメント一覧」止まり                  │
│   → 自分が参加中のトーナメントが見えない                                │
│ PD 運用                                                                │
│   → 「PD はいつも卓 1 の席 1 でやる」を毎回手動で覚えてもらう           │
│   → バランシングで PD が動かされる事故もありうる                       │
│ 初回席決め（12 人 / 2 卓）                                              │
│   → seat 1,2,3,4,5,6 と詰めて固定 → 途中参加 BB ポジション再現不可     │
│ 座席確定後の追加参加（state=seating 中のレイトエントリー）             │
│   → 受付の「参加者」リストには名前が出る                               │
│   → 「Table List（座席表）」には反映されない                            │
│   → 運営者がトーナメント開始 (state=running 遷移) を押した瞬間に        │
│     useSeatingAutoOrchestrator が初めて発火 → ようやく座席表に登場     │
│ 音声通知                                                               │
│   → 明示「サウンドを有効化」ボタンを押さない限り無音                   │
└───────────────────────────────────────────────────────────────────────┘
```

### After

```
┌───────────────────────────────────────────────────────────────────────┐
│ 初回 Google ログイン                                                   │
│   isNewUser OR users/{uid} 不存在 OR displayName 空 ⇒ Dialog 必須表示  │
│ /live のハンバーガー                                                   │
│   AppShell 早期 return を撤廃、`/live` でも sidebar を render          │
│ ゲスト匿名                                                             │
│   /join → 「受付が完了しました」のみのシンプル完了画面で終了           │
│   /live への「タイマー画面へ」ボタンを撤去                              │
│   /live 直接アクセスは / にリダイレクト                                │
│   ハンバーガーボタン非表示、サイドバーも render skip                   │
│ 一般メンバー                                                           │
│   サイドバーに「参加中のトーナメント」サブ section を新設              │
│   collectionGroup `players` を `where("uid","==",auth.uid)` で購読     │
│ PD（プレイングディーラー）                                             │
│   players/{pid}.isPlayingDealer: boolean フラグで管理（1 卓 1 PD）      │
│   SeatingBoard 各席にチェックボックス                                  │
│   ON: 該当 player を席 1 へ rotation（元 1..元PD席-1 を 1 つずつ後ろへ）│
│   OFF: 席はそのまま（フラグだけ降りる）                                │
│   bust 時: 該当卓の全 player の isPlayingDealer を auto-OFF             │
│   table break 時: 閉鎖卓の全 player の isPlayingDealer を auto-OFF      │
│   バランシング: PD を移動候補から除外                                  │
│ 初回席決め                                                             │
│   PD 指定 player は該当 table の席 1 に固定                            │
│   その他 player は seat [2..seatsPerTable] からランダム抽選            │
│   late entry: 既存席を保持 + 空席ランダム抽選                          │
│   useSeatingAutoOrchestrator: state=seating でも自動配席を発火         │
│ 音声通知                                                               │
│   document level の `pointerdown` を 1 回検出した時点で AudioContext   │
│   resume を試みる（明示ボタンは fallback として残置）                  │
└───────────────────────────────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| --- | --- | --- | --- |
| `/login`（初回 Google） | DisplayNameDialog 未表示で / に飛ぶ | Dialog 必須表示 → 名前入力 → / に redirect | `getUserProfile` 不存在 / `displayName` 空 も dialog 発火条件に追加 |
| `/live` ハンバーガー（一般メンバー） | クリック無反応 | sidebar が出てホーム / 参加中トーナメント等にアクセス可 | fullscreen pattern を撤廃 |
| `/live` への匿名アクセス | /live が表示される | / に redirect | `useAuthUser().user.isAnonymous` を見て live-client が早期 redirect |
| `/join/{tid}` 完了画面（匿名） | 「タイマー画面へ」「参加を取り消す」 | 「受付が完了しました」テキスト + 小キャンセルのみ | 「タイマー画面へ」を匿名時は撤去 |
| Header（ゲスト匿名） | hamburger 表示 | hamburger 非表示・skip-link / brand のみ | `useAuthUser().user.isAnonymous` で gate |
| Sidebar（一般メンバー） | 参加中トーナメント不在 | 「参加中」section を group 配下サブナビと並列で表示 | collectionGroup query 経由 |
| SeatingBoard | 各席に displayName のみ | 各席に displayName + PD チェックボックス | 1 卓 1 PD 制約で他席のチェックは ON 時に disable |
| PD ON | 既存席 fixed | 該当 player を席 1 へ rotation（元 1..元PD席-1 を 1 つずつ後ろへ） | `setIsPlayingDealer` の tx 内で同一卓内 move を atomic に commit |
| PD OFF | （存在しない） | フラグだけ降ろす（席は変えない） | 席を戻したいなら手動席移動 UI で対応 |
| 初回席決め | 1..N 連番固定 | PD は席 1、他は seat [2..seatsPerTable] からランダム抽選 | 12人/2卓で seat 集合 [1, 3, 5, 6, 8, 9] のような skip 配置 |
| 途中参加 | 既存維持 + 最小空席 | 既存維持 + 空席ランダム（最小空席バイアス除去） | seat 競合 race 制御は既存 tx 内 seat-taken guard を再利用 |
| バランシング (差分≥2) | 過剰卓の最小席番号 player を移動 | PD を除外して最小席番号 player を移動 | 過剰卓全員 PD のときは null（バランシング不能） |
| バスト | seat null + busted=true | seat null + busted=true + **同卓全員の isPlayingDealer=false** | bust → PD 不在状態を運営者が手動再指名 |
| テーブル閉鎖 | 全 player を移動 | 全 player を移動 + **閉鎖卓全員の isPlayingDealer=false** | 移動先で複数 PD が並ぶ事故を予防 |
| 座席確定後 (state=seating) のレイトエントリー | 開始 (running 遷移) まで配席されない | seating 中も自動配席 → 1〜2 秒で座席表に反映 | `useSeatingAutoOrchestrator` の state guard と `autoSeatLateEntry` の tx 内 state guard の両方を緩和 |
| 音声通知 | 明示「有効化」ボタン押下必須 | document `pointerdown` で暗黙 unlock + 既存ボタンは fallback | 失敗時 (Safari 等) は明示ボタン経路に倒れる |

---

## Mandatory Reading

| Priority | File | Lines | Why |
| --- | --- | --- | --- |
| P0 | [.claude/rules/firebase-patterns.md](../../rules/firebase-patterns.md) | all | repository / converter / wrap helper / 数値リミット集約規約 |
| P0 | [.claude/rules/error-logging.md](../../rules/error-logging.md) | all | `AppError.from` / `unwrapOrFrom` / `getErrorCode` の使い分け |
| P0 | [.claude/rules/group-membership.md](../../rules/group-membership.md) | all | role 判定 / `useGroupRole` / `affectedKeys().hasOnly([...])` |
| P0 | [.claude/rules/testing.md](../../rules/testing.md) | all | mock 境界・characterization test ファースト・fixture factory |
| P1 | [src/lib/services/seating/engine.ts](../../../src/lib/services/seating/engine.ts) | 1-279 | planInitialSeating / planLateEntrySeat / planBalancingMove / planTableBreak の既存形 |
| P1 | [src/lib/services/seating/orchestrator.ts](../../../src/lib/services/seating/orchestrator.ts) | 1-539 | tx + race guard パターン / `commitInitialSeating` / `autoSeatLateEntry` / `applyTableBreak` |
| P1 | [src/lib/services/seating/prng.ts](../../../src/lib/services/seating/prng.ts) | all | seed-driven shuffle |
| P1 | [src/lib/firebase/repositories/players.ts](../../../src/lib/firebase/repositories/players.ts) | 1-201 | `bustPlayer` の seat null リセット挙動（PD auto-OFF と統合する起点）|
| P1 | [src/lib/hooks/useAudioPlayer.ts](../../../src/lib/hooks/useAudioPlayer.ts) | 1-202 | AudioContext + `useSyncExternalStore` の現状実装 |
| P1 | [src/lib/audio/audio-context.ts](../../../src/lib/audio/audio-context.ts) | 1-81 | AudioContext singleton と `resumeAudioContext` |
| P1 | [src/components/nav/AppShell.tsx](../../../src/components/nav/AppShell.tsx) | 1-73 | fullscreen pattern と sidebar の早期 return |
| P1 | [src/components/nav/PrimaryNav.tsx](../../../src/components/nav/PrimaryNav.tsx) | 1-225 | サイドバーのアクティブ表示 / sub link 構築 |
| P1 | [src/components/nav/nav-items.ts](../../../src/components/nav/nav-items.ts) | all | nav item の gate ロジック |
| P1 | [src/app/login/login-client.tsx](../../../src/app/login/login-client.tsx) | 1-239 | DisplayNameDialog の発火条件 |
| P1 | [src/lib/services/auth-actions.ts](../../../src/lib/services/auth-actions.ts) | 100-200 | `signInWithGoogle` / `additionalUserInfo.isNewUser` |
| P1 | [src/app/tournaments/[tid]/live/live-client.tsx](../../../src/app/tournaments/[tid]/live/live-client.tsx) | 1-289 | `/live` ヘッダ / `JoinSelfPanel` / role 判定 |
| P1 | [src/app/tournaments/[tid]/dashboard-client.tsx](../../../src/app/tournaments/[tid]/dashboard-client.tsx) | 1-394 | seating 確定 UI / TournamentForm への接続点 |
| P1 | [src/components/tournament/SeatingBoard.tsx](../../../src/components/tournament/SeatingBoard.tsx) | all | PD チェックボックス追加先 |
| P2 | [firestore.rules](../../../firestore.rules) | 200-396 | groups / players の rule branches（DRIFT WARNING あり） |
| P2 | [src/lib/firebase/schemas/player.ts](../../../src/lib/firebase/schemas/player.ts) | all | additive 拡張ベース |
| P2 | [src/lib/firebase/repositories/tournaments.ts](../../../src/lib/firebase/repositories/tournaments.ts) | 450-547 | subscribe by group の前例 / writeBatch cascade |
| P2 | [src/lib/services/seating/__tests__/engine.test.ts](../../../src/lib/services/seating/engine.test.ts) | all | engine の characterization test の書き方 |
| P2 | [src/lib/services/seating/__tests__/orchestrator.test.ts](../../../src/lib/services/seating/orchestrator.test.ts) | all | orchestrator のテスト（fixture factory 含む） |

## External Documentation

| Topic | Source | Key Takeaway |
| --- | --- | --- |
| Web Audio autoplay policy | [Chrome / WebKit blog](https://developer.chrome.com/blog/autoplay/#web_audio) | document に対する任意の user gesture が 1 回でも発生していれば AudioContext.resume が許される |
| Firebase additionalUserInfo | [SDK docs](https://firebase.google.com/docs/reference/js/auth.additionaluserinfo) | `isNewUser` は **Firebase Auth ユーザーが本 request で作成されたか**だけを意味する。Firestore profile の有無は別管理が必要 |
| Firestore collectionGroup | [docs](https://firebase.google.com/docs/firestore/query-data/queries#collection-group-query) | `players` collectionGroup + `where("uid","==", auth.uid)` で「自分が参加している全 tournaments」を 1 query で取れる |

---

## Patterns to Mirror

### NAMING_CONVENTION

```ts
// SOURCE: src/lib/firebase/schemas/player.ts
export const playerBodySchema = z.object({
  // ... 既存フィールド ...
});

// SOURCE: src/lib/firebase/repositories/players.ts
export async function bustPlayer(tid: string, pid: string): Promise<void> {
  await wrapFirestoreWrite(...);
}
```

### ERROR_HANDLING

```ts
// SOURCE: src/lib/services/seating/orchestrator.ts L145-167
} catch (e) {
  if (e instanceof TooManyTablesError) {
    const wrapped = new AppError(`...`, "seating/too-many-tables", e);
    logger.warn(wrapped.message, { code: wrapped.code, tid });
    throw wrapped;
  }
  const wrapped = AppError.from(e, "firestore/write_failed", "...");
  logger.warn(wrapped.message, { code: wrapped.code, tid });
  throw wrapped;
}
```

### TX + RACE GUARD

```ts
// SOURCE: src/lib/services/seating/orchestrator.ts L242-263
// 対象卓の既存プレイヤーを tx 内で再 read して seat 占有を再確認する race guard。
// PD ON 時の rotation でも同パターンで「同 table の他 PD が直前に立っていない」を検証。
const freshTargetTable = await Promise.all(
  targetTableExistingIds.map((id) => tx.get(doc(playersRef(tid), id))),
);
```

### SCHEMA_ADDITIVE_PATTERN

```ts
// SOURCE: src/lib/firebase/schemas/tournament.ts L48-52（lastLevelChangeKind の前例）
// additive: 既存 doc は missing field（undefined）を許容
isPlayingDealer: z.boolean().default(false),
```

### FIRESTORE_RULES_BRANCH_PATTERN

```rules
// SOURCE: firestore.rules L207-221
// organizer-only 単独書換 branch（affectedKeys + 値域）
isOrganizer(...)
&& request.resource.data.diff(resource.data).affectedKeys()
     .hasOnly(['isPlayingDealer'])
&& request.resource.data.isPlayingDealer is bool
```

### TEST_STRUCTURE（fixture factory）

```ts
// SOURCE: src/lib/services/seating/orchestrator.test.ts
function makePlayer(overrides: Partial<PlayerDoc> = {}): PlayerDoc {
  return {
    id: "p1",
    isPlayingDealer: false,  // NEW field
    // ...
    ...overrides,
  };
}
```

---

## Files to Change

### 新規作成

| File | Purpose |
| --- | --- |
| `src/lib/firebase/repositories/playersByUid.ts` | collectionGroup 経由で `players where uid == auth.uid` を購読する |
| `src/lib/services/seating/pd.ts` | PD 純関数（`planPlayingDealerShift` rotation / `pinPlayingDealersToSeat1` initial seating 用） |
| `src/components/nav/JoinedTournamentsNav.tsx` | サイドバー「参加中のトーナメント」section |
| `src/lib/hooks/useImplicitAudioUnlock.ts` | document の `pointerdown` 1 回で `resumeAudioContext` |
| `scripts/test-rules-pd.mjs` | `players.isPlayingDealer` 単独書換の rules emulator validator |
| `src/lib/services/seating/__tests__/pd.test.ts` | PD rotation / pin の純関数 unit test |
| `src/lib/services/seating/__tests__/engine-random-seat.test.ts` | 連番→ランダム抽出の characterization test |
| `src/lib/firebase/repositories/__tests__/playersByUid.test.ts` | collectionGroup query mock |
| `src/components/nav/__tests__/JoinedTournamentsNav.test.tsx` | render + click + signedIn gate |
| `src/components/auth/__tests__/DisplayNameDialog.gate.test.tsx` | login-client の dialog 発火条件 3 ケース |

### 既存更新

| File | Action | Justification |
| --- | --- | --- |
| `src/lib/firebase/schemas/player.ts` | UPDATE | `isPlayingDealer: z.boolean().default(false)` を additive 追加 |
| `src/lib/firebase/repositories/players.ts` | UPDATE | `bustPlayer` で同卓全員の `isPlayingDealer=false` も同時更新（writeBatch 化）。`assignSeat` は既存維持。`subscribePlayersByUid` は別ファイルで追加 |
| `src/lib/services/seating/engine.ts` | UPDATE | `planInitialSeating`: PD player を席 1 に pin、他は seat [2..seatsPerTable] からランダム抽選。`planLateEntrySeat`: 空席ランダム抽選。`planBalancingMove`: PD player を移動候補から除外、過剰卓全員 PD で null。`planTableBreak`: 既存どおり（PD auto-OFF は orchestrator 側で対応） |
| `src/lib/services/seating/orchestrator.ts` | UPDATE | `commitInitialSeating` の signature 拡張（後方互換: optional 引数で player 指定なし時は random）。`autoSeatLateEntry` の tx 内 state guard を `seating/running/paused` に緩和。`applyTableBreak` 内で閉鎖卓 player 全員の `isPlayingDealer=false` を tx 内に追加。新規 `setIsPlayingDealer(tid, uid, gids, pid, value)` 関数を追加: tx 内で「同卓に他 PD がいない」検証 + rotation moves の commit を atomic に |
| `src/lib/hooks/useSeatingAutoOrchestrator.ts` | UPDATE | 発火条件に `state === "seating"` を追加 |
| `src/lib/services/tournament-state.ts` | UPDATE | 純関数 `isAcceptingLateSeats(t)` 追加（5 状態 × 期待値） |
| `firestore.rules` | UPDATE | `players/{pid}` update の organizer 経路に `isPlayingDealer` 書込を許容（既存 `isBusted` / seat と同 branch、`affectedKeys` 列挙拡張）。新規「organizer による複数 player を同 batch 更新（rotation）」も既存経路でカバー（個別 player ごとに 1 update なので追加 branch 不要） |
| `src/components/nav/AppShell.tsx` | UPDATE | fullscreen 早期 return を撤廃。`user?.isAnonymous` のとき sidebar render skip |
| `src/components/nav/HeaderMenuButton.tsx` | UPDATE | `user.isAnonymous === true` のとき null 返却 |
| `src/components/nav/PrimaryNav.tsx` | UPDATE | `JoinedTournamentsNav` を「トーナメント一覧」配下と並列に挿入 |
| `src/app/login/login-client.tsx` | UPDATE | DisplayNameDialog 発火条件を「`isNewUser` ∨ `getUserProfile(uid)` 不存在 ∨ `displayName` 空」に拡張 |
| `src/lib/services/auth-actions.ts` | UPDATE | `signInWithGoogle` の戻り値に `needsDisplayNameSetup: boolean` 追加 |
| `src/lib/hooks/useAudioPlayer.ts` | UPDATE | `useImplicitAudioUnlock()` を mount 時に呼ぶ |
| `src/app/tournaments/[tid]/live/live-client.tsx` | UPDATE | 匿名ユーザーは `useEffect` で `router.replace("/")` redirect。loading 表示で UI ちらつき防止 |
| `src/app/join/[tid]/join-client.tsx` | UPDATE | 受付完了画面を匿名 / 通常で分岐 |
| `src/components/tournament/SeatingBoard.tsx` | UPDATE | 各席に PD チェックボックス追加。同卓に PD が立っているとき他席の checkbox は disabled。クリックで `setIsPlayingDealer` を呼ぶ。busted player は PD 表示せず |

## PD モデルの解釈ルール（重要）

`players/{pid}.isPlayingDealer` フラグの状態と運用の対応:

### tournament.state = "running" / "paused" / "seating"（席決め後）

| 卓内の PD フラグ状態 | 運用上の意味 |
| --- | --- |
| 1 名のフラグが true | プレイングディーラー（兼任）。その player が席 1 に固定、バランシングで動かない |
| 全員のフラグが false | **専任ディーラー（アプリ外の誰かが担当）**。busted player でも・運営の別メンバーでも・会場の外部スタッフでも、アプリの管理対象外で誰かがディーラー業務している状態 |
| 2 名以上のフラグが true | **発生しない**（`setIsPlayingDealer` の tx + UI disabled で防止） |

つまり「busted player が後から専任ディーラーになる」「会場の運営者が席にいないけど専任で見る」ような運用は **PD フラグを全員 OFF にした卓** で自然に表現できる。アプリは PD の不在を「席 1 を空席候補として通常扱い」「バランシングで全員を移動候補に含める」だけで、それ以上の事は管理しない。

bust 時 / table break 時の auto-OFF はこの解釈と整合する: bust や閉鎖直後は PD 兼任が成立しなくなるため、いったん「専任ディーラー扱い」に戻し、必要なら運営者が別 player に PD ON し直す。

### tournament.state = "setup"（席決め前）

| PD フラグの総数 | 動作 |
| --- | --- |
| 0 名（誰も ON していない） | 全卓が「専任ディーラー扱い」で席決め開始。`planInitialSeating` は通常のランダム配分 |
| 1 名以上 ≤ 予想卓数（`ceil(activePlayers / seatsPerTable)`） | 各 PD player を別の卓に分散配分し、それぞれ席 1 に固定 |
| **PD 数 > 予想卓数** | **「席を確定」ボタン押下時に `commitInitialSeating` が `seating/pd-too-many` AppError を throw**。dashboard 側でエラー表示「PD は X 名以下に絞ってください（現在 N 名）」。運営者が PlayerList で PD フラグを OFF にして再試行 |

setup 中は player の `tableNum=null` のため「同卓 1 PD」制約は意味を持たない。**setup 中は PD を無制限に ON できる**（運営者が候補を絞り込む段階）。実際の制約は **席決め確定時の検証** に倒す。

### PD の卓割り当てアルゴリズム

`planInitialSeating` 内の bucket 配分:

1. active player を seed-driven shuffle
2. **PD player を bucket 0..numTables-1 に 1 名ずつ事前配分**（PD 数 > numTables なら `TooManyPlayingDealersError` throw → orchestrator が AppError ラップ）
3. 残りの非 PD player を round-robin で各 bucket に追加
4. 各 bucket 内で PD は席 1、その他は seat [2..seatsPerTable] からランダム抽選

これにより「`PD 数 ≤ 卓数` ⇒ PD 1 名 / 卓を保証」「PD 0 名 ⇒ 全卓専任ディーラー」「PD 数 > 卓数 ⇒ 早期 throw」が成立する。

どの PD がどの卓に行くかは shuffle の結果に従う（運営者の事前希望は受け付けない、シンプル化）。

## NOT Building

- **複数 PD 並列指定**: 1 卓 1 PD 制約のみ（service tx + UI disabled の二重防御）
- **busted player に席を与えて PD に再指名**: 不要（busted player を「専任ディーラー」にしたい運用は、卓内 PD 全 OFF 状態で自然に成立する。アプリは席を持たない PD を管理しない）
- **「専任ディーラー」を表す独立 schema フィールド**: 不要（PD 全 OFF で表現できる）
- **PD 自動推薦**: 過去開催から PD 履歴を引いてサジェストする機能は対象外
- **席の絶対固定 (PD 以外)**: 一般プレイヤーの希望席（VIP 席など）固定は対象外
- **手動席移動 UI**: 通常 player の任意席移動は対象外（PD ON 時の rotation のみ自動。それ以外の席変更は再 commitInitialSeating 等の運用で対応）
- **autoplay の Web Audio API への完全移行**: 現状の HTMLAudioElement 経由を維持
- **`/live` ロール変更通知**: 運営者が一般メンバーに降格したときの即時 redirect は対象外
- **collectionGroup index の手動定義**: 単一 `where` clause なら自動生成
- **音声 unlock の Page Visibility API 連携**: tab 切替時の suspend / resume は OS / ブラウザ任せ
- **匿名ゲスト向けの参加状況ビュー**: ゲスト匿名は「受付完了で動線完結」設計
- **`/live` の floating 戻るボタン**: 匿名 redirect で不要化
- **マスター機 1 台モード**（PRD Phase 5 機能候補）: ドライラン後ヒアリング後に判断
- **賞金計算（単純分配）**（PRD Phase 5 候補）: 余力次第で別 PR
- **`/groups` の「詳細」→「開く」リネーム**（PRD Phase 5 から繰越）: 別 PR で軽微対応

---

## Step-by-Step Tasks

### Task 1: schema 追加 — `players.isPlayingDealer`

- **ACTION**: `src/lib/firebase/schemas/player.ts` に additive フィールドを追加
- **IMPLEMENT**:
  ```ts
  // Phase 5.1: PD（プレイングディーラー）フラグ。1 卓 1 PD（service tx + rule で防御）。
  // additive: 旧 doc は default(false) で hydrate（破壊的 migration 不要）。
  isPlayingDealer: z.boolean().default(false),
  ```
- **MIRROR**: SCHEMA_ADDITIVE_PATTERN
- **IMPORTS**: なし
- **GOTCHA**: fixture factory（`makePlayer` 各 test）も同フィールドを default false で生成
- **VALIDATE**: schema test 3 ケース（default / true / 不正値）

### Task 2: PD 純関数（`pd.ts`）— characterization test 先行

- **ACTION**: `src/lib/services/seating/pd.ts` に 2 つの純関数を作成
- **IMPLEMENT**:
  ```ts
  /** 初回席決め: PD 指定 player を該当 table の席 1 に固定し、玉突きで動かされる player を席 2.. に再配置 */
  export function pinPlayingDealersToSeat1(
    plan: { assignments: SeatAssignment[]; tableNums: number[] },
    pdPlayerIdsByTable: Map<number, string>, // tableNum → playerId
  ): { assignments: SeatAssignment[]; tableNums: number[] };

  /** PD ON 時の rotation: pid を席 1 に、元 1..元PD席-1 の player を 1 つずつ後ろに */
  export function planPlayingDealerShift(
    tablePlayers: PlayerDoc[],   // 同 table の active player（busted 除外）
    pdPlayerId: string,
    seatsPerTable: number,
  ): BalancingMove[];
  ```
- **MIRROR**: TEST_STRUCTURE / characterization test ファースト（先に test を書く）
- **IMPORTS**: `Seat`, `BalancingMove`, `SeatAssignment` 型を engine から re-import
- **GOTCHA**:
  - `planPlayingDealerShift`: PD player が seat=null（busted 等）なら `[]` 返却（呼出側で「先に席を割当てて」エラー）
  - 元 PD 席より後ろの席（seatNum > 元PD席）は影響なし
  - 満員卓でも安全（元 PD 席が空く分、shift 終端の席が確保される）
- **VALIDATE**: `pd.test.ts` 8 ケース（PD 元席 1 → no-op / PD 元席 5 → 4 件 shift / 満員卓で PD 元席 9 → 8 件 shift / busted PD → [] / etc）

### Task 3: `planInitialSeating` を PD 分散 + ランダム抽選 + PD 席 1 強制に変更

- **ACTION**: `engine.ts` L81-112 の関数を `pdPlayerIds: string[]`（players のうち `isPlayingDealer=true` の id 集合）を引数に取るよう拡張、bucket 配分を PD 先行 → 非 PD 後続の 2 段階に変更
- **IMPLEMENT**:
  ```ts
  // 1. PD 数チェック
  if (pdPlayerIds.length > numTables) {
    throw new TooManyPlayingDealersError(pdPlayerIds.length, numTables);
  }

  // 2. shuffle 後に PD と非 PD を分離
  const shuffled = shuffle(active, seed);
  const pdSet = new Set(pdPlayerIds);
  const pdPlayers = shuffled.filter((p) => pdSet.has(p.id));
  const nonPdPlayers = shuffled.filter((p) => !pdSet.has(p.id));

  // 3. PD を各 bucket（卓）に 1 名ずつ事前配分
  const buckets: PlayerDoc[][] = Array.from({ length: numTables }, () => []);
  for (let i = 0; i < pdPlayers.length; i++) {
    buckets[i].push(pdPlayers[i]); // bucket 0..PD数-1 に 1 名ずつ
  }

  // 4. 非 PD を round-robin で残席に配分（人数差 ±1 を保つ）
  let bucketIdx = 0;
  for (const p of nonPdPlayers) {
    // 最少人数の bucket を優先（PD 配分済み卓に偏らないよう動的選択）
    const minSize = Math.min(...buckets.map((b) => b.length));
    while (buckets[bucketIdx].length > minSize) {
      bucketIdx = (bucketIdx + 1) % numTables;
    }
    buckets[bucketIdx].push(p);
    bucketIdx = (bucketIdx + 1) % numTables;
  }

  // 5. 各 bucket 内で PD は席 1、他は seat [2..seatsPerTable] からランダム抽選
  for (let t = 0; t < numTables; t++) {
    const tableNum = t + 1;
    const tablePlayers = buckets[t];
    const pd = tablePlayers.find((p) => pdSet.has(p.id));
    let nonPd = tablePlayers;
    if (pd) {
      assignments.push({ playerId: pd.id, tableNum, seatNum: 1 });
      nonPd = tablePlayers.filter((p) => p.id !== pd.id);
    }
    const seatPool = pd
      ? Array.from({ length: seatsPerTable - 1 }, (_, i) => i + 2) // [2..N]
      : Array.from({ length: seatsPerTable }, (_, i) => i + 1);     // [1..N]
    const shuffledSeats = shuffle(seatPool, seed + t * 1000);
    for (let s = 0; s < nonPd.length; s++) {
      assignments.push({
        playerId: nonPd[s].id,
        tableNum,
        seatNum: shuffledSeats[s],
      });
    }
  }
  ```
- **MIRROR**: 既存 `TooManyTablesError` の class パターンを `TooManyPlayingDealersError` で踏襲
- **IMPORTS**: `shuffle` from `./prng`
- **GOTCHA**:
  - `TooManyPlayingDealersError` 新規 class を engine.ts 内で export し、orchestrator が instanceof で判別して `seating/pd-too-many` AppError にラップ（既存 TooManyTablesError と同パターン）
  - PD 0 名のときは既存ロジックと完全一致（pdSet 空 → 通常 round-robin）
  - PD 数 = numTables のときは buckets が PD で 1 ずつ埋まり、非 PD が round-robin で残席に積まれる → 人数差 ±1 維持
  - 最少人数 bucket 動的選択により、12 人 / 2 卓 / PD 1 のとき PD 卓 6 / 非 PD 卓 6 が保証される
- **VALIDATE**: `engine-random-seat.test.ts` で
  - 連番化していないこと（seed 固定の再現性）
  - PD 0 名: 既存挙動と一致
  - PD 1 名: 該当 player が席 1 に / 卓は seed 依存
  - PD = numTables: 全卓に PD 1 ずつ
  - PD > numTables: `TooManyPlayingDealersError` throw
  - 12 人 / 2 卓 / PD 2: 各卓 6 人、各卓席 1 が PD

### Task 4: `planLateEntrySeat` を空席ランダム抽選へ変更

- **ACTION**: `engine.ts` L122-152 の signature を `(seatedPlayers, brokenTableNums, seatsPerTable, seed: number)` に拡張
- **IMPLEMENT**: 既存「最小空席」を「空席集合の seed-driven shuffle 先頭」に変更
- **MIRROR**: Task 3 の seed 拡張パターン
- **IMPORTS**: `shuffle` from `./prng`
- **GOTCHA**:
  - PD 席を除外する仕組みは不要（PD player の席 1 は既に occupied として正しく扱われる）
  - seed は orchestrator 側で `Date.now() ^ playerId hash` を渡す（再現性は不要）
- **VALIDATE**: `engine-random-seat.test.ts` で「空席が複数あるとき seed で異なる結果」「PD 在席卓は席 1 が候補から自動的に除外される」

### Task 5: `planBalancingMove` で PD を移動候補から除外

- **ACTION**: `engine.ts` L161-196 の関数を更新
- **IMPLEMENT**:
  ```ts
  const movedPlayer = seatedPlayers
    .filter(
      (p) =>
        !p.isBusted &&
        p.tableNum === maxTable &&
        p.seatNum !== null &&
        !p.isPlayingDealer, // ← NEW
    )
    .sort((a, b) => (a.seatNum ?? 0) - (b.seatNum ?? 0))[0];
  if (!movedPlayer) return null; // 過剰卓全員が PD なら バランシング不能
  ```
- **MIRROR**: 既存の filter chain
- **IMPORTS**: なし
- **GOTCHA**: 1 卓 1 PD 制約があるので「全員 PD」は非常に稀（1 人卓でその 1 人が PD のとき）。null 返却を運営者通知に倒す（既存 BalancingInstructionCard で「現在バランシング不能」表示）
- **VALIDATE**: `engine.test.ts` に「PD 在席で max table の最小席番号は PD 自身 → 次小席番号 player を選ぶ」「過剰卓全員 PD → null」の 3 ケース追加

### Task 6: `commitInitialSeating` で PD ID 集合を引き渡し

- **ACTION**: `orchestrator.ts` L73 の `commitInitialSeating` を更新。signature 変更なし（tx 内で各 player doc を tx.get するときに `isPlayingDealer` を読み取り、PD ID 集合を engine に渡す）
- **IMPLEMENT**:
  ```ts
  // tx 内で再 read 済みの liveActive から PD 集合を抽出
  const pdPlayerIds = liveActive
    .filter((p) => p.isPlayingDealer && !p.isBusted)
    .map((p) => p.id);

  // engine 呼出（新シグネチャ）
  const plan = planInitialSeating(liveActive, sp, seed, pdPlayerIds);
  ```
- **MIRROR**: 既存 `TooManyTablesError` の AppError ラップパターン（L145-167）を `TooManyPlayingDealersError` で踏襲
- **IMPORTS**: `TooManyPlayingDealersError` from `./engine`
- **GOTCHA**:
  - **catch 節に分岐追加**:
    ```ts
    if (e instanceof TooManyPlayingDealersError) {
      const wrapped = new AppError(
        `PD は ${e.maxAllowed} 名以下に絞ってください（現在 ${e.requested} 名）`,
        "seating/pd-too-many",
        e,
      );
      logger.warn(wrapped.message, { code: wrapped.code, tid });
      throw wrapped;
    }
    ```
  - tx 内の再 read で busted=true の PD は自動的に除外（filter で `!p.isBusted`）→ bust 時の auto-OFF と整合（busted player のフラグ自体が false になっているはずだが、データ不整合への保険として busted も filter）
  - pdPlayerIds は ID 配列（map ではない）。卓割り当ては engine 内で seed-driven に決まる
- **VALIDATE**: `orchestrator.test.ts` に 5 ケース追加
  - PD 0 名: 既存挙動
  - PD 1 名 ≤ numTables: 該当 player が席 1 に
  - PD = numTables: 全卓に分散
  - PD > numTables: `seating/pd-too-many` AppError throw
  - PD 指定だが該当 player が busted: filter で除外され、PD 0 名扱い

### Task 6.5: `state=seating` で自動配席を発火（座席確定後の遅延解消）

- **ACTION**: `useSeatingAutoOrchestrator.ts` L62-67 の発火条件を拡張、`autoSeatLateEntry` の tx 内 state guard も同範囲に緩和
- **IMPLEMENT**:
  ```ts
  // useSeatingAutoOrchestrator.ts
  if (
    tournament.state !== "seating" &&
    tournament.state !== "running" &&
    tournament.state !== "paused"
  ) return;

  // orchestrator.ts autoSeatLateEntry tx 内
  if (t.state !== "seating" && t.state !== "running" && t.state !== "paused") {
    skipReason = "state";
    return;
  }
  ```
- **MIRROR**: `tournament-state.ts` の純関数。新規 helper `isAcceptingLateSeats(t)` を追加し engine / orchestrator / hook で共有
- **IMPORTS**: `isAcceptingLateSeats` from `@/lib/services/tournament-state`
- **GOTCHA**:
  - `seating` 中は `currentLevel === 0` で deadline チェックは常に false。`isAcceptingLateSeats` 内では state ベースの可否のみ返す
  - `commitInitialSeating` 完了直後の連続発火は inflight Set + tx state guard + lastMovedAt guard の三層で吸収
- **VALIDATE**: `useSeatingAutoOrchestrator.test.ts` に「state=seating で未配席 player → autoSeatLateEntry 呼出」/ `tournament-state.test.ts` に `isAcceptingLateSeats` の 5 状態 characterization

### Task 7: `setIsPlayingDealer` service を新設（PD ON/OFF + rotation）

- **ACTION**: `orchestrator.ts` に新規関数 `setIsPlayingDealer(tid, uid, userGroupIds, pid, value)` を追加
- **IMPLEMENT**:
  ```ts
  export async function setIsPlayingDealer(
    tid: string,
    uid: string,
    userGroupIds: string[],
    pid: string,
    value: boolean,
  ): Promise<void> {
    await runTransaction(firestore, async (tx) => {
      // tournament + group チェック（既存パターン）
      const t = ... await tx.get(tournamentRef(tid));
      if (!userGroupIds.includes(t.groupId)) throw new AppError("...", "firestore/permission-denied");

      // target player を再 read
      const pSnap = await tx.get(doc(playersRef(tid), pid));
      if (!pSnap.exists()) throw new AppError("not found", "firestore/not-found");
      const p = { id: pSnap.id, ...pSnap.data() };
      if (p.isBusted) throw new AppError("バスト済みプレイヤーは PD 指定できません", "seating/pd-busted");
      if (p.tableNum === null) throw new AppError("席が割り当てられていません", "seating/pd-no-seat");

      if (value === false) {
        // OFF: フラグだけ降ろす（席は変えない）
        tx.update(doc(playersRef(tid), pid), { isPlayingDealer: false });
        return;
      }

      // ON: 同 table の他 PD がいないか tx 内で再確認
      // 同 table の player 全員を tx.get（subscribe snapshot 経由のリスト + tx.get で fresh 化）
      const tablePlayers = await fetchTablePlayers(tx, tid, p.tableNum);
      const otherPd = tablePlayers.find((q) => q.id !== pid && q.isPlayingDealer && !q.isBusted);
      if (otherPd) throw new AppError(`Table ${p.tableNum} には既に PD がいます`, "seating/pd-already-set");

      // rotation: 元 1..元PD席-1 の player を 1 つずつ後ろへ + PD を席 1 へ
      const moves = planPlayingDealerShift(tablePlayers.filter((q) => !q.isBusted), pid, t.seatsPerTable);
      const ts = serverTimestamp();
      for (const m of moves) {
        tx.update(doc(playersRef(tid), m.playerId), {
          tableNum: m.to.tableNum,
          seatNum: m.to.seatNum,
          lastMovedAt: ts,
        });
      }
      // PD フラグ ON
      tx.update(doc(playersRef(tid), pid), { isPlayingDealer: true });
    });
    logger.info("set pd ok", { tid, uid, pid, value });
  }
  ```
- **MIRROR**: `applyTableBreak` の tx + race guard パターン
- **IMPORTS**: `planPlayingDealerShift` from `./pd`、各種 ref helper
- **GOTCHA**:
  - `fetchTablePlayers` は subscribe で持っている list の id 集合を tx.get で再 read する必要あり。簡略化のため「同 tournament の players 全部を tx.get」は重いので、引数で `tablePlayerIds` を受け取る形にする
  - rotation moves の destination seat 占有 race は、同 table 内 player のみ動かすため tx 内自己完結
- **VALIDATE**: `orchestrator.test.ts` に setIsPlayingDealer の 6 ケース（OFF / ON 元席 1 / ON 元席 5 で 4 件 shift / 同卓既 PD で reject / busted で reject / seat=null で reject）

### Task 8: `bustPlayer` で同卓全員の `isPlayingDealer=false` を atomic に

- **ACTION**: `players.ts` L121-137 の `bustPlayer` を更新
- **IMPLEMENT**:
  ```ts
  export async function bustPlayer(
    tid: string,
    pid: string,
    sameTablePlayerIds: string[], // 呼出側で同卓の他 player IDs を渡す
  ): Promise<void> {
    await wrapFirestoreWrite(...,
      async () => {
        const batch = writeBatch(firestore);
        const ts = serverTimestamp();
        // 当該 player は seat null + busted + isPlayingDealer false
        batch.update(doc(playersRef(tid), pid), {
          isBusted: true,
          bustedAt: ts,
          tableNum: null,
          seatNum: null,
          lastMovedAt: ts,
          isPlayingDealer: false,
        });
        // 同卓の他 player は isPlayingDealer false のみ
        for (const otherId of sameTablePlayerIds) {
          batch.update(doc(playersRef(tid), otherId), { isPlayingDealer: false });
        }
        await batch.commit();
      },
    );
  }
  ```
- **MIRROR**: `deleteTournament` の writeBatch cascade パターン
- **IMPORTS**: `writeBatch` from `firebase/firestore`
- **GOTCHA**:
  - 呼出側（`PlayerList` の bust ボタン）は subscribe 済み players list から同卓 ID を抽出して渡す
  - 同卓 PD が居なくても batch update は冪等（false → false の no-op write）
  - rule 側で「organizer による複数 player の同 batch 更新」は既存経路でカバーされる（個別 player ごとに 1 update）
- **VALIDATE**: `players.test.ts`（or 新規）で 3 ケース（PD 不在卓でも no-op pass / PD あり卓で全員 OFF / 自分自身も OFF）

### Task 9: `applyTableBreak` で閉鎖卓の `isPlayingDealer=false`

- **ACTION**: `orchestrator.ts` L498-510 の tx 内に追加
- **IMPLEMENT**:
  ```ts
  // 既存: moves 適用 + tables/{n}.isBroken=true
  for (const m of plan.moves) {
    tx.update(doc(playersRef(tid), m.playerId), {
      tableNum: m.to.tableNum,
      seatNum: m.to.seatNum,
      lastMovedAt: ts,
      isPlayingDealer: false, // ← NEW: 閉鎖卓 player は全員 PD OFF
    });
  }
  ```
- **MIRROR**: 既存 `applyTableBreak` の tx 構造
- **IMPORTS**: なし
- **GOTCHA**: 移動先卓に既に PD が居た場合、移動してきた元 PD は false で上書き → 移動先 PD が unique に保たれる
- **VALIDATE**: `orchestrator.test.ts` に「閉鎖卓に PD あり → 全員 false」「閉鎖元 PD と移動先 PD で衝突しない」の 2 ケース追加

### Task 10: Firestore Rules に `players.isPlayingDealer` 書込許容

- **ACTION**: `firestore.rules` の `tournaments/{tid}/players/{pid}` organizer 経路の update branch を拡張
- **IMPLEMENT**:
  ```rules
  // organizer 経路の既存 branch に isPlayingDealer の type check を追加
  ... 既存条件 ...
  && request.resource.data.isPlayingDealer is bool
  // self 経路では isPlayingDealer も immutable に固定
  && request.resource.data.isPlayingDealer == resource.data.isPlayingDealer  // self 側
  ```
- **MIRROR**: 既存の `isBusted is bool` チェック
- **IMPORTS**: なし
- **GOTCHA**:
  - self 経路は displayName のみ変更可。`isPlayingDealer` は immutable に固定する条件追加
  - organizer 経路は既存の seat / isBusted と同じ branch で完結（新 branch 不要）
- **VALIDATE**: `scripts/test-rules-pd.mjs` で 6 ケース（self での書換 deny / organizer での ON / organizer での OFF / member での deny / 不正型 deny / 正常 update）

### Task 11: PD チェックボックスを SeatingBoard と PlayerList の両方に追加

- **ACTION**:
  - `src/components/tournament/SeatingBoard.tsx`: 各席に PD checkbox（state `seating/running/paused` 時の操作経路）
  - `src/components/tournament/PlayerList.tsx`: 各 player 行に PD checkbox（**state `setup` 時の操作経路**、SeatingBoard が表示されない期間をカバー）
- **IMPLEMENT**:
  - **SeatingBoard 側**:
    - 各席の displayName 横に小さい checkbox（label "PD"）
    - `checked = player.isPlayingDealer`
    - **同 table に他 PD が立っているとき、自席以外の checkbox は disabled**（1 卓 1 PD UI ガード）
    - busted player の席には checkbox を出さない
    - クリックで `setIsPlayingDealer(tid, uid, gids, player.id, !player.isPlayingDealer)`
    - PD player の席は「PD ◎」のような視覚バッジを併設
  - **PlayerList 側**:
    - 各 player 行に同型 checkbox
    - **setup 時のみ表示**（state が seating 以降は SeatingBoard 側を真実源にして PlayerList 側 checkbox は非表示）
    - busted player の行は checkbox を出さない（既存 PlayerList の bust 表示と整合）
    - **setup 時は disabled 制御なし（無制限に ON 可能）**。`commitInitialSeating` 時に PD 数 > 卓数なら `seating/pd-too-many` でエラー表示し、運営者は PlayerList で OFF にして再試行
    - クリックで同じ `setIsPlayingDealer` を呼ぶ
- **MIRROR**: shadcn `Checkbox` primitive
- **IMPORTS**: `setIsPlayingDealer` from `@/lib/services/seating/orchestrator`、`Checkbox` from `@/components/ui/checkbox`
- **GOTCHA**:
  - SeatingBoard と PlayerList が同時表示される state はないため、checkbox 重複表示は発生しない
  - setup 時の PlayerList checkbox は tableNum=null の player に対して `setIsPlayingDealer(value=true)` を呼ぶ。`setIsPlayingDealer` 側の tx で「同卓 1 PD」検証は tableNum=null 同士を素通りする（当該 plan の PD モデル解釈ルールに従う）
  - クリック直後の楽観 UI 更新は不要（onSnapshot で 1 秒以内に反映）
  - 制約 violation 時のエラー表示は `setError(...)` ハンドラ経由で既存 dashboard error 領域に出す
  - `seating/pd-too-many` のエラー文言は dashboard で「PD は X 名以下に絞ってください（現在 N 名）」を表示し、PlayerList での修正を促す
- **VALIDATE**:
  - SeatingBoard test 5 ケース（PD なし / PD あり 自席 enabled / PD あり 他席 disabled / busted 非表示 / クリックで service 呼出）
  - PlayerList test 4 ケース（setup 時に表示 / 非 setup 時に非表示 / busted 非表示 / クリックで service 呼出）

### Task 12: 暗黙 autoplay unlock hook（`useImplicitAudioUnlock`）

- **ACTION**: `src/lib/hooks/useImplicitAudioUnlock.ts` を新設し `useAudioPlayer` 冒頭で呼ぶ
- **IMPLEMENT**:
  ```ts
  useEffect(() => {
    const handler = () => {
      void resumeAudioContext();
    };
    window.addEventListener("pointerdown", handler, { capture: true, once: true });
    return () => window.removeEventListener("pointerdown", handler, { capture: true });
  }, []);
  ```
- **MIRROR**: `useAudioPlayer.ts` 内の `useEffect` 構成
- **IMPORTS**: `resumeAudioContext` from `@/lib/audio/audio-context`
- **GOTCHA**: `{ once: true }` で React strict mode 二重呼び出しでも問題なし
- **VALIDATE**: 既存 `useAudioPlayer.test.ts` に「pointerdown で unlocked が true になる」テスト追加

### Task 13: AppShell の fullscreen pattern を撤廃 + 匿名 gate

- **ACTION**: `src/components/nav/AppShell.tsx` を更新
- **IMPLEMENT**:
  - 既存 `FULLSCREEN_PATTERN` 早期 return を削除
  - 代わりに `if (user?.isAnonymous) return <main>...</main>;` で匿名は sidebar 完全非表示
- **MIRROR**: 現行 PrimaryNav が `/live` ルートでも参加中サブナビを出す前提
- **IMPORTS**: `useAuthUser`
- **GOTCHA**: 通常 → 匿名 → 通常への再 sign-in は AuthProvider の onAuthStateChanged で自動再描画
- **VALIDATE**: AppShell.gate.test 3 ケース（匿名 / 通常 / loading）

### Task 14: HeaderMenuButton で匿名は null

- **ACTION**: `HeaderMenuButton.tsx` 冒頭で `user?.isAnonymous` のとき null
- **IMPLEMENT**:
  ```ts
  const { user } = useAuthUser();
  if (user?.isAnonymous) return null;
  ```
- **VALIDATE**: 2 ケース（匿名 → null / 通常 → button）

### Task 15: collectionGroup で `players where uid == auth.uid` を購読

- **ACTION**: `src/lib/firebase/repositories/playersByUid.ts` を新設
- **IMPLEMENT**:
  ```ts
  export function subscribePlayersByUid(
    uid: string,
    onNext: (entries: Array<{ tid: string; player: PlayerDoc }>) => void,
    onError: (err: AppError) => void,
  ): () => void {
    const q = query(collectionGroup(firestore, "players"), where("uid", "==", uid));
    return onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => ({
        tid: d.ref.parent.parent!.id,
        player: { id: d.id, ...playerBodySchema.parse(d.data()) },
      }));
      onNext(items);
    }, (err) => onError(AppError.from(err, "firestore/subscribe_failed", "...")));
  }
  ```
- **MIRROR**: `subscribeTournamentsByGroup` の onSnapshot パターン
- **GOTCHA**: collectionGroup は `match /{path=**}/players/{pid}` を経由しないため、現行 rule の `tournaments/{tid}/players/{pid}` `allow read: if isSignedIn()` でカバー
- **VALIDATE**: 4 ケース（0 件 / 1 件 / 複数 / parent.parent 抽出）

### Task 16: `JoinedTournamentsNav` を新設し PrimaryNav に挿入

- **ACTION**: `src/components/nav/JoinedTournamentsNav.tsx` を新設
- **IMPLEMENT**: `subscribePlayersByUid(user.uid)` 購読 → 取得 tids に対して既存 tournament subscribe を Promise.all → state in {setup, seating, running, paused} のみ表示、サブリンクは `/tournaments/{tid}/live` 直リンク
- **MIRROR**: `PrimaryNav` のサブリンク render パターン
- **GOTCHA**: 一般メンバーは dashboard URL で /live に redirect されるため `/live` 直リンクが正解
- **VALIDATE**: 4 ケース（0 件 / 1 件 / 複数 state / signedIn 時のみ）

### Task 17: DisplayNameDialog の発火条件拡張

- **ACTION**: `auth-actions.ts` の `signInWithGoogle` を拡張、`login-client.tsx` で受ける
- **IMPLEMENT**:
  ```ts
  const profile = await getUserProfile(cred.user.uid);
  const needsDisplayNameSetup =
    isNewUser ||
    !profile ||
    !profile.displayName?.trim() ||
    !cred.user.displayName?.trim();
  return { user: cred.user, isNewUser, needsDisplayNameSetup };
  ```
- **MIRROR**: 既存 GoogleSignInResult interface
- **IMPORTS**: `getUserProfile` from `@/lib/firebase/repositories/users`
- **VALIDATE**: 3 ケース（新規 / 既存 + profile なし / 既存 + displayName あり）

### Task 18: `/live` に匿名ユーザーが来たら `/` に redirect

- **ACTION**: `live-client.tsx` 冒頭に匿名 redirect の `useEffect`
- **IMPLEMENT**:
  ```ts
  useEffect(() => {
    if (loading) return;
    if (user?.isAnonymous) router.replace("/");
  }, [loading, user, router]);
  if (user?.isAnonymous) {
    return <main className="...">受付完了画面に戻ります…</main>;
  }
  ```
- **MIRROR**: `dashboard-client.tsx` L142-149 の role-based redirect
- **VALIDATE**: live-client test 1 ケース（匿名なら `router.replace('/')` 呼出）

### Task 19: `/join/{tid}` 受付完了画面を匿名 / 通常で分岐

- **ACTION**: `join-client.tsx` の status="joined" 表示部を分岐
- **IMPLEMENT**: 匿名は「受付が完了しました」+ 小さい「キャンセル」のみ。「タイマー画面へ」は通常ユーザーのみ
- **VALIDATE**: snapshot 4 ケース（匿名 joined / 匿名 cancelled / 通常 joined / 通常 cancelled）

### Task 20: emulator validation script 追加

- **ACTION**: `scripts/test-rules-pd.mjs` を新設
- **IMPLEMENT**: `scripts/test-rules-default-seats.mjs` の構造を mirror。6 ケース（self 書換 deny / organizer ON / organizer OFF / member deny / 不正型 deny / 正常）
- **VALIDATE**: ローカルで `firebase emulators:exec --only firestore "node scripts/test-rules-pd.mjs"`

### Task 21: docs / rule 表 update

- **ACTION**: `.claude/rules/firebase-patterns.md` の単独書換 rule 表に `players.isPlayingDealer` を追加
- **IMPLEMENT**: 既存表に 1 行追加
- **VALIDATE**: 目視確認

### Task 22: 既存 fixture / E2E の連番依存を修正

- **ACTION**: `engine.test.ts` / `orchestrator.test.ts` / E2E の seat=1,2,3,... hardcode を grep して修正
- **IMPLEMENT**: characterization に変えるか、seed を fixture 化
- **VALIDATE**: typecheck + 全 unit + 全 E2E green

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| --- | --- | --- | --- |
| `planInitialSeating` 12 人 / 2 卓 / seed=1 / PD なし | players=12 / seatsPerTable=9 / pdPlayerIds=[] | 各 table 6 人、seat は `[1..9]` の subset、連番でない | seed=固定で reproducible |
| `planInitialSeating` PD 1 名 | players=12 / 2 卓 / pdPlayerIds=[A] | A は seed 依存の卓 / seat 1、他は seat [2..9] random、人数差±1 | yes |
| `planInitialSeating` PD = numTables | players=12 / 2 卓 / pdPlayerIds=[A, B] | A は卓 1 / 席 1、B は卓 2 / 席 1（または逆、shuffle 依存）、各卓 6 人 | yes |
| `planInitialSeating` PD > numTables | players=12 / 2 卓 / pdPlayerIds=[A, B, C] | `TooManyPlayingDealersError` throw | yes |
| `planInitialSeating` PD 指定だが該当 player が active 外 | pdPlayerIds=[X] だが X が busted | filter で除外され PD 0 名扱い、通常配分 | yes |
| `planLateEntrySeat` 空席ランダム | 9 席中 [3, 6, 9] が空き / seed=42 | seed=42 の shuffle 先頭 | yes |
| `planBalancingMove` PD 除外 | maxTable に PD あり | PD 以外の最小席番号 player を選ぶ | yes |
| `planBalancingMove` 過剰卓全員 PD | 1 人卓でその 1 人が PD | null | yes |
| `planPlayingDealerShift` 元席 1 | PD は既に席 1 | [] (no-op) | yes |
| `planPlayingDealerShift` 元席 5 | PD 元席 5 / 席 1..4 に他 4 人 | 4 人を席 2..5 へ + PD を席 1 へ（5 件） | yes |
| `planPlayingDealerShift` 満員卓 | 9 席満員、PD 元席 9 | 8 人 shift + PD 席 1 | yes |
| `planPlayingDealerShift` busted PD | seat=null | [] | yes |
| `pinPlayingDealersToSeat1` | initial plan + pin map | 該当 table の席 1 が PD、玉突きで他 player が後続席 | yes |
| `setIsPlayingDealer` ON 同卓既 PD | 既 PD あり | seating/pd-already-set throw | yes |
| `setIsPlayingDealer` ON busted | busted=true | seating/pd-busted throw | yes |
| `setIsPlayingDealer` ON seat null | seat=null | seating/pd-no-seat throw | yes |
| `setIsPlayingDealer` OFF | value=false | フラグだけ false、seat は不変 | yes |
| `bustPlayer` 同卓 PD あり | sameTablePlayerIds に PD 含む | 当該 + PD の isPlayingDealer=false が batch 更新 | yes |
| `applyTableBreak` PD あり | 閉鎖卓に PD | tx 内で全員 isPlayingDealer=false | yes |
| `subscribePlayersByUid` 0 件 | mock empty snapshot | onNext([]) | yes |
| `subscribePlayersByUid` 複数 tid | 2 tournaments の players | parent.parent.id 抽出済みで返却 | yes |
| `useImplicitAudioUnlock` pointerdown | window.dispatchEvent("pointerdown") | resumeAudioContext 呼出済み | yes |
| `signInWithGoogle` needsSetup | profile null | needsDisplayNameSetup=true | yes |
| `signInWithGoogle` profile あり | profile.displayName="aaa" | needsDisplayNameSetup=false | yes |
| login-client gate | needsSetup=true | dialog open | yes |
| AppShell anonymous | user.isAnonymous=true | sidebar render しない | yes |
| HeaderMenuButton anonymous | user.isAnonymous=true | null | yes |
| `live-client` anonymous redirect | user.isAnonymous=true | router.replace("/") 呼出 | yes |
| `join-client` 受付完了（匿名） | user.isAnonymous=true | 「受付が完了しました」+ 小キャンセルのみ | yes |
| `join-client` 受付完了（通常） | user.isAnonymous=false | 「タイマー画面へ」+「参加を取り消す」 | yes |
| `useSeatingAutoOrchestrator` state=seating | tournament.state="seating" + 未配席 player | autoSeatLateEntry 呼出 | yes |
| `autoSeatLateEntry` tx 内 state guard | t.state="seating" | applied=true で seat 反映 | yes |
| `isAcceptingLateSeats` 5 状態 | setup/seating/running/paused/finished | false/true/true/true/false | yes |
| SeatingBoard PD checkbox 同卓他席 disabled | 卓 1 に PD あり | 卓 1 の他席 checkbox は disabled | yes |
| SeatingBoard busted player | isBusted=true | checkbox 非表示 | yes |

### Edge Cases Checklist

- [ ] 12 人 / 2 卓 / seatsPerTable=9 で seat 集合 [1..9] subset 6 件 × 2 卓（PD 指定なら席 1 必ず PD）
- [ ] PD 元席 1 の状態で再度 ON クリック → no-op
- [ ] PD ON → OFF → ON を繰り返す → 席は元 PD 席に戻らず変化なし（OFF は seat 不変）
- [ ] PD ON 中に busted → 同卓全員 isPlayingDealer=false。busted player 自身も false（seat null と同時）
- [ ] table break 時、閉鎖元と移動先で PD が衝突 → 移動先で false 上書きで unique 維持
- [ ] バランシング過剰卓全員 PD（1 卓 1 PD 制約があるので発生しにくいが、1 人卓でその 1 人が PD のとき）→ null（バランシング不能）
- [ ] late entry の seat 競合 → `seat-taken` race guard で no-op
- [ ] state=seating 中のレイトエントリー: 1〜2 秒で配席、既存席は変わらない
- [ ] state=seating 中の seat 競合: 同 group の運営者 2 端末が同時 → どちらか 1 端末のみ tx 成功
- [ ] **setup 中に PD を 3 名 ON / 卓数 2 → 「席を確定」で `seating/pd-too-many` エラー表示、PD を 2 名に絞れば成功**
- [ ] **setup 中に PD を 0 名のまま「席を確定」 → 通常配分（全卓専任ディーラー扱い）、エラーなし**
- [ ] **setup 中に PD = 卓数 ON / 6 人 / 2 卓 → 各卓 PD 1 名 + 一般 2 名で席決め完了**
- [ ] **setup 中の PlayerList で PD checkbox が表示、seating 以降は非表示（SeatingBoard 側を使う）**
- [ ] 暗黙 unlock が Safari mobile で失敗 → 明示ボタン fallback で `audioPlayer.unlock()`
- [ ] 匿名ユーザーが `/live` を直接踏む → `/` に redirect、UI ちらつきなし
- [ ] 匿名ユーザーが `/join/{tid}` で受付完了 → 「受付が完了しました」のみ表示
- [ ] AppShell が anonymous gate と fullscreen 廃止の両立で hooks 順序を壊さない
- [ ] DisplayName dialog の `users/{uid}` profile 不存在 → setup 完了で `upsertUserProfile` が呼ばれる
- [ ] `players.isPlayingDealer` Firestore Rules: self 経路で書込 deny / organizer 経路で OK / 不正型 deny

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
npm run lint
```

EXPECT: 0 type errors / 0 lint errors

### Unit Tests

```bash
npm run test
```

EXPECT: 既存 478+ tests + 新規 35+ tests = 全 pass

### Rules Emulator

```bash
firebase emulators:exec --only firestore "node scripts/test-rules-pd.mjs"
firebase emulators:exec --only firestore "node scripts/test-rules-default-seats.mjs"
firebase emulators:exec --only firestore "node scripts/test-rules-finished-count.mjs"
```

EXPECT: 全 pass

### Build

```bash
npm run build
```

EXPECT: Next.js build success

### E2E

```bash
npm run e2e
```

EXPECT: 既存 spec 全 pass + 新規 spec（PD ON/OFF, 匿名 redirect, state=seating 配席）pass

### Manual Validation

- [ ] 初回 Google ログインで DisplayName Dialog 表示
- [ ] 匿名ゲストで /join → 「受付が完了しました」表示で動線完結
- [ ] 匿名ゲストが /live を直接踏むと / に redirect
- [ ] 通常ユーザー（一般メンバー）で /live → サイドバーが出る
- [ ] サイドバーから自分の参加中トーナメントを 1 タップで開ける
- [ ] **setup 中の PlayerList で PD チェックボックスが表示、無制限に ON 可**
- [ ] **PD = 卓数で初回席決め → 各卓 1 PD、PD は席 1**
- [ ] **PD < 卓数で初回席決め → PD 配分済み卓と PD 不在卓（専任ディーラー扱い）が混在**
- [ ] **PD > 卓数で「席を確定」→ エラー「PD は X 名以下に絞ってください」表示、運営者が PlayerList で OFF にして再試行**
- [ ] **PD なしで初回席決め → seat 集合は [1..N] のランダム subset、全卓専任ディーラー扱い**
- [ ] **PD ON クリック（seating 以降）→ 該当 player が席 1 に、他 player が 1 つずつ後ろにずれる**
- [ ] **PD OFF クリック → フラグだけ降りる（席は不変）**
- [ ] **バランシング発動時 PD は動かない**
- [ ] **PD player を bust → 同卓全員の PD が外れる（専任ディーラー状態に戻る）**
- [ ] **テーブル閉鎖時、閉鎖卓の PD が外れて移動先での重複が発生しない**
- [ ] **座席確定後 (state=seating) に 3 人 late entry** → トーナメント開始を待たずに 1〜2 秒で座席表に追加
- [ ] 任意のタッチで音が鳴る（明示ボタンを押さなくても）

---

## Acceptance Criteria

- [ ] memo の 9 件 + 追加 2 件すべてが手動ブラウザで確認できる
- [ ] typecheck / lint / test / build / rules emulator すべて green
- [ ] 既存 E2E spec が全 pass、新規 E2E spec が追加されて pass
- [ ] schema は additive で破壊的 migration なし（`players.isPlayingDealer` は default(false) で既存 doc 受容）
- [ ] Firestore Rules 変更は `players/{pid}` update branch の `isPlayingDealer` 型 check 追加のみ（branch 数は不変）
- [ ] **PD は 1 卓 1 名のみ**（席決め後は service tx + UI disabled の二重防御、setup 中は無制限 ON 可だが `commitInitialSeating` で `seating/pd-too-many` 検証）
- [ ] **PD 数 ≤ 卓数を満たす場合、各卓に PD 1 名を seed-driven 分散配置**（PlayerList の checkbox で setup 中に運営者が候補指定）
- [ ] **PD ON 時に席 1 へ rotation**（seating 以降）、OFF 時は seat 不変
- [ ] **PD はバランシングで動かない**、テーブル閉鎖時のみ全員 OFF + 移動
- [ ] **bust 時に同卓全員 PD OFF**（busted player を含む同卓全員のフラグが false になり、専任ディーラー扱いの状態に戻る）
- [ ] **座席確定後 (state=seating) のレイトエントリーが 1〜2 秒以内に座席表に反映**
- [ ] **匿名ゲストは `/live` を踏めない**
- [ ] characterization test が先行投入されており、`engine-random-seat.test.ts` が seed 固定の再現性を保証

## Completion Checklist

- [ ] Code follows discovered patterns (NAMING / ERROR_HANDLING / LOGGING / REPOSITORY / TX + RACE GUARD / SCHEMA_ADDITIVE / FIRESTORE_RULES_BRANCH / TEST_STRUCTURE)
- [ ] `wrap.ts` helper 経由（手書き try/catch + AppError.from + logger.warn は新規 repository では使わない）
- [ ] 数値リミットは `src/lib/limits.ts` に集約
- [ ] `useGroupRole` を URL 由来 gid に対する role 解決に使う
- [ ] tournament state 判定は `src/lib/services/tournament-state.ts` の純関数（新規 `isAcceptingLateSeats` 含む）
- [ ] テストは fixture factory 経由 + helper 境界 mock
- [ ] `console.*` を直接呼ばない（logger 経由）
- [ ] characterization test ファースト（engine の random seat 化前に先行 test を投入）
- [ ] 文言は user-facing で「Table」（「卓」を新規導入しない）
- [ ] schema を緩めるときは rule / scripts/test-rules-*.mjs / docs を同期更新

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| 既存 E2E が seat 1,2,3,... を hardcode していて Phase 5.1 で全壊 | M | M | grep で全 hardcode を抽出し、helper 化（Task 22） |
| collectionGroup `players` の rule 評価コスト | L | L | 単一 where、認証済み read のみ |
| 暗黙 unlock が Safari iOS で動かない | M | L | 明示ボタンを fallback 維持 |
| 1 卓 1 PD 制約の race（同時 ON クリック） | L | M | service tx 内の `fetchTablePlayers` 再 read で fresh 検証 |
| setup 中 PD 数 > 卓数で commit 時にエラー → 運営者が混乱 | M | L | dashboard エラー文言を「PD は X 名以下に絞ってください（現在 N 名）」と具体的に表示。PlayerList で対象 player の checkbox を OFF にする操作で復旧可能 |
| setup 中の PD 配分で seed が同じだと同じ卓に集中する印象を与える | L | L | shuffle seed は `commitInitialSeating` 引数の seed を使うため、運営者が「席を再確定」しない限り変わらない（既存挙動と一致） |
| `bustPlayer` の signature 変更（sameTablePlayerIds 追加）で callsite 漏れ | M | M | typecheck で引数不足を検出。callsite は dashboard と PlayerList の 2 箇所程度 |
| state=seating で auto-seating を許すと、運営者が PD 設定→席決め→PD 取消→再席決め のフローでの中間状態 | M | M | `commitInitialSeating` は seating でも tx で再 commit して上書き。inflight Set + tx state guard で吸収 |
| 匿名 redirect で会場大画面投影中の参加者デモができなくなる | L | L | 運営者は通常アカウントで `/live` を見る |
| `users/{uid}` が rule 制約で読めず DisplayName 判定が失敗 | L | M | self-only read は通る。失敗時は warn、needsSetup=true（fail-safe） |
| PD ON 時の rotation で同卓 player の lastMovedAt が一斉更新 → /live の「席が移動しました」バナーが全員に表示 | L | L | 30 秒で消えるので問題小。気になるなら PD 自身は別 timestamp 更新 |
| `isAcceptingLateSeats` 純関数化に伴う既存 callsite の見落とし | L | M | tournament-state.ts の characterization test で 5 状態 × 期待値を網羅 |

## Notes

- 本 plan は **Phase 5（Field Test & Polish）の 1 回目のドライランで実際に発生した課題に対する fix サブフェーズ**。Phase 5 そのものの "投入前" ではない。PRD の Success Metric「サークルで 3 回連続使用」を満たすには本 plan 完了後に **2 回目以降のドライラン** が必要
- **PD モデルは `players/{pid}.isPlayingDealer: boolean` の player フラグ方式**を採用（`tournaments/{tid}.playingDealers` map ではない）。「卓 → PD」の対応は `player.tableNum` で自然に決まり、複数 PD 集約も「片方の player のフラグを下ろす」で表現できるため、map 管理より直感的かつ schema simple
- **PD の自動制御は 3 件のみ** に限定: (1) 初回席決めの席 1 固定、(2) PD ON 時の rotation、(3) バランシングで PD 移動候補除外。それ以外（bust 時 / table break 時）は **同卓・閉鎖卓の player の PD フラグ auto-OFF** という defensive な振る舞いに倒し、運営者の手動再指名で復旧する
- **「専任ディーラー（アプリ外の誰かが担当）」は卓内 PD 全 OFF で自然に表現**される（独立フィールドや別 collection は不要）。busted player が会場で専任ディーラーになるケースも、bust 時の auto-OFF で同卓全員が PD 不在になり、そのまま「専任ディーラーが見る卓」として扱える。アプリは席を持たない PD を管理しない
- memo item 8（「画面を見直したら追加されていた」）は **2 つの異なる原因が混在**:
  1. **時間差で見える追加**: `useSeatingAutoOrchestrator` が `state === "running" || "paused"` のみ発火するため、座席確定 (state=seating) 後のレイトエントリーがトーナメント開始まで配席されない。Task 6.5 で `seating` を発火条件に加えて即時化
  2. **席番号が変わったように見える**: 連番 (1..N) ベースの SeatingBoard 表示で、新規参加 → 「全体の席が変わった」と感じる。Task 3-4 でランダム抽選に変えて UX 摩擦を解消
- memo item 9（「サークル未所属かつ招待コードでトーナメント参加時に画面抜けると戻れない」）は **方針転換** で根本解決: 匿名ゲストは `/live` を見せず受付完了画面のみで動線完結
- 匿名ゲストが進行中のブラインド・残時間を確認したい場合は **会場の運営 PC / 大画面投影** を見る前提
- Phase 5.1 完了 → 2 回目のドライラン → 必要に応じて Phase 5.2 として追加 fix を起票、を 3 回連続使用に達するまで繰り返す
- emulator validation script は `firebase` CLI が必要なため CI には**含めない**。手動実行 + ローカル green 確認をリリース基準とする
- collectionGroup query を導入する際、Firestore の自動 single-field index で `uid asc` がカバーされるか **要動作確認**
