import { getApp, getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { connectStorageEmulator, getStorage } from "firebase/storage";

import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

// E2E テスト用: `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true` 設定時に Firebase Auth /
// Firestore / Storage をローカル emulator（127.0.0.1:9099 / :8080 / :9199）へ向ける。
// 本番・開発では無効。
const useEmulator =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true";
const AUTH_EMULATOR_URL = "http://127.0.0.1:9099";
const FIRESTORE_EMULATOR_HOST = "127.0.0.1";
const FIRESTORE_EMULATOR_PORT = 8080;
const STORAGE_EMULATOR_HOST = "127.0.0.1";
const STORAGE_EMULATOR_PORT = 9199;

// During build / SSR, Firebase SDK is evaluated at module-load time even for
// client components; falling back to a placeholder keeps the build green
// without leaking a secret. The authoritative check runs in the browser.
// Literal `process.env.NEXT_PUBLIC_*` access is required — Next.js only
// inlines these at build time when the key is a static property access, so
// dynamic lookup (`process.env[key]`) returns undefined in the client bundle.
const PLACEHOLDER = "allin-pokertimer-dev-missing";

const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
const messagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;

const firebaseConfig: FirebaseOptions = {
  apiKey: apiKey || PLACEHOLDER,
  authDomain: authDomain || `${PLACEHOLDER}.firebaseapp.com`,
  projectId: projectId || PLACEHOLDER,
  storageBucket: storageBucket || `${PLACEHOLDER}.appspot.com`,
  messagingSenderId: messagingSenderId || "0",
  appId: appId || `1:0:web:${PLACEHOLDER}`,
};

if (typeof window !== "undefined") {
  const missing: string[] = [];
  if (!apiKey) missing.push("NEXT_PUBLIC_FIREBASE_API_KEY");
  if (!authDomain) missing.push("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN");
  if (!projectId) missing.push("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  if (!appId) missing.push("NEXT_PUBLIC_FIREBASE_APP_ID");

  if (missing.length > 0) {
    throw new AppError(
      `Firebase config is missing required env vars: ${missing.join(", ")}. Copy env.local.example to .env.local and fill in values from Firebase Console.`,
      "firebase/config-missing",
    );
  }
}

const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
// Firebase Auth が送信するシステムメール（メールリンク／パスワードリセット等）の
// 既定テンプレート言語を日本語に固定する。Console のテンプレート編集と併用。
firebaseAuth.languageCode = "ja";

// Phase 3: ブラウザでは persistentLocalCache を有効化して
// オフライン閲覧（タイマー継続表示／接続切れ UI）を可能にする。
// SSR 側では window 未定義のため従来通り getFirestore を使う。
// initializeFirestore は既に初期化済みの場合に throw するため try/catch で
// getFirestore にフォールバックする（HMR 二重初期化対策）。
// E2E emulator 利用時は persistentLocalCache を無効化（テスト間状態汚染を防ぐ）。
function createFirestore() {
  if (typeof window === "undefined") {
    return getFirestore(firebaseApp);
  }
  if (useEmulator) {
    try {
      return initializeFirestore(firebaseApp, {});
    } catch {
      return getFirestore(firebaseApp);
    }
  }
  try {
    return initializeFirestore(firebaseApp, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (e) {
    logger.warn("persistentLocalCache init fallback to getFirestore", {
      reason: e instanceof Error ? e.message : "unknown",
    });
    return getFirestore(firebaseApp);
  }
}

export const firestore = createFirestore();

// Phase A.1 (05-post-launch-polish Track A): Cloud Storage for Firebase singleton。
// 結果カード背景画像の配置先として導入。`firebaseConfig.storageBucket` 経由でバケットを解決し、
// SSR / build 時の評価でも PLACEHOLDER バケットへの遅延参照のみが残るため副作用はない。
// 実 upload / download は Blaze プラン + Storage 初期化済みプロジェクトでのみ機能する。
export const firebaseStorage = getStorage(firebaseApp);

// E2E: emulator へ接続。重複接続は Firebase SDK 側で throw するため globalThis 上の
// flag でガード（HMR 再実行・複数ページ開きでの re-invocation 対策）。
if (useEmulator) {
  type EmulatorFlag = { __FIREBASE_EMULATORS_CONNECTED__?: boolean };
  const g = globalThis as typeof globalThis & EmulatorFlag;
  if (!g.__FIREBASE_EMULATORS_CONNECTED__) {
    connectAuthEmulator(firebaseAuth, AUTH_EMULATOR_URL, { disableWarnings: true });
    connectFirestoreEmulator(firestore, FIRESTORE_EMULATOR_HOST, FIRESTORE_EMULATOR_PORT);
    connectStorageEmulator(firebaseStorage, STORAGE_EMULATOR_HOST, STORAGE_EMULATOR_PORT);
    g.__FIREBASE_EMULATORS_CONNECTED__ = true;
    logger.info("firebase emulators connected", {
      auth: AUTH_EMULATOR_URL,
      firestore: `${FIRESTORE_EMULATOR_HOST}:${FIRESTORE_EMULATOR_PORT}`,
      storage: `${STORAGE_EMULATOR_HOST}:${STORAGE_EMULATOR_PORT}`,
    });
  }
}
