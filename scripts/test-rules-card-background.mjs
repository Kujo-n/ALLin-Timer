/**
 * Phase A.1 (05-post-launch-polish Track A) Firestore Rules emulator validation
 * for `groups/{gid}.winnerCardBackground` / `groups/{gid}.seasonCardBackground`.
 *
 * 起動方法（cwd = repo root、emulator は firebase emulators:exec から起動）:
 *   firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e \
 *     "node scripts/test-rules-card-background.mjs"
 *
 * 実装方針: test-rules-default-seats.mjs と同じ REST 直叩き + HTTP ステータス判定。
 *   - Auth: `accounts:signUp` で複数ユーザーを発行し idToken を取得
 *   - Firestore: `Authorization: Bearer <idToken>` を付けて PATCH/POST/GET
 *   - 200 系 = allow、403 = deny として assert
 *
 * 検証ケース:
 *   1. owner が winnerCardBackground=null セット — allow
 *   2. owner が winnerCardBackground={imageUrl,storageAssetId,textTheme:"light"} — allow
 *   3. owner が winnerCardBackground.textTheme="dark" — allow
 *   4. owner が winnerCardBackground.textTheme="auto"（無効値）— allow
 *      ⚠ 既知の design limitation: 新規の narrow `isOwner` ブランチは textTheme を
 *      'light' | 'dark' のリテラル enum に限定するが、owner には先行する broad
 *      owner-update ブランチが既に「全フィールド書換可」で match する。そのため
 *      owner からは narrow ブランチの enum 制約を実質的に bypass できる。
 *      これは [firestore.rules](../firestore.rules) 上のコメントにも
 *      明示済みで、将来 Cloud Functions 化で owner-update を狭めるための足場として
 *      narrow ブランチを残している。application 層（schema / service）が最終ライン。
 *   5. owner が winnerCardBackground + name 同時書換 — allow（owner-update branch を踏むため）
 *   6. organizer が winnerCardBackground=null — deny（isOwner 違反）
 *   7. member が winnerCardBackground=null — deny
 *   8. owner が seasonCardBackground={...}（winner と対称） — allow
 *   9. organizer が seasonCardBackground=null — deny
 *  10. legacy doc（winnerCardBackground フィールド不在）へ owner 初回 set — allow
 *  11. owner branch のフルアクセス（name + winnerCardBackground 同時）— allow
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
  const owner = await signUpOrIn("owner@test.local", "passw0rd");
  const org = await signUpOrIn("organizer@test.local", "passw0rd");
  const member = await signUpOrIn("member@test.local", "passw0rd");

  console.log(
    `uids:  owner=${owner.uid.slice(0, 6)}  org=${org.uid.slice(0, 6)}  member=${member.uid.slice(0, 6)}`,
  );

  // owner として group を seed（rule の create branch を通す）
  const gid = `g-card-${Date.now()}`;
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
    winnerCardBackground: null,
    seasonCardBackground: null,
  });
  if (!seed.ok) {
    const body = await seed.text();
    throw new Error(`seed create failed: ${seed.status} ${body}`);
  }

  // owner が memberUids / organizerUids を拡張（owner full-update branch）
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

  // ─────────────────────────────────────────────
  // 1. owner sets winnerCardBackground=null — allow
  await expectAllow("(1) owner sets winnerCardBackground=null", () =>
    patchDoc(owner.idToken, `groups/${gid}`, { winnerCardBackground: null }),
  );

  // 2. owner sets full winner background object (textTheme=light) — allow
  await expectAllow("(2) owner sets winner background (textTheme=light)", () =>
    patchDoc(owner.idToken, `groups/${gid}`, {
      winnerCardBackground: {
        imageUrl: "https://example.com/winner.jpg",
        storageAssetId: "asset-w-1",
        textTheme: "light",
      },
    }),
  );

  // 3. owner toggles textTheme to dark — allow
  await expectAllow("(3) owner sets winner background (textTheme=dark)", () =>
    patchDoc(owner.idToken, `groups/${gid}`, {
      winnerCardBackground: {
        imageUrl: "https://example.com/winner.jpg",
        storageAssetId: "asset-w-1",
        textTheme: "dark",
      },
    }),
  );

  // 4. owner sets invalid textTheme="auto" — allow（既知の design limitation）
  //    narrow `isOwner` ブランチは 'light' | 'dark' に限定しているが、owner は先行する
  //    broad owner-update ブランチを踏むため、narrow ブランチの enum 制約は bypass される。
  //    本ケースは「現状 rule で owner 経由の不正 textTheme は block できない」ことを
  //    明示的に固定化（characterization）する。application 層（zod schema / service）が
  //    最終ラインで、Phase A.2 の UI から不正値が送られない設計で防御する。
  await expectAllow("(4) owner sets textTheme=auto (allow: owner-update branch bypasses narrow enum check)", () =>
    patchDoc(owner.idToken, `groups/${gid}`, {
      winnerCardBackground: {
        imageUrl: "https://example.com/winner.jpg",
        storageAssetId: "asset-w-1",
        textTheme: "auto",
      },
    }),
  );

  // 5. owner が name + winnerCardBackground を同時書換 — allow（owner-update branch を踏むため）
  await expectAllow("(5) owner full-update branch via name + winnerCardBackground", () =>
    patchDoc(owner.idToken, `groups/${gid}`, {
      name: "Renamed",
      winnerCardBackground: {
        imageUrl: "https://example.com/x.jpg",
        storageAssetId: "asset-w-2",
        textTheme: "light",
      },
    }),
  );

  // 6. organizer attempts winnerCardBackground=null — deny (isOwner 違反)
  await expectDeny("(6) organizer sets winnerCardBackground=null (deny: not owner)", () =>
    patchDoc(org.idToken, `groups/${gid}`, { winnerCardBackground: null }),
  );

  // 7. member attempts winnerCardBackground=null — deny
  await expectDeny("(7) member sets winnerCardBackground=null (deny: not owner)", () =>
    patchDoc(member.idToken, `groups/${gid}`, { winnerCardBackground: null }),
  );

  // 8. owner sets seasonCardBackground object — allow (winner と対称)
  await expectAllow("(8) owner sets seasonCardBackground (full object)", () =>
    patchDoc(owner.idToken, `groups/${gid}`, {
      seasonCardBackground: {
        imageUrl: "https://example.com/season.jpg",
        storageAssetId: "asset-s-1",
        textTheme: "dark",
      },
    }),
  );

  // 9. organizer attempts seasonCardBackground=null — deny
  await expectDeny("(9) organizer sets seasonCardBackground=null (deny: not owner)", () =>
    patchDoc(org.idToken, `groups/${gid}`, { seasonCardBackground: null }),
  );

  // 10. legacy doc (winnerCardBackground 不在) を seed して owner 初回 set — allow
  const legacyGid = `g-card-legacy-${Date.now()}`;
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
    defaultSeatsPerTable: 8,
    // winnerCardBackground / seasonCardBackground は意図的に省略（旧 doc 想定）
    createdAt: new Date(),
    joinCodeId: null,
  });
  if (!seedLegacy.ok) {
    const body = await seedLegacy.text();
    throw new Error(`legacy seed failed: ${seedLegacy.status} ${body}`);
  }
  await expectAllow("(10) legacy doc — owner sets winnerCardBackground first time", () =>
    patchDoc(owner.idToken, `groups/${legacyGid}`, {
      winnerCardBackground: {
        imageUrl: "https://example.com/legacy.jpg",
        storageAssetId: "asset-legacy",
        textTheme: "light",
      },
    }),
  );

  // 11. owner branch full-access — name + seasonCardBackground 同時 — allow
  await expectAllow("(11) owner full-update branch (name + seasonCardBackground)", () =>
    patchDoc(owner.idToken, `groups/${gid}`, {
      name: "Renamed Again",
      seasonCardBackground: null,
    }),
  );

  // ─────────────────────────────────────────────
  console.log("\n=== Firestore Rules: card background validation ===");
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
