# Local Review: Track D — Chic Dark Theme & Theme Toggle (Phase D.1)

**Reviewed**: 2026-05-14
**Author**: Kujo-n
**Branch**: develop (uncommitted)
**Decision**: APPROVE with comments

## Summary

post-launch-polish PRD Track D / Phase D.1 の実装をローカル uncommitted 状態でレビュー。
chic dark palette / 手動 ThemeProvider / `/settings` 集約トグル / QR wrapper の
semantic token 化 / PWA manifest 整合 / `theme/*` prefix 追加が plan 通り完結している。
**CRITICAL / HIGH ゼロ**。validation（typecheck / lint / test / build）全 green。
MEDIUM 2 件 / LOW 3 件はいずれも plan 既知 or 段階的に拾える polish。

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

#### M-1: ThemeToggle の radiogroup keyboard navigation が WAI-ARIA canonical でない

- **Location**: [src/components/theme/ThemeToggle.tsx:30-54](src/components/theme/ThemeToggle.tsx#L30-L54)
- **Category**: Maintainability / a11y
- **Detail**: `role="radiogroup"` + 各 `<Button role="radio" aria-checked aria-label>` の構成は
  static role / state は正しい一方、**キーボード操作**が canonical radiogroup pattern に未対応。
  WAI-ARIA Radio Group Pattern は (a) group 内では矢印キーで radio 間移動、(b) selected radio のみ
  `tabindex=0`、非選択は `tabindex=-1`（roving tabindex）、(c) Space / Enter で選択。
  現実装は Button 3 個が全て tab order に入り、Tab で移動 + Enter / Space で選択。
  動作上は機能するがキーボードユーザーには「想定外に Tab 3 回かかる」体験で、SR の announce も
  正規 radiogroup と差がある。
- **Severity rationale**: 機能不全ではないため HIGH ではない。一方、a11y の正規パターンから外れて
  おり segmented control を本格運用するなら拾うべき。
- **Suggested fix（任意 / D.2 候補）**:
  - selected の Button のみ `tabIndex={0}`、他は `tabIndex={-1}` に
  - 親 div で `onKeyDown` を受け、`ArrowRight` / `ArrowLeft` で active を循環
  - shadcn の `<ToggleGroup>` Radix プリミティブ採用も選択肢（依存追加 ask 必要）
- **Now / Later**: Later（plan の D.2 候補に記録 or 次の polish PR で）。本 PR では touch しない。

#### M-2: `/settings` の `RequireAuth allowAnonymous` で匿名ユーザーも到達可能（plan 前提との差異）

- **Location**: [src/app/settings/page.tsx:7](src/app/settings/page.tsx#L7)
- **Category**: Pattern Compliance（plan / 実装の整合）
- **Detail**: plan は `RequireAuth(allowAnonymous=false)` を前提に「匿名は明示切替不可で OS 設定追従」
  と書いている。実コードは `<RequireAuth allowAnonymous>` で匿名でも到達できる。結果として匿名ユーザーも
  `/settings` のテーマ Card で明示切替できてしまう（plan の想定より広い経路で機能）。これ自体は UX 上の
  バグではなく、むしろ匿名で観戦している人にもトグルが効くので利便性は高い。
- **Severity rationale**: 機能・セキュリティに悪影響なし。plan と実装の整合性 / report に明記済みの
  deviation である点で MEDIUM 扱い。意図変更を許容するなら plan / PRD の表現を「signed-in 必須」
  から「`/settings` 集約（実装上は anon でも到達可）」に微修正で十分。
- **Suggested fix**: 以下のいずれか
  - (a) plan の前提が現状寄りで OK な場合: PRD の D.1 詳細から「signed-out / 匿名は明示切替不可」の
    一文を削除（実装に合わせる）
  - (b) plan 通りにしたい場合: `settings/page.tsx` の `allowAnonymous` を外す → 匿名ユーザーは `/login`
    にリダイレクト
- **Now / Later**: Now（PR レビューで方針を確認し PRD or page.tsx のどちらかを直す）。

### LOW

#### L-1: FOUC inline script が minified で読みにくい

- **Location**: [src/app/layout.tsx:60](src/app/layout.tsx#L60)
- **Detail**: `themeBootstrap` は 1 行に圧縮された IIFE。user input 由来 0 / hot path 0 のため
  読みやすい複数行で書いても production bundle に影響なし。
- **Suggested fix**: 改行 + コメント付きで残してもよい。Next.js が production build で minify する
  ため bytes は変わらない。Now / Later: Later（読みやすさを優先したいときに整形）。

#### L-2: `applyHtmlClass` が mount 直後に冗長に再適用される

- **Location**: [src/lib/services/theme.tsx:62](src/lib/services/theme.tsx#L62)
- **Detail**: 初回 mount の useEffect 内で `applyHtmlClass(next)` を必ず呼ぶ。一方 inline script
  が hydration 前に既に同じ class を付けている。idempotent なので機能上問題なし。
- **Suggested fix**: 不要。仮に最適化するなら `if (root.classList.contains("dark") !== (next === "dark"))`
  の short-circuit を入れられる。Now / Later: Later / 不要。

#### L-3: PWA `background_color` 変更は再インストールまで反映されない

- **Location**: [src/app/manifest.ts:28](src/app/manifest.ts#L28)
- **Detail**: PWA インストール済みユーザーの splash 画面は OS / ブラウザ側にキャッシュされ、
  manifest の `background_color` 変更は再インストール（または OS 側 manifest 再評価）まで反映されない。
  これは PWA 仕様の制約で本実装の問題ではない。
- **Suggested fix**: 不要。リリースノート / README で「splash 色が古いままなら一度アンインストール →
  再インストール」と案内するのが妥当。Now / Later: Later（リリース時に user-facing note）。

## Validation Results

| Check       | Result      | Notes                                |
| ----------- | ----------- | ------------------------------------ |
| Type check  | [done] Pass | `npm run typecheck` 0 error          |
| Lint        | [done] Pass | `npm run lint` 0 warning             |
| Tests       | [done] Pass | 1409 / 1409 (新規 26 件 含む)         |
| Build       | [done] Pass | 16 static pages / manifest 生成      |

## Files Reviewed

| File                                                                | Change   |
| ------------------------------------------------------------------- | -------- |
| `src/app/globals.css`                                               | Modified |
| `src/app/layout.tsx`                                                | Modified |
| `src/app/manifest.ts`                                               | Modified |
| `src/app/settings/settings-client.tsx`                              | Modified |
| `src/app/groups/[gid]/_components/InviteCodeCard.tsx`               | Modified |
| `src/components/qr/QrPanel.tsx`                                     | Modified |
| `src/components/tournament/SpectateModeCard.tsx`                    | Modified |
| `src/lib/services/theme-storage.ts`                                 | Added    |
| `src/lib/services/theme-storage.test.ts`                            | Added    |
| `src/lib/services/theme.tsx`                                        | Added    |
| `src/lib/services/theme.test.tsx`                                   | Added    |
| `src/components/theme/ThemeToggle.tsx`                              | Added    |
| `src/components/theme/ThemeToggle.test.tsx`                         | Added    |
| `.claude/rules/error-logging.md`                                    | Modified |
| `.claude/PRPs/05-post-launch-polish/prds/05-post-launch-polish.prd.md` | Modified |
| `.claude/PRPs/05-post-launch-polish/reports/track-d-chic-dark-theme-report.md` | Added |
| `.claude/PRPs/05-post-launch-polish/plans/completed/track-d-chic-dark-theme.plan.md` | Added (archive) |

## Detailed Notes by Category

### Correctness

- inline FOUC script は `try { ... } catch (e) {}` で silent fallback。`window.matchMedia` の
  存在チェックを式の中で `window.matchMedia &&` で防御済み。古い WebView でも安全に no-op。✓
- ThemeProvider の useEffect 依存配列は `[]` / `[theme]` / setTheme の `[]` で正しい。matchMedia
  listener は `theme === "system"` 時のみ attach、明示選択時は detach する guard も正しい。✓
- `useTheme()` の Provider 外呼び出しは `Error` を throw。テストでカバー。✓
- SSR safe: `theme-storage.ts` と `theme.tsx` 双方で `typeof window === "undefined"` / `typeof document === "undefined"` ガード。✓

### Type Safety

- `ThemePreference` union (`"light" | "dark" | "system"`) を中央集権化し、runtime validation も
  `isThemePreference` で実施。`any` / unsafe cast なし。✓
- `viewport.themeColor` を配列形式に変更しても Next.js 15 の `Viewport` type に typecheck パス。✓
- `LucideIcon` import で icon の型を明示。✓

### Pattern Compliance

- `theme-storage.ts` は `install-dismiss-storage.ts` の構造（STORAGE_KEY const / SSR guard /
  AppError.from + logger.warn / `code` prefix）を踏襲。✓
- `ThemeProvider` は `current-group.tsx` の hydrate / setter パターンに整合。✓
- `.claude/rules/error-logging.md` の prefix 一覧に `theme/*` を `pwa/*` と同列で追加。例の一覧にも
  `theme/storage-failed` 追記。✓
- `bg-white` → `bg-card` の 3 件はいずれも wrapper のみで QR 自体の `bgColor`/`fgColor` プロパティは
  無変更（plan の指示通り）。✓
- `localStorage["allinpt.*"]` 命名規約に従う。✓

### Security

- `<script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />`: 静的文字列リテラルで user input
  経路ゼロ。XSS 経路なし。プロジェクトに CSP header の設定ゼロのため `'unsafe-inline'` 前提で安全。
  将来 CSP を厳格化するときは nonce を発行する必要がある。✓
- localStorage 値は read 経路で `isThemePreference` で validate 済み。不正値は warn + system fallback。✓
- 秘密情報 / API key / token の混入なし。✓
- Firestore rules / DB schema 無変更で attack surface 拡張なし。✓

### Performance

- ThemeProvider は context value を `useMemo` で安定化、setter を `useCallback` で固定。
  下流 consumer の不要な re-render を抑制。✓
- inline script は 1 KB 未満で hot path にもならない（hydration 前の 1 回のみ）。✓
- `applyHtmlClass` は class API の同期呼び出し。CSS 変数経由のため再 paint は CSS engine 任せ。✓

### Completeness

- 新規 6 ファイル全てに対応 test を追加（26 件）。1409 件 / 86 ファイル全 green。✓
- error-logging.md / PRD の表記も更新済み。✓
- plan deviation を report で明示済み。✓
- Manual validation（実機での FOUC / PWA splash / モバイル追従）はレビュー範囲外 — リリース前に
  実施推奨（plan の Manual Validation チェックリスト参照）。

### Maintainability

- dead code / magic number / 深いネストなし。
- HSL 値はコメントで意図を残しているため後続で微調整しやすい。✓
- `themeBootstrap` 文字列のみ minified で読みづらい（L-1 参照）。

## Recommendation

**APPROVE with comments**。M-2（plan / 実装の整合）のみ次の commit / PR 説明で
「allowAnonymous は意図的に維持」or 「signed-in 必須に絞る」のどちらかに方針を明示すれば、
そのまま merge してよい。M-1 と LOW 群は D.2 以降の polish 候補として残置可。

## Next Steps

- M-2 の方針確定: PRD の D.1 詳細を実装に合わせる（推奨）か、`settings/page.tsx` から
  `allowAnonymous` を外す。
- M-1（radiogroup keyboard navigation）と LOW 3 件は D.2 / 次の polish PR で拾うか、本 PR の
  scope 外として閉じる。
- `/prp-commit` または `/prp-pr` でコミット / PR 化。
