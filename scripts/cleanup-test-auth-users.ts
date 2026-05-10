#!/usr/bin/env tsx
/**
 * Cleanup script: 本番 Firebase Auth から `@e2e.local` ドメインのテスト残骸ユーザーを削除する。
 *
 * 背景:
 *   E2E spec が過去に本番 Project に向いていた時期があり、`audio-*@e2e.local` /
 *   `nav-*@e2e.local` 等の自動生成テストアカウントが Firebase Auth に乱立している。
 *   現在 E2E は emulator (`allin-pokertimer-e2e` project) に隔離されているため、
 *   本番に残った `@e2e.local` ドメインは安全に削除できる。
 *
 * 範囲:
 *   - 削除対象: `email` が `@e2e.local` で終わるアカウントのみ
 *   - 触らない: 匿名（emailなし）/ Google ログイン / その他のメールドメイン
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     npm run cleanup:test-auth-users           # dry-run（既定）
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     npm run cleanup:test-auth-users -- --execute   # 実削除
 *
 * Prerequisites:
 *   - Firebase Console > プロジェクト設定 > サービスアカウント から service-account.json を取得
 *   - service-account.json は gitignore 済み
 *   - Admin SDK 経由のため Security Rules を bypass する（プロダクトコードからは絶対呼ばない）
 */
import admin from "firebase-admin";

const TEST_EMAIL_DOMAIN = "@e2e.local";
const BATCH_SIZE = 1000; // Firebase Auth の deleteUsers 上限

interface DeletionTarget {
  uid: string;
  email: string;
  createdAt: string;
  lastLoginAt: string;
}

async function listAllUsers(): Promise<admin.auth.UserRecord[]> {
  const collected: admin.auth.UserRecord[] = [];
  let pageToken: string | undefined;
  do {
    const result = await admin.auth().listUsers(1000, pageToken);
    collected.push(...result.users);
    pageToken = result.pageToken;
  } while (pageToken);
  return collected;
}

function filterTestUsers(users: admin.auth.UserRecord[]): DeletionTarget[] {
  return users
    .filter((u) => u.email && u.email.toLowerCase().endsWith(TEST_EMAIL_DOMAIN))
    .map((u) => ({
      uid: u.uid,
      email: u.email!,
      createdAt: u.metadata.creationTime,
      lastLoginAt: u.metadata.lastSignInTime || "(never)",
    }));
}

async function deleteInBatches(uids: string[]): Promise<{ successCount: number; failureCount: number }> {
  let successCount = 0;
  let failureCount = 0;
  for (let i = 0; i < uids.length; i += BATCH_SIZE) {
    const batch = uids.slice(i, i + BATCH_SIZE);
    const result = await admin.auth().deleteUsers(batch);
    successCount += result.successCount;
    failureCount += result.failureCount;
    for (const e of result.errors) {
      console.error(`  failed uid[${batch[e.index]}]: ${e.error.message}`);
    }
    console.log(
      `  batch ${Math.floor(i / BATCH_SIZE) + 1}: ${result.successCount} ok, ${result.failureCount} failed`,
    );
  }
  return { successCount, failureCount };
}

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  const mode = execute ? "EXECUTE" : "DRY-RUN";

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error("ERROR: GOOGLE_APPLICATION_CREDENTIALS is not set.");
    console.error(
      "  例: GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npm run cleanup:test-auth-users",
    );
    process.exit(1);
  }

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });

  const projectId =
    admin.app().options.projectId ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    "(unknown)";

  console.log(`[cleanup-test-auth-users] mode=${mode} project=${projectId}`);
  console.log(`  target: emails ending with "${TEST_EMAIL_DOMAIN}"`);

  const all = await listAllUsers();
  const targets = filterTestUsers(all);
  console.log(`\n  total users: ${all.length}`);
  console.log(`  deletion candidates: ${targets.length}`);

  if (targets.length === 0) {
    console.log("\n  nothing to delete. exiting.");
    return;
  }

  console.log("\n  candidates (showing all):");
  for (const t of targets) {
    console.log(`    ${t.uid}  ${t.email}  created=${t.createdAt}  last=${t.lastLoginAt}`);
  }

  if (!execute) {
    console.log("\n  [dry-run] no deletion performed. re-run with --execute to delete.");
    return;
  }

  console.log(`\n  deleting ${targets.length} users...`);
  const { successCount, failureCount } = await deleteInBatches(targets.map((t) => t.uid));
  console.log(`\n  done: ${successCount} deleted, ${failureCount} failed`);
}

main().catch((e) => {
  console.error("[cleanup-test-auth-users] fatal:", e);
  process.exit(1);
});
