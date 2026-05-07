/**
 * Phase C improvement (02-02): SeatingBoard 卓ヘッダの inline edit (TableLabelEditPopover) と
 * サークル詳細画面の Table 名デフォルト編集 (GroupDefaultTableLabelsCard) で共有するプリセット色定義。
 *
 * 卓マットの色（赤 / 青 / 緑 等）に対応し、運営者がプリセットから選択するだけで
 * 卓カードのヘッダ帯に反映される。値は `#RRGGBB` の hex 文字列で、Firestore schema の
 * `tables/{n}.color` および `groups/{gid}.defaultTableColors[i]` 双方の正規表現を満たす。
 */
export const TABLE_COLOR_PRESETS: ReadonlyArray<{
  readonly value: string;
  readonly name: string;
}> = [
  { value: "#ef4444", name: "赤" },
  { value: "#f97316", name: "橙" },
  { value: "#eab308", name: "黄" },
  { value: "#22c55e", name: "緑" },
  { value: "#06b6d4", name: "シアン" },
  { value: "#3b82f6", name: "青" },
  { value: "#8b5cf6", name: "紫" },
  { value: "#ec4899", name: "ピンク" },
  { value: "#64748b", name: "グレー" },
  { value: "#1f2937", name: "黒" },
];

/** 値がプリセットに含まれていれば true。詳細トグル展開判定で使う。 */
export function isPresetTableColor(value: string | null): boolean {
  if (value === null) return false;
  return TABLE_COLOR_PRESETS.some((p) => p.value === value);
}
