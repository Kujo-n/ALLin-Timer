/**
 * Phase C: 卓カードのヘッダ / live 画面 / バランシング指示で「Table N」と「カスタム呼称」の
 * フォールバック表示を一元管理する純関数。
 *
 * 仕様:
 *   - `label` が trim 後 1 文字以上 → label をそのまま返す
 *   - それ以外（null / undefined / 空文字 / 空白のみ）→ `Table {tableNum}` フォールバック
 *
 * 旧 doc（label undefined）も同じフォールバックに揃える。schema 側で
 * `label.nullable().default(null)` を採用しているため通常は string | null だが、
 * 引数型は `optional` も受け付けて呼出側の互換性を保つ。
 */
export function formatTableLabel(table: {
  tableNum: number;
  label?: string | null;
}): string {
  const trimmed = table.label?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : `Table ${table.tableNum}`;
}
