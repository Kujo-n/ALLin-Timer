# Local Review: Phase A.2 — Background Image UI & SSR

**Reviewed**: 2026-05-11
**Author**: Kujo-n
**Branch**: `feat/phase-a.2-background-image-ui-and-ssr`
**Mode**: Local Review（未コミット変更）
**Decision**: **BLOCK** — CRITICAL/HIGH の SSRF / リソース枯渇問題があるためマージ前に修正必須

## Summary

新規 OG SSR の背景画像 fetch 経路（`/api/og/winner/[tid]?bgImageUrl=...` / `/api/og/season/[gid]?bgImageUrl=...`）が **未認証の公開エンドポイントで任意 URL を fetch する SSRF 経路**になっている。zod の `.url()` バリデーションのみではホストもプロトコルも制限されないため、攻撃者がクラウドメタデータエンドポイント（169.254.169.254）や内部 VPC サービスへ Node ランタイム側からリクエストを発行させられる。加えて fetch にタイムアウト・サイズ上限がなく、サーバーレス関数ハングによる DoS の余地がある。

A.1 のコードは現状ロジック自体は妥当だが、上記 2 件は **マージ前に塞ぐべき** と判断する。

## Findings

### CRITICAL

#### F-1: SSRF — `bgImageUrl` query が任意 URL を server-side fetch する

**ファイル:**
- [src/app/api/og/_lib/og-image-fetch.ts](../../../src/app/api/og/_lib/og-image-fetch.ts) 行 19（`const res = await fetch(url, { signal });`）
- [src/app/api/og/_lib/og-payload.ts](../../../src/app/api/og/_lib/og-payload.ts) 行 47, 65（`bgImageUrl: z.string().url().min(1).max(BG_IMAGE_URL_MAX).optional()`）
- [src/app/api/og/winner/[tid]/route.tsx](../../../src/app/api/og/winner/[tid]/route.tsx) 行 66 / [season/[gid]/route.tsx](../../../src/app/api/og/season/[gid]/route.tsx) 行 116（呼出側）

**Exploit:**
攻撃者が `GET /api/og/winner/anything?winnerName=...&bgImageUrl=http://169.254.169.254/latest/meta-data/...` を送ると、Vercel Node ランタイムから AWS/GCP メタデータエンドポイントへ HTTP リクエストが発行される。レスポンスは base64 で data URI 化されて Satori に渡るため、PNG 描画自体は失敗してグラデ fallback に倒れるが、**SSRF 経路自体は成立する**（タイミング攻撃で内部サービス探査可能、将来 VPC ピアリング導入時に致命傷化）。`http://localhost:6379/...` 等の内部サービス到達も同経路で可能。

**Fix:** スキーマと fetch helper の二重防御で Firebase Storage ホストのみ許可。

```ts
// og-payload.ts
const BG_IMAGE_URL_HOST_ALLOWLIST = new Set([
  "firebasestorage.googleapis.com",
  "storage.googleapis.com", // 将来の v2 download URL 形式に備える（任意）
]);

bgImageUrl: z.string()
  .url()
  .min(1)
  .max(BG_IMAGE_URL_MAX)
  .refine(
    (u) => {
      try {
        const parsed = new URL(u);
        return parsed.protocol === "https:" &&
          BG_IMAGE_URL_HOST_ALLOWLIST.has(parsed.hostname);
      } catch {
        return false;
      }
    },
    { message: "bgImageUrl must be a Firebase Storage HTTPS URL" },
  )
  .optional(),
```

```ts
// og-image-fetch.ts — defense-in-depth で fetch 直前にも検証
const BG_IMAGE_URL_HOST_ALLOWLIST = new Set([
  "firebasestorage.googleapis.com",
  "storage.googleapis.com",
]);

export async function fetchAsDataUri(url: string, signal?: AbortSignal): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError("背景画像 URL の形式が不正です", "og/bg-fetch-failed");
  }
  if (parsed.protocol !== "https:" || !BG_IMAGE_URL_HOST_ALLOWLIST.has(parsed.hostname)) {
    throw new AppError("背景画像 URL のホストが許可されていません", "og/bg-fetch-failed");
  }
  // 以降は既存処理
}
```

### HIGH

#### F-2: タイムアウト・サイズ上限なし → DoS / リソース枯渇

**ファイル:** [src/app/api/og/_lib/og-image-fetch.ts](../../../src/app/api/og/_lib/og-image-fetch.ts) 行 19, 26（`fetch` / `res.arrayBuffer()`）

**Exploit:**
低速 / 巨大レスポンスを返す URL を `bgImageUrl` に渡すと、`fetch` も `res.arrayBuffer()` もタイムアウト・サイズ制限がないため Vercel サーバーレス関数の最大実行時間（60s）まで占有する。並列大量送信で他の API ルートのコールドスタートにも影響。Storage rule で本来 1MB 上限のはずだが、F-1 修正後でも Storage 側の制限と OG ルート側の防御は別レイヤーで持つべき。

**Fix:** `AbortSignal.timeout` + `Content-Length` チェック + 読込後の size 再確認。

```ts
const FETCH_TIMEOUT_MS = 8_000;
const MAX_BYTES = 2 * 1024 * 1024; // 1MB Storage rule に対し 2x の安全幅

export async function fetchAsDataUri(url: string, signal?: AbortSignal): Promise<string> {
  // ...F-1 のホスト検証 ...

  const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const mergedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  const res = await fetch(url, { signal: mergedSignal });
  if (!res.ok) {
    throw new AppError(/* ... */);
  }
  const contentLength = Number(res.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BYTES) {
    throw new AppError("背景画像サイズが上限を超えています", "og/bg-fetch-failed");
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) {
    throw new AppError("背景画像サイズが上限を超えています", "og/bg-fetch-failed");
  }
  // ...
}
```

### MEDIUM

#### F-3: Content-Type ホワイトリスト未実装

**ファイル:** [src/app/api/og/_lib/og-image-fetch.ts](../../../src/app/api/og/_lib/og-image-fetch.ts) 行 25

`res.headers.get("content-type") ?? "image/jpeg"` を無検証で data URI に乗せている。F-1 修正後は Firebase Storage 経由に限定されるが、運営者が Storage Console から手動アップロードして `application/octet-stream` 等の content-type が混入するケースは残る。

**Fix:** `["image/jpeg", "image/png", "image/webp"]` ホワイトリストで検証し、それ以外は AppError で reject。

#### F-4: `CardBackgroundCard.tsx` の ObjectURL 二重 revoke

**ファイル:** [src/app/groups/[gid]/_components/CardBackgroundCard.tsx](../../../src/app/groups/[gid]/_components/CardBackgroundCard.tsx) 行 96-104, 131-135, 110-117

`useEffect([previewUrl])` の cleanup と、`setPreviewUrl((prev) => { URL.revokeObjectURL(prev); ... })` updater が同じ URL を二重に revoke する。仕様上 no-op だが意図が読みにくく、将来ブラウザ厳格化での潜在バグ。

**Fix:** cleanup-only に統一する（updater 内の revoke を削除し useEffect cleanup だけに任せる）か、updater のみで管理し useEffect を削除する。Plan で「cleanup で revoke」と書いた通り、updater 側を削るのが整合的。

#### F-5: `live-client.tsx` が `buildWinnerShareInputs` を経由せず URL を inline 構築

**ファイル:** [src/app/tournaments/[tid]/live/live-client.tsx](../../../src/app/tournaments/[tid]/live/live-client.tsx) 行 230-250

`ShareCardButton` 向け URL を `buildWinnerCardUrl` + 直接 spread で組み立てており、同画面の `WinnerCardDownloadButton`（`buildWinnerShareInputs` 経由）と 2 系統に分裂している。`dashboard-client.tsx` は集約済み。`cardBackgroundQueryFields` を将来変えると share / DL でファイル名や URL がズレるリスク。

**Fix:** dashboard と同様に `buildWinnerShareInputs(tid, { ..., cardBackground: tournamentGroup?.winnerCardBackground ?? null })` を 1 回呼んで `{ url, filenameStem }` を両ボタンに渡す。

### LOW

#### F-6: `og-image-fetch.ts` のネットワークエラー伝搬が `AppError` ラップ規約に未対応

**ファイル:** [src/app/api/og/_lib/og-image-fetch.ts](../../../src/app/api/og/_lib/og-image-fetch.ts) 全体

`fetch` 自身が reject した場合（network down / DNS failure）は生の `Error` がそのまま throw され、route 側の `getErrorCode(e)` で `"unknown"` に倒れる。[error-logging.md](../../../.claude/rules/error-logging.md) は外部 SDK の生 Error を `AppError.from` でラップすることを要求している。

**Fix:** 全体を `try/catch` で囲み、network 系も `AppError.from(e, "og/bg-fetch-failed", ...)` でラップする。テストもラップ後の `code` を assert する形に更新。

#### F-7: `window.confirm` がプロジェクトの shadcn `<AlertDialog>` パターンと不一致

**ファイル:** [src/app/groups/[gid]/_components/CardBackgroundCard.tsx](../../../src/app/groups/[gid]/_components/CardBackgroundCard.tsx) 行 233

他の破壊的操作（`LeaveDeleteDialogs` 等）は shadcn の `<AlertDialog>` を使用している。`window.confirm` はテストで `vi.spyOn(window, "confirm")` が必要、SSR では未定義のためガードが必要、E2E では Playwright の dialog handler が必須、と外部要因が増える。

**Fix:** shadcn `<AlertDialog>` で確認ダイアログを実装するか、A.3 で UI 体系を揃える際の TODO として保留。

#### F-8: CDN キャッシュポイズニング（F-1 修正で実質的に解決）

**ファイル:** OG ルート両方の `CACHE_CONTROL`

F-1 で host allowlist が導入されれば、攻撃者が任意 `bgImageUrl` を持つキャッシュエントリを汚染できなくなる。F-1 修正後の再評価不要。

## Validation Results

| Check                                | Result |
| ------------------------------------ | ------ |
| Type check (`tsc --noEmit`)          | Pass   |
| Lint (`next lint`)                   | Pass   |
| Tests (`vitest run`)                 | Pass — 80 files / 1331 tests（A.2 で +33 件） |
| Build (`next build`)                 | Pass   |
| Emulator rules: limits               | Pass — 14/14 |
| Emulator rules: card-background      | Pass — 11/11 |
| Emulator rules: storage              | Pass — 10/10 |

## Files Reviewed

新規（11）:
- `src/lib/utils/retry.ts` + `.test.ts`
- `src/lib/utils/image-resize.ts` + `.test.ts`
- `src/lib/firebase/repositories/cardBackgroundStorage.ts`
- `src/lib/services/card-background.ts` + `.test.ts`
- `src/app/api/og/_lib/og-image-fetch.ts` + `.test.ts`
- `src/app/groups/[gid]/_components/CardBackgroundCard.tsx` + `.test.tsx`
- `src/app/groups/[gid]/_components/WinnerCardBackgroundCard.tsx`
- `src/app/groups/[gid]/_components/SeasonCardBackgroundCard.tsx`

更新（13）:
- `src/app/api/og/_lib/og-payload.ts` + `.test.ts`
- `src/app/api/og/_lib/og-card-styles.ts`
- `src/app/api/og/winner/[tid]/route.tsx`
- `src/app/api/og/season/[gid]/route.tsx`
- `src/app/groups/[gid]/group-detail-client.tsx`
- `src/app/tournaments/[tid]/dashboard-client.tsx`
- `src/app/tournaments/[tid]/live/live-client.tsx`
- `src/components/tournament/WinnerCardDownloadButton.tsx`
- `src/components/group/SeasonTopCardDownloadButton.tsx`
- `src/app/groups/[gid]/season/season-ranking-client.tsx`
- `src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.tsx`
- `.claude/PRPs/05-post-launch-polish/prds/05-post-launch-polish.prd.md`

## 推奨対応順序

1. **F-1 / F-2 を同 commit で修正**（`og-image-fetch.ts` + `og-payload.ts` を 1 編集で対応）。テストも host allowlist の deny ケースと AppError code を追加。
2. **F-3** を続けて修正（同 helper 内）。
3. **F-4 / F-5** をクリーンアップ commit で対応。
4. **F-6** を `AppError` 規約準拠で対応。
5. **F-7** は A.3 polish phase に倒すことを提案（保留可）。
