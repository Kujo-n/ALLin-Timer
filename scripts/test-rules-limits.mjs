/**
 * Phase 4 architect-refactor (P1-2) — `firestore.rules` 内のハードコード数値が
 * 期待値と一致しているかを静的に検査する。
 *
 * 起動方法（cwd = repo root）:
 *   node scripts/test-rules-limits.mjs
 *   # or
 *   npm run test:rules-limits
 *
 * 検査内容:
 *   - players.tableNum: >= 1 / <= MAX_TABLES
 *   - players.seatNum:  >= 1 / <= MAX_SEATS_PER_TABLE
 *   - groups.defaultSeatsPerTable: >= MIN_SEATS_PER_TABLE / <= MAX_SEATS_PER_TABLE
 *   - displayName 上限（<= DISPLAY_NAME_MAX_LENGTH）: 3 経路
 *     - groups.memberDisplayNames[uid] (self-add / self-key update)
 *     - structureTemplates.createdByDisplayName (create)
 *     - seasonStats.displayName (create / update)
 *
 * Cloud Firestore Security Rules には const 機構がないため、上記の数値は
 * `firestore.rules` 内に直接書かれる。本スクリプトはそれらを正規表現で抽出し、
 * `src/lib/limits.ts` ／ `src/lib/firebase/schemas/group.ts` の `export const NAME = N;`
 * 宣言から取った期待値と突き合わせる。drift（rules 側だけ更新／schema 側だけ更新）を
 * CI で検出する。
 *
 * Firestore emulator を起動しない静的パース検査のため、軽量で CI に組込みやすい
 * （emulator REST 検査は scripts/test-rules-default-seats.mjs / -finished-count.mjs を参照）。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const rulesPath = resolve(repoRoot, "firestore.rules");
const rulesText = readFileSync(rulesPath, "utf8");
const limitsPath = resolve(repoRoot, "src/lib/limits.ts");
const limitsText = readFileSync(limitsPath, "utf8");
const groupSchemaPath = resolve(repoRoot, "src/lib/firebase/schemas/group.ts");
const groupSchemaText = readFileSync(groupSchemaPath, "utf8");

/**
 * `export const NAME = NUMBER;` 形式の宣言を任意の TS テキストから抽出する。
 * 本スクリプトは TS を実行できないため、シンプルな正規表現で値だけ取り出す。
 * 対象ファイルのフォーマットが変わった場合は本関数も合わせて更新する。
 */
function parseConstFromText(text, name, sourceLabel) {
  const re = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*(\\d+)\\s*;`);
  const m = text.match(re);
  if (!m) {
    throw new Error(
      `parseConstFromText: '${name}' を ${sourceLabel} から抽出できません`,
    );
  }
  return Number(m[1]);
}

const EXPECTED = {
  MIN_SEATS_PER_TABLE: parseConstFromText(limitsText, "MIN_SEATS_PER_TABLE", "src/lib/limits.ts"),
  MAX_SEATS_PER_TABLE: parseConstFromText(limitsText, "MAX_SEATS_PER_TABLE", "src/lib/limits.ts"),
  MAX_TABLES: parseConstFromText(limitsText, "MAX_TABLES", "src/lib/limits.ts"),
  DISPLAY_NAME_MAX_LENGTH: parseConstFromText(
    groupSchemaText,
    "DISPLAY_NAME_MAX_LENGTH",
    "src/lib/firebase/schemas/group.ts",
  ),
};

const checks = [
  {
    label: "players.tableNum lower bound (>= 1)",
    field: "tableNum",
    op: ">=",
    expected: 1,
  },
  {
    label: "players.tableNum upper bound (<= MAX_TABLES)",
    field: "tableNum",
    op: "<=",
    expected: EXPECTED.MAX_TABLES,
  },
  {
    label: "players.seatNum lower bound (>= 1)",
    field: "seatNum",
    op: ">=",
    expected: 1,
  },
  {
    label: "players.seatNum upper bound (<= MAX_SEATS_PER_TABLE)",
    field: "seatNum",
    op: "<=",
    expected: EXPECTED.MAX_SEATS_PER_TABLE,
  },
  {
    label: "groups.defaultSeatsPerTable lower bound (>= MIN_SEATS_PER_TABLE)",
    field: "defaultSeatsPerTable",
    op: ">=",
    expected: EXPECTED.MIN_SEATS_PER_TABLE,
  },
  {
    label: "groups.defaultSeatsPerTable upper bound (<= MAX_SEATS_PER_TABLE)",
    field: "defaultSeatsPerTable",
    op: "<=",
    expected: EXPECTED.MAX_SEATS_PER_TABLE,
  },
  // L-2 (Phase A): displayName 上限の drift 検出。
  // 3 経路すべてで `<= DISPLAY_NAME_MAX_LENGTH` (= 15) と同期している必要がある。
  // self-add / self-key update の memberDisplayNames は同じ rule 内で 2 回登場するため、
  // findByPattern が「全 match の値が一致 == 1 種類」をまとめて検証する。
  {
    label: "groups.memberDisplayNames[uid] upper bound (<= DISPLAY_NAME_MAX_LENGTH)",
    pattern: /memberDisplayNames\[request\.auth\.uid\]\.size\(\)\s*<=\s*(\d+)/g,
    expected: EXPECTED.DISPLAY_NAME_MAX_LENGTH,
    minOccurrences: 2, // self-add / self-key update の 2 箇所
  },
  {
    label: "structureTemplates.createdByDisplayName upper bound (<= DISPLAY_NAME_MAX_LENGTH)",
    pattern: /createdByDisplayName\.size\(\)\s*<=\s*(\d+)/g,
    expected: EXPECTED.DISPLAY_NAME_MAX_LENGTH,
    minOccurrences: 1,
  },
  {
    // 大文字 D の `createdByDisplayName` / `memberDisplayNames` を巻き込まないよう
    // 行頭境界 `\b` 相当の lookbehind を仕込む（lhs は `.displayName` ぴったり）。
    label: "seasonStats.displayName upper bound (<= DISPLAY_NAME_MAX_LENGTH)",
    pattern: /(?<![A-Za-z])displayName\.size\(\)\s*<=\s*(\d+)/g,
    expected: EXPECTED.DISPLAY_NAME_MAX_LENGTH,
    minOccurrences: 1,
  },
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findBound(field, op) {
  // op は ">=" or "<=" のリテラル。escapeRegex で囲って正規表現メタ化を防ぐ。
  const re = new RegExp(
    `request\\.resource\\.data\\.${escapeRegex(field)}\\s*${escapeRegex(op)}\\s*(\\d+)`,
    "g",
  );
  return collectMatches(re);
}

/**
 * 任意の RegExp（capture group 1 が数値）を rulesText 全体から収集して
 * `{ value, count } | { conflict } | null` を返す共通関数。
 * displayName 上限のように `lhs.size() <= N` 形式が複数 lhs / 複数箇所に分散する
 * 検査で再利用する。
 */
function collectMatches(re) {
  const matches = [...rulesText.matchAll(re)];
  if (matches.length === 0) return null;
  // 同じパターンが複数行ある場合、すべての値が同一であることを要求。
  const values = new Set(matches.map((m) => Number(m[1])));
  if (values.size > 1) {
    return { conflict: [...values] };
  }
  return { value: matches[0][1], count: matches.length };
}

const failures = [];
for (const c of checks) {
  const found = c.pattern ? collectMatches(c.pattern) : findBound(c.field, c.op);
  if (!found) {
    failures.push(`[FAIL] ${c.label} — pattern not found in firestore.rules`);
    continue;
  }
  if (found.conflict) {
    failures.push(
      `[FAIL] ${c.label} — multiple distinct values found: [${found.conflict.join(", ")}]`,
    );
    continue;
  }
  const actual = Number(found.value);
  if (actual !== c.expected) {
    failures.push(
      `[FAIL] ${c.label} — expected ${c.expected}, got ${actual}`,
    );
    continue;
  }
  if (c.minOccurrences && found.count < c.minOccurrences) {
    failures.push(
      `[FAIL] ${c.label} — expected at least ${c.minOccurrences} occurrence(s), got ${found.count}`,
    );
    continue;
  }
  const occ = c.minOccurrences ? ` × ${found.count}` : "";
  console.log(`[OK]   ${c.label} (${actual}${occ})`);
}

if (failures.length > 0) {
  console.log("");
  for (const f of failures) console.log(f);
}

console.log(
  `\n${checks.length - failures.length}/${checks.length} passed. ${
    failures.length === 0 ? "ALL GREEN" : "FAILURES present"
  }`,
);
process.exit(failures.length === 0 ? 0 : 1);
