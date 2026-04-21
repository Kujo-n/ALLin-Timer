import type { APIRequestContext } from "@playwright/test";

/**
 * Firebase Emulator に対する操作ヘルパ。
 *
 * テスト間の状態隔離:
 *   - `resetFirestore(request, projectId)`: 全ドキュメント削除（`/emulator/v1/.../documents` DELETE）
 *   - `resetAuth(request, projectId)`: 全ユーザ削除（`/emulator/v1/projects/{pid}/accounts` DELETE）
 *
 * ユーザ作成・取得:
 *   - `createUserViaEmulator(...)`: Identity Toolkit API の accounts:signUp を叩き、
 *     fresh な localId + idToken を返す
 *   - `listUsers(...)`: accounts:query で全ユーザの minimal スナップショット取得
 *   - `getUser(...)`: localId 単体取得（自己削除テストの確認に使用）
 *
 * 全て Emulator の unauthenticated endpoint を使用する（本番では動作しない）。
 */

export const E2E_PROJECT_ID = "allin-pokertimer-e2e";
const AUTH_EMULATOR = "http://127.0.0.1:9099";
const FIRESTORE_EMULATOR = "http://127.0.0.1:8080";
const FAKE_API_KEY = "fake-api-key";

/** Firestore Emulator: 全ドキュメント削除。 */
export async function resetFirestore(
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
export async function resetAuth(
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

export interface EmulatorUser {
  email: string;
  password: string;
  displayName: string;
  localId: string;
  idToken: string;
  refreshToken: string;
}

/**
 * Identity Toolkit の signUp を叩いてユーザを作成する。
 * 戻り値の localId は Firebase Auth uid と一致する。
 */
export async function createUserViaEmulator(
  request: APIRequestContext,
  params: { email: string; password: string; displayName: string },
): Promise<EmulatorUser> {
  const res = await request.post(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FAKE_API_KEY}`,
    {
      data: {
        email: params.email,
        password: params.password,
        displayName: params.displayName,
        returnSecureToken: true,
      },
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!res.ok()) {
    throw new Error(`createUserViaEmulator failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    localId: string;
    idToken: string;
    refreshToken: string;
  };
  return {
    email: params.email,
    password: params.password,
    displayName: params.displayName,
    localId: body.localId,
    idToken: body.idToken,
    refreshToken: body.refreshToken,
  };
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
