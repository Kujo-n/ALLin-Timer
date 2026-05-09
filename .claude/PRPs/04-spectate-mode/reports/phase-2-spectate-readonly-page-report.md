# Implementation Report: Phase 2 — `/spectate/[tid]` Read-only Page

## Summary

Phase 1 で確立した `tournaments/{tid}.spectateEnabled` の anon read 経路を消費する read-only ページ `/spectate/[tid]` を新規実装した。`useTournamentTimer(tid)` / `subscribePlayers(tid)` / `subscribeTables(tid)` の既存購読 API をそのまま再利用し、タイマー / ブラインド / 残人数 / Average Stack / Next Break / 席表（read-only） / ストラクチャ snapshot / レイトレジ受付状況 banner を完全 unauthenticated で描画する。`spectateEnabled=false` / 不存在 / toggle OFF（permission-denied）の各 case を 4 段 guard ladder で graceful にハンドリングし、`/live` の DOM / ロジックには一切触れていない。

Phase 1 review LOW-3（観戦経路の rule read コスト docs）も同 Phase で消化（`firebase-patterns.md` に 1 段落追記）。

## Assessment vs Reality

| Metric        | Predicted (Plan)                              | Actual                                                              |
| ------------- | --------------------------------------------- | ------------------------------------------------------------------- |
| Complexity    | Medium                                        | Medium                                                              |
| Confidence    | （明示記載なし — 高確度想定）                 | 想定通り。pure-component の組合せのみで型 / lint エラー 0           |
| Files Changed | 4 ファイル（page 1 / client 1 / test 1 / docs 1） | 4 ファイル（一致）                                                  |

## Tasks Completed

| #   | Task                                                                  | Status                | Notes                                                                          |
| --- | --------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------ |
| 1   | Server Component 作成（`page.tsx`）                                   | [done] Complete       | RequireAuth 不使用 + `params: Promise<{tid}>` 受領で 13 行                     |
| 2   | Client Component skeleton + subscribe + guard ladder                  | [done] Complete       | useEffect 3 個（timer error / players / tables）+ 4 段 guard                   |
| 3   | Client Component header / 通信状態 banner / TimerDisplay 配置         | [done] Complete       | OfflineBanner / ConnectionBadge / TimerDisplay / SpectateLateEntryBanner       |
| 4   | Players / AverageStack / NextBreak / StructureSnapshot 追加           | [done] Complete       | 3-col grid + StructureSnapshotCard（showDescription=false）                    |
| 5   | SeatingBoard（read-only）追加                                         | [done] Complete       | currentUid=null / canManage=false で完全 read-only                             |
| 6   | Unit Tests（`spectate-client.test.tsx`）                              | [done] Complete       | 8 ケース全 green。Lv badge の重複マッチを `getByLabelText("タイマー")` で scope |
| 7   | 規約ドキュメント更新（`firebase-patterns.md`）                        | [done] Complete       | Phase 1 review LOW-3 を消化（観戦経路の rule read コスト 1 段落）               |
| 8   | Phase 1 review LOW-1 / LOW-2 への確認 / TODO 引継ぎ                   | [done] Complete       | LOW-1 → Phase 3、LOW-2 → 任意（Phase 3/4 のいずれでも 1 ケース追加）             |

## Validation Results

| Level                            | Status      | Notes                                                                                  |
| -------------------------------- | ----------- | -------------------------------------------------------------------------------------- |
| Static Analysis (typecheck)      | [done] Pass | 0 errors                                                                               |
| Static Analysis (lint)           | [done] Pass | No ESLint warnings or errors                                                           |
| Unit Tests (spectate-client)     | [done] Pass | 8/8                                                                                    |
| Unit Tests (全件)                | [done] Pass | 1221/1221（全 71 ファイル）                                                            |
| Build (`next build`)             | [done] Pass | `/spectate/[tid]` が **dynamic route** として登録（4.24 kB / First Load 326 kB）       |
| Emulator: rules-spectate         | [done] Pass | 16/16（Phase 1 ベースライン回帰確認）                                                  |
| Emulator: rules-limits           | [done] Pass | 14/14                                                                                  |
| Emulator: rules-clone-players    | [done] Pass | 7/7                                                                                    |
| Emulator: rules-season           | [done] Pass | 12/12                                                                                  |
| Emulator: rules-season-points-rule | [done] Pass | 11/11                                                                                  |
| Emulator: rules-table-labels     | [done] Pass | 16/16                                                                                  |
| Edge Cases                       | [done] Pass | 8 ケースすべて unit test で網羅。Manual Validation はローカル emulator + Vercel preview に委譲 |

## Files Changed

| File                                                                  | Action  | Lines  |
| --------------------------------------------------------------------- | ------- | ------ |
| `src/app/spectate/[tid]/page.tsx`                                     | CREATE  | +25    |
| `src/app/spectate/[tid]/spectate-client.tsx`                          | CREATE  | +218   |
| `src/app/spectate/[tid]/spectate-client.test.tsx`                     | CREATE  | +179   |
| `.claude/rules/firebase-patterns.md`                                  | UPDATE  | +10    |
| `.claude/PRPs/04-spectate-mode/prds/04-spectate-mode.prd.md`          | UPDATE  | +0/-0（status と link のみ修正） |

## Deviations from Plan

| What                                                                                                    | Why                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subscribeTables` mock の default を「`onNext` を呼ぶ」形に変更（plan 例は `() => () => {}`）           | plan は `subscribeTables: vi.fn(() => () => {})` を default としていたが、それだと `onNext` を呼ばないため `tables` state が空のままで実装上問題ない。一方で `onNext` を呼ぶ形に揃えた方が他 test の subscribePlayers と対称性が取れて読みやすかったため統一。挙動差は無し |
| Lv 2 マッチで `getByText(/Lv\s*2/)` が 2 要素にマッチして失敗 → `getByLabelText("タイマー")` で scope    | TimerDisplay 内の `<span>Lv 2</span>` と late entry banner 内の「現在 Lv 2」が同時に存在する。plan サンプルの `screen.getByText(/Lv\s*2/)` は意図通り動かなかったため、`<section aria-label="タイマー">` で scope する形に修正                                  |

## Issues Encountered

| Issue                                                                                                                  | Resolution                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `getByText(/Lv\s*2/)` が TimerDisplay と late-entry banner の両方にマッチし `Found multiple elements` エラー            | `screen.getByLabelText("タイマー")` の section から `toHaveTextContent(/Lv\s*2/)` を assert する形に書き換え       |

## Tests Written

| Test File                                            | Tests   | Coverage                                                                                                         |
| ---------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/app/spectate/[tid]/spectate-client.test.tsx`    | 8 tests | 読込中 / 未公開 / 通常 / late entry open & closed / state=finished / subscribe permission-denied (3 経路) / 他 error は loading 維持 |

mock 構造で `useAuthUser` / `current-group` / `auth-actions` / `receipt` を **意図的に declare していない** ため、もし将来 spectate-client が誤って auth context を読む regression が入ると test 環境で AuthProvider 不在により throw → red になる **negative test として機能**する。

## Code Review 反映

Phase 1 ローカルレビュー（`.claude/PRPs/04-spectate-mode/reviews/local-phase-1-review.md`）の処遇:

| 指摘 | 重要度 | Phase 2 での対応 |
| ---- | ------ | ---------------- |
| LOW-1: rule 経路 B が経路 A に包含（spectateEnabled toggle 用 affectedKeys ブランチが broad organizer update に redundant） | LOW    | **未対応 → Phase 3 引継ぎ**。`setSpectateEnabled` service が確定すれば「経路 A を狭める」検討が可能になる |
| LOW-2: `test-rules-spectate.mjs` に owner-delete validator 追加 | LOW    | **未対応 → 任意**（Phase 3/4 のいずれでも 1 ケース追加するだけ。Phase 2 の本筋から外れるため見送り） |
| LOW-3: 観戦経路の rule read コスト docs | LOW    | **対応済み**（Task 7 で `firebase-patterns.md` に 1 段落追記） |

## Next Steps

- [ ] Code review via `/code-review`（Codex 自動レビューも走る）
- [ ] Manual Validation（ローカル emulator + Vercel preview）
  - 実機 incognito で `/spectate/{tid}` を開いてタイマー / 席表 / レイトレジ banner を目視確認
  - Phase 3 の toggle UI が未実装のため、`spectateEnabled=true` は emulator で REST 直叩きまたは Firestore Console で seed する
- [ ] Create PR via `/prp-pr`
- [ ] Phase 3 / 4 着手（並列実装可能）
