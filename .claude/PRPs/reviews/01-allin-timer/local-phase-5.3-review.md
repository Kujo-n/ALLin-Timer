# Local Review: Phase 5.3 — Append Blind Level

**Reviewed**: 2026-05-06
**Branch**: develop（uncommitted + untracked）
**Decision**: APPROVE with comments（軽微な MEDIUM/LOW 指摘あり）

## Summary

進行中トーナメントの末尾レベル append 機能。Phase 5.2 の `setLevelDurationSec` の array-rewrite + `runTransaction` パターンを忠実に踏襲し、純関数 / repository / Dialog / Card / E2E の 5 層に試験を厚く積んでいる。CRITICAL / HIGH 指摘なし。security / state machine / rules モデル整合は問題なし。MEDIUM 1 件（accessibility: aria-label の表示文言乖離）と LOW 数件（NaN ガード、テスト記述）に留まる。

## Files Reviewed

| File                                                                  | Action  |
| --------------------------------------------------------------------- | ------- |
| `src/lib/limits.ts`                                                   | Modified |
| `src/lib/services/tournament-state.ts`                                | Modified |
| `src/lib/services/tournament-state.test.ts`                           | Modified |
| `src/lib/firebase/repositories/tournaments.ts`                        | Modified |
| `src/lib/firebase/repositories/tournaments.test.ts`                   | Modified |
| `src/components/tournament/AppendLevelDialog.tsx`                     | Added    |
| `src/components/tournament/AppendLevelDialog.test.tsx`                | Added    |
| `src/components/tournament/StructureSnapshotCard.tsx`                 | Modified |
| `src/components/tournament/StructureSnapshotCard.test.tsx`            | Modified |
| `src/app/tournaments/[tid]/dashboard-client.tsx`                      | Modified |
| `tests/e2e/append-blind-level.spec.ts`                                | Added    |
| `.claude/PRPs/prds/allin-timer.prd.md`                                | Modified |
| `.claude/PRPs/plans/completed/phase-5.3-append-blind-level.plan.md`   | Added    |
| `.claude/PRPs/reports/phase-5.3-append-blind-level-report.md`         | Added    |

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

#### M1. `aria-label="append-is-break"` が画面読み上げを汚染する（a11y）

[src/components/tournament/AppendLevelDialog.tsx:131-139](../../../src/components/tournament/AppendLevelDialog.tsx#L131-L139)

```tsx
<label className="flex items-center gap-2 text-sm">
  <input
    type="checkbox"
    checked={isBreak}
    onChange={(e) => toggleBreak(e.target.checked)}
    aria-label="append-is-break"
  />
  <span>ブレイクとして追加</span>
</label>
```

`<input>` は `<label>` で wrap されているので暗黙ラベル「ブレイクとして追加」が付与されるが、`aria-label="append-is-break"` がそれを上書きしてしまい、スクリーンリーダー利用者は内部識別子をそのまま読み上げる形になる。`EditableLevelDurationCell` では `aria-label={`Lv ${n} の時間を変更`}` のように人間可読な日本語を採用しており、本コンポーネントだけ実装内識別子になっているのが浮く。

E2E（`tests/e2e/append-blind-level.spec.ts:174`）と unit test（`AppendLevelDialog.test.tsx:102`）が `getByLabel(/Text)("append-is-break")` を使っている都合があるが、対応は容易:

**Fix**: `aria-label="append-is-break"` を削除し、テストを `getByLabel(/Text)("ブレイクとして追加")`（または `getByRole("checkbox", { name: "ブレイクとして追加" })`）に書き換える。Testing Library は wrap label からも取得できるので 3 箇所の修正で済む。

---

#### M2. `Number(e.target.value)` が NaN を吐く可能性（minor robustness）

[src/components/tournament/AppendLevelDialog.tsx:150,162,174,185](../../../src/components/tournament/AppendLevelDialog.tsx#L150-L185)

```tsx
onChange={(e) => setSb(Number(e.target.value))}
```

`Number("")` は 0 だが、user が「-」だけ入れたり `e` 等を打つと `NaN` が state に入り表示が `NaN` になる（type=number の input でも `e` / `E` / `+` / `-` は受理）。Submit 時には `Number.isInteger(NaN) === false` で `validation/level-input-invalid` に弾かれるため不正値は流れないが、UX として「Invalid input」エラーが Dialog 内に出る。

同 repo の [src/components/structure/LevelTable.tsx:21-24](../../../src/components/structure/LevelTable.tsx#L21-L24) には `parseIntSafe` があり、NaN を 0 に倒す前例がある。これに揃えると無難。

**Fix**: `parseIntSafe` を `@/lib/utils` 等に切り出すか、Dialog 内に局所定義して 4 箇所の `Number(...)` を置換。

---

#### M3. dashboard-client が `onAppendLevel` を `canAppend=false` でも常に渡している（小さな冗長）

[src/app/tournaments/[tid]/dashboard-client.tsx:552-555](../../../src/app/tournaments/[tid]/dashboard-client.tsx#L552-L555)

```tsx
canAppend={isOrganizer && canAppendLevel(data)}
onAppendLevel={async (input) => {
  await appendLevel(tid, user.uid, groupIds, input);
}}
```

`StructureSnapshotCard` 側は `canAppend === true && onAppendLevel !== undefined` の AND で gate しているため挙動上は問題なし。ただし「`canAppend=false` のときは callback を渡さない」という Phase 5.2 の `onUpdateDurationSec` の使い方とは差異があり、レビュー時に意図が読みづらい。

**Fix**（任意・LOW 寄り）: 三項演算で `onAppendLevel={isOrganizer ? async (...)=>{...} : undefined}` のようにし、`canEdit` 経路と表現を揃える。実害はないので保留してもよい。

### LOW

#### L1. `AppendLevelDialog.tsx` の冒頭 JSDoc に「分」と「durationSec」の換算が一箇所に書かれていない

`AppendLevelDialog.tsx:32-42` の JSDoc は default 値の派生ロジックを記述しているが、UI が「分」を持ち repository に渡すときに `durationMin * 60` で `durationSec` に変換していること（[AppendLevelDialog.tsx:107](../../../src/components/tournament/AppendLevelDialog.tsx#L107)）はコメント外。`setLevelDurationSec` 系列の test fixture でも一貫して秒で扱う規約のため、Dialog で分↔秒の単位が変わる点は明示しておくとレビュー時に親切。

**Fix**（任意）: JSDoc に「内部 state は分（durationMin）、submit 時に秒換算」の 1 行追記。

---

#### L2. `appendLevel` のエラーメッセージが日本語固定（i18n は将来課題、現状は問題なし）

[src/lib/firebase/repositories/tournaments.ts:506-510](../../../src/lib/firebase/repositories/tournaments.ts#L506-L510)

`「新規レベルの入力値が不正です（SB/BB/Ante は 0 以上の整数、分は 1 以上、プレイレベルは BB > 0）」` のように UI が「分」と「秒」を混ぜて説明している。repository 側は `durationSec` 単位で受け取るので、文言は「秒は 1 以上」が正確。

**Fix**（任意）: 「durationSec は 1 以上」または「時間は 1 秒以上」に統一すると、API 越しに直接呼ぶ test / debug 時の混乱が減る。

---

#### L3. `AppendLevelDialog` 再 hydrate test の依存配列に対する確認が薄い

[src/components/tournament/AppendLevelDialog.test.tsx:186-221](../../../src/components/tournament/AppendLevelDialog.test.tsx#L186-L221)

`open=true → false → true` の遷移後に値が再 hydrate されるテストは存在するが、`existingLevels` が変化したときに `useMemo(defaults)` が更新されるかは未検証。実装の `useEffect([open, defaults])` 依存により正しく動くが、test がそこを直接固定していないため将来 deps 配列を破壊しても気づきにくい。

**Fix**（任意）: open 状態で `existingLevels` を rerender で差し替え、SB が新しい defaults に更新されるテストを追加。

---

#### L4. `tests/e2e/append-blind-level.spec.ts` の `running` シナリオが 1 名 only ↔ 2 名のメモが矛盾する

[tests/e2e/append-blind-level.spec.ts:142-148](../../../tests/e2e/append-blind-level.spec.ts#L142-L148)

```ts
// 2 名以上必要（1 名のみだと winner 自動 finish が走り running を維持できない可能性）。
const organizer = randomOrganizer("apl-rn");
const { tid } = await seedOrganizerTournament(page, {
  organizer,
  tournamentName: "Append Running Break",
});
```

コメントは「2 名以上必要」と言っているが seedOrganizerTournament + joinAsGuest + selfJoin で参加者 2 名を作る後続コードがあるので意図は通る。ただし、`running` 中に `useAutoFinish` が「残り 1 人で 2 秒後 finish」を発火するため、E2E の append 操作が 2 秒以内に完結する保証はあまり強くない（page.goto / seed / start で時間を食うと race）。

**Fix**（任意）: append 完了の `expect.poll` までを `running` ＆ `participantCount=2` 状態で確実に行うよう、明示的に `expect(dash.stateBadge).toHaveText("進行中")` 直後に append 操作を入れる現状を維持で OK だが、CI で flaky になったら spec の `participants=3` 化を検討。

---

## Validation Results

| Check                  | Result | Notes                                       |
| ---------------------- | ------ | ------------------------------------------- |
| Type check (`tsc --noEmit`) | Pass   | exit 0                                      |
| Lint (`npm run lint`)  | Pass   | No ESLint warnings or errors                |
| Unit tests             | Pass   | 35 files / 768 tests 全 green               |
| Firestore rules drift  | Pass   | `npm run test:rules-limits` 6/6 OK          |
| Build                  | Skipped | report に `npm run build` Pass 記録あり、本レビューでは未再実行 |
| E2E                    | Skipped | emulator + dev server 環境前提のため別途実行   |

## Notes / Pattern Compliance

- **error-logging.md 準拠**: `appendLevel` は `wrapFirestoreWrite` 経由、成功 log は wrap 外の `logger.info`、Dialog 側は `unwrapOrFrom` で二重 wrap 回避。OK。
- **firebase-patterns.md 準拠**: `runTransaction` 内で groupId 再 check、tx 内 `tx.update(ref, { "structureSnapshot.levels": newLevels, updatedAt: serverTimestamp() })` で他フィールド汚染なし。Phase 5.2 と同じ rationale で rule 側 `affectedKeys.hasOnly` 強制は不要（`tournaments/{tid}` は `isOrganizer` 信頼経路）。OK。
- **group-membership.md 準拠**: `useGroupRole(data?.groupId)` → `myRole === "owner" || "organizer"` ガード。dashboard で非 organizer は `/live` redirect。OK。
- **testing.md 準拠**: characterization test ファースト（`canAppendLevel` 純関数 7 ケース）→ repository 11 ケース → Dialog 9 ケース → Card 5 ケース → E2E 3 ケース。mock 境界も helper / SDK 別で適切。OK。

## Decision

**APPROVE with comments**

CRITICAL / HIGH ゼロ。MEDIUM 3 件のうち M1（aria-label）は a11y 改善として 1 commit 分の作業で対応可。M2 / M3 は polish レベル。LOW は将来の i18n / flaky 対策で機を見て対応。マージブロッカーなし。

## Recommended Next Steps

1. M1 を 1 commit で修正（aria-label 削除 + 該当 test の `getByLabel` 文字列差し替え）
2. M2 を機械的に置換（`parseIntSafe` を局所定義 or 共通化）
3. PR 作成前に E2E spec を emulator + dev server 起動環境で実行し flake 有無を確認
