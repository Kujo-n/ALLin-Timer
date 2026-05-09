# Implementation Report: Phase 4 — PWA Cache Allowlist 追加（観戦モード）

## Summary

`public/sw.js` の `NAVIGATE_CACHE_ALLOWLIST` に `/spectate` を additive 追加し、`CACHE_VERSION` を `v2` → `v3` に bump。新規 navigate `/spectate/{tid}` が `RUNTIME_CACHE` に network-first で積まれ、会場 Wi-Fi 瞬断時にも直前 HTML を cache から返せるようになった。`shouldCacheNavigate` の挙動は新設 unit test (`src/lib/sw/sw-allowlist.test.ts`) で 18 ケース pin（drift 検出 1 + allow 6 + deny 10 + 末尾 root sensitivity 1）。E2E 側の Phase D static contract spec (`tests/e2e/phase-d-install-promotion.spec.ts`) の `CACHE_VERSION` regex と `NAVIGATE_CACHE_ALLOWLIST` regex を `v3` / `/spectate` 含みに同期。Phase 4 は SW 層のみで Firestore Rules / schema / repository / service / UI 変更なし。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual         |
| ------------- | ---------------- | -------------- |
| Complexity    | Small            | Small          |
| Confidence    | high             | high           |
| Files Changed | 約 5 files       | 5 files        |

## Tasks Completed

| #   | Task                                                                            | Status        | Notes                                                                                              |
| --- | ------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------- |
| 1   | `public/sw.js` の `NAVIGATE_CACHE_ALLOWLIST` に `/spectate` 追加 + `CACHE_VERSION` bump | [done] 完了   | 既存末尾追加 + Phase 4 説明コメント 1 ブロック追加。`shouldCacheNavigate` 関数本体は無変更         |
| 2   | `src/lib/sw/sw-allowlist.test.ts` を新設し `shouldCacheNavigate` の挙動を pin     | [done] 完了   | 18 ケース全 green。`__dirname` ではなく `fileURLToPath(import.meta.url)` で ESM 互換を確保         |
| 3   | `tests/e2e/phase-d-install-promotion.spec.ts` の static contract regex を Phase 4 に同期 | [done] 完了 | JSDoc / test title / `CACHE_VERSION` regex / `NAVIGATE_CACHE_ALLOWLIST` regex を同時更新           |
| 4   | PRD `04-spectate-mode.prd.md` の Phase 4 行ステータス更新                         | [done] 完了   | plan 作成時の `in-progress` 化は事前に済んでいたため、本実装完了で `complete` + report link を追加 |
| 5   | 実装レポート作成                                                                | [done] 完了   | 本ファイル                                                                                         |

## Validation Results

| Level                              | Status      | Notes                                            |
| ---------------------------------- | ----------- | ------------------------------------------------ |
| Static Analysis (typecheck)        | [done] Pass | 0 errors                                         |
| Lint (next lint)                   | [done] Pass | 0 warnings/errors                                |
| Unit Tests (vitest)                | [done] Pass | 1261/1261（74 files）。Phase 4 で +18 ケース      |
| Build (next build)                 | [done] Pass | static / dynamic 両 route 通過。`/spectate/[tid]` も dynamic で含まれる |
| E2E (phase-d-install-promotion)    | [done] Pass | 5/5（PWA install banner 4 + sw.js static contract 1） |
| Emulator: test:rules-spectate      | [done] Pass | 16/16（Phase 1 確立の rule contract に regression なし） |

## Files Changed

| File                                                            | Action  | Notes                                                                       |
| --------------------------------------------------------------- | ------- | --------------------------------------------------------------------------- |
| `public/sw.js`                                                  | UPDATE  | `CACHE_VERSION` v2→v3 / `NAVIGATE_CACHE_ALLOWLIST` 末尾に `/spectate` 追加 / Phase 4 コメント 2 ブロック追記 |
| `src/lib/sw/sw-allowlist.test.ts`                               | CREATE  | 18 ケースの `shouldCacheNavigate` 挙動 pin + allowlist drift check          |
| `tests/e2e/phase-d-install-promotion.spec.ts`                   | UPDATE  | static contract regex を `v3` / `/spectate` 含みに同期。JSDoc / test title も併せて更新 |
| `.claude/PRPs/04-spectate-mode/prds/04-spectate-mode.prd.md`    | UPDATE  | Phase 4 を `in-progress` → `complete` に遷移、report link 追加              |
| `.claude/PRPs/04-spectate-mode/reports/phase-4-pwa-cache-allowlist-report.md` | CREATE | 本ファイル                                                          |

## Deviations from Plan

### 軽微: unit test の `__dirname` 利用方針

- **WHAT**: plan の TEST_STRUCTURE 例は `__dirname` を直接使う形で書かれていた
- **WHY**: 本 codebase の `tsconfig.json` は `module: "esnext"` + `moduleResolution: "bundler"` で TS ESM。test ファイルも ESM として transform されるため、`__dirname` は CommonJS 専用変数として未定義
- **対応**: plan の GOTCHA で言及されていた `fileURLToPath(import.meta.url)` のフォールバックパターンを採用。`dirname(fileURLToPath(import.meta.url))` で test ファイル自身の絶対 path を解決し、`resolve(here, "../../../public/sw.js")` で SW を読み出す。動作は plan の想定どおり

### 軽微: PRD の Phase 4 行ステータスは plan 作成時点で既に `in-progress`

- **WHAT**: Task 4 は plan 作成時点では `pending` → `in-progress` の遷移を想定していたが、PRD 確認時に既に `in-progress` だった
- **WHY**: plan ファイル生成時に PRP-plan が PRD を `in-progress` 化済み
- **対応**: 本実装完了で `in-progress` → `complete` に遷移する更新のみ実施

## Issues Encountered

なし。validation 5 段すべて plan 想定どおりの 1 発 green。

## Tests Written

| Test File                                | Tests   | Coverage                                                              |
| ---------------------------------------- | ------- | --------------------------------------------------------------------- |
| `src/lib/sw/sw-allowlist.test.ts`        | 18      | NAVIGATE_CACHE_ALLOWLIST drift check (1) / shouldCacheNavigate allow (6) / shouldCacheNavigate deny (10) / root exact match sensitivity (1) |

ケース内訳:

- **drift check**: `NAVIGATE_CACHE_ALLOWLIST` が `["/", "/login", "/spectate"]` を superset として含むこと
- **allow 6 件**: `/`, `/login`, `/login/forgot-password`, `/spectate`, `/spectate/abc123def456`, `/spectate/t-1/sub`
- **deny 10 件**: `""`, `/foo`, `/spectatethief`（prefix 偽マッチ防止）, `/groups/g-1`, `/tournaments/t-1`, `/tournaments/t-1/live`, `/settings`, `/account`, `/structures/s-1`, `/join/t-1`
- **root sensitivity**: `shouldCacheNavigate("/")` is true / `shouldCacheNavigate("//")` is false（`p === "/" ? pathname === "/" : ...` の特例 pin）

## Next Steps

- [ ] code review (`/code-review`) でローカルレビューを実施し、CRITICAL / HIGH 指摘なしで merge 可能な状態に持ち込む
- [ ] PR 作成（`/prp-pr`）。PR タイトルは「feat: 観戦モード Phase 4 - PWA cache allowlist に /spectate を追加」相当
- [ ] Vercel preview / production deploy 後、Chrome DevTools の Application > Service Workers / Cache Storage で以下を実機確認:
  - 旧 `allin-shell-v2` / `allin-runtime-v2` が activate 時に削除されること
  - 新 `allin-shell-v3` / `allin-runtime-v3` が生成され、SHELL_URLS が precache されること
  - `/spectate/{tid}` を online で 1 回開いた後、`allin-runtime-v3` に navigate response が格納されること
  - DevTools Network throttling を `Offline` に切替えて `/spectate/{tid}` をリロードすると、cache から直前 HTML が返り shell `/` に化けないこと
  - `/groups/{gid}` / `/tournaments/{tid}` は引き続き cache に積まれないこと（Phase D の auth-aware path 除外を retain）
- [ ] iOS Safari 実機（会場予備モニタ想定）で同シナリオを確認。`Settings.app → Safari → Advanced → Experimental Features` から SW 動作を許可
- [ ] **Firestore Rules 変更なし**のため `firebase deploy --only firestore:rules` は不要。Vercel deploy のみで反映完了（メモリ規約「rules 変更時 deploy 案内必須」の適用対象外）

## Notes

- **PRD 観点との整合**: PRD `What We're NOT Building` で「workbox / serwist の導入」「max-age 制御」「新 cache strategy」を排除済み。本 Phase は既存 `networkFirst` の allowlist 拡張のみで、stale 戦略は「online 時は最新を取りに行く / 失敗時のみ cache」を network-first で達成
- **Phase 2/3 との独立性**: 本 Phase は SW のみ変更で、Phase 2 (`/spectate/[tid]` ページ) / Phase 3 (toggle UI + 共有導線) のいずれにも依存しない。Phase 2/3 が未完成でも sw.js の allowlist 拡張自体は無害（cache 対象 path が実在しないため何も積まれない）
- **観測 phase との関係**: 「会場予備モニタの瞬断 UX 改善」効果検証は実機テスト（Manual Validation）に積む。Success Metric の「観戦モード ON 率 30%」とは独立した間接効果（投影 UX の信頼性向上）
- **error-logging.md の include 範囲外**: `public/sw.js` は本 codebase の AppError ラップ義務を持たない。`console.warn` で握る既存 pattern をそのまま踏襲、新規 `pwa/*` AppError prefix は導入していない
