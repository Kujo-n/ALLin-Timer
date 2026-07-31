/**
 * Phase 1 (08-auto-group-join-on-entry) Firestore Rules emulator validation for
 * `groups/{gid}` の第 2 self-add ブランチ（トーナメント受付を消費証明とした自動所属）。
 *
 * 起動方法（cwd = repo root）:
 *   firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e \
 *     "node scripts/test-rules-tournament-join.mjs"
 *   # または npm script
 *   npm run test:rules-tournament-join
 *
 * 検証ケース（deny を先に、allow を後に実行する — allow は memberUids を変えるため）:
 *   deny:
 *     4. 匿名アカウント（player doc あり）が加入 → deny（isSignedInNotAnon）
 *     5. player doc を持たないユーザーが加入 → deny（proof なし）
 *     6. 別サークルの tid を proof に使う → deny（groupId == gid 違反）
 *     7. 存在しない tid を proof に使う → deny（exists 違反）
 *     8. finished tournament の tid を proof に使う（player doc あり）→ deny（state ガード）
 *     9. 加入と同時に organizerUids へ自分を追加 → deny（昇格阻止）
 *    10. 加入と同時に name を書換 → deny（affectedKeys）
 *    11. 加入と同時に finishedTournamentCount を書換 → deny（affectedKeys）
 *    12. memberDisplayNames に 16 字を書く → deny（size() <= 15）
 *    13. memberDisplayNames に他人のキーを書く → deny（self-key 限定）
 *    14. 既メンバーが同じ書込を行う → deny（!(uid in resource.data.memberUids)）
 *    15. joinedViaTournamentId 抜きで memberUids だけ +1 → deny（proof なし）
 *   allow:
 *     1. 通常アカウント（player doc あり・running）が加入 → allow
 *     2. 別の通常アカウントが同 tid で加入 → allow
 *     3. setup state の tournament 経由で加入 → allow
 *    16. 非回帰: 既メンバーの self-key displayName 更新（既存ブランチ）→ allow
 *
 * 実装方針: test-rules-proxy-create.mjs と同じく Firestore / Auth エミュレータを REST API で叩く。
 * Firestore Web SDK の updateDoc は emulator 下で楽観 resolve することがあるため、
 * HTTP status（403 = deny）で判定する。
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

/**
 * 匿名ユーザーを作る。email/password を渡さない accounts:signUp が
 * signInAnonymously と同じ経路で、token の firebase.sign_in_provider は 'anonymous' になる。
 * rule の isSignedInNotAnon() が正しく効いているかの検証に使う。
 */
async function signUpAnonymous() {
  const r = await fetch(`${AUTH_BASE}/accounts:signUp?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`anon auth: ${JSON.stringify(j)}`);
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
    return true;
  }
  const body = await r.text();
  results.push({
    label,
    status: `FAIL (expected allow, got ${r.status}): ${body.slice(0, 200)}`,
  });
  return false;
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
    name: "Auto Join Test Tournament",
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
    currentLevel: state === "setup" || state === "seating" ? 0 : 1,
    lateEntryDeadlineLevel: 6,
    seatsPerTable: 9,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function groupSeed(name, ownerUid, ownerDisplayName) {
  return {
    name,
    ownerUids: [ownerUid],
    organizerUids: [ownerUid],
    memberUids: [ownerUid],
    memberDisplayNames: { [ownerUid]: ownerDisplayName },
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
    // Phase 1 (08-auto-group-join-on-entry): schema と揃えて null で seed する。
    joinedViaTournamentId: null,
  };
}

async function main() {
  const owner = await signUpOrIn("owner-autojoin@test.local", "passw0rd");
  const member = await signUpOrIn("member-autojoin@test.local", "passw0rd");
  const newbie = await signUpOrIn("newbie-autojoin@test.local", "passw0rd");
  const newbie2 = await signUpOrIn("newbie2-autojoin@test.local", "passw0rd");
  const newbie3 = await signUpOrIn("newbie3-autojoin@test.local", "passw0rd");
  const stranger = await signUpOrIn("stranger-autojoin@test.local", "passw0rd");
  const otherOwner = await signUpOrIn("other-owner-autojoin@test.local", "passw0rd");
  const anon = await signUpAnonymous();

  console.log(
    `uids:  owner=${owner.uid.slice(0, 6)}  member=${member.uid.slice(0, 6)}  ` +
      `newbie=${newbie.uid.slice(0, 6)}  anon=${anon.uid.slice(0, 6)}`,
  );

  const stamp = Date.now();

  // ── group seeds ────────────────────────────────────────────
  const gid = `g-autojoin-${stamp}`;
  const seedG = await createDoc(
    owner.idToken,
    "groups",
    gid,
    groupSeed("Auto Join Test Group", owner.uid, "Owner"),
  );
  if (!seedG.ok) {
    throw new Error(`group seed failed: ${seedG.status} ${await seedG.text()}`);
  }
  // owner-update 経路で既メンバー（member）を 1 人足しておく。
  const expandG = await patchDoc(owner.idToken, `groups/${gid}`, {
    memberUids: [owner.uid, member.uid],
    memberDisplayNames: { [owner.uid]: "Owner", [member.uid]: "Member" },
  });
  if (!expandG.ok) {
    throw new Error(`group expand failed: ${expandG.status} ${await expandG.text()}`);
  }

  const otherGid = `g-autojoin-other-${stamp}`;
  const seedOtherG = await createDoc(
    otherOwner.idToken,
    "groups",
    otherGid,
    groupSeed("Other Group", otherOwner.uid, "OtherOwner"),
  );
  if (!seedOtherG.ok) {
    throw new Error(`other group seed failed: ${seedOtherG.status} ${await seedOtherG.text()}`);
  }

  // ── tournament seeds ───────────────────────────────────────
  const tidRunning = `t-autojoin-running-${stamp}`;
  const tidSetup = `t-autojoin-setup-${stamp}`;
  const tidFinished = `t-autojoin-finished-${stamp}`;
  const tidOther = `t-autojoin-other-${stamp}`;
  const tidMissing = `t-autojoin-missing-${stamp}`;

  for (const [tid, state] of [
    [tidRunning, "running"],
    [tidSetup, "setup"],
    // finished は「running で受付 → 終了」の実運用順序で seed する（self-create に state 条件は
    // 無いが、将来 rule が締まっても seed が壊れないようにする）。
    [tidFinished, "running"],
  ]) {
    const seed = await createDoc(
      owner.idToken,
      "tournaments",
      tid,
      tournamentSeed(state, gid, owner.uid),
    );
    if (!seed.ok) {
      throw new Error(`tournament seed (${tid}) failed: ${seed.status} ${await seed.text()}`);
    }
  }
  const seedOtherT = await createDoc(
    otherOwner.idToken,
    "tournaments",
    tidOther,
    tournamentSeed("running", otherGid, otherOwner.uid),
  );
  if (!seedOtherT.ok) {
    throw new Error(`other tournament seed failed: ${seedOtherT.status} ${await seedOtherT.text()}`);
  }

  // ── player seeds（self-create） ─────────────────────────────
  const playerSeeds = [
    [tidRunning, newbie, "Newbie"],
    [tidRunning, newbie2, "Newbie2"],
    [tidRunning, member, "Member"],
    [tidRunning, anon, "Anon"],
    [tidSetup, newbie3, "Newbie3"],
    [tidFinished, newbie, "Newbie"],
    [tidOther, newbie2, "Newbie2"],
  ];
  for (const [tid, user, name] of playerSeeds) {
    const seed = await createDoc(
      user.idToken,
      `tournaments/${tid}/players`,
      user.uid,
      basePlayer(user.uid, name),
    );
    if (!seed.ok) {
      throw new Error(`player seed (${tid}/${name}) failed: ${seed.status} ${await seed.text()}`);
    }
  }
  // tidFinished を終了状態へ遷移させる（organizer 経路）。
  const finishT = await patchDoc(owner.idToken, `tournaments/${tidFinished}`, {
    state: "finished",
    finishedAt: new Date(),
  });
  if (!finishT.ok) {
    throw new Error(`tournament finish failed: ${finishT.status} ${await finishT.text()}`);
  }

  // seed 時点の group 状態（REST PATCH は arrayUnion を使えないため完全な配列を組み立てる）
  let members = [owner.uid, member.uid];
  let displayNames = { [owner.uid]: "Owner", [member.uid]: "Member" };

  /** 自動所属の標準ペイロード（memberUids +1 / proof / self-key displayName）。 */
  function joinPayload(uid, name, tid, overrides = {}) {
    return {
      memberUids: [...members, uid],
      joinedViaTournamentId: tid,
      memberDisplayNames: { ...displayNames, [uid]: name },
      ...overrides,
    };
  }

  // ────────────────────────────────────────────────
  // deny ケース（group の状態を変えないので先に実行する）
  // ────────────────────────────────────────────────

  await expectDeny(
    "(4) anonymous account with a player doc tries to auto-join (deny — isSignedInNotAnon)",
    () => patchDoc(anon.idToken, `groups/${gid}`, joinPayload(anon.uid, "Anon", tidRunning)),
  );

  await expectDeny(
    "(5) user without a player doc tries to auto-join (deny — no entry proof)",
    () =>
      patchDoc(
        stranger.idToken,
        `groups/${gid}`,
        joinPayload(stranger.uid, "Stranger", tidRunning),
      ),
  );

  await expectDeny(
    "(6) tid of another group used as proof (deny — groupId mismatch)",
    () =>
      patchDoc(newbie2.idToken, `groups/${gid}`, joinPayload(newbie2.uid, "Newbie2", tidOther)),
  );

  await expectDeny(
    "(7) non-existent tid used as proof (deny — exists guard)",
    () =>
      patchDoc(newbie.idToken, `groups/${gid}`, joinPayload(newbie.uid, "Newbie", tidMissing)),
  );

  await expectDeny(
    "(8) finished tournament used as proof (deny — state guard)",
    () =>
      patchDoc(newbie.idToken, `groups/${gid}`, joinPayload(newbie.uid, "Newbie", tidFinished)),
  );

  await expectDeny(
    "(9) auto-join while promoting self into organizerUids (deny)",
    () =>
      patchDoc(
        newbie.idToken,
        `groups/${gid}`,
        joinPayload(newbie.uid, "Newbie", tidRunning, {
          organizerUids: [owner.uid, newbie.uid],
        }),
      ),
  );

  await expectDeny(
    "(10) auto-join while renaming the group (deny — affectedKeys)",
    () =>
      patchDoc(
        newbie.idToken,
        `groups/${gid}`,
        joinPayload(newbie.uid, "Newbie", tidRunning, { name: "Hijacked" }),
      ),
  );

  await expectDeny(
    "(11) auto-join while rewriting finishedTournamentCount (deny — affectedKeys)",
    () =>
      patchDoc(
        newbie.idToken,
        `groups/${gid}`,
        joinPayload(newbie.uid, "Newbie", tidRunning, { finishedTournamentCount: 99 }),
      ),
  );

  await expectDeny(
    "(12) auto-join with a 16-char displayName (deny — size() <= 15)",
    () =>
      patchDoc(
        newbie.idToken,
        `groups/${gid}`,
        joinPayload(newbie.uid, "0123456789abcdef", tidRunning),
      ),
  );

  await expectDeny(
    "(13) auto-join while rewriting another member's displayName (deny — self-key only)",
    () =>
      patchDoc(
        newbie.idToken,
        `groups/${gid}`,
        joinPayload(newbie.uid, "Newbie", tidRunning, {
          memberDisplayNames: {
            ...displayNames,
            [owner.uid]: "Hacked",
            [newbie.uid]: "Newbie",
          },
        }),
      ),
  );

  await expectDeny(
    "(14) existing member replays the auto-join write (deny — already in memberUids)",
    () =>
      patchDoc(member.idToken, `groups/${gid}`, joinPayload(member.uid, "Member", tidRunning)),
  );

  await expectDeny(
    "(15) memberUids +1 without joinedViaTournamentId (deny — no proof at all)",
    () =>
      patchDoc(newbie.idToken, `groups/${gid}`, {
        memberUids: [...members, newbie.uid],
        memberDisplayNames: { ...displayNames, [newbie.uid]: "Newbie" },
      }),
  );

  // ────────────────────────────────────────────────
  // allow ケース（memberUids を伸ばすので後に実行する）
  // ────────────────────────────────────────────────

  if (
    await expectAllow(
      "(1) normal account with a player doc auto-joins via running tournament",
      () =>
        patchDoc(newbie.idToken, `groups/${gid}`, joinPayload(newbie.uid, "Newbie", tidRunning)),
    )
  ) {
    members = [...members, newbie.uid];
    displayNames = { ...displayNames, [newbie.uid]: "Newbie" };
  }

  if (
    await expectAllow(
      "(2) a second normal account auto-joins via the same tournament",
      () =>
        patchDoc(
          newbie2.idToken,
          `groups/${gid}`,
          joinPayload(newbie2.uid, "Newbie2", tidRunning),
        ),
    )
  ) {
    members = [...members, newbie2.uid];
    displayNames = { ...displayNames, [newbie2.uid]: "Newbie2" };
  }

  if (
    await expectAllow(
      "(3) auto-join via a setup-state tournament",
      () =>
        patchDoc(
          newbie3.idToken,
          `groups/${gid}`,
          joinPayload(newbie3.uid, "Newbie3", tidSetup),
        ),
    )
  ) {
    members = [...members, newbie3.uid];
    displayNames = { ...displayNames, [newbie3.uid]: "Newbie3" };
  }

  await expectAllow(
    "(16) no regression: existing member still updates own memberDisplayNames entry",
    () =>
      patchDoc(member.idToken, `groups/${gid}`, {
        memberDisplayNames: { ...displayNames, [member.uid]: "Member2" },
      }),
  );

  // ────────────────────────────────────────────────
  console.log("\n=== Firestore Rules: groups self-add via tournament entry validation ===");
  for (const r of results) {
    const ok = r.status.startsWith("PASS");
    console.log(
      `  ${ok ? "[OK]  " : r.status.startsWith("SKIP") ? "[SKIP]" : "[FAIL]"} ${r.label} — ${r.status}`,
    );
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
