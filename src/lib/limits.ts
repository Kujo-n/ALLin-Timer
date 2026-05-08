/**
 * アプリ全体で参照する数値リミットの単一真実源。
 *
 * Phase 4 architect-refactor (P2-1) で、`src/lib/services/seating/engine.ts` の
 * `MAX_TABLES`、`schemas/tournament.ts` の `seatsPerTable.min(2).max(10)`、
 * `schemas/group.ts` の `defaultSeatsPerTable.min(2).max(10)`、
 * `service/group.ts` / `repositories/groups.ts` / `TournamentForm.tsx` /
 * `group-detail-client.tsx` に分散していた `2 / 10 / 6` リテラルを集約する。
 *
 * `firestore.rules` は Cloud Firestore Security Rules の言語仕様上 const 機構が
 * 無いため、`tableNum <= 6` / `seatNum <= 10` / `defaultSeatsPerTable >= 2 / <= 10`
 * のリテラルを直接書く。drift 検出は [scripts/test-rules-limits.mjs](../../scripts/test-rules-limits.mjs)
 * （`npm run test:rules-limits`）で機械的に行う。値を変更する場合は本ファイルと
 * `firestore.rules` を同時に更新し、必ず `npm run test:rules-limits` を走らせて確認すること。
 */

/** 1 Table の最小席数。NLH ヘッズアップ運用も考慮して 2 を下限とする。 */
export const MIN_SEATS_PER_TABLE = 2;

/** 1 Table の最大席数。NLH 標準は 9 席、リミット卓で 10 席まで。 */
export const MAX_SEATS_PER_TABLE = 10;

/** 同時開催卓数の上限。TDA 2015 のバランシング許容差（6 卓以下: 1 / 7 卓以上: 2）境界。 */
export const MAX_TABLES = 6;

/**
 * 新規作成画面の `seatsPerTable` 既定値。
 *
 * Phase A (シーズン戦績基盤): 9 → 8 に変更。シーズンポイント計算式の baseline=8 と
 * 整合させるため。既存 group の保存値は zod default が新規 hydrate 時のみ適用される
 * ため影響なし。
 */
export const DEFAULT_SEATS_PER_TABLE = 8;

/**
 * Phase A: シーズンポイント計算の基準配列（1 位から N 位までの base ポイント）。
 *
 * `calcSeasonPoints(rank, totalParticipants)` は以下の式で算出する:
 *   `base[rank-1] × sqrt(totalParticipants / SEASON_POINTS_BASELINE_PARTICIPANTS)`
 *
 * 配列長を超える順位は 0pt。読み取り専用の参照定数。Phase E で運営者カスタマイズ可能化
 * （`groups/{gid}.seasonPointsRule.base`）。本配列は「カスタム rule 不在時の既定値」として参照する。
 */
export const SEASON_POINTS_BASE: readonly number[] = [10, 7, 5, 3, 1, 1, 1, 1, 1];

/**
 * Phase E: シーズンポイント計算の `base` 配列長の上限。
 *
 * `seasonPointsRule.base` は最大 9 件（1 位〜9 位までを定義可能）。
 * `SEASON_POINTS_BASE.length` と機械的に一致させる（drift script で検査）。
 * `firestore.rules` の `seasonPointsRule.base.size() <= 9` リテラルとも連動。
 *
 * DRIFT WARNING: 値を変更する場合は本ファイル / `firestore.rules` /
 * `scripts/test-rules-limits.mjs` の EXPECTED を同時に更新すること。
 */
export const SEASON_POINTS_BASE_MAX_LENGTH = 9;

/**
 * Phase A: シーズンポイント計算の baseline 参加人数（= 8）。
 *
 * `DEFAULT_SEATS_PER_TABLE` と一致させる。NLH の標準的な単一卓運用での参加人数を
 * 「ポイント倍率 1.0」に対応付けた基準値。drift 検出は `scripts/test-rules-limits.mjs`。
 */
export const SEASON_POINTS_BASELINE_PARTICIPANTS = 8;

/**
 * Phase A: 順位 N 位までを「ファイナルテーブル進出」と見なす上限。
 * NLH 9 人卓に揃えて 9 位以内を FT 扱いとする。
 */
export const SEASON_FINAL_TABLE_THRESHOLD = 9;

/**
 * Phase 5.2: 1 レベルの最大 durationSec。値: 86400（= 24h）。
 *
 * 運営者が誤って `99999999` 等を入れて Firestore の int 上限まで膨らませ、
 * 進行中端末の数値計算（`durationSec * 1000` ms 換算など）で精度低下や
 * オーバーフローを起こすことを防ぐ。Phase 5.2 では rule 側で範囲制約を設けない
 * （`tournaments/{tid}` update は organizer 信頼経路）が、将来 Cloud Functions
 * 化する際の参照定数として残す。
 */
export const MAX_LEVEL_DURATION_SEC = 86400;

/**
 * Phase 5.3: 1 トーナメントの structureSnapshot.levels 配列の最大要素数。値: 50。
 *
 * 運営者が誤って append を連打して Firestore doc 1MiB 上限に近づくことを防ぐ。
 * 1 level ≈ 80B（zod schema の 5 数値 + 1 boolean）として 50 levels で約 4KB、
 * doc 全体でも 10KB 程度に収まり余裕がある。実運用は 30 内に収まる前提（NLH トーナメントの
 * 通常レベル数は 12〜25）で、50 は「異常系の防衛線」として設定する。
 *
 * Phase 5.3 では rule 側で範囲制約を設けない（`tournaments/{tid}` update は organizer 信頼経路、
 * `setLevelDurationSec` と同方針）。将来 Cloud Functions 化する際の参照定数として残す。
 */
export const MAX_LEVELS_PER_TOURNAMENT = 50;

/**
 * Phase 5.4: 1 回の clone 操作で新 tournament にコピーする player 件数の上限。値: 50。
 *
 * Firestore writeBatch の 500 ops 上限を大きく下回り、20 人 × 6 卓のサークル規模では
 * 通常 20〜30 件で十分。50 は「悪意・誤操作の防衛線」として設定する。
 *
 * 上限到達時は `clonePlayersFromTournament` が `tournament/clone-too-many` を throw し、
 * UI 側で「{N} 件中 {MAX} 件のみ選択してください」エラーを出す。Phase 5.4 では
 * rule 側で件数制約を設けない（writeBatch サイズを rule で表現できないため）。
 */
export const MAX_CLONE_PLAYERS = 50;

/**
 * Phase C: 卓のカスタム Table 名（`tables/{n}.label` および `groups/{gid}.defaultTableLabels[i]`）の
 * 最大文字数。スマートフォン 1 行に収まり、SeatingBoard / BalancingInstructionCard の
 * 卓カードヘッダで折り返さない値として 10 に設定。
 *
 * DRIFT WARNING: `firestore.rules` の以下リテラルと連動。同時に変更すること:
 *   - `tables/{n}.label.size() <= 10`
 *   - `groups/{gid}.defaultTableLabels[i]` の長さ強制は schema / service 側で行う
 *     (rule 言語仕様上、list 内 element の string 長制約は表現困難)
 *
 * drift 検出は `scripts/test-rules-limits.mjs`（`npm run test:rules-limits`）で機械的に行う。
 */
export const TABLE_LABEL_MAX_LENGTH = 10;
