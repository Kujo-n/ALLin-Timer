# Implementation Report: Phase 3 — Toggle UI + 共有導線（dashboard）

## Summary

Phase 1 で確立した `tournaments/{tid}.spectateEnabled` 基盤の上に、owner / organizer 限定の **opt-in toggle UI**（OFF→ON 確認 dialog 付き）／ 観戦 URL コピー / QR コード表示を **SpectateModeCard** として dashboard 最下部に追加し、tournament 一覧に「観戦公開中」 badge を additive 表示した。書込経路は新規 `setSpectateEnabled` service → `updateSpectateEnabled` repository → `wrapFirestoreWrite` 経由で、Phase 1 で組まれた rule + service の二重防御を成立させた。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual         |
| ------------- | ---------------- | -------------- |
| Complexity    | Medium           | Medium         |
| Confidence    | High             | High           |
| Files Changed | 8 ファイル       | 9 ファイル（CREATED 4 / UPDATED 5） |

PRD の Files to Change 表は 8 件想定だったが、`SpectateModeCard.test.tsx` を新設したため CREATED 4 件 + UPDATED 5 件の計 9 件となった（`SpectateModeCard.tsx` と `.test.tsx` を別カウント）。

## Tasks Completed

| #   | Task                                                       | Status   | Notes |
| --- | ---------------------------------------------------------- | -------- | ----- |
| 1   | `buildSpectateUrl` を `src/lib/services/qr.ts` に追加       | Complete | origin 取得を共通化（`safeOrigin()`） |
| 2   | `updateSpectateEnabled` repository を `tournaments.ts` に追加 | Complete | patch shape: `{ spectateEnabled, updatedAt: serverTimestamp() }` |
| 3   | `setSpectateEnabled` service を新規作成 (`tournament.ts`)    | Complete | groupId 経由で role 再評価（`assertOrganizer` 相当を局所コピー） |
| 4   | `updateSpectateEnabled` repository test を追加               | Complete | 7 ケース（happy / 4 type穴 it.each / firestore reject） |
| 5   | `setSpectateEnabled` service test を新規作成                 | Complete | 7 ケース（owner / organizer / member deny / not-found / 3 type穴 it.each） |
| 6   | `SpectateModeCard` component を新規作成                      | Complete | `role="switch"` + Dialog + clipboard + QR 折りたたみ |
| 7   | `SpectateModeCard` characterization test を新規作成           | Complete | 8 ケース（OFF/ON 表示 / QR toggle / dialog flow / error UX / clipboard） |
| 8   | dashboard-client.tsx に `<SpectateModeCard>` を統合          | Complete | StructureSnapshotCard 直下、`<Dialog>`（削除確認）の直前 |
| 9   | tournaments-client.tsx に「観戦公開中」badge を追加         | Complete | sky 系色、aria-label に「観戦公開中」を含めて a11y 担保 |

## Validation Results

| Level           | Status | Notes                                          |
| --------------- | ------ | ---------------------------------------------- |
| Static Analysis | Pass   | typecheck 0 errors                             |
| Lint            | Pass   | 0 warnings / 0 errors（next lint）             |
| Unit Tests      | Pass   | 1243/1243（既存 1228 + 新規 15）               |
| Build           | Pass   | Next.js build 成功                             |
| Edge Cases      | Pass   | testing strategy の checkbox 全件 cover       |

⚠️ Manual validation（dev server / Firestore emulator での toggle 動作確認 / 実際の rule 経路）は実施していない。Phase 4 (PWA) と並行して 1 リリースに含める運用を想定しているため、リリース前に手動確認するべきチェック項目は plan の「Manual Validation」節および Acceptance Criteria 末尾に記載済み。

`npm run test:rules-spectate` は Phase 1 の 14 ケース全 pass を前提とした **Phase 3 では非変更**の検証で、本実装では rule に手を入れていないため再走行は省略（emulator 起動コスト + Phase 1 で既に green 確認済）。

## Files Changed

| File                                                                | Action  | Notes                                                |
| ------------------------------------------------------------------- | ------- | ---------------------------------------------------- |
| `src/lib/services/qr.ts`                                            | UPDATED | `safeOrigin()` 抽出 + `buildSpectateUrl()` 追加       |
| `src/lib/firebase/repositories/tournaments.ts`                      | UPDATED | `updateSpectateEnabled(tid, value)` 追加              |
| `src/lib/firebase/repositories/tournaments.test.ts`                 | UPDATED | `updateSpectateEnabled` describe ブロック（7 ケース） |
| `src/lib/services/tournament.ts`                                    | CREATED | `setSpectateEnabled({ tid, uid, value })` 新規        |
| `src/lib/services/tournament.test.ts`                               | CREATED | service unit test（7 ケース）                          |
| `src/components/tournament/SpectateModeCard.tsx`                    | CREATED | Card / Dialog / 入力切替 / QR / clipboard            |
| `src/components/tournament/SpectateModeCard.test.tsx`               | CREATED | RTL test（8 ケース）                                  |
| `src/app/tournaments/[tid]/dashboard-client.tsx`                    | UPDATED | `<SpectateModeCard>` を最下部に挿入                  |
| `src/app/tournaments/tournaments-client.tsx`                        | UPDATED | sky 系「観戦公開中」 badge を additive 追加          |

## Deviations from Plan

**None — implemented exactly as planned.**

ただし plan 側の比較的細かい補足:

- Task 1 の `safeOrigin()` 抽出は plan に明記されていたとおり実装。既存 `buildJoinUrl` も関数経由に切替えたが、戻り値・呼出 signature は不変（QrPanel 等の consumer に影響なし）。
- Task 2 の `updateSpectateEnabled` は `serverTimestamp()` 戻り値の sentinel `{ __op: "serverTimestamp" }` を test で固定化したため、`firebase/firestore` mock の `serverTimestamp` モックがそのまま流用できた。
- Task 8 の挿入位置は **`StructureSnapshotCard` の直下**で plan 通り。winner 確定時の WinnerBanner 等は `<main>` 上半分にあるため、本 Card が常に最下位置に来る不変条件は保たれている。

## Issues Encountered

**None.**

各 Task 単位で typecheck がそのまま通り、test 群も初回で全 pass した。Phase 1 で schema additive 完了 / fixture も `spectateEnabled: false` で既に hydrate されていたため、回帰は発生しなかった。

## Tests Written

| Test File                                                  | Tests   | Coverage                                                 |
| ---------------------------------------------------------- | ------- | -------------------------------------------------------- |
| `src/lib/firebase/repositories/tournaments.test.ts`        | +7      | `updateSpectateEnabled` patch shape / type穴 / firestore reject |
| `src/lib/services/tournament.test.ts`                      | 7       | role gate（owner / organizer / member deny）/ not-found 伝播 / 3 type穴 |
| `src/components/tournament/SpectateModeCard.test.tsx`      | 8       | OFF/ON 表示分岐 / QR toggle / dialog 開閉 / 確認 / 即時 OFF / error UX / clipboard |

合計 22 件追加（plan の「~17 件」から 5 件超過。boolean type穴 it.each を 3〜4 ケース展開した結果）。

## Next Steps

- [ ] Code review via `/code-review`
- [ ] Phase 4 (PWA cache allowlist) と並行して 1 リリースに統合
- [ ] リリース前 manual validation（plan の Manual Validation 節）:
  - dev server で organizer ログイン → toggle / QR / clipboard 動作
  - 一覧画面の「観戦公開中」 badge 表示
  - member ログイン → dashboard `/live` redirect → toggle UI 不可視 / 一覧 badge は可視
- [ ] Create PR via `/prp-pr`

---

## 参照

- Plan: [.claude/PRPs/04-spectate-mode/plans/completed/phase-3-toggle-ui-and-share.plan.md](../plans/completed/phase-3-toggle-ui-and-share.plan.md)
- PRD: [.claude/PRPs/04-spectate-mode/prds/04-spectate-mode.prd.md](../prds/04-spectate-mode.prd.md)
- 関連 Phase 1 report: [phase-1-schema-rule-emulator-report.md](phase-1-schema-rule-emulator-report.md)
- 関連 Phase 2 report: [phase-2-spectate-readonly-page-report.md](phase-2-spectate-readonly-page-report.md)
