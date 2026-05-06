/**
 * Phase 5.4 Firestore Rules emulator validation for organizer-clone create branch.
 *
 * 起動方法（cwd = repo root）:
 *   firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e \
 *     "node scripts/test-rules-clone-players.mjs"
 *   # または npm script
 *   npm run test:rules-clone-players
 *
 * 検証ケース:
 *   1. organizer が dest=setup 状態の tournament に他人の uid で player を create → allow
 *   2. 一般 member（同 group の non-organizer）が同様に create → deny
 *   3. dest tournament の state が "seating" のとき organizer が create → deny（setup 限定）
 *   4. organizer が pid != uid の不整合な player を create → deny（pid==uid invariant）
 *   5. organizer が isBusted=true を埋めて create → deny（invariant）
 *   6. organizer が tableNum=1, seatNum=1 を埋めて create → deny（no seat invariant）
 *   7. self（自分の uid）による setup tournament create は引き続き allow（既存 self ブランチ非 regression）
 *
 * 実装方針: test-rules-pd.mjs と同じく Firestore / Auth エミュレータを REST API で叩く。
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

function basePlayer(uid, displayName, overrides = {}) {
  return {
    displayName,
    uid,
    entryAt: new Date(),
    isBusted: false,
    bustedAt: null,
    tableNum: null,
    seatNum: null,
    lastMovedAt: null,
    isPlayingDealer: false,
    ...overrides,
  };
}

function tournamentSeed(state, gid, ownerUid) {
  return {
    groupId: gid,
    createdByUid: ownerUid,
    name: "Clone Test Tournament",
    structureSnapshot: {
      name: "Default",
      initialStack: 10000,
      rebuyStack: null,
      addOnStack: null,
      lateEntryDeadlineLevel: 6,
      levels: [],
    },
    state,
    startedAt: null,
    levelStartedAt: null,
    pausedAt: null,
    pausedAccumMs: 0,
    finishedAt: null,
    currentLevel: 0,
    lateEntryDeadlineLevel: 6,
    seatsPerTable: 9,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function main() {
  const owner = await signUpOrIn("owner-clone@test.local", "passw0rd");
  const org = await signUpOrIn("organizer-clone@test.local", "passw0rd");
  const member = await signUpOrIn("member-clone@test.local", "passw0rd");
  const stranger = await signUpOrIn("stranger-clone@test.local", "passw0rd");

  console.log(
    `uids:  owner=${owner.uid.slice(0, 6)}  org=${org.uid.slice(0, 6)}  member=${member.uid.slice(0, 6)}  stranger=${stranger.uid.slice(0, 6)}`,
  );

  const gid = `g-clone-${Date.now()}`;
  const seedG = await createDoc(owner.idToken, "groups", gid, {
    name: "Clone Test Group",
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
  if (!seedG.ok) {
    const body = await seedG.text();
    throw new Error(`group seed failed: ${seedG.status} ${body}`);
  }
  const expandG = await patchDoc(owner.idToken, `groups/${gid}`, {
    memberUids: [owner.uid, org.uid, member.uid],
    organizerUids: [owner.uid, org.uid],
    memberDisplayNames: {
      [owner.uid]: "Owner",
      [org.uid]: "Org",
      [member.uid]: "Member",
    },
  });
  if (!expandG.ok) {
    const body = await expandG.text();
    throw new Error(`group expand failed: ${expandG.status} ${body}`);
  }

  // dest tournament (setup) — clone 先
  const tidSetup = `t-clone-setup-${Date.now()}`;
  const seedSetup = await createDoc(
    owner.idToken,
    "tournaments",
    tidSetup,
    tournamentSeed("setup", gid, owner.uid),
  );
  if (!seedSetup.ok) {
    const body = await seedSetup.text();
    throw new Error(`setup tournament seed failed: ${seedSetup.status} ${body}`);
  }

  // dest tournament (seating) — setup 限定 deny 検証用
  const tidSeating = `t-clone-seating-${Date.now()}`;
  const seedSeating = await createDoc(
    owner.idToken,
    "tournaments",
    tidSeating,
    tournamentSeed("seating", gid, owner.uid),
  );
  if (!seedSeating.ok) {
    const body = await seedSeating.text();
    throw new Error(`seating tournament seed failed: ${seedSeating.status} ${body}`);
  }

  // ────────────────────────────────────────────────
  // 1. organizer が dest=setup の tournament に他人 (member) の uid で player を create → allow
  await expectAllow(
    "(1) organizer creates player with member.uid into setup tournament",
    () =>
      createDoc(
        org.idToken,
        `tournaments/${tidSetup}/players`,
        member.uid,
        basePlayer(member.uid, "Member"),
      ),
  );

  // 2. 一般 member（non-organizer）が他人 (org) の uid で create → deny
  await expectDeny(
    "(2) general member tries clone-create with another uid (deny)",
    () =>
      createDoc(
        member.idToken,
        `tournaments/${tidSetup}/players`,
        org.uid,
        basePlayer(org.uid, "Org"),
      ),
  );

  // 3. dest tournament の state="seating" → organizer でも create deny（setup 限定）
  await expectDeny(
    "(3) organizer create on seating-state tournament (deny — setup only)",
    () =>
      createDoc(
        org.idToken,
        `tournaments/${tidSeating}/players`,
        member.uid,
        basePlayer(member.uid, "Member"),
      ),
  );

  // 4. organizer が pid != uid の不整合な create → deny
  await expectDeny(
    "(4) organizer create with pid != uid (deny)",
    () =>
      createDoc(
        org.idToken,
        `tournaments/${tidSetup}/players`,
        "fake-pid-not-matching",
        basePlayer(stranger.uid, "Mismatch"),
      ),
  );

  // 5. organizer が isBusted=true を埋めて create → deny
  await expectDeny(
    "(5) organizer create with isBusted=true (deny)",
    () =>
      createDoc(
        org.idToken,
        `tournaments/${tidSetup}/players`,
        stranger.uid,
        basePlayer(stranger.uid, "Stranger", { isBusted: true }),
      ),
  );

  // 6. organizer が tableNum/seatNum を埋めて create → deny（no seat invariant）
  await expectDeny(
    "(6) organizer create with tableNum=1/seatNum=1 (deny)",
    () =>
      createDoc(
        org.idToken,
        `tournaments/${tidSetup}/players`,
        stranger.uid,
        basePlayer(stranger.uid, "Stranger", { tableNum: 1, seatNum: 1 }),
      ),
  );

  // 7. self ブランチ非 regression: stranger が自分の uid で setup tournament に create → allow
  //    （新規 setup tournament を別途用意。tidSetup は既に member.uid が存在するため衝突回避）
  const tidSelf = `t-clone-self-${Date.now()}`;
  const seedSelf = await createDoc(
    owner.idToken,
    "tournaments",
    tidSelf,
    tournamentSeed("setup", gid, owner.uid),
  );
  if (seedSelf.ok) {
    await expectAllow(
      "(7) self-create on setup tournament still works (no regression)",
      () =>
        createDoc(
          stranger.idToken,
          `tournaments/${tidSelf}/players`,
          stranger.uid,
          basePlayer(stranger.uid, "Stranger"),
        ),
    );
  } else {
    results.push({
      label: "(7) self tournament seed",
      status: `SKIP (seed failed): ${seedSelf.status}`,
    });
  }

  // ────────────────────────────────────────────────
  console.log("\n=== Firestore Rules: players organizer-clone create validation ===");
  for (const r of results) {
    const ok = r.status.startsWith("PASS");
    console.log(`  ${ok ? "[OK]  " : r.status.startsWith("SKIP") ? "[SKIP]" : "[FAIL]"} ${r.label} — ${r.status}`);
  }
  const failed = results.filter(
    (r) => !r.status.startsWith("PASS") && !r.status.startsWith("SKIP"),
  );
  console.log(
    `\n${results.length - failed.length}/${results.length} non-fail. ${
      failed.length === 0 ? "ALL GREEN" : "FAILURES present"
    }`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
