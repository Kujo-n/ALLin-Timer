# Plan: Phase B — Timer Offline Resilience

## Summary

`advanceLevel(auto)` の `runTransaction` 経路に **「tx 試行 → tx 失敗時は updateDoc fallback」の二段構え**を導入し、一時通信障害で auto-advance が即時失敗する現状を解消する。同時に `tournaments/[tid]` 系画面の最上段に **`<OfflineBanner />`** を追加し、`fromCache=true`（接続切れ）/ `hasPendingWrites=true`（書込キュー存在）の運用者視点を 1 つの帯で可視化する。Phase B の Core は「ブラインドレベルが上がる」の保証で、Could 扱いの multi-tab 警告 UI は本 Phase では行わず Phase D 範囲とする。

## User Story

As a サークル運営者（owner / organizer）,
I want 会場で進行中に Wi-Fi / モバイル回線が一瞬切れても **タイマーのブラインドレベルが正しく自動進行**し、復帰時に他端末と整合した状態に同期されたい,
So that 通信障害ごとに「次レベル」を手動で押す必要がなくなり、運営に専念できる。

And as a サークル運営者,
I want 「いま接続が切れているか」「自分の操作が送信予定キューに乗っているか」が画面上段の帯で一目で分かりたい,
So that 「ボタンを押したのに反映されない」と誤認して二重押しする事故を防げる。

## Problem → Solution

**Current state**:

- `advanceLevel(tid, uid, gids, { expectedLevel })` は `runTransaction` 一本（[repositories/tournaments.ts:404-427](../../../../src/lib/firebase/repositories/tournaments.ts#L404-L427)）で実装されている。
- Firestore の `runTransaction` は **オフラインで即時 reject** される（read-then-write の atomic 性のためサーバー往復必須）。よって会場 Wi-Fi が一瞬切れた瞬間に auto-advance は失敗し、ブラインドが上がらない。
- 失敗は `useTournamentTimer` 内で `logger.warn` するだけで UI にも露出しないため、運営者は「進まない」と気付けずに手動「次レベル」を押すか、リロードするしかない。
- pending writes（queue 中の書込）は `subscribeTournament` の payload に `hasPendingWrites` として既に流れているが、`ConnectionBadge` は `fromCache` のみ表示し、書込キューの存在は UI に出ていない。
- 「通信障害中」を運用者へ説明するバナーは存在しない（DeviceFallbackHints が Wake Lock 未対応の hint を出すのみ）。

**Desired state**:

- `advanceLevel(auto)` は **tx 試行 → tx 失敗かつオフライン由来 error code（`unavailable` / `cancelled` / `deadline-exceeded` / `internal`）のときのみ `updateDoc(...)` で fallback** する。`firestore/permission-denied` / `firestore/not-found` / 内部 throw された `AppError` は引き続き reject。

> **NOTE（実装時の plan refinement）**: 当初 plan は `failed-precondition` / `aborted` も offline 由来として例示していたが、コードレビュー（M1/L1）で以下のように整理した:
>
> - `failed-precondition` — tx pre-condition 違反 / index 不在等で **offline ではない**ため除外。test [tournaments.test.ts:564-573](../../../../src/lib/firebase/repositories/tournaments.test.ts#L564-L573) で「再 throw される」ことを固定化
> - `aborted` — runTransaction の SDK 内部 retry を 5 回尽くした後の surface（local cached view が古い可能性が高い）。stale な currentLevel を信じた fallback は二重 advance race を生むため除外
>
> 最終 allowlist は `unavailable` / `cancelled` / `deadline-exceeded` / `internal` の 4 件。
- fallback 経路は client が hook 側で `shouldAutoAdvance(t)` 判定済み（= `state==="running"`）を前提とし、`levelTransitionUpdates("running", expected + 1, "auto")` を投げる。Firestore SDK の write queue に乗り、復帰時に flush される。`tournament/finish*` のような複雑な atomic 性は不要なので楽観 update で割り切る。
- 既存の race guard（`currentLevel === expected` 楽観 check）は **tx 内とは別に hook 側で既に成立している**ため、fallback 経路では client が直前 read した `expected` をそのまま `expected + 1` として書く。online 復帰時に他端末が先に進めていた場合は eventual consistency に倒す（`currentLevel` は単調増加で値域内のため壊滅的影響なし）。
- `<OfflineBanner />` を `/tournaments/[tid]` / `/tournaments/[tid]/live` の最上段に追加し、`fromCache && state ∈ {seating,running,paused}` のとき「⚠ 通信が一時切れています — 操作は端末に保存され、復帰時に自動同期されます」、`!fromCache && hasPendingWrites` のとき「⏳ 同期中…」を出す。両者偽は表示なし（占有領域 0）。
- `tournaments.test.ts` に Phase B 用 4 ケース（tx 成功 / tx 失敗 → fallback 成功 / 非オフライン error は再 throw / fallback 自体が失敗で wrap_failed）を追加。

## Metadata

- **Complexity**: Medium
- **Source PRD**: [.claude/PRPs/03-pwa-app-shell/prds/03-pwa-app-shell.prd.md](../prds/03-pwa-app-shell.prd.md)
- **PRD Phase**: Phase B — Timer Offline Resilience
- **Estimated Files**: 約 9 files（new util 1 / new component 1 / 各 test 2 / repository update 1 + test / dashboard + live update / PRD update）

---

## UX Design

### Before（現状）

`/tournaments/[tid]`（運営者ダッシュボード、running 中、Wi-Fi が切れた瞬間）:

```
┌──────────────────────────────────────────────────────────┐
│ ALLin-PokerTimer  [Monthly トーナメント]  [👤 owner]      │ ← header
├──────────────────────────────────────────────────────────┤
│ （header の右隅に小さく ⛔ 接続切れ 最終 12:34:05）        │ ← ConnectionBadge のみ
│                                                            │
│  ┌─ QR ─┐  ┌─ Timer 06:42 Lv.5 ─┐  ┌─ Players 18/20 ─┐    │
│  │      │  │  [⏸] [▶] [📺] [🔇]  │  │ ...             │    │
│  └──────┘  └──────────────────────┘  └─────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

問題:

- 残 0 観測 → `runTransaction` 即時失敗 → ブラインドが Lv.5 のまま動かない
- 運営者は「何が起きているか」を ConnectionBadge の小さなバッジから読み取らねばならない

### After

`/tournaments/[tid]`（接続切れ中、auto-advance fallback で Lv.6 に進む直前 / 直後）:

```
┌──────────────────────────────────────────────────────────┐
│ ALLin-PokerTimer  [Monthly トーナメント]  [👤 owner]      │ ← header
├──────────────────────────────────────────────────────────┤
│ ⚠ 通信が一時切れています — 操作は端末に保存され、         │ ← OfflineBanner（追加）
│   復帰時に自動同期されます                                 │
├──────────────────────────────────────────────────────────┤
│  ┌─ QR ─┐  ┌─ Timer 09:55 Lv.6 ─┐  ┌─ Players 18/20 ─┐    │
│  │      │  │ [⏸] [▶] [📺] [⛔最終12:34:05] [🔇]      │  │ ← ConnectionBadge は据置
│  └──────┘  └──────────────────────────┘  └─────────────┘    │
└──────────────────────────────────────────────────────────┘
```

`!fromCache && hasPendingWrites`（Wi-Fi 復帰直後で flush 中）:

```
├──────────────────────────────────────────────────────────┤
│ ⏳ 同期中… 端末からの操作をサーバへ送信しています          │ ← OfflineBanner
├──────────────────────────────────────────────────────────┤
```

### Interaction Changes

| Touchpoint                                  | Before                                                   | After                                                                                       | Notes                                                       |
| ------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 一時通信障害時の auto-advance               | `runTransaction` 即時失敗 → ブラインドが上がらない       | tx 失敗 + offline code 検出 → `updateDoc` fallback で queue → 復帰時 flush                  | `currentLevel === expected` 楽観 update（hook 側保証）        |
| 一時通信障害時の状態理解                    | header 隅の ConnectionBadge のみ                         | ⚠ 通信が一時切れています — の OfflineBanner（黄色）+ 既存 ConnectionBadge                  | dashboard / live の `<header>` 直下                          |
| Wi-Fi 復帰直後（pending writes flush 中）   | 何も表示されない                                         | ⏳ 同期中… バナー（青）                                                                    | `!fromCache && hasPendingWrites` の組合せ                  |
| 完全 online                                 | バナーなし                                               | バナーなし（占有領域 0）                                                                   | `null` を return                                            |
| `/tournaments/[tid]/seating` / その他       | 変更なし                                                 | 変更なし                                                                                   | OfflineBanner は dashboard / live の 2 画面に絞る           |
| permission-denied / not-found（rule 違反）  | `firestore/write_failed` で wrap                         | 変更なし（fallback には**入らない**、AppError は素通し）                                   | `if (e instanceof AppError) throw e` で早期 throw          |

---

## Mandatory Reading

実装着手前に必ず Read する（記憶頼り厳禁）:

| Priority       | File                                                                                              | Lines      | Why                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| P0 (critical)  | [.claude/rules/firebase-patterns.md](../../../../.claude/rules/firebase-patterns.md)              | all        | repository / tx / wrap helper / converter / drift 警告の真実源                                    |
| P0 (critical)  | [.claude/rules/error-logging.md](../../../../.claude/rules/error-logging.md)                      | all        | `AppError.from` / `unwrapOrFrom` / `getErrorCode` の使い分け / `console.*` 禁止                  |
| P0 (critical)  | [.claude/rules/testing.md](../../../../.claude/rules/testing.md)                                  | all        | mock 境界 / characterization test / fixture factory / skip 禁止                                  |
| P0 (critical)  | [src/lib/firebase/repositories/tournaments.ts](../../../../src/lib/firebase/repositories/tournaments.ts) | 376-448    | `levelTransitionUpdates` 純関数 + `advanceLevel` 分岐構造 / `wrapFirestoreWrite` の使い方       |
| P0 (critical)  | [src/lib/hooks/useTournamentTimer.ts](../../../../src/lib/hooks/useTournamentTimer.ts)            | 100-133    | auto-advance 発火条件（`shouldAutoAdvance` + `expectedLevel: tournament.currentLevel`）。 fallback の前提 |
| P1 (important) | [src/lib/firebase/wrap.ts](../../../../src/lib/firebase/wrap.ts)                                  | all        | `wrapFirestoreWrite` の責務（throw 時のみ warn / 成功 log は外）                                |
| P1 (important) | [src/lib/errors.ts](../../../../src/lib/errors.ts)                                                | all        | `AppError.from` / `unwrapOrFrom` / `getErrorCode` の挙動                                        |
| P1 (important) | [src/lib/firebase/repositories/tournaments.test.ts](../../../../src/lib/firebase/repositories/tournaments.test.ts) | 1-100, 401-508 | mock 構成（vi.mock firebase/firestore / runTransaction / updateDoc）と既存 advanceLevel テスト形 |
| P1 (important) | [src/components/tournament/ConnectionBadge.tsx](../../../../src/components/tournament/ConnectionBadge.tsx) | all        | 既存 fromCache 表示の現行スタイル（OfflineBanner と役割を被らせない設計参照）                  |
| P1 (important) | [src/lib/services/timer.ts](../../../../src/lib/services/timer.ts)                                | 192-201    | `shouldAutoAdvance` の真偽条件（`state === "running"` を含む）                                   |
| P2 (reference) | [src/components/audio/SoundUnlockBanner.tsx](../../../../src/components/audio/SoundUnlockBanner.tsx) | all        | 同種「上部に挟む情報バナー」の既存実装（aria 属性 / Tailwind / lucide icon）                     |
| P2 (reference) | [src/components/pwa/IOsInstallHint.tsx](../../../../src/components/pwa/IOsInstallHint.tsx)        | all        | Phase A 同 PRD の banner 形式パターン（role="note" / amber bg / Info icon）                     |
| P2 (reference) | [src/components/pwa/IOsInstallHint.test.tsx](../../../../src/components/pwa/IOsInstallHint.test.tsx) | all        | client-only banner の vitest テスト構成（render / queryByRole）                                |

## External Documentation

| Topic                                | Source                                                                                                          | Key Takeaway                                                                                                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Firestore オフライン挙動             | [https://firebase.google.com/docs/firestore/manage-data/transactions](https://firebase.google.com/docs/firestore/manage-data/transactions) | "Transactions cannot be performed while the client is offline" — `runTransaction` はオフラインで即時 reject。`updateDoc` / `setDoc` / `writeBatch` は queue されオンライン復帰で flush |
| FirebaseError code 一覧              | [https://firebase.google.com/docs/reference/js/firestore_.firestoreerror](https://firebase.google.com/docs/reference/js/firestore_.firestoreerror) | Firestore SDK が throw する `code` は `unavailable` / `cancelled` / `deadline-exceeded` / `failed-precondition` / `internal` / `permission-denied` / `not-found` 他           |
| `hasPendingWrites` / `fromCache`     | [https://firebase.google.com/docs/firestore/query-data/listen#events-metadata-changes](https://firebase.google.com/docs/firestore/query-data/listen#events-metadata-changes) | `SnapshotMetadata` 経由で取得。`includeMetadataChanges: true` で metadata 更新も snapshot として fire される                                                                  |

```
KEY_INSIGHT: Firestore SDK の write メソッド（updateDoc / setDoc / writeBatch）は **オフラインでも resolve する** — local IndexedDB queue に入った時点で `await` した promise は resolve され、実 flush は復帰時に行われる。よって fallback の `await updateDoc(...)` は queue 投入で OK
APPLIES_TO: Task 2（advanceLevel auto fallback の実装）
GOTCHA: `await` が resolve した時点ではサーバ反映を保証しない。`hasPendingWrites=true` で UI 上は「⏳ 同期中…」を表示し、運営者が「サーバに届いた」と誤認しないようにする
```

```
KEY_INSIGHT: `runTransaction` はオフラインで FirebaseError(`code: "unavailable"`) を throw する。タブ閉じやネットワーク中断系で `cancelled` / `deadline-exceeded` も観測しうる。逆に `permission-denied` / `not-found` / `failed-precondition`（tx 内の rule 違反等）はオフライン由来ではないため fallback してはいけない（rule 違反を queue に隠してしまう）
APPLIES_TO: Task 1（isOfflineFirestoreErrorCode 純関数）/ Task 2
GOTCHA: tx 内で `throw new AppError(...)` した場合は wrap 経由でも `AppError` のまま catch されるため、`if (e instanceof AppError) throw e` で先に再 throw する。これを忘れると not-found / permission-denied を queue に流してしまう
```

```
KEY_INSIGHT: `auto-advance` の発火条件は hook 側で `shouldAutoAdvance(t, Date.now())` が `state === "running"` を含めて担保している。fallback 経路で `levelTransitionUpdates(prevState, ...)` の `prevState` を再取得する必要はない（"running" 固定で安全）
APPLIES_TO: Task 2
GOTCHA: 仮に hook の前提が将来崩れて auto-advance が paused 中に発火するように変更されると、fallback の "running" 固定が逆に invariant 違反を生む。Phase B では characterization test で「auto 経路は state="running" 前提」を固定化する（test name に明記）
```

```
KEY_INSIGHT: tx fallback で `updateDoc` を投げると、後続で他端末が先に進めていた場合に「自分は Lv.6 へ、他端末は Lv.7 へ」という二重 advance が race として起きうる。Firestore は単純な field write なので最終書き勝ち。`currentLevel` は単調増加かつ levels.length 値域内のため壊滅的影響はないが、テストで「fallback 後に他端末が先に進めた場合の eventual consistency」を assert はしない（観測不能）
APPLIES_TO: Task 4（test）/ NOT Building（Phase B 範囲外）
```

---

## Patterns to Mirror

実コードベースから抽出した既存パターン。新規コードはこれに揃える。

### NAMING_CONVENTION（純関数 service module）

```ts
// SOURCE: src/lib/services/tournament-state.ts:1-44
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";

export function isRunning(t: TournamentDoc): boolean {
  return t.state === "running";
}
// ...
```

- `src/lib/services/{kebab-name}.ts` に純関数を集約
- 副作用なし、`type` import は明示
- `export function name(...): ReturnType` の inline 型注釈

### ERROR_HANDLING + LOGGING_PATTERN（repository fallback 経路）

```ts
// SOURCE: src/lib/firebase/repositories/tournaments.ts:404-427（既存 advanceLevel auto）
await wrapFirestoreWrite(
  "firestore/write_failed",
  "レベル進行に失敗しました",
  async () => {
    await runTransaction(firestore, async (tx) => {
      const t = await loadTournamentInTx(tx, tid, userGroupIds);
      if (t.currentLevel !== expected) {
        logger.info("advance level skipped (race)", { tid, expected, actual: t.currentLevel });
        return;
      }
      if (t.currentLevel >= t.structureSnapshot.levels.length) return;
      tx.update(ref, levelTransitionUpdates(t.state, t.currentLevel + 1, "auto"));
    });
  },
  { tid },
);
logger.info("advance level ok (auto)", { tid, uid, expected });
```

- `wrapFirestoreWrite(code, msg, async () => { ... }, meta)` で囲む
- 成功 `logger.info` は **wrap の外**（wrap は失敗時 warn のみ責務）
- meta は `{ tid }` 等の構造化フィールド

### TX_FALLBACK_PATTERN（Phase B で新たに導入する形）

```ts
// 新規パターン（本 Phase 確立）— 既存 tx を try に入れ、catch で AppError は再 throw、
// オフライン由来 FirebaseError のみ updateDoc fallback に倒す
await wrapFirestoreWrite(
  "firestore/write_failed",
  "レベル進行に失敗しました",
  async () => {
    try {
      await runTransaction(firestore, async (tx) => {
        const t = await loadTournamentInTx(tx, tid, userGroupIds);
        if (t.currentLevel !== expected) {
          logger.info("advance level skipped (race)", { tid, expected, actual: t.currentLevel });
          return;
        }
        if (t.currentLevel >= t.structureSnapshot.levels.length) return;
        tx.update(ref, levelTransitionUpdates(t.state, t.currentLevel + 1, "auto"));
      });
      return; // tx success
    } catch (e) {
      // tx 内で投げた AppError（permission-denied / not-found）は素通し
      if (e instanceof AppError) throw e;
      // FirebaseError でオフライン由来コードのみ fallback。それ以外は再 throw
      const code = getErrorCode(e);
      if (!isOfflineFirestoreErrorCode(code)) throw e;
      logger.warn("advance level tx offline; falling back to updateDoc", {
        tid, expected, code,
      });
    }
    // updateDoc fallback。Firestore SDK は offline でも queue に入れて resolve する
    await updateDoc(
      doc(tournamentsRef, tid),
      levelTransitionUpdates("running", expected + 1, "auto"),
    );
  },
  { tid },
);
logger.info("advance level ok (auto)", { tid, uid, expected });
```

- tx の **内側 try**、wrap は外側
- `if (e instanceof AppError) throw e` を最優先で書く
- オフライン code は純関数 `isOfflineFirestoreErrorCode(code)` に集約（Task 1）
- fallback の `prevState` は `"running"` 固定（hook 側で `shouldAutoAdvance` が担保）

### CLIENT_COMPONENT_PATTERN（情報バナー）

```tsx
// SOURCE: src/components/pwa/IOsInstallHint.tsx:5-49
"use client";

import { Info, Share } from "lucide-react";
import { useEffect, useState } from "react";

export function IOsInstallHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    // ... feature detection
  }, []);
  if (!show) return null;
  return (
    <section
      role="note"
      className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 border-b border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-700 dark:bg-amber-900/20"
    >
      <Info aria-hidden className="h-4 w-4 shrink-0" />
      <span className="flex-1">…</span>
    </section>
  );
}
```

- `"use client"` 必須
- `role="note"` で常設情報（`alert` ではない）
- `aria-hidden` を icon に付与
- amber は warn 系、blue は info 系（OfflineBanner では「接続切れ=amber」「同期中=blue」を使い分け）

### TEST_STRUCTURE（repository unit test for auto branch）

```ts
// SOURCE: src/lib/firebase/repositories/tournaments.test.ts:451-507
describe("advanceLevel (auto with expectedLevel)", () => {
  function mockTransaction(state: TournamentDoc | null, captureUpdate?: (p: unknown) => void) {
    vi.mocked(runTransaction).mockImplementationOnce(async (_db, fn) => {
      const tx = {
        get: vi.fn().mockResolvedValue({
          exists: () => state !== null,
          id: state?.id ?? "missing",
          data: () => (state ? stripId(state) : undefined),
        }),
        update: vi.fn((_ref, patch) => captureUpdate?.(patch)),
        // ...
      };
      await fn(tx as unknown as Parameters<typeof fn>[0]);
      return undefined as unknown;
    });
  }
  it("commits update when expected matches and not on final level", async () => {
    // ...
  });
});
```

- `vi.mocked(runTransaction).mockImplementationOnce(...)` で tx 内挙動を制御
- `vi.mocked(updateDoc).mock.calls[0][1]` で payload を assert
- fixture factory `makeTournament(overrides)` を再利用

---

## Files to Change

| File                                                                                                                  | Action | Justification                                                                                                |
| --------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| [src/lib/services/firestore-offline.ts](../../../../src/lib/services/firestore-offline.ts)                            | CREATE | `OFFLINE_ERROR_CODES` 配列 + `isOfflineFirestoreErrorCode()` 純関数。tx fallback の判定単一真実源              |
| [src/lib/services/firestore-offline.test.ts](../../../../src/lib/services/firestore-offline.test.ts)                  | CREATE | offline / non-offline / unknown / 大文字小文字 / FirebaseError prefix 形式の characterization                  |
| [src/lib/firebase/repositories/tournaments.ts](../../../../src/lib/firebase/repositories/tournaments.ts)              | UPDATE | `advanceLevel` auto 分岐に try/catch + updateDoc fallback を導入                                              |
| [src/lib/firebase/repositories/tournaments.test.ts](../../../../src/lib/firebase/repositories/tournaments.test.ts)    | UPDATE | auto 分岐の fallback 4 ケースを追加（tx 失敗 → fallback 成功 / AppError は素通し / 非 offline は再 throw / fallback 失敗で wrap）|
| [src/components/tournament/OfflineBanner.tsx](../../../../src/components/tournament/OfflineBanner.tsx)                | CREATE | `fromCache` / `hasPendingWrites` の組合せから 2 種類のバナーを出し分け                                          |
| [src/components/tournament/OfflineBanner.test.tsx](../../../../src/components/tournament/OfflineBanner.test.tsx)      | CREATE | 4 ケース（online no-pending / online pending / offline / offline pending）                                    |
| [src/app/tournaments/[tid]/dashboard-client.tsx](../../../../src/app/tournaments/[tid]/dashboard-client.tsx)          | UPDATE | `<OfflineBanner fromCache={fromCache} hasPendingWrites={...} />` を `<header>` 直下に mount                  |
| [src/app/tournaments/[tid]/live/live-client.tsx](../../../../src/app/tournaments/[tid]/live/live-client.tsx)          | UPDATE | 同上（live 画面でも参加者に状態を見せる）                                                                       |
| [src/lib/hooks/useTournamentTimer.ts](../../../../src/lib/hooks/useTournamentTimer.ts)                                | NO-OP  | 既に `hasPendingWrites` を返している（変更不要、確認のみ）                                                     |
| [.claude/PRPs/03-pwa-app-shell/prds/03-pwa-app-shell.prd.md](../prds/03-pwa-app-shell.prd.md)                         | UPDATE | Implementation Phases 表の Phase B status を `pending` → `in-progress` に更新 + 本 plan へのリンク貼付         |

## NOT Building

- **multi-tab 同時オープン警告 UI** — PRD で Could 扱い。Firestore SDK の multi-tab leader race（[firebase-js-sdk#6511](https://github.com/firebase/firebase-js-sdk/issues/6511)）回避のための presence doc / BroadcastChannel API 連携は **Phase D の Polish** にまわす（owner / organizer 限定 install banner と一緒に検討するほうが scope 的に整合する）
- **`finishTournament` のオフライン対応** — PRD で Won't 明記。`seasonStats` の atomicity 維持のため引き続き online 必須
- **`commitInitialSeating` / `applyTableBreak` / `assignSeat` のオフライン耐性化** — PRD で Won't 明記
- **手動 `advanceLevel` のオフライン対応** — 既に `updateDoc` ベースで queue 可能。本 Phase で追加対応不要（既に動く）
- **`pauseTournament` / `resumeTournament` / `revertLevel` のオフライン対応** — 同上、`updateDoc` ベースで既に queue される
- **OfflineBanner を全画面 globally に出す** — `app/layout.tsx` にではなく `dashboard-client` / `live-client` の中に絞る。理由:
  - 他の画面（`/tournaments` 一覧 / `/groups` 等）は static 寄りで「タイマー進行が止まる」体感が無い
  - global 配置すると IOsInstallHint と縦に積み上がり画面上部の占有が増える
  - 「進行中」を hint する `tournament.state` の context が `app/layout.tsx` には流れていない（GroupProvider はあるが tournament 単位の subscribe は client コンポネ内）
- **OfflineBanner に「強制再接続」ボタン等のアクション** — Firestore SDK は自動再接続するため不要。情報バナーの責務に絞る
- **race 復帰 reconcile（fallback 後に他端末が先行していた場合の補正）** — `currentLevel` は単調増加で値域内のため壊滅的影響なし、PRD Decisions Log で「楽観 update に倒し race は eventual consistency に委ねる」と確定済み

---

## Step-by-Step Tasks

### Task 1: `src/lib/services/firestore-offline.ts` 純関数の作成

- **ACTION**: `src/lib/services/firestore-offline.ts` を新規作成し、Firestore SDK のオフライン由来 error code 判定 helper を実装
- **IMPLEMENT**:

  ```ts
  // src/lib/services/firestore-offline.ts
  /**
   * Firestore SDK が **一時通信障害（オフライン）由来**で throw する FirebaseError.code 一覧。
   *
   * runTransaction はオフラインで即時 reject されるが、catch 側で「オフライン由来か / それ以外（rule
   * 違反 / not-found / tx 内部 throw）か」を区別しないと updateDoc fallback で rule 違反を queue に
   * 隠してしまう。本配列は **fallback 対象**を明示的に列挙する allowlist。
   *
   * - `unavailable` — 通常のネットワーク到達不能（最頻）
   * - `cancelled` — タブ閉じ / ページ遷移時の中断
   * - `deadline-exceeded` — RTT タイムアウト（弱回線で観測される）
   * - `internal` — 一過性の SDK 内部エラー（オフライン直前に観測しうる）
   * - `aborted` — tx 衝突（オフラインとは厳密に異なるが、再試行が無意味なので fallback に含む）
   *
   * `permission-denied` / `not-found` / `failed-precondition` / `invalid-argument` /
   * `already-exists` は **オフライン由来ではない**ため含まない。これらは rule 違反 / data
   * mismatch なので fallback すると不正書込を queue に隠す。
   */
  export const OFFLINE_FIRESTORE_ERROR_CODES: readonly string[] = [
    "unavailable",
    "cancelled",
    "deadline-exceeded",
    "internal",
    "aborted",
  ];

  /**
   * `getErrorCode(e)` で取り出した文字列が、オフライン由来 fallback の対象か判定する。
   *
   * Firestore SDK の FirebaseError は `code: "firestore/unavailable"` ではなく
   * `code: "unavailable"` の素の形（`firestore` ドメイン prefix なし）で throw される。
   * 一方プロジェクト内 `AppError` は `firestore/...` prefix を付ける。本判定は **両形式を許容** する:
   *   - `unavailable`           → true（FirebaseError 直接）
   *   - `firestore/unavailable` → true（仮にどこかで AppError に wrap されていた場合の防御）
   *   - `firestore/permission-denied` → false
   *   - `unknown`               → false
   */
  export function isOfflineFirestoreErrorCode(code: string): boolean {
    if (OFFLINE_FIRESTORE_ERROR_CODES.includes(code)) return true;
    const stripped = code.startsWith("firestore/") ? code.slice("firestore/".length) : null;
    return stripped !== null && OFFLINE_FIRESTORE_ERROR_CODES.includes(stripped);
  }
  ```

- **MIRROR**:
  - 純関数 service module 形: [src/lib/services/tournament-state.ts:1-44](../../../../src/lib/services/tournament-state.ts#L1-L44)
  - allowlist 配列の export 形: [src/lib/limits.ts](../../../../src/lib/limits.ts)
- **IMPORTS**: なし（pure TypeScript）
- **GOTCHA**:
  - `permission-denied` を **絶対に含めない** — rule 違反を queue に隠す致命的バグになる
  - 配列は `readonly string[]` で freeze 意図を明示。ただし `as const` と `readonly` どちらでも OK で、本プロジェクト既存パターンは `readonly`
  - `firestore/` prefix 形を許容するのは将来 `AppError.from(e, "firestore/<original>", ...)` のような wrap が入った場合の防御。実際の運用では FirebaseError 素のまま catch するため `unavailable` 単独で当たる
- **VALIDATE**:
  - `npm run typecheck` zero error
  - 後続 Task 2 が本 helper を import できる

### Task 2: `firestore-offline.test.ts` の characterization test

- **ACTION**: `src/lib/services/firestore-offline.test.ts` を新規作成し、各 code の判定を固定化
- **IMPLEMENT**:

  ```ts
  // src/lib/services/firestore-offline.test.ts
  import { describe, expect, it } from "vitest";

  import {
    OFFLINE_FIRESTORE_ERROR_CODES,
    isOfflineFirestoreErrorCode,
  } from "./firestore-offline";

  describe("isOfflineFirestoreErrorCode", () => {
    it.each(OFFLINE_FIRESTORE_ERROR_CODES)(
      "returns true for offline code %s",
      (code) => {
        expect(isOfflineFirestoreErrorCode(code)).toBe(true);
      },
    );

    it.each([
      "permission-denied",
      "not-found",
      "failed-precondition",
      "invalid-argument",
      "already-exists",
    ])("returns false for non-offline FirebaseError code %s", (code) => {
      expect(isOfflineFirestoreErrorCode(code)).toBe(false);
    });

    it("accepts firestore/ prefix form for offline codes", () => {
      expect(isOfflineFirestoreErrorCode("firestore/unavailable")).toBe(true);
      expect(isOfflineFirestoreErrorCode("firestore/cancelled")).toBe(true);
    });

    it("rejects firestore/ prefix form for non-offline codes", () => {
      expect(isOfflineFirestoreErrorCode("firestore/permission-denied")).toBe(false);
      expect(isOfflineFirestoreErrorCode("firestore/not-found")).toBe(false);
    });

    it("returns false for unknown / empty / unrelated codes", () => {
      expect(isOfflineFirestoreErrorCode("unknown")).toBe(false);
      expect(isOfflineFirestoreErrorCode("")).toBe(false);
      expect(isOfflineFirestoreErrorCode("auth/popup-blocked")).toBe(false);
      expect(isOfflineFirestoreErrorCode("tournament/invalid-state")).toBe(false);
    });
  });
  ```

- **MIRROR**:
  - 純関数 vitest 形: [src/lib/errors.test.ts](../../../../src/lib/errors.test.ts)（`describe` / `it.each` の形）
  - `it.each(...)` での 1-行テスト網羅: [src/lib/services/tournament-state.test.ts](../../../../src/lib/services/tournament-state.test.ts)
- **IMPORTS**:
  - `import { describe, expect, it } from "vitest";`
  - `import { OFFLINE_FIRESTORE_ERROR_CODES, isOfflineFirestoreErrorCode } from "./firestore-offline";`
- **GOTCHA**:
  - **絶対に**「offline code に permission-denied を加えるテスト」を書かない（誤って Task 1 の判定が緩くなったときに気付けない）
  - `it.each(OFFLINE_FIRESTORE_ERROR_CODES)` で配列内全 code をパラメ化することで、Task 1 で配列を増やしたときに自動的にカバレッジが増える
- **VALIDATE**:
  - `npm test src/lib/services/firestore-offline.test.ts` で全 case green

### Task 3: `repositories/tournaments.ts` の `advanceLevel(auto)` に二段構え fallback を実装

- **ACTION**: 既存 [`advanceLevel`](../../../../src/lib/firebase/repositories/tournaments.ts#L398-L448) の auto 分岐（`opts.expectedLevel !== undefined`）を try/catch + updateDoc fallback 形に書き換える。manual 分岐（後半）は変更しない
- **IMPLEMENT**:

  ```ts
  // src/lib/firebase/repositories/tournaments.ts:398-430（auto 分岐の差替）
  // ... existing imports に追加:
  import { AppError, getErrorCode } from "@/lib/errors";  // getErrorCode を追加
  // ...
  import { isOfflineFirestoreErrorCode } from "@/lib/services/firestore-offline";  // 新規

  export async function advanceLevel(
    tid: string,
    uid: string,
    userGroupIds: string[],
    opts: { expectedLevel?: number } = {},
  ): Promise<void> {
    if (opts.expectedLevel !== undefined) {
      const expected = opts.expectedLevel;
      const ref = doc(tournamentsRef, tid);
      await wrapFirestoreWrite(
        "firestore/write_failed",
        "レベル進行に失敗しました",
        async () => {
          try {
            await runTransaction(firestore, async (tx) => {
              const t = await loadTournamentInTx(tx, tid, userGroupIds);
              if (t.currentLevel !== expected) {
                logger.info("advance level skipped (race)", {
                  tid,
                  expected,
                  actual: t.currentLevel,
                });
                return;
              }
              if (t.currentLevel >= t.structureSnapshot.levels.length) return;
              tx.update(
                ref,
                levelTransitionUpdates(t.state, t.currentLevel + 1, "auto"),
              );
            });
            return; // tx 成功
          } catch (e) {
            // tx 内で投げた AppError（permission-denied / not-found 等）は素通しで再 throw。
            // updateDoc fallback で rule 違反を queue に隠さないために必須。
            if (e instanceof AppError) throw e;
            // FirebaseError でオフライン由来 code のみ updateDoc fallback。それ以外は再 throw
            const code = getErrorCode(e);
            if (!isOfflineFirestoreErrorCode(code)) throw e;
            logger.warn("advance level tx offline; falling back to updateDoc", {
              tid,
              expected,
              code,
            });
          }
          // updateDoc fallback。Firestore SDK は offline でも write を IndexedDB queue に
          // 入れて即 resolve する。levelTransitionUpdates の prevState は "running" 固定で
          // 良い（auto-advance は hook 側 shouldAutoAdvance で state==="running" を担保しているため）。
          await updateDoc(
            ref,
            levelTransitionUpdates("running", expected + 1, "auto"),
          );
        },
        { tid },
      );
      logger.info("advance level ok (auto)", { tid, uid, expected });
      return;
    }

    // ↓ 以下 manual 分岐は既存のまま変更しない
    const t = await assertCanManage(tid, userGroupIds);
    if (!canAdvanceLevel(t)) {
      throw new AppError("最終レベルです", "tournament/invalid-state");
    }
    // ...
  }
  ```

- **MIRROR**:
  - try/catch + AppError 早期 throw + getErrorCode: [src/lib/services/auth-actions.ts:200-220](../../../../src/lib/services/auth-actions.ts) の FirebaseError 分岐
  - `wrapFirestoreWrite` + 内側 op + 外側 `logger.info`: 既存 `advanceLevel` auto 分岐 / `pauseTournament` 等
- **IMPORTS** に追加（既存 import block に挿入）:
  - `import { AppError, getErrorCode } from "@/lib/errors";`（既存 `AppError` import に `getErrorCode` を追記）
  - `import { isOfflineFirestoreErrorCode } from "@/lib/services/firestore-offline";`
- **GOTCHA**:
  - **`if (e instanceof AppError) throw e` は最初の guard** — 順序を逆にして `getErrorCode(e)` を先に呼ぶと、AppError も「`tournament/...`」code を返すため `isOfflineFirestoreErrorCode` が false で throw されるが、その経路で `permission-denied` 等の AppError も同じ false 経路に乗ってしまう。意味的に「AppError は素通し」を明示するため最優先 guard にする
  - fallback 内の `levelTransitionUpdates("running", ...)` の `"running"` は **literal**。`t.state` は catch ブロックの外なのでアクセス不可。`tournament/state.ts` の `isRunning` 判定が hook 側で済んでいる前提（PRD Decisions Log 通り）
  - `ref` を try ブロック前に作っておく（catch 後の fallback でも同じ ref を使うため。tx 内のは tx scope）
  - manual 分岐（後半）は **変更しない** — 既に `updateDoc` ベースで queue 可能で本 Phase の対象外
- **VALIDATE**:
  - `npm run typecheck` zero error
  - `npm run lint` zero warning（unused import なし）

### Task 4: `tournaments.test.ts` に Phase B 用 4 ケースを追加

- **ACTION**: [`src/lib/firebase/repositories/tournaments.test.ts`](../../../../src/lib/firebase/repositories/tournaments.test.ts) の `describe("advanceLevel (auto with expectedLevel)")` block 末尾に Phase B のテストを追加
- **IMPLEMENT**:

  ```ts
  // src/lib/firebase/repositories/tournaments.test.ts:既存 describe に追記
  describe("advanceLevel (auto with expectedLevel) — Phase B offline fallback", () => {
    /** FirebaseError 風の error を作る（実 SDK と同じく `code` プロパティを持つ） */
    function offlineError(code: string): Error & { code: string } {
      const e = new Error(`firestore: ${code}`) as Error & { code: string };
      e.code = code;
      return e;
    }

    it("falls back to updateDoc when tx fails with offline code (unavailable)", async () => {
      vi.mocked(runTransaction).mockRejectedValueOnce(offlineError("unavailable"));
      vi.mocked(updateDoc).mockResolvedValueOnce(undefined);
      await advanceLevel("t1", "u1", ["g1"], { expectedLevel: 1 });
      const payload = vi.mocked(updateDoc).mock.calls[0][1] as Record<string, unknown>;
      expect(payload.currentLevel).toBe(2);
      expect(payload.lastLevelChangeKind).toBe("auto");
      // running 前提なので pausedAt は null（paused 中の auto-advance は hook 側で発火しない）
      expect(payload.pausedAt).toBeNull();
    });

    it("falls back to updateDoc when tx fails with cancelled / deadline-exceeded", async () => {
      vi.mocked(runTransaction).mockRejectedValueOnce(offlineError("deadline-exceeded"));
      vi.mocked(updateDoc).mockResolvedValueOnce(undefined);
      await advanceLevel("t1", "u1", ["g1"], { expectedLevel: 1 });
      expect(vi.mocked(updateDoc)).toHaveBeenCalledTimes(1);
    });

    it("re-throws AppError without fallback when tx throws permission-denied via loadTournamentInTx", async () => {
      // mockTransaction は既存 helper を再利用。groupId="g1" だが userGroupIds=["g-other"]
      // で `loadTournamentInTx` が AppError("firestore/permission-denied") を throw する経路
      vi.mocked(runTransaction).mockImplementationOnce(async (_db, fn) => {
        const tx = {
          get: vi.fn().mockResolvedValue({
            exists: () => true,
            id: "t1",
            data: () => stripId(makeTournament({ groupId: "g1", currentLevel: 1 })),
          }),
          update: vi.fn(),
          set: vi.fn(),
          delete: vi.fn(),
        };
        await fn(tx as unknown as Parameters<typeof fn>[0]);
        return undefined as unknown;
      });
      await expect(
        advanceLevel("t1", "u1", ["g-other"], { expectedLevel: 1 }),
      ).rejects.toMatchObject({ code: "firestore/permission-denied" });
      // fallback の updateDoc は呼ばれていない
      expect(vi.mocked(updateDoc)).not.toHaveBeenCalled();
    });

    it("re-throws when tx fails with non-offline FirebaseError code (e.g., failed-precondition)", async () => {
      vi.mocked(runTransaction).mockRejectedValueOnce(offlineError("failed-precondition"));
      await expect(
        advanceLevel("t1", "u1", ["g1"], { expectedLevel: 1 }),
      ).rejects.toMatchObject({ code: "firestore/write_failed" });
      // fallback の updateDoc は呼ばれていない（rule 違反を queue に隠さない）
      expect(vi.mocked(updateDoc)).not.toHaveBeenCalled();
    });

    it("wraps as firestore/write_failed when both tx and fallback fail", async () => {
      vi.mocked(runTransaction).mockRejectedValueOnce(offlineError("unavailable"));
      vi.mocked(updateDoc).mockRejectedValueOnce(new Error("indexedDB write failed"));
      await expect(
        advanceLevel("t1", "u1", ["g1"], { expectedLevel: 1 }),
      ).rejects.toMatchObject({ code: "firestore/write_failed" });
    });
  });
  ```

  既存の `mockTransaction` helper / `stripId` / `makeTournament` を再利用する（同 file 上部で既に定義済み）。

- **MIRROR**:
  - 既存 advanceLevel auto テスト構造: [src/lib/firebase/repositories/tournaments.test.ts:451-507](../../../../src/lib/firebase/repositories/tournaments.test.ts)
  - mock 境界（`vi.mocked(runTransaction).mockRejectedValueOnce` / `vi.mocked(updateDoc).mockResolvedValueOnce`）: [src/lib/firebase/repositories/tournaments.test.ts:687-690](../../../../src/lib/firebase/repositories/tournaments.test.ts)
  - characterization test ファースト: [.claude/rules/testing.md](../../../../.claude/rules/testing.md) の「characterization test ファースト」節
- **IMPORTS**: 既存テストファイルの import で十分（追加なし）
- **GOTCHA**:
  - `offlineError(code)` は **`code` プロパティ持ち Error**。`errors.ts:getErrorCode` は `error !== null && typeof error === "object" && "code" in error && typeof code === "string"` で判定するため Error 派生でも問題なく拾える
  - `AppError` の `instanceof` 判定が tx 内 throw でも成立することを確認するため、permission-denied ケースは「tx 内で `loadTournamentInTx` が AppError を throw する」シナリオを使う（既存 451 行付近の "rejects when not group member in tx" と同じ mock 形）
  - **fallback の successful 経路と permission-denied 経路で `updateDoc` の呼出回数が違う** — `expect(updateDoc).toHaveBeenCalledTimes(1)` / `not.toHaveBeenCalled()` を必ず assert
  - `Phase B 用` describe を別に分けることで、既存 5 ケースとの混同を避ける
- **VALIDATE**:
  - `npm test src/lib/firebase/repositories/tournaments.test.ts` 全 case green
  - 既存 advanceLevel テスト 5 件は変更せず継続 pass
  - Phase B 5 件追加で全 10 件が advanceLevel auto で pass

### Task 5: `OfflineBanner` コンポーネントの作成

- **ACTION**: `src/components/tournament/OfflineBanner.tsx` を新規作成し、`fromCache` / `hasPendingWrites` の組合せから 2 種類のバナーを出し分け（両方 false なら null）
- **IMPLEMENT**:

  ```tsx
  // src/components/tournament/OfflineBanner.tsx
  "use client";

  import { CloudOff, Loader2 } from "lucide-react";

  /**
   * 通信状態を運用者に伝える上部バナー。3 状態を 1 つの帯で扱う。
   *
   * - `fromCache=true`               → 「⚠ 通信が一時切れています」（amber）
   *     auto-advance fallback / pending writes が queue に乗っている可能性。本バナー単独で
   *     ConnectionBadge より目立たせ、運営者が「ボタン反応がない」と誤認するのを防ぐ。
   * - `fromCache=false && hasPendingWrites=true`  → 「⏳ 同期中…」（blue）
   *     online 復帰直後で書込キューを flush 中。短時間で消える設計（数秒）。
   * - `fromCache=false && hasPendingWrites=false` → null（占有領域 0）
   *
   * Phase B はこの 2 状態のみ。multi-tab leader race の警告は Phase D。
   */
  interface OfflineBannerProps {
    fromCache: boolean;
    hasPendingWrites: boolean;
  }

  export function OfflineBanner({ fromCache, hasPendingWrites }: OfflineBannerProps) {
    if (fromCache) {
      return (
        <section
          role="note"
          aria-live="polite"
          className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-700 dark:bg-amber-900/20"
          data-testid="offline-banner-disconnected"
        >
          <CloudOff aria-hidden className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            通信が一時切れています — 操作は端末に保存され、復帰時に自動同期されます
          </span>
        </section>
      );
    }
    if (hasPendingWrites) {
      return (
        <section
          role="status"
          aria-live="polite"
          className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-2 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm dark:border-blue-700 dark:bg-blue-900/20"
          data-testid="offline-banner-syncing"
        >
          <Loader2 aria-hidden className="h-4 w-4 shrink-0 animate-spin" />
          <span className="flex-1">
            同期中… 端末からの操作をサーバへ送信しています
          </span>
        </section>
      );
    }
    return null;
  }
  ```

- **MIRROR**:
  - `"use client"` + lucide icon + Tailwind: [src/components/audio/SoundUnlockBanner.tsx:1-44](../../../../src/components/audio/SoundUnlockBanner.tsx)
  - `role="note"` + amber 配色 + aria-hidden: [src/components/pwa/IOsInstallHint.tsx:35-49](../../../../src/components/pwa/IOsInstallHint.tsx)
  - 状態別 2 分岐 / null 返却: [src/components/audio/SoundUnlockBanner.tsx](../../../../src/components/audio/SoundUnlockBanner.tsx) の `if (!enabled) return null;`
- **IMPORTS**:
  - `import { CloudOff, Loader2 } from "lucide-react";`
- **GOTCHA**:
  - **CLAUDE.md 規約**: ユーザー向けメッセージに「Firestore」「Service Worker」等の技術スタック名を露出させない（"通信" / "サーバ" / "端末" の語彙で書く）
  - `aria-live="polite"` で SR が状態変化のみ読み上げる（`assertive` は割り込みになるため使わない）
  - `data-testid` を 2 つに分ける（`-disconnected` / `-syncing`）— vitest の `getByTestId` で別々に判定可
  - **`fromCache && hasPendingWrites` の組合せ** は `fromCache` 分岐が優先される（接続切れの方が運営者にとって重要なため）。両方の hint を縦に積み重ねる UX は scope creep（PRD は「1 つの帯で可視化」を意図）
  - max-w-7xl は dashboard / live の `<main>` と揃える（dashboard:[L272](../../../../src/app/tournaments/[tid]/dashboard-client.tsx#L272), live:[L163](../../../../src/app/tournaments/[tid]/live/live-client.tsx#L163)）
- **VALIDATE**:
  - `npm run typecheck` zero error
  - 後続 Task 6 で `getByRole("note")` / `getByRole("status")` で取れること

### Task 6: `OfflineBanner.test.tsx` の作成

- **ACTION**: `src/components/tournament/OfflineBanner.test.tsx` を新規作成し、4 状態を網羅
- **IMPLEMENT**:

  ```tsx
  // src/components/tournament/OfflineBanner.test.tsx
  import { render, screen } from "@testing-library/react";
  import { describe, expect, it } from "vitest";

  import { OfflineBanner } from "./OfflineBanner";

  describe("OfflineBanner", () => {
    it("renders nothing when online and no pending writes", () => {
      const { container } = render(
        <OfflineBanner fromCache={false} hasPendingWrites={false} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("renders the syncing banner when online but has pending writes", () => {
      render(<OfflineBanner fromCache={false} hasPendingWrites={true} />);
      expect(screen.getByTestId("offline-banner-syncing")).toBeInTheDocument();
      expect(screen.getByText(/同期中/)).toBeInTheDocument();
      expect(screen.queryByTestId("offline-banner-disconnected")).toBeNull();
    });

    it("renders the disconnected banner when fromCache is true (regardless of pending writes)", () => {
      render(<OfflineBanner fromCache={true} hasPendingWrites={false} />);
      expect(screen.getByTestId("offline-banner-disconnected")).toBeInTheDocument();
      expect(screen.getByText(/通信が一時切れています/)).toBeInTheDocument();
    });

    it("prioritizes the disconnected banner when both fromCache and hasPendingWrites are true", () => {
      render(<OfflineBanner fromCache={true} hasPendingWrites={true} />);
      expect(screen.getByTestId("offline-banner-disconnected")).toBeInTheDocument();
      expect(screen.queryByTestId("offline-banner-syncing")).toBeNull();
    });
  });
  ```

- **MIRROR**:
  - vitest + testing-library 形: [src/components/pwa/IOsInstallHint.test.tsx](../../../../src/components/pwa/IOsInstallHint.test.tsx)
  - `getByTestId` / `queryByTestId` の使い分け: [src/components/tournament/_timer-controls/TimerControlsRunningPaused.test.tsx](../../../../src/components/tournament/_timer-controls/TimerControlsRunningPaused.test.tsx)
- **IMPORTS**:
  - `import { render, screen } from "@testing-library/react";`
  - `import { describe, expect, it } from "vitest";`
- **GOTCHA**:
  - `container.firstChild === null` で「何も render されない」を検証（PWA Phase A の同パターン）
  - 「優先順位（fromCache 優先）」のテストは将来 UX 変更時の回帰検出として重要 — disable / skip しない
- **VALIDATE**:
  - `npm test src/components/tournament/OfflineBanner.test.tsx` で 4 ケース全 pass

### Task 7: `dashboard-client.tsx` に `<OfflineBanner />` を mount

- **ACTION**: [`src/app/tournaments/[tid]/dashboard-client.tsx`](../../../../src/app/tournaments/[tid]/dashboard-client.tsx) で `useTournamentTimer` の戻り値から `hasPendingWrites` を受け取り、`<header>` 直下に `<OfflineBanner />` を配置
- **IMPLEMENT**:

  ```tsx
  // src/app/tournaments/[tid]/dashboard-client.tsx の差分

  // import 追加（既存 tournament import block に挿入）
  import { OfflineBanner } from "@/components/tournament/OfflineBanner";

  // useTournamentTimer の destructure に hasPendingWrites を追加
  const {
    tournament: data,
    remainingMs,
    fromCache,
    hasPendingWrites,           // ← 追加
    lastSyncAt,
    error: timerError,
  } = useTournamentTimer(tid, {
    autoAdvance: user ? { uid: user.uid, userGroupIds: groupIds } : undefined,
  });

  // ... 既存処理 ...

  // <header> 直下、<main> の最初の子として OfflineBanner を mount
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-8 lg:max-w-7xl">
      {/*
        Phase B: 通信障害中 / 同期中の状態を 1 つの帯で運営者に伝える。online で
        pending writes も無いときは null を返して占有領域 0。
        ConnectionBadge は引き続き TimerControls 内で「最終同期時刻」を表示する補助 UI。
      */}
      <OfflineBanner fromCache={fromCache} hasPendingWrites={hasPendingWrites} />

      <header className="flex flex-wrap justify-end gap-2 empty:hidden">
        {/* ... 既存 edit / delete ボタン ... */}
      </header>

      {/* ... 以降変更なし ... */}
    </main>
  );
  ```

- **MIRROR**:
  - hook 戻り値の destructure 追加: 既存 `dashboard-client.tsx:78-86`
  - banner mount 位置（`<main>` 直下）: [src/app/layout.tsx](../../../../src/app/layout.tsx) の `<IOsInstallHint />` 配置
- **IMPORTS** に追加:
  - `import { OfflineBanner } from "@/components/tournament/OfflineBanner";`
- **GOTCHA**:
  - `<header>` の上 / 下どちらに置くか — `<header>` は edit / delete ボタンのみで `empty:hidden` 制御済み。banner は **header の上**（=`<main>` の最初の子）に置くことで「画面最上部に常に出る」UX を担保
  - `useTournamentTimer` は既に `hasPendingWrites` を return している（[useTournamentTimer.ts:139](../../../../src/lib/hooks/useTournamentTimer.ts#L139)）— 改修不要、destructure に追加するだけ
  - early return 経路（`timerError` / `!data || !user` / role 判定中）でも `<OfflineBanner />` は出さない設計で良い（早期 return 時はデータ自体取れていない / 権限不足のため運用情報を出す価値が薄い）
- **VALIDATE**:
  - `npm run typecheck` zero error
  - dev server で DevTools Network → Offline ON → ダッシュボードに amber バナーが出る
  - DevTools Network → Online に戻す → 数秒「同期中…」blue バナー → 消える

### Task 8: `live-client.tsx` に `<OfflineBanner />` を mount

- **ACTION**: [`src/app/tournaments/[tid]/live/live-client.tsx`](../../../../src/app/tournaments/[tid]/live/live-client.tsx) で同様に `<OfflineBanner />` を `<header>` 上部に配置
- **IMPLEMENT**:

  ```tsx
  // src/app/tournaments/[tid]/live/live-client.tsx の差分

  // import 追加
  import { OfflineBanner } from "@/components/tournament/OfflineBanner";

  // useTournamentTimer の destructure に hasPendingWrites を追加
  const {
    tournament,
    remainingMs,
    fromCache,
    hasPendingWrites,        // ← 追加
    lastSyncAt,
    error,
  } = useTournamentTimer(tid);

  // ... 既存処理 ...

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 p-4 pt-6">
      {/* Phase B: 接続切れ / 同期中バナー（参加者にも見せる） */}
      <OfflineBanner fromCache={fromCache} hasPendingWrites={hasPendingWrites} />

      <header className="flex items-center justify-between gap-2">
        {/* ... 既存 ... */}
      </header>

      {/* ... 以降変更なし ... */}
    </main>
  );
  ```

- **MIRROR**: dashboard-client と同形（双方 `useTournamentTimer` 戻り値の hasPendingWrites を参照）
- **IMPORTS** に追加:
  - `import { OfflineBanner } from "@/components/tournament/OfflineBanner";`
- **GOTCHA**:
  - `live-client.tsx` の `useTournamentTimer(tid)` は **autoAdvance なし**（参加者画面なので write しない）。pending writes が出るのは「席変更等が起きたとき」が中心だが、本 Phase の auto-advance fallback とは独立。`hasPendingWrites=true` の発生条件は `useTournamentTimer` の現行ロジックに依存する。本 Phase で書込 hook を増やしていないため、参加者画面の `hasPendingWrites` は基本的に false のまま（運営者が同 tab で書いた場合のみ true）
  - 既存の `ConnectionBadge` は header 内に残し、OfflineBanner と二重化する（2 つの軸: 上の帯=現状の総合状況 / 右上の小バッジ=最終同期時刻）
- **VALIDATE**:
  - `npm run typecheck` zero error
  - live 画面でも DevTools Offline → amber バナーが出る

### Task 9: PRD 更新（Phase B status と plan link）

- **ACTION**: [`.claude/PRPs/03-pwa-app-shell/prds/03-pwa-app-shell.prd.md`](../prds/03-pwa-app-shell.prd.md) の Implementation Phases 表で Phase B の status を `pending` → `in-progress` に変更し、PRP Plan 列に本 plan へのリンクを記載
- **IMPLEMENT**:

  | #   | Phase                       | Description                                                                                  | Status        | Parallel | Depends | PRP Plan |
  | --- | --------------------------- | -------------------------------------------------------------------------------------------- | ------------- | -------- | ------- | -------- |
  | A   | PWA Foundation              | manifest + Service Worker + アイコン素材 + meta tags + iOS install テキスト案内               | complete      | with C   | -       | [phase-a-pwa-foundation.plan.md](../plans/completed/phase-a-pwa-foundation.plan.md) |
  | **B** | **Timer Offline Resilience** | **`advanceLevel(auto)` の tx → updateDoc fallback、オフライン状態可視化バナー、multi-tab 警告 UI** | **in-progress** | **-**    | **A**   | **[phase-b-timer-offline-resilience.plan.md](phase-b-timer-offline-resilience.plan.md)** |
  | C   | Device Controls             | Wake Lock API + `screen.orientation.lock` + AudioContext unlock 強化                         | complete      | with A   | -       | [phase-c-device-controls.plan.md](../plans/completed/phase-c-device-controls.plan.md) |
  | D   | Install Promotion & Polish  | role-aware install banner（owner / organizer 限定）+ 観測フェーズ                            | pending       | -        | A, B, C | -        |

- **MIRROR**: Phase A 着手時に行ったのと同じ更新パターン（complete 後は `complete` + 完了 plan へのリンクに更新する）
- **GOTCHA**:
  - `multi-tab 警告 UI` は Phase B description に残るが、本 plan の NOT Building セクションで Phase D 移管を明記 — PRD 表 description 自体は変更しない（Phase D 完了時に統合再評価する）
  - リンクは相対パス（`phase-b-timer-offline-resilience.plan.md`）— PRD は `prds/` 配下、plan は `plans/` 配下のため、相対だと正確には `../plans/phase-b-...` だが、Phase A の `../plans/completed/phase-a-...` と揃える形で統一する
- **VALIDATE**:
  - `git diff .claude/PRPs/03-pwa-app-shell/prds/03-pwa-app-shell.prd.md` で 1 行のみの変更
  - リンクをクリックして本 plan に飛べる

---

## Testing Strategy

### Unit Tests

| Test                                                                                | Input                                                              | Expected Output                                                              | Edge Case? |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ---------- |
| `isOfflineFirestoreErrorCode("unavailable")`                                        | `"unavailable"`                                                    | `true`                                                                       | -          |
| `isOfflineFirestoreErrorCode("permission-denied")`                                  | `"permission-denied"`                                              | `false`                                                                      | rule 違反隠蔽 防止 |
| `isOfflineFirestoreErrorCode("firestore/unavailable")`                              | wrap 形                                                            | `true`                                                                       | 防御テスト |
| `isOfflineFirestoreErrorCode("firestore/permission-denied")`                        | wrap 形                                                            | `false`                                                                      | 防御テスト |
| `advanceLevel(auto) tx success`（Phase A 既存）                                     | tx mock が成功                                                     | `tx.update` が呼ばれ、`updateDoc` は呼ばれない                              | -          |
| `advanceLevel(auto) tx race`（既存）                                                | `currentLevel !== expected`                                        | `tx.update` 呼ばれず                                                          | race 検出 |
| `advanceLevel(auto) tx fails offline (unavailable)` 【Phase B 新規】                | `runTransaction` reject with `unavailable`                         | `updateDoc` 呼出 1 回、`currentLevel: expected+1`、`lastLevelChangeKind: "auto"` | offline core |
| `advanceLevel(auto) tx fails offline (deadline-exceeded)` 【Phase B 新規】         | reject with `deadline-exceeded`                                    | `updateDoc` 呼出 1 回                                                          | offline 別 code |
| `advanceLevel(auto) tx throws AppError(permission-denied)` 【Phase B 新規】         | tx 内 `loadTournamentInTx` が AppError throw                       | `firestore/permission-denied` で reject、`updateDoc` 呼ばれない               | rule 違反 隠蔽 防止 |
| `advanceLevel(auto) tx fails non-offline (failed-precondition)` 【Phase B 新規】    | reject with `failed-precondition`                                  | `firestore/write_failed` で reject、`updateDoc` 呼ばれない                  | non-offline は再 throw |
| `advanceLevel(auto) both tx and fallback fail` 【Phase B 新規】                     | tx reject + updateDoc reject                                       | `firestore/write_failed` で reject                                          | 二重失敗   |
| `<OfflineBanner fromCache=false hasPendingWrites=false />`                          | online no-pending                                                  | `null`（占有 0）                                                              | -          |
| `<OfflineBanner fromCache=false hasPendingWrites=true />`                           | flush 中                                                           | blue 「同期中…」 banner                                                       | -          |
| `<OfflineBanner fromCache=true hasPendingWrites=false />`                           | offline                                                            | amber 「通信が一時切れています」                                              | -          |
| `<OfflineBanner fromCache=true hasPendingWrites=true />`                            | offline + queue 有                                                 | amber が優先（blue は出ない）                                                | UX 仕様明示 |

### Edge Cases Checklist

- [x] tx 失敗時の error が **オフライン由来** vs **rule 違反** で fallback 経路を切替
- [x] tx 内で投げた `AppError` は `instanceof` 判定で fallback に**入らず**再 throw
- [x] fallback の `updateDoc` も失敗するケース（極端だが indexedDB write エラー等）で `firestore/write_failed` に正しく wrap される
- [x] OfflineBanner は両方 false で `null`（占有領域 0）
- [x] OfflineBanner は `fromCache && hasPendingWrites` で disconnected を優先（仕様明示）
- [x] `useTournamentTimer` の hasPendingWrites を destructure する箇所で typo / 抜け漏れがない
- [ ] **手動検証**: DevTools Network → Offline → ダッシュボードのブラインドが進む（実機で確認）
- [ ] **手動検証**: Vercel preview で同上

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
```

EXPECT: Zero type errors

```bash
npm run lint
```

EXPECT: Zero warnings（特に unused import / `console.*` / 手書き型ガード）

### Unit Tests

```bash
npm test src/lib/services/firestore-offline.test.ts
npm test src/components/tournament/OfflineBanner.test.tsx
npm test src/lib/firebase/repositories/tournaments.test.ts
```

EXPECT: 全 case green、Phase B 追加 5 ケースを含む advanceLevel auto 全 10 ケース pass

### Full Test Suite

```bash
npm test
```

EXPECT: No regressions（Phase A の 1145 件 + Phase B 追加 = 約 1155 件 pass）

### Build

```bash
npm run build
```

EXPECT: Next.js build zero error、bundle 異常なし

### Browser Validation（手動）

```bash
npm run dev
# 別タブで以下を確認:
# 1. /tournaments/[tid] を運営者ロールで開く
# 2. running 状態のトーナメントを用意（短い durationSec が望ましい）
# 3. Chrome DevTools → Network → "Offline" を ON
# 4. 残り 0 を待つ → ブラインドが Lv+1 に進む（fallback で updateDoc が queue 投入）
# 5. amber バナー「通信が一時切れています」を確認
# 6. Network → "Offline" を OFF
# 7. 数秒 blue バナー「同期中…」を確認 → 消える
# 8. Firestore コンソールで currentLevel が更新されたことを確認
```

EXPECT: 各ステップで予期通りの UX

### Regression Check（既存機能）

```bash
# 手動 advance（manual）が引き続き動く
# - dashboard で「次レベル」ボタン → 即進む（online）
# - dashboard で pause 中に「次レベル」 → 新 level の先頭で再 pause（pausedAt 再 arm）
# - finishTournament が引き続き online 必須（offline で finish ボタン押下 → エラー表示）
```

EXPECT: 既存挙動が一切変わらない（unit test で網羅済みだが手動でも確認）

### Manual Validation

- [ ] dashboard で OfflineBanner が `<header>` の上、`<main>` の最初の子として描画される
- [ ] live で OfflineBanner が `<header>` の上、`<main>` の最初の子として描画される
- [ ] `npm run dev` で何も操作せず amber バナーが出ない（false positive 検出）
- [ ] `npm run dev` で `tournaments/[tid]/edit` 等の Phase B 対象外画面に OfflineBanner が出ない（scope 確認）

---

## Acceptance Criteria

- [ ] 新規 helper `isOfflineFirestoreErrorCode` が `OFFLINE_FIRESTORE_ERROR_CODES` を真実源として 5 種類の offline code を判定し、`permission-denied` 等の non-offline は false を返す
- [ ] `advanceLevel(auto)` が tx 失敗かつ offline 由来 code のときのみ updateDoc fallback を試み、AppError と非 offline FirebaseError は再 throw する
- [ ] characterization test（Phase B 5 件）が 100% pass、既存 advanceLevel auto 5 件も継続 pass
- [ ] `<OfflineBanner />` が dashboard / live の最上段に配置され、3 状態（offline / syncing / clear）を表示する
- [ ] OfflineBanner unit test 4 件が pass（disconnected 優先 UX を含む）
- [ ] PRD の Phase B status が `in-progress` に更新され、本 plan へのリンクが貼られている
- [ ] `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` 全て green
- [ ] DevTools Offline で実機検証し「ブラインドが進む / amber バナーが出る / online 復帰で blue → 消える」を目視確認

## Completion Checklist

- [ ] Code follows discovered patterns（`wrapFirestoreWrite` / `getErrorCode` / `AppError instanceof` 早期 throw / `role="note"` / `aria-live="polite"`）
- [ ] Error handling matches codebase style（ユーザー向けメッセージに技術スタック名なし、AppError prefix `firestore/` を維持）
- [ ] Logging follows codebase conventions（`logger.warn` で fallback 発生を 1 行記録、成功 `logger.info` は wrap の外）
- [ ] Tests follow test patterns（mock 境界が `runTransaction` / `updateDoc` / characterization first / fixture factory `makeTournament` 再利用）
- [ ] No hardcoded values（OFFLINE_FIRESTORE_ERROR_CODES のリテラルは Task 1 の export を import）
- [ ] Documentation updated — PRD Phase B status 更新のみ。CLAUDE.md / firebase-patterns.md / error-logging.md は変更不要（既存規約に従うのみ）
- [ ] No unnecessary scope additions（multi-tab 警告 / 全画面 banner globally / race reconcile 等は NOT Building に明記）
- [ ] Self-contained — Phase A の plan / report / Phase C の plan / report も同一 PRD で参照可能

## Risks

| Risk                                                                                              | Likelihood | Impact | Mitigation                                                                                                                                          |
| ------------------------------------------------------------------------------------------------- | ---------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OFFLINE_FIRESTORE_ERROR_CODES` に **`permission-denied` を誤って追加**して rule 違反を queue に隠す | L          | H      | Task 2 の characterization test で「`permission-denied` は false」を明示。code review で配列リテラルを必ず確認                                       |
| `levelTransitionUpdates("running", ...)` の `prevState` 固定が `shouldAutoAdvance` の前提崩壊で逆効果 | L          | M      | Task 3 の coment + Task 4 の test name で「auto 経路は state="running" 前提」を明文化。`shouldAutoAdvance` を変更する将来 PR は本テストで気付く     |
| online 復帰時に他端末が先に進めていて `currentLevel` が `expected+1` を超えていた場合に二重 advance   | L          | L      | `currentLevel` は単調増加で値域内、PRD Decisions Log で許容済み。eventual consistency に倒す                                                       |
| OfflineBanner が `tournaments/[tid]/edit` 等の subpage で描画されず一貫性が崩れる                  | L          | L      | Phase B は dashboard / live の 2 画面に絞る方針を NOT Building に明記。subpage は Phase D の polish で再評価                                        |
| FirebaseError 以外の Error 派生（fetch error 等）が `code` プロパティを持たず getErrorCode が `"unknown"` を返し、fallback に入らない | L          | M      | Phase B では offline detection を `code` ベースで割り切る（PRD Decisions Log 通り）。`navigator.onLine` ベースの判定は不要（誤検出が多い）             |
| `hasPendingWrites` が頻繁に true ↔ false を行き来して banner がチカチカする                       | L          | L      | aria-live="polite" + 自然な hasPendingWrites の発火頻度（数 100 ms 単位）で実害は小さい。実機で問題が出たら Phase D で debounce 化                  |
| Phase B の plan が Phase A / C の完了 commit と conflict                                          | L          | L      | Phase A / C は完了済み（develop branch に merge 済み）。develop からブランチを切る運用前提                                                            |

## Notes

- **PRD Decisions Log の方針再確認**:
  - 「auto-advance のオフライン耐性化 = tx 試行 → tx 失敗時 updateDoc fallback」を採用済み
  - 「race は楽観 update で対処、二重 increment は値域内のため壊滅的影響なし」を許容済み
  - 「`finishTournament` のオフライン対応は引き続き online 必須」を許容済み — 本 Phase は手を入れない
- **Phase B Open Question の確定**:
  - PRD Open Questions の `advanceLevel(auto)` race 解決方式 — **「`if (currentLevel === expected) updateDoc(...)` の楽観 update でガード」を採用**。具体的には hook 側で `expectedLevel: tournament.currentLevel` を渡し、tx 内で再 check（成功時）/ fallback では client の expected を信頼（offline 時）の二段構え。本 plan で確定したのでチェックボックスを後で `[x]` に更新する
  - PRD Open Questions の `iOS Safari Wake Lock API の対応状況` は Phase C で完了済み（plan/completed/phase-c-device-controls.plan.md 参照）
- **multi-tab 警告 UI を Phase D に移送**:
  - PRD で Phase B description に "multi-tab 警告 UI" が含まれているが、本 Phase の Core 価値は「ブラインドが上がる」の保証。multi-tab leader race（[firebase-js-sdk#6511](https://github.com/firebase/firebase-js-sdk/issues/6511)）の警告は別 Could で、Phase D の "Install Promotion & Polish" にまわすほうが scope 整合性が高い
  - Phase D 着手時に PRD description を更新するか、Phase B 完了時の report で「Phase D に移管」と記録する
- **Phase A の review M2 / M3 との関係**:
  - Phase A レビュー記録の M2（`RUNTIME_CACHE` の eviction）/ M3（`networkFirst` allowlist）は Phase D の SW ハードニングで対応する。本 Phase B では SW を一切触らない
- **既存 ConnectionBadge は据置**:
  - ConnectionBadge は TimerControls 内で `fromCache` + 最終同期時刻を補助表示する役割を維持。OfflineBanner は **総合状況の帯**としての別軸 UI。両者は重複ではなく相補
  - 将来「ConnectionBadge を削除して OfflineBanner に統合」する選択肢もあるが、Phase D で観測フェーズに入る前に勝手に消すのは避ける（運営者の習慣に影響しうる）
- **Confidence Score: 8/10**:
  - 既存 pattern（`wrapFirestoreWrite` / `try/catch + AppError instanceof` / `role="note"` banner）の再利用率が高く、新規発明要素は `isOfflineFirestoreErrorCode` 判定 1 つのみ
  - 手戻りリスクは「`OFFLINE_FIRESTORE_ERROR_CODES` の網羅性」と「実機 Offline モードでの fallback 実挙動」の 2 点のみで、両者とも test + 手動検証で確実に潰せる
