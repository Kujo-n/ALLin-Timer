import type { PlayerDoc } from "@/lib/firebase/schemas/player";

/**
 * 「同じ卓に座っている他の active プレイヤー」の ID 集合を計算する pure helper。
 *
 * Phase 5.x で dashboard の SeatingBoard / PlayerList の onTogglePd handler 内に
 * 同形の filter が散在していたため、3 callsite の DRY 化と PD 制約の filter ロジックを
 * 1 箇所に集約する目的で導入。
 *
 * 引数:
 *   - player: 起点となるプレイヤー（自身は結果から除外）
 *   - allPlayers: 全 player snapshot
 *
 * 戻り値:
 *   - player.tableNum が null（未配席）なら空配列
 *   - それ以外は同卓の他 active player の ID 配列（順序は allPlayers の順）
 *
 * busted は除外する（席は解放されている前提のため）。
 */
export function getSameTableActiveOtherIds(
  player: PlayerDoc,
  allPlayers: readonly PlayerDoc[],
): string[] {
  if (player.tableNum === null) return [];
  return allPlayers
    .filter(
      (q) =>
        q.id !== player.id && !q.isBusted && q.tableNum === player.tableNum,
    )
    .map((q) => q.id);
}

/**
 * 「同じ卓に座っている他の active かつ PD（プレイングディーラー）プレイヤー」の ID 集合。
 *
 * `getSameTableActiveOtherIds` を更に PD 在籍者で絞った形。BustButton で同卓 PD の
 * isPlayingDealer=false への伝播対象を最小化する用途（同卓 1 PD 制約のため最大 1 件、
 * 9 席満卓で全員渡すと 8 件の余計な write が出るのを避ける）。
 */
export function getSameTableActivePdOtherIds(
  player: PlayerDoc,
  allPlayers: readonly PlayerDoc[],
): string[] {
  if (player.tableNum === null) return [];
  return allPlayers
    .filter(
      (q) =>
        q.id !== player.id &&
        !q.isBusted &&
        q.tableNum === player.tableNum &&
        q.isPlayingDealer,
    )
    .map((q) => q.id);
}
