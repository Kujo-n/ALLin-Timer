# Plan: Phase D — Web Share API & Season History Polish

## Summary

Phase B で導入した「画像を保存」ボタンを温存しつつ、Web Share API 対応ブラウザでは **「シェア」ボタンを並列追加して 2 つの選択肢をユーザーに提示する**（どちらかに倒さない）。シェアは OS シェアシート経由で LINE / X に画像 + テキストを直接送る経路、画像を保存は既存の `<a download>` 経路で「自分で SNS にアップロードしたい」「画像をローカル保存だけしたい」需要に応える。同時に Phase A で土台だけ作ってあった `seasonHistory/{seasonId}` の閲覧 UI を `/groups/[gid]/season` 画面に追加し、PRD の "Should" を全て消化する。`navigator.canShare({ files })` の可用性は SSR では false 固定とし、CSR mount 後に実機判定で「シェア」ボタンを additive に表示する。色プリセットおよび Color picker は Phase C improvement-02-02 で既に完了済のため Phase D の Scope からは外す（NOT Building 明示）。

## User Story

As a サークル参加メンバー（owner / organizer / member、認証済み），
I want Winner 画面 / シーズンランキング画面で「シェア」と「画像を保存」が並んで出て自分で選べる（Web Share API 非対応ブラウザでは画像を保存のみ），
So that 「OS シェアシート経由で 1 タップ LINE 投稿したい」と「画像をフォルダに残してから別アプリで貼りたい」の両方の動線がブラウザ仕様に左右されず、自分の運用スタイルで選べる。

And as a 運営者・参加者,
I want `/groups/[gid]/season` 画面で過去シーズンの首位とその累計ポイントを閲覧できる,
So that 「先月の首位は誰だったか」を画面上で完結して確認でき、運営者の告知ネタになる。

## Problem → Solution

**Current state**:

- Phase B 完了で `WinnerCardDownloadButton` / `SeasonTopCardDownloadButton` は `<a download>` のみを提供（[`WinnerCardDownloadButton.tsx`](../../../../src/components/tournament/WinnerCardDownloadButton.tsx) / [`SeasonTopCardDownloadButton.tsx`](../../../../src/components/group/SeasonTopCardDownloadButton.tsx)）。iOS Safari は `<a download>` が新規タブ表示になり、長押しで保存 → アプリで開いて投稿、と 3 ステップ以上必要（[Phase B plan の Risks セクション](completed/phase-b-result-card-generation.plan.md) 参照）。
- Phase A で `seasonHistory/{seasonId}` の schema / repository / rule は完備し、`listSeasonHistory(gid)` も実装済（[`repositories/seasonHistory.ts`](../../../../src/lib/firebase/repositories/seasonHistory.ts)）だが、**閲覧 UI が存在しない**。`/groups/[gid]/season` の `season-ranking-client.tsx` は現在シーズン分のみ描画して終わっている。
- 「Color picker UI（プリセット 6〜8 色）」は Phase D Scope の文言として PRD に残るが、[`phase-c-improvement-02-02-report.md`](../reports/phase-c-improvement-02-02-report.md) Wave 1-3 / 3 で `TableLabelEditPopover` に 10 色プリセット + カスタム hex 折りたたみ + サークル詳細 `GroupDefaultTableLabelsCard` での共有を**完了済**。

**Desired state**:

- 共通 hook `useCanShareImage()` が CSR mount 後に `navigator.canShare({ files: [<dummy png file>] })` を判定し、 `boolean | "loading"` を返す。
- 新規 component `ShareCardButton` が share path 専用ボタンを provide。`canShare === true` のときだけ render（false / "loading" 時は render しない、null）。失敗時は logger.warn のみで silent（download 経路は隣の既存ボタンが常に出ているため自動 fallback 不要）。
- 既存 `WinnerCardDownloadButton` / `SeasonTopCardDownloadButton` の **`<a download>` 経路は完全温存**。Phase B の characterization test は全件無変更で green を維持。
- 呼出側は **2 ボタンを横に並べて render**（gap-2 の flex row）。`canShare === true` の端末では「シェア」+「画像を保存」、`false` / "loading" では「画像を保存」のみが見える。flicker 抑制のため初期 mount は loading = false 等価で「画像を保存」のみが先行表示される。
- `/groups/[gid]/season` 画面に `<SeasonHistoryList gid={gid} />` を追加し、過去シーズン (`endedAt desc`) ごとに `startedAt 〜 endedAt` / 首位 displayName / 首位 totalPoints / 参加人数を 1 行で表示。展開で top3 まで見せる。
- 成功指標観測のため、share / download 押下時に `logger.info` で `{ kind: "winner" | "season", action: "share" | "download", success: boolean }` を 1 行出す。PII を含めないため `tid` / `gid` / 名前は出さない。

## Metadata

- **Complexity**: Medium
- **Source PRD**: [.claude/PRPs/02-season-stats-and-share/prds/02-season-stats-and-share.prd.md](../prds/02-season-stats-and-share.prd.md)
- **PRD Phase**: Phase D — Web Share API & Polish
- **Stage scope**: Web Share API 抽象 hook + ShareCardButton primitive / Phase B 既存 2 button の隣に share button を additive 配置 / SeasonHistoryList 新設 / season-ranking-client 配線 / telemetry 1 行 / docs（PRD + README + 業務仕様書）軽微
- **Estimated Files**: 約 13 files（CREATE 7 / UPDATE 6）

---

## UX Design

### Before（Phase B / Phase A 完了時点）

```
/tournaments/[tid] (state="finished")
┌────────────────────────────────────────────┐
│ 🏆  Alice                                  │   ← WinnerBanner
│         [画像を保存] ← Phase B ボタンのみ │
└────────────────────────────────────────────┘

/groups/[gid]/season
┌────────────────────────────────────────────┐
│ シーズンランキング — サタデーサークル      │
│ 現在シーズン開始: 2026-04-01               │
│            [シーズン首位カードを保存]      │   ← Phase B のみ
│ 1. Alice  47.83 pt                         │
│ 2. Bob    28.12 pt                         │
│ ...                                        │
│                                            │
│ （ここから下に過去シーズン履歴セクションは │
│   存在しない）                             │
└────────────────────────────────────────────┘

→ iOS Safari は新規タブ表示で 3 step 以上、過去シーズンは閲覧不能。
```

### After（Phase D）

```
/tournaments/[tid] (state="finished")    [canShare === true 端末: iOS Safari / Android Chrome]
┌────────────────────────────────────────────┐
│ 🏆  Alice                                  │
│      [シェア] [画像を保存] ← 並列、両方 ON │
└────────────────────────────────────────────┘
        ↓ [シェア] クリック → 端末 OS のシェアシート
┌─ iOS / Android Share Sheet ────────────────┐
│  画像 PNG をシェア                         │
│  [LINE]  [X]  [Slack]  [メール]  ...       │
└────────────────────────────────────────────┘
        ↓ [画像を保存] クリック → ブラウザ既定の保存ダイアログ
            (iOS Safari は新規タブで PNG プレビュー → 長押し保存)

/tournaments/[tid] (state="finished")    [canShare === false 端末: Desktop Chrome / Firefox]
┌────────────────────────────────────────────┐
│ 🏆  Alice                                  │
│              [画像を保存] のみ             │   ← Phase B と同じ単独表示
└────────────────────────────────────────────┘

/groups/[gid]/season    (canShare === true 端末)
┌────────────────────────────────────────────┐
│ シーズンランキング — サタデーサークル      │
│ 現在シーズン開始: 2026-04-01               │
│   [首位をシェア] [シーズン首位カードを保存]│   ← 2 ボタン並列
│ 1. Alice  47.83 pt                         │
│ ...                                        │
│                                            │
│ ─── 過去シーズン履歴 (新規) ───────────── │
│ ▾ 2026-01-01 〜 2026-04-01                 │
│   首位: Alice  35.20 pt（参加 12）         │
│   2. Bob   28.10 pt                        │
│   3. Carol 19.66 pt                        │
│ ▸ 2025-10-01 〜 2026-01-01                 │
│   首位: Bob   42.50 pt                     │
└────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| --- | --- | --- | --- |
| Winner ダウンロードエリア | `[画像を保存]` 1 ボタンのみ | `canShare` 真: `[シェア] [画像を保存]` 並列 / 偽: `[画像を保存]` のみ | 2 ボタン並列は `flex gap-2` で右寄せ。share ボタンは additive、download ボタンは Phase B から無変更 |
| シーズン首位カードエリア | `[シーズン首位カードを保存]` 1 ボタン | `canShare` 真: `[首位をシェア] [シーズン首位カードを保存]` / 偽: 後者のみ | 同上 |
| `WinnerCardDownloadButton` 押下時 | `<a download>` ブラウザ既定動作 | **変更なし**（Phase B と同じ） | logger.info 観測ログだけ追加 |
| 新規 `ShareCardButton` 押下時 | （存在しない） | fetch URL → File 化 → `navigator.share({ files, text })` | 失敗時は logger.warn のみ。並列の「画像を保存」が常に出ているため、自動 fallback は不要（user が自分で右隣の保存ボタンを押せる） |
| share text 内容 | （存在しない） | winner: 「{tournamentName} の優勝者は {winnerName} です（参加 N 人） #ALLinPokerTimer」 / season: 「{groupName} シーズン首位 {top1Name} {top1Points}pt #ALLinPokerTimer」 | 純関数 `formatWinnerShareText` / `formatSeasonShareText` で生成 |
| `/groups/[gid]/season` 過去シーズンセクション | 不在 | 過去シーズン accordion 一覧（Phase A の `listSeasonHistory` を一度 fetch） | 0 件のときセクション非表示 |
| logger 出力（観測用） | なし | `logger.info("share-card click", { kind, action, success })` 1 行 | PII 含めず、観測のみ。share / download それぞれに 1 行 |
| Color picker / プリセット | 既に Phase C improvement-02-02 で完了 | 変更なし | Phase D Scope から除外 |

---

## Mandatory Reading

| Priority | File | Lines | Why |
| --- | --- | --- | --- |
| P0 (critical) | [.claude/rules/error-logging.md](../../../rules/error-logging.md) | all | logger 経由ログ + `AppError.from` の規約。`console.*` 禁止。本 phase で新規 prefix `share/*`（`share/aborted` / `share/failed`）を導入 |
| P0 (critical) | [.claude/rules/security-base.md](../../../rules/security-base.md) | all | サークル固有データ非コミット。logger に PII（displayName / tournamentName）を出さない判断の根拠 |
| P0 (critical) | [.claude/rules/firebase-patterns.md](../../../rules/firebase-patterns.md) | all | Firestore SDK 直叩き禁止 / repository 経由のみ。`SeasonHistoryList` は `listSeasonHistory(gid)` のみ呼び、`getDocs` を直叩きしない |
| P0 (critical) | [.claude/rules/testing.md](../../../rules/testing.md) | all | mock 境界（hook 単位）/ characterization test ファースト。Phase B の既存 button test を破壊しないよう薄化リファクタの順序を守る |
| P0 (critical) | [.claude/PRPs/02-season-stats-and-share/prds/02-season-stats-and-share.prd.md](../prds/02-season-stats-and-share.prd.md) | 165-237 | Phase D の Scope / Success signal の真実源。Color picker UI が Phase C で完了済のため "NOT Building" にする判断材料 |
| P0 (critical) | [.claude/PRPs/02-season-stats-and-share/plans/completed/phase-b-result-card-generation.plan.md](completed/phase-b-result-card-generation.plan.md) | all | Phase B の `<a download>` 既存契約。`buildWinnerCardUrl` / `buildSeasonCardUrl` / `sanitizeFilename` の signature と invariants |
| P0 (critical) | [.claude/PRPs/02-season-stats-and-share/reports/phase-b-result-card-generation-report.md](../reports/phase-b-result-card-generation-report.md) | all | Phase B 完了の Deviation 記録（runtime: nodejs / WOFF / 英字ラベル等）。Phase D で route handler を**触らない**ことを再確認するため |
| P0 (critical) | [.claude/PRPs/02-season-stats-and-share/plans/completed/phase-a-season-stats-foundation.plan.md](completed/phase-a-season-stats-foundation.plan.md) | all | Phase A の `seasonHistory` schema 確定 / `endedAt desc` sort / `startedAt nullable` 仕様 |
| P0 (critical) | [.claude/PRPs/02-season-stats-and-share/reports/phase-c-improvement-02-02-report.md](../reports/phase-c-improvement-02-02-report.md) | 1-50 | Color picker / プリセットが Phase D の対象**外**であることを示す参照。NOT Building の根拠 |
| P0 (critical) | [src/components/tournament/WinnerCardDownloadButton.tsx](../../../../src/components/tournament/WinnerCardDownloadButton.tsx) | all | Phase B の既存 button。Phase D では内部だけ ShareOrDownloadButton に置換、外部 props は不変に保つ |
| P0 (critical) | [src/components/group/SeasonTopCardDownloadButton.tsx](../../../../src/components/group/SeasonTopCardDownloadButton.tsx) | all | 同上 |
| P0 (critical) | [src/components/tournament/WinnerCardDownloadButton.test.tsx](../../../../src/components/tournament/WinnerCardDownloadButton.test.tsx) | all | Phase B の characterization test 5 件。Phase D の薄化リファクタ後も全件 green に保つ |
| P0 (critical) | [src/components/group/SeasonTopCardDownloadButton.test.tsx](../../../../src/components/group/SeasonTopCardDownloadButton.test.tsx) | all | 同 8 件。`canShare` mock を `false` 固定で既存挙動温存（Task 6 / 8 で説明） |
| P0 (critical) | [src/app/api/og/_lib/og-payload.ts](../../../../src/app/api/og/_lib/og-payload.ts) | all | URL builder / sanitizeFilename / formatDateForLabel の signature 不変 |
| P0 (critical) | [src/lib/firebase/repositories/seasonHistory.ts](../../../../src/lib/firebase/repositories/seasonHistory.ts) | all | `listSeasonHistory(gid)` の戻り値（`endedAt desc` sort 済 / schema-invalid skip）。Phase D の閲覧 UI は本 API のみを呼ぶ |
| P0 (critical) | [src/lib/firebase/schemas/seasonHistory.ts](../../../../src/lib/firebase/schemas/seasonHistory.ts) | all | `SeasonHistoryDoc` 構造（`startedAt nullable Timestamp` / `endedAt Timestamp` / `entries: SeasonHistoryEntry[]`） |
| P0 (critical) | [src/app/groups/[gid]/season/season-ranking-client.tsx](../../../../src/app/groups/[gid]/season/season-ranking-client.tsx) | all | `SeasonHistoryList` を差し込む配線対象。`gid` / `group` / `stats` の hand-off pattern を mirror |
| P0 (critical) | [src/lib/errors.ts](../../../../src/lib/errors.ts) | all | `AppError.from` / `getErrorCode`。`share/*` prefix wrap で使う |
| P0 (critical) | [src/lib/logger.ts](../../../../src/lib/logger.ts) | all | logger 経由ログ規約 |
| P1 (important) | [src/components/ui/button.tsx](../../../../src/components/ui/button.tsx) | all | shadcn Button の variant / size / `asChild`。`ShareOrDownloadButton` も同 variant 系（`size="sm"` / `variant="default"`）で揃える |
| P1 (important) | [src/lib/hooks/useGroupRole.ts](../../../../src/lib/hooks/useGroupRole.ts) | all | hook 命名規約（`use*` + `{ a, b } = useFoo()` 戻り値）。`useCanShareImage` を同形で書く |
| P1 (important) | [src/app/groups/[gid]/_components/SeasonCard.tsx](../../../../src/app/groups/[gid]/_components/SeasonCard.tsx) | all | `_components/` の client component pattern。`SeasonHistoryList` も同フォルダではなく `season/` 配下に置く（理由は Files to Change 参照） |
| P1 (important) | [src/lib/firebase/repositories/seasonHistory.test.ts](../../../../src/lib/firebase/repositories/seasonHistory.test.ts) | all | repository テストの mock 境界。`SeasonHistoryList.test.tsx` で repository を mock するパターンの先例 |
| P2 (reference) | [docs/specification/08-season-stats.spec.md](../../../../docs/specification/08-season-stats.spec.md) | 50-90 | 業務仕様書の「過去シーズン履歴閲覧」セクションは「polish phase で拡充予定」と記載済。Phase D 完了後に「拡充済」に更新 |
| P2 (reference) | [docs/specification/09-result-card-share.spec.md](../../../../docs/specification/) | （存在確認のみ） | Phase B 範囲の業務仕様書がある場合は Web Share API 章を追加。なければ Phase D で新設しない（業務仕様書は spec-writer skill 経由で別途） |

## External Documentation

| Topic | Source | Key Takeaway |
| --- | --- | --- |
| Web Share API — `navigator.share()` | https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share | `share({ title, text, url, files })` を返す Promise。失敗時は reject。`AbortError` はユーザーキャンセル（silent）/ それ以外は実害ありとして logger.warn |
| Web Share API — `navigator.canShare()` | https://developer.mozilla.org/en-US/docs/Web/API/Navigator/canShare | `canShare({ files: [File] })` で「この具体的な files を share できるか」を boolean で返す。SSR では `navigator` 不在で false。実機判定は **CSR mount 後の useEffect 内**で必須 |
| Web Share API — file sharing support matrix | https://caniuse.com/web-share | iOS Safari 15+ / Android Chrome 89+ で files つき share をサポート。Desktop Chrome / Firefox は files 非対応または部分対応。**files 渡しを `canShare` で必ず gate する**（gate せず share すると Desktop Chrome で files が無視される実装あり） |
| `Response.blob()` → `File` への変換 | https://developer.mozilla.org/en-US/docs/Web/API/File/File | `new File([blob], filename, { type: "image/png" })` で File 化。`navigator.share({ files })` には **File 配列**を渡す必要がある（Blob では reject） |
| Next.js 15 Route Handler — Cache-Control | https://nextjs.org/docs/app/api-reference/file-conventions/route#caching | Phase B の OG route は `export const dynamic = "force-dynamic"`（既存）相当の挙動。`fetch(url, { cache: "no-store" })` でクライアント側も常に最新画像を取る |

```
KEY_INSIGHT: navigator.canShare は SSR で評価できない (window/navigator 不在)。
  Phase D では CSR mount 後の useEffect で 1 度だけ判定し、結果を state に保持する。
  mount 前は "loading" 状態で download button (フォールバック) を出す。share / download
  どちらも同じ visual で、文言だけ後から差し替える形を取れば user 視点の flicker は最小。
APPLIES_TO: Task 1 (useCanShareImage hook), Task 2 (ShareOrDownloadButton)
GOTCHA: SSR で `typeof navigator !== "undefined"` を直接チェックすると hydration mismatch
  が発生しうる。必ず useEffect (CSR-only) で判定する。
```

```
KEY_INSIGHT: navigator.share に File を渡す場合、navigator.canShare({ files }) の事前
  チェックが必須。チェック無しで share すると Desktop Chrome 等で「成功扱いだが files が
  無視される」silent failure が起きる。`canShare({ files: [<生成した File>] })` で File
  本体を渡して判定すれば、ブラウザ実装の files サポート可否を正しく検出できる。
APPLIES_TO: Task 2 (ShareOrDownloadButton の share path)
GOTCHA: dummy file (1×1 PNG 等) で canShare すると判定しか確かでなく、実際の OG 画像で
  share が失敗する可能性がある。実装では「OG URL を fetch → File を作る → canShare で
  validate → share」という完全ハッピーパスを 1 関数に閉じる。
```

```
KEY_INSIGHT: Web Share API の例外は 3 種類。
  1. AbortError = ユーザーがシェアシートを閉じた (silent でフォールバックも不要)
  2. NotAllowedError = 権限/transient activation 失敗 (button click 内で share() を呼ぶ
     ことで防ぐ。setTimeout 越しは NG)
  3. それ以外 = 実装バグ or Network 失敗 (logger.warn で記録 → <a download> へ silent fallback)
APPLIES_TO: Task 2 (ShareOrDownloadButton の error handling)
GOTCHA: AbortError を logger.warn してログ汚染しないこと。e.name === "AbortError" で early return。
```

```
KEY_INSIGHT: SeasonHistoryList は `listSeasonHistory(gid)` を 1 度だけ fetch する
  (subscribe ではない、append-only かつ閲覧頻度が低いため)。Phase D は subscribe 経路を
  足さず、必要なら次 phase で polish する。
APPLIES_TO: Task 5 (SeasonHistoryList)
GOTCHA: useEffect の cancel flag を忘れず、unmount 後に setState しない pattern を保つ
  (`subscribeSeasonStats` 既存の cancel pattern を mirror)。
```

---

## Patterns to Mirror

### NAMING_CONVENTION（hook + 共通 component）

```ts
// SOURCE: src/lib/hooks/useGroupRole.ts:1-30
// hook は `use*` + 戻り値 object 分割で複数 state を返す
import { useEffect, useState } from "react";
import type { GroupDoc, MemberRole } from "@/lib/firebase/schemas/group";
export function useGroupRole(gid: string | null | undefined): {
  group: GroupDoc | null;
  role: MemberRole | null;
} {
  /* ... */
}
```

```
// SOURCE: 既存 src/components/tournament/_table-label-edit/ の組み合わせ
// 共通 primitive は私的フォルダ `_share-button/` 配下に置き、
// route 対象外であることを命名で示す。share path 専用 component と純関数を共置
src/components/share/_share-button/ShareCardButton.tsx
src/components/share/_share-button/ShareCardButton.test.tsx
src/components/share/_share-button/use-can-share-image.ts
src/components/share/_share-button/use-can-share-image.test.ts
src/components/share/_share-button/share-text.ts
src/components/share/_share-button/share-text.test.ts
```

### ERROR_HANDLING（client 側 share 失敗の扱い）

```ts
// SOURCE: src/lib/errors.ts:11-16 + src/components/group/StartSeasonDialog.tsx 等の既存
//         pattern。share 失敗は AppError.from + logger.warn で wrap、AbortError のみ silent。
//         Phase D 設計: download ボタンが横に常時並列表示されているため、share 失敗時は
//         自動 fallback せず logger.warn のみ → ユーザーが右隣の「画像を保存」を押す導線で対応
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

async function doShare(file: File, text: string): Promise<"shared" | "aborted" | "failed"> {
  try {
    if (!navigator.canShare?.({ files: [file] })) return "failed";
    await navigator.share({ files: [file], text });
    return "shared";
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return "aborted";
    const wrapped = AppError.from(e, "share/failed", "シェアに失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    return "failed";
  }
}
```

### LOGGING_PATTERN（観測用 telemetry）

```ts
// SOURCE: src/lib/firebase/repositories/groups.ts:68 等の logger.info usage
// PII を含めず、kind/action/success のみ
logger.info("share-card click", {
  kind: "winner",      // "winner" | "season"
  action: "share",      // "share" | "download"
  success: true,
});
```

### FETCH-FILE-FROM-OG-ROUTE（client 側）

```ts
// SOURCE: 新規パターン。Phase B の OG route は image/png を返す
// 同一 origin / same-site のため CORS 不要、Cookie も不要
async function fetchOgFile(url: string, filename: string): Promise<File> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new AppError(
      `画像取得に失敗しました (status=${res.status})`,
      "share/fetch-failed",
    );
  }
  const blob = await res.blob();
  return new File([blob], `${filename}.png`, { type: "image/png" });
}
```

### REPOSITORY_FETCH_THEN_RENDER（SeasonHistoryList）

```tsx
// SOURCE: src/app/groups/[gid]/season/season-ranking-client.tsx:29-45
//   useEffect で fetch → setState、cancel flag で unmount 後 setState 防止
import { listSeasonHistory } from "@/lib/firebase/repositories/seasonHistory";
import type { SeasonHistoryDoc } from "@/lib/firebase/schemas/seasonHistory";

export function SeasonHistoryList({ gid }: { gid: string }) {
  const [items, setItems] = useState<SeasonHistoryDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let canceled = false;
    void (async () => {
      try {
        const list = await listSeasonHistory(gid);
        if (!canceled) setItems(list);
      } catch (e) {
        const wrapped = AppError.from(e, "firestore/read_failed", "履歴取得失敗");
        logger.warn(wrapped.message, { code: wrapped.code, gid });
        if (!canceled) setError(`${wrapped.code}: ${wrapped.message}`);
      }
    })();
    return () => { canceled = true; };
  }, [gid]);
  /* render */
}
```

### TEST_STRUCTURE（hook + UI）

```ts
// SOURCE: src/components/group/SeasonTopCardDownloadButton.test.tsx:31-55
//   Testing Library + screen.getByTestId + vi.mocked で navigator API を mock
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

beforeEach(() => {
  vi.unstubAllGlobals();
});

it("canShare が真のとき share path を辿る", async () => {
  const shareMock = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", {
    ...window.navigator,
    share: shareMock,
    canShare: vi.fn().mockReturnValue(true),
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    new Response(new Blob([new Uint8Array([0x89, 0x50, 0x4E, 0x47])])),
  ));
  /* render + click + expect shareMock 呼出 */
});
```

```ts
// SOURCE: src/lib/firebase/repositories/seasonHistory.test.ts:31-50
//   repository の mock pattern を流用。SeasonHistoryList.test.tsx でも同じく
//   `vi.mock("@/lib/firebase/repositories/seasonHistory", () => ({ listSeasonHistory: vi.fn() }))`
//   で boundary を引く
```

---

## Files to Change

| File | Action | Justification |
| --- | --- | --- |
| `src/components/share/_share-button/use-can-share-image.ts` | CREATE | `useCanShareImage(): boolean | "loading"` hook（CSR mount 後判定） |
| `src/components/share/_share-button/use-can-share-image.test.ts` | CREATE | hook の SSR / CSR / canShare false / canShare true / canShare 関数自体不在 の 4 ケース |
| `src/components/share/_share-button/ShareCardButton.tsx` | CREATE | share path 専用 button。`{ url, filenameStem, shareText, kind, label, dataTestId }` を受け取り、`canShare === true` のときだけ `<button>` を render（false / "loading" は null）|
| `src/components/share/_share-button/ShareCardButton.test.tsx` | CREATE | render gating（false / loading / true）、click → share 成功、AbortError silent、share fail logger.warn、fetch fail logger.warn の 6 ケース |
| `src/components/share/_share-button/share-text.ts` | CREATE | 純関数 `formatWinnerShareText` / `formatSeasonShareText`。tournament 名 / 表示名のサニタイズと文字数 cap を 1 ヶ所に集約 |
| `src/components/share/_share-button/share-text.test.ts` | CREATE | 純関数の境界 / 空 / cap |
| `src/app/groups/[gid]/season/_components/SeasonHistoryList.tsx` | CREATE | 過去シーズン accordion 一覧。`listSeasonHistory(gid)` を 1 度 fetch |
| `src/app/groups/[gid]/season/_components/SeasonHistoryList.test.tsx` | CREATE | empty / 1 件 / 複数件 / fetch fail / 内部 entries 0 件 の 5 ケース |
| `src/components/tournament/WinnerCardDownloadButton.tsx` | UPDATE | logger.info の 1 行追加のみ。**HTML / props / 既存テスト assert は完全無変更**（download path として温存） |
| `src/components/group/SeasonTopCardDownloadButton.tsx` | UPDATE | 同上 |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | UPDATE | `<WinnerBanner>` 直下の `<div className="flex justify-center">` 内に `<ShareCardButton>` を `<WinnerCardDownloadButton>` の左に並列追加 |
| `src/app/tournaments/[tid]/live/live-client.tsx` | UPDATE | 同上（live 画面側の WinnerBanner 直下） |
| `src/app/groups/[gid]/season/season-ranking-client.tsx` | UPDATE | 表の上の `<div className="flex justify-end">` 内に `<ShareCardButton>` を `<SeasonTopCardDownloadButton>` の左に並列追加 + `<SeasonHistoryList gid={gid} />` を表の下に挿入 |
| `.claude/PRPs/02-season-stats-and-share/prds/02-season-stats-and-share.prd.md` | UPDATE | Phase D 行を `pending` → `in-progress` + 本 plan へリンク。Color picker UI が Phase C で完了済の旨を Decisions Log に追記（任意） |
| `docs/specification/08-season-stats.spec.md` | UPDATE | 「過去シーズン履歴閲覧（polish phase で拡充予定）」を「拡充済 / 一覧と展開」に書き換え |
| `README.md` | UPDATE | Phase B で見送った機能節更新を本 phase でまとめて反映（Web Share + 履歴閲覧） |

## NOT Building

- **Color picker UI（プリセット 6〜8 色）** — PRD Phase D scope 文言には残るが、[`phase-c-improvement-02-02-report.md`](../reports/phase-c-improvement-02-02-report.md) Wave 1-3 / Wave 3 で 10 色プリセット + カスタム hex picker + サークル詳細カードの共有プリセットがすべて完了済（[`table-color-presets.ts`](../../../../src/components/tournament/_table-label-edit/table-color-presets.ts) 参照）。Phase D で再着手しない
- **Firebase Admin SDK / ID Token verify による server 側 access control** — Phase B の Risk セクションで明示した未対応事項。Phase D では Web Share API の client 体験のみを伸ばし、観戦モード（spectator URL）と一緒に**次フェーズ**で扱う
- **観戦モード（spectator URL）** — PRD What We're NOT Building に明記。本 phase の対象外
- **OGP メタタグ / X Card 専用最適化** — PRD で Won't と決定済（[PRD#L39](../prds/02-season-stats-and-share.prd.md)）
- **html2canvas 経由のクライアント側画像生成** — `@vercel/og` SSR 統一を維持
- **シーズン履歴閲覧 UI の高度化（フィルタ / グラフ / all-time 集計）** — Phase D の polish は「append-only 一覧の 1 度 fetch + accordion 表示」までに留める。high-volume サークル向けの polish は次フェーズ
- **share / download 押下イベントの Firestore 永続化（クリック数集計）** — `logger.info` で console / Vercel logs に出すのみ。専用 collection 追加は YAGNI
- **navigator.share の `url` プロパティ利用** — App URL 共有は本 phase の対象外。OG 画像 PNG **ファイル**を share する経路に限る（PRD 「画像保存 → SNS にアップロード」要件と整合）

---

## Step-by-Step Tasks

### Task 1: `useCanShareImage` hook + テスト

- **ACTION**: `src/components/share/_share-button/use-can-share-image.ts` を作成
- **IMPLEMENT**:

  ```ts
  import { useEffect, useState } from "react";

  /**
   * Web Share API での画像 (File) 共有が可能かを CSR mount 後に判定する hook。
   *
   *  - SSR では常に "loading" を返す（hydration mismatch 防止のため、初回 render は
   *    必ず "loading" 状態にする）
   *  - CSR mount 後、`navigator.canShare?.({ files: [<1×1 PNG dummy file>] })` で判定
   *  - 結果は state に保持。失敗（DOMException 等）は false 扱い
   */
  export type CanShareState = boolean | "loading";

  export function useCanShareImage(): CanShareState {
    const [state, setState] = useState<CanShareState>("loading");
    useEffect(() => {
      try {
        if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") {
          setState(false);
          return;
        }
        const dummy = new File(
          [new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
          "probe.png",
          { type: "image/png" },
        );
        setState(navigator.canShare({ files: [dummy] }));
      } catch {
        setState(false);
      }
    }, []);
    return state;
  }
  ```

- **MIRROR**: `src/lib/hooks/useGroupRole.ts` の hook 命名・戻り値構造 / `src/lib/hooks/useFullscreen.ts` の CSR-only 判定 pattern
- **IMPORTS**: `react` のみ
- **GOTCHA**:
  - SSR で `typeof navigator` をチェックしても、`useState` の初期値は SSR 評価される。**初期値を必ず `"loading"`** にして、CSR mount 後の `useEffect` で確定値に書換える形が正解
  - `navigator.canShare` 自体が optional chain で見えないブラウザがあるため `typeof === "function"` を使う
  - dummy File は **新しい File オブジェクト**を毎回生成すること（Safari は再利用 File で false を返すケースが報告されている）
- **VALIDATE**:
  - `npm run typecheck` PASS
  - `use-can-share-image.test.ts` で 4 ケース PASS:
    1. `navigator` 不在 → "loading" → false
    2. `navigator.canShare` 不在 → false
    3. `navigator.canShare({ files })` 真 → true
    4. `navigator.canShare` が throw → false（catch silent）

### Task 2: `ShareCardButton` primitive + テスト

- **ACTION**: `src/components/share/_share-button/ShareCardButton.tsx` を作成。**share path 専用**で、download fallback は持たない（並列の既存 `*DownloadButton` が常時可視のため）
- **IMPLEMENT**:

  ```tsx
  "use client";

  import { Share2 } from "lucide-react";
  import { useCanShareImage } from "./use-can-share-image";
  import { Button } from "@/components/ui/button";
  import { AppError } from "@/lib/errors";
  import { logger } from "@/lib/logger";

  interface Props {
    /** OG image route の URL（例: "/api/og/winner/{tid}?..."）。same-origin 限定 */
    url: string;
    /** File 名 stem（拡張子なし）。`<File>` の name に `.png` を付けて渡す */
    filenameStem: string;
    /** share の `text` フィールド */
    shareText: string;
    /** telemetry 用 kind */
    kind: "winner" | "season";
    /** visible button label */
    label: string;
    dataTestId?: string;
    className?: string;
  }

  /**
   * Phase D: Web Share API でファイル共有が可能な端末でのみ render する追加ボタン。
   *
   *  - `useCanShareImage` が真でない場合は **null を返す**（並列の DownloadButton が常時可視）
   *  - 失敗時は logger.warn のみで silent。download への自動 fallback はしない（隣の保存ボタンを user が押す想定）
   *  - AbortError は silent（ユーザーキャンセル）
   */
  export function ShareCardButton({
    url, filenameStem, shareText, kind, label, dataTestId, className,
  }: Props) {
    const canShare = useCanShareImage();
    if (canShare !== true) return null;
    return (
      <Button
        type="button"
        size="sm"
        variant="default"
        className={className}
        onClick={() => void runShare(url, filenameStem, shareText, kind)}
        data-testid={dataTestId}
      >
        <Share2 aria-hidden /> {label}
      </Button>
    );
  }

  async function runShare(
    url: string, filenameStem: string, shareText: string, kind: "winner" | "season",
  ): Promise<"shared" | "aborted" | "failed"> {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        throw new AppError(`画像取得失敗 status=${res.status}`, "share/fetch-failed");
      }
      const blob = await res.blob();
      const file = new File([blob], `${filenameStem}.png`, { type: "image/png" });
      if (!navigator.canShare?.({ files: [file] })) {
        // canShare が突然 false に戻った（実機での挙動差分）。silent に return
        logger.warn("share/canshare-false-after-fetch", { kind });
        return "failed";
      }
      await navigator.share({ files: [file], text: shareText });
      logger.info("share-card click", { kind, action: "share", success: true });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        // ユーザーキャンセル — 何もしない（logger も呼ばない）
        return "aborted";
      }
      const wrapped = AppError.from(e, "share/failed", "シェアに失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code, kind });
      return "failed";
    }
  }
  ```

- **MIRROR**:
  - shadcn Button → [`src/components/ui/button.tsx`](../../../../src/components/ui/button.tsx)
  - error 処理 → [`error-logging.md`](../../../rules/error-logging.md) + [`src/lib/errors.ts:11-16`](../../../../src/lib/errors.ts#L11-L16)
- **IMPORTS**: `lucide-react` (Share2), `@/components/ui/button`, `@/lib/errors`, `@/lib/logger`, `./use-can-share-image`
- **GOTCHA**:
  - `navigator.share()` は **transient activation** が必要。click ハンドラ内で同期的に await する形は OK だが、`setTimeout` で遅延させると失敗する → 必ず click 直後に呼ぶ
  - `useCanShareImage` 初期値が "loading" のため、CSR mount 直後の数 ms は share button が render されない（ちらつきは event loop 1〜2 tick 程度）。download button は常時可視なので user の機能利用は阻害されない
  - `AbortError` を throw した時に logger.warn しないこと。 `e.name === "AbortError"` で early return
  - download path に倒さず logger.warn のみで終わるため、user は失敗時に右隣の「画像を保存」を押す（並列表示の利点）
- **VALIDATE**:
  - `npm run typecheck` PASS
  - `ShareCardButton.test.tsx` で 6 ケース PASS:
    1. `useCanShareImage` mock = "loading" → null（render されない）
    2. mock = false → null
    3. mock = true / click → `navigator.share` 呼出 / logger.info success
    4. mock = true / AbortError → silent / logger.warn 呼ばれない
    5. mock = true / fetch fail → logger.warn / `navigator.share` は呼ばれない
    6. mock = true / share() generic throw → logger.warn

### Task 3: `share-text.ts` 純関数 + テスト

- **ACTION**: `src/components/share/_share-button/share-text.ts` を作成
- **IMPLEMENT**:

  ```ts
  /**
   * Phase D: Web Share API の `text` フィールドを純関数で組み立てる。
   *
   *  - PII を控えめにし、displayName / tournamentName を含むが SNS 投稿前提 OK
   *  - 全角 / 半角混在で 80 字程度を上限（Twitter / X の 280 chars と LINE の preview を考慮）
   *  - displayName が 0 文字 / null の場合は "—" にフォールバック
   */
  const SHARE_TEXT_MAX = 140;

  export function truncateForShare(s: string, max = SHARE_TEXT_MAX): string {
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + "…";
  }

  export function formatWinnerShareText(input: {
    tournamentName: string;
    winnerName: string;
    participants: number;
  }): string {
    const winner = input.winnerName.trim() || "—";
    const tname = input.tournamentName.trim() || "トーナメント";
    return truncateForShare(
      `${tname} の優勝者は ${winner} です（参加 ${input.participants} 人） #ALLinPokerTimer`,
    );
  }

  export function formatSeasonShareText(input: {
    groupName: string;
    top1Name: string;
    top1Points: number;
  }): string {
    const top1 = input.top1Name.trim() || "—";
    const gname = input.groupName.trim() || "サークル";
    return truncateForShare(
      `${gname} シーズン首位 ${top1} ${input.top1Points.toFixed(2)} pt #ALLinPokerTimer`,
    );
  }
  ```

- **MIRROR**: [`src/lib/services/season-points.ts`](../../../../src/lib/services/season-points.ts) の純関数 / 純テスト pattern
- **IMPORTS**: なし
- **GOTCHA**:
  - `top1Points` は number。`.toFixed(2)` で小数 2 桁表示（保存値と表示値の規約一致）
  - 文字数 cap は控えめ（140）。Twitter は 280 だが LINE は preview 抜粋でも崩れにくい量を選ぶ
  - 空白除去は trim のみ。NFKC 正規化は行わない（ユーザー入力をなるべく素直に通す）
- **VALIDATE**:
  - `share-text.test.ts` で 6 ケース PASS:
    1. winner happy / 全角混在
    2. winner displayName 空 → "—"
    3. winner cap 切詰
    4. season happy
    5. season top1Points = 0 → "0.00 pt"
    6. season top1Points = 1.234 → "1.23 pt"

### Task 4: `WinnerCardDownloadButton` に telemetry 1 行を追加

- **ACTION**: [`WinnerCardDownloadButton.tsx`](../../../../src/components/tournament/WinnerCardDownloadButton.tsx) を更新。**HTML / props / 既存 visual は完全無変更**、`<a>` の `onClick` で `logger.info` を 1 行追加するだけ
- **IMPLEMENT**:

  ```tsx
  // 既存 import に追加
  import { logger } from "@/lib/logger";

  // 既存 <a> に onClick を追加（href / download / data-testid / children は無変更）
  <a
    href={url}
    download={filename}
    data-testid="winner-card-download"
    onClick={() => logger.info("share-card click", { kind: "winner", action: "download", success: true })}
  >
    <Download aria-hidden />
    画像を保存
  </a>
  ```

- **MIRROR**: 同 file の Phase B 実装。属性順序や class 名を一切変えない
- **IMPORTS**: `@/lib/logger`
- **GOTCHA**:
  - 既存 5 件のテスト（href / download / testid / filename / 特殊文字 escape の assert）は完全無変更で green を維持する。`onClick` 追加は DOM の attribute / children 構造に影響しない
  - logger.info の呼出は副作用のみで render 結果には影響しない
- **VALIDATE**: `npm test src/components/tournament/WinnerCardDownloadButton` 既存 5 件全件 PASS（無変更）

### Task 5: `SeasonTopCardDownloadButton` に telemetry 1 行を追加

- **ACTION**: 同 pattern で [`SeasonTopCardDownloadButton.tsx`](../../../../src/components/group/SeasonTopCardDownloadButton.tsx) を更新
- **IMPLEMENT**:

  ```tsx
  import { logger } from "@/lib/logger";

  <a
    href={url}
    download={filename}
    data-testid="season-top-card-download"
    onClick={() => logger.info("share-card click", { kind: "season", action: "download", success: true })}
  >
    <Download aria-hidden />
    シーズン首位カードを保存
  </a>
  ```

- **MIRROR**: Task 4
- **IMPORTS**: `@/lib/logger`
- **GOTCHA**:
  - `stats.length === 0` の early return 経路は変えない（Phase B と同じ契約）
  - 既存 8 件のテストは完全無変更
- **VALIDATE**: `npm test src/components/group/SeasonTopCardDownloadButton` 既存 8 件全件 PASS（無変更）

### Task 6: dashboard / live への `<ShareCardButton>` 並列配置

- **ACTION**:
  - [`dashboard-client.tsx:354-367`](../../../../src/app/tournaments/[tid]/dashboard-client.tsx#L354-L367) の `<div className="flex justify-center">` 内に `<ShareCardButton>` を `<WinnerCardDownloadButton>` の左に追加
  - [`live-client.tsx`](../../../../src/app/tournaments/[tid]/live/live-client.tsx) の同等箇所も同様
- **IMPLEMENT**:

  ```tsx
  // 既存 import に追加
  import { ShareCardButton } from "@/components/share/_share-button/ShareCardButton";
  import {
    buildWinnerCardUrl,
    formatDateForFilename,
    formatDateForLabel,
    sanitizeFilename,
  } from "@/app/api/og/_lib/og-payload";
  import { formatWinnerShareText } from "@/components/share/_share-button/share-text";

  // ShareCardButton で渡す url / filenameStem / shareText を組み立てる helper を内部に定義する
  // か、useMemo で派生 state にまとめる。WinnerCardDownloadButton の内部で同じ計算をしているため
  // 二重計算になるが、Phase D の最小差分を優先（将来 P-refactor で共通化）
  const finishedAtDate = winner ? (data.finishedAt?.toDate() ?? new Date()) : null;
  const shareWinnerProps = winner && finishedAtDate ? (() => {
    const datePart = formatDateForFilename(finishedAtDate);
    const filenameStem = sanitizeFilename(`winner-${data.name}-${datePart}`);
    const url = buildWinnerCardUrl(tid, {
      winnerName: winner.displayName,
      tournamentName: data.name,
      participants: players.length,
      finishedAtLabel: formatDateForLabel(finishedAtDate),
      filename: filenameStem,
    });
    const shareText = formatWinnerShareText({
      tournamentName: data.name,
      winnerName: winner.displayName,
      participants: players.length,
    });
    return { url, filenameStem, shareText };
  })() : null;

  // 既存の <div className="flex justify-center"> を flex gap-2 に変更し、ShareCardButton を左に追加
  {winner ? (
    <>
      <WinnerBanner winner={winner} />
      <div className="flex flex-wrap items-center justify-center gap-2">
        {shareWinnerProps ? (
          <ShareCardButton
            url={shareWinnerProps.url}
            filenameStem={shareWinnerProps.filenameStem}
            shareText={shareWinnerProps.shareText}
            kind="winner"
            label="シェア"
            dataTestId="winner-card-share"
          />
        ) : null}
        <WinnerCardDownloadButton
          tid={tid}
          winnerName={winner.displayName}
          tournamentName={data.name}
          participants={players.length}
          finishedAt={finishedAtDate ?? new Date()}
        />
      </div>
    </>
  ) : null}
  ```

- **MIRROR**: 既存 `<WinnerCardDownloadButton>` 配置 / dashboard-client の Phase B 配線
- **IMPORTS**: `@/components/share/_share-button/ShareCardButton`, `@/app/api/og/_lib/og-payload` (3 関数), `@/components/share/_share-button/share-text` (1 関数)
- **GOTCHA**:
  - `data-testid="winner-card-share"` は新規（既存の `winner-card-download` と被らない名前にする）。E2E selector の互換性を保つため既存 testid は変えない
  - URL / filenameStem / shareText の組立を `WinnerCardDownloadButton` 内部と二重に行うことになる。Phase D の最小差分優先で許容、将来 hook に集約する場合は別 phase で
  - 並列 layout は `flex flex-wrap items-center gap-2`。スマホ small viewport で button が 2 行になっても OK
- **VALIDATE**:
  - `npm run typecheck` PASS
  - dev server で `state="finished"` トーナメント画面 → 2 ボタン並列表示（canShare 真の端末）/ 1 ボタンのみ（canShare 偽の端末）

### Task 7: シーズンランキング画面への `<ShareCardButton>` 並列配置

- **ACTION**: [`season-ranking-client.tsx:103-105`](../../../../src/app/groups/[gid]/season/season-ranking-client.tsx#L103-L105) の `<div className="flex justify-end">` 内に `<ShareCardButton>` を `<SeasonTopCardDownloadButton>` の左に追加
- **IMPLEMENT**:

  ```tsx
  // 既存 import に追加
  import { ShareCardButton } from "@/components/share/_share-button/ShareCardButton";
  import {
    buildSeasonCardUrl,
    formatDateForFilename,
    formatDateForLabel,
    sanitizeFilename,
    type SeasonCardQuery,
  } from "@/app/api/og/_lib/og-payload";
  import { formatSeasonShareText } from "@/components/share/_share-button/share-text";

  // stats / group から share 用 props を派生（SeasonTopCardDownloadButton 内部と同形）
  const top1 = stats[0];
  const top2 = stats.at(1);
  const top3 = stats.at(2);
  const startDateObj = group.seasonStartDate ? group.seasonStartDate.toDate() : null;
  const datePart = startDateObj ? formatDateForFilename(startDateObj) : "open";
  const filenameStem = sanitizeFilename(`season-${group.name}-${datePart}`);
  const url = top1 ? buildSeasonCardUrl(gid, {
    groupName: group.name,
    seasonStartDateLabel: startDateObj ? formatDateForLabel(startDateObj) : null,
    top1Name: top1.displayName,
    top1Points: top1.totalPoints,
    top2Name: top2?.displayName,
    top2Points: top2?.totalPoints,
    top3Name: top3?.displayName,
    top3Points: top3?.totalPoints,
    filename: filenameStem,
  } satisfies SeasonCardQuery) : null;
  const shareText = top1 ? formatSeasonShareText({
    groupName: group.name,
    top1Name: top1.displayName,
    top1Points: top1.totalPoints,
  }) : null;

  // 既存 <div className="flex justify-end"> を gap 付きに、ShareCardButton を左に追加
  <div className="flex flex-wrap items-center justify-end gap-2">
    {url && shareText ? (
      <ShareCardButton
        url={url}
        filenameStem={filenameStem}
        shareText={shareText}
        kind="season"
        label="首位をシェア"
        dataTestId="season-top-card-share"
      />
    ) : null}
    <SeasonTopCardDownloadButton gid={gid} group={group} stats={stats} />
  </div>
  ```

- **MIRROR**: Task 6
- **IMPORTS**: 同上 + `formatSeasonShareText`
- **GOTCHA**:
  - 既存 SeasonTopCardDownloadButton.test.tsx は影響を受けない（呼出側のレイアウトのみ変更）
  - `data-testid="season-top-card-share"` も新規。download 側 testid は無変更
  - 二重計算の許容理由は Task 6 と同じ
- **VALIDATE**:
  - `npm run typecheck` PASS
  - dev server で `/groups/{gid}/season` 画面 → 2 ボタン並列表示（canShare 真）/ 1 ボタンのみ（canShare 偽）

### Task 8: `SeasonHistoryList` component + テスト

- **ACTION**: `src/app/groups/[gid]/season/_components/SeasonHistoryList.tsx` を作成
- **IMPLEMENT**:

  ```tsx
  "use client";

  import { ChevronDown, ChevronRight } from "lucide-react";
  import { useEffect, useState } from "react";

  import { Button } from "@/components/ui/button";
  import { AppError } from "@/lib/errors";
  import { listSeasonHistory } from "@/lib/firebase/repositories/seasonHistory";
  import type { SeasonHistoryDoc } from "@/lib/firebase/schemas/seasonHistory";
  import { logger } from "@/lib/logger";

  /**
   * Phase D: 過去シーズン一覧。`endedAt desc` 順で accordion 表示。
   *
   *  - 1 度だけ fetch（subscribe しない、append-only / 閲覧頻度低）
   *  - 0 件のときセクションごと非表示
   *  - 個別エントリの展開で top3 まで表示
   */
  export function SeasonHistoryList({ gid }: { gid: string }) {
    const [items, setItems] = useState<SeasonHistoryDoc[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    useEffect(() => {
      let canceled = false;
      void (async () => {
        try {
          const list = await listSeasonHistory(gid);
          if (!canceled) {
            setItems(list);
            setLoading(false);
          }
        } catch (e) {
          const wrapped = AppError.from(e, "firestore/read_failed", "履歴取得失敗");
          logger.warn(wrapped.message, { code: wrapped.code, gid });
          if (!canceled) {
            setError(`${wrapped.code}: ${wrapped.message}`);
            setLoading(false);
          }
        }
      })();
      return () => { canceled = true; };
    }, [gid]);

    if (loading) {
      return <p className="text-sm text-muted-foreground">過去シーズンを読込中…</p>;
    }
    if (error) {
      return <p className="text-sm text-destructive" role="alert">{error}</p>;
    }
    if (items.length === 0) {
      return null; // セクション非表示
    }

    return (
      <section className="space-y-2" aria-labelledby="season-history-heading">
        <h2 id="season-history-heading" className="text-lg font-semibold">過去シーズン</h2>
        <ul className="space-y-1">
          {items.map((h) => {
            const top1 = [...h.entries].sort((a, b) => b.totalPoints - a.totalPoints)[0];
            const isOpen = expanded.has(h.id);
            const top3 = [...h.entries].sort((a, b) => b.totalPoints - a.totalPoints).slice(0, 3);
            return (
              <li key={h.id} className="rounded-md border p-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2 px-1"
                  aria-expanded={isOpen}
                  data-testid={`season-history-toggle-${h.id}`}
                  onClick={() => {
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      next.has(h.id) ? next.delete(h.id) : next.add(h.id);
                      return next;
                    });
                  }}
                >
                  {isOpen ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
                  <span>
                    {formatRange(h.startedAt, h.endedAt)}
                    {top1 ? ` — 首位: ${top1.displayName} ${top1.totalPoints.toFixed(2)} pt` : " — 戦績なし"}
                  </span>
                </Button>
                {isOpen && top3.length > 0 ? (
                  <ol className="mt-2 ml-6 list-decimal text-sm">
                    {top3.map((e) => (
                      <li key={e.uid}>
                        {e.displayName} — {e.totalPoints.toFixed(2)} pt
                        <span className="text-muted-foreground"> （参加 {e.participations} / 優勝 {e.wins}）</span>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  function formatRange(startedAt: SeasonHistoryDoc["startedAt"], endedAt: SeasonHistoryDoc["endedAt"]): string {
    const startStr = startedAt ? startedAt.toDate().toLocaleDateString("ja-JP") : "未設定";
    const endStr = endedAt.toDate().toLocaleDateString("ja-JP");
    return `${startStr} 〜 ${endStr}`;
  }
  ```

- **MIRROR**:
  - useEffect cancel pattern → [`season-ranking-client.tsx:29-45`](../../../../src/app/groups/[gid]/season/season-ranking-client.tsx#L29-L45)
  - error handling → [`error-logging.md`](../../../rules/error-logging.md) `unwrapOrFrom` 利用は不要（`listSeasonHistory` 内で wrap 済 + UI で再度 wrap しないように `unwrapOrFrom` を使う方が正しい）
- **IMPORTS**: `react`, `lucide-react`, `@/lib/errors`, `@/lib/firebase/repositories/seasonHistory`, `@/lib/firebase/schemas/seasonHistory`, `@/lib/logger`, `@/components/ui/button`
- **GOTCHA**:
  - `listSeasonHistory` は内部で `wrapFirestoreRead` 経由で wrap 済。UI 側で `AppError.from` を再度呼ぶと二重 warn になる → **`unwrapOrFrom` を使うのが正解**（[`error-logging.md`](../../../rules/error-logging.md) 「unwrapOrFrom: 既に wrap されている可能性のある」セクション）
  - `entries` は schema 上 totalPoints 順で sort されていない（[`seasonHistory.ts` schema コメント](../../../../src/lib/firebase/schemas/seasonHistory.ts#L34) 「totalPoints desc は read 側で sort」）→ **読み出し側 (本 component) で必ず sort** してから top1 / top3 を取る
  - `expanded` は `Set<string>` で管理。React の参照等価 break のため毎回新規 Set を生成
- **VALIDATE**:
  - `SeasonHistoryList.test.tsx` で 5 ケース PASS:
    1. items=[] → null render（セクション非表示）
    2. items=1 件 / entries=[] → 「戦績なし」表示
    3. items=1 件 / entries=3 件 → 首位表示 + 展開で top3 表示
    4. fetch 失敗 → role="alert" にエラー文表示
    5. items=2 件で `endedAt desc` 順を維持（repository が sort 済の前提を assert）

### Task 9: `season-ranking-client.tsx` に `<SeasonHistoryList>` を追加配線

- **ACTION**: Task 7 で既に `<ShareCardButton>` を並列追加済の [`season-ranking-client.tsx`](../../../../src/app/groups/[gid]/season/season-ranking-client.tsx) に、過去シーズンセクション `<SeasonHistoryList gid={gid} />` を表の**下**および `stats.length === 0` ブランチに挿入
- **IMPLEMENT**: `<table>` の終了直後に `<SeasonHistoryList gid={gid} />` を追加。`stats.length === 0` ブランチでも `SeasonHistoryList` を render（過去シーズンはあり得るため）。具体的な diff（Task 7 の編集と独立して安全に重ねられる）:

  ```diff
  +import { SeasonHistoryList } from "./_components/SeasonHistoryList";

   {stats.length === 0 ? (
  -  <p className="text-sm text-muted-foreground">
  -    このシーズンの戦績はまだありません。トーナメントが終了すると自動的に記録されます。
  -  </p>
  +  <>
  +    <p className="text-sm text-muted-foreground">
  +      このシーズンの戦績はまだありません。トーナメントが終了すると自動的に記録されます。
  +    </p>
  +    <SeasonHistoryList gid={gid} />
  +  </>
   ) : (
     <>
       <div className="flex justify-end">
         <SeasonTopCardDownloadButton gid={gid} group={group} stats={stats} />
       </div>
       <table className="w-full text-sm">…</table>
  +    <SeasonHistoryList gid={gid} />
     </>
   )}
  ```

- **MIRROR**: 同 file の他 `useEffect` cancel pattern と整合
- **IMPORTS**: `./_components/SeasonHistoryList`
- **GOTCHA**:
  - `_components/` の path は **`season/_components/`** とする（gid 階層直下に置くと group-detail-client 用と衝突するため、`season/` 配下に scope する）
  - `season-ranking-client.tsx` 自身のテストは **未存在**（Phase A 時点）。Phase D で追加するなら scope に追加するが、Task 8 の `SeasonHistoryList.test.tsx` で必要なケースは網羅されているため、wire-up テストは E2E の判断とする
- **VALIDATE**:
  - `npm run typecheck` PASS
  - dev server で手動確認: `/groups/{gid}/season` 画面に過去シーズンセクションが表示
  - 過去シーズン 0 件のとき「過去シーズン」見出しが**出ない**こと

### Task 10: PRD Phase D を `in-progress` に更新 + 本 plan へリンク

- **ACTION**: [`02-season-stats-and-share.prd.md`](../prds/02-season-stats-and-share.prd.md) の Implementation Phases 表を更新
- **IMPLEMENT**:
  - Phase D 行: status `pending` → `in-progress`
  - PRP Plan 列: `[phase-d-web-share-and-polish.plan.md](../plans/phase-d-web-share-and-polish.plan.md)` を追加
  - Decisions Log（任意）: 「Color picker UI は Phase C improvement-02-02 で完了済のため Phase D scope から除外」を 1 行追記
- **MIRROR**: Phase A / B / C 行の更新先例
- **IMPORTS**: なし
- **GOTCHA**:
  - PRD 中の Open Questions「Web Share API のフォールバック挙動」は本 plan で確定（plan 内で解答するのが規約 — Phase B plan の Task 11 GOTCHA を参照）。PRD 本体の Open Questions は更新不要、Phase D report 提出時に解決済みフラグを立てる
- **VALIDATE**: PRD diff 目視確認

### Task 11: README + 業務仕様書 (08) 更新

- **ACTION**:
  - [`README.md`](../../../../README.md): 機能リストに「Web Share API による 1 タップシェア」「過去シーズン履歴閲覧」を追記。Phase B で見送った update も同時に反映
  - [`docs/specification/08-season-stats.spec.md`](../../../../docs/specification/08-season-stats.spec.md): `2.2.6 過去シーズンの履歴閲覧` セクションの「履歴閲覧 UI は polish phase で拡充予定」を「履歴閲覧 UI: 過去シーズン accordion 一覧で展開可能（Phase D 完了時点）」に書き換え
- **IMPLEMENT**: 文言追加のみ。新セクションは作らず既存節を inline で update
- **MIRROR**: Phase A / B 完了後の README 更新パターン
- **GOTCHA**: 業務仕様書は spec-writer skill の規約に沿う（[`.claude/skills/spec-writer/`](../../../skills/) を spec-writer 起動時に Read することを README で確認）。本 phase は inline 更新のみで spec-writer を起動しない
- **VALIDATE**: link checker は手動

### Task 12: 仕上げ — 全件テスト + lint + build + emulator validation

- **ACTION**: 最終検証。本 phase は **rules / schema / repository をひとつも触らない** ため emulator validator の追加は不要だが、回帰防止で既存 emulator validator (test:rules-limits / test:rules-season / test:rules-table-labels) を 1 度走らせる
- **IMPLEMENT**:
  - `npm run typecheck`
  - `npm run lint`
  - `npm test` 全件
  - `npm run test:rules-limits` （emulator 不要）
  - `firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e "npm run test:rules-season && npm run test:rules-table-labels"` （emulator 起動）
  - `npm run build`
  - dev server で manual validation（後述）
- **MIRROR**: Phase A / B / C 完了直前の検証セット
- **GOTCHA**: emulator validation は本 phase で実装変更が無いが、Codex review 時の前提として「Phase D 直前 commit でも全 emulator green」を残す
- **VALIDATE**: 全件 PASS

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| --- | --- | --- | --- |
| `useCanShareImage` SSR-like (navigator unset) | `navigator = undefined` | "loading" 後 false | ✓ SSR |
| `useCanShareImage` no canShare fn | `navigator.canShare = undefined` | false | ✓ |
| `useCanShareImage` canShare → true | `navigator.canShare({files}) === true` | true | - |
| `useCanShareImage` canShare throws | `canShare` 関数が throw | false（catch silent） | ✓ |
| `ShareCardButton` loading | hook returns "loading" | null (render なし) | - |
| `ShareCardButton` false | hook returns false | null (render なし) | - |
| `ShareCardButton` true / share success | share happy | `<button>` 表示 / click → `navigator.share` 1 回呼出 + logger.info | - |
| `ShareCardButton` AbortError | share throws AbortError | logger.warn 呼ばれない（silent） | ✓ |
| `ShareCardButton` fetch fail | fetch returns 500 | logger.warn / `navigator.share` 呼ばれない（並列の DownloadButton が代替） | ✓ |
| `ShareCardButton` generic error | share throws Error | logger.warn のみ（自動 fallback なし） | ✓ |
| `formatWinnerShareText` happy | name=Alice / 8 | "{tname} の優勝者は Alice です（参加 8 人）..." | - |
| `formatWinnerShareText` empty name | winnerName="" | "—" にフォールバック | ✓ 空 |
| `formatWinnerShareText` cap | 200 文字 input | 140 文字以内、末尾 "…" | ✓ 上限 |
| `formatSeasonShareText` happy | top1Points=47.83 | "47.83 pt" 含む | - |
| `formatSeasonShareText` 0 pt | top1Points=0 | "0.00 pt" | ✓ |
| `WinnerCardDownloadButton` 既存 5 件 | 既存 props | href / download / testid 等価（onClick 追加で render は無変更） | - |
| `SeasonTopCardDownloadButton` 既存 8 件 | 既存 props | 同上（onClick 追加で render は無変更） | - |
| `SeasonHistoryList` empty | listSeasonHistory=[] | null render | ✓ 0 件 |
| `SeasonHistoryList` 1 件 / entries=[] | 戦績なし | 「戦績なし」表示、展開で空 | ✓ |
| `SeasonHistoryList` 1 件 / entries=3 | top3 sort 維持 | 首位表示 + 展開で top3 | - |
| `SeasonHistoryList` fetch fail | listSeasonHistory throw | role="alert" でエラー文 | ✓ 例外 |
| `SeasonHistoryList` 2 件 endedAt desc | repo 戻り値の order | UI も同じ順 | - |

### Edge Cases Checklist

- [x] SSR / hydration mismatch を起こさない（`useCanShareImage` 初期値 = "loading" → mount 後 false）
- [x] AbortError は silent（logger.warn しない）
- [x] navigator.share 自体不在のブラウザ → ShareCardButton が null を返し、並列の DownloadButton のみ可視
- [x] fetch 500 / network 失敗 / share 失敗 → ShareCardButton 内で logger.warn のみ。user は隣の「画像を保存」を押せる
- [x] entries 順序を信用しない（必ず client sort）
- [x] 過去シーズン 0 件 → セクションごと非表示
- [x] startedAt null（初回切替シーズン）→ "未設定" 表示
- [x] data-testid は share path / download path で**別名**（`*-share` / `*-download`）。E2E selector で両ボタンを区別可能

### Manual Validation（dev server）

- [ ] `npm run dev` 起動
- [ ] **Desktop Chrome**: Winner 画面 / Season ランキング画面で「画像を保存」ボタンのみ表示（share button は null で消える）
- [ ] **iOS Safari (16+) または Android Chrome (90+)**: 同画面で `[シェア] [画像を保存]` の **2 ボタンが横並び**で表示される
- [ ] 2 ボタン並列状態で「シェア」を押下 → OS シェアシートが開く / LINE などでテストアプリへ送信できる
- [ ] 2 ボタン並列状態で「画像を保存」を押下 → 既存の `<a download>` 動作（保存ダイアログ or 新規タブ表示）
- [ ] OG 画像（PNG）が File として共有される
- [ ] AbortError（シェアシートを閉じる）後、再度押下できる（toast / error UI は出ない）
- [ ] share の fetch / share 自体が失敗しても画面は壊れず、user は右隣の「画像を保存」で代替できる
- [ ] `/groups/{gid}/season` で過去シーズンセクションが表示される（履歴 1 件以上ある group で）
- [ ] 履歴アイテムを展開すると top3 まで表示される
- [ ] 履歴 0 件の group では「過去シーズン」見出し自体が出ない
- [ ] `getSeasonStats` が rule で permission-denied になる member 外 user で開いた場合、エラー UI が出る（既存 season-ranking-client の挙動を踏襲）

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
```

EXPECT: Zero type errors

```bash
npm run lint
```

EXPECT: Zero warnings

### Unit Tests

```bash
npm test src/components/share src/components/tournament/WinnerCardDownloadButton src/components/group/SeasonTopCardDownloadButton "src/app/groups/[gid]/season/_components/SeasonHistoryList"
```

EXPECT: 全 PASS（推定 22〜26 ケース）

### Full Test Suite

```bash
npm test
```

EXPECT: Phase B 完了時の 978 件 + 本 phase 追加分（22〜26）が PASS。回帰なし

### Build Verification

```bash
npm run build
```

EXPECT:
- Build PASS
- 既存 OG route が `/api/og/winner/[tid]` / `/api/og/season/[gid]` の Dynamic として登録されたまま
- Phase D で route handler / rule を触っていないため、Route summary に変更なし

### Firestore Rules Validation（変更なし、回帰チェック）

```bash
npm run test:rules-limits
firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e "node scripts/test-rules-season.mjs"
firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e "node scripts/test-rules-table-labels.mjs"
```

EXPECT: 全 PASS（Phase D は rule 変更なし）

### Browser Validation

```bash
npm run dev
```

EXPECT: 上記 Manual Validation チェックリスト全 PASS

---

## Acceptance Criteria

- [ ] `useCanShareImage` hook が CSR mount 後に判定して `boolean | "loading"` を返す
- [ ] `ShareCardButton` が `canShare === true` のときだけ render し、それ以外は null を返す
- [ ] Winner / シーズン首位 のエリアで、`canShare === true` 端末では `[シェア] [画像を保存]` の **2 ボタン並列**、`false` 端末では `[画像を保存]` のみが表示される
- [ ] `WinnerCardDownloadButton` / `SeasonTopCardDownloadButton` の外部 props / DOM 構造不変、Phase B characterization test 全件 (5 + 8 件) が **無変更で green**
- [ ] `/groups/[gid]/season` 画面に過去シーズンセクションが表示される（履歴 1 件以上のとき）
- [ ] navigator.share の AbortError は silent（logger.warn しない）
- [ ] share / download 押下時に `logger.info("share-card click", { kind, action, success })` が 1 行出る
- [ ] `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` 全 PASS
- [ ] PRD Phase D 行が `in-progress` + 本 plan にリンク済み

## Completion Checklist

- [ ] Code follows discovered patterns（`AppError.from` / `unwrapOrFrom` / `logger` 規約）
- [ ] Error handling は `share/*` prefix で統一
- [ ] route handler / rule / schema / repository を**一切触っていない**ことを git diff で確認
- [ ] Tests follow test patterns（hook + UI のみ、E2E は scope 外）
- [ ] PRD Phase D 進捗が更新済み
- [ ] No unnecessary scope additions（Color picker / Admin SDK / 観戦モードは入れない）
- [ ] Self-contained — no questions needed during implementation

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| navigator.share の File 共有が iOS Safari で sequence によっては失敗する（大きな PNG / network 遅延） | M | L | 並列の DownloadButton が常時可視のため、share 失敗時は user が右隣の「画像を保存」を押す自然な fallback 経路。実装側で自動 fallback を仕込まないことで cognitive load も下がる |
| useCanShareImage の hydration mismatch | M | L | 初期値 `"loading"` で SSR / CSR 両方同じ render（= ShareCardButton は null）を返す形に固定。useEffect 内でのみ値を確定 |
| share button と download button の並列で UI が混雑して見える | M | L | flex flex-wrap items-center gap-2 で右寄せ / 中央寄せ。スマホ small viewport で 2 行になっても Banner と縦方向干渉しないことを Manual Validation で確認 |
| Phase B 既存 test を破壊する | L | H | Task 4 / 5 は telemetry 追加（`onClick` 1 行）のみ。既存テストは render / DOM 構造を assert しており `onClick` 追加は無影響。Task 6 / 7 は呼出側（dashboard / live / season-ranking）の wiring で button 自体には触らない |
| AbortError 以外のシェアエラーが多発し logger.warn ノイズが増える | L | L | DOMException かつ name === "AbortError" のみ silent、他は warn で残すが、本 phase のスケール（月 1〜2 開催）ではノイズ許容範囲 |
| 過去シーズン履歴が大量（数十シーズン）になり、`listSeasonHistory` の 1 度 fetch が重くなる | L | L | append-only かつ 1 シーズン = 1 doc。20 人サークルで月 1〜2 開催ペースなら 1 年で約 12〜24 doc。各 doc 数 KB なので合計 1MB 未満。**現状スケールでは subscribe 化は不要**（PRD「保持期間は MVP 無制限、運用観測後に retention」と整合） |
| navigator.share の text フィールドに含まれる displayName / tournamentName が PII で SNS 流出する | L | L | これは share の本来の用途（ユーザーが SNS に貼ることが目的）であり、運営者が意図する流出。logger には PII を含めない（kind / action / success のみ）ため運営側ログ汚染なし |
| `_share-button/` の path に同名 collision | L | L | 既存 `_components/` / `_lib/` パターンと衝突しない private folder（`_` prefix）として配置。`src/components/share/` 自体が新規 namespace |
| Phase B で Decision されたフォント / runtime / route 構造を意図せず touch | L | M | 本 plan は **route handler / OG payload schema を一切触らない** ことを Files to Change に明記。Task 12 の build verification で Route summary に変更なしを確認 |
| share / download の URL / shareText 組立を呼出側 (Task 6 / 7) と DownloadButton 内で二重計算 | L | L | Phase D の最小差分優先で許容。将来 hook (`useWinnerCardPayload(...)`) に集約する場合は別 phase で。テスト負荷 / 性能影響なし |

## Notes

- **2 ボタン並列の設計判断**: 「シェア / 画像を保存」のどちらかにブラウザ仕様で倒すのではなく、**両方並列表示してユーザーが選ぶ**設計を採用。理由は (1) 「OS シェアシート経由で 1 タップ投稿したい人」と「画像をローカル保存してから別アプリで貼りたい人」が同じサークルに混在する、(2) `navigator.share` の挙動はブラウザ / OS によって振れが大きく、「シェアを試して失敗したらダウンロード」の自動 fallback より「最初から両方の選択肢が並ぶ」UX のほうが認知負荷が低い、(3) Phase B の DownloadButton を完全温存できるためテスト破壊リスクがゼロ、の 3 点
- **Phase D Scope の "Color picker UI" の解釈**: PRD 文言には残るが、Phase C improvement-02-02 で `TableLabelEditPopover` + `GroupDefaultTableLabelsCard` の双方に 10 色プリセット + カスタム hex picker（折りたたみ）が実装済（[Phase C improvement report Wave 1-3](../reports/phase-c-improvement-02-02-report.md#wave-1-tablelabeleditpopover-の改善-4-件) / [Wave 3](../reports/phase-c-improvement-02-02-report.md#wave-3-defaulttablecolors-追加サークル詳細で色も登録できる)）。Phase D で再着手すると重複作業になるため、本 plan の NOT Building に明示し、PRD Decisions Log にも追記する
- **Web Share API のテキスト規約**: `text` フィールドのみ使う（`title` / `url` は使わない）。理由は LINE / X とも text + files で十分インライン投稿が成立し、`url` を入れると LINE で OG プレビューが意図せず展開される事例があるため。本 phase では「画像 + テキスト」だけに集約
- **観測指標の運用**: `logger.info("share-card click", ...)` は Vercel Logs / dev server console に出る。PRD Success Metrics「実サークル運用で複数回観測」を満たすには Vercel Logs で `share-card click` を grep する暫定運用とし、専用 collection 化や Analytics 連携は YAGNI
- **share path の filename 命名**: 既存 Phase B の sanitize 規約（ASCII 安全文字）を維持。`File` の name は SNS で表示されるケースがあるため、ASCII safe を保つことで iOS Safari / Android Chrome 双方で一貫した名前が表示される
- **future polish**:
  - share に成功した tid / gid を Firestore に集計（`groupShareEvents/{date}/{gid}` 等）したくなったら新 phase でスキーマ追加（Cloud Functions 想定）
  - `navigator.share` の url パラメータで「サークル参加者だけが見られる observable URL」を投げる経路は観戦モード phase で再評価
  - 過去シーズンの「画像保存」ボタン（任意過去シーズンのカード生成）は本 phase の対象外。OG route に過去 seasonId 引数を追加すれば最小拡張で実現可能だが、Phase D は MVP polish に留める
