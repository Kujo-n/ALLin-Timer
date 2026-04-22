/**
 * Phase 4: シード可能な擬似乱数（mulberry32）。
 * `Math.random` だと engine の test が再現困難なため自前実装。
 * 32bit seed → [0, 1) の double を返す関数を返す。外部 dep を増やさないために自作。
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function rng(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 配列を seed-stable にシャッフル（Fisher-Yates）。元配列は破壊しない。 */
export function shuffle<T>(xs: readonly T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const arr = xs.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
