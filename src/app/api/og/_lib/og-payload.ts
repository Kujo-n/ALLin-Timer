import { z } from "zod";

import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/firebase/schemas/group";

/**
 * Phase B: OG image route の query 文字列 schema + URL 組立純関数。
 *
 *   - クライアント / サーバの両方で同じ schema を `parse` して入力検証する
 *   - サーバは route handler の入口で `safeParse` し、失敗時は 400 を返す
 *   - クライアントは `buildXxxCardUrl` 経由で URL を組み立てるため、文字列改竄を
 *     経由しないものは原則 schema 通りの値が渡る
 *   - 日付ラベルは「画像を保存」ボタンを押下した端末の TZ で format 済み文字列を
 *     渡す（`*Label`）。サーバ runtime の TZ に依存しない設計
 */

/** tournament.name は schema 上 max 制約がないが、画像の見栄えと URL 長で実用 cap。 */
const TOURNAMENT_NAME_MAX = 60;
/** group.name の zod max と一致させる。 */
const SEASON_GROUP_NAME_MAX = 60;
/** 1 トーナメント当たりの最大参加人数 = MAX_TABLES (6) × MAX_SEATS_PER_TABLE (10) = 60。 */
const MAX_PARTICIPANTS = 60;
/** 累計ポイントの実用上限。1 シーズン 99999pt は越えない（基本値 10pt × 1000+ 試合）。 */
const MAX_TOTAL_POINTS = 99999;
/** 端末 TZ で format 済み日付ラベルの最大長（"2026年5月7日" / "2026/5/7" 等を許容）。 */
const LABEL_MAX = 30;
/** filename stem（拡張子なし）の最大長。Content-Disposition 用に sanitize 後の値。 */
const FILENAME_STEM_MAX = 60;

export const WINNER_CARD_QUERY_SCHEMA = z.object({
  winnerName: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH),
  tournamentName: z.string().min(1).max(TOURNAMENT_NAME_MAX),
  participants: z.coerce.number().int().min(1).max(MAX_PARTICIPANTS),
  /** 端末 TZ で format 済み日付（例: "2026/5/7"）。 */
  finishedAtLabel: z.string().min(1).max(LABEL_MAX),
  /** Content-Disposition 用 filename stem。任意、未指定なら "card"。 */
  filename: z.string().min(1).max(FILENAME_STEM_MAX).optional(),
});
export type WinnerCardQuery = z.infer<typeof WINNER_CARD_QUERY_SCHEMA>;

export const SEASON_CARD_QUERY_SCHEMA = z.object({
  groupName: z.string().min(1).max(SEASON_GROUP_NAME_MAX),
  /** 端末 TZ で format 済み日付ラベル。null = 未設定（シーズン未開始 group）。 */
  seasonStartDateLabel: z.string().min(1).max(LABEL_MAX).nullable(),
  top1Name: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH),
  top1Points: z.coerce.number().nonnegative().max(MAX_TOTAL_POINTS),
  top2Name: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH).optional(),
  top2Points: z.coerce.number().nonnegative().max(MAX_TOTAL_POINTS).optional(),
  top3Name: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH).optional(),
  top3Points: z.coerce.number().nonnegative().max(MAX_TOTAL_POINTS).optional(),
  filename: z.string().min(1).max(FILENAME_STEM_MAX).optional(),
});
export type SeasonCardQuery = z.infer<typeof SEASON_CARD_QUERY_SCHEMA>;

/**
 * URLSearchParams から SEASON_CARD_QUERY_SCHEMA に合わせた input を組み立てる。
 *
 * `seasonStartDateLabel` は「文字列キーが存在しない」場合を null として復元する
 * （URL の null 表現は key 省略で行う規約）。
 */
export function readSeasonCardQuery(
  sp: URLSearchParams,
): Record<string, string | null | undefined> {
  const obj: Record<string, string | null | undefined> = {};
  for (const [k, v] of sp.entries()) {
    obj[k] = v;
  }
  if (!sp.has("seasonStartDateLabel")) {
    obj.seasonStartDateLabel = null;
  }
  return obj;
}

export function buildWinnerCardUrl(tid: string, q: WinnerCardQuery): string {
  const sp = new URLSearchParams({
    winnerName: q.winnerName,
    tournamentName: q.tournamentName,
    participants: String(q.participants),
    finishedAtLabel: q.finishedAtLabel,
  });
  if (q.filename !== undefined) sp.set("filename", q.filename);
  return `/api/og/winner/${encodeURIComponent(tid)}?${sp.toString()}`;
}

export function buildSeasonCardUrl(gid: string, q: SeasonCardQuery): string {
  const sp = new URLSearchParams({
    groupName: q.groupName,
    top1Name: q.top1Name,
    top1Points: String(q.top1Points),
  });
  if (q.seasonStartDateLabel !== null) {
    sp.set("seasonStartDateLabel", q.seasonStartDateLabel);
  }
  if (q.top2Name !== undefined && q.top2Points !== undefined) {
    sp.set("top2Name", q.top2Name);
    sp.set("top2Points", String(q.top2Points));
  }
  if (q.top3Name !== undefined && q.top3Points !== undefined) {
    sp.set("top3Name", q.top3Name);
    sp.set("top3Points", String(q.top3Points));
  }
  if (q.filename !== undefined) sp.set("filename", q.filename);
  return `/api/og/season/${encodeURIComponent(gid)}?${sp.toString()}`;
}

/**
 * filename を ASCII 安全文字（英数 + ハイフン + アンダースコア）に sanitize する。
 *
 *   - 日本語は Safari 等で Content-Disposition の filename* 拡張に依存し挙動が割れる
 *   - Phase B では英数のみに固定し、長過ぎる場合は 40 字で切り詰める
 *   - 結果として「わからない名前」にならないよう、空文字になるなら "card" にフォールバック
 */
export function sanitizeFilename(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, "_").replace(/_+/g, "_");
  const trimmed = cleaned.replace(/^_+|_+$/g, "").slice(0, 40);
  return trimmed.length > 0 ? trimmed : "card";
}

/**
 * Date を端末 TZ で `YYYY-MM-DD` 形式に format する。filename の datePart 用。
 *
 * `sv-SE` ロケールは ISO 8601 同形式（zero-pad 済み）を返すので、ASCII safe な
 * filename component として安全に使える。`Date.toLocaleDateString("sv-SE")` は
 * **端末 TZ** で評価されるため、サーバ runtime TZ に依存しない。
 */
export function formatDateForFilename(d: Date): string {
  return d.toLocaleDateString("sv-SE");
}

/**
 * Date を「画像内に表示する日本語ラベル」用に format する（端末 TZ）。
 *
 * 例: 2026-05-07 12:00 JST → "2026/5/7"。`finishedAtLabel` / `seasonStartDateLabel`
 * の値生成に使う。サーバ runtime TZ に影響されないよう必ずクライアントで呼ぶ。
 */
export function formatDateForLabel(d: Date): string {
  return d.toLocaleDateString("ja-JP");
}
