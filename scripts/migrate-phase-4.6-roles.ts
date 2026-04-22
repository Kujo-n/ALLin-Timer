#!/usr/bin/env tsx
/**
 * Phase 4.6 Migration: ownerUid (string) → ownerUids (string[]) + organizerUids (string[]).
 *
 * Admin SDK で全 groups を scan し、以下を実施:
 *   - ownerUids = [ownerUid]
 *   - organizerUids = [...memberUids]   （既存メンバー全員を organizer に移行）
 *   - ownerUid フィールドを削除
 *
 * 既に ownerUids が入っている doc は skip（冪等）。
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/migrate-phase-4.6-roles.ts [--dry-run]
 *
 * Prerequisites:
 *   - `firebase-admin` / `tsx` が devDependency に入っていること
 *   - service-account.json が gitignore されていること
 *   - 本番実行前に Firestore Export で backup を取得していること
 */
import admin from "firebase-admin";

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();

type LegacyGroupDoc = {
  ownerUid?: string;
  ownerUids?: string[];
  organizerUids?: string[];
  memberUids?: string[];
  name?: string;
};

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`[migrate-phase-4.6-roles] start (dryRun=${dryRun})`);

  const snap = await db.collection("groups").get();
  console.log(`  found ${snap.size} group(s)`);

  let migrated = 0;
  let skipped = 0;
  let warned = 0;

  for (const doc of snap.docs) {
    const data = doc.data() as LegacyGroupDoc;

    if (Array.isArray(data.ownerUids) && data.ownerUids.length > 0) {
      console.log(`  ${doc.id}: already migrated (ownerUids=${data.ownerUids.length}), skip`);
      skipped += 1;
      continue;
    }

    const ownerUid = data.ownerUid;
    const memberUids = data.memberUids ?? [];
    if (!ownerUid) {
      console.warn(`  ${doc.id}: no ownerUid field — manual intervention required, skip`);
      warned += 1;
      continue;
    }

    const uniqueMembers = Array.from(new Set([ownerUid, ...memberUids]));
    const patch = {
      ownerUids: [ownerUid],
      organizerUids: uniqueMembers,
      memberUids: uniqueMembers,
      ownerUid: admin.firestore.FieldValue.delete(),
    };
    console.log(
      `  ${doc.id}: ${dryRun ? "[dry-run] " : ""}patch`,
      JSON.stringify({
        ownerUids: patch.ownerUids,
        organizerUids: patch.organizerUids,
        memberUids: patch.memberUids,
      }),
    );
    if (!dryRun) {
      await doc.ref.update(patch);
    }
    migrated += 1;
  }

  console.log(
    `[migrate-phase-4.6-roles] done: migrated=${migrated} skipped=${skipped} warned=${warned}`,
  );
}

main().catch((e) => {
  console.error("[migrate-phase-4.6-roles] failed", e);
  process.exit(1);
});
