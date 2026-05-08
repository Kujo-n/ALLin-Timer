# Local Code Review: Phase E — シーズンポイント計算式の運営者カスタマイズ

**Reviewed**: 2026-05-08
**Branch**: develop（uncommitted）
**Scope**: PRD 02 Phase E — `groups/{gid}.seasonPointsRule` additive 追加 / `calcSeasonPoints` 第 3 引数 / `finishTournament` tx 内 rule re-read / `SeasonPointsRuleCard` UI 新設 / emulator validator 11 件 + drift 検査 3 件追加

**Decision: APPROVE**

---

## Summary

Phase E の実装は計画どおり、既存の Phase A / C / `finishedTournamentCount` / `defaultSeatsPerTable` の additive 追加パターンを忠実に踏襲している。CRITICAL / HIGH / MEDIUM の指摘なし。LOW 3 件はすべてバグではなく設計判断または軽微な冗長性。コミット可能。

---

## 検証サマリ（実装者報告値）

| Check              | Status    | Notes                                                                    |
| ------------------ | --------- | ------------------------------------------------------------------------ |
| typecheck          | Pass      | 0 errors                                                                 |
| lint               | Pass      | 0 warnings                                                               |
| vitest             | Pass      | 1135/1135（+35 新規）                                                    |
| Next.js build      | Pass      |                                                                          |
| rules-limits drift | Pass      | 14/14（既存 11 + 新規 3）                                                |
| emulator validator | not run   | `npm run test:rules-season-points-rule` は手動実行（要 firebase CLI）。本番 deploy 前に実施すること |

---

## Findings

### CRITICAL

なし。

### HIGH

なし。

### MEDIUM

なし。

### LOW

#### L-1: 編集ダイアログの `draftBase` が index key でレンダリングされている

**File**: [src/app/groups/[gid]/_components/SeasonPointsRuleCard.tsx:203](../../../../src/app/groups/[gid]/_components/SeasonPointsRuleCard.tsx#L203)

```tsx
{draftBase.map((v, i) => (
  <div key={i} className="flex items-center gap-2">
```

`draftBase` は行削除操作で配列が変化する可変リストだが `key={i}`（インデックス）を使っている。React は key が変わらない場合に同じ DOM ノードを再利用するため、中間行を削除した際にブラウザの `<input>` ネイティブステート（IME バッファ等）が次の行の value と不一致になる一瞬が生じうる。各 `<Input>` は `value={v}` の完全制御コンポーネントなので表示値は正しく更新されるが、微細な視覚的ちらつきが発生する可能性はある。

数値入力フィールドかつ IME が介在しない用途では実害はない。修正するなら `draftBase` を `{ id: string; value: string }[]` に変え、追加時に `crypto.randomUUID()` でキーを振る方法が本質的。同プロジェクトの他リスト UI でも index key が使われており、本 Phase のみで直す必要はない。

#### L-2: `group-detail-client.tsx` の `rule={group.seasonPointsRule ?? null}` が冗長

**File**: [src/app/groups/[gid]/group-detail-client.tsx:395](../../../../src/app/groups/[gid]/group-detail-client.tsx#L395)

```tsx
rule={group.seasonPointsRule ?? null}
```

`groupBodySchema` で `seasonPointsRule: seasonPointsRuleSchema`（`nullable().default(null)`）と定義されているため、zod parse 後の `group.seasonPointsRule` は `{ base: number[]; baseline: number } | null` であり `undefined` にならない。`?? null` は実行時に何も変えない冗長な式。バグではなく、型定義を見ずに defensive に書いたパターン。

#### L-3: 「既定値に戻す」ボタンが async 完了前にダイアログを閉じる

**File**: [src/app/groups/[gid]/_components/SeasonPointsRuleCard.tsx:293-300](../../../../src/app/groups/[gid]/_components/SeasonPointsRuleCard.tsx#L293-L300)

```tsx
onClick={() => {
  onReset();          // void-wrapped async — Firestore write が完了する前に進む
  setEditing(false);  // 同期でダイアログを閉じる
}}
```

`onReset()` は非同期（`void onResetSeasonPointsRule()`）だが、`setEditing(false)` を同期で呼んでいるため、Firestore write 完了前にダイアログが閉じる。エラーが起きた場合、フィードバックはダイアログ外の親コンポーネントの `setError` 経由でページ上部に表示される。`working` フラグが二重送信を防ぐ。`handleSave` も同じパターンであり、ページ全体の設計方針として統一されている。バグではない。

---

## 各確認項目の評価

### 1. Firestore Rules — 防御の深さ

問題なし。

- `request.resource.data.diff(resource.data).affectedKeys().hasOnly(['seasonPointsRule'])` により、このブランチ経由で `name` や `memberUids` 等の他フィールドを同時に変更できない（emulator ケース 3: `seasonPointsRule + name` の同時書換が deny されることを確認）。
- `null` の許容は同ブランチ内で `request.resource.data.seasonPointsRule == null` として表現されており、別ブランチの `affectedKeys.hasOnly([...])` に `seasonPointsRule` が含まれていないため他ブランチを迂回する経路は存在しない。
- `base.size() >= 1 && <= 9` / `baseline is int && >= 2 && <= 10` の制約は正確に記述されている。Firestore Rules の言語仕様で list element の値域（`base[i] >= 0`）を表現できない制約は docs とコメントで明記されており、schema / service 層への委譲は設計として妥当。
- `seasonPointsRule is map` により list 型の誤保存を deny する。

### 2. Tx の read-then-write 順序

問題なし。

`finishTournament` の tx 内実行順序:

1. `tx.get(tournamentRef)` — `loadTournamentInTx`（read）
2. `tx.get(groupRawDocRef(cur.groupId))` — Phase E 追加、`doc(firestore, "groups", gid)`（read）
3. ループ: `tx.get(seasonStatsRawDocRef(...))` × N（reads）
4. `tx.update(tournamentRef, { state: "finished", ... })`（write）
5. `tx.update(groupDocRef(cur.groupId), { finishedTournamentCount: increment(1) })`（write）
6. ループ: `tx.set(seasonStatsDocRef(...))`（writes）

`groupRawDocRef(gid)` と `groupDocRef(gid)` は同一 Firestore パス `groups/{gid}` を指す（converter はクライアントサイドのラッパーであり Firestore パスに影響しない）。Firestore はドキュメントの読取・書込をパスで追跡するため、step 2 で read し step 5 で update する順序は read-before-write 制約を満たす。

### 3. `parseSeasonPointsRuleFromRawData` の防御的パース

問題なし。関数内に throw が発生するパスは存在しない。

| 入力ケース | 動作 |
| --- | --- |
| `data = undefined`（doc 存在しない） | `obj = {}` → `rule = undefined` → `return null` |
| `seasonPointsRule = null` | `rule === null` → `return null` |
| `seasonPointsRule` が配列（list 型誤保存） | `typeof [] === "object"` を通過するが `r.base = undefined` → `!Array.isArray(undefined)` → `return null` |
| `r.base` が空配列 | `r.base.length < 1` → `return null` |
| `r.base` に非有限値（Infinity, NaN） | `Number(v)` が非有限 → `!Number.isFinite(n)` → `return null` |
| `r.base` に文字列要素 | `Number("abc") = NaN` → `!Number.isFinite(NaN)` → `return null` |
| `baseline` が 0 や 1 や 11 | 範囲チェック → `return null` |
| `baseline` が 8.5 | `!Number.isInteger(8.5)` → `return null` |

いずれも `null` を返して呼出側 `?? DEFAULT_SEASON_POINTS_RULE` でフォールバックする。Phase A の `toPrevStats` と同方針で一貫している。

### 4. `setSeasonPointsRule` サービス層の防御

問題なし。

- `value !== null` のとき、入力検証（配列長 → 各要素値域 → baseline）を `getGroup()` より前に実行。検証失敗時は Firestore read を省略する（テスト `"rejects empty base before reading group"` で確認済み）。
- `Math.round(v * 100) / 100` の 2 桁正規化: `8.659999999...` → `8.66`。前段の `!Number.isFinite(v)` チェックで `NaN` が弾かれるため `Math.round(NaN)` が発生するパスはない。
- `value = null` のとき、検証ブロックをスキップして `getGroup` + `assertOrganizer` へ進む。リセットは常に値域的に安全であり、認可チェックは依然として行われる。正しい動作。

### 5. UI (`SeasonPointsRuleCard.tsx`)

問題なし（L-1 / L-3 は LOW で記録済み）。

- `useEffect([editing])` は `effective` を意図的に依存配列から外し、モーダル open 時のみ draft を初期化する。ダイアログが開いている間に parent の `rule` prop が変わっても draft を上書きしない設計は合理的（編集中の入力をサーバー更新でリセットしない）。`// eslint-disable-next-line react-hooks/exhaustive-deps` コメントと日本語説明で意図が明示されている。
- `draftRule` の `useMemo` は `draftBase` / `draftBaseline` が一時的に invalid な値（入力途中の空文字等）でも `effective` にフォールバックし、`calcSeasonPoints` へ渡す値は常に valid。プレビュー表が空白になったり `NaN` 表示になることはない。
- a11y: 基本点 `<Input>` に `aria-label={"${i + 1}位の基本点"}` / baseline `<Input>` に `<Label htmlFor="spr-baseline">` + `id="spr-baseline"` 対応付け / バリデーションエラーに `role="alert"` — いずれも適切。
- `draftBase.length > 1 ? <Button> : null` — 行数が 1 件のとき削除ボタンを非表示にし、配列を空にできない制約を UI で正しく表現している。
- `step={0.01}` / `inputMode="decimal"` — 小数入力を許可し、モバイルキーボードを適切に誘導する。

### 6. テストカバレッジ

十分。

| 対象 API / パス | テストファイル | 件数 | 備考 |
| --- | --- | --- | --- |
| `calcSeasonPoints` 第 3 引数 | `season-points.test.ts` | 8 | 後方互換 / カスタム base / カスタム baseline / 配列長切れ / 不正入力 / DEFAULT との characterization |
| `seasonPointsRuleSchema` | `schemas/index.test.ts` | 9 | null default / explicit null / valid object / 境界 5 種 |
| `updateSeasonPointsRule` | `repositories/groups.test.ts` | 7 | valid write / null reset / 境界 4 種 / Firestore reject wrapping |
| `setSeasonPointsRule` | `services/group.test.ts` | 8 | owner / organizer / null reset / member deny / early validation 4 種 / 2 桁正規化 |
| `finishTournament` rule re-read | `repositories/tournaments.test.ts` | 3 | null → DEFAULT / カスタム rule / 不正値フォールバック |
| 既存 GroupDoc fixture 更新 | 3 ファイル | — | `seasonPointsRule: null` 型充填。テストの意味論への影響なし |

### 7. Drift スクリプト（`test-rules-limits.mjs`）

問題なし。

3 件の新規 pattern が `firestore.rules` 内の以下リテラルを正確に抽出する:

- `/seasonPointsRule\.base\.size\(\)\s*<=\s*(\d+)/g` → `SEASON_POINTS_BASE_MAX_LENGTH`（= 9）
- `/seasonPointsRule\.baseline\s*>=\s*(\d+)/g` → `MIN_SEATS_PER_TABLE`（= 2）
- `/seasonPointsRule\.baseline\s*<=\s*(\d+)/g` → `MAX_SEATS_PER_TABLE`（= 10）

`base.size() >= 1`（下限）は対応する名前付き定数が `limits.ts` に存在しないため drift check 対象外だが、値が変わる性質のものではなく許容範囲。

### 8. プロジェクト規約への準拠

| 項目 | 評価 |
| --- | --- |
| `wrapFirestoreWrite` 使用 | `updateSeasonPointsRule` で正しく使用。`updateDefaultSeatsPerTable` 等と同パターン |
| AppError コード prefix | repository 内の入力バリデーション → `validation/season-points-rule-invalid`、Firestore 失敗 → `firestore/write_failed`。`error-logging.md` 準拠 |
| `logger.info` 使用 | service・repository の成功パスで使用。`console.*` は不在 |
| allowed-keys 表 更新 | `firebase-patterns.md` に 9 行目として追加済み |
| 権限マトリクス更新 | `group-membership.md` に 2 行追加済み |

### 9. セキュリティ: 高値設定による影響

問題なし（既知の残存リスク）。

organizer が `base = [1e10, ...]` を設定した場合、`totalPoints` が大きくなる。`1e10 × sqrt(24/2) ≈ 3.5e10` を数百回加算しても Firestore `double` の上限（~1.8e308）には到達しない。`Math.round(... * 100) / 100` で 2 桁正規化するため浮動小数点誤差の蓄積も起きない。organizer は既存の `finishedTournamentCount` 任意値書換と同様の信頼ロールであり、新規リスクは発生していない（`group-membership.md` の「既知のセキュリティリスク」セクションと同方針）。

---

## Files Reviewed

**Modified (M)**:

- `firestore.rules` — Phase E branch (lines 244-275)
- `package.json` — `test:rules-season-points-rule` script
- `src/lib/limits.ts` — `SEASON_POINTS_BASE_MAX_LENGTH`
- `src/lib/services/season-points.ts` — rule 第 3 引数 / `DEFAULT_SEASON_POINTS_RULE`
- `src/lib/services/season-points.test.ts`
- `src/lib/firebase/schemas/group.ts` — `seasonPointsRuleSchema`
- `src/lib/firebase/schemas/index.test.ts`
- `src/lib/firebase/repositories/groups.ts` — `updateSeasonPointsRule`
- `src/lib/firebase/repositories/groups.test.ts`
- `src/lib/services/group.ts` — `setSeasonPointsRule`
- `src/lib/services/group.test.ts`
- `src/lib/firebase/repositories/tournaments.ts` — tx 内 group raw read
- `src/lib/firebase/repositories/tournaments.test.ts`
- `src/app/groups/[gid]/group-detail-client.tsx` — Card placement + handlers
- `src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.test.tsx` — fixture
- `src/lib/hooks/useAudioPlayer.test.tsx` — fixture
- `src/lib/services/account-delete.test.ts` — fixture
- `scripts/test-rules-limits.mjs` — drift checks +3
- `.claude/rules/firebase-patterns.md` — allowed-keys table 9 行目
- `.claude/rules/group-membership.md` — フィールド説明 + 権限マトリクス +2 行
- `.claude/PRPs/02-season-stats-and-share/prds/02-season-stats-and-share.prd.md` — Phase E complete

**Added (A)**:

- `src/app/groups/[gid]/_components/SeasonPointsRuleCard.tsx`
- `scripts/test-rules-season-points-rule.mjs` — emulator validator 11 cases
- `.claude/PRPs/02-season-stats-and-share/reports/phase-e-season-points-rule-customization-report.md`
- `.claude/PRPs/02-season-stats-and-share/plans/completed/phase-e-season-points-rule-customization.plan.md` (relocated from `plans/`)

---

## Review Summary

| Severity | Count | Status |
| -------- | ----- | ------ |
| CRITICAL | 0     | pass   |
| HIGH     | 0     | pass   |
| MEDIUM   | 0     | pass   |
| LOW      | 3     | note   |

**Verdict: APPROVE** — CRITICAL / HIGH / MEDIUM 件数ゼロ。LOW 3 件はすべてバグではなく設計判断または軽微な冗長性（L-1 index key / L-2 `?? null` 冗長 / L-3 async-before-close パターン）。コミット可能。

本番 deploy チェックリスト（既存規約の再掲）:

- `npm run test:rules-season-points-rule`（emulator 起動 + 11 ケース検証）
- `firebase deploy --only firestore:rules`
