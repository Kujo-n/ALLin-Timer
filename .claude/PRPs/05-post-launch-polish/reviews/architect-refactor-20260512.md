# Architect Refactor Audit — 20260512

## Scope

PRD 05 (Post-Launch Polish) Phase A.1〜A.3（結果カード背景画像・OG SSR readability layer・footer-box）の
3 段が一本のブランチ `feat/phase-a.2-background-image-ui-and-ssr` にまとまった状態で、`src/` 全体を
Senior Web Architect + Security Specialist の 2 レンズで監査する。

**ベースブランチ**: `feat/phase-a.2-background-image-ui-and-ssr`（`b7ab39e`）
**所属 PRD**: `05-post-launch-polish`（Phase A.1〜A.3 follow-up）
**diff スコープ**: 39 ファイル, +3,756 / -144 行（src/ 抜粋）

## ベースライン検証

| Check | Result |
| --- | --- |
| `npm run typecheck` | ✅ Pass |
| `npm run lint` | ✅ Pass (0 warnings / 0 errors) |
| `npm test` | ✅ Pass (81 files / 1357 tests / 10.90s) |
| `npm run build` | ✅ Pass |
| `npm run test:e2e` | ⏸ Skip（dev server / emulator 干渉防止のため Phase 5 で最終確認） |

## Findings 概要

| Severity | 件数 | 主な内容 |
| --- | --- | --- |
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 2 | finding-1: `card-background` service の winner/season 6 関数 duplication / finding-3: OG winner/season route の bgImage fetch + ScrimLayer + header boilerplate duplication |
| LOW | 4 | finding-2 / finding-4 / finding-5 / finding-9 |
| INFO | 4 | finding-6 / finding-7 / finding-8 / finding-10（既知・記録のみ） |

---

## Findings

### MEDIUM

#### finding-1: `card-background` service の winner/season 6 関数が near-duplicate（DRY 違反）

- Lens: architect
- Severity: medium
- 場所: [src/lib/services/card-background.ts:73-189](../../../../src/lib/services/card-background.ts#L73-L189)
- 観察事実:
  - `uploadAndSetWinnerCardBackground` (73-98) ↔ `uploadAndSetSeasonCardBackground` (101-126) は 24 行 × 2 で
    完全に対称（違いは `setWinnerCardBackground` vs `setSeasonCardBackground` の呼出と
    `logOrphanWarn("winner" | "season", ...)` の `kind` 文字列のみ）
  - `clearWinnerCardBackground` (129-145) ↔ `clearSeasonCardBackground` (148-164) も同型 17 行ペア
  - `updateWinnerCardBackgroundTextTheme` (170-178) ↔ `updateSeasonCardBackgroundTextTheme` (181-189) も
    9 行ペア
  - 6 関数のうち 3 ペア × 約 50 行 = 約 150 行が `kind: "winner" | "season"` 1 文字違い
- 影響:
  - `setWinnerCardBackground` と `setSeasonCardBackground` 双方に同じ修正を加えるとき
    （例: rate limiting / orphan 検出強化 / metrics 追加）、2 箇所同期維持が必要で
    drift リスクがある
  - PRD 05 Phase B 以降で 3 種類目のカード（例えば「過去シーズン詳細カード」）を追加した場合、
    boilerplate を 1 関数 × 3 セット = 9 関数に拡大する負担
- 案:
  - **A.** 内部 `_uploadAndSetCardBackground(kind: "winner" | "season", opts)` /
    `_clearCardBackground(kind, opts)` / `_updateCardBackgroundTextTheme(kind, opts)` の
    3 個 internal helper を作り、6 個の export 関数は thin wrapper として残す（API 互換維持）
  - **B.** kind を**第 1 引数として公開**し、6 関数を 3 関数 + kind 引数に減らす（呼出側書換が必要）
  - 案 A 推奨。CardBackgroundCard.tsx の `if (kind === "winner") { ... } else { ... }` 分岐は
    後段で thin wrapper を吸収する形で簡素化可能だが、コンポーネント側の API（onSave callback）には
    影響しない
- テスト保護:
  - `src/lib/services/card-background.test.ts`（274 行）が 6 関数すべての契約を export 名でテスト
    → thin wrapper として残せば全 pass
- リスク:
  - **観測可能な動作変更なし**（呼出側の `if (kind === "winner") uploadAndSetWinner... else uploadAndSetSeason...` の挙動と同一）
  - 旧 asset retry 削除の挙動が変わらないことを test で確認

---

#### finding-3: OG winner / season route の bgImage fetch + render scaffolding が duplicate

- Lens: architect
- Severity: medium
- 場所:
  - [src/app/api/og/winner/[tid]/route.tsx:67-93](../../../../src/app/api/og/winner/[tid]/route.tsx#L67-L93)
  - [src/app/api/og/season/[gid]/route.tsx:136-156](../../../../src/app/api/og/season/[gid]/route.tsx#L136-L156)
  - 加えて両 route の outer `<div>` + `<img>` + `<ScrimLayer>` の JSX 構造（winner 97-120 / season 158-183）
  - response header 設定の 4 行（winner 302-306 / season 309-313）
- 観察事実:
  - 双方で `bgDataUri = q.bgImageUrl ? await fetchAsDataUri(q.bgImageUrl).catch(...)` + `logger.warn` の
    10 行ブロックが存在
  - `resolveCardTheme(!!bgDataUri, q.bgTextTheme, variant)` + `shadowStyle: { textShadow?: string } = textShadow ? { textShadow } : {}` の
    spread 化対策 5 行も同型
  - JSX 外側の `<div style={{ width:'100%', height:'100%', display:'flex', position:'relative' }}>`
    + `<img>`（条件 render）+ `<ScrimLayer active={!!bgDataUri} />` の wrapper が 23 行ずつ
  - response.headers.set("cache-control") / set("content-disposition") の 4 行
  - try/catch with `AppError.from(e, "og/render-failed", ...)` + `logger.warn` + `NextResponse.json` の
    return ブロック 13 行
- 影響:
  - 「背景画像対応をした OG カード route を 3 つ目を追加する」場合（PRD 05 Phase B 〜 04-spectate
    OG 経路など）、boilerplate を毎回 60〜80 行コピペすることになる
  - Satori の `textShadow: undefined` クラッシュ workaround コメントが 2 箇所に同文で並んでおり、
    将来 satori のバージョンアップで挙動が変わったときに drift する
- 案:
  - **A.** 純粋 helper を追加（JSX には触れない最小案）:
    - `prepareBgDataUri({ url, logContext })` → `Promise<{ bgDataUri: string | null }>`
      （fetchAsDataUri + catch + log を 1 関数に）
    - `applyOgResponseHeaders(response, { cacheControl, filename })` → void
    - `respondWithOgError(e, { logContext })` → NextResponse（500 + warn）
  - **B.** さらに `<OgCardContainer>` JSX wrapper を追加して `<img>` / `<ScrimLayer>` / outer flex を集約
  - 案 A 推奨（JSX 触らず純関数だけ抽出）。Satori 制約と Next ImageResponse のレイアウト互換性を考えると
    JSX wrapper の集約は debug 困難になるリスクが大きい
- テスト保護:
  - `og-image-fetch.test.ts`（136 行）— `fetchAsDataUri` の host allowlist / size cap / content-type 検証
  - `og-payload.test.ts`（240 行）— query schema / URL builder
  - `og-readability.test.tsx`（81 行）— `resolveCardTheme` の theme switching
  - `tests/e2e/card-background.spec.ts` — OG fallback / upload / clear（emulator）
  - 純関数 helper を追加する案 A なら新規 unit test を 5〜6 件追加すれば回帰防御は十分
- リスク:
  - 観測可能な動作変更なし（PNG バイナリが byte-identical で生成される必要）
  - cache-control header 文字列を helper 側に集約するため、定数化の経路を持つ必要あり

---

### LOW

#### finding-2: `groups` repository / service の winner/season ペアも duplicate

- Lens: architect
- Severity: low
- 場所:
  - [src/lib/firebase/repositories/groups.ts:501-547](../../../../src/lib/firebase/repositories/groups.ts#L501-L547) — `updateWinnerCardBackground` ↔ `updateSeasonCardBackground`
  - [src/lib/services/group.ts:528-571](../../../../src/lib/services/group.ts#L528-L571) — `setWinnerCardBackground` ↔ `setSeasonCardBackground`
- 観察事実:
  - repository: 23 行 × 2 で field 名のみ違い（`winnerCardBackground` vs `seasonCardBackground`）
  - service: 22 行 × 2 で repository 呼出関数のみ違い
  - finding-1 と同じ winner/season 対称構造が 3 階層連鎖（service → repository → schema field）
- 案:
  - **A.** repository 側: `updateCardBackground(field: "winnerCardBackground" | "seasonCardBackground", gid, value)` で集約。
    既存 2 関数は thin wrapper として残す
  - **B.** service 側: `setCardBackground({ kind, gid, uid, value })` で集約。
    既存 2 関数は thin wrapper として残す
  - finding-1（service の 6 関数）と一緒に進めると、winner/season 軸の集約が 3 階層揃う
- テスト保護:
  - `groups.test.ts` の `updateWinnerCardBackground` / `updateSeasonCardBackground` テスト
  - `group.test.ts`（既存）の setWinner/Season 経路
  - 既存テストは export 名を見ているため thin wrapper として残せば pass
- リスク: 観測可能な動作変更なし

---

#### finding-4: `tournament.state ===` 直接比較が 2 箇所残存（refactor-conventions 違反）

- Lens: architect
- Severity: low
- 場所:
  - [src/app/tournaments/[tid]/live/live-client.tsx:123](../../../../src/app/tournaments/[tid]/live/live-client.tsx#L123) — `if (tournament.state !== "finished") return;`
  - [src/app/tournaments/[tid]/edit/tournament-edit-client.tsx:52](../../../../src/app/tournaments/[tid]/edit/tournament-edit-client.tsx#L52) — `if (data.state !== "setup") {`
- 観察事実:
  - `.claude/skills/architect-refactor/references/refactor-conventions.md` の "tournament state-machine"
    セクションで「`tournament.state === "running"` 等の直接比較は禁止」とあり、
    `@/lib/services/tournament-state.ts` の純関数経由が標準
  - Phase 4 architect-refactor で集約済みだが、Phase 5+ で追加された 2 箇所に漏れ
- 案:
  - live-client:123 → `!isFinished(tournament)` に置換
  - tournament-edit-client:52 → `!canEdit(data)` または `!isSetup(data)` に置換
- テスト保護: 既存の `tournament-state.test.ts`（80 件）が helper 関数を characterize。
  callsite の挙動は同値（同じ state での bool 値が同じ）
- リスク: 観測可能な動作変更なし

---

#### finding-5: `CardBackgroundCard.tsx` 447 行で refactor-conventions の 300 行閾値超過

- Lens: architect
- Severity: low
- 場所: [src/app/groups/[gid]/_components/CardBackgroundCard.tsx](../../../../src/app/groups/[gid]/_components/CardBackgroundCard.tsx)
- 観察事実:
  - 447 行（refactor-conventions の閾値 300 を超過）
  - useState 7 個、useEffect 2 個 → "5 個以上並ぶ" の閾値も超過
  - 内訳: state（preview blob / url / contentType / textTheme / working / savedFlash / clearConfirmOpen）、
    callbacks（resetSelection / onFileChange / onSave / requestClear / confirmClear）、JSX 約 150 行
- 影響: 単一 component で多面的に責務を持つ。将来「画像クロップ範囲指定」「複数画像のスロット選択」等の
  feature 追加で更に肥大化する余地
- 案:
  - **A.** `useCardBackgroundFilePicker({ kind, gid, user, onError })` hook 抽出（previewBlob / previewUrl /
    previewContentType / onFileChange の lifecycle 管理） — 約 50 行削減
  - **B.** `<ClearConfirmDialog>` を `_components/` 内に切り出し — 約 30 行削減
  - **C.** finding-1（service collapse）のあと、`if (kind === "winner") { ... } else { ... }` の 2 分岐を
    1 行に削減 — 約 30 行削減
  - 上記 A+B+C で 約 110 行削減 → 約 340 行（閾値超過維持だが体感は減）
- テスト保護:
  - `CardBackgroundCard.test.tsx`（358 行）が UI 状態機械の主要パスを mock 境界でカバー
  - hook 抽出をするなら hook 側に renderHook テストを追加
- リスク:
  - 観測可能な動作変更なし
  - **見送り判断もあり得る**: 既存テストが UI 経由で挙動を確認しており、hook 抽出は mock 境界を増やすため
    テスト書換が必要。finding-1/2 が成功した後の 2 段階目に振り、今回は見送る選択肢を強く推奨

---

#### finding-9: `og-payload.ts` の `WINNER_GROUP_NAME_MAX = SEASON_GROUP_NAME_MAX` 冗長 alias

- Lens: architect
- Severity: low（trivial）
- 場所: [src/app/api/og/_lib/og-payload.ts:24-25](../../../../src/app/api/og/_lib/og-payload.ts#L24-L25)
- 観察事実:
  - `const SEASON_GROUP_NAME_MAX = 60;` の直後に `const WINNER_GROUP_NAME_MAX = SEASON_GROUP_NAME_MAX;` で
    alias を作っているが、参照箇所は分かれていない（zod schema 内で 1 回ずつ使用）
  - 値の意味は同じ（`group.name` の最大長）。alias を作る方が drift しやすい
- 案:
  - `GROUP_NAME_MAX = 60` の 1 定数に集約、もしくは `MAX_GROUP_NAME` を `limits.ts` に export
- テスト保護: `og-payload.test.ts` の境界値テストで pass
- リスク: なし

---

### INFO（既知・記録のみ）

#### finding-6: Storage rule の `firestore.exists` + `firestore.get` で write 1 回あたり 2 read 消費

`local-branch-phase-a-review.md` の M-1 で既知。owner-only 操作で頻度が低く、運用上は無視できる。
将来 organizer 拡張時に rule helper 化を検討。

#### finding-7: `retry.ts` の `signal?.aborted` が sleep 中に反応しない

`local-branch-phase-a-review.md` の L-5 で既知。`deleteWithRetry` 専用かつ最大 600ms の遅延で
実用上問題なし。汎用化時に `Promise.race` 対応を検討。

#### finding-8: `og-payload.ts` の `MAX_PARTICIPANTS = 60` が limits.ts と未連動

- 場所: [src/app/api/og/_lib/og-payload.ts:27](../../../../src/app/api/og/_lib/og-payload.ts#L27) — `const MAX_PARTICIPANTS = 60;`
- `limits.ts` の `MAX_TABLES (6) × MAX_SEATS_PER_TABLE (10) = 60` と等しいが、import 経由ではなくハードコード
- 将来 `MAX_TABLES` / `MAX_SEATS_PER_TABLE` を変更すると og-payload の上限が drift する
- 修正は 1 行（`import { MAX_TABLES, MAX_SEATS_PER_TABLE } from "@/lib/limits"; const MAX_PARTICIPANTS = MAX_TABLES * MAX_SEATS_PER_TABLE;`）
- Phase A の duplication ではなく Phase B 由来。今回スコープ外でも対応容易なので finding-4 と一緒に拾うのは合理的

#### finding-10: `validateCardBackground` の zod safeParse は callsite が型 narrow 済みのため defense-in-depth

[groups.ts:472-485](../../../../src/lib/firebase/repositories/groups.ts#L472-L485) の `cardBackgroundSchema.safeParse(value)` は、
callsite (`updateWinnerCardBackground(gid, value: CardBackground)`) が既に TypeScript で narrow 済みのため
通常経路では何も検出しない。動的呼出（テストや将来の callsite 増加）の保険として零コスト。実害なし。

---

## 規約遵守チェック

| 規約 | 状態 |
| --- | --- |
| [error-logging.md](../../../rules/error-logging.md) | ✅ 新規 file はすべて `AppError` + `logger` 経由。`console.*` は `src/lib/logger.ts` のみ |
| [firebase-patterns.md](../../../rules/firebase-patterns.md) | ✅ `groups.ts` repository は `wrapFirestoreWrite` 経由（Phase 4 推奨形）。Storage repository は固有の AppError ラップ（Firestore wrap helper の対象外） |
| [security-base.md](../../../rules/security-base.md) | ✅ サークル固有データは Firestore のみ。`.env*` に secret なし |
| [security-env.md](../../../rules/security-env.md) | ✅ Firebase Storage SDK 追加（[client.ts](../../../../src/lib/firebase/client.ts)）も emulator gate 付き |
| [group-membership.md](../../../rules/group-membership.md) | ✅ `groups/{gid}` への新フィールド `winnerCardBackground` / `seasonCardBackground` は rule の `affectedKeys.hasOnly` ブランチに分離（local-branch-phase-a-review.md で確認済） |
| [testing.md](../../../rules/testing.md) | ✅ 新規 file はすべて unit test ペアあり、E2E spec も追加。helper 境界の mock |
| [refactor-conventions.md](../../../skills/architect-refactor/references/refactor-conventions.md) | ⚠ finding-4（state 直接比較）+ finding-5（行数閾値）で軽微逸脱 |

## 監査で見送った提案

以下は監査範囲で検討したが本サイクルでは見送る:

- **Storage repository の `wrapStorageWrite` 抽出**: `cardBackgroundStorage.ts` の 2 関数だけが対象で、
  Firestore のような 30+ 箇所の重複ではない。YAGNI で見送り
- **`retry.ts` の Promise.race による signal 反応化**: 現状の callsite が `deleteWithRetry` のみで
  `backoffMs` 上限 600ms。汎用化要求が出てから対応
- **`cardBackgroundSchema` の `bothNull XOR bothSet` invariant を refine で表現**: TypeScript narrow 済み
  callsite が主経路で、runtime 検証は repository helper が担う。schema に refine を足すと旧 doc の
  hydrate に互換性問題が出るリスク

## 次フェーズへの引き継ぎ

Phase 3 のリファクタリング計画は以下を採用候補とする（優先度順）:

1. **finding-1**: card-background service の 6 関数を内部 `_impl` に集約（thin wrapper 維持）
2. **finding-2**: groups repository / service の winner/season ペアを同型集約
3. **finding-3**: OG route の bgImage prep / response header / error response を純関数 helper に抽出
4. **finding-4**: tournament-state 直接比較 2 箇所を helper 経由化
5. **finding-9**: `WINNER_GROUP_NAME_MAX` の冗長 alias 削除（+ finding-8 の `MAX_PARTICIPANTS` を limits.ts 連動化）
6. **finding-5**: CardBackgroundCard.tsx の hook 抽出は **次サイクルで再検討**（テスト書換コスト > 直近の利益）
