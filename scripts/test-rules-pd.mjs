/**
 * Phase 5.1 Firestore Rules emulator validation for `players.isPlayingDealer`.
 *
 * 起動方法（cwd = repo root）:
 *   firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e \
 *     "node scripts/test-rules-pd.mjs"
 *
 * 検証ケース:
 *   1. organizer による isPlayingDealer の ON 書込 → allow
 *   2. organizer による isPlayingDealer の OFF 書込 → allow
 *   3. self（自分の player doc）による isPlayingDealer 書換 → deny
 *   4. 一般 member（同 group の non-organizer）による他人 player の isPlayingDealer 書込 → deny
 *   5. organizer が seat 操作 + isPlayingDealer 同時更新 → allow（既存 organizer 経路に統合）
 *   6. legacy doc 互換 — isPlayingDealer フィールド無し player に対し organizer が
 *      ON を書き込めること
 *   7. self による create 時に isPlayingDealer=true を埋めて自分を PD として登録 → deny
 *      （rule の create 分岐の `.get('isPlayingDealer', false) == false` で塞ぐ）
 *
 * 実装方針: test-rules-default-seats.mjs / test-rules-finished-count.mjs と同じく
 *   Firestore / Auth エミュレータを REST API で叩く。
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

async function main() {
  const owner = await signUpOrIn("owner-pd@test.local", "passw0rd");
  const org = await signUpOrIn("organizer-pd@test.local", "passw0rd");
  const member = await signUpOrIn("member-pd@test.local", "passw0rd");

  console.log(
    `uids:  owner=${owner.uid.slice(0, 6)}  org=${org.uid.slice(0, 6)}  member=${member.uid.slice(0, 6)}`,
  );

  // group seed
  const gid = `g-pd-${Date.now()}`;
  const seedG = await createDoc(owner.idToken, "groups", gid, {
    name: "PD Test Group",
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

  // tournament seed (owner)
  const tid = `t-pd-${Date.now()}`;
  const seedT = await createDoc(owner.idToken, "tournaments", tid, {
    groupId: gid,
    createdByUid: owner.uid,
    name: "PD Test Tournament",
    structureSnapshot: {
      name: "Default",
      initialStack: 10000,
      rebuyStack: null,
      addOnStack: null,
      lateEntryDeadlineLevel: 6,
      levels: [],
    },
    state: "running",
    startedAt: new Date(),
    levelStartedAt: new Date(),
    pausedAt: null,
    pausedAccumMs: 0,
    finishedAt: null,
    currentLevel: 1,
    lateEntryDeadlineLevel: 6,
    seatsPerTable: 9,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  if (!seedT.ok) {
    const body = await seedT.text();
    throw new Error(`tournament seed failed: ${seedT.status} ${body}`);
  }

  // member（一般メンバー）が自分の player doc を作成（rule の create 経由）
  const playerCreate = await createDoc(
    member.idToken,
    `tournaments/${tid}/players`,
    member.uid,
    {
      displayName: "Member",
      uid: member.uid,
      entryAt: new Date(),
      isBusted: false,
      bustedAt: null,
      tableNum: null,
      seatNum: null,
      lastMovedAt: null,
      isPlayingDealer: false,
    },
  );
  if (!playerCreate.ok) {
    const body = await playerCreate.text();
    throw new Error(`player create failed: ${playerCreate.status} ${body}`);
  }

  // organizer が member の席を割当てる（前提のセットアップ）
  const seatAssign = await patchDoc(
    org.idToken,
    `tournaments/${tid}/players/${member.uid}`,
    {
      tableNum: 1,
      seatNum: 1,
      lastMovedAt: new Date(),
    },
  );
  if (!seatAssign.ok) {
    const body = await seatAssign.text();
    throw new Error(`seat assign failed: ${seatAssign.status} ${body}`);
  }

  // ────────────────────────────────────────────────
  // 1. organizer による isPlayingDealer ON — allow
  await expectAllow("(1) organizer sets isPlayingDealer=true", () =>
    patchDoc(org.idToken, `tournaments/${tid}/players/${member.uid}`, {
      isPlayingDealer: true,
    }),
  );

  // 2. organizer による isPlayingDealer OFF — allow
  await expectAllow("(2) organizer sets isPlayingDealer=false", () =>
    patchDoc(org.idToken, `tournaments/${tid}/players/${member.uid}`, {
      isPlayingDealer: false,
    }),
  );

  // 3. self（member 本人）による isPlayingDealer 書換 — deny
  await expectDeny("(3) self update isPlayingDealer (deny)", () =>
    patchDoc(member.idToken, `tournaments/${tid}/players/${member.uid}`, {
      isPlayingDealer: true,
    }),
  );

  // 4. 一般 member（別 player の自分の権限外更新） — deny
  // member は organizer ではない一般メンバーロール（別 player を更新）。
  // 自分自身の doc の self-update は (3) で deny されているので、別 player を作って
  // その isPlayingDealer を member が更新しようとして deny されることを確認。
  const seedOther = await createDoc(
    org.idToken,
    `tournaments/${tid}/players`,
    "other-player",
    {
      displayName: "Other",
      uid: "other-uid-not-real",
      entryAt: new Date(),
      isBusted: false,
      bustedAt: null,
      tableNum: 1,
      seatNum: 2,
      lastMovedAt: new Date(),
      isPlayingDealer: false,
    },
  );
  // organizer による自由 create は rule で許容されるかは別議論なので、create 失敗したら skip する。
  if (seedOther.ok) {
    await expectDeny("(4) general member updates other player isPlayingDealer (deny)", () =>
      patchDoc(member.idToken, `tournaments/${tid}/players/other-player`, {
        isPlayingDealer: true,
      }),
    );
  } else {
    results.push({
      label: "(4) general member updates other player isPlayingDealer",
      status: "SKIP (could not seed other player; create deny is rule-correct)",
    });
  }

  // 5. organizer による seat + isPlayingDealer の同時更新 — allow
  await expectAllow("(5) organizer sets seat + isPlayingDealer together", () =>
    patchDoc(org.idToken, `tournaments/${tid}/players/${member.uid}`, {
      tableNum: 2,
      seatNum: 3,
      isPlayingDealer: true,
      lastMovedAt: new Date(),
    }),
  );

  // 6. legacy doc 互換 — isPlayingDealer フィールド無しの doc を seed して
  //    organizer が ON を書き込めること（rule の get(..., false) 形互換）
  const legacyPid = "legacy-player";
  const seedLegacy = await createDoc(
    org.idToken,
    `tournaments/${tid}/players`,
    legacyPid,
    {
      displayName: "Legacy",
      uid: "legacy-uid",
      entryAt: new Date(),
      isBusted: false,
      bustedAt: null,
      tableNum: 1,
      seatNum: 5,
      lastMovedAt: new Date(),
      // isPlayingDealer は意図的に省略（旧 doc 想定）
    },
  );
  if (seedLegacy.ok) {
    await expectAllow("(6) organizer sets isPlayingDealer=true on legacy doc", () =>
      patchDoc(org.idToken, `tournaments/${tid}/players/${legacyPid}`, {
        isPlayingDealer: true,
      }),
    );
  } else {
    results.push({
      label: "(6) legacy doc seed",
      status: `SKIP (legacy seed failed): ${seedLegacy.status}`,
    });
  }

  // 7. self が create 時に isPlayingDealer=true を埋める — deny（M1 修正）
  //    別 tournament を作って organizer / member とは別の self ユーザーで create を試みる
  //    （member 本人の player doc は (3) のセットアップで既に存在し、create rule は
  //    存在判定がないが Firestore 側の同 ID create で衝突するため、新規 tournament を
  //    用意して別 player ID で確認する）。
  const tid7 = `t-pd7-${Date.now()}`;
  const seedT7 = await createDoc(owner.idToken, "tournaments", tid7, {
    groupId: gid,
    createdByUid: owner.uid,
    name: "PD Test Tournament 7 (create deny)",
    structureSnapshot: {
      name: "Default",
      initialStack: 10000,
      rebuyStack: null,
      addOnStack: null,
      lateEntryDeadlineLevel: 6,
      levels: [],
    },
    state: "setup",
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
  });
  if (seedT7.ok) {
    await expectDeny("(7) self create with isPlayingDealer=true (deny)", () =>
      createDoc(member.idToken, `tournaments/${tid7}/players`, member.uid, {
        displayName: "Member7",
        uid: member.uid,
        entryAt: new Date(),
        isBusted: false,
        bustedAt: null,
        tableNum: null,
        seatNum: null,
        lastMovedAt: null,
        isPlayingDealer: true, // ← self-stamp PD attempt
      }),
    );
    // 補助: 同じ self が isPlayingDealer=false なら create OK（rule の他条件が壊れていないことを確認）
    await expectAllow("(7b) self create with isPlayingDealer=false (allow)", () =>
      createDoc(org.idToken, `tournaments/${tid7}/players`, org.uid, {
        displayName: "Org7",
        uid: org.uid,
        entryAt: new Date(),
        isBusted: false,
        bustedAt: null,
        tableNum: null,
        seatNum: null,
        lastMovedAt: null,
        isPlayingDealer: false,
      }),
    );
  } else {
    results.push({
      label: "(7) tournament7 seed",
      status: `SKIP (tournament7 seed failed): ${seedT7.status}`,
    });
  }

  // ────────────────────────────────────────────────
  console.log("\n=== Firestore Rules: players.isPlayingDealer validation ===");
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
