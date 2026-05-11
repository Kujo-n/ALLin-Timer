# Plan: Track A Phase A.2 — Background Image UI & SSR

## Summary

Phase A.1 で確立した Firebase Storage 基盤 + `groups/{gid}.{winnerCardBackground, seasonCardBackground}`
Firestore pointer の上に、**owner がサークル詳細画面から背景画像をアップロード・差し替え・解除**できる
UI を組み、その結果が **OG SSR route（`/api/og/winner/[tid]` / `/api/og/season/[gid]`）で背景画像として
出力される**状態にする。

読みやすさ（スクリム / box overlay の本格 polish）は Phase A.3 に持ち越し、本 phase では:

- canvas API クライアント圧縮 + 5MB pre-reject + Storage upload + 旧 asset 確実削除（指数 backoff 3 回 retry）
- OG route で `bgImageUrl` を fetch → base64 data URI 化 → Satori `<img>` 背景 + シンプルな半透明 black scrim
- textTheme（light / dark）の単純トグル（既存 grad 背景下でテキスト色を反転するのみ、box overlay は A.3）

までを 1 PR 分でカバーする。

## User Story

As a サークル代表（owner）,
I want サークル詳細画面から優勝者カード／シーズン戦績カードの背景画像を upload / 差し替え / 解除でき、
保存後即座に結果カード PNG（`/api/og/...`）に新しい背景が反映される,
So that ドライラン投入時に自分のサークルらしさを SNS シェア時に表現でき、Phase A.3 で readability を
仕上げる前から「使いたくなる」感触を確かめられる。

## Problem → Solution

[現状（Phase A.1 完了時点）]
- `groups/{gid}.winnerCardBackground` / `seasonCardBackground` を **owner-only で書込できる
  Firestore pointer + Storage rule** までは整備されているが、これを駆動する UI は存在しない
- OG SSR route（`/api/og/winner/[tid]` / `/api/og/season/[gid]`）は固定の amber / navy グラデ背景
  のみ。`bgImageUrl` query を受信する経路もない
- サークルあたり保持画像数を winner / season カード分の最大 2 枚に収束させる旧 asset 削除 helper
  （指数 backoff retry）も未実装

→

[望ましい状態（Phase A.2 完了時点）]
- サークル詳細画面 `/groups/[gid]?tab=settings` に **`WinnerCardBackgroundCard` / `SeasonCardBackgroundCard`**
  の 2 カードが並ぶ。各カードは:
  - **owner のみ編集可**（display only / edit-mode を `isOwner` で gate）
  - ファイル選択 → canvas API で 1200×630 jpeg quality 0.8 にリサイズ → プレビュー → 保存
  - 5MB 超のファイルは pre-reject（jpeg/png/webp 以外も同様）
  - 「テキストテーマ」を light / dark でトグル可
  - 「背景を解除」ボタンで pointer を null に戻し Storage asset を削除
- **保存フロー**: 新 asset upload → `setWinnerCardBackground` / `setSeasonCardBackground` で Firestore
  pointer 更新 → 成功後、旧 asset を **指数 backoff 3 回 retry（200ms / 600ms / 1.8s）で確実削除**。
  3 回失敗時は `logger.warn("orphan card background asset", { gid, assetId })` で記録しアップロード
  自体は成功扱いとする
- **OG SSR route** が `bgImageUrl` / `bgTextTheme` query param を受信した場合:
  - `bgImageUrl` を fetch → ArrayBuffer → base64 data URI → Satori の root に `<img>` で全面背景配置
  - 上に最小限の半透明 scrim（rgba black 30%）を重ね、`bgTextTheme` で foreground 色を反転
  - fetch 失敗時は `logger.warn` で記録しグラデーション fallback で生成成功させる
- **download button 経路**は `tournamentGroup.winnerCardBackground` /
  `group.seasonCardBackground` を `buildWinnerShareInputs` / `buildSeasonShareInputs` に渡すことで、
  ユーザー操作なしで自動的に URL に query が付与される

## Metadata

- **Complexity**: Large（15〜18 ファイル、500〜800 行。新規 UI コンポーネント 2 + Storage repository +
  utils 2 + OG route 拡張 + downstream 4 callsite 更新 + 単体テスト）
- **Source PRD**: [.claude/PRPs/05-post-launch-polish/prds/05-post-launch-polish.prd.md](../prds/05-post-launch-polish.prd.md)
- **PRD Phase**: A.2（Track A: Background Image UI & SSR）
- **Estimated Files**:
  - 新規: 8 件（`src/lib/utils/image-resize.ts` / `src/lib/utils/retry.ts` /
    `src/lib/firebase/repositories/cardBackgroundStorage.ts` /
    `src/lib/services/card-background.ts` /
    `src/app/groups/[gid]/_components/WinnerCardBackgroundCard.tsx` /
    `src/app/groups/[gid]/_components/SeasonCardBackgroundCard.tsx` /
    `src/app/groups/[gid]/_components/CardBackgroundCard.tsx`（共通基底） /
    対応する `*.test.{ts,tsx}` を必要に応じて）
  - 修正: 9 件以上（`src/app/api/og/_lib/og-payload.ts` / `src/app/api/og/_lib/og-card-styles.ts` /
    `src/app/api/og/winner/[tid]/route.tsx` / `src/app/api/og/season/[gid]/route.tsx` /
    `src/components/tournament/WinnerCardDownloadButton.tsx` /
    `src/components/group/SeasonTopCardDownloadButton.tsx` /
    `src/app/tournaments/[tid]/dashboard-client.tsx` /
    `src/app/tournaments/[tid]/live/live-client.tsx` /
    `src/app/groups/[gid]/season/season-ranking-client.tsx` /
    `src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.tsx` /
    `src/app/groups/[gid]/group-detail-client.tsx`）

---

## UX Design

### Before

```
┌──────────────────────────────────────────────────┐
│ サークル詳細  > 設定タブ                          │
│                                                  │
│  [開催数 inline edit]                            │
│  [デフォルト席数 inline edit]                    │
│  [Table 名デフォルト card]                       │
│  [サウンド設定 card]  (organizer 以上のみ)        │
│                                                  │
│  ─────────────────────────                       │
│  優勝カード PNG:                                  │
│   ┌───────────────────────────┐                  │
│   │ amber グラデ + "WINNER..." │  ← 全サークル同一  │
│   └───────────────────────────┘                  │
└──────────────────────────────────────────────────┘
```

### After

```
┌──────────────────────────────────────────────────┐
│ サークル詳細  > 設定タブ                          │
│                                                  │
│  [既存カード群はそのまま]                          │
│                                                  │
│  ┌──── 優勝者カード背景画像（owner のみ）────┐    │
│  │                                              │    │
│  │ ┌─ プレビュー 240×126 ────┐                  │    │
│  │ │  [現在の画像 or グラデ]   │                  │    │
│  │ └────────────────────────┘                  │    │
│  │                                              │    │
│  │ テキストテーマ: (●) ライト  ( ) ダーク         │    │
│  │ [ファイルを選択]  jpg/png/webp 5MB 以下         │    │
│  │ [背景を解除]  [保存]                          │    │
│  │                                              │    │
│  │ 注意: 公開 URL になります（メンバー以外も閲覧可） │    │
│  └─────────────────────────────────────────────┘   │
│                                                  │
│  ┌──── シーズン戦績カード背景画像（owner のみ）─┐    │
│  │ （上と同型）                                   │    │
│  └─────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint                                  | Before                                       | After                                                                                            | Notes                                                                              |
| ------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `/groups/[gid]?tab=settings`                | 設定カード 4 種のみ                          | + WinnerCardBackgroundCard / SeasonCardBackgroundCard 2 枚（owner のみ visible）                  | 非 owner は完全に hidden（gate は呼出側）                                          |
| 結果カード PNG（`/api/og/winner/...`）       | amber グラデ固定                             | bgImageUrl 設定済みのサークルは背景画像 + 30% black scrim + textTheme で foreground 色反転           | 未設定サークルは挙動完全不変（回帰ゼロが Acceptance 必須）                          |
| 結果カード PNG（`/api/og/season/...`）       | navy グラデ固定                              | 同上                                                                                             | 同上                                                                              |
| 「画像を保存」ボタン                          | URL は固定 amber/navy 背景の PNG                | tournamentGroup / group の `winnerCardBackground` / `seasonCardBackground` を URL に含めて生成     | ボタン UI 自体は変化なし。URL の query が変わるだけ                                |
| ShareCardButton                             | 同上                                         | 同上（buildXxxShareInputs 経由）                                                                  | 同上                                                                              |

---

## Mandatory Reading

実装前に必ず読むファイル:

| Priority       | File                                                                                                              | Lines     | Why                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------- |
| P0 (critical)  | [src/app/api/og/_lib/og-payload.ts](../../../../src/app/api/og/_lib/og-payload.ts)                                | 1-225     | `WINNER_CARD_QUERY_SCHEMA` / `SEASON_CARD_QUERY_SCHEMA` の追加先 / `buildWinnerShareInputs` / `buildSeasonShareInputs` の拡張先 |
| P0 (critical)  | [src/app/api/og/winner/[tid]/route.tsx](../../../../src/app/api/og/winner/[tid]/route.tsx)                        | 1-168     | Satori JSX の root 構造 / 背景注入点（行 70 の `background: OG_COLORS.winnerBg`）                                          |
| P0 (critical)  | [src/app/api/og/season/[gid]/route.tsx](../../../../src/app/api/og/season/[gid]/route.tsx)                        | 1-217     | 同上 / 行 121 の `background: OG_COLORS.seasonBg`                                                                          |
| P0 (critical)  | [src/lib/services/group.ts](../../../../src/lib/services/group.ts)                                                | 520-571   | `setWinnerCardBackground` / `setSeasonCardBackground`（owner-only Firestore pointer 更新の最終ライン）                       |
| P0 (critical)  | [src/lib/firebase/repositories/groups.ts](../../../../src/lib/firebase/repositories/groups.ts)                    | 456-545   | `validateCardBackground` / `updateWinner/SeasonCardBackground`（A.1 で wrap helper 経由）                                   |
| P0 (critical)  | [src/lib/firebase/schemas/group.ts](../../../../src/lib/firebase/schemas/group.ts)                                | 84-216    | `cardBackgroundSchema` / `CardBackground` / `CARD_TEXT_THEMES` / `DEFAULT_CARD_BACKGROUND_TEXT_THEME`                       |
| P0 (critical)  | [src/lib/firebase/client.ts](../../../../src/lib/firebase/client.ts)                                              | 100-130   | `firebaseStorage` singleton + emulator connect。Storage SDK 呼出はここから import する                                    |
| P0 (critical)  | [storage.rules](../../../../storage.rules)                                                                        | 1-35      | upload path `groups/{gid}/bgImages/{assetId}`、1MB / image/(jpeg\|png\|webp) / owner-only                                  |
| P1 (important) | [src/app/groups/[gid]/_components/AudioSettingsCard.tsx](../../../../src/app/groups/[gid]/_components/AudioSettingsCard.tsx) | 1-226     | working flag / savedFlash / onSaved / onError のカード設計パターン                                                          |
| P1 (important) | [src/app/groups/[gid]/_components/GroupDefaultTableLabelsCard.tsx](../../../../src/app/groups/[gid]/_components/GroupDefaultTableLabelsCard.tsx) | 1-80      | edit / display モード切替 + setSaving + onSave throw → onError 形式                                                         |
| P1 (important) | [src/app/groups/[gid]/group-detail-client.tsx](../../../../src/app/groups/[gid]/group-detail-client.tsx)          | 1-502     | 設定タブの構成 / isOwner 算出 / reload + refreshGroups の典型コール                                                          |
| P1 (important) | [src/components/tournament/WinnerCardDownloadButton.tsx](../../../../src/components/tournament/WinnerCardDownloadButton.tsx) | 1-63      | `buildWinnerShareInputs` 経由の URL 組立                                                                                  |
| P1 (important) | [src/components/group/SeasonTopCardDownloadButton.tsx](../../../../src/components/group/SeasonTopCardDownloadButton.tsx) | 1-58      | 同上 season                                                                                                                |
| P1 (important) | [src/app/tournaments/[tid]/dashboard-client.tsx](../../../../src/app/tournaments/[tid]/dashboard-client.tsx)      | 380-426   | `tournamentGroup`（`useGroupRole`）の使い方 / `buildWinnerShareInputs` の callsite                                          |
| P1 (important) | [src/app/groups/[gid]/season/season-ranking-client.tsx](../../../../src/app/groups/[gid]/season/season-ranking-client.tsx) | 100-167   | `buildSeasonShareInputs(gid, group, stats)` の callsite                                                                    |
| P1 (important) | [src/lib/hooks/useInlineNumberEdit.ts](../../../../src/lib/hooks/useInlineNumberEdit.ts)                          | 1-150     | save() throw → unwrapOrFrom + formatErrorForDisplay → onError の error path 規約                                          |
| P1 (important) | [src/lib/firebase/wrap.ts](../../../../src/lib/firebase/wrap.ts)                                                  | 1-68      | `wrapFirestoreWrite` / `wrapFirestoreRead`。Storage repository でも同 helper を経由する場合は `wrap` の type を確認         |
| P2 (reference) | [.claude/rules/firebase-patterns.md](../../../../.claude/rules/firebase-patterns.md)                              | all       | repository / service の境界、`AppError` ラップ規約、subcollection 設計原則                                                  |
| P2 (reference) | [.claude/rules/error-logging.md](../../../../.claude/rules/error-logging.md)                                      | all       | `AppError.from` vs `unwrapOrFrom` の使い分け、`logger.*` のレベル                                                          |
| P2 (reference) | [.claude/PRPs/05-post-launch-polish/plans/completed/phase-a.1-storage-foundation.plan.md](./completed/phase-a.1-storage-foundation.plan.md) | all       | A.1 で確立済みの基盤（Storage SDK / rule / schema）。**重複実装を避けるために必読**                                          |
| P2 (reference) | [.claude/PRPs/05-post-launch-polish/reports/phase-a.1-storage-foundation-report.md](../reports/phase-a.1-storage-foundation-report.md) | all       | A.1 deviation / accepted design tradeoff（owner-update branch が narrow branch を bypass する制約）                          |

## External Documentation

| Topic                                | Source                                                                                                                                            | Key Takeaway                                                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Firebase Storage Web SDK uploadBytes | <https://firebase.google.com/docs/storage/web/upload-files>                                                                                       | `uploadBytes(ref, blob, { contentType })` で blob を直接 upload。metadata 経由で contentType を明示。`getDownloadURL(ref)` で 公開 URL（`firebasestorage.googleapis.com/...`）取得 |
| Firebase Storage Web SDK deleteObject | <https://firebase.google.com/docs/storage/web/delete-files>                                                                                       | `deleteObject(ref)` で削除。`object-not-found` エラー (`storage/object-not-found`) は冪等扱いで warn のみで握りつぶしてよい                                                |
| Canvas drawImage + toBlob            | <https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob>                                                                       | `canvas.toBlob(callback, "image/jpeg", 0.8)`。SafariはPromise化必須                                                                                                          |
| Satori `<img>` background            | <https://github.com/vercel/satori#supported-html-elements>                                                                                        | Satori は外部 URL を fetch しないため、base64 data URI で `<img src="data:image/...;base64,...">` を直接渡す必要がある                                                       |
| Vercel Edge Runtime fetch limits     | <https://vercel.com/docs/functions/runtimes/node-js>                                                                                              | 本 phase の OG route は `runtime = "nodejs"` 固定。fetch は標準 Node 18+ の global fetch。Storage download URL は public で auth header 不要                                |

---

## Patterns to Mirror

実装パターンはすべて既存コードから抽出。新規 invention は最小限に留める。

### REPOSITORY_STORAGE_OPS

**Phase A.1 では Storage SDK 実呼出はゼロ**（singleton 化のみ）。本 phase で初導入する。
repository / SDK 層の境界を保つため、ref / uploadBytes / deleteObject / getDownloadURL の
直接呼出は `src/lib/firebase/repositories/cardBackgroundStorage.ts` に閉じ込める。

```ts
// 新規 file: src/lib/firebase/repositories/cardBackgroundStorage.ts
import { getDownloadURL, ref, uploadBytes, deleteObject } from "firebase/storage";
import { firebaseStorage } from "@/lib/firebase/client";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

// SOURCE: src/lib/firebase/wrap.ts:34-67（wrapFirestoreWrite の helper 内部の error wrap 設計）
// に倣い、Storage 専用の wrap helper を定義する。
export async function uploadCardBackgroundAsset(
  gid: string,
  assetId: string,
  blob: Blob,
  contentType: "image/jpeg" | "image/png" | "image/webp",
): Promise<string> {
  const path = `groups/${gid}/bgImages/${assetId}`;
  const r = ref(firebaseStorage, path);
  try {
    await uploadBytes(r, blob, { contentType });
    const url = await getDownloadURL(r);
    logger.info("card background asset uploaded", { gid, assetId, contentType });
    return url;
  } catch (e) {
    const wrapped = AppError.from(
      e,
      "storage/upload-failed",
      "結果カード背景画像のアップロードに失敗しました",
    );
    logger.warn(wrapped.message, { code: wrapped.code, gid, assetId });
    throw wrapped;
  }
}

export async function deleteCardBackgroundAsset(
  gid: string,
  assetId: string,
): Promise<void> {
  const path = `groups/${gid}/bgImages/${assetId}`;
  const r = ref(firebaseStorage, path);
  try {
    await deleteObject(r);
    logger.info("card background asset deleted", { gid, assetId });
  } catch (e) {
    // object-not-found は冪等扱い（既に削除済み / 元から存在しない）
    if (e && typeof e === "object" && "code" in e && e.code === "storage/object-not-found") {
      logger.debug("card background asset already absent", { gid, assetId });
      return;
    }
    const wrapped = AppError.from(
      e,
      "storage/delete-failed",
      "結果カード背景画像の削除に失敗しました",
    );
    logger.warn(wrapped.message, { code: wrapped.code, gid, assetId });
    throw wrapped;
  }
}
```

### SERVICE_ORCHESTRATION

`src/lib/services/card-background.ts` で「upload → Firestore pointer 更新 → 旧 asset retry 削除」を
オーケストレートする。owner 役割確認は内部の `setWinner/SeasonCardBackground`（A.1 service）が
最終ラインとして re-enforce する。

```ts
// SOURCE: src/lib/services/group.ts:520-571（setWinnerCardBackground / setSeasonCardBackground の構造）
//         + 本 phase の retry helper を組み合わせる。
export async function uploadAndSetWinnerCardBackground(opts: {
  gid: string;
  uid: string;
  blob: Blob;
  contentType: CardImageContentType;
  textTheme: CardTextTheme;
  previousAssetId: string | null;
}): Promise<void> {
  const assetId = crypto.randomUUID();
  const imageUrl = await uploadCardBackgroundAsset(
    opts.gid,
    assetId,
    opts.blob,
    opts.contentType,
  );
  await setWinnerCardBackground({
    gid: opts.gid,
    uid: opts.uid,
    value: { imageUrl, storageAssetId: assetId, textTheme: opts.textTheme },
  });
  // Firestore pointer が新 asset を指した後でのみ旧 asset を削除する（rollback 安全性）
  if (opts.previousAssetId !== null) {
    await deleteWithRetry(() => deleteCardBackgroundAsset(opts.gid, opts.previousAssetId!), {
      attempts: 3,
      backoffMs: [200, 600, 1800],
      onFinalFailure: (e) =>
        logger.warn("orphan card background asset", {
          gid: opts.gid,
          assetId: opts.previousAssetId,
          code: getErrorCode(e),
        }),
    });
  }
}
```

### RETRY_WITH_EXPONENTIAL_BACKOFF

新規 helper `src/lib/utils/retry.ts`。プロジェクト内に先行事例なし（grep 確認）。
最終失敗時は throw せず callback で warn ログだけ残す「最終失敗を握りつぶす」モードを default 提供する
（旧 asset 削除はメイン flow を止めないため）。

```ts
// 新規 file: src/lib/utils/retry.ts
export interface RetryOptions {
  attempts: number;
  /** 各試行**後**の sleep ms。length は attempts - 1 を許容（最後の試行後は sleep しない）。 */
  backoffMs: readonly number[];
  /** 最終失敗時の callback。throw しないモード（default）。 */
  onFinalFailure?: (e: unknown) => void;
  /** AbortSignal でキャンセル可能。 */
  signal?: AbortSignal;
}

export async function deleteWithRetry(
  fn: () => Promise<void>,
  opts: RetryOptions,
): Promise<void> {
  let lastError: unknown = null;
  for (let i = 0; i < opts.attempts; i++) {
    if (opts.signal?.aborted) return;
    try {
      await fn();
      return; // success
    } catch (e) {
      lastError = e;
      if (i < opts.attempts - 1) {
        const delay = opts.backoffMs[i] ?? 0;
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  opts.onFinalFailure?.(lastError);
}
```

### IMAGE_RESIZE_HELPER

新規 helper `src/lib/utils/image-resize.ts`。canvas API のみで実装、ライブラリ追加なし。

```ts
// 新規 file: src/lib/utils/image-resize.ts
export interface ResizeOptions {
  /** 出力幅。default OG_WIDTH (1200) */
  width?: number;
  /** 出力高さ。default OG_HEIGHT (630) */
  height?: number;
  /** jpeg 品質。default 0.8 */
  quality?: number;
  /** mime type。default "image/jpeg" */
  mimeType?: "image/jpeg" | "image/png" | "image/webp";
}

export async function resizeImageToCardSize(
  file: File,
  opts: ResizeOptions = {},
): Promise<Blob> {
  const width = opts.width ?? 1200;
  const height = opts.height ?? 630;
  const quality = opts.quality ?? 0.8;
  const mimeType = opts.mimeType ?? "image/jpeg";

  const imgUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(imgUrl);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new AppError("Canvas 描画コンテキストの取得に失敗しました", "image/canvas-unavailable");
    }
    // cover フィット（背景を埋める）。トリミング戦略は centered crop で MVP は十分。
    const scale = Math.max(width / img.width, height / img.height);
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const dx = (width - drawW) / 2;
    const dy = (height - drawH) / 2;
    ctx.drawImage(img, dx, dy, drawW, drawH);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mimeType, quality),
    );
    if (!blob) {
      throw new AppError("画像の圧縮に失敗しました", "image/encode-failed");
    }
    return blob;
  } finally {
    URL.revokeObjectURL(imgUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new AppError("画像の読込に失敗しました", "image/load-failed"));
    img.src = src;
  });
}
```

### CARD_INLINE_EDIT

サークル詳細画面のカード設計は [AudioSettingsCard.tsx](../../../../src/app/groups/[gid]/_components/AudioSettingsCard.tsx) を雛形とする:

- `Card / CardHeader / CardContent` shadcn 構造
- `working` boolean state で button disabled / "保存中…" 表示
- `savedFlash` で 2 秒間 "保存しました" を出す
- 親から受け取った `onSaved`（reload + refreshGroups）と `onError` を contractual に呼ぶ
- 失敗時は `unwrapOrFrom + formatErrorForDisplay → onError` で日本語メッセージを伝える

### OG_BACKGROUND_INJECTION

OG route で背景画像を追加するパターン:

```tsx
// SOURCE: src/app/api/og/winner/[tid]/route.tsx:62-77 の root div 構造を踏襲。
// 既存のグラデ背景を保持した上で、bgImageUrl がある場合のみ <img> を absolute 重ね、
// その上に半透明 black scrim を絶対配置する。Satori の <div> は CSS 制約があるため
// flex / absolute の組み合わせは仕様確認済み（既存の PodiumRow 等で実証）。

const bgDataUri = q.bgImageUrl ? await fetchAsDataUri(q.bgImageUrl).catch(() => null) : null;
const fg = q.bgTextTheme === "dark" ? "#fef3c7" : "#451a03";

<div style={{ width: "100%", height: "100%", display: "flex", position: "relative", ... }}>
  {bgDataUri ? (
    <img
      src={bgDataUri}
      style={{
        position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
        objectFit: "cover",
      }}
    />
  ) : null}
  {bgDataUri ? (
    <div
      style={{
        position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
        background: "rgba(0,0,0,0.3)",
      }}
    />
  ) : null}
  {/* 既存のテキストブロック群（既存 row / column 構造をそのまま）。color を `fg` で差替え */}
  <div style={{ position: "relative", display: "flex", ... }}>...</div>
</div>
```

### LOGGER_PATTERN

```ts
// SOURCE: src/lib/firebase/repositories/groups.ts:514-519
logger.info("group winnerCardBackground updated", {
  gid,
  cleared: value === null,
  hasImage: value?.imageUrl != null,
  textTheme: value?.textTheme,
});

// 失敗は wrap helper 内で warn 済み。service / UI からは追加で warn しない（二重防止）
```

---

## Files to Change

| File                                                                                                                          | Action  | Justification                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| [src/lib/utils/image-resize.ts](../../../../src/lib/utils/image-resize.ts)                                                    | CREATE  | canvas API による 1200×630 jpeg 0.8 リサイズ。先行事例ゼロ                                                                  |
| [src/lib/utils/retry.ts](../../../../src/lib/utils/retry.ts)                                                                  | CREATE  | 指数 backoff retry。旧 asset の確実削除に使用。最終失敗時は warn だけ残す                                                  |
| [src/lib/firebase/repositories/cardBackgroundStorage.ts](../../../../src/lib/firebase/repositories/cardBackgroundStorage.ts)  | CREATE  | Storage SDK 直接呼出（upload / delete / getDownloadURL）。AppError ラップ                                                  |
| [src/lib/services/card-background.ts](../../../../src/lib/services/card-background.ts)                                        | CREATE  | upload + Firestore pointer 更新 + retry delete のオーケストレーション                                                       |
| [src/app/groups/[gid]/_components/CardBackgroundCard.tsx](../../../../src/app/groups/[gid]/_components/CardBackgroundCard.tsx) | CREATE  | winner / season 共通の UI 部品（プレビュー / ファイル選択 / theme トグル / 保存 / 解除）                                    |
| [src/app/groups/[gid]/_components/WinnerCardBackgroundCard.tsx](../../../../src/app/groups/[gid]/_components/WinnerCardBackgroundCard.tsx) | CREATE  | winner 向け薄い wrapper（`kind="winner"` で `uploadAndSetWinnerCardBackground` に dispatch）                                |
| [src/app/groups/[gid]/_components/SeasonCardBackgroundCard.tsx](../../../../src/app/groups/[gid]/_components/SeasonCardBackgroundCard.tsx) | CREATE  | season 向け同様 wrapper                                                                                                    |
| [src/app/groups/[gid]/group-detail-client.tsx](../../../../src/app/groups/[gid]/group-detail-client.tsx)                      | UPDATE  | settings タブに 2 カードを追加（`isOwner` で gate）                                                                         |
| [src/app/api/og/_lib/og-card-styles.ts](../../../../src/app/api/og/_lib/og-card-styles.ts)                                    | UPDATE  | `OG_COLORS.winnerFgDark` / `seasonFgDark` 等の dark theme 用色を additive 追加（既存 fg は light theme 扱い）              |
| [src/app/api/og/_lib/og-payload.ts](../../../../src/app/api/og/_lib/og-payload.ts)                                            | UPDATE  | query schema に `bgImageUrl` / `bgTextTheme` 追加、buildXxxShareInputs / buildXxxCardUrl に optional 引数追加                |
| [src/app/api/og/_lib/og-image-fetch.ts](../../../../src/app/api/og/_lib/og-image-fetch.ts)                                    | CREATE  | `fetchAsDataUri(url)` 純関数（fetch 失敗時は throw、呼出側で catch）                                                       |
| [src/app/api/og/winner/[tid]/route.tsx](../../../../src/app/api/og/winner/[tid]/route.tsx)                                    | UPDATE  | bgImageUrl / bgTextTheme 受信、`<img>` + scrim を root に追加、fg 色を theme で切替                                       |
| [src/app/api/og/season/[gid]/route.tsx](../../../../src/app/api/og/season/[gid]/route.tsx)                                    | UPDATE  | 同上                                                                                                                       |
| [src/components/tournament/WinnerCardDownloadButton.tsx](../../../../src/components/tournament/WinnerCardDownloadButton.tsx)  | UPDATE  | optional `cardBackground?: CardBackground` を受取り `buildWinnerShareInputs` に渡す                                          |
| [src/components/group/SeasonTopCardDownloadButton.tsx](../../../../src/components/group/SeasonTopCardDownloadButton.tsx)      | UPDATE  | 同上 season                                                                                                                |
| [src/app/tournaments/[tid]/dashboard-client.tsx](../../../../src/app/tournaments/[tid]/dashboard-client.tsx)                  | UPDATE  | `tournamentGroup?.winnerCardBackground` を `WinnerCardDownloadButton` と `buildWinnerShareInputs` に渡す                    |
| [src/app/tournaments/[tid]/live/live-client.tsx](../../../../src/app/tournaments/[tid]/live/live-client.tsx)                  | UPDATE  | 同上                                                                                                                       |
| [src/app/groups/[gid]/season/season-ranking-client.tsx](../../../../src/app/groups/[gid]/season/season-ranking-client.tsx)    | UPDATE  | `group.seasonCardBackground` を `SeasonTopCardDownloadButton` と `buildSeasonShareInputs` に渡す                            |
| [src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.tsx](../../../../src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.tsx) | UPDATE  | **過去シーズンも現在の `group.seasonCardBackground` を流用する**（PRD MVP: 「シーズンスナップショット背景」は NOT Building）  |
| `src/lib/utils/image-resize.test.ts`                                                                                          | CREATE  | resize helper の characterization test（jsdom + canvas mock）                                                                |
| `src/lib/utils/retry.test.ts`                                                                                                 | CREATE  | retry helper の attempt count / backoff timing / onFinalFailure test                                                       |
| `src/lib/services/card-background.test.ts`                                                                                    | CREATE  | upload + setXxxCardBackground + deleteWithRetry の orchestration を mock 経由で characterization                            |
| `src/app/api/og/_lib/og-payload.test.ts`                                                                                      | UPDATE  | `bgImageUrl` / `bgTextTheme` の URL 組立・schema parse の追加ケース                                                          |
| `src/app/api/og/_lib/og-image-fetch.test.ts`                                                                                  | CREATE  | `fetchAsDataUri` の成功 / 失敗 path                                                                                         |
| `src/app/groups/[gid]/_components/CardBackgroundCard.test.tsx`                                                                | CREATE  | display / edit モード切替、ファイル選択 → preview、save / clear の state machine                                            |

## NOT Building

本 phase で **絶対に作らない** もの（Phase A.3 以降に持ち越し）:

- **本格的な readability layer**: 上下グラデーションスクリム / テキストグループ rgba box overlay /
  font-size 微調整は Phase A.3 で行う。A.2 は最低限の rgba black 30% scrim + foreground 色反転のみ
- **テキストテーマ "auto" モード**: 画像平均輝度ベースの自動切替は PRD「Could」項目で MVP 不要
- **複数画像ストック / クロップ UI / ピンチズーム**: PRD NOT Building と同じ
- **organizer / member 設定権限拡張**: owner only に限定
- **シーズンスナップショット背景**: 過去シーズン詳細画面でも「現在の `group.seasonCardBackground`」を
  流用する。シーズン切替時の snapshot 保存は PRD NOT Building
- **Storage egress / image fetch latency の metrics 収集**: Vercel Analytics で十分（PRD Success Metrics）
- **アップロード進捗バー**: 1MB 圧縮後の単一 uploadBytes 呼出のため不要
- **`uploadBytesResumable` 経由の resumable upload**: 1MB 圧縮済み + 月数回の利用想定で過剰
- **画像 alt 属性のカスタマイズ**: Satori の `<img>` には alt が不要（PNG 出力）

---

## Step-by-Step Tasks

### Task 1: `src/lib/utils/retry.ts` を新規作成

- **ACTION**: 指数 backoff retry helper を新規作成
- **IMPLEMENT**: 上記 `RETRY_WITH_EXPONENTIAL_BACKOFF` パターンの全体を実装
  - export: `deleteWithRetry(fn, opts)`
  - generic 化は **しない**（旧 asset 削除専用で十分、YAGNI）
  - 戻り値は `Promise<void>`。最終失敗時は throw せず `onFinalFailure` callback を呼ぶ
  - `setTimeout` 経由の sleep。テストは `vi.useFakeTimers` で時間を進める
- **MIRROR**: RETRY_WITH_EXPONENTIAL_BACKOFF。プロジェクト内に retry 先行事例なし（grep 確認済み）ため新規
- **IMPORTS**: 標準のみ（`setTimeout`）。AppError 不要（最終失敗を握りつぶす設計）
- **GOTCHA**:
  - `backoffMs` 配列は **試行間 sleep**。`attempts: 3` なら sleep は最大 2 回（200ms / 600ms）= 合計 800ms
  - PRD「200ms / 600ms / 1.8s」表記の解釈: 試行 1 → sleep 200ms → 試行 2 → sleep 600ms → 試行 3 → sleep 1800ms → 試行 4（実質 4 回試行）
    **本 plan の解釈**: 試行 = 3 回、sleep = [200, 600, 1800] のうち最初の 2 回（200ms / 600ms）を消費。最終失敗時の 1800ms は使わない（試行 3 が失敗した瞬間に握りつぶす）。
    シンプルさのため `attempts: 3` + `backoffMs: [200, 600]` を card-background.ts から渡す（1800 は使わない）
  - 互換動作: `backoffMs[i] ?? 0` で配列長不足時は 0 ms fallback（無害な safety）
- **VALIDATE**:
  - `npm run typecheck` clean
  - `src/lib/utils/retry.test.ts` で `vi.useFakeTimers` + `vi.advanceTimersByTimeAsync` 経由の attempt count / onFinalFailure 呼出を検証

### Task 2: `src/lib/utils/image-resize.ts` を新規作成

- **ACTION**: canvas API による 1200×630 jpeg 0.8 リサイズ helper を新規作成
- **IMPLEMENT**: 上記 `IMAGE_RESIZE_HELPER` パターン全体を実装
  - export: `resizeImageToCardSize(file: File, opts?: ResizeOptions): Promise<Blob>`
  - cover フィット（centered crop）で MVP 十分。padding fit は将来課題
  - 出力 mime type は default `"image/jpeg"`（透過情報を捨てる仕様で OK、Storage rule は `image/(jpeg|png|webp)` を許容するため将来も互換）
  - `AppError` で wrap、code は `image/canvas-unavailable` / `image/encode-failed` / `image/load-failed`
- **MIRROR**: IMAGE_RESIZE_HELPER。canvas API は依存追加不要（ブラウザ標準）
- **IMPORTS**:
  - `@/lib/errors` から `AppError`
  - `@/app/api/og/_lib/og-card-styles` から `OG_WIDTH` / `OG_HEIGHT`（drift 防止）
- **GOTCHA**:
  - **iOS Safari**: `canvas.toBlob` は実装済み（iOS 10+）。ただし async/await ラップは `new Promise` 経由（toBlob は Promise を返さない）
  - **EXIF 回転**: スマホで撮った写真は EXIF orientation で見た目と pixel データが不一致な場合があるが、canvas `drawImage` で自動補正される（Chromium / WebKit / Gecko すべて）。明示的 EXIF 処理は不要
  - **大きい画像（10MB+）**: client memory pressure はあるが、Task 5 の pre-reject（5MB 超）で防ぐ
  - **`URL.createObjectURL` のリーク**: try / finally で必ず `URL.revokeObjectURL`
- **VALIDATE**:
  - `npm run typecheck` clean
  - `src/lib/utils/image-resize.test.ts` で canvas mock 経由の characterization
    （jsdom は canvas 描画を実 render しないため、`HTMLCanvasElement.prototype.toBlob` を `vi.spyOn` で stub。
    実際の resize 品質は手動で確認する）

### Task 3: `src/lib/firebase/repositories/cardBackgroundStorage.ts` を新規作成

- **ACTION**: Firebase Storage SDK 呼出を repository に閉じ込め
- **IMPLEMENT**: 上記 `REPOSITORY_STORAGE_OPS` パターン全体
  - export:
    - `uploadCardBackgroundAsset(gid, assetId, blob, contentType): Promise<string>`（download URL を返す）
    - `deleteCardBackgroundAsset(gid, assetId): Promise<void>`（object-not-found は冪等扱い）
  - assetId は呼出側で `crypto.randomUUID()` 生成（service 層で発行、repository は受取のみ）
  - path は `groups/${gid}/bgImages/${assetId}` で文字列固定（storage.rules と完全一致、drift 防止のため定数化したい場合は本 file 内に export）
- **MIRROR**: REPOSITORY_STORAGE_OPS。`wrap.ts` の構造を参考にしつつ、Storage は Firestore と SDK が違うため
  別 helper を本 file 内に閉じ込める
- **IMPORTS**:
  - `firebase/storage` から `getDownloadURL`, `ref`, `uploadBytes`, `deleteObject`
  - `@/lib/firebase/client` から `firebaseStorage`
  - `@/lib/errors` から `AppError`
  - `@/lib/logger` から `logger`
- **GOTCHA**:
  - **`object-not-found` の冪等扱い**: 旧 asset の retry 削除は「既に消えていれば成功扱い」が望ましい。code は `"storage/object-not-found"`
  - **content-type の type-narrowing**: `"image/jpeg" | "image/png" | "image/webp"` を union 型で渡す。string ではない（Storage rule の regex `image/(jpeg|png|webp)` と一致させる）
  - **Storage URL の永続性**: `getDownloadURL` の返す URL は `firebasestorage.googleapis.com/...?token=...` 形式で永続的（token を含むが本 phase の rule は `allow read: if true` のため token 無しでも read 可能。OG SSR route が anon fetch する想定で問題ない）
  - **CORS**: Storage download URL は `firebasestorage.googleapis.com` 経由で Node から fetch する想定。
    Vercel Node runtime からの fetch は CORS preflight 不要（サーバ間通信）
- **VALIDATE**:
  - `npm run typecheck` clean
  - `src/lib/services/card-background.test.ts` で repository 関数 を mock し、service オーケストレーションを characterization（repository 自体の unit test は SDK mock コストが高いためサービス層経由でカバー）

### Task 4: `src/lib/services/card-background.ts` を新規作成

- **ACTION**: upload + Firestore pointer 更新 + 旧 asset retry 削除のオーケストレータ service を新規作成
- **IMPLEMENT**: 上記 `SERVICE_ORCHESTRATION` パターンを実装
  - export:
    - `uploadAndSetWinnerCardBackground(opts): Promise<void>`
    - `uploadAndSetSeasonCardBackground(opts): Promise<void>`
    - `clearWinnerCardBackground(opts): Promise<void>`
    - `clearSeasonCardBackground(opts): Promise<void>`
    - `updateCardBackgroundTextTheme(opts): Promise<void>`（既存 imageUrl / storageAssetId を保ったまま textTheme のみ更新する、A.2 では owner が画像差し替え不要で theme だけ切替えたいケース）
  - 各関数は内部で:
    1. `crypto.randomUUID()` で新 assetId 発行（upload 系のみ）
    2. `uploadCardBackgroundAsset` で Storage upload + downloadURL 取得
    3. `setWinner/SeasonCardBackground`（A.1 service）で Firestore pointer 更新（assertOwner はここで実行）
    4. 旧 `previousAssetId !== null` のとき `deleteWithRetry(...)` で削除
  - `clearXxxCardBackground` は逆順:
    1. `setWinner/SeasonCardBackground({ value: null })` で Firestore pointer null 化（assertOwner 経由）
    2. 旧 assetId があれば `deleteWithRetry(...)` で削除
  - `updateCardBackgroundTextTheme` は既存 value をコピーして textTheme だけ差し替えて `setXxxCardBackground` を呼ぶ。**画像差替えではない**経路。pre-condition として「現在 value 非 null かつ imageUrl 非 null」を呼出側で gate（UI で disabled / 切替えを画像保持中のみ許可）。null 時の theme 単独設定は本 phase scope 外
- **MIRROR**: SERVICE_ORCHESTRATION + 既存 `services/group.ts` の組立規約（assertXxx は下流の service が実行、上流 service は orchestration のみ）
- **IMPORTS**:
  - `@/lib/firebase/repositories/cardBackgroundStorage` から `uploadCardBackgroundAsset`, `deleteCardBackgroundAsset`
  - `@/lib/services/group` から `setWinnerCardBackground`, `setSeasonCardBackground`
  - `@/lib/utils/retry` から `deleteWithRetry`
  - `@/lib/errors` から `getErrorCode`
  - `@/lib/firebase/schemas/group` から `CardBackground`, `CardTextTheme`
  - `@/lib/logger` から `logger`
- **GOTCHA**:
  - **二重 wrap 厳禁**: `setXxxCardBackground`（A.1 service）が既に `assertOwner` + repository wrap helper 経由で `AppError` 化済み。本 service は catch を最小限にし、再ラップしない（[error-logging.md](../../../../.claude/rules/error-logging.md) の二重 warn 防止）
  - **Storage upload 失敗の rollback**: Firestore pointer 未更新の状態で Storage に orphan asset が残る可能性がある。対策として upload 失敗時は何もしない（rule で 1MB / image content-type を deny する正常系のためで、storage 障害時の orphan は許容）。retry はメイン flow には組み込まない
  - **新 asset upload 成功 → Firestore pointer 更新失敗**: この race 時は新 asset が orphan。Phase A.2 では捕捉せず `setXxxCardBackground` の throw に乗せて UI にエラー表示し、ユーザーに再試行を促す。retry pre-emption は本 phase 範疇外
  - **previousAssetId が同じ assetId**: theme 単独更新時に同 assetId を Storage に置きっぱなしにする経路を作る（更新を Firestore pointer のみで完結）
- **VALIDATE**:
  - `npm run typecheck` clean
  - `src/lib/services/card-background.test.ts` で以下ケース mock:
    1. upload 成功 + 旧 assetId null（初回）→ delete 呼出ゼロ
    2. upload 成功 + 旧 assetId あり → delete 1 回呼出（成功）
    3. upload 成功 + 旧 assetId あり → delete 3 回失敗 → `logger.warn` で "orphan card background asset"
    4. clear（value=null） + 旧 assetId あり → delete 呼出 1 回
    5. updateTextTheme → upload 呼出ゼロ、setXxx 1 回
    6. upload throw → 上位に伝搬、setXxx 呼出ゼロ
    7. setXxx throw → 新 asset の orphan は許容（warn なし、scope 外）

### Task 5: `src/app/groups/[gid]/_components/CardBackgroundCard.tsx` を新規作成

- **ACTION**: winner / season 共通の UI 部品を新規作成。`kind` prop で動作を切替
- **IMPLEMENT**:
  ```tsx
  // SOURCE: src/app/groups/[gid]/_components/AudioSettingsCard.tsx:46-226 を骨格にする
  interface Props {
    kind: "winner" | "season";
    /** owner-only 編集を gate するため呼出側で gate も推奨だが、本 component 内でも canEdit prop でガード */
    canEdit: boolean;
    /** 現在の背景画像メタデータ。null = 未設定 */
    current: CardBackground;
    /** 保存成功時のリロード（親の reload + refreshGroups を再走させる）。 */
    onSaved: () => Promise<void>;
    /** エラー通知（親の setError と接続）。 */
    onError: (message: string) => void;
    /** sub テスト互換のための data-testid suffix */
    dataTestIdPrefix?: string;
  }

  export function CardBackgroundCard({
    kind, canEdit, current, onSaved, onError, dataTestIdPrefix,
  }: Props) {
    // 状態:
    //  - selectedFile: File | null（input でファイル選択した直後の生 File）
    //  - previewBlob: Blob | null（resize 済み圧縮後 Blob、save 対象）
    //  - previewUrl: string | null（URL.createObjectURL でプレビュー）
    //  - textTheme: "light" | "dark"（current のコピー、編集 draft）
    //  - working: boolean、savedFlash: boolean
    //
    // 動作:
    //  1. <input type="file" accept="image/*"> でファイル選択
    //  2. onFileChange: size > 5MB → onError("画像は 5MB 以下を選択してください")
    //                  mime ∉ jpeg/png/webp → onError("...")
    //                  → resizeImageToCardSize で 1200×630 jpeg 0.8 圧縮
    //                  → previewUrl 更新（URL.createObjectURL 経由）
    //                  → previewBlob を state に保持
    //  3. 「保存」: working=true → uploadAndSetXxxCardBackground 経由で upload + Firestore + 旧 delete
    //              → onSaved() / savedFlash
    //  4. 「テキストテーマ」 radio: textTheme state を更新（即 save しない、保存ボタンと連動）
    //  5. 「背景を解除」: confirm modal → clearXxxCardBackground 経由で削除（assertOwner は service）
    //  6. <img src={previewUrl ?? current?.imageUrl ?? null} /> でプレビュー表示。
    //     null のときは 既存の amber / navy グラデを CSS で再現した placeholder
    //
    // ファイル input は <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden />
    // 「ファイルを選択」ボタンの onClick で fileInputRef.current.click()
    //
    // 注意文: "公開 URL になります（メンバー以外も閲覧可）" を CardDescription に
  }
  ```
- **MIRROR**: CARD_INLINE_EDIT（AudioSettingsCard）+ GroupDefaultTableLabelsCard の startEdit / cancelEdit パターン
- **IMPORTS**:
  - `@/components/ui/{button, card, input, label}` shadcn 基本コンポーネント
  - `@/lib/services/card-background` から `uploadAndSetWinnerCardBackground` / `Season` / `clearXxxCardBackground` / `updateCardBackgroundTextTheme`
  - `@/lib/utils/image-resize` から `resizeImageToCardSize`
  - `@/lib/firebase/schemas/group` から `CARD_TEXT_THEMES`, `CardBackground`, `CardTextTheme`, `DEFAULT_CARD_BACKGROUND_TEXT_THEME`
  - `@/lib/errors` から `unwrapOrFrom`, `formatErrorForDisplay`
  - `@/lib/logger`
  - `@/lib/firebase/AuthProvider` から `useAuthUser`（uid 取得）
  - `lucide-react` から `Upload`, `Trash2` icons
- **GOTCHA**:
  - **ユーザー向けメッセージに技術用語を出さない**（memory: `feedback_no_tech_stack_in_user_messages`）:
    - エラー文に "Firebase" / "Storage" 単語禁止
    - "画像のアップロードに失敗しました" / "背景の解除に失敗しました" のような自然な日本語
  - **`previewUrl` のリーク**: `useEffect` cleanup で `URL.revokeObjectURL`
  - **ファイル input のリセット**: 同じファイルを 2 回選択しても onChange が発火するよう、save 後に `fileInputRef.current.value = ""` でクリア
  - **canEdit=false の表示**: プレビューと「背景未設定」or 現在の画像のみ。ボタンは hidden
  - **kind による service 分岐**: `kind === "winner"` ? `uploadAndSetWinnerCardBackground` : `uploadAndSetSeasonCardBackground` を `switch` で
- **VALIDATE**:
  - `npm run typecheck` clean
  - `CardBackgroundCard.test.tsx` で以下:
    1. canEdit=false で「ファイルを選択」「保存」ボタンが render されない
    2. canEdit=true で current=null → 「背景未設定」表示
    3. canEdit=true で current.imageUrl 設定済 → `<img src={current.imageUrl}>` 表示
    4. ファイル選択 → resize mock 経由で previewUrl 更新 → 「保存」ボタン enabled
    5. 5MB 超ファイル選択 → onError("画像は 5MB 以下を選択してください") 呼出 + previewUrl 未更新
    6. mime "application/pdf" → onError 呼出
    7. 保存 success → onSaved 呼出 + savedFlash 表示
    8. 保存 failure → onError 呼出 + working=false 戻り
    9. 「背景を解除」 → clearXxxCardBackground 呼出 + onSaved
    10. textTheme radio 切替 → save 経由で反映される

### Task 6: `src/app/groups/[gid]/_components/WinnerCardBackgroundCard.tsx` / `SeasonCardBackgroundCard.tsx` を新規作成

- **ACTION**: 共通基底の thin wrapper を 2 つ作る（呼出側 import を kind ごとに型安全にする目的）
- **IMPLEMENT**:
  ```tsx
  // WinnerCardBackgroundCard.tsx
  "use client";
  import { CardBackgroundCard } from "./CardBackgroundCard";
  import type { GroupDoc } from "@/lib/firebase/schemas/group";

  interface Props {
    group: GroupDoc;
    canEdit: boolean;
    onSaved: () => Promise<void>;
    onError: (message: string) => void;
  }
  export function WinnerCardBackgroundCard({ group, canEdit, onSaved, onError }: Props) {
    return (
      <CardBackgroundCard
        kind="winner"
        canEdit={canEdit}
        current={group.winnerCardBackground}
        onSaved={onSaved}
        onError={onError}
        dataTestIdPrefix="winner-card-bg"
      />
    );
  }
  // SeasonCardBackgroundCard.tsx も対称。current={group.seasonCardBackground}
  ```
- **MIRROR**: なし（thin wrapper のみ）
- **IMPORTS**: 上記
- **GOTCHA**: なし。1 file ≤ 30 行。**Wave 1 で CardBackgroundCard が動いた後の trivial split**
- **VALIDATE**: 単体テストは不要（thin wrapper、props 直渡し）。`npm run typecheck` clean

### Task 7: `group-detail-client.tsx` に 2 カードを追加

- **ACTION**: 設定タブに `WinnerCardBackgroundCard` / `SeasonCardBackgroundCard` を `isOwner` で gate して追加
- **IMPLEMENT**: [group-detail-client.tsx#L426-L478](../../../../src/app/groups/[gid]/group-detail-client.tsx#L426-L478) の `settings: ( <> ... </> )` ブロック末尾に以下を追加:
  ```tsx
  {isOwner ? (
    <>
      <WinnerCardBackgroundCard
        group={group}
        canEdit={isOwner}
        onSaved={async () => {
          await reload();
          await refreshGroups();
        }}
        onError={setError}
      />
      <SeasonCardBackgroundCard
        group={group}
        canEdit={isOwner}
        onSaved={async () => {
          await reload();
          await refreshGroups();
        }}
        onError={setError}
      />
    </>
  ) : null}
  ```
  併せて先頭に:
  ```tsx
  import { SeasonCardBackgroundCard } from "./_components/SeasonCardBackgroundCard";
  import { WinnerCardBackgroundCard } from "./_components/WinnerCardBackgroundCard";
  ```
- **MIRROR**: 既存 `AudioSettingsCard` の使い方（[group-detail-client.tsx#L467-L477](../../../../src/app/groups/[gid]/group-detail-client.tsx#L467-L477)）
- **IMPORTS**: 上記
- **GOTCHA**:
  - **isOwner で完全 hidden**（display none ではない、conditional render）。組織者・一般メンバーは存在に気づかなくて OK（PRD「Track A primary: サークル代表(owner)」）
  - `onSaved` は audio と同じく `reload() + refreshGroups()`。**group の prop が即時 reactive に更新**されることが Required for UX
- **VALIDATE**:
  - `npm run typecheck` clean
  - dev サーバで `/groups/[gid]?tab=settings` を owner / organizer / member で開き、それぞれ 2 カードの visibility を確認

### Task 8: `src/app/api/og/_lib/og-payload.ts` に `bgImageUrl` / `bgTextTheme` を追加

- **ACTION**: query schema に背景画像 query を additive 追加 + `buildXxxShareInputs` / `buildXxxCardUrl` を背景画像対応に拡張
- **IMPLEMENT**:
  ```ts
  // src/app/api/og/_lib/og-payload.ts の追加分

  /** Storage 経由の download URL の最大長。Firebase Storage の token 付き URL は実測 ~400 字、余裕を持って cap。 */
  const BG_IMAGE_URL_MAX = 600;

  // WINNER_CARD_QUERY_SCHEMA に追加:
  bgImageUrl: z.string().url().min(1).max(BG_IMAGE_URL_MAX).optional(),
  bgTextTheme: z.enum(CARD_TEXT_THEMES).optional(),

  // SEASON_CARD_QUERY_SCHEMA にも同じ 2 行を追加

  // buildWinnerCardUrl に追加:
  if (q.bgImageUrl !== undefined) sp.set("bgImageUrl", q.bgImageUrl);
  if (q.bgTextTheme !== undefined) sp.set("bgTextTheme", q.bgTextTheme);

  // buildSeasonCardUrl にも同様

  // buildWinnerShareInputs の引数を拡張:
  export interface WinnerShareInputsParams {
    winnerName: string;
    tournamentName: string;
    participants: number;
    finishedAt: Date;
    /** Phase A.2: サークルの優勝カード背景画像メタデータ。null = グラデのみ */
    cardBackground?: CardBackground | null;
  }

  export function buildWinnerShareInputs(
    tid: string,
    params: WinnerShareInputsParams,
  ): ShareCardInputs {
    // ... 既存処理 ...
    const url = buildWinnerCardUrl(tid, {
      ...existing,
      bgImageUrl: params.cardBackground?.imageUrl ?? undefined,
      bgTextTheme: params.cardBackground?.textTheme ?? undefined,
      filename: filenameStem,
    });
    return { url, filenameStem };
  }

  // buildSeasonShareInputs にも cardBackground optional 追加
  ```
- **MIRROR**: 既存 `optional()` フィールドの追加パターン（`top2Name` / `top3Name`）
- **IMPORTS**:
  - 既存
  - `CARD_TEXT_THEMES` を `@/lib/firebase/schemas/group` から
  - `CardBackground` 型 を `@/lib/firebase/schemas/group` から
- **GOTCHA**:
  - **URL 長**: Firebase Storage download URL は token を含み実測 ~400 字。query 全体で 1500 字以下は安全圏（Vercel の URL 長 limit はパス含めて 8KB 程度）
  - **cardBackground.imageUrl が null かつ storageAssetId が null** の場合は **buildXxxCardUrl が undefined を渡し、`bgImageUrl` を URL に含めない**（textTheme は依然 set されてもよいが、画像不在で theme 切替は意味薄なので両方とも undefined に倒す）
  - **schema は `.url()` 検証**: data URI ではなく https URL を期待。Storage download URL は `https://firebasestorage.googleapis.com/...` 形式
  - **`readSeasonCardQuery` の null sentinel**: 本 phase で追加する `bgImageUrl` / `bgTextTheme` は key 不在 → undefined 扱い（zod `.optional()` で受容）。null sentinel 化は不要
- **VALIDATE**:
  - `npm run typecheck` clean
  - `og-payload.test.ts` に以下追加:
    1. `WINNER_CARD_QUERY_SCHEMA.safeParse({...valid, bgImageUrl: "https://...", bgTextTheme: "dark"})` → success
    2. 同じく `bgImageUrl: "not-a-url"` → fail（zod .url）
    3. `bgImageUrl: undefined` → success（optional）
    4. `buildWinnerShareInputs(..., { cardBackground: { imageUrl: "https://x", storageAssetId: "a", textTheme: "dark" } })` の URL に `bgImageUrl=https%3A%2F%2Fx&bgTextTheme=dark` が含まれる
    5. `buildWinnerShareInputs(..., { cardBackground: null })` の URL に bgImageUrl / bgTextTheme が含まれない
    6. `cardBackground.imageUrl === null` の URL に bgImageUrl が含まれない

### Task 9: `src/app/api/og/_lib/og-image-fetch.ts` を新規作成

- **ACTION**: OG route で背景画像を base64 data URI に変換する純関数を新規作成
- **IMPLEMENT**:
  ```ts
  // src/app/api/og/_lib/og-image-fetch.ts

  import { AppError } from "@/lib/errors";

  /**
   * 公開 URL の画像を fetch して base64 data URI に変換する。
   * Satori は外部 URL を fetch しないため data URI が必須。
   *
   * 失敗時は `AppError("og/bg-fetch-failed", ...)` を throw する。呼出側で catch して
   * グラデーション fallback に倒す責務とする（OG route は image を返す契約のため、画像取得
   * 失敗で 500 を返さない）。
   */
  export async function fetchAsDataUri(url: string, signal?: AbortSignal): Promise<string> {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      throw new AppError(
        `背景画像の取得に失敗しました (status=${res.status})`,
        "og/bg-fetch-failed",
      );
    }
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const buf = await res.arrayBuffer();
    const base64 = Buffer.from(buf).toString("base64");
    return `data:${contentType};base64,${base64}`;
  }
  ```
- **MIRROR**: 既存 [src/app/api/og/_lib/load-font.ts](../../../../src/app/api/og/_lib/load-font.ts) のような薄い純関数 helper。
  load-font はファイル読込専門だが、本 file は同 `_lib` に並ぶ fetch helper
- **IMPORTS**:
  - `@/lib/errors` から `AppError`
- **GOTCHA**:
  - **Node runtime**: `runtime = "nodejs"` の route から呼ばれるため `Buffer` が使える（Edge runtime ではないため `btoa` 不要）
  - **content-type fallback**: Storage が `Content-Type: image/jpeg` を返さないケース（image/webp 等）も対応するため、response header から取り出して data URI に組込む
  - **タイムアウト**: 本 helper は `AbortSignal` を optional で受け取るが、本 phase では route 側でも特別なタイムアウト制御は入れない（Vercel の default で十分）
  - **fetch 失敗の取扱い**: `res.ok = false` も `fetch throw` も両方 `AppError("og/bg-fetch-failed")` で thrown。route 側で catch + `logger.warn` + 背景なし fallback
- **VALIDATE**:
  - `npm run typecheck` clean
  - `og-image-fetch.test.ts`:
    1. `global.fetch` を mock し、`Response(blob, { headers: { "content-type": "image/jpeg" } })` を返す → data URI を返す
    2. status 404 → AppError("og/bg-fetch-failed") を throw
    3. network throw → AppError を throw

### Task 10: `og-card-styles.ts` に dark theme 用色を追加

- **ACTION**: 既存 `OG_COLORS.winnerFg` / `seasonFg` は light theme 扱いとし、dark theme 用フォアグラウンド色を additive 追加
- **IMPLEMENT**:
  ```ts
  // src/app/api/og/_lib/og-card-styles.ts に追加
  export const OG_COLORS = {
    winnerBg: "linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)",
    winnerFg: "#451a03",       // light theme (既存)
    /** Phase A.2: 背景画像 + dark テキストテーマ用 foreground 色 */
    winnerFgDark: "#fef3c7",
    winnerBorder: "#f59e0b",
    seasonBg: "linear-gradient(135deg, #1e3a8a 0%, #312e81 100%)",
    seasonFg: "#fef3c7",        // light theme (既存。今回は元から薄黄色)
    /** Phase A.2: 背景画像 + dark テキストテーマ用 foreground 色 */
    seasonFgDark: "#451a03",
    seasonAccent: "#fde68a",
    seasonMuted: "#cbd5e1",
    /** Phase A.2: 背景画像時の半透明 scrim（30% black） */
    bgScrim: "rgba(0,0,0,0.3)",
  } as const;
  ```
- **MIRROR**: 既存 `OG_COLORS` の as const 構造
- **IMPORTS**: なし
- **GOTCHA**:
  - dark theme = 暗い背景画像向け → foreground 明色（amber 系）
  - light theme = 明るい背景画像向け → foreground 暗色（既存 fg 値を流用）
  - 既存 fg 値は light theme で意味的に正しい（winner は薄い amber 背景に対し暗茶色）
- **VALIDATE**: `npm run typecheck` clean

### Task 11: `winner/[tid]/route.tsx` に bgImageUrl 反映を追加

- **ACTION**: query から `bgImageUrl` / `bgTextTheme` を受信、fetch + Satori で background + scrim を重ね、fg 色を theme で切替
- **IMPLEMENT**:
  - `WINNER_CARD_QUERY_SCHEMA.safeParse(...)` の `q` から `q.bgImageUrl` / `q.bgTextTheme` を取得
  - `bgImageUrl` 非 undefined のとき `fetchAsDataUri(q.bgImageUrl).catch((e) => { logger.warn("og winner bg fetch failed", { tid, code: getErrorCode(e) }); return null; })`
  - Satori root を以下のように差替:
    ```tsx
    const bgDataUri = q.bgImageUrl ? await fetchAsDataUri(q.bgImageUrl).catch(...) : null;
    const fg = bgDataUri && q.bgTextTheme === "dark"
      ? OG_COLORS.winnerFgDark
      : OG_COLORS.winnerFg;

    <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", flexDirection: "column" }}>
      {bgDataUri ? (
        <img src={bgDataUri} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      ) : null}
      {bgDataUri ? (
        <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", background: OG_COLORS.bgScrim }} />
      ) : null}
      <div
        style={{
          width: "100%", height: "100%",
          display: "flex", flexDirection: "column",
          background: bgDataUri ? "transparent" : OG_COLORS.winnerBg,
          color: fg,
          fontFamily: OG_FONT_FAMILY,
          padding: OG_PADDING,
          border: bgDataUri ? "none" : `8px solid ${OG_COLORS.winnerBorder}`,
          boxSizing: "border-box",
          position: "relative",
        }}
      >
        {/* 既存のテキストブロック群はそのまま */}
      </div>
    </div>
    ```
- **MIRROR**: OG_BACKGROUND_INJECTION
- **IMPORTS**:
  - `fetchAsDataUri` from `@/app/api/og/_lib/og-image-fetch`
  - 既存 imports
- **GOTCHA**:
  - **既存挙動の保持**: `bgDataUri === null` のとき root の `background` / `border` / `color` は **既存値を完全維持**（visual regression ゼロが Acceptance）
  - **`<img>` の objectFit: "cover"**: アスペクト比保ちで全面カバー。Satori は CSS object-fit を一部サポート（実測 cover は OK）
  - **`position: relative`** を root に持たせた上で `<img>` / `<div scrim>` を `position: absolute`。Satori は absolute 位置決めをサポート
  - **fetch エラー時のフォールバック**: `catch` で null を返し、ログだけ残す。`response.status` は **常に 200**（カード生成自体は成功させる）。「画像が読めなかったので背景なしになった」はユーザー UX 側で「何かおかしい」と気付ける程度の degrade
  - **CDN cache 効果**: 同じ `bgImageUrl` を持つ query は同じ data URI に変換され、Satori 出力も決定的に同じ → Vercel の CDN cache が完全に効く。assetId が UUID で変わると URL も変わるため、画像差し替え時は自動 cache invalidation
- **VALIDATE**:
  - `npm run typecheck` clean
  - dev で `/api/og/winner/test-tid?winnerName=...&...` （bgImageUrl 無し）→ 既存 PNG と pixel-for-pixel 一致
  - dev で `/api/og/winner/test-tid?winnerName=...&bgImageUrl=https://...&bgTextTheme=dark` → 背景画像 + scrim + dark fg で render

### Task 12: `season/[gid]/route.tsx` にも同じ拡張を適用

- **ACTION**: winner route と対称な変更を season route にも適用
- **IMPLEMENT**: Task 11 の root を season 用に置換（OG_COLORS.seasonBg / seasonFg / seasonFgDark を使う）
- **MIRROR**: Task 11 と完全同形
- **IMPORTS**: 同
- **GOTCHA**: 同
- **VALIDATE**: 同

### Task 13: download button / share inputs callsite を更新

- **ACTION**: 4 つの callsite で `cardBackground` を `buildXxxShareInputs` 等に渡す
- **IMPLEMENT**:
  - `WinnerCardDownloadButton.tsx`: optional `cardBackground?: CardBackground | null` prop を追加、`buildWinnerShareInputs(tid, { ..., cardBackground })` で渡す
  - `SeasonTopCardDownloadButton.tsx`: 同様に `cardBackground?: CardBackground | null` を受取
  - `dashboard-client.tsx` ([#L387-L426](../../../../src/app/tournaments/[tid]/dashboard-client.tsx#L387-L426)):
    - `buildWinnerShareInputs(tid, { ..., cardBackground: tournamentGroup?.winnerCardBackground ?? null })`
    - `<WinnerCardDownloadButton ... cardBackground={tournamentGroup?.winnerCardBackground ?? null} />`
  - `live-client.tsx` ([#L240-L264](../../../../src/app/tournaments/[tid]/live/live-client.tsx#L240-L264)):
    - 同上、`tournamentGroup?.winnerCardBackground` を流す
  - `season-ranking-client.tsx` ([#L112-L134](../../../../src/app/groups/[gid]/season/season-ranking-client.tsx#L112-L134)):
    - `buildSeasonShareInputs(gid, group, stats, { cardBackground: group.seasonCardBackground })` ※ buildSeasonShareInputs の引数構造に合わせて統合
    - `<SeasonTopCardDownloadButton gid={gid} group={group} stats={stats} cardBackground={group.seasonCardBackground} />`
  - `season-history-detail-client.tsx` ([#L142-L180](../../../../src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.tsx#L142-L180)):
    - **過去シーズンも現在の `group.seasonCardBackground` を流用**（PRD MVP の方針）
    - 同上 callsite に `cardBackground={group.seasonCardBackground}` を追加
- **MIRROR**: 既存の `buildXxxShareInputs` 呼出パターン
- **IMPORTS**: 必要に応じて `CardBackground` 型
- **GOTCHA**:
  - **`tournamentGroup` が null の間**: `useGroupRole` は最初 null を返す。download button 表示時には tournament が finished で `tournamentGroup` も解決済みのことが多いが、`?? null` で安全に fallback
  - **`buildSeasonShareInputs` の signature 変更**: 既存呼出 3 箇所すべてを更新。互換のため 4 番目の引数を `options?: { cardBackground?: CardBackground | null }` 形式にする（破壊変更を避ける、未渡しなら従来通り）
  - **`season-history-detail-client.tsx` の選択**: 「過去シーズンのスナップショット背景を持たない」を PRD で明示 → 現在の group.seasonCardBackground を流用するのが最低限の整合。将来 snapshot を持つ場合は別 phase で
- **VALIDATE**:
  - `npm run typecheck` clean
  - 既存テスト（`WinnerCardDownloadButton.test.tsx` / `SeasonTopCardDownloadButton.test.tsx`）が pass（optional prop なので既存呼出は影響なし）

### Task 14: 既存テスト fixture / 既存 test の追従

- **ACTION**: schema 拡張時に既存テストの fixture を確認、build / lint / test を緑にする
- **IMPLEMENT**:
  - **Phase A.1 の経験則**: 既存 group / tournament の fixture は A.1 で既に `winnerCardBackground: null` / `seasonCardBackground: null` を追加済み。A.2 では schema additive 変更がないため、fixture の追従は不要のはず
  - もし `buildWinnerShareInputs` の signature 変更で既存 unit test がコンパイルエラーになれば、optional 引数なので無対応で pass する
  - 互換性確認: `npm run typecheck` / `npm run test` を流し、failure があれば fixture を更新（このタスク内で）
- **MIRROR**: なし（既知の対応）
- **IMPORTS**: なし
- **GOTCHA**: schema 自体は触らないので追従は最小。`tournamentGroup` を新規 prop で受ける場合は `useGroupRole` の mock を確認
- **VALIDATE**:
  - `npm run typecheck` clean
  - `npm run test` 1286 (現状) + 新規追加分 が all pass

### Task 15: 全体検証ループ

- **ACTION**: 以下を順に実行
- **IMPLEMENT**:
  ```bash
  npm run typecheck
  npm run lint
  npm run test
  npm run build

  npm run test:rules-card-background    # 既存 — 回帰確認
  npm run test:storage-rules            # 既存 — 回帰確認
  npm run test:rules-limits             # 既存 — drift 確認
  npm run test:rules-season             # 既存 — 回帰確認（season 周りは触っていないため pass 必須）

  npm run test:e2e                       # 既存 spec の回帰確認。本 phase は新 UI 追加だが既存 e2e に影響なし
  ```

  **追加で必要な手動検証**:
  ```bash
  # local emulator 経由のフル E2E
  npm run dev    # 別端末で
  npm run emulator   # Storage emulator 起動

  # owner として /groups/[gid]?tab=settings を開き、以下を順に確認:
  # 1. 「ファイルを選択」→ 200KB jpg を選択 → preview 表示
  # 2. 6MB jpg → "画像は 5MB 以下" エラー
  # 3. test.pdf → "画像形式 (jpeg, png, webp)" エラー
  # 4. 「保存」→ Storage に upload → Firestore pointer 更新 → savedFlash
  # 5. 別 owner 端末で onSnapshot reflect 確認
  # 6. dashboard → `/api/og/winner/[tid]` を新タブで開いて背景画像反映を確認
  # 7. 別画像で差し替え → 旧 asset が Storage から消えていることを Firebase Console で確認
  # 8. 「背景を解除」→ Firestore null + Storage delete を確認
  # 9. organizer / member で /groups/[gid]?tab=settings → 2 カードが visible しないことを確認
  ```
- **MIRROR**: Phase A.1 完了条件
- **IMPORTS**: なし
- **GOTCHA**:
  - **本番 Firestore rules / Storage rules deploy**: 本 phase は rule に触らない（A.1 で完成済）ため、追加 deploy は不要。ただし「A.1 マージ後の deploy が済んでいない場合」は本 phase をリリース前に必ず実行（memory: `feedback_firestore_rules_deploy`）
  - **`npm run test:e2e`**: Playwright config は storage emulator 起動しないため、本 phase の UI を E2E では検証しない（手動 + 単体テストで担保）。`webServer.env` への storage 追加は次回 phase（A.3）で検討
- **VALIDATE**: 全コマンド 0 exit + 手動検証チェックリスト 9 項目すべて pass

---

## Testing Strategy

### Unit Tests

| Test                                                       | Input                                              | Expected Output                                   | Edge Case?               |
| ---------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------- | ------------------------ |
| `deleteWithRetry` success on 1st attempt                   | mock fn が 1 回目で resolve                        | callback 呼出ゼロ                                 | -                        |
| `deleteWithRetry` success on 3rd attempt                   | mock fn が 1, 2 回目 reject, 3 回目 resolve         | callback 呼出ゼロ、sleep 200ms / 600ms 経過        | yes                      |
| `deleteWithRetry` final failure                            | mock fn が 3 回とも reject                          | `onFinalFailure` が最終 error で呼ばれる           | yes                      |
| `deleteWithRetry` aborted                                  | signal aborted before 1st attempt                   | fn 呼出ゼロ                                       | yes                      |
| `resizeImageToCardSize` mime/size                          | jpeg 800×600 file                                  | 1200×630 jpeg quality 0.8 blob                    | -                        |
| `resizeImageToCardSize` portrait image                     | jpeg 600×800 file                                  | 1200×630 jpeg、centered crop                      | yes                      |
| `resizeImageToCardSize` canvas unavailable                 | jsdom canvas.getContext null                       | AppError("image/canvas-unavailable")              | yes                      |
| `uploadAndSetWinnerCardBackground` 初回                    | previousAssetId=null                               | upload 1 回 + setXxx 1 回 + delete 呼出ゼロ        | -                        |
| `uploadAndSetWinnerCardBackground` 差し替え                | previousAssetId="prev"                              | upload + setXxx + delete 1 回                      | -                        |
| `uploadAndSetWinnerCardBackground` 旧 delete 3 回失敗       | previousAssetId="prev", delete mock all reject     | logger.warn "orphan card background asset"       | yes                      |
| `clearWinnerCardBackground` 既存 asset 解除                | current={imageUrl, storageAssetId, theme}          | setXxx({value:null}) + delete 1 回                | -                        |
| `clearWinnerCardBackground` 既存未設定                     | current=null                                       | setXxx({value:null}) のみ (delete 呼出ゼロ)        | yes                      |
| `updateCardBackgroundTextTheme`                            | current={imageUrl,assetId,light}, new theme=dark   | setXxx(value={imageUrl,assetId,dark}) のみ         | -                        |
| `fetchAsDataUri` 200                                       | mock fetch 200 + jpeg blob                          | "data:image/jpeg;base64,..."                       | -                        |
| `fetchAsDataUri` 404                                       | mock fetch 404                                     | AppError("og/bg-fetch-failed")                    | yes                      |
| `fetchAsDataUri` network throw                             | mock fetch reject                                   | AppError                                           | yes                      |
| `WINNER_CARD_QUERY_SCHEMA.parse` with bgImageUrl/bgTextTheme | 有効値                                              | success                                            | -                        |
| `WINNER_CARD_QUERY_SCHEMA.parse` with invalid bgImageUrl    | "not-a-url"                                         | fail                                               | yes                      |
| `buildWinnerShareInputs` with cardBackground                | { ..., cardBackground: {imageUrl, assetId, dark} } | url に bgImageUrl / bgTextTheme クエリが含まれる   | -                        |
| `buildWinnerShareInputs` without cardBackground             | { ... }（cardBackground 未指定）                     | url に bgImageUrl が含まれない（既存挙動と完全一致）| yes                      |
| `CardBackgroundCard` render canEdit=false / current null    | -                                                  | "背景未設定" 表示、ボタン群非表示                  | -                        |
| `CardBackgroundCard` ファイル選択（5MB OK jpg）              | 4MB jpg                                            | resize mock 経由で preview 更新                    | -                        |
| `CardBackgroundCard` ファイル選択（5MB 超）                  | 6MB jpg                                            | onError 呼出、preview 未更新                       | yes                      |
| `CardBackgroundCard` 保存                                    | preview blob あり                                  | uploadAndSetXxx 呼出、savedFlash                   | -                        |
| `CardBackgroundCard` 背景解除                                | current 非 null                                    | clearXxx 呼出、onSaved                             | -                        |

### Edge Cases Checklist

- [x] **未設定サークルの既存挙動**: bgImageUrl 未指定の URL → 既存 amber/navy グラデ PNG（完全 pixel 一致）
- [x] **画像 5MB 超**: pre-reject + onError 表示、Storage upload 呼出ゼロ
- [x] **PDF を選択**: mime チェックで onError 表示
- [x] **EXIF rotation を含む iPhone 写真**: canvas drawImage 自動補正で正しい方向で描画
- [x] **owner 以外がカードを開く**: 描画されない（conditional render）
- [x] **owner が初回 upload**: previousAssetId=null で delete 呼出ゼロ
- [x] **owner が 2 回目 upload**: 旧 asset を retry で削除
- [x] **旧 asset 削除 3 回失敗**: warn ログ + メイン flow 成功
- [x] **owner が背景解除**: pointer=null + Storage delete
- [x] **OG route で bgImageUrl の fetch 失敗（CDN 障害 / token 失効）**: グラデ fallback + warn ログ
- [x] **同じ assetId への上書き upload race（2 端末 owner）**: rule で 1MB / image content-type を deny、勝った側の URL が Firestore に書込まれ、もう片方は orphan として残る（warn ログ）。サークルあたり owner 1〜2 名想定で実害なし
- [x] **画像 URL の権限変更（Storage rule が変わって anon read 不可になる）**: OG route の fetch が 403 → グラデ fallback。本 phase で rule 変更はないため発生しない
- [x] **textTheme トグル単独保存**: 画像を保持したまま theme のみ更新（upload なし）

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
```

EXPECT: ゼロ型エラー

```bash
npm run lint
```

EXPECT: ゼロ lint エラー

### Unit Tests

```bash
npm run test
```

EXPECT: 全 vitest テスト pass。既存 1286 件 + 本 phase 追加分（retry / image-resize / card-background service /
og-image-fetch / og-payload extension / CardBackgroundCard ≈ 25〜35 件追加）

### Build

```bash
npm run build
```

EXPECT: Next.js build 成功。OG route の SSR 評価で `fetchAsDataUri` / Storage SDK 参照に起因するエラー
が出ない（`runtime = "nodejs"` 維持）

### Emulator Rule Validation（A.1 の回帰確認）

```bash
npm run test:rules-card-background
npm run test:storage-rules
npm run test:rules-limits
npm run test:rules-season
```

EXPECT: 全 emulator validator green（本 phase は rule 変更なし、回帰確認のみ）

### E2E Smoke

```bash
npm run test:e2e
```

EXPECT: 全 spec pass（本 phase は新 UI 追加だが、`groups/[gid]?tab=settings` の owner 向け要素は既存
spec の selector を破壊しない）

### Manual Validation

- [ ] `/groups/[gid]?tab=settings` を owner で開き 2 カードが描画される
- [ ] organizer / member で同 URL を開き 2 カードが描画されない
- [ ] 200KB jpg を選択 → preview 表示 → 「保存」→ Firestore Console + Storage Console で実反映確認
- [ ] 別画像で差替 → 旧 asset が Storage から消えていることを Firebase Console で確認
- [ ] 「背景を解除」→ pointer null + Storage 該当 asset 消去
- [ ] 6MB ファイル選択 → エラー表示 + Storage upload なし
- [ ] test.pdf 選択 → エラー表示 + Storage upload なし
- [ ] dashboard → 「画像を保存」ボタンで PNG download → 新背景反映
- [ ] season ランキング → 「シーズン首位カードを保存」→ 新背景反映
- [ ] 過去シーズン詳細画面の「過去シーズン首位を保存」→ 現在の `seasonCardBackground` を反映（PRD MVP 仕様）
- [ ] OG route 直接 GET（dev / production）で `bgImageUrl` を含む URL に応答 200 + 画像背景 PNG
- [ ] OG route URL の `bgImageUrl` を不正値（404 を返す URL）に書き換えた場合 → 200 + グラデ fallback PNG + `logger.warn`
- [ ] Vercel preview deploy 経由でも同等動作

---

## Acceptance Criteria

- [ ] 全 15 Task が completed
- [ ] 全 Validation Commands が pass
- [ ] 既存 OG route の bgImageUrl 未指定挙動が完全に維持（visual regression ゼロ）
- [ ] owner のみが `/groups/[gid]?tab=settings` で 2 カードを編集可能
- [ ] 旧 asset の retry 削除が 3 回までで動作、3 回失敗時のみ orphan warn
- [ ] OG route fetch 失敗時はグラデ fallback + warn ログ（500 を返さない）
- [ ] dashboard / live / season ランキング / 過去シーズン詳細の 4 callsite で download URL に bgImageUrl / bgTextTheme が含まれる
- [ ] Codex review に通る

## Completion Checklist

- [ ] Storage SDK 呼出は `cardBackgroundStorage.ts` repository に閉じ込め（UI から直接呼ばない）
- [ ] Service `card-background.ts` は orchestration のみで、assertOwner は下流の `setXxxCardBackground`（A.1 service）に委譲
- [ ] retry helper は YAGNI（旧 asset 削除専用）で generic 化しない
- [ ] 新規 `*.{ts,tsx}` で `console.*` 直呼び / 素の `throw new Error` がない（[error-logging.md](../../../../.claude/rules/error-logging.md) 準拠）
- [ ] AppError code に `image/*` / `storage/*` / `og/*` の prefix を付与
- [ ] ユーザー向けメッセージに「Firebase」「Storage」等の技術スタック名を含めない（memory: `feedback_no_tech_stack_in_user_messages`）
- [ ] PRD A.2 行を `pending → in-progress`、完了時に `complete` に更新
- [ ] テスト追加が **実装と同じ commit** にペアで含まれる（[testing.md](../../../../.claude/rules/testing.md) 規約）

## Risks

| Risk                                                                          | Likelihood | Impact | Mitigation                                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| canvas API が iOS Safari で挙動差分（toBlob の Promise 化など）              | L          | M      | `new Promise<Blob \| null>((resolve) => canvas.toBlob(resolve, ...))` で wrapping。各ブラウザの仕様準拠は 2026 時点で安定                                                                    |
| Storage download URL が token 期限切れで 403                                   | L          | M      | Firebase Storage の download URL は token が長期有効（数ヶ月〜年単位、明示的に revoke しない限り）。OG route fetch 失敗時はグラデ fallback で degrade                                       |
| Satori が `<img>` の base64 data URI を render しない                          | L          | H      | Phase B の load-font.ts が base64 data URI で font 埋込済、`<img>` も同様にサポート（公式 doc 確認済）。万一描画されない場合は `<div style={{ backgroundImage: \`url(${dataUri})\` }}>` に切替 |
| 旧 asset retry 削除が race window で同 asset を 2 端末から削除試行             | L          | L      | Storage の `object-not-found` は冪等扱い済。retry は最終失敗を握りつぶす設計のため race 競合は warn のみ                                                                                    |
| 5MB pre-reject 漏れによる Storage rule deny で UX 破綻                         | L          | M      | client-side で `file.size > 5MB` reject、storage.rules は 1MB だが client-side resize 後は ~150-250KB なので十分余裕                                                                       |
| OG route の追加 fetch で SSR latency 増加（PRD success metric の p95 +200ms 制限） | M          | M      | `s-maxage=86400` の CDN cache が効くため初回のみ。Storage download URL のレスポンスは数百ms オーダー、Vercel Edge から fetch すると更に高速                                                  |
| 過去シーズン詳細画面で現在の `seasonCardBackground` を流用することで「シーズン切替前後で背景が不一致」になる | M          | L      | PRD で「NOT Building: シーズンスナップショット背景」と明示済み。将来要望が出れば別 phase で対応                                                                                              |
| `tournamentGroup` が null の間の prop drift                                   | L          | L      | `tournamentGroup?.winnerCardBackground ?? null` で safe access、未解決でも既存挙動と一致                                                                                                    |
| 新規 `cardBackgroundStorage.ts` の SDK mock cost が test で大きい               | M          | L      | service 層 `card-background.test.ts` で repository 関数を mock することで vitest は SDK を初期化せず動作する                                                                                |

## Notes

- **本 phase は Firestore rules / Storage rules を一切変更しない**。A.1 で完成した rule の上で SDK + UI を組むのみ。
  本番 deploy も rules 系は不要（A.1 マージ後の deploy が済んでいる前提）
- **画像 1 枚あたり Storage に残るのは最大 1 つ**（winner / season で計 2 枚）。owner が背景を差し替えるたびに旧 asset を retry 削除するため、サークル単位の Storage 使用量が膨らまない
- **過去シーズン詳細の背景**: 現在の `group.seasonCardBackground` を流用する設計。PRD で「シーズンスナップショット背景は NOT Building」と明示されているため、本 phase でも持ち越し
- **本 phase 完了後の commit 戦略**: Wave 単位で commit を分けるのが推奨:
  - Wave 1 (Tasks 1-4): utils / repositories / services 基盤
  - Wave 2 (Tasks 5-7): UI コンポーネント追加
  - Wave 3 (Tasks 8-12): OG route 拡張
  - Wave 4 (Tasks 13-15): callsite 更新 + 全体検証
- **Codex review 前のチェック**: 既存 dev / live / season ランキング / 過去シーズン詳細の 4 callsite すべてで bgImageUrl 付き URL を確認（手動）。
  自動 visual regression は本 phase 範疇外（手動で十分、Phase A.3 で `npm run test:e2e` 拡張を検討）
- **Phase A.3 で対応する scope**: スクリム上下グラデーション / テキストグループ rgba 半透明 box overlay / フォントサイズ調整 /
  visual regression E2E。本 phase の rgba 30% scrim はあくまで「読めるか読めないかボーダー」の最低限なので、
  A.3 での polish 前提
