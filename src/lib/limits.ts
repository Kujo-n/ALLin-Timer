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

/** 新規作成画面の `seatsPerTable` 既定値。NLH 標準。 */
export const DEFAULT_SEATS_PER_TABLE = 9;
