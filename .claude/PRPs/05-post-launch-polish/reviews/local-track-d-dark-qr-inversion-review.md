# ローカルレビュー: Track D ダークモード QR 反転対応（Phase D.1 のフォローアップ）

**Reviewed**: 2026-05-14
**Author**: Kujo-n（運営者ドライランフィードバック対応）
**Branch**: develop（未コミット差分）
**Decision**: APPROVE

## Summary

dryrun 中に上がった「ダークモードでトーナメント受付の QR が純白で浮いて見える」というフィードバックに対し、テーマ追従の `ThemedQRCode` コンポーネントを 1 つ追加して 3 つの callsite を差し替える形で対応。light は canonical な黒/白を維持し、dark のみ `--card` / `--foreground` トークンに揃えた反転 QR で描画する。スマートフォン読取（iOS 11+ / 最新 Android Camera / LINE / 決済アプリ等）が反転 QR をサポートしている前提を採用しており、Pre-existing の Phase D.1 「QR は default 黒/白を維持」方針からの意図的な方針転換となる。

## レビュー対象（このセッションでの変更）

| ファイル | 変更種別 | 概要 |
| --- | --- | --- |
| [src/components/qr/ThemedQRCode.tsx](../../../../src/components/qr/ThemedQRCode.tsx) | Added | `useTheme()` から `resolvedTheme` を読み、`fgColor` / `bgColor` を切替える小コンポーネント。`marginSize={4}` で QR 仕様準拠の quiet zone を SVG 内部にも確保 |
| [src/components/qr/ThemedQRCode.test.tsx](../../../../src/components/qr/ThemedQRCode.test.tsx) | Added | light / dark / aria-label 伝搬の 3 ケース |
| [src/components/qr/QrPanel.tsx](../../../../src/components/qr/QrPanel.tsx) | Modified | `<QRCodeSVG>` 直書きを `<ThemedQRCode>` に差替 |
| [src/app/groups/[gid]/_components/InviteCodeCard.tsx](../../../../src/app/groups/%5Bgid%5D/_components/InviteCodeCard.tsx) | Modified | 同上 |
| [src/components/tournament/SpectateModeCard.tsx](../../../../src/components/tournament/SpectateModeCard.tsx) | Modified | 同上 |
| [src/components/tournament/SpectateModeCard.test.tsx](../../../../src/components/tournament/SpectateModeCard.test.tsx) | Modified | `ThemedQRCode` が `useTheme` を要求するため軽量 stub を追加 |
| [src/app/tournaments/[tid]/live/live-client.test.tsx](../../../../src/app/tournaments/%5Btid%5D/live/live-client.test.tsx) | Modified | 同上（QrPanel 経由で transit に useTheme を読むため） |

> Phase D.1 由来の `src/lib/services/theme.tsx` / `theme-storage.ts` / `src/components/theme/ThemeToggle.tsx` / `globals.css` / `layout.tsx` / `manifest.ts` / `settings/settings-client.tsx` / 既存 PRD / rule 更新は [local-track-d-chic-dark-theme-review.md](local-track-d-chic-dark-theme-review.md) で別途レビュー済みのため本レビューの対象外。

## Findings

### CRITICAL

なし。

### HIGH

なし。

### MEDIUM

なし。

### LOW

#### L-1: globals.css と ThemedQRCode.tsx の HSL 値が手動 sync（drift 検出スクリプト無し）

**ファイル**: [src/components/qr/ThemedQRCode.tsx:30-31](../../../../src/components/qr/ThemedQRCode.tsx#L30-L31)

`bgColor` / `fgColor` の dark モード HSL リテラル `hsl(222, 28%, 11%)` / `hsl(35, 25%, 92%)` は [globals.css](../../../../src/app/globals.css) の `.dark` ブロック `--card` / `--foreground` の値とハードコードで同期している。テーマ palette を変更した場合に自動で検出する仕組みは無く、コメント内の `⚠ DRIFT WARNING` を tripwire として人間レビューに依存する設計。

**影響**: 視覚的に drift は即時露見する（QR だけ周囲のカードと色が違って浮く ＝ 今回直したのと同じ症状）ため運用上の事故リスクは低い。

**Suggested fix**: 現状コードは現実的なトレードオフとして許容範囲。将来 palette 改変が頻繁になる場合は次の選択肢で硬化:

- `getComputedStyle(document.documentElement).getPropertyValue("--card")` を `useEffect` で読み出し、CSS 変数を SVG fill にバインドする（実行時取得・複雑度増）
- `scripts/test-theme-drift.mjs` を追加し、`globals.css` と `ThemedQRCode.tsx` 内の HSL リテラルを正規表現で照合する単純な drift 検出スクリプト化

今回は **据置き**。

#### L-2: 初回 render 時の light → dark フラッシュ

**ファイル**: [src/lib/services/theme.tsx:54-65](../../../../src/lib/services/theme.tsx#L54-L65) / [src/components/qr/ThemedQRCode.tsx:33](../../../../src/components/qr/ThemedQRCode.tsx#L33)

`ThemeProvider` 初期値は `resolvedTheme: "light"` で、`useEffect` 内で localStorage / OS 設定から hydrate する。よって dark テーマユーザーがページを初回 load した際、1 フレーム未満だけ light 配色の QR が描画されてから dark 配色に切替わる可能性がある。

**影響**:
- `QrPanel` / `InviteCodeCard` / `SpectateModeCard` の QR はいずれも `url ? ...` でクライアントサイドの `useEffect` で URL を生成した後にだけ描画される（SSR 段階では描画されない）ため、QR 描画タイミングはほぼ常に hydrate 完了後になる
- 体感上のフラッシュは無視できる範囲

**Suggested fix**: 据置き。`layout.tsx` の inline script で `html.dark` class を pre-hydrate でセットする防御は Phase D.1 で既に入っているため、本コンポーネントだけ追加対策する必要は無い。

## Validation Results

| Check | Result | コマンド |
| --- | --- | --- |
| Type check | Pass | `npm run typecheck` |
| Lint | Pass | `npm run lint`（warnings 0 / errors 0） |
| Tests | Pass | `npx vitest run`（**1412/1412 passed**、追加 3 / 修正 2 ファイル含む） |
| Build | Pass | `npm run build`（Next.js production build 成功） |

## 良かった点

1. **境界が綺麗**: `<ThemedQRCode>` を 1 つ追加するだけで 3 つの callsite を統一できた。`useTheme` を直接知るのは `ThemedQRCode` 内部だけで、消費側コンポーネントは責務が変わらない
2. **読取性最優先の light モード**: light は canonical な `#FFFFFF` / `#000000` を維持し、スキャナ互換性のリスクを取らない判断
3. **defense-in-depth の quiet zone**: 外側 wrapper の `bg-card p-4` と SVG 内部の `marginSize={4}` で 2 重に quiet zone を確保。一方しか効いていない場合でも読取可能
4. **DRIFT WARNING の明示**: コメント内に palette との連動箇所を明記し、将来 palette を触る開発者への警告経路を残している
5. **テスト追加**: 既存パターン（`vi.mock("@/lib/services/theme")`）に従って 3 callsite テストの useTheme stub を追加し、unit テストの coverage を維持
6. **コミットメッセージ予習**: `Track D Phase D.2:` という phase ID 付き comment を 3 callsite に残しており、後続レビューや revert 候補の特定が容易

## 改善提案（非必須）

1. **`src/lib/services/theme-tokens.ts`** のような pure helper を切り出し、`{ bgColor, fgColor }` を `resolvedTheme` から計算する関数だけ unit テストでロックする選択肢もあるが、現状はコンポーネント 1 つに閉じているため過剰
2. テストの `getRectFills` ヘルパーは qrcode.react の SVG 内部構造（`<path>` 2 つ）に依存。ライブラリ実装変更でテストが壊れる可能性はあるが、レンダリング結果を検証する E2E に近い性質なので妥当な実装依存

## Decision: APPROVE

CRITICAL / HIGH issues なし、全 validation green。dryrun 経由のユーザーフィードバックに対する小規模で目的明快な対応であり、コミットして問題なし。

## 次の手順

```bash
# 提案コミットメッセージ（プロジェクト規約: 日本語 + type prefix 英語）
git add src/components/qr/ThemedQRCode.tsx \
        src/components/qr/ThemedQRCode.test.tsx \
        src/components/qr/QrPanel.tsx \
        src/app/groups/\[gid\]/_components/InviteCodeCard.tsx \
        src/components/tournament/SpectateModeCard.tsx \
        src/components/tournament/SpectateModeCard.test.tsx \
        src/app/tournaments/\[tid\]/live/live-client.test.tsx \
        .claude/PRPs/05-post-launch-polish/reviews/local-track-d-dark-qr-inversion-review.md

git commit -m "feat: ダークモード時に QR コードをテーマ追従の反転表示に変更

ダークモードで純白の QR が UI から浮いて見えるという dryrun フィードバックを
受け、resolvedTheme に応じて fgColor / bgColor を切替える ThemedQRCode を追加。
light は canonical な黒/白を維持しスキャナ互換性を確保。dark のみ chic-dark の
card / foreground tokens に揃え、スマートフォン読取（iOS 11+ / Android / LINE /
決済アプリ）が反転 QR をサポートしている前提を採用。

quiet zone は外側 wrapper の bg-card padding と SVG 内部の marginSize=4 で
二重防御。drift 検出は globals.css の HSL リテラルを ThemedQRCode 内コメント
で警告する手動運用。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

なお Phase D.1 由来の未コミット差分（`theme.tsx` / `theme-storage.ts` / `globals.css` 等）は別コミットに分離するのが履歴粒度として望ましい。
