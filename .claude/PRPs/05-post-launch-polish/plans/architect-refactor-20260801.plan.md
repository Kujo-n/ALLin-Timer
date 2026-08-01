# Architect Refactor Plan — 20260801

## 所属

- PRD: `05-post-launch-polish`（architect-refactor サイクルの継続的な帰属先）
- 監査結果: [.claude/PRPs/05-post-launch-polish/reviews/architect-refactor-20260801.md](../reviews/architect-refactor-20260801.md)
- 前サイクル: [completed/architect-refactor-20260514-2.plan.md](completed/architect-refactor-20260514-2.plan.md)
- 作業ブランチ: `refactor/architect-refactor-20260801`（baseline commit `ed0ed1b`）

## 不変条件

1. 全テスト（typecheck / lint / unit / build / E2E）を **各 commit 時点で green** に保つ
2. **観測可能な動作変更は 0**。唯一の例外は T9（finding-1）で、これは事前承認事項として切り出す
3. プロジェクト規約（`.claude/rules/*`）優先
4. 1 commit = 1 atomic タスク

## タスク一覧

安全側（リスクゼロ）から順に並べ、構造変更を後段に置く。
各タスクは `typecheck` / `lint` / `npm test` / `npm run build` を通してから commit する
（E2E は Phase 5 で全件 1 回。`testing.md` の「中間 commit は unit + typecheck + lint + build で代替」に従う）。

### T1 — OG 背景画像 allowlist をプロジェクトのバケットに限定（finding-2 / security）

| 項目 | 内容 |
| --- | --- |
| 対象 | `src/app/api/og/_lib/og-image-fetch.ts` / 同 `.test.ts` |
| 変更 | `isAllowedBgImageUrl` に bucket 一致検査を追加 |

**実装方針**:

```ts
// firebasestorage.googleapis.com  → /v0/b/<bucket>/o/...
// storage.googleapis.com          → /<bucket>/...
function expectedBucket(): string | null {
  const b = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim();
  return b ? b : null;   // 未設定なら null → host-only 判定にフォールバック
}
```

- `expectedBucket() === null` のときは **現行の host-only 判定をそのまま返す**
  （emulator / CI / 既存 unit test の非回帰を保証）
- 非 null のときのみ pathname の bucket セグメントを照合する
- helper は純関数のまま（`fetchAsDataUri` 側は無変更 — 既に helper を二重防御で呼んでいる）

**追加テスト**（`og-image-fetch.test.ts`）:

- env 設定時: 自バケットの firebasestorage 形式 URL → allow
- env 設定時: 自バケットの storage.googleapis.com 形式 URL → allow
- env 設定時: **他バケット**の両形式 URL → deny
- env 未設定時: 他バケット URL → allow（フォールバック挙動の固定）

**観測可能変更なしの根拠**: アプリが `bgImageUrl` に載せる値は
`groups/{gid}.winnerCardBackground.imageUrl` = 自プロジェクトの Storage download URL のみ。
E2E `card-background.spec.ts` が実際の URL で通ることで担保する。

**commit**: `fix(security): OG 背景画像の allowlist を自プロジェクトのバケットに限定`

---

### T2 — DRIFT WARNING コメントの参照先を実体に合わせる（finding-9）

| 項目 | 内容 |
| --- | --- |
| 対象 | `firestore.rules`:679 / `src/lib/firebase/repositories/tournaments.ts`:957 |
| 変更 | コメントのみ（実装 0 行） |

1. `firestore.rules` の `MAX_TABLES = 6 ↔ engine.ts` → `↔ src/lib/limits.ts`
   （`engine.ts` は re-export のみである旨を併記）
2. `deleteTournament` の「`match /{sub=**}`」説明を、現行の explicit rule
   （`players` / `tables` それぞれが親 doc `exists` + `isOrganizer` を要求し、
   `exists()` は request 開始時点の DB を見るため同 batch 内で親を最後に delete しても通る）
   の説明に書き換える

**commit**: `docs(rules): DRIFT WARNING の参照先を limits.ts / explicit subcollection rule に修正`

---

### T3 — 表示名バリデータの重複を解消（finding-3）

| 項目 | 内容 |
| --- | --- |
| 対象 | `src/lib/services/auth-actions.ts` |
| 変更 | `validateDisplayName` を `parseDisplayName` への委譲に置換 |

```ts
// after
import { parseDisplayName } from "@/lib/services/entry-guards";

function validateDisplayName(name: string): string {
  return parseDisplayName(name, { maxLength: DISPLAY_NAME_MAX_LENGTH });
}
```

- 循環 import の確認: `entry-guards.ts` は `errors` / `schemas/tournament` /
  `tournament-state` のみ import しており `auth-actions` を参照しない → 循環なし
- `validateDisplayName` は private のまま残す（3 callsite の可読性維持）

**観測可能変更なしの根拠**: 監査で code / message / 分岐順序の完全一致を確認済み。
`auth-actions.test.ts` が両 error code を assert している。

**commit**: `refactor(auth): 表示名バリデータを entry-guards の parseDisplayName に統一`

---

### T4 — `generateJoinCode` のダミー参照を除去（finding-10）

| 項目 | 内容 |
| --- | --- |
| 対象 | `src/lib/services/group.ts`:271-273 とその import |
| 変更 | `void defaultExpiresAt;` とコメントを削除、import から `defaultExpiresAt` を外す |

「default 7 日」の意図は `expiresInDays = 7` の default 引数と JSDoc に既に書かれているため、
コメントは 1 行に整理して残す。

**commit**: `refactor(group): generateJoinCode の未使用 import とダミー void 参照を削除`

---

### T5 — group 設定バリデーションの共有純関数を抽出（finding-4）

| 項目 | 内容 |
| --- | --- |
| 対象 | 新規 `src/lib/validation/group-settings.ts` / 新規 同 `.test.ts` / `services/group.ts` / `repositories/groups.ts` |
| 変更 | 4 組の重複検証を pure validator へ集約し、両層から呼ぶ |

**API 設計**（正規化と検証を分離し、現行の非対称を保つ）:

```ts
/** trim + 値域検証を行い、正規化済みの値を返す。service 層が使う。 */
export function parseDefaultTableSettings(
  labels: unknown, colors: unknown,
): { labels: string[]; colors: (string | null)[] };

/** 既に正規化済みの値を再検証する（repository 層の二重防御）。 */
export function assertDefaultTableSettings(
  labels: unknown, colors: unknown,
): void;
```

同様に `parseSeasonPointsRule` / `assertSeasonPointsRule` /
`assertFinishedCount` / `assertDefaultSeats` を用意する。

- **AppError の code / message は現行文字列をそのまま移設**する（1 文字も変えない）
- service 側は `parse*`（正規化あり）、repository 側は `assert*`（検証のみ）を呼ぶ
  → 検証が 2 回走る現行の二重防御構造は**そのまま維持**される
- `setFinishedTournamentCount` / `setDefaultSeatsPerTable` は正規化不要なので `assert*` のみ

**追加テスト**: 抽出した純関数への直接 unit（境界値 / 各 error code）。

**観測可能変更なしの根拠**: 検証条件・順序・code・message を逐語移設。
`group.test.ts` / repositories 側 unit が既存の error code を assert 済み。

**commit**: `refactor(group): 設定値バリデーションを共有 pure validator に集約し service/repository の重複を解消`

---

### T6 — orchestrator の tx 内 race guard を集約（finding-5）

| 項目 | 内容 |
| --- | --- |
| 対象 | `src/lib/firebase/tx-helpers.ts` / `src/lib/services/seating/orchestrator.ts` |
| 変更 | 3 箇所の 4 段ガードを helper 化 |

```ts
export type PlayerMoveGuardResult =
  | { ok: true; player: PlayerDoc }
  | { ok: false; reason: "missing" | "busted" | "moved" | "race" };

export async function verifyPlayerUnchangedInTx(
  tx: Transaction,
  ref: DocumentReference<Omit<PlayerDoc, "id">>,
  from: { tableNum: number; seatNum: number },
  expectedLastMovedAtMs: number | null,
): Promise<PlayerMoveGuardResult>;
```

**skipReason の書式は現行を完全維持する**:

| 呼出元 | 現行書式 | 移行後 |
| --- | --- | --- |
| `applySingleMove` | `"missing"` / `"busted"` / `"moved"` / `"race"` | `result.reason` をそのまま |
| `applyCascadeMoves` | `"missing:{pid}"` 等 | `` `${result.reason}:${move.playerId}` `` |
| `applyTableBreak` | `"missing:{pid}"` 等 | 同上 |

- `applySingleMove` は `from` 一致検査に `p.tableNum !== move.from.tableNum || p.seatNum !== move.from.seatNum`
  を使っており 3 箇所とも同一 → そのまま helper に載る
- `autoSeatLateEntry` の guard は形が違う（`tableNum !== null` = already-seated 判定）ため
  **対象外**（無理に統一しない）

**テスト保護**: `orchestrator.test.ts` が skipReason を assert。書式維持で等価性が担保される。

**commit**: `refactor(seating): orchestrator の tx 内 race guard を verifyPlayerUnchangedInTx に集約`

---

### T7 — Firestore collection ref factory を集約（finding-6）

| 項目 | 内容 |
| --- | --- |
| 対象 | 新規 `src/lib/firebase/refs.ts` / `orchestrator.ts` / `tx-helpers.ts` / `repositories/players.ts` / `repositories/tournaments.ts` / `repositories/tables.ts` |
| 変更 | converter 付き ref factory を 1 箇所に集約 |

```ts
// src/lib/firebase/refs.ts
export function tournamentsCollectionRef(): CollectionReference<...>;
export function tournamentDocRef(tid: string): DocumentReference<...>;
export function playersCollectionRef(tid: string): CollectionReference<...>;
export function tablesCollectionRef(tid: string): CollectionReference<...>;
```

**注意**: `repositories/tournaments.ts` の `tournamentsRef` は **module-level const**
（`collection(...)` を import 時に 1 度だけ評価）なのに対し、`orchestrator` / `tx-helpers` は
**関数内で毎回生成**している。集約時は「関数呼出で毎回生成」に揃える
（Firestore の `collection()` は軽量で、test の mock 境界も関数のほうが素直）。
既存 unit test が `collection` の呼出回数を assert していないことを実装前に確認する。

**中断判断**: mock 境界が大きく壊れる（複数 test file の書換が必要になる）と判明した場合は、
本タスクを **skip して計画から外す**（利得が低く、テスト書換のリスクが上回るため）。

**commit**: `refactor(firebase): collection ref factory を refs.ts に集約`

---

### T8 — `SeatingBoard.tsx` を `_seating-board/` に分割（finding-7）

| 項目 | 内容 |
| --- | --- |
| 対象 | `src/components/tournament/SeatingBoard.tsx` → ＋ `_seating-board/{SeatRow,PlainSeat,DnDSeat,PdCheckbox}.tsx` |
| 変更 | 純粋なファイル移動 + import。DOM / aria / class は 1 文字も変えない |

`_timer-controls/` / `_table-label-edit/` と同じ配置規約に従う。
`SeatingBoard.tsx` は orchestrator（Props / DndContext / 卓ループ）として残す。
目標: 626 行 → 250 行前後 + 4 ファイル。

**テスト保護**: `SeatingBoard.test.tsx`（239 行）＋ E2E 4 spec
（`playing-dealer` / `manual-table-close` / `table-add-reopen` / `table-label-and-color`）。

**commit**: `refactor(seating): SeatingBoard の内部 component を _seating-board/ に分割`

---

### T9 — `join-client.tsx` の submit boilerplate 集約と結果画面抽出（finding-8）

| 項目 | 内容 |
| --- | --- |
| 対象 | `src/app/join/[tid]/join-client.tsx` → ＋ `_components/JoinResultCard.tsx` |

**9-a: 結果画面の抽出**（先に実施 — リスクが低く効果が大きい）

`status !== null` のときに返す 87 行の `<main>` を `JoinResultCard` に切り出す。
props: `status` / `tournament` / `groups` / `isAnon` / `submitting` / `error` /
`onCancelEntry` / `onBackToForm` / `tid`。JSX は逐語移設。

**9-b: submit helper**

```ts
async function runReceiptAction(fn: () => Promise<void>): Promise<void> {
  setError(null);
  setSubmitting(true);
  try { await fn(); }
  catch (e) { wrapError(e); }
  finally { setSubmitting(false); }
}
```

適用: `onLoginSubmit` / `onGuestSubmit`（validation 後の部分）/
`onContinueAsSignedIn` / `onCancelOwnEntry` の 4 箇所。

**inline 維持**: `onRegisterSubmit`（`setAccountCreated` + 3 分岐 catch）/
`onGoogleJoin`（`AccountLinkRequired` の early return）。
前サイクルと同じ判断基準（`setError` 挙動が変わる callsite は触らない）。

**テスト保護**: E2E `auto-group-join.spec.ts` / `anonymous-flow-completion.spec.ts` /
`member-removal.spec.ts`。

**commit**: 9-a / 9-b で 2 commit に分ける
（`refactor(join): 受付結果画面を JoinResultCard に抽出` /
`refactor(join): 受付 submit の共通 boilerplate を runReceiptAction に集約`）

---

### T10 — `/debug/fs` の撤去（finding-1）★ ユーザー承認が必要

| 項目 | 内容 |
| --- | --- |
| 対象 | `src/app/debug/`（2 ファイル）/ README.md 6 箇所 |
| 変更 | ルートごと削除。`NEXT_PUBLIC_ENABLE_DEBUG` の記述も整理 |

**なぜ承認が必要か**: `NEXT_PUBLIC_ENABLE_DEBUG=1` の環境で `/debug/fs` が
**200 → 404 になる = 観測可能な動作変更**であり、不変条件 2 の例外にあたる。

**判断材料**:

- 当該ページの機能は **現時点で 100% 失敗する**（rule が write / list とも deny）ため機能的損失は 0
- 本番（Vercel Production）は env 未設定で既に 404
- Firestore 疎通確認という目的は E2E 35 spec + emulator が恒常的に担保している
- 残すコストは「公開リポジトリに規約違反の実装例が居座り続けること」

**代替案**: 撤去せず現行 repositories 経由に書き直す（規約違反は解消するが YAGNI）。

**commit**: `chore: Phase 1 の疎通確認ルート /debug/fs を撤去`

---

---

### T11 — card-background E2E の fixture 修正（Phase 5 で追加）★ 計画時点で想定していなかった

| 項目 | 内容 |
| --- | --- |
| 対象 | `tests/e2e/card-background.spec.ts` / `tests/e2e/fixtures/emulator.ts` |
| 契機 | Phase 5 の E2E 全件走行で `card-background.spec.ts:60` が 400 で失敗（T1 由来の回帰） |

T1 のバケット一致検査により、当該 test の fixture URL
（`v0/b/nonexistent/o/missing.jpg`）が fetch に到達する前に zod schema で弾かれるようになった。

**test の検証対象（fetch 失敗 → グラデ fallback → 200）は今も正しく、
壊れたのは fixture が旧 allowlist の広さに依存していた点**のため、
fixture を「設定済みバケット + 存在しないオブジェクト」に変更して意図を保つ。

併せて **他バケットが 400 で拒否されることを assert する E2E を新規追加**し、
回帰を positive coverage に転換する。

**commit**: `test(e2e): OG 背景画像 allowlist の絞り込みに合わせて card-background の fixture を修正`

---

## 実行順序

```
T1 (security) → T2 (docs) → T3 → T4 → T5 → T6 → T7 → T8 → T9a → T9b → [T10 承認後]
  → (Phase 5 の E2E で回帰検出) → T11
```

安全側 → 構造変更の順。T7 は mock 境界の実測次第で skip 可。

## 検証順序

- **各タスク**: `npm run typecheck` → `npm run lint` → `npm test` → `npm run build`
  （dev server が停止していることを確認してから build）
- **Phase 5（最終）**:
  1. `npm run typecheck` / `npm run lint` / `npm test`
  2. `npm run build`（dev server 停止確認後）
  3. `npm run test:e2e`（playwright に fresh dev server + emulator を起動させる）
  4. rule 変更は無いが、T1 が Storage URL に触れるため
     `npm run test:rules-limits`（emulator 不要）を追加実行

## 見送る提案（理由付き）

| 提案 | 見送り理由 |
| --- | --- |
| `services/group.ts` 887 行の分割 | import 波及が 10+ ファイル。1 commit の atomic 性を保てない |
| `getGroup` + `assertOrganizer` の集約（proxy-receipt 方式） | 8 callsite すべてで後続処理が異なり抽象化の利得が薄い |
| 表示名「解決」順序の統一（finding-12） | **観測可能な動作変更**。仕様判断が必要なため別タスクとして提起 |
| `groups` repository の empty-message 統一 | `"表示名が空です"` → `"表示名を入力してください"` は観測可能変更 |
| knip の未使用 export 4 件 | すべて自モジュール内で使用中（誤検出）。`group.test.ts` の mock も壊れる |
| `CardBackgroundCard.tsx` 447 行の hook 抽出 | 20260512 からの継続 deferred。既存 test の mock 境界書換が前提条件 |

## 想定される成果

| 指標 | Before | After（見込み） |
| --- | --- | --- |
| 重複コード | 検証ロジック ~120 行 × 2 層 / race guard 4 段 × 3 / ref factory × 3 / 表示名 validator × 2 | 各 1 箇所 |
| `SeatingBoard.tsx` | 626 行 | ~250 行 + 4 ファイル |
| `join-client.tsx` | 516 行 | ~360 行 + 1 ファイル |
| dead code | `/debug/fs` 2 ファイル（T10 承認時） | 0 |
| security allowlist | GCS 全体 | 自プロジェクトのバケットのみ |
