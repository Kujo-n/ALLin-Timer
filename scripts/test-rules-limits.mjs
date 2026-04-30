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
 *   - players.tableNum: >= 1 / <= MAX_TABLES (6)
 *   - players.seatNum:  >= 1 / <= MAX_SEATS_PER_TABLE (10)
 *   - groups.defaultSeatsPerTable: >= MIN_SEATS_PER_TABLE (2) / <= MAX_SEATS_PER_TABLE (10)
 *
 * Cloud Firestore Security Rules には const 機構がないため、上記の数値は
 * `firestore.rules` 内に直接書かれる。本スクリプトはそれらを正規表現で抽出し
 * 期待値と突き合わせる。drift（rules 側だけ更新／schema 側だけ更新）を CI で検出する。
 *
 * P2-1 で `src/lib/limits.ts` に集約された後は、本スクリプトの EXPECTED を
 * limits.ts 由来に切替える（同じ数値の二重宣言を排除）。本 commit 時点では
 * limits.ts がまだ存在しないため、EXPECTED をハードコードして先行投入する。
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

// P2-1 で limits.ts を集約したらこれを置換する。
const EXPECTED = {
  MIN_SEATS_PER_TABLE: 2,
  MAX_SEATS_PER_TABLE: 10,
  MAX_TABLES: 6,
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
  const matches = [...rulesText.matchAll(re)];
  if (matches.length === 0) return null;
  // 同じ field に対して同じ op が複数行ある場合、すべての値が同一であることを要求。
  const values = new Set(matches.map((m) => Number(m[1])));
  if (values.size > 1) {
    return { conflict: [...values] };
  }
  return { value: matches[0][1] };
}

const failures = [];
for (const c of checks) {
  const found = findBound(c.field, c.op);
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
  console.log(`[OK]   ${c.label} (${actual})`);
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
