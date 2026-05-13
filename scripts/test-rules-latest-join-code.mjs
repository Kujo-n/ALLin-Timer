/**
 * dryrun-feedback-batch-1 (Phase C.1) Firestore Rules emulator validation for
 *   - `groups/{gid}.latestJoinCodeId` の単独書換ブランチ
 *   - `groupJoinCodes/{code}` delete を `isOwner` → `isOrganizer` に widening
 *
 * 起動方法（cwd = repo root、emulator は firebase emulators:exec から起動）:
 *   firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e \
 *     "node scripts/test-rules-latest-join-code.mjs"
 *
 * 実装方針は test-rules-default-seats.mjs / test-rules-finished-count.mjs と同方針：
 *   Firestore web SDK の updateDoc が emulator + 一部のネット状況下で楽観 Promise として
 *   resolve してしまうことがあるため、本スクリプトは REST API + HTTP status 判定で
 *   rules の allow/deny を確実に観測する。
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

async function deleteDocReq(idToken, path) {
  const url = `${FS_BASE}/${path}`;
  return fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
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
  const owner = await signUpOrIn("owner-ljc@test.local", "passw0rd");
  const org = await signUpOrIn("organizer-ljc@test.local", "passw0rd");
  const member = await signUpOrIn("member-ljc@test.local", "passw0rd");

  console.log(
    `uids:  owner=${owner.uid.slice(0, 6)}  org=${org.uid.slice(0, 6)}  member=${member.uid.slice(0, 6)}`,
  );

  const gid = `g-ljc-${Date.now()}`;
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
    defaultSeatsPerTable: 8,
    createdAt: new Date(),
    joinCodeId: null,
    latestJoinCodeId: null,
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

  // ────────────────────────────────────────────────
  // groups/{gid} update branches
  // ────────────────────────────────────────────────

  // (1) organizer による latestJoinCodeId = 'abc123' — allow
  await expectAllow("(1) organizer set latestJoinCodeId='abc123'", () =>
    patchDoc(org.idToken, `groups/${gid}`, { latestJoinCodeId: "abc123" }),
  );

  // (2) organizer による latestJoinCodeId = null — allow（解除）
  await expectAllow("(2) organizer set latestJoinCodeId=null", () =>
    patchDoc(org.idToken, `groups/${gid}`, { latestJoinCodeId: null }),
  );

  // (3) member（非 organizer）による latestJoinCodeId 書換 — deny
  await expectDeny("(3) member set latestJoinCodeId (deny: not organizer)", () =>
    patchDoc(member.idToken, `groups/${gid}`, { latestJoinCodeId: "xyz789" }),
  );

  // (4) organizer による latestJoinCodeId = 整数 — deny（型違反）
  await expectDeny("(4) organizer set latestJoinCodeId=123 (deny: wrong type)", () =>
    patchDoc(org.idToken, `groups/${gid}`, { latestJoinCodeId: 123 }),
  );

  // (4b) organizer による latestJoinCodeId = '' — deny（schema は string.min(1)、rule も size() >= 1 で揃える）
  await expectDeny("(4b) organizer set latestJoinCodeId='' (deny: empty string)", () =>
    patchDoc(org.idToken, `groups/${gid}`, { latestJoinCodeId: "" }),
  );

  // (5) organizer による latestJoinCodeId + name の同時書換 — deny（affectedKeys 違反）
  await expectDeny("(5) organizer set latestJoinCodeId + name (deny: affectedKeys)", () =>
    patchDoc(org.idToken, `groups/${gid}`, {
      latestJoinCodeId: "mix",
      name: "Renamed",
    }),
  );

  // ────────────────────────────────────────────────
  // groupJoinCodes/{code} delete を isOrganizer に widening
  // ────────────────────────────────────────────────

  // seed: organizer が招待コードを 2 件作成（owner-delete / organizer-delete それぞれの対象）
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const code1 = `code-ljc-1-${Date.now()}`;
  const code2 = `code-ljc-2-${Date.now()}`;
  for (const code of [code1, code2]) {
    const seedCode = await createDoc(org.idToken, "groupJoinCodes", code, {
      gid,
      createdByUid: org.uid,
      expiresAt,
      maxUses: null,
      usesCount: 0,
      createdAt: new Date(),
    });
    if (!seedCode.ok) {
      const body = await seedCode.text();
      throw new Error(`seed code failed (${code}): ${seedCode.status} ${body}`);
    }
  }

  // (6) organizer による groupJoinCodes delete — allow（widening 後）
  await expectAllow("(6) organizer delete groupJoinCode (allow: widened from owner)", () =>
    deleteDocReq(org.idToken, `groupJoinCodes/${code1}`),
  );

  // (7) member による groupJoinCodes delete — deny（widening 後も非 organizer は不可）
  await expectDeny("(7) member delete groupJoinCode (deny: not organizer)", () =>
    deleteDocReq(member.idToken, `groupJoinCodes/${code2}`),
  );

  // (8) owner による groupJoinCodes delete — allow（owner も organizer に含まれる）
  await expectAllow("(8) owner delete groupJoinCode (allow: owner is organizer)", () =>
    deleteDocReq(owner.idToken, `groupJoinCodes/${code2}`),
  );

  // ────────────────────────────────────────────────
  console.log("\n=== Firestore Rules: latestJoinCodeId + groupJoinCodes.delete widening ===");
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
