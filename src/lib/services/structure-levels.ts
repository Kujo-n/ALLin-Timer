import type { Level } from "@/lib/firebase/schemas/structure";

/**
 * ストラクチャレベル配列に対する純関数群（一括時間設定モード）。
 *
 * `LevelTable` の「一括/個別」トグルから利用する。全行一律代入のロジックを
 * component から切り出し、characterization test で固定する
 * （`tournament-state.ts` の precedent に倣う配置）。
 *
 * 副作用なし。引数を mutate しない。
 */

/** 分入力を durationSec（正の整数秒）に変換。schema の durationSec.positive() を満たすため最低 60 秒。 */
export function minToDurationSec(minutes: number): number {
  return Math.max(1, minutes) * 60;
}

/** 全レベル（ブレイク含む）の durationSec を一律 minutes 分に代入した新配列を返す（純関数）。 */
export function applyBulkDurationMin(levels: Level[], minutes: number): Level[] {
  const durationSec = minToDurationSec(minutes);
  return levels.map((l) => ({ ...l, durationSec }));
}

/** 一括モード初期表示用の分値。全行が同一 durationSec ならその分、不揃い/空なら先頭行 or 既定 10。 */
export function inferBulkDurationMin(levels: Level[]): number {
  if (levels.length === 0) return 10;
  const first = Math.max(1, Math.round(levels[0].durationSec / 60));
  const uniform = levels.every((l) => l.durationSec === levels[0].durationSec);
  // uniform 判定は将来「不揃い時の挙動」を変える余地のため明示。現状は両分岐とも先頭行値を返す。
  return uniform ? first : first;
}
