# Plan: note 公開記事 2 本へのリンクをトップページに追加

## Summary

トップページ `/` に、note 上で公開している 2 本のサークル運営者向け記事
（アプリ紹介記事 / 運営チートシート）への外部リンクを追加する。新規 / 既存ユーザー
どちらの状態でも常時表示し、サークル運営者が「アプリの全体像を読む」「当日の操作を
30 秒で確認する」導線をトップから直接踏める状態にする。

## User Story

As a サークル運営者（運営兼プレイヤー）,
I want アプリのトップ画面から「これ何ができるアプリ?」と「当日の操作チートシート」を読みに行ける,
So that ログイン前でもアプリの価値を把握でき、当日進行中でも操作を素早く再確認できる。

## Problem → Solution

[現状]
- note 上に 2 本の運営者向け記事を公開済み（アプリ紹介・運営チートシート）。
  ローカル原稿は `docs/article/note-article.md` / `docs/article/operating-guide.md`
- しかしトップ画面 `/` からは記事への動線が一切ない。新規ユーザは「これ何のアプリ?」を
  自分でググるしかなく、既存運営者も当日「あの操作どこだっけ」を口頭で他メンバーに
  聞くしかない

→

[望ましい状態]
- トップ画面の主要 CTA（「ログイン / 新規登録」「サークル一覧へ」「トーナメント一覧へ」）の
  下に、控えめな 2 つのリンクを常時配置
  - 「アプリ紹介を読む」 → note の紹介記事（未導入者向け）
  - 「運営ガイド（操作チートシート）」 → note の運営チートシート記事（既存ユーザー向け）
- 外部 note サイトへの遷移なので新しいタブで開く。a11y 的にも「新しいタブで開く」を
  読み上げ可能にする

## Metadata

- **Complexity**: Small（1 ファイル中心 + e2e PageObject の locator 追加 1 ファイル、< 60 行）
- **Source PRD**: `.claude/PRPs/05-post-launch-polish/prds/05-post-launch-polish.prd.md`
  （Track B: Top Page Promotion の Phase B.1 として位置付け。旧 PRD `05-result-card-image-bg` を
  `05-post-launch-polish` にリネーム + Track 化した親 PRD 配下）
- **PRD Phase**: B.1（Track B: Top Page Promotion - note 記事リンク）
- **Estimated Files**:
  - 修正: 2 件（`src/app/page.tsx` / `tests/e2e/pages/TopPage.ts`）
  - 新規: 0 件

---

## UX Design

### Before

```
┌──────────────────────────────────────────────┐
│              ALLin-PokerTimer                 │
│  NLH 小規模サークル向けトーナメント進行支援アプリ │
│                                                │
│        [ ログイン / 新規登録 ]                  │
│            (signed-out)                        │
│                                                │
│  -- or --                                      │
│                                                │
│   [ サークル一覧へ ] [ トーナメント一覧へ ]       │
│            (signed-in)                         │
└──────────────────────────────────────────────┘
```

### After

```
┌──────────────────────────────────────────────┐
│              ALLin-PokerTimer                 │
│  NLH 小規模サークル向けトーナメント進行支援アプリ │
│                                                │
│        [ ログイン / 新規登録 ]                  │
│             (signed-out)                       │
│   [ サークル一覧へ ] [ トーナメント一覧へ ]       │
│             (signed-in)                        │
│                                                │
│  ─────────────  詳しく知る  ─────────────       │
│                                                │
│  [ アプリ紹介を読む ↗ ]                          │
│  [ 運営ガイド（操作チートシート）↗ ]              │
│         ※ 新しいタブで note の記事を開きます      │
└──────────────────────────────────────────────┘
```

`↗` は外部リンクであることを示すアイコン（lucide `ExternalLink`）。
セクション小見出し「詳しく知る」と説明文「※ 新しいタブで note の記事を開きます」は
スクリーン上は小さめ（`text-xs text-muted-foreground`）に置く。

### Interaction Changes

| Touchpoint | Before | After | Notes |
| --- | --- | --- | --- |
| トップ画面 / signed-out | ログインボタンのみ | ログインボタン + 2 リンク | リンクは常時表示で sign 状態に依存しない |
| トップ画面 / signed-in | サークル一覧 / トーナメント一覧ボタン | 同上 + 2 リンク | 同上 |
| リンク押下時 | -（リンク無し） | 別タブで note 記事を開く | `target="_blank"` + `rel="noopener noreferrer"` |
| PWA 起動時 | -- | 別タブで OS の標準ブラウザに遷移 | PWA standalone display の外側で開く（想定通り） |
| スクリーンリーダ | -- | 「アプリ紹介を読む、新しいタブで開く、リンク」と読み上げ | `aria-label` で「新しいタブで開く」を補強 |

---

## Mandatory Reading

実装前に必ず読むファイル:

| Priority | File | Lines | Why |
| --- | --- | --- | --- |
| P0 (critical) | `src/app/page.tsx` | 全行 | 修正対象。現状の sign-in / sign-out 分岐の構造とラッピングを把握 |
| P0 (critical) | `src/components/ui/button.tsx` | 1-50 | `Button` の `asChild` パターン（`Slot` で子要素にスタイルだけ流す）。外部 `<a>` を Button スタイルで描画する正攻法 |
| P0 (critical) | `tests/e2e/pages/TopPage.ts` | 全行 | 既存 PageObject の locator 命名・構造に合わせて新規 link locator を追加する |
| P1 (important) | `docs/article/note-article.md` | 1-60 | リンク先記事のタイトル・想定読者を把握（リンク文言の根拠） |
| P1 (important) | `docs/article/operating-guide.md` | 1-55 | 同上（運営ガイド側） |
| P1 (important) | `docs/article/conventions/terminology-policy.md` | 1-90 | 用語ポリシー: 技術用語禁止 / 「note」自体は読者にとって馴染みのある語として可。リンクラベル選定の根拠 |
| P2 (reference) | `src/components/pwa/PwaInstallPromotion.tsx` | 1-40 | トップ画面のみで mount される PWA promotion の構造。新規追加要素も同じ「トップ限定」の方針に従う |
| P2 (reference) | `src/lib/limits.ts` | 全行 | 「アプリ全体で参照する単一真実源」の集約方針。本 plan で URL 定数を増やす場合の参考（ただし URL は数値リミットではないため limits.ts には置かない判断）|

## External Documentation

| Topic | Source | Key Takeaway |
| --- | --- | --- |
| MDN: `target="_blank"` の `rel` | https://developer.mozilla.org/ja/docs/Web/HTML/Element/a#target | `target="_blank"` を使う場合は `rel="noopener noreferrer"` を必ず併記する（reverse tabnabbing 防止 / referrer 流出防止）|
| WCAG 2.2: 外部リンクの周知 | WCAG 2.4.4 / 3.2.5 | 新しいタブで開くリンクは aria-label / sr-only テキスト等で「新しいタブで開く」を明示する。本 plan では `aria-label` で実装 |

KEY_INSIGHT: Next.js 15 App Router では外部 URL は `<Link>` ではなく素の `<a>` タグを使う（`<Link>` は内部ルーティング前提で、外部 URL に渡すと client-side navigation を試みるため不適切）
APPLIES_TO: Task 2（page.tsx 修正部分）
GOTCHA: なし（標準 HTML `<a>` で完結）

---

## Patterns to Mirror

### NAMING_CONVENTION (constants in component file)

```tsx
// SOURCE: 既存 constants 集約パターンとして src/lib/limits.ts のヘッダコメント方針を参照
//        （ただし URL は数値リミットでなく、件数も 2 件のため file 化せず page.tsx 内 const に閉じる）

const NOTE_INTRO_ARTICLE_URL = "<NOTE_INTRO_URL>"; // 実装時に確定
const NOTE_OPERATING_GUIDE_URL = "<NOTE_GUIDE_URL>"; // 実装時に確定
```

### LINK_TO_BUTTON_STYLED_AS_INTERNAL_LINK (既存パターン)

```tsx
// SOURCE: src/app/page.tsx:31-36
<Link href="/groups">
  <Button>サークル一覧へ</Button>
</Link>
```

これは内部リンク（Next.js Link）専用のラッピング。外部リンクには使えない（後述 EXTERNAL_LINK_PATTERN）。

### EXTERNAL_LINK_PATTERN (本 plan で導入する新規パターン)

```tsx
// SOURCE: src/components/ui/button.tsx の asChild + Slot 使用例として標準的
<Button variant="link" size="sm" asChild>
  <a
    href={NOTE_INTRO_ARTICLE_URL}
    target="_blank"
    rel="noopener noreferrer"
    aria-label="アプリ紹介を読む（新しいタブで開く）"
  >
    アプリ紹介を読む
    <ExternalLink className="size-3" aria-hidden="true" />
  </a>
</Button>
```

要点:
- `Button asChild` で `Slot` を介して `<a>` 要素に Button スタイル（variant=link）を流す
- `target="_blank"` には `rel="noopener noreferrer"` を必ず併記
- `aria-label` に「新しいタブで開く」を含めて SR ユーザに通知
- アイコン `ExternalLink` は装飾なので `aria-hidden="true"`

### LOGGING_PATTERN（参考・本 plan ではログ追加なし）

```ts
// SOURCE: src/lib/logger.ts 経由の info / warn のみ。本 plan は static link のみで
//         例外パスを持たないため、logger 出力は追加しない。
```

### TEST_PAGEOBJECT_LOCATOR_PATTERN

```ts
// SOURCE: tests/e2e/pages/TopPage.ts:6-13
readonly heading: Locator = this.page.getByRole("heading", { name: "ALLin-PokerTimer" });
readonly loginRegisterButton: Locator = this.page.getByRole("button", {
  name: "ログイン / 新規登録",
});
```

新規追加する link は `getByRole("link", { name: "..." })` で取得する（`Button asChild` で root が `<a>` になるため role は "link"）。

---

## Files to Change

| File | Action | Justification |
| --- | --- | --- |
| `src/app/page.tsx` | UPDATE | 2 つの note 記事リンクを sign 状態に依らず常時表示するセクションを追加 |
| `tests/e2e/pages/TopPage.ts` | UPDATE | PageObject に `noteIntroLink` / `noteOperatingGuideLink` の Locator を追加し、`expectSignedOutLayout` / `expectSignedInLayout` から visible 検証を行えるようにする |

## NOT Building

- **新規 e2e spec の作成**: 現状トップ画面の e2e spec は存在せず、TopPage PageObject は他 spec から間接的に使われているのみ。本 plan ではリンクの基本表示確認は PageObject の locator 追加に留める（実 spec 化は別 plan）
- **URL の constants ファイル新設**: URL 2 件のみで早すぎる抽象。`src/lib/external-links.ts` 新設はせず、`page.tsx` 内 const に閉じる（CLAUDE.md「3 行類似ロジックは早すぎる抽象より具体」方針）
- **既存記事ファイル（`docs/article/*.md`）への変更**: ローカル原稿は note 公開済みコピーであり本 plan は読み出すのみ。frontmatter の `last_updated` 等を触らない
- **PWA manifest / service-worker / install promotion への変更**: 既存の `IOsInstallHint` / `PwaInstallPromotion` の振る舞いに影響しない範囲で追加。`manifest.ts` の `start_url` / `scope` は触らない
- **PRD 本文の改訂（タイトル / Implementation Phases / Problem Statement の Track 化）**: 同日中に別作業として実施済み（旧 `05-result-card-image-bg` を `05-post-launch-polish` にリネーム + Track A/B 化）。本 plan のコード変更スコープは note リンク追加のみで、PRD ドキュメント編集は含まない
- **新規 lucide アイコン以外の依存追加**: `lucide-react` は既存依存（`PwaInstallPromotion` で使用済み）。`ExternalLink` icon もその一部で追加コストなし
- **ログイン状態によるリンク出し分け**: 「未ログインなら紹介、ログイン済みなら運営ガイド」のような出し分けはしない。両方常時表示することで「未導入の人がトップを見たときに即座に何のアプリか分かる」かつ「既存運営者がいつでも操作リファレンスに飛べる」両方を成立させる

---

## Step-by-Step Tasks

### Task 1: page.tsx に note 記事 URL の const を追加

- **ACTION**: `src/app/page.tsx` の冒頭 import 群直下に、2 つの URL 定数と短いコメントを置く
- **IMPLEMENT**:

```tsx
// note 公開記事への外部リンク。値は note 上で公開しているそれぞれの記事 URL。
// 記事原稿（更新差分の参照元）は docs/article/note-article.md / operating-guide.md。
const NOTE_INTRO_ARTICLE_URL = "<NOTE_INTRO_URL>"; // TODO: 実装時に確定
const NOTE_OPERATING_GUIDE_URL = "<NOTE_GUIDE_URL>"; // TODO: 実装時に確定
```

- **MIRROR**: `NAMING_CONVENTION (constants in component file)` セクション
- **IMPORTS**: 不要（const 追加のみ）
- **GOTCHA**:
  - URL は **必ず https://** から始まる絶対 URL。`<Link>` 経由ではなく `<a>` で開くため、相対 URL を入れるとサイト内リンクとして解釈される
  - `"<NOTE_INTRO_URL>"` のような placeholder のままビルドしないこと（実装時にユーザに確定 URL を貰ってから commit）
- **VALIDATE**: `npm run typecheck` がエラーなく通ること

### Task 2: ExternalLink icon を import

- **ACTION**: 既存 import 群に `lucide-react` から `ExternalLink` を追加
- **IMPLEMENT**:

```tsx
import { ExternalLink } from "lucide-react";
```

- **MIRROR**: `src/components/pwa/PwaInstallPromotion.tsx:3` の `import { Download, X } from "lucide-react";` と同形式
- **IMPORTS**: `lucide-react`（既存依存）
- **GOTCHA**: なし（lucide-react は既に依存に含まれているため `npm install` 不要）
- **VALIDATE**: `npm run typecheck` 通過 / IDE で import error が出ないこと

### Task 3: note 記事 2 本のリンクセクションを `<main>` 内に追加

- **ACTION**: 既存の sign-in / sign-out CTA `<div>`（`page.tsx:26-43`）の直下に、外部リンク 2 件を並べる新セクションを追加。常時表示なので `loading` / `signedIn` の三項分岐の **外側** に置く
- **IMPLEMENT**:

```tsx
<section
  aria-labelledby="external-articles-heading"
  className="flex w-full flex-col items-center gap-2 border-t border-border pt-6"
>
  <h2
    id="external-articles-heading"
    className="text-xs font-medium text-muted-foreground"
  >
    詳しく知る
  </h2>
  <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-center">
    <Button variant="link" size="sm" asChild>
      <a
        href={NOTE_INTRO_ARTICLE_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="アプリ紹介を読む（新しいタブで開く）"
      >
        アプリ紹介を読む
        <ExternalLink className="size-3" aria-hidden="true" />
      </a>
    </Button>
    <Button variant="link" size="sm" asChild>
      <a
        href={NOTE_OPERATING_GUIDE_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="運営ガイド（操作チートシート）を読む（新しいタブで開く）"
      >
        運営ガイド（操作チートシート）
        <ExternalLink className="size-3" aria-hidden="true" />
      </a>
    </Button>
  </div>
  <p className="text-[11px] text-muted-foreground">※ 新しいタブで note の記事を開きます</p>
</section>
```

- **MIRROR**: `EXTERNAL_LINK_PATTERN` セクション + 既存 `main` の Tailwind クラス命名（`flex flex-col items-center gap-N` / `text-muted-foreground`）
- **IMPORTS**: `Button`（既存）/ `ExternalLink`（Task 2 で追加）
- **GOTCHA**:
  - `Button asChild` を使うと **Button 自身は `<button>` タグを描画せず、子の `<a>` に Button のスタイルだけを当てる**。これにより role は `link` になり、既存 e2e の `getByRole("button", { name: "ログイン / 新規登録" })` 等を汚染しない
  - `<Button asChild>` の **直下に複数要素を並べると Slot エラー**（Slot は単一子要素のみ受け付ける）。`<a>` が単一の子要素になるよう `<a>...</a>` 内にテキストとアイコンを並べる
  - `target="_blank"` は **必ず `rel="noopener noreferrer"` 併記**。片方だけだと SonarQube / ESLint react/jsx-no-target-blank で警告
  - `aria-label` を付けると visible text（"アプリ紹介を読む"）は読み上げられない。**aria-label にもテキスト全体を含める**こと（"アプリ紹介を読む（新しいタブで開く）"）
  - `<ExternalLink>` icon は装飾。`aria-hidden="true"` を付けて SR が「外部リンクのアイコン、画像」のように読み上げないようにする
  - サイズは `size-3` (= 12px) で text-sm（14px）行よりやや小さく、視覚的にバランスを取る
- **VALIDATE**:
  - `npm run dev` で `/` を開き、両リンクをクリックして新しいタブで note 記事が開くこと
  - sign-out / sign-in 両状態で 2 リンクが visible であること
  - DevTools Inspect で `<a>` の `target="_blank"` / `rel="noopener noreferrer"` が反映されていること
  - SR（NVDA / VoiceOver）で「アプリ紹介を読む、新しいタブで開く、リンク」と読み上げられること（手動確認）

### Task 4: TopPage PageObject に link locator を追加

- **ACTION**: `tests/e2e/pages/TopPage.ts` に `noteIntroLink` / `noteOperatingGuideLink` の Locator を追加し、`expectSignedOutLayout` / `expectSignedInLayout` 内で **両者の visible を assert**
- **IMPLEMENT**:

```ts
readonly noteIntroLink: Locator = this.page.getByRole("link", {
  name: /アプリ紹介を読む/,
});
readonly noteOperatingGuideLink: Locator = this.page.getByRole("link", {
  name: /運営ガイド（操作チートシート）/,
});
```

そして `expectSignedOutLayout` の末尾に:

```ts
await expect(this.noteIntroLink).toBeVisible();
await expect(this.noteOperatingGuideLink).toBeVisible();
```

`expectSignedInLayout` の末尾にも同様に 2 行追加。

- **MIRROR**: `tests/e2e/pages/TopPage.ts:6-13` の locator 命名（camelCase / `Locator = this.page.getByRole(...)` 形式）
- **IMPORTS**: 既存（変更なし）
- **GOTCHA**:
  - `aria-label` の文字列全体は「アプリ紹介を読む（新しいタブで開く）」だが、`getByRole` は visible text と aria-label を結合した accessible name を見るため、**正規表現 `/アプリ紹介を読む/` で部分マッチ**するのが安全
  - `getByRole("button", ...)` ではなく **`getByRole("link", ...)`** で取る（asChild + a タグなので role は link）
  - 全角の括弧（`（` / `）`）はそのまま正規表現リテラル内に書ける（特殊文字ではない）
- **VALIDATE**:
  - 既存 e2e spec の中で TopPage を使っている `tests/e2e/phase-d-install-promotion.spec.ts` / `pwa-foundation.spec.ts` / `note-screenshots.spec.ts` を 1 件 dry run（`npx playwright test pwa-foundation.spec.ts`）し、PageObject の追加 assertion で fail しないこと
  - 全文 `npx playwright test` で regression が出ないこと（auth / dashboard 系 spec が TopPage を経由する場合に新 locator の visible 失敗で死なないように、両 layout に追記済み）

---

## Testing Strategy

### Unit Tests

このサイズ（`page.tsx` の static link 追加）では unit test は省略する。理由:

- `page.tsx` は client component で、内部に副作用ロジック（`useAuthUser` の読み取り）を持つが、本 plan で追加するのは **静的な `<a>` 要素のみ**で、テストすべき pure function / hook の挙動が無い
- リンクの存在 / target / rel 属性 / aria-label は **e2e の PageObject + 既存 spec を経由した間接検証**で十分（Task 4 で対応）
- testing.md の規約「ステップ 2: 要件を満たすテストを書く」の対象は「**観測可能な振る舞い**」。本 plan の振る舞いは「リンクが見える / クリックで note が開く」で、これは e2e の責務

### Edge Cases Checklist

- [x] sign-out 状態で 2 リンクが両方表示される（Task 4 で TopPage.expectSignedOutLayout に追記）
- [x] sign-in 状態で 2 リンクが両方表示される（Task 4 で TopPage.expectSignedInLayout に追記）
- [x] loading 中（`useAuthUser().loading === true`）でもリンクは表示される（Task 3 で三項分岐の外側に配置）
- [x] PWA standalone モードで `target="_blank"` を踏むと標準ブラウザで開く（OS 依存だが想定動作。手動確認のみ）
- [x] `rel="noopener noreferrer"` が付与されているか（Task 3 / DevTools 手動確認）
- [x] アイコンが SR で読み上げられないか（`aria-hidden="true"` 確認、Task 3）
- [x] URL placeholder のままビルドされないか（Task 1 GOTCHA、実装時に確定 URL に置換）

---

## Validation Commands

### Static Analysis

```powershell
npm run typecheck
```

EXPECT: Zero type errors

```powershell
npm run lint
```

EXPECT: Zero lint errors（特に `react/jsx-no-target-blank` が green であること）

### Unit Tests

```powershell
npm run test
```

EXPECT: 既存 unit test 全 pass、regression なし（本 plan は unit test 追加なし）

### Build Validation

```powershell
npm run build
```

EXPECT: Next.js build green。`page.tsx` の compile error 無し

### Browser Validation

```powershell
npm run dev
```

その後ブラウザで http://localhost:3000/ を開いて以下を手動確認:

- [ ] sign-out 状態（cookie / localStorage クリア後）で 2 リンクが見える
- [ ] sign-in 状態（適当なテストアカウントでログイン後）で 2 リンクが見える
- [ ] 両リンクが新しいタブで開く（Ctrl+クリックではなく通常クリックで別タブが開く）
- [ ] 開いたタブの URL が正しく note 記事に到達している
- [ ] DevTools の Inspect で `<a target="_blank" rel="noopener noreferrer" aria-label="...">` を確認
- [ ] DevTools のレスポンシブモード（モバイル幅 360px）でリンクが折り返さず読みやすい

### E2E Validation（PageObject 追加分）

```powershell
npx playwright test tests/e2e/pwa-foundation.spec.ts
```

EXPECT: 既存 spec が green（TopPage の 2 link locator が visible で fail しないこと）

```powershell
npx playwright test
```

EXPECT: 全 e2e spec green

### Manual Validation

- [ ] sign-out 状態でトップを開く → ログインボタン + 2 link が表示
- [ ] sign-in 状態（owner / organizer / member 各 1 アカウント）でトップを開く → サークル一覧 / トーナメント一覧 + 2 link が表示
- [ ] 「アプリ紹介を読む」をクリック → 新タブで note の紹介記事 URL が開く
- [ ] 「運営ガイド（操作チートシート）」をクリック → 新タブで note のチートシート記事 URL が開く
- [ ] iPhone Safari で同操作 → 新タブで note 記事が開く（PWA standalone でも同様）
- [ ] Android Chrome で同操作 → 同上
- [ ] PWA をホーム画面に追加した状態で起動 → 同操作で別タブまたは外部ブラウザで note が開く（PWA scope 外なので OS デフォルト動作）
- [ ] スクリーンリーダ（NVDA / VoiceOver）で 2 リンクが「新しいタブで開く」と読み上げられる

---

## Acceptance Criteria

- [ ] Task 1〜4 がすべて完了
- [ ] `npm run typecheck` / `npm run lint` / `npm run build` が green
- [ ] `npx playwright test` が green
- [ ] sign-out / sign-in / loading 各状態で 2 リンクが visible
- [ ] 両リンクが新タブで note 記事を開き、`rel="noopener noreferrer"` / `aria-label`（新しいタブで開く）が付与されている
- [ ] e2e PageObject `TopPage.ts` に 2 link locator が追加され、`expectSignedOutLayout` / `expectSignedInLayout` で visible 検証されている

## Completion Checklist

- [ ] コードが既存パターン（`Button asChild` + `<a>` + `lucide-react` icon）を踏襲
- [ ] エラーハンドリング不要（static link のみ、AppError ラップ対象なし）
- [ ] ログ出力不要（副作用なし）
- [ ] テストは既存 PageObject の locator 追加で対応（unit test 追加なし、testing.md 準拠）
- [ ] URL は実装時に placeholder から確定値に置換済み
- [ ] PRD 本文（`05-post-launch-polish.prd.md`）の Implementation Phases にコード変更外の追加編集をしていない（リネームと Track 化は別作業として実施済み、本 plan は Phase B.1 として参照される側）
- [ ] スコープ外の改善（constants ファイル新設・新規 e2e spec・PWA manifest 変更）に手を出していない
- [ ] commit メッセージは日本語（CLAUDE.md 規約）。例: `feat: トップ画面に note 記事 2 本への外部リンクを追加`

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| 実装時に URL が確定しないまま placeholder で commit される | M | 本番でリンクが 404 になる | Task 1 の GOTCHA で明示。実装直前にユーザに最終 URL を確認 |
| `Button asChild` の Slot エラー（複数子要素を並べる）で build fail | L | ビルドが落ちる | Task 3 GOTCHA に明示。`<a>` を単一子要素として、その内側にテキスト + アイコンを並べる |
| 既存 e2e spec が `TopPage.expectSignedOutLayout` を呼んだとき、新 link が表示されないテスト環境（feature flag 等）があると fail する | L | regression | 本 plan ではリンクを feature flag せず常時表示にしているため、e2e は素直に green になる前提 |
| PWA standalone モードでの target="_blank" 挙動が iOS / Android / Desktop で異なる | L | UX 不統一 | OS デフォルト動作で十分（仕様として「外部記事は外部ブラウザで開く」が自然）。手動確認で OK 判定 |
| note 記事が将来削除・URL 変更されたときにリンク切れ | L | UX 軽微（404） | URL 定数を `page.tsx` 冒頭に集約しているため、URL 変更時の修正点が 1 ファイルに閉じる |
| 新リンクが既存 e2e の `getByRole("button")` を汚染する | L | 既存 spec の broken | `Button asChild` + `<a>` で role は "link" になるため "button" には混ざらない（mitigated by design）|

## Notes

### URL placeholder の運用

- 実装中は `<NOTE_INTRO_URL>` / `<NOTE_GUIDE_URL>` の placeholder で進める
- `npm run dev` で動作確認するときは、ローカルでだけ仮 URL（`https://note.com/`）を入れて挙動を見る
- commit 直前にユーザから最終 URL を貰い、constants を確定値に置換してから commit
- 本 plan ファイル（このファイル）には URL を一切埋めない（公開リポジトリに上がるため、運営者個人の note アカウントが特定される情報は plan ドキュメントに残さない）

### PRD 本文の包含化（実施済み）

旧 PRD `05-result-card-image-bg` は同日中に `05-post-launch-polish` にリネーム済み:

- フォルダ `.claude/PRPs/05-result-card-image-bg/` → `.claude/PRPs/05-post-launch-polish/` に git mv
- PRD ファイル `05-result-card-image-bg.prd.md` → `05-post-launch-polish.prd.md` に git mv
- PRD タイトルを「Post-Launch Polish（リリース後の小規模 UX 改善・プロモーション集約 PRD）」に変更
- 既存内容を「Track A: Result Card Background Image」として group 化
- 「Track B: Top Page Promotion」を新設し、本 plan を Phase B.1 として位置付け
- Implementation Phases 表を A.1 / A.2 / A.3 / B.1 の 4 行に再編

本 plan の `Source PRD` / `PRD Phase` も新 path / Phase B.1 に更新済み。今後の小規模 UX 改善 plan は
Track B 配下（または新設 Track 配下）に sequential に追加していく。

### 配置の意図

- セクション小見出し「詳しく知る」+ 説明文「※ 新しいタブで note の記事を開きます」を入れたのは、
  WCAG 3.2.5（On Request）配慮: ユーザが外部ナビゲーションを期待していない状態で別タブが開くと
  混乱の元になるため、明示的に通知する
- リンク variant を `link` にしたのは、メイン CTA（`default` / `outline` のソリッドボタン）を
  邪魔せず、補助情報として控えめに見せる意図
- sm 上で `flex-row`、それ未満で `flex-col` にしているのは、モバイル幅で 2 リンクが横並びだと
  押しづらくなるため

### 用語ポリシー準拠の確認

`docs/article/conventions/terminology-policy.md` の禁止語リストと照合:

- 「note」: 禁止語ではない（読者にとって馴染みのある外部サービス名として OK）
- 「アプリ紹介」「運営ガイド」「操作チートシート」「新しいタブ」: いずれも非エンジニアにわかる日常語
- 「note の記事」: OK（プラットフォーム名としての note）
- 技術スタック名（Next.js / React / TypeScript 等）は本 UI 上には登場しない

### 関連 skill 参照

- accessibility (a11y-architect): WCAG 2.2 観点でのリンク a11y チェック
- design-system: Button variant=link / size=sm の控えめ表現
- testing.md: PageObject 拡張 + 新規 spec を作らずに済ませる判断根拠
