import {
  collection,
  doc,
  type DocumentSnapshot,
  type Transaction,
} from "firebase/firestore";

import { AppError } from "@/lib/errors";
import { firestore } from "@/lib/firebase/client";
import { zodConverter } from "@/lib/firebase/converters";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import {
  tournamentBodySchema,
  type TournamentDoc,
} from "@/lib/firebase/schemas/tournament";

/**
 * `PlayerDoc` から `id` を除いた本体型。orchestrator の `playersRef` は
 * `withConverter(zodConverter(playerBodySchema, ...))` で `DocumentSnapshot<PlayerBody>`
 * を返すため、`playerFromSnap` の引数型もこちらに合わせる。`PlayerDoc` のままだと
 * spread した `data()` 戻り型に `id` が含まれていると推論され
 * 「`id` が重複指定」の TS2783 になる。
 */
type PlayerBody = Omit<PlayerDoc, "id">;

/**
 * tournaments collection ref を内部で組み立てる private helper。
 * orchestrator.ts / repositories/tournaments.ts で重複していた `tournamentRef`
 * の実装と一致させる（converter 込み）。
 */
function tournamentDocRef(tid: string) {
  const col = collection(firestore, "tournaments").withConverter(
    zodConverter(tournamentBodySchema, "tournaments"),
  );
  return doc(col, tid);
}

/**
 * Phase 4 architect-refactor 後の Phase 5.x で `orchestrator.ts` に 6 箇所、
 * `repositories/tournaments.ts` に 4 箇所、合計 10 箇所で重複していた
 * 「tx 内の tournament 取得 + exists guard + userGroupIds による groupId 突合」
 * boilerplate を集約する pure helper。
 *
 * tx 内で必ず最初に呼ぶ:
 *   const t = await loadTournamentInTx(tx, tid, userGroupIds);
 *
 * 失敗パス（throw する AppError）:
 *   - tournament doc が存在しない → `firestore/not-found`
 *   - userGroupIds に t.groupId が含まれない → `firestore/permission-denied`
 *
 * 成功時は zod converter を経由して validate 済みの TournamentDoc を返す。
 * 競合 race / state guard / lastMovedAt guard は呼出側 tx で個別に書く想定
 * （本 helper は「tx 内に入る前提条件」だけを担う、KISS）。
 *
 * 注意: 最終防衛は Firestore Rules（`isOrganizer(resource.data.groupId)`）。
 *   client 側の userGroupIds 突合は早期失敗のための保険であり、rule を信頼する。
 */
export async function loadTournamentInTx(
  tx: Transaction,
  tid: string,
  userGroupIds: readonly string[],
): Promise<TournamentDoc> {
  const tSnap = await tx.get(tournamentDocRef(tid));
  if (!tSnap.exists()) {
    throw new AppError("not found", "firestore/not-found");
  }
  const t: TournamentDoc = { id: tSnap.id, ...tSnap.data() };
  if (!userGroupIds.includes(t.groupId)) {
    throw new AppError("not allowed", "firestore/permission-denied");
  }
  return t;
}

/**
 * Firestore snapshot から `{ id, ...data }` の PlayerDoc を復元する pure helper。
 *
 * orchestrator.ts 内で 11 箇所重複していた
 *   const fresh: PlayerDoc = { id: snap.id, ...snap.data() };
 * を集約。snap.exists() === false のときは null を返し、呼出側は通常 skip 経路に入る。
 *
 * 型注釈ヘルプ目的が中心で、行数削減は控えめ（11 → 11）だが、
 * caller のロジック密度が下がり race guard / state guard の意図が読みやすくなる。
 */
export function playerFromSnap(
  snap: DocumentSnapshot<PlayerBody>,
): PlayerDoc | null {
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/**
 * 席移動系 tx の race guard の判定結果。
 *   - `missing` … player doc が tx 内で存在しない（削除された）
 *   - `busted`  … tx 内で bust 済みを観測した
 *   - `moved`   … 現在の席が move の from と一致しない（他端末が先に動かした）
 *   - `race`    … `lastMovedAt` が呼出側 snapshot 時点の値と一致しない
 */
export type PlayerMoveGuardResult =
  | { ok: true; player: PlayerDoc }
  | { ok: false; reason: "missing" | "busted" | "moved" | "race" };

/**
 * 席移動 tx の「対象 player が snapshot 取得時から変化していないこと」を検査する pure 関数。
 *
 * architect-refactor 20260801 (finding-5) で導入。それ以前は orchestrator.ts の
 * `applySingleMove` / `applyCascadeMoves` / `applyTableBreak` の 3 箇所が、
 * 同一の 4 段ガード（missing → busted → moved → race）を skipReason の書式だけ変えて
 * 繰り返していた。席移動の競合制御は同時操作で席が二重占有され得る最も壊れやすい箇所で、
 * ガード段を追加・修正するときに 1 箇所でも漏らすと特定経路だけ race に穴が開く。
 *
 * tx 内 read（`tx.get`）は呼出側が行い、本関数は **取得済み snapshot を受け取る**。
 * cascade / tableBreak が Firestore の read-then-write 制約のために
 * 全 read を `Promise.all` で先に済ませてから検証ループに入る構造を保つため。
 *
 * skipReason の文字列（`"missing"` 単体か `"missing:{pid}"` か）は呼出側の責務。
 * 3 経路で書式が異なるため、本関数は列挙値だけを返す。
 */
export function checkPlayerMoveGuard(
  snap: DocumentSnapshot<PlayerBody>,
  from: { tableNum: number; seatNum: number },
  expectedLastMovedAtMs: number | null,
): PlayerMoveGuardResult {
  const fresh = playerFromSnap(snap);
  if (!fresh) return { ok: false, reason: "missing" };
  if (fresh.isBusted) return { ok: false, reason: "busted" };
  if (fresh.tableNum !== from.tableNum || fresh.seatNum !== from.seatNum) {
    return { ok: false, reason: "moved" };
  }
  const actualMs = fresh.lastMovedAt ? fresh.lastMovedAt.toMillis() : null;
  if (actualMs !== expectedLastMovedAtMs) return { ok: false, reason: "race" };
  return { ok: true, player: fresh };
}

/**
 * 呼出側 snapshot の player 配列から `lastMovedAt` のミリ秒を引く小さな helper。
 * `checkPlayerMoveGuard` の `expectedLastMovedAtMs` 引数を組み立てるために使う
 * （3 経路で同じ `players.find(...)?.lastMovedAt?.toMillis() ?? null` を書いていた）。
 */
export function expectedLastMovedAtMs(
  players: readonly PlayerDoc[],
  playerId: string,
): number | null {
  const expected = players.find((p) => p.id === playerId);
  return expected?.lastMovedAt ? expected.lastMovedAt.toMillis() : null;
}
