# Local Review: Phase A.3 — Layout Polish & Readability

**Reviewed**: 2026-05-12
**Author**: Kujo-n
**Branch**: `feat/phase-a.2-background-image-ui-and-ssr`
**Decision**: APPROVE with comments（CRITICAL / HIGH なし、MEDIUM 1 件 / LOW 4 件）

## Summary

Phase A.3 の readability layer polish は計画通り三段構え（scrim グラデ + rgba box overlay + theme 切替）で実装され、既存パターン（`LeaveDeleteDialogs` / `og-card-styles`）の組換を主体に発明ゼロで完結。

セキュリティ面の新規露出なし、test カバレッジ良好（unit 1352 件 + 新 E2E 3 件すべて green）。MEDIUM は `whiteSpace: nowrap` がプレビューで demo 文字 overflow を招きうる UI 観測点、LOW はテストの未使用変数 / コメント微調整など。マージ可。

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

**M-1: `CardReadabilityPreview` の文字サイズが container 幅にスケールせず、実画像比率と乖離していた**（対処済み）

- **File**: [src/components/og/CardReadabilityPreview.tsx](../../../../src/components/og/CardReadabilityPreview.tsx)
- **Original Issue**: `PreviewTextBox` の `fontSize` が固定 px（13 / 18px）で、container 幅にスケールしていなかった。
  実 OG 画像 (1200×630) は各文字サイズが画像幅に対する比率で決まっており、プレビューを「OG 画像の縮小版」として
  描画するなら同じ比率を保つべき。外部レビュアーから「親幅に合わせて縮小すれば構造的に overflow しない」との指摘。
- **Resolution**: 内側を **OG 実寸 (1200×630) で固定描画** し、外側で `container-type: inline-size` +
  `transform: scale(calc(100cqw / 1200px))` で親幅に合わせて全体を縮小するアプローチに変更（B 案）。
  - `OG_WIDTH` / `OG_HEIGHT` / `OG_PADDING` / `bgBoxRadius` 等を `og-card-styles.ts` から直接 import し
    drift を防止
  - 内側のフォントサイズは OG キー値準拠（title=56 / emphasis=96 / sub=22 px）
  - 親幅がどれだけ縮んでも実画像と同じ比率を保つため、構造的に文字 overflow を発生させない
  - `whiteSpace: "nowrap"` も維持できる（内側座標系では実画像と同じく余裕がある）
- **Verification**: typecheck / lint / 既存 CardBackgroundCard.test.tsx (10/10) すべて green。E2E spec の
  DOM locator（`getByTestId("winner-card-bg-preview").locator("img")`）も変更不要

### LOW

**L-1: E2E spec の `const url = await expect.poll(...).toBeTruthy()` は常に undefined**

- **File**: [tests/e2e/card-background.spec.ts:121-131](../../../../tests/e2e/card-background.spec.ts#L121-L131)
- **Issue**: Playwright の `expect.poll(...).toMatcher()` は matcher 側で assertion を発火するだけで値を返さない。`const url = await ...toBeTruthy()` は常に `undefined` で、続く `void url` も意味がない。
- **Suggested fix**: `const url = ...; void url;` の 3 行を削除し `await expect.poll(...).toBeTruthy()` の単文に縮める。動作影響なし。

**L-2: E2E spec の最初の test name に「allowlist 防御」とあるが、実体は「fetch 失敗 → fallback」のテスト**

- **File**: [tests/e2e/card-background.spec.ts:60](../../../../tests/e2e/card-background.spec.ts#L60)
- **Issue**: 実装中の deviation（D-1）で URL を Storage emulator URL → 「allowed host + 実体不在」に切替えた際、test name と comment の意図がコード内では揃ったが、実際の test name には「fetch 失敗 → グラデ fallback の回帰検出」と明記されており既に正確。確認のみ、修正不要。
- **Suggested fix**: 不要（report で deviation を明文化済み）。

**L-3: `OG_COLORS.bgScrimBottomGradient` の % 値が下端 80〜100% でなく "20% から 0%"**

- **File**: [src/app/api/og/_lib/og-card-styles.ts:35](../../../../src/app/api/og/_lib/og-card-styles.ts#L35)
- **Issue**: `linear-gradient(0deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 20%)` は「下端から上方向 20% まで」黒グラデを引く。コメントは「下端 80〜100%」と記載しており理解は一致するが、ピクセル原点から見ると "0%→20%" の方向 + `0deg`（下→上）の組合せで初学者に解読しづらい。
- **Suggested fix**: コメントを「下端 100% から 80% まで黒グラデを上方向に薄める（0deg = 下→上）」のように explicit に書くと一読で意図が掴める。動作影響なし。

**L-4: `playwright.config.ts` の emulator 起動 timeout が 120s のまま**

- **File**: [playwright.config.ts:70](../../../../playwright.config.ts#L70)
- **Issue**: storage emulator を追加したことで cold boot 時間が 5〜10s 増える可能性。現行 120s タイムアウトには十分余裕があるため実害はないが、CI で他工程の遅延と重なると稀に boot timeout を踏むかも。
- **Suggested fix**: 不要。現状で十分。将来 CI に投入時に発生したら拡張する。

## Quality Highlights

良かった点を明示しておく:

1. **発明ゼロ** — `og-readability.tsx` は既存 OG route と `CardReadabilityPreview` の双方で `resolveCardTheme` を共有し色値 drift を防止。Dialog 置換は `LeaveDeleteDialogs` パターンと完全に揃えた
2. **テスト追従** — `og-readability.test.tsx` は 9 ケースで純関数の全分岐をカバー、`CardBackgroundCard.test.tsx` は旧 `window.confirm` mock を撤去して Dialog の cancel / confirm 両経路を新規追加
3. **regression ゼロ** — `phase-d-share-and-history.spec.ts` 5/5 が pass し既存 OG E2E 影響なしを確認、`bgImageUrl` 未指定時の挙動を完全維持（OG_COLORS のグラデ既存値・border / padding は据え置き）
4. **state 機械の整合性** — `busy = working || clearConfirmOpen` で dialog open 中の他ボタン操作を防止、`confirmClear` 冒頭で `setClearConfirmOpen(false)` してから async work に入り race を排除
5. **plan deviation の明文化** — Report に D-1〜D-3 として記録、後続レビュー / 引継ぎが追跡可能

## Validation Results

| Check                            | Result      | Notes                                                                       |
| -------------------------------- | ----------- | --------------------------------------------------------------------------- |
| Type check (`npm run typecheck`) | Pass        | 0 errors                                                                    |
| Lint (`npm run lint`)            | Pass        | 0 warnings / 0 errors                                                       |
| Tests (`npm run test`)           | Pass        | 81 files / 1352 tests pass（+9 件 og-readability / +1 件 CardBackgroundCard） |
| Build (`npm run build`)          | Pass        | OG route 2 件の bundle サイズ変化なし                                          |
| E2E (`card-background.spec.ts`)  | Pass        | 3/3 green（31.9s）                                                            |
| E2E regression (`phase-d-share`) | Pass        | 5/5 green（47.5s）                                                            |
| Emulator rules (regression)      | Skipped     | rule / schema / Storage rule すべて未変更（plan 通り省略）                      |

## Files Reviewed

| File                                                                   | Action     | Lines      |
| ---------------------------------------------------------------------- | ---------- | ---------- |
| `src/app/api/og/_lib/og-card-styles.ts`                                | Modified   | +14 / -2   |
| `src/app/api/og/_lib/og-readability.tsx`                               | Added      | +115       |
| `src/app/api/og/_lib/og-readability.test.tsx`                          | Added      | +70        |
| `src/app/api/og/winner/[tid]/route.tsx`                                | Modified   | +63 / -55  |
| `src/app/api/og/season/[gid]/route.tsx`                                | Modified   | +38 / -35  |
| `src/components/og/CardReadabilityPreview.tsx`                         | Added      | +130       |
| `src/app/groups/[gid]/_components/CardBackgroundCard.tsx`              | Modified   | +84 / -25  |
| `src/app/groups/[gid]/_components/CardBackgroundCard.test.tsx`         | Modified   | +50 / -3   |
| `tests/e2e/card-background.spec.ts`                                    | Added      | +175       |
| `playwright.config.ts`                                                 | Modified   | +2 / -2    |
| `docs/article/operating-guide.md`                                      | Modified   | +9         |
| `.claude/PRPs/05-post-launch-polish/prds/05-post-launch-polish.prd.md` | Modified   | +2 / -2    |

## Next Steps

- [ ] L-1（未使用変数）を簡潔に整理（任意・1 行修正）
- [ ] M-1（whiteSpace overflow）は demo 文字を運営者カスタムに開放する将来 Phase で対処（YAGNI）
- [ ] 手動 visual diff: 明 light / 暗 dark / 中間両 theme の 3 通りで実際の OG PNG / プレビューを目視確認
- [ ] `/prp-commit` で日本語 commit メッセージ作成
- [ ] `/prp-pr` で PR 作成（Codex review を経て final approve）
