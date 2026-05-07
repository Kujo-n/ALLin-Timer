/**
 * Phase C Firestore Rules emulator validation for `defaultTableLabels` /
 * `tables/{n}.label` / `tables/{n}.color`.
 *
 * 起動方法（cwd = repo root、emulator は起動済みか firebase emulators:exec から起動）:
 *   firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e \
 *     "node scripts/test-rules-table-labels.mjs"
 *
 * 実装方針:
 *   - REST 直叩き（test-rules-default-seats.mjs / test-rules-finished-count.mjs と同方針）。
 *   - HTTP 200 系 = allow、403 = deny として assert。
 *   - tables doc は tournaments 配下の subcollection のため、validator 内で先に
 *     tournament を seed してから tables/{tableId} を扱う。
 */

const PROJECT_ID = "allin-pokertimer-e2e";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

const AUTH_BASE = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1`;
const FS_BASE = `http://${FS_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const API_KEY = "fake-api-key";

const results = [];

async function signUpOrIn(email, password) {
  const sup = await fetch(`${AUTH_BASE}/accounts:signUp?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (sup.ok) {
    const j = await sup.json();
    return { uid: j.localId, idToken: j.idToken };
  }
  const sin = await fetch(
    `${AUTH_BASE}/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const j = await sin.json();
  if (!sin.ok) throw new Error(`auth: ${JSON.stringify(j)}`);
  return { uid: j.localId, idToken: j.idToken };
}

function tv(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    if (Number.isInteger(v)) return { integerValue: String(v) };
    return { doubleValue: v };
  }
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(tv) } };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === "object") {
    const fields = {};
    for (const [k, x] of Object.entries(v)) fields[k] = tv(x);
    return { mapValue: { fields } };
  }
  throw new Error(`unsupported value type: ${typeof v}`);
}
function fields(obj) {
  const o = {};
  for (const [k, v] of Object.entries(obj)) o[k] = tv(v);
  return o;
}

async function patchDoc(idToken, path, data) {
  const mask = Object.keys(data)
    .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join("&");
  const url = `${FS_BASE}/${path}?${mask}`;
  return fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ fields: fields(data) }),
  });
}

async function createDoc(idToken, collection, docId, data) {
  const url = `${FS_BASE}/${collection}?documentId=${encodeURIComponent(docId)}`;
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ fields: fields(data) }),
  });
}

async function expectAllow(label, fn) {
  const r = await fn();
  if (r.ok) {
    results.push({ label, status: "PASS (allow)" });
  } else {
    const body = await r.text();
    results.push({
      label,
      status: `FAIL (expected allow, got ${r.status}): ${body.slice(0, 200)}`,
    });
  }
}
async function expectDeny(label, fn) {
  const r = await fn();
  if (r.status === 403) {
    results.push({ label, status: "PASS (deny 403)" });
  } else if (r.ok) {
    results.push({ label, status: `FAIL (expected deny, got ${r.status})` });
  } else {
    const body = await r.text();
    results.push({
      label,
      status: `FAIL (expected 403, got ${r.status}): ${body.slice(0, 200)}`,
    });
  }
}

async function main() {
  const owner = await signUpOrIn("owner-tl@test.local", "passw0rd");
  const org = await signUpOrIn("organizer-tl@test.local", "passw0rd");
  const member = await signUpOrIn("member-tl@test.local", "passw0rd");

  console.log(
    `uids:  owner=${owner.uid.slice(0, 6)}  org=${org.uid.slice(0, 6)}  member=${member.uid.slice(0, 6)}`,
  );

  // owner として group を seed
  const gid = `g-rules-tl-${Date.now()}`;
  const seedGroup = await createDoc(owner.idToken, "groups", gid, {
    name: "Test Group TL",
    ownerUids: [owner.uid],
    organizerUids: [owner.uid],
    memberUids: [owner.uid],
    memberDisplayNames: { [owner.uid]: "Owner" },
    audioSettings: {
      enabled: true,
      levelUpSoundId: "default:blind-up",
      winnerSoundId: "default:victory-chime",
      volume: 0.7,
    },
    finishedTournamentCount: 0,
    defaultSeatsPerTable: 8,
    defaultTableLabels: [],
    createdAt: new Date(),
    joinCodeId: null,
  });
  if (!seedGroup.ok) {
    const body = await seedGroup.text();
    throw new Error(`seed group failed: ${seedGroup.status} ${body}`);
  }

  // owner full-update branch で member / organizer を拡張
  const expand = await patchDoc(owner.idToken, `groups/${gid}`, {
    memberUids: [owner.uid, org.uid, member.uid],
    organizerUids: [owner.uid, org.uid],
    memberDisplayNames: {
      [owner.uid]: "Owner",
      [org.uid]: "Org",
      [member.uid]: "Member",
    },
  });
  if (!expand.ok) {
    const body = await expand.text();
    throw new Error(`seed expand failed: ${expand.status} ${body}`);
  }

  // tournament を seed（tables の親 doc 用）
  const tid = `t-rules-tl-${Date.now()}`;
  const seedTournament = await createDoc(owner.idToken, "tournaments", tid, {
    groupId: gid,
    createdByUid: owner.uid,
    name: "Test Tournament TL",
    structureSnapshot: {
      name: "Default",
      initialStack: 10000,
      rebuyStack: null,
      addOnStack: null,
      lateEntryDeadlineLevel: 6,
      levels: [
        {
          level: 1,
          sb: 25,
          bb: 50,
          ante: 0,
          durationSec: 600,
          isBreak: false,
        },
      ],
    },
    state: "setup",
    startedAt: null,
    levelStartedAt: null,
    pausedAt: null,
    pausedAccumMs: 0,
    finishedAt: null,
    currentLevel: 0,
    lateEntryDeadlineLevel: 6,
    seatsPerTable: 8,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  if (!seedTournament.ok) {
    const body = await seedTournament.text();
    throw new Error(`seed tournament failed: ${seedTournament.status} ${body}`);
  }

  // tables/{1} を organizer が seed（rule の create branch を通す）
  const seedTable = await createDoc(
    org.idToken,
    `tournaments/${tid}/tables`,
    "1",
    {
      tableNum: 1,
      isBroken: false,
      createdAt: new Date(),
      label: null,
      color: null,
    },
  );
  if (!seedTable.ok) {
    const body = await seedTable.text();
    throw new Error(`seed tables/1 failed: ${seedTable.status} ${body}`);
  }

  // ────────────────────────────────────────────────
  // groups.defaultTableLabels
  // ────────────────────────────────────────────────

  // 02-02 改修以降は labels と colors を atomic に書く前提のため、
  // 各ケースで両方を同時に PATCH する。
  //
  // (1) organizer が defaultTableLabels + defaultTableColors を 2 件セット — allow
  await expectAllow(
    "(1) organizer set defaultTableLabels=['赤','青'] + colors=[red,blue]",
    () =>
      patchDoc(org.idToken, `groups/${gid}`, {
        defaultTableLabels: ["赤", "青"],
        defaultTableColors: ["#ef4444", "#3b82f6"],
      }),
  );

  // (2) organizer が両方を空配列にリセット — allow
  await expectAllow("(2) organizer set both = []", () =>
    patchDoc(org.idToken, `groups/${gid}`, {
      defaultTableLabels: [],
      defaultTableColors: [],
    }),
  );

  // (3) labels 7 件（MAX_TABLES=6 超過）— deny
  await expectDeny(
    "(3) organizer set 7 labels (deny: size > MAX_TABLES)",
    () =>
      patchDoc(org.idToken, `groups/${gid}`, {
        defaultTableLabels: ["a", "b", "c", "d", "e", "f", "g"],
        defaultTableColors: [null, null, null, null, null, null, null],
      }),
  );

  // (4) colors 7 件（MAX_TABLES=6 超過）— deny
  await expectDeny(
    "(4) organizer set 7 colors (deny: size > MAX_TABLES)",
    () =>
      patchDoc(org.idToken, `groups/${gid}`, {
        defaultTableLabels: ["a", "b", "c", "d", "e", "f"],
        defaultTableColors: [
          "#ef4444",
          "#ef4444",
          "#ef4444",
          "#ef4444",
          "#ef4444",
          "#ef4444",
          "#ef4444",
        ],
      }),
  );

  // (5) defaultTableLabels + name の同時変更 — deny（affectedKeys 違反）
  await expectDeny(
    "(5) organizer set labels + name (deny: affectedKeys)",
    () =>
      patchDoc(org.idToken, `groups/${gid}`, {
        defaultTableLabels: ["赤"],
        defaultTableColors: [null],
        name: "Hacked",
      }),
  );

  // (6) labels 単独 update — allow（rule の affectedKeys は subset 判定 hasOnly のため、
  //     labels のみ / colors のみの書換も rule 上は許容される）。labels と colors の長さ整合は
  //     service-side invariant として `setDefaultTableSettings` が enforce する。
  //     本ケースは「rule が atomic 要求していないこと」を明示する確認用。
  await expectAllow(
    "(6) organizer set labels only (allow: subset of [labels, colors])",
    () =>
      patchDoc(org.idToken, `groups/${gid}`, {
        defaultTableLabels: ["solo"],
      }),
  );

  // (7) member による書換 — deny（not organizer）
  await expectDeny(
    "(7) member set defaultTableSettings (deny: not organizer)",
    () =>
      patchDoc(member.idToken, `groups/${gid}`, {
        defaultTableLabels: ["x"],
        defaultTableColors: [null],
      }),
  );

  // ────────────────────────────────────────────────
  // tables/{n}.label / .color
  // ────────────────────────────────────────────────

  // (6) organizer が label='赤卓' を update — allow
  await expectAllow("(6) organizer update tables/1 label='赤卓'", () =>
    patchDoc(org.idToken, `tournaments/${tid}/tables/1`, {
      label: "赤卓",
      color: null,
    }),
  );

  // (7) organizer が color='#FF0000' に更新 — allow
  await expectAllow("(7) organizer update tables/1 color='#FF0000'", () =>
    patchDoc(org.idToken, `tournaments/${tid}/tables/1`, {
      label: "赤卓",
      color: "#FF0000",
    }),
  );

  // (8) organizer が小文字 hex color='#abcdef' — allow（regex は大文字小文字許容）
  await expectAllow("(8) organizer update color='#abcdef' (lowercase hex)", () =>
    patchDoc(org.idToken, `tournaments/${tid}/tables/1`, {
      label: "赤卓",
      color: "#abcdef",
    }),
  );

  // (9) 11 文字の label — deny（size > TABLE_LABEL_MAX_LENGTH=10）
  await expectDeny(
    "(9) organizer label='あいうえおかきくけこさ' (deny: size > 10)",
    () =>
      patchDoc(org.idToken, `tournaments/${tid}/tables/1`, {
        label: "あいうえおかきくけこさ",
        color: null,
      }),
  );

  // (10) 不正な color hex — deny（regex 違反）
  await expectDeny("(10) organizer color='#GGGGGG' (deny: regex)", () =>
    patchDoc(org.idToken, `tournaments/${tid}/tables/1`, {
      label: null,
      color: "#GGGGGG",
    }),
  );

  // (11) member が label を update — deny
  await expectDeny("(11) member update label (deny: not organizer)", () =>
    patchDoc(member.idToken, `tournaments/${tid}/tables/1`, {
      label: "Hacked",
      color: null,
    }),
  );

  // (12) organizer が label + isBroken の同時変更 — deny（affectedKeys 違反）
  await expectDeny(
    "(12) organizer label + isBroken simultaneously (deny: affectedKeys)",
    () =>
      patchDoc(org.idToken, `tournaments/${tid}/tables/1`, {
        label: "緑卓",
        isBroken: true,
      }),
  );

  // (13) organizer が label を null にリセット — allow
  await expectAllow("(13) organizer reset label=null", () =>
    patchDoc(org.idToken, `tournaments/${tid}/tables/1`, {
      label: null,
      color: null,
    }),
  );

  // (14) organizer が isBroken を単独更新 — allow（label/color に触らない既存経路）
  await expectAllow("(14) organizer update isBroken alone", () =>
    patchDoc(org.idToken, `tournaments/${tid}/tables/1`, {
      isBroken: true,
    }),
  );

  // ────────────────────────────────────────────────
  console.log("\n=== Firestore Rules: defaultTableLabels + tables.label/color ===");
  for (const r of results) {
    const ok = r.status.startsWith("PASS");
    console.log(`  ${ok ? "[OK]  " : "[FAIL]"} ${r.label} — ${r.status}`);
  }
  const failed = results.filter((r) => !r.status.startsWith("PASS"));
  console.log(
    `\n${results.length - failed.length}/${results.length} passed. ${
      failed.length === 0 ? "ALL GREEN" : "FAILURES present"
    }`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
