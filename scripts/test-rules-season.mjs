/**
 * Phase A Firestore Rules emulator validation for seasonStats / seasonHistory / seasonStartDate.
 *
 * 起動方法（cwd = repo root、emulator は起動済みか firebase emulators:exec から起動）:
 *   firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e \
 *     "node scripts/test-rules-season.mjs"
 *
 * 検証ケース:
 *   1. organizer が groups/{gid}.seasonStartDate を Timestamp で書換 → allow
 *   2. organizer が seasonStartDate + name を同時書換 → deny（affectedKeys 違反）
 *   3. member が seasonStartDate を書換 → deny
 *   4. organizer が seasonStats/{uid} を valid 値で create → allow
 *   5. organizer が seasonStats/{uid} を participations=-1 で create → deny
 *   6. organizer が seasonStats/{uid} の uid != docId で create → deny
 *   7. member が seasonStats/{uid} を read → allow
 *   8. 非メンバーが seasonStats/{uid} を read → deny（permission-denied）
 *   9. organizer が seasonStats/{uid} を delete → allow（reset 経路）
 *  10. organizer が seasonHistory/{seasonId} を valid 値で create → allow
 *  11. organizer が seasonHistory/{seasonId} の既存 doc を update → deny
 *  12. organizer が seasonHistory/{seasonId} を delete → deny
 *
 * 実装方針は scripts/test-rules-finished-count.mjs と同じ REST 直叩き方式。
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
  const sin = await fetch(`${AUTH_BASE}/accounts:signInWithPassword?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
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

async function getDocOnly(idToken, path) {
  const url = `${FS_BASE}/${path}`;
  return fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${idToken}` },
  });
}

async function deleteDocOnly(idToken, path) {
  const url = `${FS_BASE}/${path}`;
  return fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${idToken}` },
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
  // 4 ユーザー作成: owner / organizer / member / outsider
  const owner = await signUpOrIn("season-owner@test.local", "passw0rd");
  const org = await signUpOrIn("season-organizer@test.local", "passw0rd");
  const member = await signUpOrIn("season-member@test.local", "passw0rd");
  const outsider = await signUpOrIn("season-outsider@test.local", "passw0rd");

  console.log(
    `uids: owner=${owner.uid.slice(0, 6)} org=${org.uid.slice(0, 6)} ` +
      `member=${member.uid.slice(0, 6)} outsider=${outsider.uid.slice(0, 6)}`,
  );

  // owner として group を seed
  const gid = `g-season-${Date.now()}`;
  const seed = await createDoc(owner.idToken, "groups", gid, {
    name: "Season Test Group",
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
    seasonStartDate: null,
    createdAt: new Date(),
    joinCodeId: null,
  });
  if (!seed.ok) {
    const body = await seed.text();
    throw new Error(`seed create failed: ${seed.status} ${body}`);
  }

  // owner が memberUids / organizerUids を拡張
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

  // ─── seasonStartDate 単独 update ───
  // 1. organizer が seasonStartDate を Timestamp で書換 — allow
  await expectAllow("(1) organizer set seasonStartDate (Timestamp)", () =>
    patchDoc(org.idToken, `groups/${gid}`, { seasonStartDate: new Date() }),
  );

  // 2. organizer が seasonStartDate + name を同時書換 — deny（affectedKeys 違反）
  await expectDeny("(2) organizer set seasonStartDate + name (affectedKeys deny)", () =>
    patchDoc(org.idToken, `groups/${gid}`, {
      seasonStartDate: new Date(),
      name: "Changed",
    }),
  );

  // 3. member が seasonStartDate を書換 — deny
  await expectDeny("(3) member set seasonStartDate (deny)", () =>
    patchDoc(member.idToken, `groups/${gid}`, { seasonStartDate: new Date() }),
  );

  // ─── seasonStats CRUD ───
  // 4. organizer が seasonStats/{uid} を valid 値で create — allow
  await expectAllow("(4) organizer create seasonStats/{member.uid} valid", () =>
    createDoc(org.idToken, `groups/${gid}/seasonStats`, member.uid, {
      uid: member.uid,
      displayName: "Member",
      participations: 1,
      wins: 0,
      finalTables: 0,
      totalPoints: 1.0,
      lastUpdatedAt: new Date(),
    }),
  );

  // 5. organizer が participations=-1 で create — deny
  await expectDeny("(5) organizer create seasonStats with participations=-1 (deny)", () =>
    createDoc(org.idToken, `groups/${gid}/seasonStats`, org.uid, {
      uid: org.uid,
      displayName: "Org",
      participations: -1,
      wins: 0,
      finalTables: 0,
      totalPoints: 0,
      lastUpdatedAt: new Date(),
    }),
  );

  // 6. organizer が uid != docId で create — deny
  await expectDeny("(6) organizer create seasonStats with uid != docId (deny)", () =>
    createDoc(org.idToken, `groups/${gid}/seasonStats`, org.uid, {
      uid: member.uid, // ← docId と不一致
      displayName: "Org",
      participations: 0,
      wins: 0,
      finalTables: 0,
      totalPoints: 0,
      lastUpdatedAt: new Date(),
    }),
  );

  // 7. member が seasonStats を read — allow
  await expectAllow("(7) member read seasonStats/{member.uid}", () =>
    getDocOnly(member.idToken, `groups/${gid}/seasonStats/${member.uid}`),
  );

  // 8. outsider（非メンバー）が seasonStats を read — deny
  await expectDeny("(8) outsider read seasonStats (deny)", () =>
    getDocOnly(outsider.idToken, `groups/${gid}/seasonStats/${member.uid}`),
  );

  // ─── seasonHistory CRUD ───
  // 10. organizer が seasonHistory/{seasonId} を valid 値で create — allow
  const seasonId = `season-${Date.now()}`;
  await expectAllow("(10) organizer create seasonHistory valid", () =>
    createDoc(org.idToken, `groups/${gid}/seasonHistory`, seasonId, {
      startedAt: null,
      endedAt: new Date(),
      entries: [],
    }),
  );

  // 11. organizer が既存 seasonHistory を update — deny
  await expectDeny("(11) organizer update existing seasonHistory (deny)", () =>
    patchDoc(org.idToken, `groups/${gid}/seasonHistory/${seasonId}`, {
      endedAt: new Date(),
    }),
  );

  // 12. organizer が seasonHistory を delete — deny
  await expectDeny("(12) organizer delete seasonHistory (deny)", () =>
    deleteDocOnly(org.idToken, `groups/${gid}/seasonHistory/${seasonId}`),
  );

  // 9. organizer が seasonStats を delete — allow（reset 経路）
  // 末尾に置くのは前段の read テストで doc が必要だったため
  await expectAllow("(9) organizer delete seasonStats (reset path)", () =>
    deleteDocOnly(org.idToken, `groups/${gid}/seasonStats/${member.uid}`),
  );

  // ─────────────────────────────
  console.log("\n=== Firestore Rules: Phase A season validation ===");
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
