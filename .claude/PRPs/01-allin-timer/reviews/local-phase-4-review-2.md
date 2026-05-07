# Local Code Review #2 — Phase 4 Seating Automation (post-fix)

**Reviewed**: 2026-04-20
**Mode**: Local (uncommitted changes)
**Decision**: ✅ **APPROVE with comments** — CRITICAL/HIGH なし、validation 全通過、新規 MEDIUM 1 + LOW 3
**Previous review**: [.claude/PRPs/reviews/local-phase-4-review.md](local-phase-4-review.md) (4 HIGH + 5 MEDIUM)

## Summary

前回レビューの **HIGH 4 件 / MEDIUM 5 件すべて genuinely fix 済み**（superficial patch ではない）。validation 全通過、テスト数 220 → 244（+24: TG1/TG2/TG3 + H2 race）、coverage 81% → 91.42%。新規発見は MEDIUM 1（UI 上の bust ボタン誤表示、rules で最終防衛済み）と LOW 3（drift / fingerprint / asymmetry）。マージ可。

## Prior Findings — Verification

| ID | Status | 検証 |
|---|---|---|
| **H1** `applyTableBreak` 2 ステップ書き込み | ✅ FIXED | `tx.update(tablesRef, { isBroken: true })` が同一 tx 内 ([orchestrator.ts:463](src/lib/services/seating/orchestrator.ts#L463))。TG2 テストが 2 update を 1 batch で確認 |
| **H2** late entry seat 占有 race | ✅ FIXED | `autoSeatLateEntry` / `applySingleMove` 双方で `targetTableExistingIds` を tx 内再 read、`seat-taken` skip。専用テストあり |
| **H3** hook 依存配列の参照不安定 | ✅ FIXED | `groupIdsKey` / `playersKey` / `tablesKey` の `useMemo` fingerprint 化。fingerprint stability test が「同内容別参照」で再 fire しないことを assert |
| **H4** engine の生 `Error` throw | ✅ FIXED | `TooManyTablesError` / `InvalidSeatsPerTableError` クラス + `instanceof` 判定。pure function 契約を保ったまま domain code 化 |
| **M1** rules の型・範囲ガード欠如 | ✅ FIXED | `is int`、1〜6 / 1〜10、null/int 整合性。OR-branch parens 正しい。bust（両 null）/ assign / move 全パス通過確認済み |
| **M2** schema 制約不一致 | ✅ FIXED | body / create / update 全て `min(2).max(10)` |
| **M3** PlayerList derived state | ✅ FIXED | `subscribeError ?? localError` を render 時計算 |
| **M4** tx 外 `let` mutation | ✅ FIXED | `runTransaction<number[]>` の戻り値で受ける |
| **M5** unmount 後 setState | ✅ FIXED | BustButton / BalancingInstructionCard 両方に `mounted` ref + cleanup |

## New Findings

### CRITICAL / HIGH

**None.**

### MEDIUM

**N1 — `canManage` 判定がトーナメント所属グループと突合しない**

**File**: [src/app/tournaments/[tid]/dashboard-client.tsx:34](src/app/tournaments/[tid]/dashboard-client.tsx#L34)

```ts
const canManage = !!user && groupIds.length > 0;
```

「ユーザーが何らかのグループに属している」だけを確認し、対象トーナメントの `groupId` が含まれているかは別途 `isMember = groupIds.includes(data.groupId)` で判定している。`canManage` は QrPanel など他用途と兼用されているため不一致が残る。

`PlayerList` には `canManage={isMember}` が渡されているので最終的な BustButton 表示は `isMember && state===running||paused` で適切に制限される。**実害は MEDIUM 以下（rules で最終防衛済み）** だが、意味論が曖昧で将来読みにくい。

**Fix（任意・小修正）**: `dashboard-client.tsx` で `const canManage = !!user && data && groupIds.includes(data.groupId)` に変更。または `canManage` 変数を廃止し `isMember` のみで統一。

> 注: 上記は security-reviewer が指摘した点だが、コードを再読すると `PlayerList` には `canManage={isMember}` が渡されており（[dashboard-client.tsx:218](src/app/tournaments/[tid]/dashboard-client.tsx#L218)）、UI 上の bust ボタン誤表示は実際には起きない。ただし変数名と意味の不整合は残るため maintainability の観点で MEDIUM。

### LOW

**L1 — `useSeatingAutoOrchestrator` の `tournament` が raw object 参照のまま依存配列に**

**File**: [src/lib/hooks/useSeatingAutoOrchestrator.ts:92](src/lib/hooks/useSeatingAutoOrchestrator.ts#L92)

H3 fix で `players` / `tables` / `userGroupIds` は fingerprint 化したが、`tournament` は raw 参照のまま。Firestore subscribe は毎 snapshot で新しい object を返すため、seating に無関係なフィールド（updatedAt 等）の変化でも effect が再 fire する。inflight Set で防御されているため correctness 影響なし、performance 影響も小（write 起こさず即 return）。

**Fix（任意）**: `tournamentKey = useMemo(() => tournament ? `${tournament.state}:${tournament.currentLevel}:${tournament.lateEntryDeadlineLevel}:${tournament.seatsPerTable}:${tournament.groupId}` : null)` を作って依存に含める。

**L2 — `applyTableBreak` が surviving 卓の seat-taken 再検証を行わない（asymmetry）**

**File**: [src/lib/services/seating/orchestrator.ts:425-451](src/lib/services/seating/orchestrator.ts#L425-L451)

`applySingleMove` と `autoSeatLateEntry` は H2 fix で移動先卓の既存プレイヤーを tx 内再 read して seat-taken をチェックするが、`applyTableBreak` は閉鎖卓のプレイヤーのみ再 read し、survivors の seat 占有を tx 内では確認しない。

table break 中に他 tx が survivors の空席を取った場合に重複席が発生しうるが、(a) 本アプリは月 1〜2 回開催の 20 人スケール、(b) 「指示完了」を押す運営者は 1 人ずつ操作する想定、(c) 次の subscribe 発火で運営者が SeatingBoard から視認・是正可能 — のため許容範囲。

**Fix（必要なら）**: 各 move の `move.to.tableNum` の既存プレイヤーを tx 内再 read してチェックする (`applySingleMove` と同パターン)。テスト工数増あり。

**L3 — rules 内 MAX_TABLES (6) / MAX_SEATS (10) のハードコードと engine.ts の drift 可能性**

**File**: [firestore.rules:152,158](firestore.rules#L152) vs [engine.ts:7](src/lib/services/seating/engine.ts#L7) (`MAX_TABLES = 6`) and [tournament.ts:40](src/lib/firebase/schemas/tournament.ts#L40) (`max(10)`)

3 箇所に同じ定数がコピペされており、片方を変えると不整合になる。Phase 5 で MAX_TABLES = 7+ サポートを検討する場合は同期更新が必要。Cloud Functions 化 or Custom Claims で集約するのが将来案。

## Test Robustness

### 新規追加テスト 24 件の評価

**TG1（applySingleMove 4 件）**: happy path / race=moved / seat-taken (H2) / permission-denied — 全 skip reason カバー、H2 fix の有効性も検証
**TG2（applyTableBreak 3 件）**: H1 atomic commit / race / permission — `captured.length === 2` で player update + isBroken update が同一 tx 内であることを assert
**TG3（useSeatingAutoOrchestrator 16 件）**: 7 種の early return + 8 種の auto-seat 動作 + 1 種の error handling — fingerprint 安定性テストが「同内容別参照」で再 fire しないことを assert（H3 fix の意義を保証）
**H2 補助（autoSeatLateEntry 1 件）**: seat-taken 検出

カバレッジ: orchestrator.ts 47.72% → 84.98% / hook 0% → 100% / overall 81% → 91.42%。

## Validation Results

| Check | Result | Notes |
|---|---|---|
| Type Check | ✅ Pass | `tsc --noEmit` zero error |
| Lint | ✅ Pass | ESLint zero warning |
| Unit Tests | ✅ Pass | **244 / 244** pass |
| Build | ✅ Pass | `next build` 完走 |
| Coverage | ✅ Pass | 91.42% (target 80%+) |

## Files Reviewed

**Modified since Review #1（fix 反映）**:
- `src/lib/services/seating/engine.ts` — H4 fix
- `src/lib/services/seating/orchestrator.ts` — H1+H2+M4+L1 fix
- `src/lib/services/seating/orchestrator.test.ts` — TG1+TG2+H2 race tests added
- `src/lib/hooks/useSeatingAutoOrchestrator.ts` — H3 fix
- `src/components/tournament/PlayerList.tsx` — M3 fix
- `src/components/tournament/BustButton.tsx` — M5 fix
- `src/components/tournament/BalancingInstructionCard.tsx` — M5 fix
- `src/lib/firebase/schemas/tournament.ts` — M2 fix
- `firestore.rules` — M1 fix

**New additions**:
- `src/lib/hooks/useSeatingAutoOrchestrator.test.ts` (16 tests, +100% coverage)
- `package.json` / `package-lock.json` — `@testing-library/react@^16.3.2` devDependency

## Recommended Action

1. **Approvable as-is** — 全 HIGH/CRITICAL fix 済み、validation green
2. **N1 (canManage) は次の cleanup PR で修正推奨** — 命名整合性、defense-in-depth として 1 行
3. **L1〜L3 は Phase 5 へ持ち越し可** — 機能上の影響なし
4. 本番 deploy 前に `firestore.rules` の手動 Playground 確認（前 review report 参照）

## Decision: APPROVE

CRITICAL=0, HIGH=0, MEDIUM=1 (UX/maintainability 系で functional impact なし), LOW=3 (将来の改善候補)、validation 全通過。コミット → PR 作成へ進んで OK。
