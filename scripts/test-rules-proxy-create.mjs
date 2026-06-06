/**
 * Phase 1 (07-third-dryrun-improvements) Firestore Rules emulator validation for
 * organizer-proxy receipt create branches（member-proxy / name-only）。
 *
 * 起動方法（cwd = repo root）:
 *   firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e \
 *     "node scripts/test-rules-proxy-create.mjs"
 *   # または npm script
 *   npm run test:rules-proxy-create
 *
 * 検証ケース:
 *   1. organizer が setup tournament に member.uid で create → allow（member-proxy）
 *   2. organizer が running tournament に member.uid で create → allow（state 拡張）
 *   3. organizer が setup tournament に name-only（uid=null, 合成 pid）で create → allow
 *   4. organizer が running tournament に name-only で create → allow（state 拡張）
 *   5. 一般 member（non-organizer）が name-only で create → deny
 *   6. 一般 member が member.uid で create → deny
 *   7. organizer が name-only で isBusted=true を埋めて create → deny（invariant）
 *   8. organizer が name-only で tableNum=1/seatNum=1 を埋めて create → deny（no seat invariant）
 *   9. organizer が name-only で isPlayingDealer=true を埋めて create → deny（PD invariant）
 *  10. organizer が finished tournament に name-only で create → deny（state 外）
 *  11. self-create 非 regression: stranger が自分の uid で setup tournament に create → allow
 *
 * 実装方針: test-rules-clone-players.mjs と同じく Firestore / Auth エミュレータを REST API で叩く。
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
    name: "Proxy Receipt Test Tournament",
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
    // running/finished でも late entry 締切は rule では参照しない（state のみ）。
    // currentLevel は deadline 以下に置き、service 側の deadline 判定とは無関係に rule allow を検証。
    currentLevel: state === "setup" || state === "seating" ? 0 : 1,
    lateEntryDeadlineLevel: 6,
    seatsPerTable: 9,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

let synthSeq = 0;
function synthPid() {
  synthSeq += 1;
  return `named-${Date.now()}-${synthSeq}`;
}

async function main() {
  const owner = await signUpOrIn("owner-proxy@test.local", "passw0rd");
  const org = await signUpOrIn("organizer-proxy@test.local", "passw0rd");
  const member = await signUpOrIn("member-proxy@test.local", "passw0rd");
  const stranger = await signUpOrIn("stranger-proxy@test.local", "passw0rd");

  console.log(
    `uids:  owner=${owner.uid.slice(0, 6)}  org=${org.uid.slice(0, 6)}  member=${member.uid.slice(0, 6)}  stranger=${stranger.uid.slice(0, 6)}`,
  );

  const gid = `g-proxy-${Date.now()}`;
  const seedG = await createDoc(owner.idToken, "groups", gid, {
    name: "Proxy Receipt Test Group",
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

  // tournament seeds（複数 state）
  const tidSetup = `t-proxy-setup-${Date.now()}`;
  const tidRunning = `t-proxy-running-${Date.now()}`;
  const tidFinished = `t-proxy-finished-${Date.now()}`;
  const tidSelf = `t-proxy-self-${Date.now()}`;
  for (const [tid, state] of [
    [tidSetup, "setup"],
    [tidRunning, "running"],
    [tidFinished, "finished"],
    [tidSelf, "setup"],
  ]) {
    const seed = await createDoc(
      owner.idToken,
      "tournaments",
      tid,
      tournamentSeed(state, gid, owner.uid),
    );
    if (!seed.ok) {
      const body = await seed.text();
      throw new Error(`tournament seed (${state}) failed: ${seed.status} ${body}`);
    }
  }

  // ────────────────────────────────────────────────
  // 1. organizer が setup tournament に member.uid で create → allow（member-proxy）
  await expectAllow(
    "(1) organizer proxy-creates member into setup tournament",
    () =>
      createDoc(
        org.idToken,
        `tournaments/${tidSetup}/players`,
        member.uid,
        basePlayer(member.uid, "Member"),
      ),
  );

  // 2. organizer が running tournament に member.uid で create → allow（state 拡張）
  await expectAllow(
    "(2) organizer proxy-creates member into running tournament (state widened)",
    () =>
      createDoc(
        org.idToken,
        `tournaments/${tidRunning}/players`,
        member.uid,
        basePlayer(member.uid, "Member"),
      ),
  );

  // 3. organizer が setup tournament に name-only（uid=null, 合成 pid）で create → allow
  await expectAllow(
    "(3) organizer creates name-only (uid=null) into setup tournament",
    () =>
      createDoc(
        org.idToken,
        `tournaments/${tidSetup}/players`,
        synthPid(),
        basePlayer(null, "Charge-Dead Guest"),
      ),
  );

  // 4. organizer が running tournament に name-only で create → allow（state 拡張）
  await expectAllow(
    "(4) organizer creates name-only into running tournament (state widened)",
    () =>
      createDoc(
        org.idToken,
        `tournaments/${tidRunning}/players`,
        synthPid(),
        basePlayer(null, "Charge-Dead Guest"),
      ),
  );

  // 5. 一般 member（non-organizer）が name-only で create → deny
  await expectDeny(
    "(5) general member tries name-only create (deny)",
    () =>
      createDoc(
        member.idToken,
        `tournaments/${tidSetup}/players`,
        synthPid(),
        basePlayer(null, "Charge-Dead Guest"),
      ),
  );

  // 6. 一般 member が member.uid で create → deny
  await expectDeny(
    "(6) general member tries member-proxy create with another uid (deny)",
    () =>
      createDoc(
        member.idToken,
        `tournaments/${tidSetup}/players`,
        stranger.uid,
        basePlayer(stranger.uid, "Stranger"),
      ),
  );

  // 7. organizer が name-only で isBusted=true を埋めて create → deny（invariant）
  await expectDeny(
    "(7) organizer name-only create with isBusted=true (deny)",
    () =>
      createDoc(
        org.idToken,
        `tournaments/${tidSetup}/players`,
        synthPid(),
        basePlayer(null, "Guest", { isBusted: true }),
      ),
  );

  // 8. organizer が name-only で tableNum=1/seatNum=1 を埋めて create → deny（no seat invariant）
  await expectDeny(
    "(8) organizer name-only create with seat filled (deny)",
    () =>
      createDoc(
        org.idToken,
        `tournaments/${tidSetup}/players`,
        synthPid(),
        basePlayer(null, "Guest", { tableNum: 1, seatNum: 1 }),
      ),
  );

  // 9. organizer が name-only で isPlayingDealer=true を埋めて create → deny（PD invariant）
  await expectDeny(
    "(9) organizer name-only create with isPlayingDealer=true (deny)",
    () =>
      createDoc(
        org.idToken,
        `tournaments/${tidSetup}/players`,
        synthPid(),
        basePlayer(null, "Guest", { isPlayingDealer: true }),
      ),
  );

  // 10. organizer が finished tournament に name-only で create → deny（state 外）
  await expectDeny(
    "(10) organizer name-only create into finished tournament (deny — state out of range)",
    () =>
      createDoc(
        org.idToken,
        `tournaments/${tidFinished}/players`,
        synthPid(),
        basePlayer(null, "Guest"),
      ),
  );

  // 11. self-create 非 regression: stranger が自分の uid で setup tournament に create → allow
  await expectAllow(
    "(11) self-create on setup tournament still works (no regression)",
    () =>
      createDoc(
        stranger.idToken,
        `tournaments/${tidSelf}/players`,
        stranger.uid,
        basePlayer(stranger.uid, "Stranger"),
      ),
  );

  // ────────────────────────────────────────────────
  console.log("\n=== Firestore Rules: players organizer-proxy create validation ===");
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
