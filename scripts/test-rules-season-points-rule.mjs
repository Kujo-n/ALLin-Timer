/**
 * Phase E Firestore Rules emulator validation for groups/{gid}.seasonPointsRule
 * 単独書換 branch（OR 分岐 9 番目）の allow / deny を網羅検証する。
 *
 * 起動方法（cwd = repo root、emulator は起動済みか firebase emulators:exec から起動）:
 *   firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e \
 *     "node scripts/test-rules-season-points-rule.mjs"
 *
 * 検証ケース:
 *   1. organizer が valid な { base:[10,7,5], baseline:8 } を書換 → allow
 *   2. organizer が null で reset → allow
 *   3. organizer が seasonPointsRule + name を同時書換 → deny（affectedKeys 違反）
 *   4. member が seasonPointsRule を書換 → deny
 *   5. organizer が baseline = 1（< 2）を書換 → deny
 *   6. organizer が baseline = 11（> 10）を書換 → deny
 *   7. organizer が base = []（size < 1）を書換 → deny
 *   8. organizer が base = 10 件 array（size > 9）を書換 → deny
 *   9. organizer が seasonPointsRule = "string"（type != map / null）を書換 → deny
 *  10. outsider（非メンバー）が seasonPointsRule を read → deny（group read 自体が deny）
 *  11. member が groups/{gid} を read して seasonPointsRule を含む doc を取得 → allow
 *
 * 実装方針は scripts/test-rules-season.mjs と同じ REST 直叩き方式。
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
  const owner = await signUpOrIn("sprule-owner@test.local", "passw0rd");
  const org = await signUpOrIn("sprule-organizer@test.local", "passw0rd");
  const member = await signUpOrIn("sprule-member@test.local", "passw0rd");
  const outsider = await signUpOrIn("sprule-outsider@test.local", "passw0rd");

  console.log(
    `uids: owner=${owner.uid.slice(0, 6)} org=${org.uid.slice(0, 6)} ` +
      `member=${member.uid.slice(0, 6)} outsider=${outsider.uid.slice(0, 6)}`,
  );

  // owner として group を seed
  const gid = `g-sprule-${Date.now()}`;
  const seed = await createDoc(owner.idToken, "groups", gid, {
    name: "Season Points Rule Test Group",
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
    defaultTableLabels: [],
    defaultTableColors: [],
    seasonPointsRule: null,
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

  // 1. organizer が valid な { base:[10,7,5], baseline:8 } を書換 — allow
  await expectAllow("(1) organizer set seasonPointsRule valid", () =>
    patchDoc(org.idToken, `groups/${gid}`, {
      seasonPointsRule: { base: [10, 7, 5], baseline: 8 },
    }),
  );

  // 2. organizer が null で reset — allow
  await expectAllow("(2) organizer reset seasonPointsRule to null", () =>
    patchDoc(org.idToken, `groups/${gid}`, { seasonPointsRule: null }),
  );

  // 3. organizer が seasonPointsRule + name を同時書換 — deny（affectedKeys 違反）
  await expectDeny("(3) organizer set seasonPointsRule + name (affectedKeys deny)", () =>
    patchDoc(org.idToken, `groups/${gid}`, {
      seasonPointsRule: { base: [10], baseline: 8 },
      name: "Changed",
    }),
  );

  // 4. member が seasonPointsRule を書換 — deny
  await expectDeny("(4) member set seasonPointsRule (deny)", () =>
    patchDoc(member.idToken, `groups/${gid}`, {
      seasonPointsRule: { base: [10], baseline: 8 },
    }),
  );

  // 5. organizer が baseline=1 を書換 — deny
  await expectDeny("(5) organizer baseline=1 (deny)", () =>
    patchDoc(org.idToken, `groups/${gid}`, {
      seasonPointsRule: { base: [10], baseline: 1 },
    }),
  );

  // 6. organizer が baseline=11 を書換 — deny
  await expectDeny("(6) organizer baseline=11 (deny)", () =>
    patchDoc(org.idToken, `groups/${gid}`, {
      seasonPointsRule: { base: [10], baseline: 11 },
    }),
  );

  // 7. organizer が base=[] を書換 — deny
  await expectDeny("(7) organizer base=[] (deny)", () =>
    patchDoc(org.idToken, `groups/${gid}`, {
      seasonPointsRule: { base: [], baseline: 8 },
    }),
  );

  // 8. organizer が base 10 件 array を書換 — deny
  await expectDeny("(8) organizer base size=10 (deny)", () =>
    patchDoc(org.idToken, `groups/${gid}`, {
      seasonPointsRule: { base: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], baseline: 8 },
    }),
  );

  // 9. organizer が seasonPointsRule = "string" を書換 — deny（type != map / null）
  await expectDeny("(9) organizer seasonPointsRule as string (deny)", () =>
    patchDoc(org.idToken, `groups/${gid}`, {
      seasonPointsRule: "not-an-object",
    }),
  );

  // 10. outsider が groups/{gid} を read — deny（group read 自体が memberUids 限定）
  await expectDeny("(10) outsider read groups/{gid} (deny)", () =>
    getDocOnly(outsider.idToken, `groups/${gid}`),
  );

  // 11. member が groups/{gid} を read — allow
  await expectAllow("(11) member read groups/{gid} containing seasonPointsRule", () =>
    getDocOnly(member.idToken, `groups/${gid}`),
  );

  // ─────────────────────────────
  console.log("\n=== Firestore Rules: Phase E seasonPointsRule validation ===");
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
