/**
 * Phase 1 (08-auto-group-join-on-entry) C-1 対応の Firestore Rules emulator validation。
 *
 * 対象:
 *   - `match /tournaments/{tid}` の `allow list` を **group メンバー限定**に狭めた件
 *   - `match /{path=**}/players/{pid}` の `allow read` を **uid 本人限定**に狭めた件
 *
 * 背景: トーナメント受付を消費証明とする `groups/{gid}` self-add
 *   （`hasTournamentEntryProof`）は「tid を知っている = 受付 QR を提示された人」を前提とする。
 *   旧 rule では絞り込みなしの list で全 tid が列挙できたため、
 *   **任意のログインユーザーが任意サークルへ自己加入できる**経路が成立していた。
 *   本 validator はその discovery 経路が塞がれたこと、および
 *   アプリの既存クエリ（`where` で絞った形）が回帰していないことを機械検証する。
 *
 * 起動方法（cwd = repo root）:
 *   firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e \
 *     "node scripts/test-rules-list-scope.mjs"
 *   # または npm script
 *   npm run test:rules-list-scope
 *
 * 検証ケース:
 *   tournaments list:
 *     1. member が `where("groupId","==",gid)` で list → allow（listTournamentsByGroup 回帰）
 *     2. member が絞り込みなしで全件列挙 → deny（discovery 経路の封鎖）
 *     3. 非メンバーが他サークルの gid を明示して list → deny
 *     4. anon が絞り込みなしで list → deny（既存 defense-in-depth の回帰）
 *     5. member の list が **10 access call 上限**に当たらない（15 件返却）→ allow
 *        （list rule はクエリ 1 回につき 1 度評価される = 件数に比例しないことの回帰）
 *   collectionGroup players:
 *     6. `where("uid","==",self)` で list → allow（subscribePlayersByUid 回帰）
 *     7. 絞り込みなしで collectionGroup 列挙 → deny（tid discovery の封鎖）
 *     8. `where("uid","==",他人)` で list → deny
 *   path-specific players（OR 評価で影響を受けないことの回帰）:
 *     9. member が `tournaments/{tid}/players` を subcollection list → allow（listPlayers 回帰）
 *
 * 実装方針: 他の validator と同じく Firestore / Auth エミュレータを REST API で叩き、
 * HTTP status（403 = deny）で判定する。
 */

const PROJECT_ID = "allin-pokertimer-e2e";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

const AUTH_BASE = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1`;
const FS_BASE = `http://${FS_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const API_KEY = "fake-api-key";

/** 案 (b) が「件数に比例しない」ことを示すための seed 件数（10 access call 上限より多くする）。 */
const TOURNAMENTS_PER_GROUP = 15;

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

async function createDoc(idToken, collection, docId, data) {
  const url = `${FS_BASE}/${collection}?documentId=${encodeURIComponent(docId)}`;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fields: fields(data) }),
  });
}

/**
 * runQuery REST endpoint。`fieldPath` / `value` を渡すと `where(field, "==", value)` 相当、
 * 省略すると **絞り込みなしのクエリ**（= 攻撃者の discovery 経路）になる。
 * `allDescendants: true` で collectionGroup query になり `match /{path=**}/...` で評価される。
 */
async function runQuery(idToken, { collectionId, allDescendants = false, field, value, parent }) {
  const structuredQuery = {
    from: [{ collectionId, ...(allDescendants ? { allDescendants: true } : {}) }],
    ...(field
      ? {
          where: {
            fieldFilter: {
              field: { fieldPath: field },
              op: "EQUAL",
              value: { stringValue: value },
            },
          },
        }
      : {}),
  };
  const url = parent ? `${FS_BASE}/${parent}:runQuery` : `${FS_BASE}:runQuery`;
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ structuredQuery }),
  });
}

async function docCount(res) {
  try {
    const j = JSON.parse(await res.text());
    return Array.isArray(j) ? j.filter((x) => x.document).length : 0;
  } catch {
    return -1;
  }
}

async function expectAllow(label, fn, minDocs = 0) {
  const r = await fn();
  if (!r.ok) {
    const body = await r.text();
    results.push({ label, status: `FAIL (expected allow, got ${r.status}): ${body.slice(0, 200)}` });
    return;
  }
  const n = await docCount(r);
  if (n < minDocs) {
    results.push({ label, status: `FAIL (allowed but returned ${n} docs, expected >= ${minDocs})` });
    return;
  }
  results.push({ label, status: `PASS (allow, ${n} docs)` });
}

async function expectDeny(label, fn) {
  const r = await fn();
  if (r.status === 403) {
    results.push({ label, status: "PASS (deny 403)" });
  } else if (r.ok) {
    results.push({ label, status: `FAIL (expected deny, got ${r.status} with ${await docCount(r)} docs)` });
  } else {
    const body = await r.text();
    results.push({ label, status: `FAIL (expected 403, got ${r.status}): ${body.slice(0, 200)}` });
  }
}

function groupSeed(name, ownerUid, memberUids) {
  return {
    name,
    ownerUids: [ownerUid],
    organizerUids: [ownerUid],
    memberUids,
    memberDisplayNames: { [ownerUid]: "Owner" },
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
    joinedViaTournamentId: null,
  };
}

function tournamentSeed(gid, ownerUid, i) {
  return {
    groupId: gid,
    createdByUid: ownerUid,
    name: `Tournament-No.${i}`,
    structureSnapshot: {
      name: "Default",
      initialStack: 10000,
      rebuyStack: null,
      addOnStack: null,
      lateEntryDeadlineLevel: 6,
      levels: [],
    },
    state: "running",
    startedAt: null,
    levelStartedAt: null,
    pausedAt: null,
    pausedAccumMs: 0,
    finishedAt: null,
    currentLevel: 1,
    lateEntryDeadlineLevel: 6,
    seatsPerTable: 9,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function playerSeed(uid, displayName) {
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
  };
}

async function main() {
  const owner = await signUpOrIn("owner-listscope@test.local", "passw0rd");
  const member = await signUpOrIn("member-listscope@test.local", "passw0rd");
  const outsider = await signUpOrIn("outsider-listscope@test.local", "passw0rd");
  const otherOwner = await signUpOrIn("other-owner-listscope@test.local", "passw0rd");

  const stamp = Date.now();
  const gid = `g-listscope-${stamp}`;
  const otherGid = `g-listscope-other-${stamp}`;

  // ── seeds ──────────────────────────────────────────
  const seedG = await createDoc(owner.idToken, "groups", gid, groupSeed("Ours", owner.uid, [owner.uid]));
  if (!seedG.ok) throw new Error(`group seed failed: ${seedG.status} ${await seedG.text()}`);
  const addMember = await fetch(`${FS_BASE}/groups/${gid}?updateMask.fieldPaths=memberUids`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.idToken}` },
    body: JSON.stringify({ fields: fields({ memberUids: [owner.uid, member.uid] }) }),
  });
  if (!addMember.ok) throw new Error(`group expand failed: ${addMember.status}`);

  const seedOther = await createDoc(
    otherOwner.idToken,
    "groups",
    otherGid,
    groupSeed("Theirs", otherOwner.uid, [otherOwner.uid]),
  );
  if (!seedOther.ok) throw new Error(`other group seed failed: ${seedOther.status}`);

  // 10 access call 上限より多い件数を seed する（件数比例で評価されるなら必ず落ちる）。
  const tids = [];
  for (let i = 0; i < TOURNAMENTS_PER_GROUP; i++) {
    const tid = `t-listscope-${stamp}-${i}`;
    const r = await createDoc(owner.idToken, "tournaments", tid, tournamentSeed(gid, owner.uid, i));
    if (!r.ok) throw new Error(`tournament seed (${tid}) failed: ${r.status} ${await r.text()}`);
    tids.push(tid);
  }
  const otherTid = `t-listscope-other-${stamp}`;
  const seedOtherT = await createDoc(
    otherOwner.idToken,
    "tournaments",
    otherTid,
    tournamentSeed(otherGid, otherOwner.uid, 0),
  );
  if (!seedOtherT.ok) throw new Error(`other tournament seed failed: ${seedOtherT.status}`);

  // players: member 本人 + outsider（他人の doc を列挙できないことの検証用）
  for (const [tid, user, name] of [
    [tids[0], member, "Member"],
    [tids[1], member, "Member"],
    [tids[0], outsider, "Outsider"],
  ]) {
    const r = await createDoc(
      user.idToken,
      `tournaments/${tid}/players`,
      user.uid,
      playerSeed(user.uid, name),
    );
    if (!r.ok) throw new Error(`player seed (${tid}) failed: ${r.status} ${await r.text()}`);
  }

  // ── tournaments list ───────────────────────────────
  await expectAllow(
    "(1) member lists tournaments scoped by groupId (listTournamentsByGroup regression)",
    () => runQuery(member.idToken, { collectionId: "tournaments", field: "groupId", value: gid }),
    TOURNAMENTS_PER_GROUP,
  );

  await expectDeny(
    "(2) member enumerates ALL tournaments without a groupId filter (discovery blocked)",
    () => runQuery(member.idToken, { collectionId: "tournaments" }),
  );

  await expectDeny(
    "(3) outsider lists another group's tournaments by explicit groupId",
    () => runQuery(outsider.idToken, { collectionId: "tournaments", field: "groupId", value: gid }),
  );

  await expectDeny(
    "(4) anon enumerates tournaments (existing defense-in-depth regression)",
    () => runQuery(null, { collectionId: "tournaments" }),
  );

  // (5) は (1) の returned docs 数で担保済み（>= 15 件 = 10 access call 上限に当たっていない）。
  results.push({
    label: `(5) scoped list returns ${TOURNAMENTS_PER_GROUP} docs without hitting the 10 access-call limit`,
    status: results[0].status.startsWith("PASS")
      ? "PASS (covered by case 1)"
      : "FAIL (case 1 did not pass)",
  });

  // ── collectionGroup players ────────────────────────
  await expectAllow(
    "(6) member lists own players via collectionGroup where(uid==self) (subscribePlayersByUid regression)",
    () =>
      runQuery(member.idToken, {
        collectionId: "players",
        allDescendants: true,
        field: "uid",
        value: member.uid,
      }),
    2,
  );

  await expectDeny(
    "(7) member enumerates ALL players via collectionGroup (tid discovery blocked)",
    () => runQuery(member.idToken, { collectionId: "players", allDescendants: true }),
  );

  await expectDeny(
    "(8) member lists someone else's players via collectionGroup where(uid==other)",
    () =>
      runQuery(member.idToken, {
        collectionId: "players",
        allDescendants: true,
        field: "uid",
        value: outsider.uid,
      }),
  );

  // ── path-specific players（OR 評価で影響を受けないことの回帰） ──
  await expectAllow(
    "(9) member lists tournaments/{tid}/players as a subcollection (listPlayers regression)",
    () =>
      runQuery(member.idToken, {
        collectionId: "players",
        parent: `tournaments/${tids[0]}`,
      }),
    2,
  );

  // ────────────────────────────────────────────────
  console.log("\n=== Firestore Rules: tournaments / players list scope validation ===");
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
