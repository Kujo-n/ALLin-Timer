# Implementation Report: Track D — Chic Dark Theme & Theme Toggle (Phase D.1)

## Summary

post-launch-polish PRD の Track D / Phase D.1 を実装。`globals.css` の `.dark`
パレットを「深ネイビー + 暖色シルバー + 銀アクセント」の chic 配色に塗替え、
`localStorage["allinpt.theme"]` を真実源とする個人 preference 型の `ThemeProvider`
を **手動実装（依存追加なし）** で導入した。トグル UI は `/settings` 画面に新規「テーマ」
Card として集約し、サイドバー footer / ヘッダー / 他画面には配置していない。

FOUC 防止のため `<head>` 直下に inline script を出力し、`<html suppressHydrationWarning>`
と組み合わせて hydration 前に `.dark` class を確定する。`viewport.themeColor` は
light/dark の 2 値に分割。`error-logging.md` の prefix 一覧に `theme/*` を追加。

OG SSR route / `firestore.rules` / DB schema / `groups/{gid}` schema / `PrimaryNav.tsx`
への変更ゼロ。

## Assessment vs Reality

| Metric        | Predicted (Plan)        | Actual                              |
| ------------- | ----------------------- | ----------------------------------- |
| Complexity    | Medium-Large（10〜13 ファイル / ~400 行） | 13 ファイル / 318 行追加 / 61 行削除（diff stat 由来） |
| Confidence    | High（既存 shadcn dark token 経由 + 手動 ThemeProvider は < 100 行） | High（手動実装で意図通りに完結） |
| Files Changed | 新規 6 / 改修 7〜9                                                                                  | 新規 6 / 改修 7 |

## Tasks Completed

| #   | Task                                                            | Status     | Notes |
| --- | --------------------------------------------------------------- | ---------- | --- |
| 1   | chic dark palette を `globals.css` に確定                       | [done] 完了 | HSL スペース区切りで塗替え、コメントで意図を残す |
| 2   | localStorage helper（`theme-storage.ts`）を新規追加              | [done] 完了 | SSR ガード / `theme/invalid-value` / `theme/storage-failed` を logger.warn 経由で実装 |
| 3   | ThemeProvider 実装（`theme.tsx`）                                | [done] 完了 | `system` モード時のみ matchMedia listener を attach する guard 込み |
| 4   | FOUC 防止 inline script + Provider 挿入（`layout.tsx`）          | [done] 完了 | ThemeProvider は **AuthProvider の外側** に配置 |
| 5   | ThemeToggle UI 実装（`ThemeToggle.tsx`）                         | [done] 完了 | `role="radiogroup"` + 各 button に `role="radio"` / `aria-checked` / `aria-label` |
| 6   | ThemeToggle を `/settings` 画面に Card として配置                | [done] 完了 | 「アカウント設定」Card の下に additive 追加 + 説明文「設定はこの端末にのみ保存されます」 |
| 7   | ハードコード色の dark variant 補完                               | [done] 完了 | QR `bg-white` × 3 箇所を `bg-card` に置換。WinnerBanner は既存で dark variant 両端揃いのため無変更 |
| 8   | PWA manifest と error-logging.md の更新                          | [done] 完了 | `background_color` を `#0E1422` に / `theme/*` prefix 追記 |
| 9   | 単体テスト追加（新規 3 ファイル）                                 | [done] 完了 | theme-storage 11 件 / theme 9 件 / ThemeToggle 6 件 = 26 件追加 |
| 10  | PRD 更新（Phase D.1 詳細 + Decisions Log）                       | [done] 完了 | Implementation Phases の D.1 行を `complete` / Status footer も `complete` に更新。Phase D.1 詳細と Decisions Log は plan 作成時点で既に最終方針と一致しており追記不要 |

## Validation Results

| Level           | Status      | Notes |
| --------------- | ----------- | --- |
| Static Analysis | [done] Pass | `npm run typecheck` 0 error / `npm run lint` 0 warning |
| Unit Tests      | [done] Pass | 全 86 ファイル 1409 件 green（新規 3 ファイル 26 件含む） |
| Build           | [done] Pass | `npm run build` 成功 / 16 static pages / `/manifest.webmanifest` 生成 |
| Integration     | N/A         | UI 機能のためブラウザ手動確認に委譲（plan の Manual Validation チェックリストに記載） |
| Edge Cases      | [done] Pass | jsdom matchMedia stub / SSR ガード / quota 例外 / 不正値 fallback / Provider 外 throw を unit test でカバー |

## Files Changed

### 新規ファイル

| File                                                | Action  | Lines |
| --------------------------------------------------- | ------- | ----- |
| `src/lib/services/theme-storage.ts`                 | CREATED | +63   |
| `src/lib/services/theme-storage.test.ts`            | CREATED | +96   |
| `src/lib/services/theme.tsx`                        | CREATED | +97   |
| `src/lib/services/theme.test.tsx`                   | CREATED | +143  |
| `src/components/theme/ThemeToggle.tsx`              | CREATED | +56   |
| `src/components/theme/ThemeToggle.test.tsx`         | CREATED | +93   |

### 改修ファイル

| File                                                            | Action  | Notes |
| --------------------------------------------------------------- | ------- | --- |
| `src/app/globals.css`                                           | UPDATED | `.dark` パレット塗替え（chic palette） |
| `src/app/layout.tsx`                                            | UPDATED | inline FOUC script + `<html suppressHydrationWarning>` + viewport.themeColor 2 値化 + ThemeProvider 挿入 |
| `src/app/settings/settings-client.tsx`                          | UPDATED | 「テーマ」Card を additive 追加 |
| `src/app/manifest.ts`                                           | UPDATED | `background_color` を `#0E1422` に変更 + コメント更新 |
| `src/components/qr/QrPanel.tsx`                                 | UPDATED | wrapper `bg-white` → `bg-card` |
| `src/app/groups/[gid]/_components/InviteCodeCard.tsx`           | UPDATED | wrapper `bg-white` → `bg-card` |
| `src/components/tournament/SpectateModeCard.tsx`                | UPDATED | wrapper `bg-white` → `bg-card` |
| `.claude/rules/error-logging.md`                                | UPDATED | prefix 一覧に `theme/*` 追加 |
| `.claude/PRPs/05-post-launch-polish/prds/05-post-launch-polish.prd.md` | UPDATED | D.1 行を `complete` / Status footer 更新 |

## Deviations from Plan

1. **`WinnerBanner.tsx` は無変更**。plan は `to-yellow-200` に dark variant 補完を指示
   していたが、現在の実装は既に `dark:from-amber-900/40 dark:to-yellow-900/40` の両端
   揃いで完備していた。grep でも `to-yellow-200` は WinnerBanner 1 箇所のみで他に欠落
   なしを確認。
2. **PRD の Phase D.1 詳細と Decisions Log は追記なし**で `complete` status 化のみ。
   plan 作成時点（2026-05-13 第 3 次転換後）の PRD が既に「個人単位 / `/settings` 集約」
   方針と完全一致しており、書換対象が status 行と footer の 2 箇所のみだった。
3. **`/settings` が signed-in 必須という plan 前提との差異**: 現状の
   `src/app/settings/page.tsx` は `<RequireAuth allowAnonymous>` で **匿名ユーザーも
   到達可能**な設定。これは plan が前提とした `allowAnonymous=false` と異なるが、
   ThemeProvider 自体は全画面で動作するため UI 破綻はなく、匿名ユーザーも
   `/settings` 経由で明示切替できる挙動になる（plan の想定より広い経路で機能する）。
   `settings/page.tsx` は本 plan の touch 対象外のためそのまま据置。
4. **QR fgColor / bgColor の明示指定はしない**。plan の Risks にあった「カメラ読取性
   低下」防御として一瞬 `fgColor="#000000" bgColor="#ffffff"` を明示する誘惑が
   あったが、plan は明示的に「`qrcode.react` の `bgColor`/`fgColor` プロパティは
   触らない」と書いており、qrcode.react の default が `#000/#fff` のため wrapper
   のみ `bg-card` 化で完了。

## Issues Encountered

なし。typecheck / lint / test / build はすべて初回から green。

## Tests Written

| Test File                                       | Tests  | Coverage |
| ----------------------------------------------- | ------ | --- |
| `src/lib/services/theme-storage.test.ts`        | 11     | readTheme（未保存 / 各値 / 不正値 / storage 例外 / SSR）+ writeTheme（write / 上書き / quota 例外 / SSR） |
| `src/lib/services/theme.test.tsx`               | 9      | 初期値 / system + OS dark / setTheme dark / setTheme light / matchMedia change 追従 / 明示選択後の listener detach / 保存値 hydrate / Provider 外 throw / children render |
| `src/components/theme/ThemeToggle.test.tsx`     | 6      | radiogroup role + aria-label / 3 radio render / 初期 system active / dark click → state 反映 + localStorage + html.dark / light click → html.dark 外れる / system click |

合計 **26 件追加** / 全テスト suite 1409 件 green。

## Next Steps

- [ ] Code review via `/code-review`
- [ ] Manual browser verification per plan の Validation Commands / Manual Validation チェックリスト（初回ロード FOUC / dark UI 切替 / リロード preference 保持 / PWA standalone chrome 色 / モバイル OS 切替追従 等）
- [ ] Create PR via `/prp-pr`
- [ ] 必要であれば D.2（ヘッダ右側の最小トグル / アクセント金色 hsl(40 60% 55%) 等）の検討
