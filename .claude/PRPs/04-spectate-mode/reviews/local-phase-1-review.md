# Local Code Review: Phase 1 — Schema + Rule + Emulator Validator（観戦モード基盤）

**Reviewed**: 2026-05-09
**Branch**: `feat/spectate-phase-1-schema-rule` (uncommitted)
**Reviewer**: code-reviewer subagent
**Decision**: **APPROVE**（CRITICAL / HIGH なし。MEDIUM 1 件 / LOW 3 件は受容範囲または将来 Phase 対応推奨）

## Summary

schema additive・rules 拡張・emulator validator の 3 点はいずれも設計意図どおりに実装されており、CRITICAL 級の問題はない。既存の subcollection 設計原則（wildcard 厳禁）を厳守し、`allow update, delete` の分割・`exists() + get()` の必須化・fixture の `...overrides` 前への挿入もすべて正しい。MEDIUM 1 件と LOW 3 件をドキュメント残しておく価値あり。

## Findings

### CRITICAL

なし。

### HIGH

なし。

### MEDIUM

**[MEDIUM] `allow read` が `allow get + allow list` の両方を anon に開放している**

- **File**: [firestore.rules:402-407](../../firestore.rules#L402-L407)
- **Issue**: `tournaments/{tid}` の rule は `allow read` 複合形を使うため、`spectateEnabled == true` のとき anon が
  Firestore SDK から `db.collection("tournaments").where("spectateEnabled", "==", true)` で公開中の **全 tournament を
  列挙**できる。PRD の「tid は base62 ≈ 117bit で推測困難」は GET の推測困難性であり、LIST 経由の discovery は別問題。
- **Risk**: 観戦 URL を意図的に共有する小規模サークル前提では受容範囲内。将来不特定多数に公開する場合は
  defense-in-depth として `allow get` / `allow list` 分割が望ましい。
- **既存パターン**: `groupJoinCodes` は同方針（`allow get: if isSignedIn(); allow list: if false;`）で実装済み。
- **推奨アクション（今 Phase 任意）**:
  ```firestore-rules
  allow get: if isSignedIn()
             || resource.data.get('spectateEnabled', false) == true;
  allow list: if isSignedIn();  // anon の list 列挙を deny（既存の signed-in 列挙は維持）
  ```
  + emulator validator に「anon が `tournaments` を list して 401/403」のケースを追加。

### LOW

**[LOW-1] `allow update` 経路 B が経路 A に完全包含されている件の TODO 記録**

- **File**: [firestore.rules:422-428](../../firestore.rules#L422-L428)
- **Issue**: 経路 B の OR 左辺も `isOrganizer(gid)` のため経路 A と論理等価。コメントで「足場」と明示されているが、
  emulator validator case 12 が「organizer non-bool が経路 A 経由で allow になる」を `expectAllow` で記録しており、
  「型検証が rule レベルで実質無効」を validator がドキュメント化している珍しい構造。将来 Phase で経路 A を狭めた際に
  case 12 を `expectDeny` に変える修正が必要。
- **推奨アクション**: 次 Phase の plan / TODO リストに「経路 A を狭めるときは case 12 と `is bool` 検証を再評価」
  を残しておくと将来事故が減る。

**[LOW-2] emulator validator に owner-delete ケースが欠けている**

- **File**: [scripts/test-rules-spectate.mjs:432-434](../../scripts/test-rules-spectate.mjs#L432-L434)
- **Issue**: case 14 は organizer による delete のみ検証。`ownerUids ⊆ organizerUids` 前提で owner delete は暗黙に
  pass するが、rule 定義の明示的な堅牢性確認として owner ケースを追加するとより安全。
- **推奨アクション**: 15 ケース目として `(15) owner delete tournament (regression)` を追加。

**[LOW-3] `players` / `tables` anon read の rule 評価コストを規約に追記**

- **File**: [firestore.rules:438-443](../../firestore.rules#L438-L443), [firestore.rules:573-578](../../firestore.rules#L573-L578)
- **Issue**: `/spectate/[tid]` ページが Phase 2 で `subscribePlayers(tid)` を 20 件 listen するとき、
  各 player rule 評価で `exists() + get()` が発火（同一 rule 評価内では Firebase が path をキャッシュ）。
  20 人 × 月 1〜2 回規模では無視できるが、認知負荷削減のため `firebase-patterns.md` の「Phase 2.5 以降の注意:
  `get()` による参照は rule read を消費」セクションに観戦経路の read コストを 1 行追記すると次 Phase
  実装者の助けになる。
- **推奨アクション**: `firebase-patterns.md` に 1 行追記（任意）。

## Confirmed Correctly Implemented

以下はすべて正しく実装されている:

- `z.boolean().default(false)` の選択: `lastLevelChangeKind` は値なし保持で `.optional()` だが、
  `spectateEnabled` は「false が明確な初期状態」のため `.default(false)` が適切。
- `createTournament` の `spectateEnabled: false` 明示: zod `.default()` は input optional だが addDoc payload は
  TS infer 型を経由せず raw object のため、明示しないと Firestore doc に field が保存されず legacy doc と区別不能。
  正しい対処。
- `CreateTournamentInput` / `UpdateTournamentInput` の `Pick` リストに含めない方針: Phase 3 で専用 service
  経由で管理する設計意図と整合。
- collectionGroup wildcard `match /{path=**}/players/{pid}` を触らない判断: 観戦ページは path-specific rule
  で read し、wildcard に anon を足すと query 経由で全 tournament の全 player が漏洩する。手を付けないのが正しい。
- DRIFT WARNING コメントが 4 経路を schema 側でリスト化している点: 消去漏れ防止として十分。
- 14 fixture 修正は全件 `...overrides` より前に挿入されており、既存テストロジックに影響なし。

## Validation Results

| Check                                | Result                |
| ------------------------------------ | --------------------- |
| `npm run typecheck`                  | Pass (0 errors)       |
| `npm run lint`                       | Pass (0 warnings)     |
| `npm run test`                       | Pass (1213/1213)      |
| `npm run build`                      | Pass                  |
| `npm run test:rules-spectate` (新規) | Pass (14/14)          |
| `npm run test:rules-limits` (回帰)   | Pass (14/14)          |
| `npm run test:rules-clone-players`   | Pass (7/7)            |
| `npm run test:rules-season`          | Pass (12/12)          |
| `npm run test:rules-season-points-rule` | Pass (11/11)       |
| `npm run test:rules-table-labels`    | Pass (16/16)          |

## Files Reviewed

実装コード:
- `src/lib/firebase/schemas/tournament.ts` (Modified)
- `src/lib/firebase/repositories/tournaments.ts` (Modified)
- `firestore.rules` (Modified)

新規:
- `scripts/test-rules-spectate.mjs` (Added)

設定:
- `package.json` (Modified)

規約ドキュメント:
- `.claude/rules/error-logging.md` (Modified)
- `.claude/rules/firebase-patterns.md` (Modified)
- `.claude/rules/group-membership.md` (Modified)

PRD / report:
- `.claude/PRPs/04-spectate-mode/prds/04-spectate-mode.prd.md` (Modified)
- `.claude/PRPs/04-spectate-mode/reports/phase-1-schema-rule-emulator-report.md` (Added)

テスト fixture（付帯修正、ロジック変更なし）:
- `src/app/tournaments/[tid]/live/live-client.test.tsx`
- `src/components/tournament/AverageStackCard.test.tsx`
- `src/components/tournament/NextBreakCard.test.tsx`
- `src/components/tournament/StructureSnapshotCard.test.tsx`
- `src/components/tournament/TimerDisplay.test.tsx`
- `src/components/tournament/_timer-controls/TimerControlsRunningPaused.test.tsx`
- `src/lib/firebase/repositories/tournaments.test.ts`
- `src/lib/firebase/tx-helpers.test.ts`
- `src/lib/hooks/useAudioPlayer.test.tsx`
- `src/lib/hooks/useSeatingAutoOrchestrator.test.ts`
- `src/lib/services/receipt.test.ts`
- `src/lib/services/seating/orchestrator.test.ts`
- `src/lib/services/timer.test.ts`
- `src/lib/services/tournament-state.test.ts`

## Severity Summary

| Severity | Count |
| -------- | ----- |
| CRITICAL | 0     |
| HIGH     | 0     |
| MEDIUM   | 1     |
| LOW      | 3     |

**Verdict: APPROVE** — CRITICAL / HIGH 指摘なし。MEDIUM 1 件は PRD 設計判断（小規模サークル・opt-in・tid 共有前提）の範囲内で受容可能だが、`allow get` / `allow list` 分割は既存パターン（`groupJoinCodes`）と揃えるなら今 Phase で対応する選択肢もある。LOW 3 件は次 Phase 着手時に対応可。
