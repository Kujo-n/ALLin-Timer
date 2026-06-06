# Implementation Report: Phase 1 — 受付代理 データ層

## Summary

運営者（organizer / owner）が参加者を代理 create できる Firestore 基盤を実装した。`firestore.rules` の `players/{pid}` `allow create` を 2 ブランチ（self / organizer-clone）から **3 ブランチ**（self-create / member-proxy / name-only）へ拡張し、organizer が受付可能 4 state（setup / seating / running / paused）で「メンバーを uid 紐づけ」または「名前だけ（uid=null・合成 pid）」で代理登録できる経路を整備した。service（`proxy-receipt.ts`）・repository（`createNamedOnlyPlayer`）・state 述語（`isAcceptingProxyEntry`）・専用 emulator validator を追加し、既存 self-create / clone の strict invariants は非回帰を機械検証した。UI は Phase 2。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual                          |
| ------------- | ---------------- | ------------------------------- |
| Complexity    | Medium           | Medium（予測通り）              |
| Confidence    | Self-contained   | 質問不要・計画通り完遂          |
| Files Changed | 7（〜10）        | 9 ファイル変更（新規 2 / 更新 7）|

## Tasks Completed

| #   | Task                                            | Status      | Notes                                  |
| --- | ----------------------------------------------- | ----------- | -------------------------------------- |
| 1   | `isAcceptingProxyEntry` 述語追加                | ✅ Complete | drift warning コメントで rule と相互参照 |
| 2   | `createNamedOnlyPlayer` repository 追加         | ✅ Complete | uid=null / 合成 pid / 戻り値 pid        |
| 3   | firestore.rules に organizer-proxy create 整備  | ✅ Complete | member-proxy state 拡張 + name-only OR  |
| 4   | `proxy-receipt.ts` service 新設                 | ✅ Complete | 2 関数 export + displayName ≤15 検証    |
| 5   | `test-rules-proxy-create.mjs` 新規 validator    | ✅ Complete | 11 ケース ALL GREEN                     |
| 6   | `test-rules-clone-players.mjs` case 3 更新      | ✅ Complete | deny → allow（rule 拡張に伴う期待値更新）|
| 7   | package.json に test script 追加                | ✅ Complete | `test:rules-proxy-create`               |
| 8   | players.test.ts に repository test 追加         | ✅ Complete | 3 ケース（payload / pid / error wrap）  |
| 9   | proxy-receipt.test.ts 新設                      | ✅ Complete | 11 ケース（両経路 / role / state / 検証）|
| 10  | tournament-state.test.ts に characterization    | ✅ Complete | 全 state の it.each                     |

## Validation Results

| Level           | Status  | Notes                                                  |
| --------------- | ------- | ------------------------------------------------------ |
| Static Analysis | ✅ Pass | `tsc --noEmit` 0 errors / `next lint` no warnings      |
| Unit Tests      | ✅ Pass | 全 1479 tests pass（新規 14 件: repo 3 / service 11... state 1）|
| Build           | ✅ Pass | `next build` success                                   |
| Integration     | ✅ Pass | rules emulator: proxy-create 11/11 + clone 7/7 ALL GREEN |
| Edge Cases      | ✅ Pass | isBusted=true / seat 埋め / PD=true / finished / 空・16字 |

## Files Changed

| File                                            | Action  | Lines     |
| ----------------------------------------------- | ------- | --------- |
| `src/lib/services/proxy-receipt.ts`             | CREATED | +約150    |
| `src/lib/services/proxy-receipt.test.ts`        | CREATED | +約230    |
| `scripts/test-rules-proxy-create.mjs`           | CREATED | +約360    |
| `firestore.rules`                               | UPDATED | +28 / -2  |
| `src/lib/services/tournament-state.ts`          | UPDATED | +19       |
| `src/lib/services/tournament-state.test.ts`     | UPDATED | +11       |
| `src/lib/firebase/repositories/players.ts`      | UPDATED | +40       |
| `src/lib/firebase/repositories/players.test.ts` | UPDATED | +44 / -1  |
| `scripts/test-rules-clone-players.mjs`          | UPDATED | +9 / -4   |
| `package.json`                                  | UPDATED | +1        |
| `.claude/rules/firebase-patterns.md`            | UPDATED | rule 経路ドキュメント（3 ブランチ化） |
| `.claude/rules/group-membership.md`             | UPDATED | 既知のセキュリティリスク追記 |

## Deviations from Plan

None — plan 通りに実装。rule ブランチは plan の判断（旧 organizer-clone を member-proxy として state 拡張・共用 + name-only を additive OR）をそのまま採用。

## Issues Encountered

None。型・lint・unit・build・両 emulator validator すべて初回で green。emulator 実行時に「multiple instances」警告が出たが（別の emulator が稼働中の可能性）、validator は正常完了し ALL GREEN。

## Tests Written

| Test File                                       | Tests    | Coverage                                            |
| ----------------------------------------------- | -------- | --------------------------------------------------- |
| `src/lib/services/proxy-receipt.test.ts`        | 11 tests | service の role / state / displayName 検証 / 両経路 repo 呼出形 |
| `src/lib/firebase/repositories/players.test.ts` | +3 tests | `createNamedOnlyPlayer` payload / 合成 pid / error wrap |
| `src/lib/services/tournament-state.test.ts`     | +1 test  | `isAcceptingProxyEntry` の全 state characterization |
| `scripts/test-rules-proxy-create.mjs`           | 11 cases | rule allow/deny（member-proxy / name-only / invariant / state / self 非回帰） |
| `scripts/test-rules-clone-players.mjs`          | 7 cases  | case 3 を allow に更新、他非回帰                      |

## ⚠ 本番反映が必須

`firestore.rules` を変更したため、**emulator green ≠ 本番反映**。Phase 完了後に本番 deploy が必要:

```bash
firebase deploy --only firestore:rules
```

未 deploy のままだと本番で代理 create が `permission-denied` になる（Phase 2 UI 着手前に deploy 推奨）。

## Next Steps

- [ ] `firebase deploy --only firestore:rules` で本番反映
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
- [ ] Phase 2（受付代理 UI）で本 service を消費
