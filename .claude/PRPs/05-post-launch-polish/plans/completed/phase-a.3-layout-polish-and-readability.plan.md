# Plan: Track A Phase A.3 — Layout Polish & Readability

## Summary

Phase A.2 で OG SSR route が背景画像 + 単色 30% scrim + textTheme（foreground のみ反転）を出すところまでは動くが、
任意の画像（白文字 + 白背景 / 暗背景 + 暗テキストなど）で**テキストが読めなくなる readability 破綻**が残っている。
本 phase では「上下グラデーション scrim」+「テキストグループ単位 rgba 半透明 box overlay」+「light / dark theme と
foreground / box の二段切替」の三段構えで OG カードを polish し、サークル詳細プレビューにも同じ layer を反映する。
あわせて A.2 で deferred されていた `window.confirm` → shadcn `<Dialog>` 統一（F-7）と、E2E（upload → 保存 →
OG download の通し）を仕上げてドライラン投入準備を完了させる。

## User Story

As a サークル代表（owner）+ 共有先で結果カードを目にする一般メンバー / 第三者,
I want **任意の背景画像** + ライト / ダーク テーマで、優勝者名・トーナメント名・順位ポイントが
**確実に読める結果カード**を出力したい。サークル詳細編集画面では保存前に**実画像と同じ readability 表現**で
プレビューを確認したい,
So that ドライラン投入時に「装飾はオシャレだが文字が読みにくい」というネガティブ反応を出さず、SNS / LINE 共有時に
**カードとして使える PNG** が成立する確信を持って owner が背景を選べる。

## Problem → Solution

[現状（Phase A.2 完了時点）]

- OG route の readability layer は「`rgba(0,0,0,0.3)` の単色 black scrim」 + 「foreground 色のみ light / dark
  切替（`winnerFg` ⇄ `winnerFgDark` / `seasonFg` ⇄ `seasonFgDark`）」のみ
  - 明るい画像 + ライト テーマ → foreground は `#451a03`（暗茶）。**白っぽい画像で文字が薄く埋もれる**
  - 暗い画像 + ダーク テーマ → foreground は `#fef3c7`（薄黄）。**画像のハイライトと干渉**
  - 中間明度の画像 → 単色 30% scrim では不足、特に中央 WINNER 大文字 120px がコントラスト破綻
- サークル詳細編集カード（`CardBackgroundCard` のプレビュー領域）は **画像のみで scrim / box overlay を持たない**。
  保存後の OG PNG を別タブで開かないと最終見栄えが分からない
- 削除確認ダイアログが `window.confirm`（A.2 review F-7 で deferred）。`LeaveDeleteDialogs` の shadcn `<Dialog>`
  パターンに揃っておらず、SSR ガード / E2E dialog handler が変則
- A.2 で deferred された **E2E（upload → 保存 → OG download → 画像内容 assert）が未着手**
- `OG_PADDING = 64` のフラット padding ですべての要素が貼り付いており、読みやすさのための余白設計がない

→

[望ましい状態（Phase A.3 完了時点）]

- OG route の readability layer が三段構え:
  1. **上下グラデーション scrim** — 上端から 25% 高さまで `rgba(0,0,0,0.55) → rgba(0,0,0,0)`、
     下端から 20% 高さまで同方向。中央 60% は画像をフラットに見せる
  2. **テキストグループ単位 rgba 半透明 box overlay** — タイトル行 / 中央 WINNER ブロック / footer の
     各テキスト塊に、textTheme に対応する rgba `padding + border-radius` 付き box を巻く
     （light: `rgba(255,255,255,0.78)` + 暗 foreground、dark: `rgba(15,23,42,0.72)` + 明 foreground）
  3. **既存 foreground 色切替** — 既存の `winnerFg` / `winnerFgDark` / `seasonFg` / `seasonFgDark` を継続使用
- サークル詳細編集カードのプレビューが OG SSR と**完全同型**の readability layer を反映:
  - scrim グラデ + box overlay + textTheme 切替の見え方を編集画面で確認できる
  - 反映ロジックは `og-card-styles.ts` から共有可能な定数を export し、プレビューと OG route で同じ値を使用
- `window.confirm("背景画像を解除します...")` → shadcn `<Dialog>` 確認ダイアログ（`LeaveDeleteDialogs` と同型）
- E2E spec `tests/e2e/card-background.spec.ts` 新規:
  - owner が gid 配下 settings タブを開く
  - file input に `setInputFiles` でテスト用 PNG を流し込む
  - 「保存」 → flash 表示 → groups doc に `winnerCardBackground.imageUrl != null` が反映
  - dashboard で `/api/og/winner/[tid]?bgImageUrl=...` を request.get → 200 + image/png + PNG magic header
- 運営ガイド note 記事用の本リポジトリ side ドキュメントに「背景画像のおすすめ条件」(1200×630 / jpeg /
  「単色領域があると box overlay が見やすい」「過度に明暗が分かれる画像は避ける」) を追記

## Metadata

- **Complexity**: Medium（10〜13 ファイル、300〜500 行。OG route readability layer + プレビュー共有
  + Dialog 置換 + E2E + ドキュメント。新規 invention は最小限で既存パターンの組換が主）
- **Source PRD**: [.claude/PRPs/05-post-launch-polish/prds/05-post-launch-polish.prd.md](../prds/05-post-launch-polish.prd.md)
- **PRD Phase**: A.3（Track A: Layout Polish & Readability）
- **Estimated Files**:
  - 新規: 2 件
    - `tests/e2e/card-background.spec.ts`（E2E spec）
    - `src/app/api/og/_lib/og-readability.tsx`（scrim / box overlay JSX helper、OG route とプレビューで共有）
  - 更新: 8〜10 件
    - `src/app/api/og/_lib/og-card-styles.ts`（scrim / box overlay 色定数 export 追加）
    - `src/app/api/og/winner/[tid]/route.tsx`（readability layer 差替）
    - `src/app/api/og/season/[gid]/route.tsx`（同上）
    - `src/app/groups/[gid]/_components/CardBackgroundCard.tsx`（プレビュー reflect + window.confirm 置換）
    - `src/app/groups/[gid]/_components/CardBackgroundCard.test.tsx`（confirm dialog テスト追従）
    - `src/components/og/CardReadabilityPreview.tsx`（プレビュー overlay component、新規）
    - `README.md` / `docs/operating-guide.md` のいずれか existing ドキュメント（運営ガイド section）
    - 必要に応じて `og-payload.test.ts`（layout 変更で URL 出力が変わらないことを確認）

---

## UX Design

### Before

```
┌─────────────────────────────────────────────────────────┐
│  ┌── サークル詳細 > 設定タブ ──────────────────┐         │
│  │ 優勝者カード背景画像                          │         │
│  │ ┌─ プレビュー 1200×630 比率 ─────────────┐  │         │
│  │ │ [画像のみ。文字オーバーレイなし]            │  │         │
│  │ │ 文字の見え方がここで分からない              │  │         │
│  │ └─────────────────────────────────────┘  │         │
│  │ テキストテーマ: (●) ライト  ( ) ダーク       │         │
│  │ [ファイルを選択] [保存] [背景を解除]         │         │
│  └─────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────┘
       ↓ 保存
┌─────────────────────────────────────────────────────────┐
│ /api/og/winner/[tid]  (OG PNG output)                   │
│                                                          │
│ TOURNAMENT CHAMPION   ← 単色 30% scrim 越しの裸テキスト     │
│ サンプル杯                                                │
│ 2026/5/12                                                 │
│        WINNER                                            │
│       たろう  120px                                        │
│       8 人参加                                            │
│              ALLin-PokerTimer                            │
└─────────────────────────────────────────────────────────┘
```

### After

```
┌─────────────────────────────────────────────────────────┐
│  ┌── サークル詳細 > 設定タブ ──────────────────┐         │
│  │ 優勝者カード背景画像                          │         │
│  │ ┌─ プレビュー 1200×630 比率 ─────────────┐  │         │
│  │ │░░ 上端 25% に黒グラデ scrim ░░░░░░░░░░│  │         │
│  │ │ ┌── rgba box: title ────────────────┐  │  │         │
│  │ │ │ TOURNAMENT CHAMPION (上に box)     │  │  │         │
│  │ │ └────────────────────────────────────┘  │  │         │
│  │ │       ┌── rgba box: WINNER 中央 ────┐  │  │         │
│  │ │       │ WINNER  たろう  8 人参加     │  │  │         │
│  │ │       └────────────────────────────┘  │  │         │
│  │ │  ┌── rgba box: footer ──────────────┐  │  │         │
│  │ │  │             ALLin-PokerTimer    │  │  │         │
│  │ │  └────────────────────────────────┘  │  │         │
│  │ │░░ 下端 20% に黒グラデ scrim ░░░░░░░░░░│  │         │
│  │ └─────────────────────────────────────┘  │         │
│  │ テキストテーマ: (●) ライト  ( ) ダーク       │         │
│  │ [ファイルを選択] [保存] [背景を解除]         │         │
│  └─────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────┘
       ↓ 保存
┌─────────────────────────────────────────────────────────┐
│ /api/og/winner/[tid]  (OG PNG output、プレビューと完全同型) │
└─────────────────────────────────────────────────────────┘

「背景を解除」ボタン押下時:
┌─ shadcn <Dialog> 確認 ─────────────────────┐
│ 背景画像を解除しますか？                       │
│ 解除後は固定グラデーション背景に戻ります。      │
│ [キャンセル]  [背景を解除する]                 │
└─────────────────────────────────────────┘
（window.confirm から置換）
```

### Interaction Changes

| Touchpoint                                  | Before                                                  | After                                                                                                              | Notes                                              |
| ------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| OG winner PNG (`/api/og/winner/[tid]?bg=`)   | 30% black scrim + foreground 色のみ                     | 上下グラデ scrim + テキスト 3 ブロックの rgba box + foreground / box が theme で対称切替                            | bgImageUrl 未指定時は完全に既存挙動                |
| OG season PNG (`/api/og/season/[gid]?bg=`)   | 同上                                                    | 同上 (タイトル / ポディアム / footer の 3 ブロック)                                                                | 同上                                               |
| サークル詳細編集カード プレビュー                  | 画像 raw 表示                                            | OG route と同型の scrim + box overlay を JSX で再現（textTheme 切替もプレビュー即時反映）                            | 編集中の textTheme が即時プレビュー反映              |
| 「背景を解除」ボタン                            | `window.confirm`                                        | shadcn `<Dialog>` 確認（`LeaveDeleteDialogs` と同型 / variant="destructive" ボタン）                                | E2E dialog handler 不要 / SSR ガード不要              |
| E2E カバレッジ                                | カバレッジなし                                          | upload → 保存 → /api/og/winner request.get → 200 + image/png                                                       | Storage emulator + groups doc + OG route の通し検証 |

---

## Mandatory Reading

実装前に必ず読むファイル:

| Priority       | File                                                                                                                                                          | Lines     | Why                                                                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0 (critical)  | [src/app/api/og/winner/[tid]/route.tsx](../../../../src/app/api/og/winner/[tid]/route.tsx)                                                                    | 1-224     | 既存の bg / scrim JSX 構造（行 79-192）を share component に差替える起点。`bgDataUri` の null 分岐、`fg` 解決、root flex container 構造を把握する                                                                       |
| P0 (critical)  | [src/app/api/og/season/[gid]/route.tsx](../../../../src/app/api/og/season/[gid]/route.tsx)                                                                    | 1-270     | 同上 season（行 129-238）。`PodiumRow` (行 38-86) はテキストブロック化されているが、本 phase で 3 ブロック（title / podium / footer）に rgba box を巻く                                                                  |
| P0 (critical)  | [src/app/api/og/_lib/og-card-styles.ts](../../../../src/app/api/og/_lib/og-card-styles.ts)                                                                    | 1-32      | `OG_COLORS` / `OG_PADDING` の真実源。A.3 で `bgScrimTop` / `bgScrimBottom` / `bgBoxLight` / `bgBoxDark` / `bgBoxRadius` / `bgBoxPaddingX` 等を additive 追加する箇所                                                  |
| P0 (critical)  | [src/app/groups/[gid]/_components/CardBackgroundCard.tsx](../../../../src/app/groups/[gid]/_components/CardBackgroundCard.tsx)                                | 1-407     | プレビュー領域（行 287-308）と onClear の `window.confirm`（行 230-239）。プレビュー差替と Dialog 置換の起点                                                                                                          |
| P0 (critical)  | [src/app/groups/[gid]/_components/LeaveDeleteDialogs.tsx](../../../../src/app/groups/[gid]/_components/LeaveDeleteDialogs.tsx)                                | 1-95      | shadcn `<Dialog>` 確認ダイアログのテンプレ。`open` / `onOpenChange` の useState の組み立て、`Button variant="destructive"` の配置を mirror                                                                            |
| P0 (critical)  | [src/components/ui/dialog.tsx](../../../../src/components/ui/dialog.tsx)                                                                                      | all       | 使用可能な subcomponent（`Dialog` / `DialogContent` / `DialogHeader` / `DialogTitle` / `DialogDescription` / `DialogFooter`）。本 phase の AlertDialog 置換で新規 import を増やさない              |
| P0 (critical)  | [src/app/api/og/_lib/og-payload.ts](../../../../src/app/api/og/_lib/og-payload.ts)                                                                            | 1-296     | `bgImageUrl` / `bgTextTheme` の query schema。本 phase では schema 変更なし、参照のみ                                                                                                                                  |
| P0 (critical)  | [src/app/groups/[gid]/_components/CardBackgroundCard.test.tsx](../../../../src/app/groups/[gid]/_components/CardBackgroundCard.test.tsx)                      | all       | confirm 経路の既存 stub と、新 Dialog 置換時のテスト書換ポイント                                                                                                                                                       |
| P1 (important) | [src/lib/firebase/schemas/group.ts](../../../../src/lib/firebase/schemas/group.ts)                                                                            | 85-216    | `CardBackground` / `CARD_TEXT_THEMES` / `cardBackgroundSchema`。本 phase は schema 変更なし、type / 定数 import のみ                                                                                                |
| P1 (important) | [tests/e2e/phase-d-share-and-history.spec.ts](../../../../tests/e2e/phase-d-share-and-history.spec.ts)                                                        | 1-66      | `/api/og/winner/[tid]` の HTTP layer assert pattern。本 phase の E2E 雛形として mirror（PNG magic header check / Content-Disposition）                                                                              |
| P1 (important) | [tests/e2e/fixtures/flows.ts](../../../../tests/e2e/fixtures/flows.ts)                                                                                        | all       | `seedOrganizerTournament` / `randomOrganizer` / `registerOrganizer` / `createGroup` ヘルパ。本 phase の E2E は owner として group + tournament を seed し、settings タブ操作する                                       |
| P1 (important) | [tests/e2e/pages/GroupsPage.ts](../../../../tests/e2e/pages/GroupsPage.ts)                                                                                    | all       | PageObject pattern。E2E では setting tab で card-background section に到達する new PageObject method を追加するか、test 内で `page.goto(/groups/{gid}?tab=settings)` 直接遷移を選ぶ                                  |
| P1 (important) | [src/app/groups/[gid]/_components/AudioSettingsCard.tsx](../../../../src/app/groups/[gid]/_components/AudioSettingsCard.tsx)                                  | 1-226     | プレビュー領域なしの参考。working / savedFlash / onSaved / onError 規約は AudioSettingsCard と整合させる                                                                                                              |
| P1 (important) | [src/app/groups/[gid]/group-detail-client.tsx](../../../../src/app/groups/[gid]/group-detail-client.tsx)                                                      | 470-505   | A.2 で実装済の `WinnerCardBackgroundCard` / `SeasonCardBackgroundCard` 呼出点。本 phase では呼出側変更なし                                                                                                            |
| P1 (important) | [.claude/PRPs/05-post-launch-polish/reviews/local-phase-a.2-review.md](../reviews/local-phase-a.2-review.md)                                                  | all       | F-1〜F-7 の review findings。本 phase 着手前に **F-1 / F-2 / F-3 / F-4 / F-5 / F-6 がすべて A.2 マージ前に修正済み**であることを確認済（残るは F-7 のみ）                                                              |
| P2 (reference) | [.claude/PRPs/05-post-launch-polish/plans/completed/phase-a.2-background-image-ui-and-ssr.plan.md](./completed/phase-a.2-background-image-ui-and-ssr.plan.md) | all       | A.2 の設計判断と GOTCHA。**重複実装を避けるため必読**。特に scrim / theme 切替の暫定実装を Phase A.3 で「本格 polish に倒す」と明示している箇所                                                                          |
| P2 (reference) | [.claude/PRPs/05-post-launch-polish/reports/phase-a.2-background-image-ui-and-ssr-report.md](../reports/phase-a.2-background-image-ui-and-ssr-report.md)      | all       | A.2 deviations。特に `live-client.tsx` の URL 組立、`CardBackgroundCard` テストでの jsdom 制約、retry test の fakeTimers 問題は本 phase でも再発し得る                                                                |
| P2 (reference) | [.claude/rules/error-logging.md](../../../../.claude/rules/error-logging.md)                                                                                  | all       | `AppError.from` / `unwrapOrFrom` / `getErrorCode` の使い分け。本 phase は新規 throw が少ないが Dialog 経由の onClear で既存 `unwrapOrFrom` 経路を維持する                                                              |
| P2 (reference) | [.claude/rules/testing.md](../../../../.claude/rules/testing.md)                                                                                              | all       | テスト規約（observable behavior / mock 境界）。本 phase の OG route テストは「URL 経由で PNG が返る / 文字位置 / box 数」を観測可能な layer で assert する                                                              |

## External Documentation

| Topic                                          | Source                                                                                                          | Key Takeaway                                                                                                                                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Satori supported CSS                            | <https://github.com/vercel/satori#css>                                                                          | `linear-gradient` は `background` プロパティに、`rgba()` は `backgroundColor` / `background` に許容。`borderRadius` / `padding` / `display: flex` も対応。**`backdropFilter` / `filter` は未対応** |
| Satori absolute / relative positioning          | <https://github.com/vercel/satori#supported-html-elements>                                                      | `position: absolute` の child は親の `position: relative` 必須。本 phase の scrim は `absolute inset-0` で root に直接重ねる                                                                |
| Satori flex / inline-flex                       | <https://github.com/vercel/satori#supported-html-elements>                                                      | Satori は **全要素デフォルト flex** 扱い。テキスト box の rgba 背景は `display: inline-flex` + `padding` で表現すると意図通り gid (group of contents) を囲える                                |
| WCAG コントラスト計算（reference）             | <https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html>                                            | 本 phase は装飾用 PNG のため strict WCAG 適合は範囲外。ただし「大文字 = 18pt 以上 → コントラスト比 3:1」を念頭に rgba box の透過率を決める                                                       |
| Next.js Route Handlers + ImageResponse          | <https://nextjs.org/docs/app/api-reference/file-conventions/route#dynamic-route-handlers>                       | route handler は引き続き Node runtime（`export const runtime = "nodejs"`）。本 phase は JSX 構造のみ変更                                                                                       |

---

## Patterns to Mirror

すべて既存コードから抽出した実コードスニペット。新規発明は最小限。

### OG_CARD_SCRIM_LAYER（既存 30% black scrim ─ 本 phase で grad 化）

```ts
// SOURCE: src/app/api/og/winner/[tid]/route.tsx:104-115
{bgDataUri ? (
  <div
    style={{
      position: "absolute",
      top: 0,
      left: 0,
      width: "100%",
      height: "100%",
      background: OG_COLORS.bgScrim,
    }}
  />
) : null}
```

A.3 では `bgScrim` を `bgScrimTopGradient` / `bgScrimBottomGradient` に分割し、2 つの div を重ねる:

```ts
// 新規: 上端から 25% 高さの黒グラデ
<div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
              background: OG_COLORS.bgScrimTopGradient }} />
// 新規: 下端から 20% 高さの黒グラデ
<div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
              background: OG_COLORS.bgScrimBottomGradient }} />
```

### OG_CARD_TEXT_BOX（A.3 新規 — テキストグループに rgba box overlay）

A.2 では各テキスト行が裸で foreground 色のみだったが、A.3 では box で grouping する:

```ts
// 既存（A.2、winner route 行 134-156）:
<div style={{ display: "flex", fontSize: 56, fontWeight: 700, letterSpacing: 2 }}>
  TOURNAMENT CHAMPION
</div>
<div style={{ display: "flex", marginTop: 24, fontSize: 36, fontWeight: 700 }}>
  {q.tournamentName}
</div>
<div style={{ display: "flex", marginTop: 8, fontSize: 24, opacity: 0.75 }}>
  {q.finishedAtLabel}
</div>

// A.3 で gid 化（タイトル 3 行を 1 つの rgba box にまとめる、bgDataUri 時のみ）:
<div
  style={{
    display: "flex",
    flexDirection: "column",
    backgroundColor: bgDataUri ? OG_COLORS.bgBoxLight : "transparent",
    borderRadius: bgDataUri ? OG_COLORS.bgBoxRadius : 0,
    padding: bgDataUri ? `${OG_COLORS.bgBoxPaddingY}px ${OG_COLORS.bgBoxPaddingX}px` : 0,
    color: fg,
  }}
>
  <div style={{ display: "flex", fontSize: 56, fontWeight: 700, letterSpacing: 2 }}>
    TOURNAMENT CHAMPION
  </div>
  ...
</div>
```

### OG_THEME_RESOLUTION（既存 theme → foreground 色 / 新規: box 色も同時に解決）

```ts
// SOURCE: src/app/api/og/winner/[tid]/route.tsx:74-77
const fg =
  bgDataUri && q.bgTextTheme === "dark"
    ? OG_COLORS.winnerFgDark
    : OG_COLORS.winnerFg;
```

A.3 では box 色も同期して解決する:

```ts
// 新規 helper (og-readability.tsx) で集約:
function resolveCardTheme(
  bgDataUri: string | null,
  textTheme: "light" | "dark" | undefined,
  variant: "winner" | "season",
): { fg: string; boxBg: string | null } {
  if (!bgDataUri) {
    return { fg: variant === "winner" ? OG_COLORS.winnerFg : OG_COLORS.seasonFg, boxBg: null };
  }
  if (textTheme === "dark") {
    return {
      fg: variant === "winner" ? OG_COLORS.winnerFgDark : OG_COLORS.seasonFgDark,
      boxBg: OG_COLORS.bgBoxDark,
    };
  }
  return {
    fg: variant === "winner" ? OG_COLORS.winnerFg : OG_COLORS.seasonFg,
    boxBg: OG_COLORS.bgBoxLight,
  };
}
```

### SHADCN_DIALOG_CONFIRM（既存 pattern を CardBackgroundCard に適用）

```ts
// SOURCE: src/app/groups/[gid]/_components/LeaveDeleteDialogs.tsx:49-66
<Dialog open={confirmLeaveOpen} onOpenChange={setConfirmLeaveOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>サークルを脱退</DialogTitle>
      <DialogDescription>
        「{groupName}」から脱退します。脱退後はストラクチャ／トーナメントが見えなくなります。
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button variant="outline" onClick={() => setConfirmLeaveOpen(false)} disabled={working}>
        キャンセル
      </Button>
      <Button variant="destructive" onClick={onLeave} disabled={working}>
        脱退する
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### PREVIEW_REFLECTS_OG（A.3 新規 — settings タブのプレビューが OG layer を反映）

A.2 の既存 preview は image のみ（行 287-308）。A.3 では同じ layer を CSS で再現する component
（`CardReadabilityPreview`）を作成し、Satori の inline style と near-同等の CSS で描画する:

```tsx
// 新規: src/components/og/CardReadabilityPreview.tsx
"use client";

import type { CardTextTheme } from "@/lib/firebase/schemas/group";
import { OG_COLORS } from "@/app/api/og/_lib/og-card-styles";

export interface CardReadabilityPreviewProps {
  imageUrl: string | null;
  textTheme: CardTextTheme;
  variant: "winner" | "season";
  placeholderBg: string;
  /** プレビュー画像内に被せる demo テキスト（実 OG の名前 / 順位ではなく "WINNER" 等の汎用語）。 */
  demo: { title: string; main: string; sub: string };
}

export function CardReadabilityPreview({
  imageUrl,
  textTheme,
  variant,
  placeholderBg,
  demo,
}: CardReadabilityPreviewProps) {
  const hasImage = imageUrl != null;
  const fg = !hasImage
    ? variant === "winner" ? OG_COLORS.winnerFg : OG_COLORS.seasonFg
    : textTheme === "dark"
    ? variant === "winner" ? OG_COLORS.winnerFgDark : OG_COLORS.seasonFgDark
    : variant === "winner" ? OG_COLORS.winnerFg : OG_COLORS.seasonFg;
  const boxBg = hasImage
    ? textTheme === "dark" ? OG_COLORS.bgBoxDark : OG_COLORS.bgBoxLight
    : null;

  return (
    <div
      className="relative w-full overflow-hidden rounded border"
      style={{ aspectRatio: "1200 / 630", background: hasImage ? "transparent" : placeholderBg }}
    >
      {hasImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl!} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : null}
      {hasImage ? (
        <>
          <div className="absolute inset-0" style={{ background: OG_COLORS.bgScrimTopGradient }} />
          <div className="absolute inset-0" style={{ background: OG_COLORS.bgScrimBottomGradient }} />
        </>
      ) : null}
      {/* 3 ブロックの demo テキスト + box overlay */}
      <div className="absolute inset-0 flex flex-col justify-between p-6">
        <PreviewTextBox boxBg={boxBg} fg={fg}>{demo.title}</PreviewTextBox>
        <PreviewTextBox boxBg={boxBg} fg={fg} center>{demo.main}</PreviewTextBox>
        <PreviewTextBox boxBg={boxBg} fg={fg} alignRight>{demo.sub}</PreviewTextBox>
      </div>
    </div>
  );
}

function PreviewTextBox({ boxBg, fg, center, alignRight, children }: {...}) {
  return (
    <div
      style={{
        backgroundColor: boxBg ?? "transparent",
        color: fg,
        borderRadius: boxBg ? 8 : 0,
        padding: boxBg ? "4px 12px" : 0,
        alignSelf: center ? "center" : alignRight ? "flex-end" : "flex-start",
        fontSize: 14,
        fontWeight: 700,
      }}
    >
      {children}
    </div>
  );
}
```

### E2E_OG_HTTP_LAYER（既存 pattern を A.3 specific に拡張）

```ts
// SOURCE: tests/e2e/phase-d-share-and-history.spec.ts:22-43
test("/api/og/winner/[tid] が 200 + image/png + attachment を返す", async ({ request }) => {
  const sp = new URLSearchParams({
    winnerName: "Bob",
    tournamentName: "Sample",
    participants: "8",
    finishedAtLabel: "2026/5/7",
    filename: "winner-sample-2026-05-07",
  });
  const res = await request.get(`/api/og/winner/dummy-tid?${sp.toString()}`);
  expect(res.status(), `body=${await res.text()}`).toBe(200);
  expect(res.headers()["content-type"]).toContain("image/png");
  // PNG magic header
  const body = await res.body();
  expect(body[0]).toBe(0x89);
});
```

A.3 では bgImageUrl 経路で同じ assert を行う E2E を追加する（ただし emulator 経由の Storage URL を
seed する経路はコストが高いため、**dummy URL を host allowlist に含めない / 含めても fetch エラーで
グラデ fallback で 200 になる**ことの 2 case を assert に倒す）。

---

## Files to Change

| File                                                                                                       | Action | Justification                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/app/api/og/_lib/og-card-styles.ts`                                                                    | UPDATE | scrim グラデ / box 色 / radius / padding を additive 追加。既存 `bgScrim` は **削除 or rename**（呼出元無くなるため）                                            |
| `src/app/api/og/_lib/og-readability.tsx`                                                                   | CREATE | scrim 2 枚 + theme resolver の Satori-safe JSX helper。winner / season route から共有 import                                                              |
| `src/app/api/og/_lib/og-readability.test.tsx`                                                              | CREATE | `resolveCardTheme` 純関数の 4 ケース × variant 2（合計 8 ケース）と JSX snapshot                                                                          |
| `src/app/api/og/winner/[tid]/route.tsx`                                                                    | UPDATE | scrim 2 枚に差替 + テキスト 3 ブロックを rgba box で囲む。foreground / box の同時解決を helper 経由                                                            |
| `src/app/api/og/season/[gid]/route.tsx`                                                                    | UPDATE | 同上 season（title / podium / footer 3 ブロック）                                                                                                          |
| `src/components/og/CardReadabilityPreview.tsx`                                                             | CREATE | プレビュー専用 component。OG_COLORS から CSS を組み立て、OG route の Satori JSX とほぼ同等の見え方を再現                                                       |
| `src/app/groups/[gid]/_components/CardBackgroundCard.tsx`                                                  | UPDATE | プレビュー領域を `<CardReadabilityPreview>` に差替 / `window.confirm` を `<Dialog>` 確認に置換 / 解除 dialog の open state 管理                                |
| `src/app/groups/[gid]/_components/CardBackgroundCard.test.tsx`                                             | UPDATE | confirm dialog 経由の onClear テストを書換（`window.confirm` mock 削除、`getByRole("button", { name: "背景を解除する" })` 経由に）                          |
| `tests/e2e/card-background.spec.ts`                                                                        | CREATE | upload → 保存 → request.get(/api/og/winner/[tid]?bgImageUrl=...) → 200 + image/png の通し E2E                                                          |
| `README.md` または `docs/operating-guide.md`                                                               | UPDATE | 運営ガイド section に「背景画像のおすすめ条件」「light / dark テーマ使い分け」を追加                                                                              |

## NOT Building

- **画像の自動明度判定 → textTheme auto モード**（PRD で Could / 本 phase は Won't）
- **テキスト位置の dynamic レイアウト**（フォントサイズが自動で縮むなど）。本 phase は固定値で OK
- **scrim / box の色を運営者がカスタム可能にする UI**（YAGNI、本 phase は固定 rgba）
- **`<input type="color">` を使った textTheme の色 picker**。テーマ 2 値（light / dark）固定
- **PR / コミットレベルの visual regression（playwright snapshot）**。本 phase は **手動目視確認** で代替
- **OG route の Edge Runtime 移行**。Phase B で確定済の Node runtime 継続
- **`AppError("ui/dialog-cancelled")` 等の cancel 用 error code 新設**。Dialog cancel は通常リターンで OK
- **iOS Safari / Android Chrome の実機 visual regression 自動化**。マニュアル目視で代替

---

## Step-by-Step Tasks

### Task 1: OG_COLORS に scrim / box トークン追加

- **ACTION**: `src/app/api/og/_lib/og-card-styles.ts` に scrim グラデ / box 色 / radius / padding を additive 追加し、既存 `bgScrim` は削除（OG route の置換と同 commit で）
- **IMPLEMENT**:
  ```ts
  // 既存 `bgScrim` を削除
  // 新規追加:
  /** Phase A.3: 上端 0〜25% を覆う黒グラデ scrim。タイトル可読性確保。 */
  bgScrimTopGradient: "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 25%)",
  /** Phase A.3: 下端 80〜100% を覆う黒グラデ scrim。footer 可読性確保。 */
  bgScrimBottomGradient: "linear-gradient(0deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 20%)",
  /** Phase A.3: light テーマ時のテキストブロック背景 rgba。foreground は暗色 (winnerFg / seasonFgDark)。 */
  bgBoxLight: "rgba(255,255,255,0.78)",
  /** Phase A.3: dark テーマ時のテキストブロック背景 rgba。foreground は明色 (winnerFgDark / seasonFg)。 */
  bgBoxDark: "rgba(15,23,42,0.72)",
  /** Phase A.3: テキストブロック共通の borderRadius / padding。 */
  bgBoxRadius: 12,
  bgBoxPaddingX: 28,
  bgBoxPaddingY: 16,
  ```
  - 数値（0.55 / 25 / 20 / 0.78 / 0.72 / 12 / 28 / 16）はマジックナンバーだが、運営者カスタマイズせず固定。コメントで意図を残す
- **MIRROR**: `OG_COLORS` の既存トークン定義パターン（`as const` / コメントで Phase prefix）
- **IMPORTS**: なし（純定数の追加）
- **GOTCHA**: 既存 `bgScrim` が削除されるため、grep で残呼出が無いことを確認（route 2 ファイルからのみ参照されている前提）
- **VALIDATE**:
  - `npm run typecheck` で `OG_COLORS.bgScrim` への参照エラーが出ないこと
  - `grep -rn "OG_COLORS.bgScrim" src/` が空（route 置換と同 commit で達成）

### Task 2: og-readability helper の新規実装

- **ACTION**: `src/app/api/og/_lib/og-readability.tsx` を新規作成し、`resolveCardTheme` 純関数 + `<ScrimLayer>` / `<TextBox>` Satori-safe JSX helper を export
- **IMPLEMENT**:
  ```tsx
  import type { CSSProperties } from "react";
  import { OG_COLORS } from "./og-card-styles";

  export type CardVariant = "winner" | "season";

  /** 純関数: textTheme + bgDataUri から foreground 色 / box 色を解決する。 */
  export function resolveCardTheme(
    hasBackground: boolean,
    textTheme: "light" | "dark" | undefined,
    variant: CardVariant,
  ): { fg: string; boxBg: string | null } {
    if (!hasBackground) {
      return {
        fg: variant === "winner" ? OG_COLORS.winnerFg : OG_COLORS.seasonFg,
        boxBg: null,
      };
    }
    if (textTheme === "dark") {
      return {
        fg: variant === "winner" ? OG_COLORS.winnerFgDark : OG_COLORS.seasonFgDark,
        boxBg: OG_COLORS.bgBoxDark,
      };
    }
    return {
      fg: variant === "winner" ? OG_COLORS.winnerFg : OG_COLORS.seasonFg,
      boxBg: OG_COLORS.bgBoxLight,
    };
  }

  /** 上下 scrim を 2 枚重ねる Satori-safe component。bgDataUri == null のとき null を返す。 */
  export function ScrimLayer({ active }: { active: boolean }) {
    if (!active) return null;
    return (
      <>
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: OG_COLORS.bgScrimTopGradient,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: OG_COLORS.bgScrimBottomGradient,
          }}
        />
      </>
    );
  }

  /** テキストブロックを rgba box で囲む helper。boxBg == null のとき box 装飾なしで素通し。 */
  export function TextBox({
    boxBg,
    children,
    extraStyle,
  }: {
    boxBg: string | null;
    children: React.ReactNode;
    extraStyle?: CSSProperties;
  }) {
    const boxStyle: CSSProperties = boxBg
      ? {
          backgroundColor: boxBg,
          borderRadius: OG_COLORS.bgBoxRadius,
          padding: `${OG_COLORS.bgBoxPaddingY}px ${OG_COLORS.bgBoxPaddingX}px`,
        }
      : {};
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          ...boxStyle,
          ...extraStyle,
        }}
      >
        {children}
      </div>
    );
  }
  ```
- **MIRROR**: `og-card-styles.ts` の constants 重用 / `og-image-fetch.ts` の pure function 切り出し方
- **IMPORTS**: `import { OG_COLORS } from "./og-card-styles"` / `import type { CSSProperties } from "react"`
- **GOTCHA**:
  - Satori は **`display: "flex"` がデフォルト**。`<TextBox>` の root に必ず `display: flex` + `flexDirection: column` を明示する（既存 OG route も明示している）
  - Satori は `<>` フラグメントを許容する（ScrimLayer の return）
  - `borderRadius: 12` は数値（px）。文字列にしない
- **VALIDATE**:
  - `npm run typecheck` 0 errors
  - 同 commit で次 Task の route 置換まで実施し、build までグリーン

### Task 3: winner OG route の readability layer 置換

- **ACTION**: `src/app/api/og/winner/[tid]/route.tsx` の行 79-192 を `<ScrimLayer>` + `<TextBox>` 経由に書換
- **IMPLEMENT**:
  - 既存の単色 scrim div（行 104-115）を `<ScrimLayer active={!!bgDataUri} />` に置換
  - 既存の foreground 解決（行 74-77）を `const { fg, boxBg } = resolveCardTheme(!!bgDataUri, q.bgTextTheme, "winner")` に置換
  - title 3 行（TOURNAMENT CHAMPION / tournamentName / finishedAtLabel）を 1 つの `<TextBox boxBg={boxBg}>` でラップ
  - 中央 WINNER block（行 156-180）を別の `<TextBox boxBg={boxBg}>` でラップ
  - footer（行 181-190）を 3 つ目の `<TextBox boxBg={boxBg}>` でラップ
  - root の `<div style={{ background: bgDataUri ? "transparent" : OG_COLORS.winnerBg, color: fg, ... }}>` は維持
- **MIRROR**: `og-readability.tsx` の `TextBox` / `ScrimLayer` の使用例
- **IMPORTS**: `import { ScrimLayer, TextBox, resolveCardTheme } from "@/app/api/og/_lib/og-readability"`
- **GOTCHA**:
  - bgDataUri == null のとき box は出さない（`boxBg == null` で TextBox が素通し化）。既存挙動完全維持
  - 中央 WINNER ブロックは `alignItems: center / justifyContent: center / flex: 1` の制御を **TextBox の外側** で行う（TextBox 内部は box 装飾のみ責務）
  - `letterSpacing` / `fontSize` / `marginTop` は既存値を維持。`opacity: 0.75` の subtle 装飾も既存維持
- **VALIDATE**:
  - `npm run typecheck` 0 errors
  - dev server で `http://localhost:3000/api/og/winner/dummy?bgImageUrl=https://firebasestorage.googleapis.com/v0/.../winner.jpg&bgTextTheme=light` を curl して 200 + image/png
  - bgImageUrl 未指定 URL でも 200 + image/png + 既存と完全同型の PNG（手動目視差分なし）

### Task 4: season OG route の readability layer 置換

- **ACTION**: `src/app/api/og/season/[gid]/route.tsx` の行 129-238 を winner と同型に書換
- **IMPLEMENT**:
  - 既存 scrim を `<ScrimLayer>` に置換
  - foreground 解決を `resolveCardTheme(..., "season")` に置換
  - title block（SEASON LEADERBOARD / groupName / シーズン開始ラベル）を 1 つの TextBox にラップ
  - podium block（PodiumRow 3 行を含む `<div flex flex-col>`）を 1 つの TextBox にラップ
  - footer（ALLin-PokerTimer）を 3 つ目の TextBox にラップ
  - `PodiumRow` の中身（行 38-86）はそのまま流用（TextBox は呼出側でラップ）。`OG_COLORS.seasonAccent` の金色アクセントは維持
- **MIRROR**: Task 3 の winner route 変更
- **IMPORTS**: 同上
- **GOTCHA**:
  - PodiumRow 内部の rank=0 (1ST) は `fontSize: 64`、rank=1 (2ND) は `52`、rank=2 (3RD) は `44` の段階的サイズ。TextBox でラップしても child のフォントサイズに影響しない（CSS 直接）
  - `OG_COLORS.seasonAccent` / `OG_COLORS.seasonMuted` は **box 内のテキスト accent** として継続使用。light theme で box が白に近いとき、`#fde68a`（薄黄）の seasonAccent は読みづらい可能性 → 視認テストで dark テーマ推奨に倒すか、accent を別色に倒すか判断（後者は本 phase で実施せず、ガイドに残す）
- **VALIDATE**:
  - 同上 winner と同じ手順で season 側も 200 + image/png
  - bgImageUrl 未指定で既存 PNG と完全一致を手動目視確認

### Task 5: CardReadabilityPreview component 新規

- **ACTION**: `src/components/og/CardReadabilityPreview.tsx` を新規作成
- **IMPLEMENT**: 上記「PREVIEW_REFLECTS_OG」スニペットを下敷きに、`OG_COLORS` の値を直接 CSS インラインに展開する `"use client"` component を実装
  - props: `imageUrl: string | null` / `textTheme: CardTextTheme` / `variant: "winner" | "season"` / `placeholderBg: string` / `demo: { title; main; sub }`
  - layer 構成: 画像 `<img>` → ScrimLayer 相当 2 div → 3 ブロック demo テキスト（top / middle / bottom 配置）
  - `demo.title` は variant ごとに caller が指定（"TOURNAMENT CHAMPION" / "SEASON LEADERBOARD"）
  - placeholderBg は呼出側（`CardBackgroundCard`）が既存 `PLACEHOLDER_BG[kind]` を渡す
- **MIRROR**: Task 2 で組んだ `og-readability.tsx` の `resolveCardTheme` 純関数を **そのまま import して使う**（OG route とプレビューで color logic を完全共有）
- **IMPORTS**:
  ```ts
  import { OG_COLORS } from "@/app/api/og/_lib/og-card-styles";
  import { resolveCardTheme, type CardVariant } from "@/app/api/og/_lib/og-readability";
  import type { CardTextTheme } from "@/lib/firebase/schemas/group";
  ```
- **GOTCHA**:
  - Satori の inline style と React DOM の inline style では `padding` の書式が違う場合あり（数値 OK、文字列 OK 両方）。`padding: "16px 28px"` 形式に統一
  - `<img alt="">` で eslint-disable-next-line next/no-img-element を入れる（既存 CardBackgroundCard と同じ理由）
  - プレビュー内のフォントサイズは固定 14px（実 OG の 24-120px を 1200/400 = 3 分の 1 に縮める計算）。**「文字が読めるか」の感覚を編集者に与えるのが目的**で、ピクセルパーフェクト一致は目標としない
- **VALIDATE**:
  - 個別 unit test は省略（次 task の CardBackgroundCard.test.tsx の preview render assert で代替）
  - `npm run typecheck` 0 errors

### Task 6: CardBackgroundCard の preview 差替 + Dialog 置換

- **ACTION**: `src/app/groups/[gid]/_components/CardBackgroundCard.tsx` を 2 系統で更新
- **IMPLEMENT**:
  - **(A) プレビュー差替** — 行 287-308 の `<div className="relative w-full overflow-hidden rounded border">` を `<CardReadabilityPreview>` に置換:
    ```tsx
    <CardReadabilityPreview
      imageUrl={displayImageUrl}
      textTheme={textTheme}
      variant={kind}
      placeholderBg={PLACEHOLDER_BG[kind]}
      demo={DEMO_TEXT[kind]}
    />
    ```
  - 既存の `aria-label={`${kind}-card-background-preview`}` / `data-testid` は `<CardReadabilityPreview>` の root に渡せるよう props を追加するか、外側の wrapper を 1 段残す
  - **(B) Dialog 置換** — `onClear` の `window.confirm` を `<Dialog>` 確認に置換:
    ```tsx
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

    // onClear を 2 段階に分割:
    const requestClear = useCallback(() => {
      if (!current?.imageUrl) return;
      setClearConfirmOpen(true);
    }, [current]);

    const confirmClear = useCallback(async () => {
      setClearConfirmOpen(false);
      if (!user) {
        onError("ログインが必要です");
        return;
      }
      setWorking(true);
      try {
        if (kind === "winner") {
          await clearWinnerCardBackground({ ... });
        } else {
          await clearSeasonCardBackground({ ... });
        }
        resetSelection();
        await onSaved();
      } catch (e) {
        const wrapped = unwrapOrFrom(e, "firestore/write_failed", "背景画像の解除に失敗しました");
        onError(formatErrorForDisplay(wrapped));
      } finally {
        setWorking(false);
      }
    }, [user, current, gid, kind, onSaved, onError, resetSelection]);
    ```
  - 「背景を解除」Button は `onClick={requestClear}` に変更
  - JSX 末尾に `<Dialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>` を追加（LeaveDeleteDialogs と同型）
- **MIRROR**:
  - 上記 `SHADCN_DIALOG_CONFIRM` パターン（LeaveDeleteDialogs.tsx）
  - 既存 `working` / `savedFlash` / `onSaved` / `onError` の規約は維持
- **IMPORTS**:
  ```ts
  import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter }
    from "@/components/ui/dialog";
  import { CardReadabilityPreview } from "@/components/og/CardReadabilityPreview";
  ```
- **GOTCHA**:
  - Dialog open 中に upload 操作を並列実施できない設計にする（`working || clearConfirmOpen` で他ボタンも disable する）
  - Dialog の確認 ボタンは `variant="destructive"`（LeaveDeleteDialogs と同型）。テキストは「背景を解除する」
  - `window.confirm` を呼んでいたテストは Task 7 で書換える
- **VALIDATE**:
  - `npm run typecheck` 0 errors
  - dev server で sample 背景アップロード → save → preview に scrim + box が出ること
  - 「背景を解除」押下で Dialog 出現 → キャンセル → 解除されない / Dialog 「背景を解除する」押下で解除実行

### Task 7: CardBackgroundCard.test.tsx の updater

- **ACTION**: `src/app/groups/[gid]/_components/CardBackgroundCard.test.tsx` を更新し、`window.confirm` mock を撤去 + Dialog 経由テストに書換
- **IMPLEMENT**:
  - 既存の「window.confirm」mock パターン削除
  - 「背景を解除」ボタン click → Dialog 出現 → 「背景を解除する」ボタン click → `clearWinnerCardBackground` mock が呼ばれる、というシナリオ
  - キャンセル経路: Dialog 出現 → 「キャンセル」 click → mock 未呼出
  - Dialog DOM クエリは `getByRole("dialog")` 経由（Radix Portal）
  - 既存の preview 表示 / save 経路 / textTheme トグル / 5MB pre-reject / mime pre-reject は変更なし
- **MIRROR**:
  - LeaveDeleteDialogs を使うコンポーネントの既存テスト
  - `vi.spyOn` / `vi.mock` の既存パターン（A.2 の同 spec で確立）
- **IMPORTS**: 既存
- **GOTCHA**:
  - Dialog は Radix Portal で `document.body` 直下に描画される。`screen.getByRole("dialog")` で問題なく取得できる
  - A.2 report で記録された「`vi.restoreAllMocks` で `mockResolvedValue` が消える」「jsdom が `URL.createObjectURL` を提供しない」の対処は引き続き必要（beforeEach で再 stub）
- **VALIDATE**:
  - `npm run test -- CardBackgroundCard` が green
  - `vi.spyOn(window, "confirm")` が grep で残っていないこと

### Task 8: og-readability.test.tsx 新規

- **ACTION**: `src/app/api/og/_lib/og-readability.test.tsx` で `resolveCardTheme` の characterization test
- **IMPLEMENT**:
  - 8 ケース（hasBackground × textTheme × variant の全組合せ）の入出力 assert
  - ScrimLayer / TextBox の snapshot は **取らない**（Satori-specific JSX は brittle、style プロパティの key existence のみ確認するか、E2E 経由で OG PNG を検証）
- **MIRROR**: 既存の `og-image-fetch.test.ts` / `og-payload.test.ts` の純関数 test スタイル
- **IMPORTS**:
  ```ts
  import { describe, expect, it } from "vitest";
  import { resolveCardTheme } from "./og-readability";
  import { OG_COLORS } from "./og-card-styles";
  ```
- **GOTCHA**: TextBox / ScrimLayer の DOM render テストは vitest の React test setup が必要だが、本 phase では純関数のみテストし、render 側は OG route の E2E が観測可能 layer をカバーするため省略
- **VALIDATE**: `npm run test -- og-readability` で 8 ケース green

### Task 9: E2E spec card-background.spec.ts 新規

- **ACTION**: `tests/e2e/card-background.spec.ts` を新規作成
- **IMPLEMENT**:
  - Scenario A: owner として group を作り、settings タブで file input に `setInputFiles` で fixture png（`tests/e2e/fixtures/sample-bg.png` か programmatic に小さい PNG を生成）を流す → 「保存」 → flash 表示 → groups doc を再読込してプレビューに新しい画像 URL が表示されていることを確認
  - Scenario B: 設定後、`page.request.get("/api/og/winner/dummy-tid?bgImageUrl=<saved url>&bgTextTheme=light&winnerName=Bob&tournamentName=Sample&participants=8&finishedAtLabel=2026/5/12")` → 200 + image/png + PNG magic header
  - Scenario C: 「背景を解除」 → Dialog 出現 → 「背景を解除する」 click → プレビューが placeholder に戻る
  - PageObject 拡張: `tests/e2e/pages/GroupsPage.ts` に `goToSettingsTab` / `winnerCardBackgroundPreview` Locator を最小限追加（または直接 page.goto + getByRole で十分）
- **MIRROR**:
  - `tests/e2e/phase-d-share-and-history.spec.ts` の `/api/og/winner/[tid]` HTTP layer assert
  - `tests/e2e/audio-settings.spec.ts`（owner 操作 + settings タブ navigation の先例）
- **IMPORTS**: 既存 fixtures
- **GOTCHA**:
  - Storage emulator への upload は本物の Firebase SDK 経由になるため、Playwright fixture で **emulator 接続済の client が dev server 経由で確実に動作する**必要がある。`playwright.config.ts` の `webServer.env` で emulator 接続環境変数が注入されているか確認
  - Sample PNG は小さい（< 1KB）合成画像で OK。`tests/e2e/fixtures/sample-bg.png` を新規追加するか、test 内で `Buffer.from(PNG_MAGIC_BYTES, ...)` の dynamic 生成も可
  - upload 後の Storage download URL は Firebase Storage SDK の `getDownloadURL` 経由で取得した文字列。E2E ではこれを直接 query に渡す（本物の Firebase Storage emulator URL になる）
  - Scenario B で **Firebase Storage emulator host は OG host allowlist に含まれていない**（`firebasestorage.googleapis.com` / `storage.googleapis.com` のみ）ため、emulator URL を渡すと **fetch helper が allowlist deny で reject** → グラデ fallback で 200 が返る。これは「allowlist 防御が効いている」ことの assert になる
- **VALIDATE**:
  - `npx playwright test card-background` 単独で green
  - 既存 E2E 全件にも影響なし

### Task 10: ドキュメント追加

- **ACTION**: `README.md` の「Phase 5 / Track A」セクションに「背景画像のおすすめ条件 / light vs dark の使い分け / 解除手順」を追記、または `docs/operating-guide.md` がある場合はそちらに追記
- **IMPLEMENT**:
  - 「**おすすめ条件**: 1200×630（OG カード比）/ jpeg / 単色領域があると box overlay の読みやすさ向上 /
    明暗が極端にコントラストする画像は box overlay でも読みにくい場合あり」
  - 「**ライト vs ダーク テーマの使い分け**: 明るい / 中間明度の背景画像 → ライト（黒テキスト + 白半透明 box）/
    暗い背景画像 → ダーク（白テキスト + 紺半透明 box）」
  - 「**解除手順**: サークル詳細 → 設定タブ → 該当カード → 「背景を解除」 → 確認ダイアログ」
- **MIRROR**: `README.md` の既存 Phase B / Phase D 説明セクション
- **IMPORTS**: なし（ドキュメント）
- **GOTCHA**: コミット規約（`docs: ...` prefix）に従う
- **VALIDATE**: マークダウンの構造が壊れていないことを目視確認

### Task 11: 全体検証ループ

- **ACTION**: 全 task 完了後の包括的な validation
- **IMPLEMENT**:
  ```bash
  npm run typecheck        # 0 errors
  npm run lint             # 0 warnings, 0 errors
  npm run test             # all unit / characterization green
  npm run build            # SSR build success
  npm run test:rules-card-background    # 11/11 pass（regression なし）
  npm run test:storage-rules            # 10/10 pass（regression なし）
  npx playwright test card-background   # 新 E2E 全 green
  npx playwright test phase-d-share-and-history    # 既存 OG E2E に regression なし
  ```
- **MIRROR**: A.2 report の validation results 表
- **VALIDATE**: 全 command がそれぞれ exit 0

---

## Testing Strategy

### Unit Tests

| Test                                                                    | Input                                                          | Expected Output                                                              | Edge Case?                                  |
| ----------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------- |
| `resolveCardTheme(false, undefined, "winner")`                          | hasBackground=false                                            | `{ fg: winnerFg, boxBg: null }`                                              | No                                          |
| `resolveCardTheme(false, undefined, "season")`                          | hasBackground=false                                            | `{ fg: seasonFg, boxBg: null }`                                              | No                                          |
| `resolveCardTheme(true, "light", "winner")`                             | bg + light                                                     | `{ fg: winnerFg, boxBg: bgBoxLight }`                                        | No                                          |
| `resolveCardTheme(true, "light", "season")`                             | bg + light                                                     | `{ fg: seasonFg, boxBg: bgBoxLight }`                                        | No                                          |
| `resolveCardTheme(true, "dark", "winner")`                              | bg + dark                                                      | `{ fg: winnerFgDark, boxBg: bgBoxDark }`                                     | No                                          |
| `resolveCardTheme(true, "dark", "season")`                              | bg + dark                                                      | `{ fg: seasonFgDark, boxBg: bgBoxDark }`                                     | No                                          |
| `resolveCardTheme(true, undefined, "winner")`                           | bg + textTheme undefined → light として扱う                       | `{ fg: winnerFg, boxBg: bgBoxLight }`                                        | Yes (zod default 経路)                       |
| `resolveCardTheme(true, undefined, "season")`                           | 同上                                                            | `{ fg: seasonFg, boxBg: bgBoxLight }`                                        | Yes                                          |
| CardBackgroundCard: 「背景を解除」 click → Dialog open                   | current.imageUrl != null                                       | dialog 出現、clear service mock 未呼出                                          | No                                          |
| CardBackgroundCard: Dialog cancel                                       | dialog open → 「キャンセル」 click                              | dialog close、clear service mock 未呼出、preview unchanged                       | No                                          |
| CardBackgroundCard: Dialog confirm → clear 実行                        | dialog open → 「背景を解除する」 click                          | clear service mock 呼出、onSaved 呼出、preview placeholder へ                    | No                                          |
| CardBackgroundCard: preview に scrim + box overlay が描画される         | imageUrl 設定済                                                 | preview DOM に `bgScrimTopGradient` / `bgBoxLight` または `bgBoxDark` の inline style が含まれる | テストはやや brittle、`data-testid` で粒度確保 |

### Edge Cases Checklist

- [ ] bgImageUrl 未指定の OG カードが **完全に既存挙動**（手動 visual diff）
- [ ] `bgTextTheme=undefined`（query 不指定）でも light として扱われる（zod default 経路）
- [ ] 中央 WINNER ブロックの巨大文字（120px）が box overlay でも改行 / 切れずに表示される
- [ ] 短いテキスト（example: winnerName が 1 文字）でも box の padding が機能する
- [ ] 「背景を解除」Dialog を ESC / overlay click で閉じる（Radix Dialog のデフォルト）
- [ ] Dialog が open 中に「保存」ボタンが disable される（working || clearConfirmOpen）
- [ ] Storage emulator URL が `firebasestorage.googleapis.com` allowlist に含まれず、emulator 経由の E2E では fetch deny → グラデ fallback で 200 が返る（=「allowlist 防御が効いている」assert）
- [ ] season カードで PodiumRow accent 色（`#fde68a` 薄黄）が light box 内で視認できるか（dark theme 推奨ガイドに倒すか判断）

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
```

EXPECT: `tsc --noEmit` 0 errors

```bash
npm run lint
```

EXPECT: `next lint` 0 warnings / 0 errors

### Unit Tests

```bash
npm run test
```

EXPECT: 既存 80 files / 1331 tests に加え、A.3 で +8（`og-readability.test.tsx`）+ Δ（CardBackgroundCard
の confirm dialog 書換による net ±0 程度）。合計 1339+ 件 green

### Targeted Unit Tests

```bash
npm run test -- og-readability
npm run test -- CardBackgroundCard
```

EXPECT: それぞれ単独 green

### Full Build

```bash
npm run build
```

EXPECT: `next build` 成功。OG route 2 件で `node:fs` フォント読込、Satori JSX with new helper が成立

### Emulator Rules (Regression)

```bash
npm run test:rules-card-background
npm run test:storage-rules
```

EXPECT: それぞれ 11/11 pass / 10/10 pass（本 phase は rule 変更なし、回帰ゼロ確認のみ）

### E2E (New + Regression)

```bash
npx playwright test card-background
```

EXPECT: 新 spec の 3 scenario すべて green

```bash
npx playwright test phase-d-share-and-history
```

EXPECT: 既存 OG HTTP layer spec が 200 + image/png + PNG magic header を返すこと（layer 変更による
regression を即検出）

### Manual Validation (visual regression)

dev server を起動し以下を目視確認:

- [ ] サークル詳細 → 設定タブ → 優勝カード背景画像カードのプレビューに scrim + box overlay が出る
- [ ] textTheme をライト ⇄ ダーク 切替で foreground / box 色が対称切替
- [ ] 同一画像で OG PNG (`/api/og/winner/...?bg=...`) を別タブで開き、プレビューと**同じ readability 表現**になる
- [ ] 「背景を解除」 Dialog が出る / キャンセル / 確認の両経路が動く
- [ ] bgImageUrl 未指定の OG PNG が完全に A.2 と同じ見た目（手動目視 / 必要なら hash 比較）
- [ ] 明るい画像 + light theme / 暗い画像 + dark theme / 中間 + 両 theme の **3 通り**で文字が読めることを確認

---

## Acceptance Criteria

- [ ] OG winner / season route が scrim 2 枚 + box 3 ブロック + theme 切替の三段構えで描画
- [ ] サークル詳細編集カードのプレビューが OG と同型の readability layer を反映
- [ ] 「背景を解除」が shadcn `<Dialog>` 経由、`window.confirm` の grep が空
- [ ] E2E spec `card-background.spec.ts` で upload → 保存 → OG download が通る
- [ ] bgImageUrl 未指定時の挙動が完全に既存維持（regression ゼロ）
- [ ] 全 validation command（typecheck / lint / unit / build / rules emulator / E2E）が green
- [ ] 運営ガイド ドキュメントに背景画像のおすすめ条件 / theme 使い分け / 解除手順を追加

## Completion Checklist

- [ ] Code follows discovered patterns（LeaveDeleteDialogs / og-card-styles / og-image-fetch）
- [ ] Error handling matches codebase style（`unwrapOrFrom` / `AppError.from`）
- [ ] Logging follows codebase conventions（`logger.warn` / `logger.info`、新規 log は最小限）
- [ ] Tests follow test patterns（observable behavior / fixture factory pattern / mock at service boundary）
- [ ] No hardcoded values（scrim / box は `OG_COLORS` 経由）
- [ ] Documentation updated（README / operating-guide）
- [ ] No unnecessary scope additions（auto theme / color picker / Edge runtime 移行は NOT building）
- [ ] Self-contained — implementation 中に追加 codebase 検索が不要

## Risks

| Risk                                                                                                          | Likelihood | Impact | Mitigation                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------- | ---------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Satori が新 box overlay の `rgba` + `borderRadius` 組合せを期待通り描画しない                                  | L          | M      | Task 3 / 4 完了後に手動 visual diff で確認。Satori は `rgba` / `borderRadius` を公式サポート（External Documentation 参照）                                                                |
| プレビューと実 OG の見え方が解離（CSS と Satori inline style のずれ）                                          | M          | M      | 同 `OG_COLORS` を参照 + `resolveCardTheme` を共有することで色は完全一致。レイアウト（フォントサイズ比率 / scrim 高さ %）は意図的に「感覚提供」目的とし pixel perfect を要件にしない         |
| Storage emulator URL が host allowlist に含まれず E2E で OG が **意図せずグラデ fallback** に倒れる             | M          | L      | これは「allowlist 防御が効いている」ことの観測点として **assert に組み込む**（OG は 200 を返す / fallback 経路ログが warn）                                                                  |
| Dialog 置換時に `working` state が complete 前にリセットされ、二重 clear 実行                                  | L          | M      | `setClearConfirmOpen(false)` を `confirmClear` の冒頭で実行、その後 `setWorking(true)` で他ボタンも disable。LeaveDeleteDialogs と同型ロジック                                              |
| `OG_COLORS.bgScrim` 削除で外部参照（他 phase / 他 PRD）に影響                                                  | L          | L      | grep で参照箇所が 2 route のみであることを Task 1 で確認                                                                                                                                  |
| 中央 WINNER 大文字（120px）が box の padding に対し overflow                                                  | L          | M      | Task 3 完了直後の手動目視で確認。overflow が起きる場合は `bgBoxPaddingY` を縮める / `fontSize` を `100px` に下げる調整を Task 3 内で完結                                                       |
| season カードの PodiumRow accent 色（`#fde68a` 薄黄）が light theme の白 box 内で読みにくい                    | M          | L      | dark theme での視認を推奨するドキュメントに倒す（Task 10）。本 phase でアクセント色変更はしない（YAGNI）                                                                                       |
| E2E で Storage emulator への upload が flaky                                                                  | M          | M      | upload retry の指数 backoff（A.2 で導入済）に依存しつつ、spec 内で `waitFor` で flash 表示完了を確認。失敗時は spec を `test.fail` で隔離するのではなく **`test.skip` 化せず原因を直す** |

## Notes

- 本 phase は **rule / schema 変更ゼロ**。Firestore / Storage の rule emulator は regression 確認のみで、新規 validator 追加は不要
- 本 phase は **新規依存追加ゼロ**。`@vercel/og` / `next/og` / `firebase` / `@radix-ui/react-dialog` はすべて既存
- A.2 review の F-7（`window.confirm` → shadcn `<Dialog>` 揃え）を本 phase の Task 6 / 7 で完全クローズ
- A.2 report の deviations（CardBackgroundCard の gid 注入 / live-client の URL 組立 / `updateCardBackgroundTextTheme` の 2 関数化）は本 phase で **再修正しない**（既存設計が安定運用に耐えると A.2 で判断済）
- 本 phase は PRD 5 のドライラン投入準備の最終 phase。次は `/code-review` → `/prp-pr` で merge までを完結する

---

## Post-merge follow-up (2026-05-12)

本 plan に従って A.3 を merge した直後、サークル owner から「**画像の上を塗りつぶす範囲が大きく、デザインが損なわれる**」という不評をもらった。原因は readability layer のうち:

1. **テキストグループ単位の rgba 半透明 box overlay**（中央 WINNER ブロックを含む 3 ブロック）
2. **上下 scrim の濃さ・高さ**（上 25% + 下 20% × `rgba(0,0,0,0.55)`）

の 2 段が想定以上に強く、特に中央 WINNER（名前 120px + 上下 padding 16px の box）が画像の主役領域を覆っていた点が大きい。

そのため当該 polish 後フォローアップで以下に倒した:

- **box overlay を全廃** — `bgBoxLight` / `bgBoxDark` / `bgBoxRadius` / `bgBoxPaddingX` / `bgBoxPaddingY` の 5 定数を削除、`<TextBox>` component も削除
- **scrim を大幅弱化** — 上 15% / `rgba(0,0,0,0.35)`、下 12% / `rgba(0,0,0,0.3)`
- **text-shadow（outer glow）で文字側を縁取り** — `bgTextShadowLight` / `bgTextShadowDark` を additive 追加し、各テキスト要素の `style` に直接付与（Satori の継承挙動に依存しない設計）

実装の詳細・差分・検証結果は [phase-a.3-layout-polish-and-readability-report.md](../../reports/phase-a.3-layout-polish-and-readability-report.md) 末尾の **"Post-merge follow-up (2026-05-12)"** セクション参照。

### 本 plan の元設計に対する位置づけ

本 plan の Problem → Solution / UX Design / 各 Task は **A.3 初版（box overlay あり）の意図を残したまま**保管する（完了済み plan の immutable 性のため）。実コードベースは現時点で:

- `OG_COLORS.bgBox*` 系定数は **存在しない**（本 follow-up で削除済）
- `<TextBox>` component は **存在しない**（同上）
- `resolveCardTheme` は `{ fg, textShadow }` を返す（plan の文中では `{ fg, boxBg }` を返す形になっているが、現状は textShadow）

後続 phase で本 plan を参照する場合は、上記 follow-up の方向に差分がある前提で読むこと。本 plan の「box overlay を rgba で巻く」設計判断は **ドライラン投入前の owner フィードバックで覆った**ため、新規実装で同パターンを再導入してはならない。

---

## Post-merge follow-up 2 (2026-05-12): Winner OG レイアウト確定 + footer-box 再導入

上記 follow-up（box overlay 全廃）の後、owner との対話的 polish を通じて winner OG のレイアウトと footer 表示をさらに以下に確定させた。詳細・差分・検証結果は [phase-a.3-layout-polish-and-readability-report.md](../../reports/phase-a.3-layout-polish-and-readability-report.md) 末尾の **"Post-merge follow-up 2"** セクション参照。

### Layout 確定（winner OG のみ）

| 位置 | 内容 | 配置方法 |
| --- | --- | --- |
| 最上部 | トーナメント名 (`fontSize 36`) | `justifyContent: center` で中央揃え |
| 上下左右の中央 | 優勝者名 (`fontSize 120`) | `flex: 1` 内で `alignItems / justifyContent: center` |
| WINNER ラベル | `fontSize 36`（手動調整、"WINNER!!"） | winnerName を `position: relative` で包み、ラベルは `position: absolute / top: -40` で **真上に絶対配置**。winnerName の縦中央計算にラベル高さを含めないため winnerName 自体が画面中央に来る |
| 最下部 | サークル名 / 開催日 / 参加人数 / アプリ名 の 4 要素 | `justifyContent: center` でボックスを中央配置 |

`OG_PADDING` は元 plan の `64` → owner 手動調整で `12` に縮小（最上部 / 最下部の余白を画像端ぎりぎりまで詰める）。

### footer-box 再導入（box overlay の局所復活）

「box overlay 全廃」方針を一部緩和し、**最下部 footer の 4 要素ボックスのみ box overlay を復活**させた。owner からの「ボックスで背景が部分的に隠れることは許容する」明示要望に基づく。

- 背景画像時のみ box を出す（グラデ背景時は box 無し / フラット）
- box 色は `textTheme` に連動:
  - `light` → `rgba(255,255,255,0.78)` (`bgFooterBoxLight`)
  - `dark`  → `rgba(15,23,42,0.72)` (`bgFooterBoxDark`)
- 4 要素間に foreground 色（透明度 0.35）の **1px 縦線で区切り**
- 各要素の fontSize はサークル名 / 開催日 / 参加人数 = 28、アプリ名 = 16（手動調整）

### `groupName` クエリ追加

footer-box にサークル名を出すため、`WINNER_CARD_QUERY_SCHEMA` に `groupName` を **optional で additive 追加**。旧クライアントとの URL 互換のため optional（未指定なら footer から省略 + 縦線も省略）。`buildWinnerShareInputs` / `WinnerCardDownloadButton` も同様に optional prop 経由で接続。

### Satori `textShadow: undefined` クラッシュ対策

`textShadow` プロパティに `undefined` を渡すと Satori が `.toString()` でクラッシュして `failed to pipe response` になることが判明。winner / season 両 route で `const ts = textShadow ?? undefined; textShadow: ts` の pattern を廃し、**条件 spread** に統一:

```ts
const shadowStyle: { textShadow?: string } = textShadow ? { textShadow } : {};
// ...style={{ display: "flex", ...shadowStyle }}
```

season route は事象 report がない時点で防御的に同じ pattern に揃えた。

### 本 plan の元設計に対する位置づけ（更新）

上記の通り、A.3 初版は「box overlay を全部に巻く / scrim 強め」、polish 1 は「box 全廃 / scrim 弱化 + text-shadow」、polish 2 は「scrim 弱め維持 + text-shadow + footer のみ box 再導入 + Layout 最上部中央 / 真ん中 / 最下部中央寄せ」と段階的に転換した。後続 phase の参照ポイント:

- box overlay は **footer 限定**で再導入された（テキストグループ単位の box は廃止のまま）
- text-shadow は **外側ブロック**（タイトル / WINNER / 優勝者名）に使用、footer 内では box があるため出さない
- winner クエリには `groupName` が乗る（optional）。`groups/{gid}.name` を呼出側から流し込む経路
