import type { APIRequestContext } from "@playwright/test";

/**
 * Firebase Emulator に対する操作ヘルパ。
 *
 * テスト間の状態隔離: `resetEmulators(request)` が Firestore / Auth を一括リセットする。
 * ユーザ列挙は `listUsers` / `userExists`、ドキュメント取得は `getDocument` を使用する。
 * 全て Emulator の unauthenticated endpoint を使用する（本番では動作しない）。
 */

const E2E_PROJECT_ID = "allin-pokertimer-e2e";
const AUTH_EMULATOR = "http://127.0.0.1:9099";
const FIRESTORE_EMULATOR = "http://127.0.0.1:8080";

/** Firestore Emulator: 全ドキュメント削除。 */
async function resetFirestore(
  request: APIRequestContext,
  projectId = E2E_PROJECT_ID,
): Promise<void> {
  const res = await request.delete(
    `${FIRESTORE_EMULATOR}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
  );
  if (!res.ok()) {
    throw new Error(`resetFirestore failed: ${res.status()} ${await res.text()}`);
  }
}

/** Auth Emulator: 全ユーザ削除。 */
async function resetAuth(
  request: APIRequestContext,
  projectId = E2E_PROJECT_ID,
): Promise<void> {
  const res = await request.delete(
    `${AUTH_EMULATOR}/emulator/v1/projects/${projectId}/accounts`,
  );
  if (!res.ok()) {
    throw new Error(`resetAuth failed: ${res.status()} ${await res.text()}`);
  }
}

/** Firestore + Auth の両方を一括リセット（beforeEach で呼ぶ）。 */
export async function resetEmulators(
  request: APIRequestContext,
  projectId = E2E_PROJECT_ID,
): Promise<void> {
  await Promise.all([resetFirestore(request, projectId), resetAuth(request, projectId)]);
}

interface EmulatorUserSnapshot {
  localId: string;
  email?: string;
  displayName?: string;
  providerUserInfo?: Array<{ providerId: string }>;
}

/** Emulator 上の全ユーザ（匿名含む）を返す。 */
export async function listUsers(
  request: APIRequestContext,
  projectId = E2E_PROJECT_ID,
): Promise<EmulatorUserSnapshot[]> {
  const res = await request.post(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:query`,
    {
      data: { returnUserInfo: true },
      headers: {
        "Content-Type": "application/json",
        // Emulator は Authorization: Bearer owner で Admin 権限を付与する。
        Authorization: "Bearer owner",
      },
    },
  );
  if (!res.ok()) {
    throw new Error(`listUsers failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { userInfo?: EmulatorUserSnapshot[] };
  return body.userInfo ?? [];
}

/** 指定 uid がまだ存在するか判定。 */
export async function userExists(
  request: APIRequestContext,
  uid: string,
  projectId = E2E_PROJECT_ID,
): Promise<boolean> {
  const users = await listUsers(request, projectId);
  return users.some((u) => u.localId === uid);
}

/**
 * Firestore の単一ドキュメントを REST 経由で取得。
 * Admin 権限 (Authorization: Bearer owner) でルールを bypass する。
 */
export async function getDocument(
  request: APIRequestContext,
  path: string,
  projectId = E2E_PROJECT_ID,
): Promise<{ exists: boolean; data?: Record<string, unknown> }> {
  const res = await request.get(
    `${FIRESTORE_EMULATOR}/v1/projects/${projectId}/databases/(default)/documents/${path}`,
    { headers: { Authorization: "Bearer owner" } },
  );
  if (res.status() === 404) return { exists: false };
  if (!res.ok()) {
    throw new Error(`getDocument failed: ${res.status()} ${await res.text()}`);
  }
  return { exists: true, data: (await res.json()) as Record<string, unknown> };
}
