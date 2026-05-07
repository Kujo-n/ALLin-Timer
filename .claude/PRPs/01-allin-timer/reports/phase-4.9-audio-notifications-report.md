# Implementation Report: Phase 4.9 — Audio Notifications (Default Sounds)

## Summary

ブラインドレベル変更／優勝者確定の 2 イベントで音声通知を行う段階1を実装した。**デフォルト音源 2 種類（mp3 + ogg/vorbis、levelUp / winner で別ファイル）+ group 単位の on/off と音量 + ロールベース再生（owner / organizer のみ）+ autoplay unlock 明示ボタン**を `/tournaments/{tid}` ダッシュボードと `/tournaments/{tid}/live` で再生する。Firebase Storage は導入していない（Phase 4.10 で対応）。

実装は plan どおり 16 タスクを完遂し、Firestore Rules への organizer-only `audioSettings` 書換 branch 追加、`groups/{gid}.audioSettings` の additive zod schema 拡張、`useAudioPlayer` フック新設、`SoundUnlockBanner` コンポーネント、`/groups/{gid}/audio-settings` 設定ページを含む。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual         |
| ------------- | ---------------- | -------------- |
| Complexity    | Medium-Large     | Medium-Large   |
| Confidence    | -                | High           |
| Files Changed | 約 16 ファイル    | 17 ファイル（音源 4 + 新規 7 + 編集 6）|

## Tasks Completed

| #   | Task                                                | Status          | Notes                                                   |
| --- | --------------------------------------------------- | --------------- | ------------------------------------------------------- |
| 1   | デフォルト音源ファイル配置確認                        | Complete        | 4 ファイル（mp3 2 + ogg 2）が `public/sounds/` にあり   |
| 2   | zod schema 拡張（audioSettings additive）             | Complete        | `audioSettingsSchema` / `DEFAULT_AUDIO_SETTINGS` 追加   |
| 3   | repository 関数追加（updateAudioSettings）            | Complete        | object 一括上書き。zod safeParse による事前 validation  |
| 4   | Firestore Rules 拡張（organizer-only branch）         | Complete        | 既存 owner / self-add / self-leave / self-key の後に OR |
| 5   | sound-catalog.ts                                    | Complete        | 2 ソースを `[ogg, mp3]` 順で同梱（軽量 codec 優先）     |
| 6   | audio-context.ts ラッパー                            | Complete        | webkitAudioContext fallback / SSR ガード               |
| 7   | useAudioPlayer フック                                | Complete        | role filter + prevRef + state filter（setup 等を除外） |
| 8   | SoundUnlockBanner コンポーネント                     | Complete        | enabled=false の早期 return + unlock 後の縮小表示       |
| 9   | Audio Settings ページ + クライアント                 | Complete        | RequireAuth(allowAnonymous=false) + role 判定 + redirect |
| 10  | dashboard-client / live-client への組み込み          | Complete        | live は groupId に対応する group を `groups.find` で解決 |
| 11  | group-detail-client にサウンド設定リンク追加          | Complete        | organizer 以上にのみ表示                                |
| 12  | schema test（audioSettings default / 範囲外検出）    | Complete        | 4 件追加（legacy doc 受容 / explicit / 範囲外 / 空ID） |
| 13  | repository test（updateAudioSettings）              | Complete        | 3 件追加（正常 / 範囲外で early throw / SDK エラー wrap）|
| 14  | useAudioPlayer test                                  | Complete        | 12 件追加（role filter / 初回 mount / 重複 emit 等）   |
| 15  | PRD Phase 4.9 status 更新                            | Complete        | `in-progress` → `complete`、レポートリンク追加         |
| 16  | rules deploy（最終工程）                             | **未実施**      | 本実装ではコード変更のみ。emulator / 本番 deploy は運営者側で実施想定 |

## Validation Results

| Level           | Status      | Notes                                           |
| --------------- | ----------- | ----------------------------------------------- |
| Static Analysis | Pass        | `tsc --noEmit` zero errors                      |
| Lint            | Pass        | `next lint` zero warnings                       |
| Unit Tests      | Pass        | 全 430 件（既存 411 + 新規 19 件）              |
| Build           | Pass        | `/groups/[gid]/audio-settings` ルートも生成成功 |
| Integration     | N/A         | emulator / 本番 deploy は運営者側で実施         |
| Edge Cases      | Pass        | 初回 mount で発火しない / 同 level 再 emit / setup 状態 / role filter / enabled=false / unlock 前 |

## Files Changed

| File                                                                  | Action  | 概要                                                          |
| --------------------------------------------------------------------- | ------- | ------------------------------------------------------------- |
| `public/sounds/blind-up.mp3`                                          | ADDED   | 62KB（運営者調達）                                            |
| `public/sounds/blind-up.ogg`                                          | ADDED   | 25KB（ffmpeg `libvorbis -q:a 4` 変換）                       |
| `public/sounds/victory-chime.mp3`                                     | ADDED   | 23KB（運営者調達）                                            |
| `public/sounds/victory-chime.ogg`                                     | ADDED   | 13KB（ffmpeg `libvorbis -q:a 4` 変換）                       |
| `src/lib/firebase/schemas/group.ts`                                   | UPDATED | `audioSettingsSchema` / `DEFAULT_AUDIO_SETTINGS` 追加         |
| `src/lib/firebase/repositories/groups.ts`                             | UPDATED | `updateAudioSettings` / `createGroup` で `audioSettings` 同期 |
| `firestore.rules`                                                     | UPDATED | organizer-only `audioSettings` 書換 branch を追加             |
| `src/lib/audio/sound-catalog.ts`                                      | CREATED | 音源 ID → URL マッピング                                      |
| `src/lib/audio/audio-context.ts`                                      | CREATED | AudioContext 薄ラッパー（autoplay unlock 用）                 |
| `src/lib/hooks/useAudioPlayer.ts`                                     | CREATED | tournament/group/role を引数に取る再生フック                  |
| `src/components/audio/SoundUnlockBanner.tsx`                          | CREATED | 「サウンドを有効化」明示 UI                                   |
| `src/app/groups/[gid]/audio-settings/page.tsx`                        | CREATED | server entry / RequireAuth gate                              |
| `src/app/groups/[gid]/audio-settings/audio-settings-client.tsx`       | CREATED | フォーム本体（enabled / soundId / volume / 試聴 / 保存）     |
| `src/app/tournaments/[tid]/dashboard-client.tsx`                      | UPDATED | `useAudioPlayer` + `SoundUnlockBanner` 統合                  |
| `src/app/tournaments/[tid]/live/live-client.tsx`                      | UPDATED | 同上（運営者投影向け）                                        |
| `src/app/groups/[gid]/group-detail-client.tsx`                        | UPDATED | 「サウンド設定」ボタン追加                                    |
| `src/lib/firebase/schemas/index.test.ts`                              | UPDATED | audioSettings の zod default / explicit / 範囲外テスト        |
| `src/lib/firebase/repositories/groups.test.ts`                        | UPDATED | `updateAudioSettings` 3 件のテスト                            |
| `src/lib/services/group.test.ts`                                      | UPDATED | makeGroup factory に audioSettings を追加                     |
| `src/lib/hooks/useAudioPlayer.test.tsx`                               | CREATED | 12 件のテスト（role / mount / 重複 emit / winner 検知）      |
| `src/app/tournaments/[tid]/live/live-client.test.tsx`                 | UPDATED | `useCurrentGroup` mock 追加                                   |
| `.claude/PRPs/prds/allin-timer.prd.md`                                | UPDATED | Phase 4.9 行を complete に更新                                |

## Deviations from Plan

- **音源 1 種類 → 2 種類**: 当初 plan は default:bell 1 種類で levelUp / winner 兼用だったが、運営者が `blind-up.mp3` / `victory-chime.mp3` を別調達したため、catalog を 2 件・schema の `DEFAULT_AUDIO_SETTINGS` も別 ID 割当（`default:blind-up` / `default:victory-chime`）に変更。UX が向上（音で 2 イベントを区別可能）。
- **`preview()` の sync block 維持**: iOS Safari の AudioContext.resume() は user gesture と同じ event loop 内で sync 呼出する必要がある。当初 plan の `preview = await unlock(); await play(...)` 経路では unlocked state が次レンダで反映されるため `play()` の `unlocked` ガードに引っかかる。preview 専用 fast-path を `unlock` 直後に inline で再実装し、user gesture chain を維持。
- **dashboard-client での hook 配置**: hooks の呼び出し順を一定に保つため、useAudioPlayer は早期 return より前で呼ぶ必要があった。`tournamentGroup` / `audioRole` 計算をローカル変数で前倒しし、render 内で再度 `currentGroup` を参照する形にした（既存 `currentGroup` 名と重複しないよう audio 用は `tournamentGroup` という別名を使用）。
- **rule の `memberDisplayNames` 比較**: plan では `.get('memberDisplayNames', {})` 同士の `==` 比較。rule 評価コストは `.diff().affectedKeys().hasOnly([])` を使う方式と同等で、可読性のため `==` 直接比較を採用。
- **rules deploy（Task 16）は本実装に含めない**: emulator / 本番 deploy は運営者側で行う想定。コード変更のみ完了。

## Issues Encountered

- **typecheck**: zod schema に required `audioSettings` を追加した結果、`createGroup` の addDoc body に audioSettings が必須となった。`DEFAULT_AUDIO_SETTINGS` を新規 group 作成時に明示的に渡す形で解決。あわせて `schemas/index.test.ts` と `services/group.test.ts` の `makeGroup` ファクトリにも `audioSettings` を追加。
- **live-client.test.tsx**: live-client.tsx に `useCurrentGroup` import を追加した結果、test の transitive import で firebase client init が走り `firebase/config-missing` で失敗。既存パターンに従い `vi.mock("@/lib/services/current-group", ...)` を追加して解決。
- **AppError 3rd 引数型**: `parsed.error` を AppError コンストラクタの cause に渡す形を当初試したが、AppError の cause 型は `unknown`。最終的にはメッセージ + code のみで作成し、parsed.error 中身は zod 自体のメッセージを利用しないシンプル形で運用（unit test 側で確認できているため十分）。

## Tests Written

| Test File                                            | Tests   | Coverage                                                     |
| ---------------------------------------------------- | ------- | ------------------------------------------------------------ |
| `src/lib/firebase/schemas/index.test.ts`             | +4 件   | audioSettings legacy doc / explicit / 範囲外 / 空 soundId   |
| `src/lib/firebase/repositories/groups.test.ts`       | +3 件   | updateAudioSettings 正常 / range 違反 / SDK エラー wrap     |
| `src/lib/hooks/useAudioPlayer.test.tsx`              | +12 件  | role filter / 初回 mount / 同 level 再 emit / setup 状態 / unlock 状態 / winner 検知 |

合計 **+19 件** の新規テスト。既存 411 件と合わせ全 430 件 pass。

## Next Steps

- [ ] ローカル emulator で organizer / member / 非メンバーから `audioSettings` 更新を試行し、4 ロール × 2 操作の matrix を検証
- [ ] `firebase deploy --only firestore:rules` で本番 rule を反映
- [ ] iOS Safari / Chrome / Firefox 実機で unlock & 再生動作確認
- [ ] Phase 4.10（カスタム音源 + Firebase Storage）の plan 起票検討
- [ ] 音源ライセンスの出典確認（運営者側、Phase 5 投入前）
