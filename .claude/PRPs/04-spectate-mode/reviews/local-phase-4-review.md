# Local Review: Phase 4 — PWA Cache Allowlist 追加（観戦モード）

**Reviewed**: 2026-05-10
**Author**: Kujo-n
**Branch**: develop（Phase 3 と同居中。本レビューは Phase 4 ファイル境界に限定）
**Decision**: APPROVE

## Summary

`public/sw.js` の `NAVIGATE_CACHE_ALLOWLIST` 拡張・`CACHE_VERSION` v2→v3 bump・unit test による挙動 pin・E2E static contract 同期の 4 点で完結する小粒な変更。security / quality / pattern compliance の重大欠陥なし。validation 5 段（typecheck / lint / vitest / build / e2e / emulator）すべて green。CRITICAL / HIGH 指摘なし。MEDIUM / LOW で改善余地はあるが、いずれも本 Phase の merge を blocker しない。

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

#### M1. `new Function(...)` による sw.js 関数抽出の brittle 性 — `src/lib/sw/sw-allowlist.test.ts:32-35`

```ts
const shouldCacheNavigate = new Function(
  "NAVIGATE_CACHE_ALLOWLIST",
  `${fnMatch[0]}\nreturn shouldCacheNavigate;`,
)(allowlist) as (pathname: string) => boolean;
```

**観察**: 関数本体抽出 regex `/function\s+shouldCacheNavigate\(pathname\)\s*\{[\s\S]*?\n\}/` は **lazy + 最初の `\n}` で停止する**設計。現状の sw.js 関数本体は単一 return 文で `\n}` が closing brace 直下にあるため動作するが、将来 sw.js の同関数に **nested block を追加して `\n  }` のような indented closing brace** が現れたら、regex が「最初の inner `\n}`」で停止して関数を途中で切ってしまう（`new Function` の SyntaxError で test setup が throw する）。

**影響**: drift 検出として意図された挙動だが、sw.js のリファクタで意図せず test 全体が壊れる可能性がある。エラーメッセージは `new Function` の SyntaxError で、原因が「regex 抽出の境界誤判定」だと特定するのに時間がかかる可能性がある。

**改善案（任意）**: 抽出に失敗したときの error message を以下のように具体化する。
```ts
let parsedFn: (pathname: string) => boolean;
try {
  parsedFn = new Function(
    "NAVIGATE_CACHE_ALLOWLIST",
    `${fnMatch[0]}\nreturn shouldCacheNavigate;`,
  )(allowlist) as (pathname: string) => boolean;
} catch (e) {
  throw new Error(
    `Failed to evaluate shouldCacheNavigate from public/sw.js. ` +
    `Likely cause: regex extraction boundary mismatch (e.g., nested blocks). ` +
    `Original error: ${e instanceof Error ? e.message : String(e)}`,
  );
}
```

**判定**: 本 Phase は green、改善は次回 sw.js 改変時に余裕があれば。**本 PR の blocker ではない**。

### LOW

#### L1. テスト内の vanilla JS 評価コメントが「内部評価コンテキスト」を明示していない — `src/lib/sw/sw-allowlist.test.ts:7-11`

リード JSDoc は「`shouldCacheNavigate` は pure 関数で SW グローバル依存なし」を仮定するが、その仮定を**明文化していない**。将来の編集者が `shouldCacheNavigate` 内に `self` / `caches` / `fetch` 参照を追加するインセンティブは低いが、**仮定が破れた瞬間に test setup が ReferenceError で死ぬ**ことを leading comment に 1 行追記しておくと事故予防になる。

**改善案**:
```ts
// `shouldCacheNavigate` は self/caches/fetch 等の SW グローバルを参照しない pure 関数であること
// を前提に評価する。SW グローバル参照を追加すると new Function 評価時に ReferenceError で
// test setup が落ちるため、追加するなら本 test の評価戦略を切り替える必要がある。
```

**判定**: nice-to-have。**本 PR の blocker ではない**。

#### L2. `CACHE_VERSION` bump による初回 navigate のレイテンシ増 — `public/sw.js:18`

`v2 → v3` への bump で全 install 端末の旧 cache (`allin-shell-v2` / `allin-runtime-v2`) が activate 時に削除され、SHELL_URLS 7 件が再 precache される。**実害は数百 ms 以内の一度きり**で plan の Risk 表に記載済み。会場 Wi-Fi 安定前提なら無視できる。

**観察**: report の Next Steps に「Vercel deploy 後に DevTools で v3 への切替を実機確認」が積まれており、運用面でカバー済み。

**判定**: 仕様の範囲内。**本 PR の blocker ではない**。

#### L3. allowlist drift check の expect が「順序非依存 superset」のみ — `src/lib/sw/sw-allowlist.test.ts:38-40`

```ts
it("Phase 4 で必要な 3 entry を含む", () => {
  expect(allowlist).toEqual(expect.arrayContaining(["/", "/login", "/spectate"]));
});
```

`arrayContaining` は **superset 判定**で、将来の Phase で `/preview` 等が追加されても fail しない。これは plan の意図に沿った設計（順序を pin すると過剰 fail する）だが、**逆に「allowlist が肥大化しすぎていないか」のチェックは別途必要**。現状 3 entry は妥当だが、将来 5 entry 超えになる場合は別 PR で「allowlist 肥大時に warning」のような guard 追加を検討してもよい。

**判定**: 設計判断として妥当。本 PR では action 不要。

#### L4. 新規 directory `src/lib/sw/` に test ファイルしか存在しない — `src/lib/sw/`

plan の GOTCHA で「test ファイルだけ置く形でも構わない」「将来の SW 関連 helper を集約するための naming hub」と明示済み。現状は意図的に空 dir + test 1 件のみ。**コード品質上の問題はないが、将来 SW 周辺ロジックを TS 側で書く（例: SW registration の helper / postMessage 経路）ときに本 dir に集約する**ことを次の Phase plan で意識しておくと良い。

**判定**: 観察事項のみ。**本 PR の action 不要**。

## Validation Results

| Check                          | Result    | Notes                                                  |
| ------------------------------ | --------- | ------------------------------------------------------ |
| Type check (`npm run typecheck`) | Pass      | 0 errors                                               |
| Lint (`npm run lint`)            | Pass      | 0 warnings / 0 errors                                  |
| Unit Tests (`npm test`)          | Pass      | 1261/1261（74 files）。Phase 4 で +18 ケース           |
| Build (`npm run build`)          | Pass      | Compiled successfully。`/spectate/[tid]` も dynamic で含まれる |
| E2E (Phase D static contract)    | Pass      | 5/5（PWA install banner 4 + sw.js static contract 1） |
| Emulator (`test:rules-spectate`) | Pass      | 16/16（Phase 1 contract 維持・regression なし）       |

## Files Reviewed

| File                                                            | Change Type | 観察                                                                       |
| --------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------- |
| `public/sw.js`                                                  | Modified    | CACHE_VERSION v2→v3 + NAVIGATE_CACHE_ALLOWLIST に "/spectate" 追加 + コメント 2 ブロック追記。`shouldCacheNavigate` / `networkFirst` / activate listener など関数本体は **無変更**で Phase D の startsWith 判定 / put→trim 順序を退行させていない |
| `src/lib/sw/sw-allowlist.test.ts`                               | Added       | 18 ケース（drift 1 + allow 6 + deny 10 + root 1）で `shouldCacheNavigate` 挙動を pin。`/spectatethief` の prefix 偽マッチ防止 / `//` の trailing slash sensitivity / auth-aware path（groups / tournaments / settings 等）の cache 除外をすべて検証 |
| `tests/e2e/phase-d-install-promotion.spec.ts`                   | Modified    | static contract regex を `v3` / `/spectate` 含みに同期。JSDoc / test title / 中の expect を整合的に更新。test 数は不変（5/5 維持） |
| `.claude/PRPs/04-spectate-mode/prds/04-spectate-mode.prd.md`    | Modified    | Implementation Phases 表で Phase 4 を `in-progress` → `complete` に遷移。Phase 3 行も同 commit セットで `complete` に同期（事前に Phase 3 report 作成済み）。table format 崩れなし |

## Security Review

### 観戦モードの cache 設計が漏えいリスクを含まないことの確認

`/spectate/{tid}` の navigate response を `RUNTIME_CACHE` に積むことで、共用端末で別ユーザーが `/spectate/{tid}` を訪問したとき cache hit する可能性がある。これが auth-aware データの漏えいに繋がらないかを検討:

- `/spectate/[tid]` page は **anon でも read 可能な情報のみ**（タイマー / ブラインド / 残人数 / 卓配置 / displayName）を表示。`spectateEnabled === true` のときに firestore.rules が anon read を許可する範囲と一致
- tid を URL に持つため、cache key は `/spectate/<tid>` となり、別 tid の cache が漏れ出すことはない
- 同 tid の cache が「spectateEnabled OFF 後に再訪問した端末で表示される」可能性はあるが、Phase 2 の graceful handling で「OFF 後は静的説明文に切替」のため、stale cache が読み込まれても観戦者目線で機微情報が露出することはない（**OFF 後は subscribe が deny で停止し、UI が「観戦モードは停止しました」表示に倒れる**）

**判定**: 漏えいリスクなし。Phase D L4 で議論された `/login` の prefix match 設計を踏襲しており、`/spectate-admin/...` のような将来 path との偽マッチも `${p}/` の trailing slash で防御済み（unit test で pin）。

### `new Function(...)` 利用箇所のセキュリティ評価

test ファイルが `new Function` で `public/sw.js` の文字列を評価している:

- 評価対象は **本リポジトリ内の固定 file** (`public/sw.js`) のみ
- 攻撃者が sw.js を改変できる時点で SW 自体を支配しているため、本 test の `new Function` 経由の追加リスクはない（攻撃者は SW 経由で直接任意コードを実行できる）
- production には混入せず、test 環境（vitest）でのみ評価される

**判定**: 設計上の安全境界が成立。

## Pattern Compliance Review

| 観点                                              | 判定 | 備考                                                                      |
| ------------------------------------------------- | ---- | ------------------------------------------------------------------------- |
| vanilla JS / `// @ts-nocheck` / `/* eslint-disable */` 維持 | ✓    | sw.js 既存 pattern を踏襲                                                  |
| allowlist 配列の追加形式（既存末尾追加 / alphabetical 順ではない） | ✓    | plan の指示通り diff を最小化                                              |
| `shouldCacheNavigate` 関数本体は無変更（Phase D の startsWith 判定退行防止） | ✓    | 本体は touch せず                                                          |
| vitest pure 関数 spec の `describe` + `it.each` 構造 | ✓    | [src/lib/services/tournament-state.test.ts](../../../src/lib/services/tournament-state.test.ts) と同形式  |
| `__dirname` ではなく `fileURLToPath(import.meta.url)` を使用（ESM 互換） | ✓    | plan の GOTCHA で言及されたフォールバックパターン                          |
| Firestore Rules / schema / repository 変更なし     | ✓    | 本 Phase は SW 層のみ                                                      |
| 新規 `pwa/*` AppError prefix 追加なし              | ✓    | sw.js は error-logging.md の include 範囲外、`console.warn` を踏襲          |

## Memory Rule Compliance

| メモリ規約                                                            | 適用 | 備考                                                                      |
| --------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------- |
| Firestore rules 変更時は deploy 案内を必須                             | N/A  | 本 Phase は rules 変更なし。report の Next Steps で「`firebase deploy --only firestore:rules` 不要、Vercel deploy のみで反映」を明記済み |
| ユーザー向けメッセージに技術スタック名を出さない                       | N/A  | 本 Phase は UI / dialog / toast 変更なし                                   |
| skill 専用リソースは references/ に内包                                | N/A  | skill 追加なし                                                             |
| コマンド実行は npm scripts / bare tool 名を優先、npx は最終手段        | ✓    | 一時的に `npx vitest run src/lib/sw/sw-allowlist.test.ts` を local 実行確認に使ったが、CI / 標準 validation は `npm test` に倒れている |
| 完了済み PRD への plan 後追い禁止                                      | ✓    | 04-spectate-mode は active PRD（plans/ 直下に他 plan が残っている）        |
| レビュー成果物は日本語で記述                                            | ✓    | 本ファイル                                                                 |

## Decision Rationale

- CRITICAL / HIGH 指摘なし
- validation 5 段すべて green
- MEDIUM / LOW は改善余地ありだが本 PR の merge blocker ではない
- security / pattern compliance / memory rule すべてクリア

→ **APPROVE**

## Next Steps

1. **本 PR 内では action 不要**。改善案（M1 / L1）は将来 sw.js 改変時の余裕があるタイミングで反映を検討
2. `/prp-pr` で PR 作成（PR タイトル「feat: 観戦モード Phase 4 - PWA cache allowlist に /spectate を追加」）
3. Vercel deploy 後、Chrome DevTools / iOS Safari 実機で「v3 cache 切替」「/spectate/{tid} の cache hit」「offline 時の cache fallback」を **report の Manual Validation** TODO に従って確認
4. observation phase で「会場予備モニタの瞬断 UX 改善」効果を実機で記録し、PRD の Success Metric とは別軸の間接効果として report 追記
