/**
 * Phase 1 (04-spectate-mode) Firestore Rules emulator validation for `tournaments.spectateEnabled`.
 *
 * 起動方法（cwd = repo root、emulator は起動済みか firebase emulators:exec から起動）:
 *   firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e \
 *     "node scripts/test-rules-spectate.mjs"
 *
 * 実装方針:
 *   - REST 直叩き（test-rules-default-seats.mjs / test-rules-table-labels.mjs と同方針）。
 *   - 認証は idToken Bearer / 観戦 anon read は Authorization ヘッダ無しで GET。
 *   - HTTP 200 系 = allow、403 = deny として assert。
 *
 * 検証ケース:
 *   read 経路 (tournaments / players / tables):
 *     1. spectateEnabled=true、anon → tournaments/{tid} read allow
 *     2. spectateEnabled=true、anon → tournaments/{tid}/players/{pid} read allow
 *     3. spectateEnabled=true、anon → tournaments/{tid}/tables/{n} read allow
 *     4. spectateEnabled=false、anon → tournaments/{tid} read deny (403)
 *     5. spectateEnabled=false、anon → players read deny
 *     6. spectateEnabled=false、anon → tables read deny
 *     7. spectateEnabled field 不在の legacy doc、anon → read deny（.get default false 経由で）
 *     8. signed-in member は spectateEnabled に関係なく既存通り read 可
 *
 *   write 経路:
 *     9. organizer が spectateEnabled=true を update → allow
 *    10. member が spectateEnabled=true を update → deny
 *    11. anon が spectateEnabled=true を update → deny
 *    12. organizer が spectateEnabled に non-bool（"true" 文字列）を update → 経路 A の broad
 *        organizer update が拾うため allow になる想定（schema 側 zod が最終ライン防御）
 *
 *   players / tables の write 経路据え置き:
 *    13. spectateEnabled=true、anon が tournaments/{tid}/players/{pid} に PATCH → deny
 *
 *   delete 経路の回帰:
 *    14. organizer が tournaments/{tid} を delete → allow（rule 分割の回帰確認）
 *    14b. owner が tournaments/{tid} を delete → allow（owner ⊆ organizer の回帰確認）
 *
 *   list 列挙の防御（MEDIUM 修正後）:
 *    15. anon が `tournaments` collection を list → deny
 *        （`allow read` を `allow get + allow list: if isSignedIn()` に分割した defense-in-depth）
 *    16. signed-in member が絞り込みなしで `tournaments` collection を list → deny
 *        （08-auto-group-join-on-entry Phase 1 / C-1 対応で `allow list` を
 *          group メンバー限定に狭めたため。`where("groupId","==",gid)` 付きの allow ケースは
 *          scripts/test-rules-list-scope.mjs が担当）
 *
 *   collectionGroup query 経路の防御（04-spectate-mode 設計判断の pin、Phase 1 LOW-2 follow-up）:
 *    17. anon が collectionGroup("players") query を runQuery で叩く → deny
 *        （PRD「`match /{path=**}/players/{pid}` は触らない」設計を機械検証。
 *          path-specific rule で観戦 read を開いても、wildcard 経路は signed-in のみに据え置き）
 *    18. signed-in member が絞り込みなしで collectionGroup("players") query → deny
 *        （同じく C-1 対応で wildcard read を `uid == request.auth.uid` に狭めたため。
 *          `where("uid","==",self)` 付きの JoinedTournamentsNav 回帰は list-scope 側）
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

async function patchDocAnon(path, data) {
  const mask = Object.keys(data)
    .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join("&");
  const url = `${FS_BASE}/${path}?${mask}`;
  return fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
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

async function getDocAnon(path) {
  return fetch(`${FS_BASE}/${path}`);
}

async function getDocAuth(idToken, path) {
  return fetch(`${FS_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
}

// listDocuments REST endpoint: GET /v1/projects/{p}/databases/(default)/documents/{collection}
// 認証無しで叩くと `allow list` の rule 評価が走る。pageSize=1 で十分。
async function listCollectionAnon(collection) {
  return fetch(`${FS_BASE}/${collection}?pageSize=1`);
}

async function listCollectionAuth(idToken, collection) {
  return fetch(`${FS_BASE}/${collection}?pageSize=1`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
}

// runQuery REST endpoint: POST /v1/projects/{p}/databases/(default)/documents:runQuery
//   structuredQuery.from に `allDescendants: true` を渡すと collectionGroup query になり、
//   `match /{path=**}/players/{pid}` の rule path で評価される。
//   pageSize 等は structuredQuery.limit で渡す（最低 1 件で十分）。
async function runCollectionGroupQueryAnon(collectionId) {
  return fetch(`${FS_BASE}:runQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId, allDescendants: true }],
        limit: 1,
      },
    }),
  });
}

async function runCollectionGroupQueryAuth(idToken, collectionId) {
  return fetch(`${FS_BASE}:runQuery`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId, allDescendants: true }],
        limit: 1,
      },
    }),
  });
}

async function deleteDocAuth(idToken, path) {
  return fetch(`${FS_BASE}/${path}`, {
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
  if (r.status === 403 || r.status === 401) {
    results.push({ label, status: `PASS (deny ${r.status})` });
  } else if (r.ok) {
    results.push({ label, status: `FAIL (expected deny, got ${r.status})` });
  } else {
    const body = await r.text();
    results.push({
      label,
      status: `FAIL (expected 403/401, got ${r.status}): ${body.slice(0, 200)}`,
    });
  }
}

async function main() {
  const owner = await signUpOrIn("owner-spectate@test.local", "passw0rd");
  const org = await signUpOrIn("organizer-spectate@test.local", "passw0rd");
  const member = await signUpOrIn("member-spectate@test.local", "passw0rd");

  console.log(
    `uids:  owner=${owner.uid.slice(0, 6)}  org=${org.uid.slice(0, 6)}  member=${member.uid.slice(0, 6)}`,
  );

  const stamp = Date.now();
  const gid = `g-rules-spectate-${stamp}`;

  // owner として group を seed（rule の create branch を通す）
  const seedGroup = await createDoc(owner.idToken, "groups", gid, {
    name: "Test Group Spectate",
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
    throw new Error(`group expand failed: ${expand.status} ${body}`);
  }

  // tournaments を 3 件 seed:
  //   tidA: spectateEnabled=true
  //   tidB: spectateEnabled=false
  //   tidC: spectateEnabled field 不在（legacy doc）
  const tidA = `t-spectate-on-${stamp}`;
  const tidB = `t-spectate-off-${stamp}`;
  const tidC = `t-spectate-legacy-${stamp}`;
  const tDelete = `t-spectate-delete-${stamp}`;
  const tDeleteByOwner = `t-spectate-delete-by-owner-${stamp}`;

  function tournamentSeed({ withSpectate, value }) {
    const body = {
      groupId: gid,
      createdByUid: owner.uid,
      name: "Test Tournament",
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
    };
    if (withSpectate) body.spectateEnabled = value;
    return body;
  }

  const seedA = await createDoc(
    owner.idToken,
    "tournaments",
    tidA,
    tournamentSeed({ withSpectate: true, value: true }),
  );
  if (!seedA.ok) {
    const body = await seedA.text();
    throw new Error(`seed tidA failed: ${seedA.status} ${body}`);
  }
  const seedB = await createDoc(
    owner.idToken,
    "tournaments",
    tidB,
    tournamentSeed({ withSpectate: true, value: false }),
  );
  if (!seedB.ok) {
    const body = await seedB.text();
    throw new Error(`seed tidB failed: ${seedB.status} ${body}`);
  }
  const seedC = await createDoc(
    owner.idToken,
    "tournaments",
    tidC,
    tournamentSeed({ withSpectate: false }),
  );
  if (!seedC.ok) {
    const body = await seedC.text();
    throw new Error(`seed tidC failed: ${seedC.status} ${body}`);
  }
  const seedDel = await createDoc(
    owner.idToken,
    "tournaments",
    tDelete,
    tournamentSeed({ withSpectate: true, value: false }),
  );
  if (!seedDel.ok) {
    const body = await seedDel.text();
    throw new Error(`seed tDelete failed: ${seedDel.status} ${body}`);
  }
  const seedDelOwner = await createDoc(
    owner.idToken,
    "tournaments",
    tDeleteByOwner,
    tournamentSeed({ withSpectate: true, value: false }),
  );
  if (!seedDelOwner.ok) {
    const body = await seedDelOwner.text();
    throw new Error(
      `seed tDeleteByOwner failed: ${seedDelOwner.status} ${body}`,
    );
  }

  // 各 tournament に players/{owner.uid} と tables/{1} を seed
  for (const tid of [tidA, tidB, tidC]) {
    const seedPlayer = await createDoc(
      owner.idToken,
      `tournaments/${tid}/players`,
      owner.uid,
      {
        uid: owner.uid,
        displayName: "Owner",
        entryAt: new Date(),
        isBusted: false,
        bustedAt: null,
        tableNum: null,
        seatNum: null,
        lastMovedAt: null,
        isPlayingDealer: false,
      },
    );
    if (!seedPlayer.ok) {
      const body = await seedPlayer.text();
      throw new Error(`seed player ${tid} failed: ${seedPlayer.status} ${body}`);
    }

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
      throw new Error(`seed table ${tid} failed: ${seedTable.status} ${body}`);
    }
  }

  // ────────────────────────────────────────────────
  // anon read 経路の検証（Authorization ヘッダなし）

  await expectAllow("(1) anon read tournaments (spectate=true)", () =>
    getDocAnon(`tournaments/${tidA}`),
  );
  await expectAllow("(2) anon read players (spectate=true)", () =>
    getDocAnon(`tournaments/${tidA}/players/${owner.uid}`),
  );
  await expectAllow("(3) anon read tables (spectate=true)", () =>
    getDocAnon(`tournaments/${tidA}/tables/1`),
  );

  await expectDeny("(4) anon read tournaments (spectate=false)", () =>
    getDocAnon(`tournaments/${tidB}`),
  );
  await expectDeny("(5) anon read players (spectate=false)", () =>
    getDocAnon(`tournaments/${tidB}/players/${owner.uid}`),
  );
  await expectDeny("(6) anon read tables (spectate=false)", () =>
    getDocAnon(`tournaments/${tidB}/tables/1`),
  );

  await expectDeny("(7) anon read legacy tournaments (no field)", () =>
    getDocAnon(`tournaments/${tidC}`),
  );

  await expectAllow(
    "(8) signed-in member read tournaments (spectate=false)",
    () => getDocAuth(member.idToken, `tournaments/${tidB}`),
  );

  // ────────────────────────────────────────────────
  // write 経路

  await expectAllow("(9) organizer toggle spectateEnabled=true", () =>
    patchDoc(org.idToken, `tournaments/${tidB}`, {
      spectateEnabled: true,
      updatedAt: new Date(),
    }),
  );
  await expectDeny("(10) member toggle spectateEnabled=true", () =>
    patchDoc(member.idToken, `tournaments/${tidB}`, {
      spectateEnabled: true,
      updatedAt: new Date(),
    }),
  );
  await expectDeny("(11) anon toggle spectateEnabled=true", () =>
    patchDocAnon(`tournaments/${tidB}`, {
      spectateEnabled: true,
      updatedAt: new Date(),
    }),
  );

  // 経路 A (broad organizer) は型を要求しない。経路 B は is bool で reject するが、
  // OR の片側 A が拾うため non-bool でも 200 を返す想定。schema 側 zod が最終ライン防御。
  await expectAllow(
    "(12) organizer non-bool spectateEnabled — passes via broad path A",
    () =>
      patchDoc(org.idToken, `tournaments/${tidB}`, {
        spectateEnabled: "true",
      }),
  );

  // ────────────────────────────────────────────────
  // players / tables write 据え置き
  await expectDeny(
    "(13) anon write player (spectate=true read 開放、write は signed-in 必須)",
    () =>
      patchDocAnon(`tournaments/${tidA}/players/${owner.uid}`, {
        displayName: "hacked",
      }),
  );

  // ────────────────────────────────────────────────
  // delete 経路の回帰（rule 分割で organizer 削除経路を壊していないことの確認）
  await expectAllow("(14) organizer delete tournament (regression)", () =>
    deleteDocAuth(org.idToken, `tournaments/${tDelete}`),
  );

  // owner ⊆ organizer のため owner も rule 経路 `isOrganizer(...)` で allow される回帰確認。
  await expectAllow(
    "(14b) owner delete tournament (owner ⊆ organizer regression)",
    () => deleteDocAuth(owner.idToken, `tournaments/${tDeleteByOwner}`),
  );

  // ────────────────────────────────────────────────
  // list 列挙の防御（MEDIUM 修正: allow read → allow get + allow list 分割）
  await expectDeny(
    "(15) anon list tournaments (defense-in-depth: allow list = signed-in only)",
    () => listCollectionAnon("tournaments"),
  );
  // 08-auto-group-join-on-entry Phase 1 (C-1 対応) で `allow list` を group メンバー限定に
  // 狭めたため、**signed-in でも絞り込みなしの列挙は deny** になった。
  // 絞り込み付き（`where("groupId","==",gid)`）の allow ケースは
  // scripts/test-rules-list-scope.mjs 側で網羅する。
  await expectDeny(
    "(16) signed-in member list tournaments WITHOUT a groupId filter (C-1: discovery blocked)",
    () => listCollectionAuth(member.idToken, "tournaments"),
  );

  // ────────────────────────────────────────────────
  // collectionGroup query 経路の防御（PRD 設計判断: wildcard 経路は anon に開けない）
  //   `match /{path=**}/players/{pid}` は `if isSignedIn()` のみで定義されているため、
  //   spectateEnabled=true の親 tournament を持つ players も collectionGroup query 経由では anon read できない。
  //   これにより「観戦は path-specific rule（match /tournaments/{tid}/players/{pid}）経由でのみ通る」
  //   設計を機械検証する（将来 wildcard を緩めた場合に検出する安全網）。
  await expectDeny(
    "(17) anon collectionGroup query players (wildcard 経路は signed-in only)",
    () => runCollectionGroupQueryAnon("players"),
  );
  // 同じく C-1 対応で wildcard read を `uid == request.auth.uid` に狭めたため、
  // **絞り込みなしの collectionGroup 列挙は signed-in でも deny**。
  // `where("uid","==",self)` 付きの JoinedTournamentsNav 経路の回帰確認は
  // scripts/test-rules-list-scope.mjs のケース 6 が担当する。
  await expectDeny(
    "(18) signed-in member collectionGroup query players WITHOUT a uid filter (C-1: tid discovery blocked)",
    () => runCollectionGroupQueryAuth(member.idToken, "players"),
  );

  // ────────────────────────────────────────────────
  console.log("\n=== Firestore Rules: spectateEnabled validation ===");
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
