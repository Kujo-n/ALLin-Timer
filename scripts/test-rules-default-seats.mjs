/**
 * Phase 4.17 Firestore Rules emulator validation for `defaultSeatsPerTable`.
 *
 * 起動方法（cwd = repo root、emulator は起動済みか firebase emulators:exec から起動）:
 *   firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e \
 *     "node scripts/test-rules-default-seats.mjs"
 *
 * 実装方針:
 *   firebase web SDK の updateDoc は emulator + 一部のネット状況下で、サーバ拒否を受けても
 *   楽観 Promise として resolve することがある（PERMISSION_DENIED は firestore-debug.log
 *   のみに出る）。rules の allow/deny を確実に観測するため、本スクリプトは Firestore /
 *   Auth エミュレータを **REST API** で叩き、HTTP ステータスで判定する（test-rules-finished-count.mjs と同方針）。
 *
 *   - Auth: `accounts:signUp` で複数ユーザーを発行し idToken を取得
 *   - Firestore: `Authorization: Bearer <idToken>` を付けて PATCH/POST/GET
 *   - 200 系 = allow、403 = deny として assert
 */

const PROJECT_ID = "allin-pokertimer-e2e";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

const AUTH_BASE = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1`;
const FS_BASE = `http://${FS_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const API_KEY = "fake-api-key";

const results = [];

async function signUpOrIn(email, password) {
  const sup = await fetch(
    `${AUTH_BASE}/accounts:signUp?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
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

// Firestore REST 値変換: JS → Firestore typed value
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

// PATCH（updateDoc 相当） - updateMask 指定で部分更新
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

// POST（addDoc 相当） - documentId 指定で create
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
    results.push({ label, status: `FAIL (expected allow, got ${r.status}): ${body.slice(0, 200)}` });
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
    results.push({ label, status: `FAIL (expected 403, got ${r.status}): ${body.slice(0, 200)}` });
  }
}

async function main() {
  // 3 ユーザー作成
  const owner = await signUpOrIn("owner@test.local", "passw0rd");
  const org = await signUpOrIn("organizer@test.local", "passw0rd");
  const member = await signUpOrIn("member@test.local", "passw0rd");

  console.log(`uids:  owner=${owner.uid.slice(0, 6)}  org=${org.uid.slice(0, 6)}  member=${member.uid.slice(0, 6)}`);

  // owner として group を seed（rule の create branch を通す）
  const gid = `g-rules-${Date.now()}`;
  const seed = await createDoc(owner.idToken, "groups", gid, {
    name: "Test Group",
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
    defaultSeatsPerTable: 9,
    createdAt: new Date(),
    joinCodeId: null,
  });
  if (!seed.ok) {
    const body = await seed.text();
    throw new Error(`seed create failed: ${seed.status} ${body}`);
  }

  // owner が memberUids / organizerUids を拡張（owner full-update branch）
  const expand = await patchDoc(owner.idToken, `groups/${gid}`, {
    memberUids: [owner.uid, org.uid, member.uid],
    organizerUids: [owner.uid, org.uid],
    memberDisplayNames: { [owner.uid]: "Owner", [org.uid]: "Org", [member.uid]: "Member" },
  });
  if (!expand.ok) {
    const body = await expand.text();
    throw new Error(`seed expand failed: ${expand.status} ${body}`);
  }

  // ────────────────────────────────────────────────
  // 1. organizer による defaultSeatsPerTable: 6 — allow
  await expectAllow("(1) organizer set to 6", () =>
    patchDoc(org.idToken, `groups/${gid}`, { defaultSeatsPerTable: 6 }),
  );

  // 2. organizer による境界値（最小） defaultSeatsPerTable: 2 — allow
  await expectAllow("(2) organizer set to 2 (min boundary)", () =>
    patchDoc(org.idToken, `groups/${gid}`, { defaultSeatsPerTable: 2 }),
  );

  // 3. organizer による境界値（最大） defaultSeatsPerTable: 10 — allow
  await expectAllow("(3) organizer set to 10 (max boundary)", () =>
    patchDoc(org.idToken, `groups/${gid}`, { defaultSeatsPerTable: 10 }),
  );

  // 4. organizer による範囲外（下限 -1） defaultSeatsPerTable: 1 — deny
  await expectDeny("(4) organizer set to 1 (deny: below min)", () =>
    patchDoc(org.idToken, `groups/${gid}`, { defaultSeatsPerTable: 1 }),
  );

  // 5. organizer による範囲外（上限 +1） defaultSeatsPerTable: 11 — deny
  await expectDeny("(5) organizer set to 11 (deny: above max)", () =>
    patchDoc(org.idToken, `groups/${gid}`, { defaultSeatsPerTable: 11 }),
  );

  // 6. organizer による defaultSeatsPerTable + name の同時変更 — deny（affectedKeys 違反）
  await expectDeny("(6) organizer set seats + name (deny: affectedKeys)", () =>
    patchDoc(org.idToken, `groups/${gid}`, {
      defaultSeatsPerTable: 6,
      name: "Changed",
    }),
  );

  // 7. 一般 member による counter 書込 — deny
  await expectDeny("(7) member set to 6 (deny: not organizer)", () =>
    patchDoc(member.idToken, `groups/${gid}`, { defaultSeatsPerTable: 6 }),
  );

  // 8. owner はフル update branch を通るので、name + defaultSeatsPerTable 同時書込が許可される
  await expectAllow("(8) owner full update with name + seats (via owner branch)", () =>
    patchDoc(owner.idToken, `groups/${gid}`, {
      name: "Renamed",
      defaultSeatsPerTable: 8,
    }),
  );

  // 9. legacy doc 互換 — defaultSeatsPerTable フィールドが無い doc を seed して
  //    organizer が値を書き込めること
  const legacyGid = `g-legacy-${Date.now()}`;
  const seedLegacy = await createDoc(owner.idToken, "groups", legacyGid, {
    name: "Legacy Group",
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
    // defaultSeatsPerTable は意図的に省略（旧 doc 想定）
    createdAt: new Date(),
    joinCodeId: null,
  });
  if (!seedLegacy.ok) {
    const body = await seedLegacy.text();
    throw new Error(`legacy seed failed: ${seedLegacy.status} ${body}`);
  }
  const expandLegacy = await patchDoc(owner.idToken, `groups/${legacyGid}`, {
    organizerUids: [owner.uid, org.uid],
    memberUids: [owner.uid, org.uid],
    memberDisplayNames: { [owner.uid]: "Owner", [org.uid]: "Org" },
  });
  if (!expandLegacy.ok) {
    const body = await expandLegacy.text();
    throw new Error(`legacy expand failed: ${expandLegacy.status} ${body}`);
  }
  await expectAllow("(9) organizer adds defaultSeatsPerTable=6 to legacy doc", () =>
    patchDoc(org.idToken, `groups/${legacyGid}`, { defaultSeatsPerTable: 6 }),
  );

  // ────────────────────────────────────────────────
  console.log("\n=== Firestore Rules: defaultSeatsPerTable validation ===");
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
