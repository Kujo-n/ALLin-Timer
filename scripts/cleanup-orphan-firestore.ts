#!/usr/bin/env tsx
/**
 * Cleanup script: 本番 Firestore から orphan / expired データを検出・削除する。
 *
 * 対象:
 *   1. Orphan tournaments — `tournaments/{tid}.groupId` が指す `groups/{gid}` が存在しない
 *      → `tournaments/{tid}` を recursive delete（`players` / `tables` 配下も自動削除）
 *   2. Orphan players — `tournaments/{tid}/players/{pid}` で親 tournament が存在しない
 *      （orphan tournament 配下のものは step 1 で recursive 削除されるため除外）
 *   3. Orphan structures — `structures/{sid}.groupId` が指す `groups/{gid}` が存在しない
 *   4. Expired groupJoinCodes — `expiresAt < now`
 *   5. Orphan users — `users/{uid}` の doc id が Firebase Auth に存在しない
 *      （e2e テストで作成後、Auth は削除済みだが Firestore に残った doc 等）
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     npm run cleanup:orphan-firestore                # dry-run（既定）
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     npm run cleanup:orphan-firestore -- --execute   # 実削除
 *
 *   # 特定カテゴリだけ操作したいときは --only=... で絞れる（カンマ区切り）
 *   #   --only=tournaments,players,structures,joinCodes,users
 *
 * Prerequisites:
 *   - service-account.json（Firebase Console > プロジェクト設定 > サービスアカウント。gitignore 済み）
 *   - Admin SDK 経由のため Security Rules を bypass する（プロダクトコードからは絶対呼ばない）
 */
import admin from "firebase-admin";

type Category = "tournaments" | "players" | "structures" | "joinCodes" | "users";
const ALL_CATEGORIES: readonly Category[] = [
  "tournaments",
  "players",
  "structures",
  "joinCodes",
  "users",
];

interface OrphanTournament {
  id: string;
  groupId: string | null;
  state: string | null;
  name: string | null;
  createdAt: string | null;
}

interface OrphanPlayer {
  tid: string;
  pid: string;
  displayName: string | null;
}

interface OrphanStructure {
  id: string;
  groupId: string | null;
  name: string | null;
}

interface ExpiredJoinCode {
  id: string;
  gid: string | null;
  expiresAt: string;
}

interface OrphanUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  groupIds: string[];
  createdAt: string | null;
}

interface GroupCleanup {
  gid: string;
  name: string;
  removeMembers: string[];
  removeOrganizers: string[];
  removeOwners: string[];
  removeDisplayNameKeys: string[];
  remainingOwnerUids: string[];
  isFullyOrphan: boolean; // 全 owner が dangling → group 自体を recursive delete
}

async function listAllAuthUids(): Promise<Set<string>> {
  const uids = new Set<string>();
  let pageToken: string | undefined;
  do {
    const result = await admin.auth().listUsers(1000, pageToken);
    for (const u of result.users) uids.add(u.uid);
    pageToken = result.pageToken;
  } while (pageToken);
  return uids;
}

function parseOnly(argv: string[]): Set<Category> {
  const arg = argv.find((a) => a.startsWith("--only="));
  if (!arg) return new Set(ALL_CATEGORIES);
  const raw = arg.slice("--only=".length).split(",").map((s) => s.trim());
  const out = new Set<Category>();
  for (const v of raw) {
    if ((ALL_CATEGORIES as readonly string[]).includes(v)) out.add(v as Category);
    else {
      console.error(`unknown category in --only: ${v}`);
      process.exit(1);
    }
  }
  return out;
}

function fmtTs(v: unknown): string | null {
  if (v instanceof admin.firestore.Timestamp) return v.toDate().toISOString();
  if (
    v &&
    typeof v === "object" &&
    "_seconds" in (v as Record<string, unknown>)
  ) {
    const s = (v as { _seconds: number })._seconds;
    return new Date(s * 1000).toISOString();
  }
  return null;
}

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  const mode = execute ? "EXECUTE" : "DRY-RUN";
  const only = parseOnly(process.argv);

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error("ERROR: GOOGLE_APPLICATION_CREDENTIALS is not set.");
    console.error(
      "  例: GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npm run cleanup:orphan-firestore",
    );
    process.exit(1);
  }

  admin.initializeApp({ credential: admin.credential.applicationDefault() });
  const db = admin.firestore();

  const projectId =
    admin.app().options.projectId || process.env.GOOGLE_CLOUD_PROJECT || "(unknown)";

  console.log(`[cleanup-orphan-firestore] mode=${mode} project=${projectId}`);
  console.log(`  categories: ${[...only].join(", ")}`);

  // 1. groups 全 ID 取得（orphan 判定用）
  console.log("\n[step 1] listing groups...");
  const groupsSnap = await db.collection("groups").get();
  const groupIds = new Set(groupsSnap.docs.map((d) => d.id));
  console.log(`  groups: ${groupIds.size}`);

  // 2. tournaments 全件 scan
  console.log("\n[step 2] scanning tournaments...");
  const tournamentsSnap = await db.collection("tournaments").get();
  const allTournamentIds = new Set(tournamentsSnap.docs.map((d) => d.id));
  console.log(`  tournaments total: ${allTournamentIds.size}`);

  const orphanTournaments: OrphanTournament[] = [];
  for (const doc of tournamentsSnap.docs) {
    const data = doc.data();
    const gid = typeof data.groupId === "string" ? data.groupId : null;
    if (!gid || !groupIds.has(gid)) {
      orphanTournaments.push({
        id: doc.id,
        groupId: gid,
        state: typeof data.state === "string" ? data.state : null,
        name: typeof data.name === "string" ? data.name : null,
        createdAt: fmtTs(data.createdAt),
      });
    }
  }
  console.log(`  orphan tournaments: ${orphanTournaments.length}`);

  const orphanTournamentIds = new Set(orphanTournaments.map((t) => t.id));
  const validTournamentIds = new Set(
    [...allTournamentIds].filter((tid) => !orphanTournamentIds.has(tid)),
  );

  // 3. players orphan 判定（collectionGroup）
  console.log("\n[step 3] scanning players (collectionGroup)...");
  const playersSnap = await db.collectionGroup("players").get();
  const orphanPlayers: OrphanPlayer[] = [];
  for (const doc of playersSnap.docs) {
    const tid = doc.ref.parent.parent?.id;
    if (!tid) continue;
    // orphan tournament 配下の player は step 1 の recursive delete で処理される
    if (orphanTournamentIds.has(tid)) continue;
    if (!validTournamentIds.has(tid)) {
      const data = doc.data();
      orphanPlayers.push({
        tid,
        pid: doc.id,
        displayName: typeof data.displayName === "string" ? data.displayName : null,
      });
    }
  }
  console.log(`  players total: ${playersSnap.docs.length}`);
  console.log(`  orphan players (excl. orphan tournament's children): ${orphanPlayers.length}`);

  // 4. structures orphan 判定
  console.log("\n[step 4] scanning structures...");
  const structuresSnap = await db.collection("structures").get();
  const orphanStructures: OrphanStructure[] = [];
  for (const doc of structuresSnap.docs) {
    const data = doc.data();
    const gid = typeof data.groupId === "string" ? data.groupId : null;
    if (!gid || !groupIds.has(gid)) {
      orphanStructures.push({
        id: doc.id,
        groupId: gid,
        name: typeof data.name === "string" ? data.name : null,
      });
    }
  }
  console.log(`  structures total: ${structuresSnap.docs.length}`);
  console.log(`  orphan structures: ${orphanStructures.length}`);

  // 5. groupJoinCodes expired 判定
  console.log("\n[step 5] scanning groupJoinCodes...");
  const codesSnap = await db.collection("groupJoinCodes").get();
  const expiredJoinCodes: ExpiredJoinCode[] = [];
  const now = admin.firestore.Timestamp.now();
  for (const doc of codesSnap.docs) {
    const data = doc.data();
    const exp = data.expiresAt;
    if (exp instanceof admin.firestore.Timestamp && exp.toMillis() < now.toMillis()) {
      expiredJoinCodes.push({
        id: doc.id,
        gid: typeof data.gid === "string" ? data.gid : null,
        expiresAt: exp.toDate().toISOString(),
      });
    }
  }
  console.log(`  joinCodes total: ${codesSnap.docs.length}`);
  console.log(`  expired joinCodes: ${expiredJoinCodes.length}`);

  // 6. users orphan 判定（Auth に存在しない uid を持つ users doc）
  //    + 連動して groups 内の dangling uid（memberUids / organizerUids / ownerUids / memberDisplayNames）を整理。
  //    全 owner が dangling になる group は完全孤児として recursive delete に倒す。
  console.log("\n[step 6] scanning users vs Firebase Auth (+ group dangling refs)...");
  let orphanUsers: OrphanUser[] = [];
  let usersTotal = 0;
  let groupCleanups: GroupCleanup[] = [];
  if (only.has("users")) {
    const authUids = await listAllAuthUids();
    console.log(`  auth users: ${authUids.size}`);
    const usersSnap = await db.collection("users").get();
    usersTotal = usersSnap.docs.length;
    for (const doc of usersSnap.docs) {
      if (!authUids.has(doc.id)) {
        const data = doc.data();
        orphanUsers.push({
          uid: doc.id,
          displayName: typeof data.displayName === "string" ? data.displayName : null,
          email: typeof data.email === "string" ? data.email : null,
          groupIds: Array.isArray(data.groupIds) ? (data.groupIds as string[]) : [],
          createdAt: fmtTs(data.createdAt),
        });
      }
    }
    console.log(`  users total: ${usersTotal}`);
    console.log(`  orphan users: ${orphanUsers.length}`);

    const orphanUserUids = new Set(orphanUsers.map((u) => u.uid));
    for (const gdoc of groupsSnap.docs) {
      const gdata = gdoc.data();
      const memberUids = Array.isArray(gdata.memberUids) ? (gdata.memberUids as string[]) : [];
      const organizerUids = Array.isArray(gdata.organizerUids) ? (gdata.organizerUids as string[]) : [];
      const ownerUids = Array.isArray(gdata.ownerUids) ? (gdata.ownerUids as string[]) : [];
      const memberDisplayNames =
        gdata.memberDisplayNames && typeof gdata.memberDisplayNames === "object"
          ? (gdata.memberDisplayNames as Record<string, unknown>)
          : {};

      const removeMembers = memberUids.filter((uid) => orphanUserUids.has(uid));
      const removeOrganizers = organizerUids.filter((uid) => orphanUserUids.has(uid));
      const removeOwners = ownerUids.filter((uid) => orphanUserUids.has(uid));
      const removeDisplayNameKeys = Object.keys(memberDisplayNames).filter((uid) =>
        orphanUserUids.has(uid),
      );

      if (
        removeMembers.length === 0 &&
        removeOrganizers.length === 0 &&
        removeOwners.length === 0 &&
        removeDisplayNameKeys.length === 0
      ) {
        continue;
      }

      const remainingOwnerUids = ownerUids.filter((uid) => !orphanUserUids.has(uid));
      groupCleanups.push({
        gid: gdoc.id,
        name: typeof gdata.name === "string" ? gdata.name : "?",
        removeMembers,
        removeOrganizers,
        removeOwners,
        removeDisplayNameKeys,
        remainingOwnerUids,
        isFullyOrphan: remainingOwnerUids.length === 0,
      });
    }
    const fullyOrphanCount = groupCleanups.filter((g) => g.isFullyOrphan).length;
    console.log(`  groups with dangling refs: ${groupCleanups.length}`);
    console.log(`  └─ fully orphan (will recursive delete): ${fullyOrphanCount}`);
    console.log(`  └─ partial (will arrayRemove dangling uids): ${groupCleanups.length - fullyOrphanCount}`);
  } else {
    console.log("  [skipped by --only]");
  }

  // ===== summary =====
  console.log("\n========== summary ==========");
  console.log(`  orphan tournaments       : ${orphanTournaments.length}${only.has("tournaments") ? "" : "  [skipped by --only]"}`);
  console.log(`  orphan players           : ${orphanPlayers.length}${only.has("players") ? "" : "  [skipped by --only]"}`);
  console.log(`  orphan structures        : ${orphanStructures.length}${only.has("structures") ? "" : "  [skipped by --only]"}`);
  console.log(`  expired groupJoinCodes   : ${expiredJoinCodes.length}${only.has("joinCodes") ? "" : "  [skipped by --only]"}`);
  console.log(`  orphan users             : ${orphanUsers.length}${only.has("users") ? "" : "  [skipped by --only]"}`);
  console.log(`  groups with dangling refs: ${groupCleanups.length}${only.has("users") ? "" : "  [skipped by --only]"}`);

  if (only.has("tournaments") && orphanTournaments.length > 0) {
    console.log("\n[orphan tournaments]");
    for (const t of orphanTournaments) {
      console.log(
        `  ${t.id}  groupId=${t.groupId ?? "(none)"}  state=${t.state ?? "?"}  name=${t.name ?? ""}  createdAt=${t.createdAt ?? "?"}`,
      );
    }
  }
  if (only.has("players") && orphanPlayers.length > 0) {
    console.log("\n[orphan players (excl. orphan tournament's children)]");
    for (const p of orphanPlayers) {
      console.log(
        `  tournaments/${p.tid}/players/${p.pid}  displayName=${p.displayName ?? ""}`,
      );
    }
  }
  if (only.has("structures") && orphanStructures.length > 0) {
    console.log("\n[orphan structures]");
    for (const s of orphanStructures) {
      console.log(`  ${s.id}  groupId=${s.groupId ?? "(none)"}  name=${s.name ?? ""}`);
    }
  }
  if (only.has("joinCodes") && expiredJoinCodes.length > 0) {
    console.log("\n[expired groupJoinCodes]");
    for (const c of expiredJoinCodes) {
      console.log(`  ${c.id}  gid=${c.gid ?? "(none)"}  expiresAt=${c.expiresAt}`);
    }
  }
  if (only.has("users") && orphanUsers.length > 0) {
    console.log("\n[orphan users (auth に存在しない uid)]");
    for (const u of orphanUsers) {
      console.log(
        `  ${u.uid}  displayName=${u.displayName ?? ""}  email=${u.email ?? "(none)"}  groupIds=[${u.groupIds.join(", ")}]  createdAt=${u.createdAt ?? "?"}`,
      );
    }
  }
  if (only.has("users") && groupCleanups.length > 0) {
    console.log("\n[group dangling refs cleanup plan]");
    for (const g of groupCleanups) {
      const tag = g.isFullyOrphan ? "[FULLY-ORPHAN → recursiveDelete]" : "[partial → arrayRemove]";
      console.log(`  ${tag} ${g.gid}  name=${g.name}`);
      if (g.removeOwners.length > 0) console.log(`    removeOwners       : ${g.removeOwners.join(", ")}`);
      if (g.removeOrganizers.length > 0) console.log(`    removeOrganizers   : ${g.removeOrganizers.join(", ")}`);
      if (g.removeMembers.length > 0) console.log(`    removeMembers      : ${g.removeMembers.join(", ")}`);
      if (g.removeDisplayNameKeys.length > 0)
        console.log(`    removeDisplayNames : ${g.removeDisplayNameKeys.join(", ")}`);
      if (!g.isFullyOrphan)
        console.log(`    remainingOwnerUids : [${g.remainingOwnerUids.join(", ")}]`);
    }
  }

  if (!execute) {
    console.log("\n  [dry-run] no deletion performed. re-run with --execute to delete.");
    return;
  }

  // ===== execute =====
  console.log("\n========== deleting ==========");

  let okTournaments = 0;
  let failTournaments = 0;
  if (only.has("tournaments")) {
    for (const t of orphanTournaments) {
      try {
        console.log(`  recursiveDelete tournaments/${t.id}...`);
        await db.recursiveDelete(db.collection("tournaments").doc(t.id));
        okTournaments++;
      } catch (e) {
        failTournaments++;
        console.error(`    failed: ${(e as Error).message}`);
      }
    }
  }

  let okPlayers = 0;
  let failPlayers = 0;
  if (only.has("players")) {
    for (const p of orphanPlayers) {
      try {
        console.log(`  delete tournaments/${p.tid}/players/${p.pid}...`);
        await db.collection("tournaments").doc(p.tid).collection("players").doc(p.pid).delete();
        okPlayers++;
      } catch (e) {
        failPlayers++;
        console.error(`    failed: ${(e as Error).message}`);
      }
    }
  }

  let okStructures = 0;
  let failStructures = 0;
  if (only.has("structures")) {
    for (const s of orphanStructures) {
      try {
        console.log(`  delete structures/${s.id}...`);
        await db.collection("structures").doc(s.id).delete();
        okStructures++;
      } catch (e) {
        failStructures++;
        console.error(`    failed: ${(e as Error).message}`);
      }
    }
  }

  let okJoinCodes = 0;
  let failJoinCodes = 0;
  if (only.has("joinCodes")) {
    for (const c of expiredJoinCodes) {
      try {
        console.log(`  delete groupJoinCodes/${c.id}...`);
        await db.collection("groupJoinCodes").doc(c.id).delete();
        okJoinCodes++;
      } catch (e) {
        failJoinCodes++;
        console.error(`    failed: ${(e as Error).message}`);
      }
    }
  }

  let okUsers = 0;
  let failUsers = 0;
  let okGroupArrayRemove = 0;
  let failGroupArrayRemove = 0;
  let okGroupRecursive = 0;
  let failGroupRecursive = 0;

  if (only.has("users")) {
    // 6a. groups の dangling refs を整理
    //     fully orphan な group は recursive delete、partial は arrayRemove + memberDisplayNames key 削除
    for (const g of groupCleanups) {
      if (g.isFullyOrphan) {
        try {
          console.log(`  recursiveDelete groups/${g.gid}  (fully orphan, name=${g.name})...`);
          await db.recursiveDelete(db.collection("groups").doc(g.gid));
          okGroupRecursive++;
        } catch (e) {
          failGroupRecursive++;
          console.error(`    failed: ${(e as Error).message}`);
        }
      } else {
        try {
          const updates: Record<string, unknown> = {};
          if (g.removeOwners.length > 0)
            updates.ownerUids = admin.firestore.FieldValue.arrayRemove(...g.removeOwners);
          if (g.removeOrganizers.length > 0)
            updates.organizerUids = admin.firestore.FieldValue.arrayRemove(...g.removeOrganizers);
          if (g.removeMembers.length > 0)
            updates.memberUids = admin.firestore.FieldValue.arrayRemove(...g.removeMembers);
          for (const uid of g.removeDisplayNameKeys) {
            updates[`memberDisplayNames.${uid}`] = admin.firestore.FieldValue.delete();
          }
          console.log(
            `  arrayRemove groups/${g.gid}  (name=${g.name}, refs=${g.removeMembers.length + g.removeOrganizers.length + g.removeOwners.length + g.removeDisplayNameKeys.length})...`,
          );
          await db.collection("groups").doc(g.gid).update(updates);
          okGroupArrayRemove++;
        } catch (e) {
          failGroupArrayRemove++;
          console.error(`    failed: ${(e as Error).message}`);
        }
      }
    }

    // 6b. orphan users 自身を削除
    for (const u of orphanUsers) {
      try {
        console.log(`  delete users/${u.uid}...`);
        await db.collection("users").doc(u.uid).delete();
        okUsers++;
      } catch (e) {
        failUsers++;
        console.error(`    failed: ${(e as Error).message}`);
      }
    }
  }

  console.log("\n========== done ==========");
  console.log(`  tournaments deleted        : ${okTournaments} ok / ${failTournaments} failed`);
  console.log(`  players deleted            : ${okPlayers} ok / ${failPlayers} failed`);
  console.log(`  structures deleted         : ${okStructures} ok / ${failStructures} failed`);
  console.log(`  joinCodes deleted          : ${okJoinCodes} ok / ${failJoinCodes} failed`);
  console.log(`  users deleted              : ${okUsers} ok / ${failUsers} failed`);
  console.log(`  groups recursiveDeleted    : ${okGroupRecursive} ok / ${failGroupRecursive} failed`);
  console.log(`  groups dangling cleaned    : ${okGroupArrayRemove} ok / ${failGroupArrayRemove} failed`);
}

main().catch((e) => {
  console.error("[cleanup-orphan-firestore] fatal:", e);
  process.exit(1);
});
