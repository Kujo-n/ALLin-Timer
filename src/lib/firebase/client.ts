import { getApp, getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

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

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
// Firebase Auth が送信するシステムメール（メールリンク／パスワードリセット等）の
// 既定テンプレート言語を日本語に固定する。Console のテンプレート編集と併用。
firebaseAuth.languageCode = "ja";

// Phase 3: ブラウザでは persistentLocalCache を有効化して
// オフライン閲覧（タイマー継続表示／接続切れ UI）を可能にする。
// SSR 側では window 未定義のため従来通り getFirestore を使う。
// initializeFirestore は既に初期化済みの場合に throw するため try/catch で
// getFirestore にフォールバックする（HMR 二重初期化対策）。
function createFirestore() {
  if (typeof window === "undefined") {
    return getFirestore(firebaseApp);
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
