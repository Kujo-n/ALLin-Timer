# Local Review: Phase 4.5 — Pre-Phase 5 Improvements

**Reviewed**: 2026-04-21
**Author**: Kujo-n
**Branch**: develop (uncommitted local changes)
**Decision**: APPROVE with comments — **MEDIUM 2 件は修正済み（2026-04-21）**

## Summary

Phase 4.5 の 16 タスク分の差分（編集 15 / 新規 2 / 削除 2）をローカルレビュー。セキュリティ上の問題なし、型検査 / lint / 296 テスト / ビルドいずれも green、カバレッジ 97.63% 文 / 89.6% 分岐（全ファイル 80%+）。`CRITICAL` / `HIGH` 該当なし、`MEDIUM` 2 件 + `LOW` 4 件の観察のみで全体として実地ドライラン投入可能な品質。

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

1. **Auto-finish timer が関連性の低い snapshot 更新でリセットされる可能性** — ✅ **Resolved (2026-04-21)**
   - 場所: [src/app/tournaments/[tid]/dashboard-client.tsx:103-140](src/app/tournaments/[tid]/dashboard-client.tsx#L103-L140)
   - 初版の Effect 依存配列は `[data, user, players, groupIds]` で、zodConverter が snapshot 毎に新規オブジェクトを返すため不要な再装填のリスクがあった。
   - 対応: Effect 依存を primitive (`winnerId` / `dataId` / `dataState` / `dataGroupId` / `userUid` / `groupIds`) に縮小。`winner` は `useMemo` で一本化し、`winner?.id` を effect のトリガに使うことで、winner 同一のまま `data` / `players` の参照だけ変わっても再装填されない。
   - 検証: typecheck / lint / 296 tests / build いずれも pass。

2. **`resolveWinner` がレンダ毎に 2 回呼ばれる** — ✅ **Resolved (2026-04-21)**
   - 場所: [src/app/tournaments/[tid]/dashboard-client.tsx:109-112](src/app/tournaments/[tid]/dashboard-client.tsx#L109-L112)
   - 対応: `const winner = useMemo(() => (data ? resolveWinner(data, players) : null), [data, players]);` に統合。render body の重複呼出しを削除し、effect からも同一の memoized 値を参照。

### LOW

3. **匿名自己削除 effect の「部分成功」耐性**
   - 場所: [src/app/tournaments/[tid]/live/live-client.tsx:61-73](src/app/tournaments/[tid]/live/live-client.tsx#L61-L73) / [src/lib/services/auth-actions.ts:261-275](src/lib/services/auth-actions.ts#L261-L275) / [src/lib/services/receipt.ts:162-175](src/lib/services/receipt.ts#L162-L175)
   - `deleteUserProfile` → `user.delete()` の 2 段で 1 段だけ成功した場合、`users/{uid}` は消えるが Firebase Auth には残る（またはその逆）。Phase 4.5 は best-effort 方針で明示的に許容されている（plan Notes 参照、Phase 5+ で Cloud Functions による一括掃除を想定）。
   - 備考として記録するのみ。コード変更不要。

4. **`page.tsx` の Server→Client 転換による初回 hydrate flash**
   - 場所: [src/app/page.tsx](src/app/page.tsx)
   - 初回ロード時に SSR 側は `loading=true` のため「読込中…」が描画され、client hydrate 後に認証状態が解決して切り替わる。プラン内で明示的に受容されている設計。静的表示に戻したい場合は cookie ベースの session hint で pre-render する改善余地あり（Phase 5+）。

5. **live-client self-delete effect の不要再評価**
   - 場所: [src/app/tournaments/[tid]/live/live-client.tsx:53-74](src/app/tournaments/[tid]/live/live-client.tsx#L53-L74)
   - `me` は `players.find(...)` で毎回新たに算出されるため、`players` snapshot のたびに effect が再走する。`selfDeleteInflightRef` が short-circuit するため副作用としては問題なしだが、依存を `tournament.state === "finished"` と `user.uid`、`me?.uid` 等の primitive に絞ると意図が読みやすい。

6. **テストでの実時間待ち**
   - 場所: [src/app/tournaments/[tid]/live/live-client.test.tsx](src/app/tournaments/[tid]/live/live-client.test.tsx) の `await new Promise((r) => setTimeout(r, 20))` 2 箇所
   - 「副作用が走らないこと」を確認するために 20ms のリアル待機を使っている。vitest の `vi.useFakeTimers()` + `await Promise.resolve()` でマイクロタスク 1 周分だけ確認する方が将来のフラキーに強い。今の規模では許容範囲。

## Validation Results

| Check      | Result                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| Type check | **Pass** (`tsc --noEmit` — 0 errors。`.next/types` の stale キャッシュ経由で email-link の偽陽性が出る場合は `rm -rf .next` で解消済み) |
| Lint       | **Pass** (`next lint` — 0 warnings / 0 errors)                                                          |
| Tests      | **Pass** (vitest: 296 tests / 17 files — +40 tests vs develop)                                          |
| Build      | **Pass** (`next build` — 13 routes, `/auth/email-link` 消失を確認)                                        |
| Coverage   | **Pass**（全ファイル 80%+。`src/lib` 合計 97.63% stmt / 89.6% branch / 100% funcs / 97.63% lines）          |

## Files Reviewed

| File                                                                | Change   | Notes                                                         |
| ------------------------------------------------------------------- | -------- | ------------------------------------------------------------- |
| `src/app/page.tsx`                                                  | Modified | Client Component 化 + 未ログイン時の簡素化                       |
| `src/components/auth/AuthBadge.tsx`                                 | Modified | label を displayName 優先表示へ                                 |
| `src/app/groups/[gid]/group-detail-client.tsx`                      | Modified | トーナメント / ストラクチャ遷移ボタン追加                          |
| `src/components/tournament/TimerControls.tsx`                       | Modified | setup 分岐に「自分も参加する」ボタン追加                          |
| `src/components/tournament/WinnerBanner.tsx`                        | Added    | Winner バナー UI。`aria-live="polite"` + emoji は `aria-hidden` |
| `src/app/tournaments/[tid]/dashboard-client.tsx`                    | Modified | WinnerBanner 描画 + auto-finish effect（MEDIUM 指摘あり）        |
| `src/app/tournaments/[tid]/live/live-client.tsx`                    | Modified | players 全量保持 + 匿名自己削除 effect                           |
| `src/app/tournaments/[tid]/live/live-client.test.tsx`               | Modified | Winner / 匿名自己削除テスト 7 件追加                             |
| `src/lib/services/timer.ts`                                         | Modified | `resolveWinner(tournament, players)` helper 追加                |
| `src/lib/services/auth-actions.ts`                                  | Modified | Email Link 関連全削除、`logout` を匿名対応に拡張                  |
| `src/lib/services/auth-actions.test.ts`                             | Modified | Email Link テスト削除、匿名 logout 経路追加                      |
| `src/lib/services/receipt.ts`                                       | Modified | Email Link export 削除、`cancelOwnEntry` 匿名対応                |
| `src/lib/services/receipt.test.ts`                                  | Modified | Email Link mock 削除、匿名ケース + `joinAsExistingUser` ほか追加  |
| `src/lib/firebase/repositories/users.ts`                            | Modified | `deleteUserProfile(uid)` 追加                                   |
| `src/app/login/login-client.tsx`                                    | Modified | Email Link タブ / state 削除                                     |
| `src/app/join/[tid]/join-client.tsx`                                | Modified | Email Link タブ / state 削除                                     |
| `src/app/auth/email-link/page.tsx`                                  | Deleted  | Email Link ルート削除                                            |
| `src/app/auth/email-link/email-link-client.tsx`                     | Deleted  | Email Link client 削除                                           |
| `src/lib/services/seating/orchestrator.test.ts`                     | Modified | カバレッジ補完：wrapper 3 + skipReason 12 テスト追加              |
| `src/lib/logger.test.ts`                                            | Added    | 12 テスト（level 分岐網羅）                                       |
| `.claude/PRPs/prds/allin-timer.prd.md`                              | Modified | Phase 4.5 行を `complete` に更新                                 |
| `.claude/PRPs/plans/phase-4.5-pre-phase5-improvements.plan.md`      | Renamed  | → `completed/` へアーカイブ                                     |
| `.claude/PRPs/reports/phase-4.5-pre-phase5-improvements-report.md`  | Added    | 実装レポート                                                     |

## Security / Pattern Compliance Notes

- **秘密情報の残留なし**: `grep -r "emailLink|email-link|apiKey|secret|token"` で src/ はクリーン、残るのは外部ライブラリ型定義内の一致のみ。
- **Firestore rules 変更なし**: `users/{uid}` は既存 `request.auth.uid == uid` で self-delete を許可済みだったため追加変更不要。
- **[.claude/rules/firebase-patterns.md](.claude/rules/firebase-patterns.md) 準拠**: repositories 層経由の CRUD、zodConverter 適用、`AppError.from` ラップ、logger 経由出力。
- **[.claude/rules/error-logging.md](.claude/rules/error-logging.md) 準拠**: `try/catch` 握りつぶしなし、`console.*` 直呼出しなし。匿名自己削除の best-effort 失敗も `logger.warn` で記録。
- **[.claude/rules/security.md](.claude/rules/security.md) 準拠**: 環境変数 / 認証情報の追加・露出なし。招待コード関連の改変もなし。

## Decision

**APPROVE with comments.**

`CRITICAL`/`HIGH` なし。`MEDIUM` 2 件は Phase 5 のドライラン結果次第でアジャストできる UX / refactor の範疇で、ブロッカーにはしない。コミット / PR 作成してよい。

## Next Steps

- [ ] `/prp-commit` または `/prp-pr` で develop へコミット
- [ ] Phase 5 ドライラン後、MEDIUM 指摘 1（auto-finish 依存）の体感をフィードバックに含めるか判断
- [ ] Phase 4.6（Member Role Split）着手前に、Phase 5 の具体的なテストシナリオ plan を `/prp-plan` で生成
