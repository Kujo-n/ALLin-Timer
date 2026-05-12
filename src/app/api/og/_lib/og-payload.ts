import { z } from "zod";

import { isAllowedBgImageUrl } from "@/app/api/og/_lib/og-image-fetch";
import {
  CARD_TEXT_THEMES,
  type CardBackground,
  DISPLAY_NAME_MAX_LENGTH,
} from "@/lib/firebase/schemas/group";
import { MAX_SEATS_PER_TABLE, MAX_TABLES } from "@/lib/limits";

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
/** group.name の zod max と一致させる（winner / season 共用）。 */
const GROUP_NAME_MAX = 60;
/**
 * 1 トーナメント当たりの最大参加人数 = `MAX_TABLES * MAX_SEATS_PER_TABLE`。
 * Phase A architect-refactor (T6) で `limits.ts` 連動化。値変更時は本所より limits.ts を
 * 真実源として参照する。
 */
const MAX_PARTICIPANTS = MAX_TABLES * MAX_SEATS_PER_TABLE;
/** 累計ポイントの実用上限。1 シーズン 99999pt は越えない（基本値 10pt × 1000+ 試合）。 */
const MAX_TOTAL_POINTS = 99999;
/** 端末 TZ で format 済み日付ラベルの最大長（"2026年5月7日" / "2026/5/7" 等を許容）。 */
const LABEL_MAX = 30;
/** filename stem（拡張子なし）の最大長。Content-Disposition 用に sanitize 後の値。 */
const FILENAME_STEM_MAX = 60;
/**
 * Phase A.2: 背景画像 URL の cap。Firebase Storage download URL は実測 ~400 字。
 * Vercel URL 全体は 8KB 程度まで許容されるが、安全側で 600 字に制限する。
 */
const BG_IMAGE_URL_MAX = 600;

/**
 * Phase A.2: 背景画像 URL の schema。
 *
 *   - `.url()` で形式検証
 *   - `.refine(isAllowedBgImageUrl)` で **https + Firebase Storage host allowlist** を強制（SSRF 防御）
 *
 * 単体定義として export しないのは、buildXxxCardUrl 側では信頼境界内（既に検証済の URL を再 set する経路）
 * のため re-refine が冗長なため。clients から発行された query は本 schema を通って validate される。
 */
const bgImageUrlSchema = z
  .string()
  .url()
  .min(1)
  .max(BG_IMAGE_URL_MAX)
  .refine((u) => isAllowedBgImageUrl(u), {
    message: "bgImageUrl must be an HTTPS Firebase Storage URL",
  });

export const WINNER_CARD_QUERY_SCHEMA = z.object({
  winnerName: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH),
  tournamentName: z.string().min(1).max(TOURNAMENT_NAME_MAX),
  participants: z.coerce.number().int().min(1).max(MAX_PARTICIPANTS),
  /** 端末 TZ で format 済み日付（例: "2026/5/7"）。 */
  finishedAtLabel: z.string().min(1).max(LABEL_MAX),
  /**
   * Phase A.4 footer-box: サークル名（footer box に出す）。
   * 旧クライアントからの URL 互換のため optional とする（未指定なら footer から省略）。
   */
  groupName: z.string().min(1).max(GROUP_NAME_MAX).optional(),
  /** Content-Disposition 用 filename stem。任意、未指定なら "card"。 */
  filename: z.string().min(1).max(FILENAME_STEM_MAX).optional(),
  /** Phase A.2: サークル設定済みの背景画像 URL（公開 / host allowlist 強制）。 */
  bgImageUrl: bgImageUrlSchema.optional(),
  /** Phase A.2: 背景画像時の foreground 色テーマ。 */
  bgTextTheme: z.enum(CARD_TEXT_THEMES).optional(),
});
export type WinnerCardQuery = z.infer<typeof WINNER_CARD_QUERY_SCHEMA>;

export const SEASON_CARD_QUERY_SCHEMA = z.object({
  groupName: z.string().min(1).max(GROUP_NAME_MAX),
  /** 端末 TZ で format 済み日付ラベル。null = 未設定（シーズン未開始 group）。 */
  seasonStartDateLabel: z.string().min(1).max(LABEL_MAX).nullable(),
  top1Name: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH),
  top1Points: z.coerce.number().nonnegative().max(MAX_TOTAL_POINTS),
  top2Name: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH).optional(),
  top2Points: z.coerce.number().nonnegative().max(MAX_TOTAL_POINTS).optional(),
  top3Name: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH).optional(),
  top3Points: z.coerce.number().nonnegative().max(MAX_TOTAL_POINTS).optional(),
  filename: z.string().min(1).max(FILENAME_STEM_MAX).optional(),
  /** Phase A.2: 背景画像 URL / theme。winner と同型（host allowlist 強制）。 */
  bgImageUrl: bgImageUrlSchema.optional(),
  bgTextTheme: z.enum(CARD_TEXT_THEMES).optional(),
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
  if (q.groupName !== undefined) sp.set("groupName", q.groupName);
  if (q.filename !== undefined) sp.set("filename", q.filename);
  if (q.bgImageUrl !== undefined) sp.set("bgImageUrl", q.bgImageUrl);
  if (q.bgTextTheme !== undefined) sp.set("bgTextTheme", q.bgTextTheme);
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
  if (q.bgImageUrl !== undefined) sp.set("bgImageUrl", q.bgImageUrl);
  if (q.bgTextTheme !== undefined) sp.set("bgTextTheme", q.bgTextTheme);
  return `/api/og/season/${encodeURIComponent(gid)}?${sp.toString()}`;
}

/**
 * Phase A.2: `CardBackground` ドキュメントを query パラメータに展開する純関数。
 *
 *   - `cardBackground` が null / undefined のとき、または `imageUrl` が null のときは
 *     `{}` を返す（URL に bgImageUrl / bgTextTheme key を出さない＝既存挙動と完全一致）。
 *   - `imageUrl` 非 null のときは 2 key を返す。`textTheme` は schema 上必須。
 */
export function cardBackgroundQueryFields(
  cardBackground: CardBackground | null | undefined,
): { bgImageUrl?: string; bgTextTheme?: "light" | "dark" } {
  if (!cardBackground || cardBackground.imageUrl == null) return {};
  return {
    bgImageUrl: cardBackground.imageUrl,
    bgTextTheme: cardBackground.textTheme,
  };
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

/**
 * Phase D follow-up: ShareCardButton と Download ボタンが共有する純関数。
 *
 * download / share 両経路で「同じ url / 同じ filenameStem」を返すことを担保する。
 * ここで集約することで、`tournamentName` のサニタイズや日付フォーマットの規約が
 * drift して share と download で別ファイルになる事故を防ぐ。
 */
export interface ShareCardInputs {
  /** OG image route の絶対パス（`/api/og/...?...` 形式 / same-origin）。 */
  url: string;
  /** Content-Disposition / `<a download>` 共通の filename stem（拡張子なし）。 */
  filenameStem: string;
}

export interface WinnerShareInputsParams {
  winnerName: string;
  tournamentName: string;
  participants: number;
  finishedAt: Date;
  /**
   * Phase A.4 footer-box: サークル名。footer ボックスに表示するため optional で受ける。
   * 既存呼出を壊さないため `undefined` を許容するが、新規呼出は必ず渡す方針。
   */
  groupName?: string;
  /** Phase A.2: サークル設定済みの優勝カード背景画像メタデータ（null / undefined のときは未設定）。 */
  cardBackground?: CardBackground | null;
}

export function buildWinnerShareInputs(
  tid: string,
  params: WinnerShareInputsParams,
): ShareCardInputs {
  const datePart = formatDateForFilename(params.finishedAt);
  const filenameStem = sanitizeFilename(
    `winner-${params.tournamentName}-${datePart}`,
  );
  const bg = cardBackgroundQueryFields(params.cardBackground);
  const url = buildWinnerCardUrl(tid, {
    winnerName: params.winnerName,
    tournamentName: params.tournamentName,
    participants: params.participants,
    finishedAtLabel: formatDateForLabel(params.finishedAt),
    filename: filenameStem,
    ...(params.groupName !== undefined ? { groupName: params.groupName } : {}),
    ...bg,
  });
  return { url, filenameStem };
}

/**
 * SeasonTopCard の入力に必要な group の最小フィールド。
 *
 * 呼出側は `GroupDoc` をそのまま渡せる（structural typing）。引数として narrow しておくことで
 * テスト fixture の構築コストを抑えつつ、将来 `GroupDoc` に無関係なフィールドが増えても
 * helper のシグネチャに波及しない。
 */
export interface SeasonShareInputsGroup {
  name: string;
  seasonStartDate: { toDate: () => Date } | null;
}

/** 同様に SeasonStatsDoc の必要フィールドだけに narrow した型。 */
export interface SeasonShareInputsStats {
  displayName: string;
  totalPoints: number;
}

/**
 * Phase A.2: `buildSeasonShareInputs` の optional 引数。互換性のため未渡しなら
 * 従来挙動を維持する。
 */
export interface SeasonShareInputsOptions {
  /** サークル設定済みのシーズン首位カード背景画像メタデータ。null / undefined で未設定。 */
  cardBackground?: CardBackground | null;
}

/**
 * stats が空配列の場合は null を返す（呼出側で render gating）。
 * top1〜top3 抽出は内部で行う（呼出側はソート済み配列を渡す）。
 */
export function buildSeasonShareInputs(
  gid: string,
  group: SeasonShareInputsGroup,
  stats: readonly SeasonShareInputsStats[],
  options?: SeasonShareInputsOptions,
): ShareCardInputs | null {
  if (stats.length === 0) return null;
  const top1 = stats[0];
  const top2 = stats.at(1);
  const top3 = stats.at(2);
  const startDate = group.seasonStartDate ? group.seasonStartDate.toDate() : null;
  const datePart = startDate ? formatDateForFilename(startDate) : "open";
  const filenameStem = sanitizeFilename(`season-${group.name}-${datePart}`);
  const bg = cardBackgroundQueryFields(options?.cardBackground);
  const url = buildSeasonCardUrl(gid, {
    groupName: group.name,
    seasonStartDateLabel: startDate ? formatDateForLabel(startDate) : null,
    top1Name: top1.displayName,
    top1Points: top1.totalPoints,
    top2Name: top2?.displayName,
    top2Points: top2?.totalPoints,
    top3Name: top3?.displayName,
    top3Points: top3?.totalPoints,
    filename: filenameStem,
    ...bg,
  });
  return { url, filenameStem };
}
