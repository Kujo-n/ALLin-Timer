# Implementation Report: Phase 4.17 — Group Default Seats Per Table

## Summary

サークル単位で「1 Table あたりの席数」初期値を保存できるようにした polish 系列。`groups/{gid}.defaultSeatsPerTable` を schema additive で追加（`z.number().int().min(2).max(10).default(9)`）し、`/tournaments/new` の `<TournamentForm initialSeatsPerTable=...>` に流し込む。値の編集 UI はサークル詳細画面（`/groups/[gid]`）の inline edit カードで提供し、Phase 4.16 の「開催数」カードの構造を完全 mirror した。Firestore Rules には organizer-only `defaultSeatsPerTable` 単独書換 branch を追加し、`affectedKeys().hasOnly([...])` + `is int` + 値域 2..10 で他フィールド汚染を deny する。

旧 doc は zod default で 9 として hydrate されるため破壊的 migration は不要。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual         |
| ------------- | ---------------- | -------------- |
| Complexity    | Medium           | Medium（plan どおり） |
| Confidence    | High             | High |
| Files Changed | 約 12 files       | 13 files（schema 1 / repo 1 / service 1 / rules 1 / 新規作成 client 1 / 詳細 client 1 / tests 4 / docs 3） |

`useAudioPlayer.test.tsx` の `makeGroup` fixture も `defaultSeatsPerTable: 9` を補完する必要があり 1 file 増えた（schema additive で型エラーが出る既存 fixture が plan で検出しきれていなかったため）。

## Tasks Completed

| #   | Task        | Status          | Notes               |
| --- | ----------- | --------------- | ------------------- |
| 1   | schema 拡張 — `defaultSeatsPerTable` を additive 追加 | [done] Complete | finishedTournamentCount の隣に同型で追加 |
| 2   | repository に `updateDefaultSeatsPerTable` を追加 | [done] Complete | updateFinishedTournamentCount を完全 mirror。createGroup の初期値（9）も追加 |
| 3   | service に `setDefaultSeatsPerTable` を追加 | [done] Complete | setFinishedTournamentCount を完全 mirror（`assertOrganizer` で owner / organizer 判定） |
| 4   | Firestore Rules に `defaultSeatsPerTable` 専用 branch を追加 | [done] Complete | finishedTournamentCount branch の直後に OR で 1 件追加 |
| 5   | 新規作成画面で `defaultSeatsPerTable` を流し込む | [done] Complete | useMemo で派生し `<TournamentForm initialSeatsPerTable=...>` に渡す |
| 6   | サークル詳細画面に「デフォルト席数」カードを追加 | [done] Complete | 開催数カードを mirror（Pencil + Input + Esc / 同値 noop close） |
| 7   | schema test を 5 ケース追加 | [done] Complete | default / explicit / min-1 / max+1 / 非整数 |
| 8   | repository test を 3 系統追加 | [done] Complete | happy + 境界値 + 範囲外（it.each） + Firestore reject |
| 9   | service test を全パターンで追加 | [done] Complete | owner / organizer / member / 範囲外（it.each） |
| 10  | rules emulator script を新規作成 | [done] Complete | 9 ケース実装（test-rules-finished-count.mjs を完全 mirror） |
| 11  | ルールファイル / PRD / docs 更新 | [done] Complete | firebase-patterns.md は節タイトルを「単一フィールド単独書換の rule 経路」に書き換え + 2 サブ節化 |
| 12  | 動作確認 / 検証ループ | [done] Complete | typecheck / lint / test / build green。emulator は実機未実行 |

## Validation Results

| Level           | Status      | Notes           |
| --------------- | ----------- | --------------- |
| Static Analysis (typecheck) | [done] Pass | tsc --noEmit zero errors |
| Lint            | [done] Pass | next lint zero warnings/errors |
| Unit Tests      | [done] Pass | 523 tests passed (29 files) |
| Build           | [done] Pass | Next.js production build OK（全 22 ルート） |
| Rules Emulator  | [skipped] N/A | スクリプト作成済み。実機実行はローカル環境で要確認（plan の手順どおり `firebase emulators:exec`） |
| Edge Cases      | [done] Pass | unit test レベルでカバー（non-integer / NaN / Infinity / 0 / 負値 / 境界値） |

## Files Changed

| File           | Action  | 概要 |
| -------------- | ------- | ----- |
| `src/lib/firebase/schemas/group.ts` | UPDATE | `defaultSeatsPerTable: z.number().int().min(2).max(10).default(9)` を追加 |
| `src/lib/firebase/repositories/groups.ts` | UPDATE | `updateDefaultSeatsPerTable` 新設、`createGroup` の payload に `defaultSeatsPerTable: 9` 追加 |
| `src/lib/services/group.ts` | UPDATE | `setDefaultSeatsPerTable` 新設（assertOrganizer + 値域 2..10 チェック） |
| `firestore.rules` | UPDATE | groups update に organizer-only `defaultSeatsPerTable` 単独書換 branch 1 件 OR 追加 |
| `src/app/tournaments/new/tournament-new-client.tsx` | UPDATE | `defaultSeatsPerTable` を `useMemo` で派生し `<TournamentForm>` に渡す |
| `src/app/groups/[gid]/group-detail-client.tsx` | UPDATE | 「1 Table あたりの席数（デフォルト）」カードを「開催数」カードの直後に追加 |
| `src/lib/firebase/schemas/index.test.ts` | UPDATE | schema 5 ケース追加 + deriveRole の baseGroup fixture 補完 |
| `src/lib/firebase/repositories/groups.test.ts` | UPDATE | `updateDefaultSeatsPerTable` の happy / 境界 / 範囲外 / Firestore reject 試験を追加 |
| `src/lib/services/group.test.ts` | UPDATE | `setDefaultSeatsPerTable` の owner / organizer / member / 範囲外試験 + makeGroup fixture 補完 + mock 追加 |
| `src/lib/hooks/useAudioPlayer.test.tsx` | UPDATE | makeGroup fixture に `defaultSeatsPerTable: 9` 補完（schema 型を満たすため） |
| `scripts/test-rules-default-seats.mjs` | CREATE | rules emulator スクリプト 9 ケース実装 |
| `.claude/rules/firebase-patterns.md` | UPDATE | 節タイトルを「単一フィールド単独書換の rule 経路」に変更し 2 サブ節（finishedTournamentCount / defaultSeatsPerTable）化 |
| `.claude/rules/group-membership.md` | UPDATE | データモデル / 権限マトリクスに `defaultSeatsPerTable` を追加 + 既知のセキュリティリスク節に Phase 4.17 段落追加 |
| `.claude/PRPs/prds/allin-timer.prd.md` | UPDATE | Phase 4.17 行を `in-progress` → `complete` に更新、レポートリンクを追記 |

## Deviations from Plan

- **`createGroup` の payload に `defaultSeatsPerTable: 9` を明示追加**: plan には記載されていなかったが、`createGroup` は他の数値フィールド（`finishedTournamentCount: 0`）も明示的に設定しており、新フィールドも同パターンで揃えるのが consistency 上正しい。zod default が hydrate するので read 側は無問題だが、write 時に明示する方が rule 分岐の追跡が楽になる。
- **`useAudioPlayer.test.tsx` の fixture 補完**: plan には記載されていなかったが、`GroupDoc` 型を直接 instantiate している既存 fixture があり、schema additive で型エラーが出るため補完が必要だった。

## Issues Encountered

なし。plan が「完全対称」と謳っていた通り、Phase 4.16 の構造をそのまま 1:1 で複製でき、validation でも一発で全 green。

## Tests Written

| Test File      | Tests   | Coverage       |
| -------------- | ------- | -------------- |
| `src/lib/firebase/schemas/index.test.ts` | 5 tests | schema additive: default / explicit / 範囲外（min-1 / max+1 / 非整数） |
| `src/lib/firebase/repositories/groups.test.ts` | 4 tests + 2 it.each cases (1 happy + 2 境界 + 7 範囲外 + 1 Firestore reject) | repository validation + happy path + Firestore error wrap |
| `src/lib/services/group.test.ts` | 4 tests + 1 it.each (5 cases) | service: owner / organizer / member / 範囲外（5 値） |
| `scripts/test-rules-default-seats.mjs` | 9 cases | rules emulator: 境界値 / member 拒否 / affectedKeys 拒否 / legacy doc / owner full update |

## Next Steps

- [ ] エミュレータ実機検証（`firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e "node scripts/test-rules-default-seats.mjs"`） — オペレータ側で実施
- [ ] `firebase deploy --only firestore:rules` — PR レビュー後に運営者が実施
- [ ] 手動ブラウザ確認（plan の Validation Commands → Browser Validation 9 項目）
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
