#!/usr/bin/env tsx
/**
 * Cleanup script: 作成から N 日（既定 7）以上経過した匿名 Firebase Auth ユーザーと
 * 連動する `users/{uid}` doc を削除する。
 *
 * 削除対象:
 *   1. `users/{uid}` doc — 該当 user の Firestore プロフィール（Auth user が消えれば誰も参照しない orphan）
 *   2. Firebase Auth user 本体 — `admin.auth().deleteUsers([...])` で 1000 件 chunk batch 削除
 *
 * 意図的に保持するデータ（過去トーナメント参照時に displayName snapshot で表示が維持される必要があるため）:
 *   - `tournaments/{tid}/players/{uid}` — 過去トーナメントの参加者一覧 / WinnerBanner /
 *     結果シェアカード / OG image / PlayersCard / AverageStackCard が依存
 *     （`attemptAnonymousSelfDelete` の即時経路と同じ「履歴を残す」設計を N 日後 cutoff にも適用）
 *   - `groups/{gid}/seasonStats/{uid}` — シーズンランキング基礎。displayName は doc 内 snapshot 済み
 *   - `groups/{gid}/seasonHistory/{seasonId}.entries[]` — append-only / 改竄禁止 rule
 *
 * そもそも対象外（匿名ユーザーが触らない）:
 *   - `groups/{gid}.memberUids` / `memberDisplayNames` — 匿名は招待コード加入経路を通らない
 *
 * 完全に親 tournament が消えた orphan player は将来的に `cleanup-orphan-firestore.ts` が
 * 拾う（責務分離: 本 script は Auth lifecycle、orphan-firestore は親子整合）。
 *
 * 匿名判定: `providerData.length === 0`（provider 連携なし）。Google/Email/匿名以外で
 * provider data 空の状況は通常発生しないため、これだけで匿名を識別できる。
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     npm run cleanup:old-anonymous-users           # dry-run（既定）
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     npm run cleanup:old-anonymous-users -- --execute        # 実削除
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     npm run cleanup:old-anonymous-users -- --days=14 --execute  # cutoff を 14 日に
 *
 * Prerequisites:
 *   - Firebase Console > プロジェクト設定 > サービスアカウント から service-account.json を取得
 *   - service-account.json は gitignore 済み
 *   - Admin SDK 経由のため Security Rules を bypass する（プロダクトコードからは絶対呼ばない）
 */
import admin from "firebase-admin";

const DEFAULT_AGE_DAYS = 7;
const CHUNK = 1000; // Firebase Auth の deleteUsers 上限

function parseDays(argv: string[]): number {
  const arg = argv.find((a) => a.startsWith("--days="));
  if (!arg) return DEFAULT_AGE_DAYS;
  const n = Number.parseInt(arg.slice("--days=".length), 10);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`invalid --days value: ${arg}`);
    process.exit(1);
  }
  return n;
}

interface Target {
  uid: string;
  createdAt: string;
}

async function main() {
  const execute = process.argv.includes("--execute");
  const ageDays = parseDays(process.argv);
  const cutoff = Date.now() - ageDays * 24 * 60 * 60 * 1000;
  const mode = execute ? "EXECUTE" : "DRY-RUN";

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error(
      "ERROR: GOOGLE_APPLICATION_CREDENTIALS is not set. " +
        "Place service-account.json and run e.g.:\n" +
        "  GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npm run cleanup:old-anonymous-users",
    );
    process.exit(1);
  }

  admin.initializeApp({ credential: admin.credential.applicationDefault() });
  const db = admin.firestore();
  const projectId = admin.app().options.projectId ?? "(unknown)";

  console.log(
    `[cleanup-old-anonymous-users] mode=${mode} project=${projectId} ageDays=${ageDays}`,
  );

  // 1. 全 Auth user を paging で取得し、匿名 + N 日超を抽出
  const targets: Target[] = [];
  let pageToken: string | undefined;
  let totalScanned = 0;
  do {
    const res = await admin.auth().listUsers(1000, pageToken);
    for (const u of res.users) {
      totalScanned++;
      if (u.providerData.length > 0) continue; // 匿名判定: provider 連携なし
      const createdAtMs = Date.parse(u.metadata.creationTime);
      if (!Number.isFinite(createdAtMs)) continue; // 不正データはスキップ
      if (createdAtMs >= cutoff) continue; // cutoff より新しい匿名は残す
      targets.push({ uid: u.uid, createdAt: u.metadata.creationTime });
    }
    pageToken = res.pageToken;
  } while (pageToken);

  console.log(`  scanned auth users: ${totalScanned}`);
  console.log(
    `  matched (anonymous, older than ${ageDays} days): ${targets.length}`,
  );
  for (const t of targets) {
    console.log(`    ${t.uid}  createdAt=${t.createdAt}`);
  }

  if (!execute) {
    console.log("\n[dry-run] no deletion performed. re-run with --execute to delete.");
    console.log(
      "  preserved: tournaments/{tid}/players/{uid} / seasonStats / seasonHistory",
    );
    return;
  }

  if (targets.length === 0) {
    console.log("\nno targets to delete. done.");
    return;
  }

  // 2. EXECUTE: users/{uid} doc → Auth user の順で削除
  let okUsers = 0;
  let failUsers = 0;
  for (const t of targets) {
    try {
      await db.collection("users").doc(t.uid).delete();
      okUsers++;
    } catch (e) {
      failUsers++;
      console.error(
        `  users doc delete failed: uid=${t.uid} reason=${(e as Error).message}`,
      );
    }
  }

  let okAuth = 0;
  let failAuth = 0;
  for (let i = 0; i < targets.length; i += CHUNK) {
    const chunk = targets.slice(i, i + CHUNK).map((t) => t.uid);
    const res = await admin.auth().deleteUsers(chunk);
    okAuth += res.successCount;
    failAuth += res.failureCount;
    for (const err of res.errors) {
      const failedUid = chunk[err.index] ?? "(unknown)";
      console.error(
        `  auth delete failed: uid=${failedUid} reason=${err.error.message}`,
      );
    }
  }

  console.log("\n========== done ==========");
  console.log(`  users doc deleted: ${okUsers} ok / ${failUsers} failed`);
  console.log(`  auth deleted:      ${okAuth} ok / ${failAuth} failed`);
  console.log(
    "  preserved (intentional): tournaments/{tid}/players/{uid} / seasonStats / seasonHistory",
  );
  console.log(
    "  note: 親 tournament が削除された orphan player は cleanup-orphan-firestore.ts で別途整理されます",
  );
}

main().catch((e) => {
  console.error("[cleanup-old-anonymous-users] fatal:", e);
  process.exit(1);
});
