/**
 * Phase A.1 (05-post-launch-polish Track A) Storage Rules emulator validation
 * for `groups/{gid}/bgImages/{assetId}` path.
 *
 * 起動方法（cwd = repo root、emulator は firebase emulators:exec から起動）:
 *   firebase emulators:exec --only auth,firestore,storage --project allin-pokertimer-e2e \
 *     "node scripts/test-storage-rules.mjs"
 *
 * 実装方針:
 *   Storage Emulator は Firebase Storage Web API 互換の REST endpoint
 *   (`http://127.0.0.1:9199/v0/b/{bucket}/o`) を提供する。本 script は fetch で直接叩き、
 *   HTTP ステータスで allow / deny を判定する（test-rules-card-background.mjs と同方針）。
 *
 *   - Auth: identitytoolkit で idToken 取得（test-rules-card-background.mjs と共通）
 *   - Firestore: storage.rules の `firestore.get` で参照する groups/{gid} を seed
 *   - Storage REST: `Authorization: Firebase <idToken>` を付けて POST/GET/DELETE
 *     - 200 系 = allow
 *     - 403 = deny として assert
 *   - upload は **2-step resumable upload プロトコル**（`X-Goog-Upload-Protocol: resumable`
 *     → セッション URL 取得 → `upload, finalize` で body 送信）を使う。
 *     Storage Emulator は raw POST に対し `contentType` を `application/octet-stream` に
 *     固定するため、`X-Goog-Upload-Header-Content-Type` で実 contentType を渡す必要がある
 *     （Firebase Web SDK `uploadBytes` と同方式）。
 *
 * 検証ケース:
 *   1. anon が groups/{gid}/bgImages/asset-1 を read — allow（public read）
 *   2. owner が image/jpeg (< 1MB) を upload — allow
 *   3. organizer が同上 upload — deny（non-owner）
 *   4. member が同上 upload — deny
 *   5. unauthenticated が upload — deny
 *   6. owner が image/jpeg (> 1MB) を upload — deny（size 違反）
 *   7. owner が text/plain を upload — deny（content-type 違反）
 *   8. owner が groups/{gid}/otherImages/asset-1 へ upload — deny（path 違反）
 *   9. owner が既存 asset を delete — allow
 *  10. organizer が既存 asset を delete — deny
 */

const PROJECT_ID = "allin-pokertimer-e2e";
const BUCKET = `${PROJECT_ID}.appspot.com`;
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
const STORAGE_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? "127.0.0.1:9199";

const AUTH_BASE = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1`;
const FS_BASE = `http://${FS_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const STORAGE_BASE = `http://${STORAGE_HOST}/v0/b/${BUCKET}/o`;
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

// Firestore REST 値変換
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

async function createFirestoreDoc(idToken, collection, docId, data) {
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

async function patchFirestoreDoc(idToken, path, data) {
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

// Storage REST helpers
// Firebase Storage Emulator は raw POST に対し `contentType` を `application/octet-stream`
// で固定する。Firebase Web SDK が使う 2-step resumable upload プロトコルを REST で再現し、
// 1) `X-Goog-Upload-Command: start` でセッション URL を発行、
// 2) 同セッションへ `upload, finalize` で本体を送信、
// `X-Goog-Upload-Header-Content-Type` で実 contentType を指定する。
async function uploadObject(idToken, objectPath, contentType, body) {
  const startUrl = `${STORAGE_BASE}?name=${encodeURIComponent(objectPath)}`;
  const startHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    "X-Goog-Upload-Protocol": "resumable",
    "X-Goog-Upload-Command": "start",
    "X-Goog-Upload-Header-Content-Type": contentType,
    "X-Goog-Upload-Header-Content-Length": String(body.length),
  };
  if (idToken) startHeaders["Authorization"] = `Firebase ${idToken}`;
  const startBody = JSON.stringify({ name: objectPath, contentType });
  const startResp = await fetch(startUrl, {
    method: "POST",
    headers: startHeaders,
    body: startBody,
  });
  if (!startResp.ok) {
    // Rule deny is observable here (auth/path failures fail at the start phase).
    if (process.env.STORAGE_DEBUG) {
      const t = await startResp.clone().text();
      console.log(
        `  upload start ${objectPath} (${contentType}, ${body.length}B) -> ${startResp.status}: ${t.slice(0, 200)}`,
      );
    }
    return startResp;
  }
  const sessionUrl =
    startResp.headers.get("x-goog-upload-url") ||
    startResp.headers.get("X-Goog-Upload-URL");
  if (!sessionUrl) {
    // Emulator returned 200 but no session URL — treat as failure for the test harness.
    return new Response("missing X-Goog-Upload-URL", { status: 500 });
  }
  const uploadHeaders = {
    "Content-Type": contentType,
    "X-Goog-Upload-Command": "upload, finalize",
    "X-Goog-Upload-Offset": "0",
  };
  if (idToken) uploadHeaders["Authorization"] = `Firebase ${idToken}`;
  const r = await fetch(sessionUrl, {
    method: "POST",
    headers: uploadHeaders,
    body,
  });
  if (!r.ok && process.env.STORAGE_DEBUG) {
    const text = await r.clone().text();
    console.log(
      `  upload finalize ${objectPath} (${contentType}, ${body.length}B) -> ${r.status}: ${text.slice(0, 200)}`,
    );
  }
  return r;
}

async function readObject(idToken, objectPath) {
  const url = `${STORAGE_BASE}/${encodeURIComponent(objectPath)}?alt=media`;
  const headers = {};
  if (idToken) headers["Authorization"] = `Firebase ${idToken}`;
  return fetch(url, { method: "GET", headers });
}

async function deleteObject(idToken, objectPath) {
  const url = `${STORAGE_BASE}/${encodeURIComponent(objectPath)}`;
  const headers = {};
  if (idToken) headers["Authorization"] = `Firebase ${idToken}`;
  return fetch(url, { method: "DELETE", headers });
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
      status: `FAIL (expected 401/403, got ${r.status}): ${body.slice(0, 200)}`,
    });
  }
}

// 最小サイズの JPEG（SOI + APP0 + EOI のみ。Storage emulator は content-type ヘッダで
// MIME を判別するため画像 validity は不要だが、念のため magic byte を含めておく）。
const SMALL_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);
const LARGE_JPEG = Buffer.concat([SMALL_JPEG, Buffer.alloc(1024 * 1024, 0)]); // > 1MB
const SMALL_TEXT = Buffer.from("hello world", "utf-8");

async function main() {
  const owner = await signUpOrIn("storage-owner@test.local", "passw0rd");
  const org = await signUpOrIn("storage-organizer@test.local", "passw0rd");
  const member = await signUpOrIn("storage-member@test.local", "passw0rd");

  console.log(
    `uids:  owner=${owner.uid.slice(0, 6)}  org=${org.uid.slice(0, 6)}  member=${member.uid.slice(0, 6)}`,
  );

  // owner として group を seed（storage.rules の firestore.get で参照される）
  const gid = `g-stor-${Date.now()}`;
  const seed = await createFirestoreDoc(owner.idToken, "groups", gid, {
    name: "Storage Test Group",
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
    throw new Error(`firestore seed create failed: ${seed.status} ${body}`);
  }
  const expand = await patchFirestoreDoc(owner.idToken, `groups/${gid}`, {
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
    throw new Error(`firestore seed expand failed: ${expand.status} ${body}`);
  }

  const validPath = `groups/${gid}/bgImages/asset-1`;
  const validPath2 = `groups/${gid}/bgImages/asset-2`;
  const denyPathOtherDir = `groups/${gid}/otherImages/asset-x`;
  const deletePath9 = `groups/${gid}/bgImages/asset-for-delete-9`;
  const deletePath10 = `groups/${gid}/bgImages/asset-for-delete-10`;

  // ─────────────────────────────────────────────
  // 2. owner uploads image/jpeg (< 1MB) — allow（先に asset を作成）
  await expectAllow("(2) owner uploads image/jpeg < 1MB", () =>
    uploadObject(owner.idToken, validPath, "image/jpeg", SMALL_JPEG),
  );

  // 1. anon reads asset-1 — allow（public read）
  await expectAllow("(1) anon reads bgImage (public)", () =>
    readObject(null, validPath),
  );

  // 3. organizer uploads (override) — deny
  await expectDeny("(3) organizer uploads (deny: not owner)", () =>
    uploadObject(org.idToken, validPath, "image/jpeg", SMALL_JPEG),
  );

  // 4. member uploads (override) — deny
  await expectDeny("(4) member uploads (deny: not owner)", () =>
    uploadObject(member.idToken, validPath, "image/jpeg", SMALL_JPEG),
  );

  // 5. unauthenticated uploads — deny
  await expectDeny("(5) anon uploads (deny: not signed in)", () =>
    uploadObject(null, validPath, "image/jpeg", SMALL_JPEG),
  );

  // 6. owner uploads > 1MB — deny (size 違反)
  await expectDeny("(6) owner uploads > 1MB (deny: size)", () =>
    uploadObject(owner.idToken, validPath2, "image/jpeg", LARGE_JPEG),
  );

  // 7. owner uploads text/plain — deny (content-type 違反)
  await expectDeny("(7) owner uploads text/plain (deny: content-type)", () =>
    uploadObject(owner.idToken, validPath2, "text/plain", SMALL_TEXT),
  );

  // 8. owner uploads to non-bgImages subpath — deny (path 違反、deny-by-default)
  await expectDeny("(8) owner uploads to otherImages (deny: path)", () =>
    uploadObject(owner.idToken, denyPathOtherDir, "image/jpeg", SMALL_JPEG),
  );

  // 9. owner deletes own asset — allow（事前 seed が必要）
  const seedDel9 = await uploadObject(owner.idToken, deletePath9, "image/jpeg", SMALL_JPEG);
  if (!seedDel9.ok) {
    throw new Error(`seed asset-for-delete-9 failed: ${seedDel9.status}`);
  }
  await expectAllow("(9) owner deletes own bgImage", () =>
    deleteObject(owner.idToken, deletePath9),
  );

  // 10. organizer attempts delete on a different asset (still existing) — deny
  const seedDel10 = await uploadObject(owner.idToken, deletePath10, "image/jpeg", SMALL_JPEG);
  if (!seedDel10.ok) {
    throw new Error(`seed asset-for-delete-10 failed: ${seedDel10.status}`);
  }
  await expectDeny("(10) organizer deletes asset (deny: not owner)", () =>
    deleteObject(org.idToken, deletePath10),
  );

  // ─────────────────────────────────────────────
  console.log("\n=== Storage Rules: card background validation ===");
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
