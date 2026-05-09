# Implementation Report: Phase D — Install Promotion & Polish

## Summary

Phase A〜C で整えた PWA 基盤の最後の仕上げとして、トップ画面 `/` のみに集約した PWA インストール促進 UI と Service Worker cache の運用ハードニングを実装した。

- **`<PwaInstallPromotion />`** — Android Chrome 系の `beforeinstallprompt` を capture / preventDefault し、カスタムバナーから `prompt()` を起動。`appinstalled` 受信で永続 hide。`localStorage["allinpt.pwaInstallDismissedAt"]` で 30 日 TTL の dismiss 永続化。
- **`<IOsInstallHint />` の dismiss 化と移動** — 既存 hint に「今は閉じる」を追加し、`PwaInstallPromotion` と同 storage key で 30 日 dismiss 永続化。`app/layout.tsx` から除去し `app/page.tsx` に移設してトップ画面のみで表示する設計に切替（role gating は導入せず mount 点限定で fan-out を抑制）。
- **`public/sw.js` ハードニング** — `NAVIGATE_CACHE_ALLOWLIST = ["/", "/login"]` で auth-aware path を runtime cache に積まないよう制御（M3 / S-M1）。`MAX_RUNTIME_ENTRIES = 50` で `cache.put` 直後に fire-and-forget の `trimCache` を回し最古から間引く（M2 / S-M2）。`CACHE_VERSION` を `"v1"` → `"v2"` に bump し、既存 install 端末で旧 cache を activate 時に全消し。

これで Phase A レビュー / Security review で残っていた M2 / M3 / S-M1 / S-M2 を解消し、PRD 03 のスコープを完了させる。CSP / security headers の追加（S-L1）は別 PR スコープとして引き続き未対応のまま。

## Assessment vs Reality

| Metric        | Predicted (Plan)        | Actual                              |
| ------------- | ----------------------- | ----------------------------------- |
| Complexity    | Medium                  | Medium                              |
| Confidence    | Medium-High             | High                                |
| Files Changed | 約 8 files              | 7 files (2 new + 5 update) + report |

## Tasks Completed

| #   | Task                                                        | Status   | Notes                                                                                          |
| --- | ----------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| 1   | `PwaInstallPromotion` コンポーネント作成                    | Complete | structural type alias `BeforeInstallPromptEvent`、role gating なし、prompt 失敗時も AppError + warn |
| 2   | `PwaInstallPromotion` 単体テスト（9 件）                    | Complete | event 未捕捉 / capture+preventDefault / accepted / dismissed / appinstalled / 5d / 31d / dismiss / private mode |
| 3   | `public/sw.js` の path allowlist + LRU + CACHE_VERSION bump | Complete | `NAVIGATE_CACHE_ALLOWLIST` / `trimCache` 追加、`v1` → `v2` 切替                                 |
| 4   | `IOsInstallHint` に dismiss 経路を追加                      | Complete | 「今は閉じる」ボタン追加、`PwaInstallPromotion` と同 storage key を共有                         |
| 5   | `IOsInstallHint.test.tsx` の dismiss ケース追加（4→7 件）   | Complete | 既存 4 件 + dismiss / 5d 抑止 / 31d 復帰 の 3 件追加                                            |
| 6   | `app/layout.tsx` から install hint 除去 + `app/page.tsx` に mount | Complete | `<IOsInstallHint />` import 削除、トップ画面に `<PwaInstallPromotion />` と並列 mount      |
| 7   | PRD 表更新 + 実装レポート作成                                | Complete | Phase D を `complete` に、本 report を生成                                                     |
| 8   | 観測フェーズ準備（手動検証チェックリスト）                  | Complete | 本 report の末尾に「実機検証ログ（TODO）」を設置                                              |

## Validation Results

| Level           | Status | Notes                                                                                          |
| --------------- | ------ | ---------------------------------------------------------------------------------------------- |
| Static Analysis | Pass   | `tsc --noEmit` 0 errors                                                                        |
| Lint            | Pass   | `next lint` 0 warnings / 0 errors                                                              |
| Unit Tests      | Pass   | 1194 件全 pass（Phase D 新規 12 件: PwaInstallPromotion 9 + IOsInstallHint dismiss 3）         |
| Build           | Pass   | `next build` Compiled successfully、SSR build error なし、`/manifest.webmanifest` static       |
| Edge Cases      | Pass   | SSR / 30 日 TTL 境界（5d / 31d）/ accepted vs dismissed / appinstalled / private mode 全て test 化 |

## Files Changed

| File                                                | Action  | Lines    |
| --------------------------------------------------- | ------- | -------- |
| `src/components/pwa/PwaInstallPromotion.tsx`        | CREATE  | +172     |
| `src/components/pwa/PwaInstallPromotion.test.tsx`   | CREATE  | +216     |
| `src/components/pwa/IOsInstallHint.tsx`             | UPDATE  | +79 / -33 |
| `src/components/pwa/IOsInstallHint.test.tsx`        | UPDATE  | +67 / -16 |
| `public/sw.js`                                      | UPDATE  | +52 / -10 |
| `src/app/page.tsx`                                  | UPDATE  | +54 / -34 |
| `src/app/layout.tsx`                                | UPDATE  | -2       |
| `.claude/PRPs/03-pwa-app-shell/prds/03-pwa-app-shell.prd.md` | UPDATE | +1 / -1 |

## Deviations from Plan

| What                                                                                       | Why                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onInstallClick` で `event.prompt()` 失敗時にも `persistDismissedAt` で 30 日 TTL に乗せる | 想定外のブラウザ実装で `prompt()` が reject するケースで毎回ボタンを出し続けると UX が荒れるため、失敗時も dismiss として扱う方が安全。warn ログは出るので開発者は気付ける       |
| `IOsInstallHint` の dismiss 共有 helper を `install-dismiss.ts` に抽出せず、両 component 内に inline 配置 | 計画 NOTE で「最初は inline で OK、必要なら抽出」と明記済み。実装後に DRY 不足と感じれば次回 architect-refactor で集約する判断（YAGNI）                                       |
| `PwaInstallPromotion` テスト 9 件（plan は 6〜9 想定で揺らぎ）                               | Plan の Testing Strategy 表で 9 ケース想定が書かれていたためそれに合わせた                                                                                                       |

その他、既存テスト件数（plan で「1149 件 + 約 11 件」と記載）→ 実際は 1194 件 pass。Phase B / C の追加 / 既存 test 拡張で baseline が増えていたため。Phase D 由来の新規は 12 件（PwaInstallPromotion 9 + IOsInstallHint 追加 3）。

## Issues Encountered

なし。Tier 1 検証（typecheck / lint / test / build）は全て一発 green。`npx vitest` ではなく `npm test` の使い方に倒すフィードバックを反映した（プロジェクトの settings.json で npx は ask モード）。

## Tests Written

| Test File                                          | Tests | Coverage                                                                                                  |
| -------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------- |
| `src/components/pwa/PwaInstallPromotion.test.tsx`  | 9     | event 未捕捉 / capture+preventDefault / accepted / dismissed / 「今は閉じる」/ appinstalled / 5d / 31d / private mode |
| `src/components/pwa/IOsInstallHint.test.tsx`       | 7（既存 4 + 追加 3） | 既存 UA / standalone / iPad fallback + 「今は閉じる」/ 5d 抑止 / 31d 復帰                                 |

## Acceptance Criteria

- [x] `<PwaInstallPromotion />` がトップ画面 `/` のみで mount され、role gating なしで `beforeinstallprompt` capture 時に表示される
- [x] custom button から `prompt()` を発火可能、`appinstalled` で banner 自動 hide
- [x] dismiss / appinstalled で `localStorage["allinpt.pwaInstallDismissedAt"]` を更新し、30 日内は再表示しない
- [x] `<IOsInstallHint />` も `app/layout.tsx` から除去され `app/page.tsx` に移設される（mount 点はトップ画面のみ）
- [x] `<IOsInstallHint />` に「今は閉じる」ボタンを追加し、PwaInstallPromotion と同 storage key で 30 日 dismiss 永続化
- [x] Phase A の TODO コメント（"useGroupRole で role !== "member" のときのみ表示する gating を追加"）が削除され、新コメントで mount 点限定の設計が明記される
- [x] `public/sw.js` の `networkFirst` が `NAVIGATE_CACHE_ALLOWLIST`（`/` と `/login`）以外を cache に積まない
- [x] `RUNTIME_CACHE` が 50 entry 上限で最古から間引かれる
- [x] `CACHE_VERSION` を `v2` に bump し、既存 install 端末で旧 cache が活性化時に削除される
- [x] PWA 関連の test ファイルが pass（PwaInstallPromotion / IOsInstallHint）
- [x] `npm run typecheck` / `npm run lint` / `npm run build` 全 green
- [x] PRD の Implementation Phases 表で Phase D が `complete` と plan link が記載される
- [x] 実装レポート（本ファイル）が生成される

## 実機検証ログ（TODO — 担当者が記入）

開発者サークル参加時 / 運営者ヒアリング時の検証チェックリスト。本 Phase 完了の判定は「実装＋テスト green」までで、観測フェーズの完了は別軸（PRD Success Metrics の真実源）。

### Android Chrome（実機 / DevTools 模擬）

- [ ] トップ画面 `/` 訪問 → `beforeinstallprompt` capture → カスタムバナー表示
- [ ] 「ホーム画面に追加」 click → `prompt()` 起動 → accepted → `appinstalled` 受信で banner 消える
- [ ] 「今は閉じる」 click → 30 日以内の再訪問でバナーが出ない（`localStorage` 永続化動作確認）
- [ ] PWA install 後の起動で SW navigate cache に `/groups/...` / `/tournaments/...` が**乗っていない** ことを DevTools Cache Storage で確認
- [ ] 同 cache が 50 件超で最古から間引かれること（手動で `/_next/static/*` を 50+ 件 fetch）
- [ ] `/login` / `/` の navigate は引き続き runtime cache に積まれること
- [ ] CACHE_VERSION bump で旧 `allin-runtime-v1` が activate 時に削除され、`allin-runtime-v2` に切替わっていること

### iOS Safari 実機

- [ ] トップ画面 `/` を開いて `IOsInstallHint` が表示される
- [ ] 「今は閉じる」 click → 30 日以内の再訪問で hint が出ない
- [ ] `/groups/[gid]` / `/tournaments/[tid]` / `/login` 等で install hint / promotion が**一切出ない**こと（mount 点限定の確認）
- [ ] ホーム画面に追加 → standalone 起動でも hint が出ないこと（既存 standalone 検出の維持）

### 共通

- [ ] member ロールの参加者端末でトップ画面 `/` を開き、role gating なしで promotion / hint が表示されること（誤表示でも dismiss するだけのコスト低）
- [ ] auto-advance fallback（Phase B）は network throttling Offline で動作することを目視確認（Phase D 独立だが回帰確認のため）
- [ ] Wake Lock + orientation lock（Phase C）が dashboard / live で動作すること（同上）

## Next Steps

- [ ] Code review via `/code-review`
- [ ] Security review via `/security-review`（特に SW allowlist の漏れ確認）
- [ ] Create PR via `/prp-pr`
- [ ] PR マージ後、Vercel 本番 deploy で実機検証ログを実施
- [ ] PRD 03 完了に伴い、CSP / security headers（S-L1）の別 PR を起票するか判断
