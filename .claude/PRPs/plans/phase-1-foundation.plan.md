# Plan: Phase 1 — Foundation（Next.js + Firebase 基盤構築）

## Summary

ALLin-Timer v1 の土台を構築する。Next.js 15（App Router）プロジェクトを初期化し、Tailwind CSS + shadcn/ui、Firebase（Firestore + Authentication）を統合、Firestore データモデルとセキュリティルールの雛形、Vercel デプロイパイプライン、MIT ライセンスを整備する。以降の Phase 2／3 が並列で開発を開始できる状態に到達させる。

## User Story

As a ALLin-Timer の開発者（運営者兼任）,
I want 機能開発に入る前に Next.js + Firebase の完全な土台と認証 3 方式、Firestore データモデル、デプロイパイプラインが準備された状態,
So that Phase 2（受付）と Phase 3（タイマー同期）を即並列で実装開始でき、サークル固有情報を安全に分離した状態で GitHub 公開できる。

## Problem → Solution

現状: `d:\dev\ALLin-Timer` には `CLAUDE.md`、`.gitignore`、`.claude/` のみで、実装用コードは存在しない。Firebase プロジェクトも未作成。
目標状態: `npm run dev` でローカル起動、Vercel 本番 URL で空のトーナメント作成 → Firestore 反映が確認できる。認証 3 方式（メール／匿名／Email Link）が有効で、セキュリティルールがデプロイ済み。

## Metadata

- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/allin-timer.prd.md`
- **PRD Phase**: Phase 1 — Foundation
- **Estimated Files**: 25〜30（設定＋雛形含む）

---

## UX Design

### Before

```
┌──────────────────────────────────────┐
│  プロジェクト未初期化                 │
│  コードなし／Firebase なし            │
│  Vercel 未接続                        │
└──────────────────────────────────────┘
```

### After

```
┌──────────────────────────────────────┐
│  Next.js アプリ（空トップページ）     │
│  ├─ / : Hello ALLin-Timer            │
│  ├─ /_debug/fs : Firestore 疎通確認   │
│  │   [書込] → ドキュメント作成         │
│  │   [一覧] → 作成済みドキュメント表示  │
│  └─ 認証状態バッジ（未/メール/匿名）   │
└──────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| ローカル開発 | — | `npm run dev` で起動 | Node.js 20+ 前提 |
| Vercel 本番 | — | main push で自動デプロイ | GitHub 連携 |
| Firestore 疎通 | — | `/_debug/fs` で書込/読込確認 | Phase 完了判定に使用、本番は後続で削除 |
| 認証 | — | 3 方式（匿名・メール・Email Link）有効 | UI は Phase 2 で実装、ここでは SDK 設定まで |

---

## Mandatory Reading

Phase 1 は新規プロジェクトのため、社内コードベースの読解は不要。代わりに**外部公式ドキュメント**が Mandatory Reading となる。

| Priority | Source | 章／セクション | Why |
|---|---|---|---|
| P0（必読） | Next.js 15 公式 | App Router / Project structure | ディレクトリ規約・ファイル命名 |
| P0（必読） | Firebase 公式 | Web modular SDK v10+ / Initialize | `initializeApp` の singleton 化 |
| P0（必読） | Firebase 公式 | Firestore Security Rules / Get started | `request.auth` と `resource.data` の使い分け |
| P0（必読） | Firebase 公式 | Authentication / Web / 3 方式 | Anonymous・Email/Password・Email Link |
| P1（重要） | shadcn/ui 公式 | Next.js インストール手順 | `components.json`、`cn()` ユーティリティ生成 |
| P1（重要） | Vercel 公式 | Next.js デプロイ / Environment Variables | `NEXT_PUBLIC_*` の取り扱い |
| P2（参考） | TDA 2015 Rules v1.0 | 25〜40 条（Seating / Balancing） | Phase 4 で実装するが、データモデルに影響するため目通し |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Next.js 15 App Router | https://nextjs.org/docs/app | `app/` ディレクトリ、Server Components デフォルト、`"use client"` 境界 |
| Firebase modular SDK | https://firebase.google.com/docs/web/modular-upgrade | `import { initializeApp } from "firebase/app"` スタイル（compat NG） |
| Firestore onSnapshot | https://firebase.google.com/docs/firestore/query-data/listen | リスナー、unsubscribe 必須 |
| Firebase Auth 匿名 | https://firebase.google.com/docs/auth/web/anonymous-auth | `signInAnonymously(auth)` |
| Firebase Auth Email Link | https://firebase.google.com/docs/auth/web/email-link-auth | `sendSignInLinkToEmail` → `isSignInWithEmailLink` |
| Firestore Security Rules | https://firebase.google.com/docs/firestore/security/get-started | `rules_version = '2';` / match path |
| shadcn/ui | https://ui.shadcn.com/docs/installation/next | `npx shadcn@latest init` |
| Vercel Env | https://vercel.com/docs/projects/environment-variables | `NEXT_PUBLIC_FIREBASE_*` は Preview/Production で設定 |

**Research Findings**（外部調査サマリ）

```
KEY_INSIGHT: Firebase Web SDK は v9+ で tree-shakable な modular API に完全移行済み
APPLIES_TO: src/lib/firebase/*.ts の実装
GOTCHA: `firebase/compat/*` は使わない。型推論と bundle size の両方で劣化する
```

```
KEY_INSIGHT: Next.js App Router では `app/layout.tsx` がルートレイアウトで必須。Client Component は明示的に `"use client"` が必要
APPLIES_TO: 認証 Provider など React Context を使う箇所
GOTCHA: Firebase SDK の初期化は HMR で複数回走りうるため `getApps().length ? getApp() : initializeApp(config)` でガード
```

```
KEY_INSIGHT: Vercel のプレビューデプロイは Git ブランチ単位で別 URL が発行され、環境変数は Production/Preview/Development の 3 軸で個別設定可
APPLIES_TO: `NEXT_PUBLIC_FIREBASE_*` の Vercel 設定
GOTCHA: Firebase Auth の承認済みドメインに Vercel プレビュー URL を都度追加するか、ワイルドカードで `*.vercel.app` を許可する必要がある
```

```
KEY_INSIGHT: Firestore Security Rules は `firebase deploy --only firestore:rules` で単独デプロイ可能。App Hosting を使わない場合も Firebase CLI は必須
APPLIES_TO: `firebase.json` / `firestore.rules` / `firestore.indexes.json`
GOTCHA: ルールは deny-by-default。明示的な allow が無い限り全拒否なので、開発初期は疎通確認でハマりやすい
```

```
KEY_INSIGHT: Email Link Sign-in は ActionCodeSettings の `url` に「戻り先 URL」を指定する必要があり、その URL は Firebase Console の承認済みドメインに登録済みでなければならない
APPLIES_TO: Phase 2 で使う認証設定、Phase 1 で事前登録
GOTCHA: ローカル (`http://localhost:3000`) と Vercel の本番／プレビューを全部承認済みドメインに追加すること
```

---

## Patterns to Mirror

既存コードが無いため、**本 Phase で「以降の Phase が従う初期パターン」を確立する**。記載するスニペットはこの Phase 1 で新規作成すべきファイルの想定内容であり、Phase 2 以降はこれらをコピー／拡張する。

### NAMING_CONVENTION
// TARGET: 新規確立（以降の Phase はこれに従う）
// ディレクトリ: kebab-case（例: `src/app/_debug/fs/`）
// Reactコンポーネント: PascalCase（例: `TimerDisplay.tsx`）、default export 可
// フック: camelCase + `use` 接頭辞（例: `useAuthUser.ts`）
// サーバ関数／ユーティリティ: camelCase（例: `getFirestoreClient()`）
// 型・インタフェース: PascalCase、`I` 接頭辞なし（TypeScript 公式推奨）
// 定数: UPPER_SNAKE_CASE は環境変数のみ。コード内定数は camelCase
// ファイル規約: 1 ファイル 1 責務。Next.js の `page.tsx` / `layout.tsx` / `route.ts` は予約名を厳守

### ERROR_HANDLING
```ts
// TARGET: src/lib/errors.ts（新規作成）
export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

// 使用例: Firestore 操作ラッパ内で
try {
  return await getDoc(ref);
} catch (cause) {
  throw new AppError("Firestore 読込に失敗しました", "firestore/read_failed", cause);
}
```
**ルール**: Firebase SDK の例外はそのまま上位に投げず、`AppError` でラップしてドメインコード（`firestore/*`, `auth/*`）を付与。UI は `AppError.code` で分岐。

### LOGGING_PATTERN
```ts
// TARGET: src/lib/logger.ts（新規作成・最小実装）
type Level = "debug" | "info" | "warn" | "error";
const enabled = process.env.NEXT_PUBLIC_LOG_LEVEL ?? "info";

export const logger = {
  debug: (msg: string, meta?: unknown) => log("debug", msg, meta),
  info:  (msg: string, meta?: unknown) => log("info",  msg, meta),
  warn:  (msg: string, meta?: unknown) => log("warn",  msg, meta),
  error: (msg: string, meta?: unknown) => log("error", msg, meta),
};

function log(level: Level, msg: string, meta?: unknown) {
  if (order(level) < order(enabled as Level)) return;
  // 本番は Vercel ログに流れる console を使う（Cloud Logging 連携は v1.1 以降）
  console[level === "debug" ? "log" : level](`[${level}] ${msg}`, meta ?? "");
}
```
**ルール**: `console.log` 直呼びは禁止。`logger.*` のみ使用。`meta` には構造化オブジェクトを渡す。

### FIREBASE_INIT_PATTERN
```ts
// TARGET: src/lib/firebase/client.ts（新規作成）
import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
export const firestore = getFirestore(firebaseApp);
```
**ルール**: Firebase クライアント SDK は **この 1 ファイルからのみ**エクスポート。Phase 2 以降で直接 `initializeApp` を呼ぶ実装を書いてはいけない。

### AUTH_PROVIDER_PATTERN
```tsx
// TARGET: src/lib/firebase/AuthProvider.tsx（新規作成）
"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import { createContext, useContext, useEffect, useState } from "react";
import { firebaseAuth } from "./client";

type AuthState = { user: User | null; loading: boolean };
const AuthContext = createContext<AuthState>({ user: null, loading: true });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });
  useEffect(() => {
    return onAuthStateChanged(firebaseAuth, (user) => setState({ user, loading: false }));
  }, []);
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export const useAuthUser = () => useContext(AuthContext);
```
**ルール**: 認証状態は必ず `useAuthUser` 経由で取得。Component 内で `onAuthStateChanged` を直接購読しない。

### FIRESTORE_CONVERTER_PATTERN
```ts
// TARGET: src/lib/firebase/converters.ts（新規作成・型安全の基盤）
import {
  type DocumentData,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

export function converter<T extends DocumentData>(): FirestoreDataConverter<T> {
  return {
    toFirestore: (data: T) => data,
    fromFirestore: (snap: QueryDocumentSnapshot) => snap.data() as T,
  };
}

// 使用例（Phase 2 以降で拡張）:
// export const tournamentConverter = converter<Tournament>();
```
**ルール**: Firestore アクセスは必ず `withConverter(...)` 経由。生の `DocumentSnapshot.data()` を UI まで漏らさない。

### TEST_STRUCTURE
```ts
// TARGET: src/lib/errors.test.ts（新規作成サンプル）
import { describe, it, expect } from "vitest";
import { AppError } from "./errors";

describe("AppError", () => {
  it("holds code and wrapped cause", () => {
    const cause = new Error("root");
    const e = new AppError("failed", "firestore/read_failed", cause);
    expect(e.code).toBe("firestore/read_failed");
    expect(e.cause).toBe(cause);
    expect(e.name).toBe("AppError");
  });
});
```
**ルール**: テストは対象ファイルと同階層 `*.test.ts`。Vitest を採用（Jest より Next.js 15 + ESM との相性良好）。テスト実行は `npm test`。

### SECURITY_RULES_PATTERN
```
// TARGET: firestore.rules（新規作成）
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // users: 本人のみ自分のプロフィールを読書
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }

    // tournaments: 認証済みユーザーのみ作成可、所有者のみ更新／削除可
    match /tournaments/{tid} {
      allow create: if request.auth != null
                    && request.resource.data.ownerUid == request.auth.uid;
      allow read:   if request.auth != null;               // 参加者が読めるよう緩め（v1）
      allow update, delete: if request.auth != null
                    && resource.data.ownerUid == request.auth.uid;

      // サブコレクションは親の所有者のみ書込可、認証済みユーザーは読取可
      match /{sub=**} {
        allow read: if request.auth != null;
        allow write: if request.auth != null
                     && get(/databases/$(database)/documents/tournaments/$(tid)).data.ownerUid == request.auth.uid;
      }
    }

    // structures: 作成者のみ読書（プリセット）
    match /structures/{sid} {
      allow read, write: if request.auth != null
                          && resource.data.ownerUid == request.auth.uid;
      allow create: if request.auth != null
                    && request.resource.data.ownerUid == request.auth.uid;
    }
  }
}
```
**ルール**: deny-by-default。`ownerUid` フィールドはトーナメント／ストラクチャの作成時に必ずサーバ側で埋める。Phase 4 で参加者のサブコレクション書込権限を精緻化する前提で、現時点は「所有者のみ書込」。

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `package.json` | CREATE | Next.js 15 + Firebase + Tailwind + Vitest の依存 |
| `tsconfig.json` | CREATE | `strict: true`、path alias `@/*` → `src/*` |
| `next.config.ts` | CREATE | Next.js 15 TypeScript 設定、`reactStrictMode: true` |
| `tailwind.config.ts` | CREATE | Tailwind v3 標準。shadcn 初期化後に自動生成される設定を手動保持 |
| `postcss.config.mjs` | CREATE | Tailwind 用 |
| `components.json` | CREATE | shadcn/ui 設定（`npx shadcn init` 生成物） |
| `.eslintrc.json` | CREATE | Next.js 公式 + `@typescript-eslint/recommended` |
| `.prettierrc` | CREATE | フォーマッタ統一 |
| `.env.local.example` | CREATE | Firebase 設定キーの雛形（値は空） |
| `.gitignore` | UPDATE | Next.js 初期化で追加される `/.next/` 等を取り込む（既存と合わせて整理） |
| `LICENSE` | CREATE | MIT ライセンス本文 |
| `README.md` | CREATE | セットアップ手順（日本語） |
| `src/app/layout.tsx` | CREATE | ルートレイアウト、`AuthProvider` で包む |
| `src/app/page.tsx` | CREATE | トップページ「Hello ALLin-Timer」 |
| `src/app/_debug/fs/page.tsx` | CREATE | Firestore 疎通確認用（本 Phase 完了判定、Phase 5 で削除） |
| `src/app/globals.css` | CREATE | Tailwind ディレクティブ |
| `src/lib/firebase/client.ts` | CREATE | Firebase 初期化（singleton） |
| `src/lib/firebase/AuthProvider.tsx` | CREATE | 認証 Context |
| `src/lib/firebase/converters.ts` | CREATE | Firestore 型変換ユーティリティ |
| `src/lib/errors.ts` | CREATE | `AppError` 基底 |
| `src/lib/errors.test.ts` | CREATE | `AppError` の最小テスト |
| `src/lib/logger.ts` | CREATE | 最小ロガー |
| `src/types/tournament.ts` | CREATE | 主要データモデルの TypeScript 型（PRD データモデル反映） |
| `firebase.json` | CREATE | Firebase CLI 設定（rules／indexes のデプロイ対象） |
| `firestore.rules` | CREATE | セキュリティルール（本 Phase のパターン参照） |
| `firestore.indexes.json` | CREATE | 空の composite index 定義（今後追加） |
| `.firebaserc` | CREATE | プロジェクト ID 紐付け |
| `vitest.config.ts` | CREATE | テスト設定（`jsdom` env、`@/` alias） |

## NOT Building

- 認証 UI（ログイン／ゲスト／Email Link 画面） — Phase 2 で実装
- トーナメント CRUD UI — Phase 2 で実装
- タイマーコア・`onSnapshot` リアルタイム同期 — Phase 3 で実装
- 席決め・バスト・バランシング — Phase 4 で実装
- Firebase Cloud Functions — Phase 4（バランシング）／Phase 3（タイマードリフト補正）で検討、本 Phase では**有効化のみ行わない**
- PWA 対応／モバイルアプリ化 — v1 対象外
- CI/CD（GitHub Actions） — Vercel の Git 連携で代替、別 Phase 検討
- E2E テスト基盤（Playwright） — 実装が溜まってから導入

---

## Step-by-Step Tasks

### Task 1: Next.js 15 プロジェクト初期化

- **ACTION**: `create-next-app` でプロジェクトを生成し、TypeScript／Tailwind／App Router／src ディレクトリ／`@/*` alias を有効にする
- **IMPLEMENT**:
  ```bash
  # d:/dev/ALLin-Timer 直下で実行（既存 .claude/CLAUDE.md を壊さない）
  npx create-next-app@latest . --typescript --tailwind --app --src-dir --import-alias "@/*" --eslint --no-turbopack
  ```
  生成物のうち `.gitignore` は既存の内容（`tmp/`、`.env` ルール）を**マージ保持**。
- **MIRROR**: NAMING_CONVENTION（`src/app/` 構成、PascalCase コンポーネント）
- **IMPORTS**: —
- **GOTCHA**: `create-next-app` は空でないディレクトリ（`.claude/`, `CLAUDE.md` 等）を拒否する場合がある。その際は `--force` 付与または一時退避→復元。`tmp/` は `.gitignore` 済みなので実害なし
- **VALIDATE**: `npm run dev` で `http://localhost:3000` に Next.js デフォルト画面が出る

### Task 2: shadcn/ui 導入

- **ACTION**: shadcn/ui を初期化し、`cn()` ユーティリティと Button コンポーネント雛形を配置
- **IMPLEMENT**:
  ```bash
  npx shadcn@latest init     # defaults: New York, Zinc, CSS vars
  npx shadcn@latest add button
  ```
- **MIRROR**: NAMING_CONVENTION
- **IMPORTS**: `import { Button } from "@/components/ui/button"`
- **GOTCHA**: `components.json` で `aliases.components = "@/components"` を確認。変更するなら Phase 2 以降で全追加分に影響
- **VALIDATE**: `src/components/ui/button.tsx` と `src/lib/utils.ts` が生成されていること

### Task 3: 依存の追加

- **ACTION**: Firebase・Vitest・型定義を追加
- **IMPLEMENT**:
  ```bash
  npm install firebase
  npm install -D vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom
  ```
- **MIRROR**: —
- **IMPORTS**: —
- **GOTCHA**: `firebase` は v10+ を確認（modular API 前提）
- **VALIDATE**: `package.json` の `dependencies` に `firebase`、`devDependencies` に `vitest` が入っている

### Task 4: `vitest.config.ts` の作成

- **ACTION**: Vitest の設定を Next.js alias と合わせて記述
- **IMPLEMENT**:
  ```ts
  // vitest.config.ts
  import { defineConfig } from "vitest/config";
  import react from "@vitejs/plugin-react";
  import path from "node:path";

  export default defineConfig({
    plugins: [react()],
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: [],
    },
    resolve: {
      alias: { "@": path.resolve(__dirname, "src") },
    },
  });
  ```
  `package.json` の `scripts` に `"test": "vitest run"`、`"test:watch": "vitest"` を追加
- **MIRROR**: TEST_STRUCTURE
- **IMPORTS**: —
- **GOTCHA**: `globals: true` を入れないと `describe/it/expect` の型が通らない。`tsconfig.json` の `types` に `"vitest/globals"` を追加すること
- **VALIDATE**: 空テストで `npm test` が通る

### Task 5: `src/lib/errors.ts` + テスト

- **ACTION**: `AppError` クラスと対応テストを作成
- **IMPLEMENT**: 「Patterns to Mirror / ERROR_HANDLING」および「TEST_STRUCTURE」のスニペットをそのまま
- **MIRROR**: ERROR_HANDLING, TEST_STRUCTURE
- **IMPORTS**: Vitest の `describe/it/expect`
- **GOTCHA**: ES2022 未満ターゲットだと `cause` が二級市民になる。`tsconfig.json` の `target` は `ES2022` 以上
- **VALIDATE**: `npm test` で 1 件 pass

### Task 6: `src/lib/logger.ts`

- **ACTION**: 最小ロガーを作成
- **IMPLEMENT**: 「Patterns to Mirror / LOGGING_PATTERN」スニペットをそのまま
- **MIRROR**: LOGGING_PATTERN
- **IMPORTS**: —
- **GOTCHA**: `NEXT_PUBLIC_LOG_LEVEL` 未設定時は `info` デフォルト。`debug` にするとブラウザ console がうるさいので本番では使わない
- **VALIDATE**: `src/lib/logger.test.ts` で `logger.info("x")` がエラーを投げないことを確認（test は option、型通過で可）

### Task 7: `src/types/tournament.ts` — データモデル型定義

- **ACTION**: PRD「主要データモデル」を TypeScript 型で起こす
- **IMPLEMENT**:
  ```ts
  import type { Timestamp } from "firebase/firestore";

  export type TournamentState =
    | "setup" | "seating" | "running" | "paused" | "finished";

  export interface Level {
    level: number;
    sb: number;
    bb: number;
    ante: number;
    durationSec: number;
  }

  export interface Structure {
    id: string;
    ownerUid: string;
    name: string;
    initialStack: number;
    lateEntryDeadlineLevel: number;
    levels: Level[];
    createdAt: Timestamp;
  }

  export interface Tournament {
    id: string;
    ownerUid: string;
    name: string;
    structureSnapshot: Omit<Structure, "id" | "ownerUid" | "createdAt">;
    state: TournamentState;
    startedAt: Timestamp | null;
    currentLevel: number;
    lateEntryDeadlineLevel: number;
    createdAt: Timestamp;
    updatedAt: Timestamp;
  }

  export interface Player {
    id: string;
    displayName: string;
    uid: string | null;         // ゲストは null
    entryAt: Timestamp;
    isBusted: boolean;
    bustedAt: Timestamp | null;
  }

  export interface TableDoc {
    tableNumber: number;
    isBroken: boolean;
  }

  export interface Seat {
    seatNumber: number;
    playerId: string | null;
  }

  export type TournamentEventType =
    | "bust" | "move" | "level_up" | "late_entry"
    | "pause" | "resume" | "start" | "finish";

  export interface TournamentEvent {
    id: string;
    type: TournamentEventType;
    payload: Record<string, unknown>;
    occurredAt: Timestamp;
  }

  export interface UserProfile {
    uid: string;
    displayName: string;
    email: string | null;
    createdAt: Timestamp;
  }
  ```
- **MIRROR**: NAMING_CONVENTION（PascalCase 型、`I` 接頭辞なし）
- **IMPORTS**: `Timestamp` from `firebase/firestore`
- **GOTCHA**: `Timestamp` は **クライアント型と Admin 型で別クラス**。本プロジェクトは Web SDK のみなので `firebase/firestore` で統一
- **VALIDATE**: `tsc --noEmit` がエラーなし

### Task 8: `src/lib/firebase/client.ts` — 初期化 singleton

- **ACTION**: Firebase App／Auth／Firestore を singleton で初期化
- **IMPLEMENT**: 「Patterns to Mirror / FIREBASE_INIT_PATTERN」スニペットをそのまま
- **MIRROR**: FIREBASE_INIT_PATTERN
- **IMPORTS**: `firebase/app`, `firebase/auth`, `firebase/firestore`
- **GOTCHA**: `!` で non-null を主張しているため、env が 1 つでも欠けると実行時まで気付けない。起動時に `firebase/client.ts` の末尾で `if (!firebaseConfig.apiKey) throw new Error(...)` を入れるとデバッグが楽
- **VALIDATE**: `import { firestore } from "@/lib/firebase/client"` が型エラーなく通る

### Task 9: `src/lib/firebase/converters.ts`

- **ACTION**: 汎用 Firestore コンバータを作成
- **IMPLEMENT**: 「Patterns to Mirror / FIRESTORE_CONVERTER_PATTERN」スニペットをそのまま
- **MIRROR**: FIRESTORE_CONVERTER_PATTERN
- **IMPORTS**: `firebase/firestore` の型のみ
- **GOTCHA**: `Timestamp` や `FieldValue` を含む型を `T` に入れる際、`toFirestore` が `WithFieldValue<T>` を要求するケースに注意。現段階ではシンプル定義で問題なし
- **VALIDATE**: `const c = converter<Tournament>()` が型エラーなし

### Task 10: `src/lib/firebase/AuthProvider.tsx`

- **ACTION**: 認証 Context と `useAuthUser` を作成
- **IMPLEMENT**: 「Patterns to Mirror / AUTH_PROVIDER_PATTERN」スニペットをそのまま
- **MIRROR**: AUTH_PROVIDER_PATTERN
- **IMPORTS**: `onAuthStateChanged`, `User` from `firebase/auth`、`firebaseAuth` from `@/lib/firebase/client`
- **GOTCHA**: `"use client"` を忘れると Server Component 文脈で `useState` 等が死ぬ
- **VALIDATE**: TypeScript ビルド通過

### Task 11: `src/app/layout.tsx` の更新

- **ACTION**: ルートレイアウトで `AuthProvider` で全体をラップ、メタデータと日本語 `lang` 属性を設定
- **IMPLEMENT**:
  ```tsx
  import "./globals.css";
  import type { Metadata } from "next";
  import { AuthProvider } from "@/lib/firebase/AuthProvider";

  export const metadata: Metadata = {
    title: "ALLin-Timer",
    description: "NLH サークル向けトーナメント進行支援",
  };

  export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
      <html lang="ja">
        <body>
          <AuthProvider>{children}</AuthProvider>
        </body>
      </html>
    );
  }
  ```
- **MIRROR**: AUTH_PROVIDER_PATTERN
- **IMPORTS**: 上記コード参照
- **GOTCHA**: `create-next-app` が生成する既定の `layout.tsx` を上書き。フォント設定（Geist 等）を保持したい場合はマージ
- **VALIDATE**: `npm run dev` で Hydration 警告が出ない

### Task 12: `src/app/page.tsx` の差し替え

- **ACTION**: 「Hello ALLin-Timer」最小ページ
- **IMPLEMENT**:
  ```tsx
  export default function Page() {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <h1 className="text-3xl font-bold">ALLin-Timer</h1>
      </main>
    );
  }
  ```
- **MIRROR**: NAMING_CONVENTION
- **IMPORTS**: —
- **GOTCHA**: —
- **VALIDATE**: ローカル／Vercel で表示される

### Task 13: `src/app/_debug/fs/page.tsx` — Firestore 疎通確認

- **ACTION**: 匿名ログイン → `tournaments` に空ドキュメントを書込 → 一覧表示の最小 UI。Phase 1 完了判定の中心。
- **IMPLEMENT**:
  ```tsx
  "use client";

  import { useState } from "react";
  import { signInAnonymously } from "firebase/auth";
  import {
    addDoc, collection, getDocs, serverTimestamp,
  } from "firebase/firestore";
  import { firebaseAuth, firestore } from "@/lib/firebase/client";
  import { logger } from "@/lib/logger";
  import { AppError } from "@/lib/errors";

  export default function DebugFsPage() {
    const [docs, setDocs] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);

    async function handleWrite() {
      try {
        if (!firebaseAuth.currentUser) await signInAnonymously(firebaseAuth);
        const ref = await addDoc(collection(firestore, "tournaments"), {
          ownerUid: firebaseAuth.currentUser!.uid,
          name: "debug",
          state: "setup",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        logger.info("debug write ok", { id: ref.id });
      } catch (e) {
        setError(new AppError("書込失敗", "firestore/write_failed", e).message);
      }
    }

    async function handleList() {
      const snap = await getDocs(collection(firestore, "tournaments"));
      setDocs(snap.docs.map((d) => `${d.id}: ${d.get("name")}`));
    }

    return (
      <main className="p-8 space-y-4">
        <h1 className="text-xl font-bold">Firestore 疎通確認</h1>
        <div className="space-x-2">
          <button onClick={handleWrite} className="px-3 py-1 border">書込</button>
          <button onClick={handleList}  className="px-3 py-1 border">一覧</button>
        </div>
        {error && <p className="text-red-600">{error}</p>}
        <ul className="list-disc pl-6">
          {docs.map((d) => <li key={d}>{d}</li>)}
        </ul>
      </main>
    );
  }
  ```
- **MIRROR**: FIREBASE_INIT_PATTERN, ERROR_HANDLING, LOGGING_PATTERN
- **IMPORTS**: 上記コード参照
- **GOTCHA**: 匿名ログインしないと Security Rules の `request.auth != null` で弾かれる。`tournaments` への書込はルール上「作成者のみ」なので、`ownerUid` を必ず `currentUser.uid` と一致させる
- **VALIDATE**: ローカルで「書込」→「一覧」押下 → 作成したドキュメント ID が表示。Firebase Console の Firestore ビューで実物確認

### Task 14: `.env.local.example` とドキュメント

- **ACTION**: Firebase 設定キーのテンプレを作成、README に取得手順を記載
- **IMPLEMENT**:
  ```
  # .env.local.example
  NEXT_PUBLIC_FIREBASE_API_KEY=
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
  NEXT_PUBLIC_FIREBASE_PROJECT_ID=
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
  NEXT_PUBLIC_FIREBASE_APP_ID=
  NEXT_PUBLIC_LOG_LEVEL=info
  ```
  `README.md`（日本語）に以下を記述:
  1. Firebase Console でプロジェクト作成手順
  2. Web アプリ登録 → 設定値をコピー → `.env.local` に貼付
  3. Authentication で「匿名」「メール／パスワード」「メールリンク」を有効化
  4. 承認済みドメインに `localhost` と Vercel 本番／プレビュー URL を追加
  5. Firestore を「本番モード」で作成（ルールは別ファイルでデプロイ）
  6. `npm install` → `.env.local` 作成 → `npm run dev`
  7. `firebase deploy --only firestore:rules` でルールデプロイ
- **MIRROR**: —
- **IMPORTS**: —
- **GOTCHA**: `.env.local` 自体は **絶対にコミットしない**（既存 `.gitignore` にルール在り、継承）
- **VALIDATE**: 新規クローンした状態から手順通りにたどると `/_debug/fs` まで動く

### Task 15: `firebase.json` / `firestore.rules` / `firestore.indexes.json` / `.firebaserc`

- **ACTION**: Firebase CLI 用の設定と Firestore ルールを作成
- **IMPLEMENT**:
  ```json
  // firebase.json
  {
    "firestore": {
      "rules": "firestore.rules",
      "indexes": "firestore.indexes.json"
    }
  }
  ```
  ```json
  // firestore.indexes.json
  { "indexes": [], "fieldOverrides": [] }
  ```
  ```json
  // .firebaserc
  { "projects": { "default": "YOUR_FIREBASE_PROJECT_ID" } }
  ```
  `firestore.rules` は「Patterns to Mirror / SECURITY_RULES_PATTERN」スニペットをそのまま
- **MIRROR**: SECURITY_RULES_PATTERN
- **IMPORTS**: —
- **GOTCHA**: `.firebaserc` のプロジェクト ID は**コミットして良い**（公開情報）が、念のため個人プロジェクト名を使う場合は README に注意書き
- **VALIDATE**: `firebase deploy --only firestore:rules` が成功

### Task 16: `LICENSE`（MIT）追加

- **ACTION**: MIT ライセンス本文をプロジェクト直下に配置
- **IMPLEMENT**: 標準 MIT テキスト、著作権者は運営者個人名（README 記載のユーザー名で仮置き、本人確認後に差し替え可能）
- **MIRROR**: —
- **IMPORTS**: —
- **GOTCHA**: 著作権者名と年（2026）を正しく記載
- **VALIDATE**: GitHub で「MIT License」バッジが自動認識される

### Task 17: `.gitignore` の統合整理

- **ACTION**: Next.js 初期化が生成する `.gitignore` を、既存 `.gitignore`（`tmp/`、`.env*.local` 等）とマージ
- **IMPLEMENT**: Next.js 標準 + 既存項目 + `.firebase/`（CLI キャッシュ）追加
- **MIRROR**: —
- **IMPORTS**: —
- **GOTCHA**: `.env.local` が含まれていることを目視確認（公開漏れ防止）
- **VALIDATE**: `git status` で `node_modules/`, `.next/`, `.env.local` が追跡対象外

### Task 18: Vercel デプロイ接続

- **ACTION**: Vercel プロジェクトを GitHub リポジトリに接続、環境変数を設定
- **IMPLEMENT**:
  1. GitHub に `ALLin-Timer` リポジトリを作成 → `main` push
  2. Vercel ダッシュボードで「Import Git Repository」
  3. 環境変数 `NEXT_PUBLIC_FIREBASE_*` を Production/Preview の両方に設定
  4. Firebase Console → Authentication → 承認済みドメインに Vercel 本番 URL を追加
- **MIRROR**: —
- **IMPORTS**: —
- **GOTCHA**: Vercel プレビュー URL は毎 PR で変わる。`vercel.com` の `*.vercel.app` をまるごと承認済みドメインに入れる運用を README に明記
- **VALIDATE**: Vercel 本番 URL で `/` と `/_debug/fs` が動作（書込／一覧が Firestore 反映）

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| `AppError` が `code`／`cause` を保持 | `new AppError("m","c",new Error("root"))` | `.code==="c"`, `.cause.message==="root"` | — |
| `logger.info` がレベル閾値でフィルタ | `NEXT_PUBLIC_LOG_LEVEL=warn` 下で `logger.info("x")` | console 呼び出し 0 回 | 環境変数境界 |
| `converter<T>()` が `fromFirestore` で型を返す | 模擬 `QueryDocumentSnapshot` | `data()` の戻り値をそのまま | — |

**注記**: Phase 1 は UI/ロジックがほぼ無いため、テストは「パターンの雛形」が主目的。Phase 4 のバランシングで本格化する。

### Edge Cases Checklist

- [ ] `.env.local` 未作成での起動 → 明示的なエラー表示（Task 8 の GOTCHA 実装）
- [ ] 匿名ログイン未実行で `/_debug/fs` の「一覧」押下 → Security Rules により拒否、UI にエラー表示
- [ ] Firebase Auth 承認済みドメイン未登録で Email Link 送信 → Firebase SDK 例外（Phase 2 で発火だが、Phase 1 で README に注意書き）
- [ ] Vercel プレビュー URL と Firebase 承認ドメイン不一致 → 認証失敗（README 注意）
- [ ] オフライン状態で `getDocs` → Firestore のオフライン永続化キャッシュから返る／最初から未ヒットでエラー（Phase 3 で切断 UI 対応）

---

## Validation Commands

### Static Analysis

```bash
npx tsc --noEmit
```
EXPECT: 型エラー 0

```bash
npm run lint
```
EXPECT: エラー／警告 0

### Unit Tests

```bash
npm test
```
EXPECT: 全テストパス（初期は 1〜3 件）

### Build

```bash
npm run build
```
EXPECT: Next.js のビルドが警告なしで完了

### Firestore Rules Deploy

```bash
firebase deploy --only firestore:rules
```
EXPECT: `✔ Deploy complete!`

### Browser Validation（ローカル）

```bash
npm run dev
```
EXPECT:
- `http://localhost:3000/` で「ALLin-Timer」見出し表示
- `http://localhost:3000/_debug/fs` で「書込」→成功、「一覧」→作成ドキュメント表示

### Browser Validation（Vercel 本番）

手動:
- Vercel 本番 URL の `/_debug/fs` で同様に動作することを確認

### Manual Validation

- [ ] Firebase Console → Firestore で `/_debug/fs` 書込のドキュメントが可視
- [ ] Firebase Console → Authentication → ユーザーに匿名ユーザーが 1 件作成されている
- [ ] Firebase Console → Authentication → Sign-in method で「匿名」「メール／パスワード」「メールリンク」3 方式が「有効」
- [ ] Firebase Console → Authentication → 承認済みドメインに `localhost` と Vercel 本番 URL（と望ましくは `*.vercel.app`）が登録
- [ ] `.env.local` が `git status` に現れない
- [ ] `LICENSE` が MIT として GitHub 上で認識される
- [ ] README に沿って新規環境で `npm install` → `npm run dev` → `/_debug/fs` 疎通確認まで辿れる

---

## Acceptance Criteria

- [ ] Next.js 15（App Router / TypeScript / Tailwind）プロジェクトが `d:\dev\ALLin-Timer` 直下にセットアップ済み
- [ ] shadcn/ui が初期化され、Button コンポーネントが import 可能
- [ ] Firebase Web SDK が singleton 初期化され、`@/lib/firebase/client` 経由で Auth / Firestore にアクセスできる
- [ ] 認証 3 方式（匿名／メール+PW／Email Link）が Firebase Console で有効
- [ ] `firestore.rules` がデプロイ済みで、所有者以外の書込が deny される
- [ ] `/_debug/fs` で匿名ログイン → Firestore 書込 → 一覧取得が成功
- [ ] Vercel 本番 URL で同等動作
- [ ] MIT ライセンスと日本語 README が配置
- [ ] `tsc --noEmit`、`npm run lint`、`npm test`、`npm run build` が全て成功

## Completion Checklist

- [ ] ファイル命名・配置が NAMING_CONVENTION に準拠
- [ ] すべての Firebase 初期化が `@/lib/firebase/client` 経由
- [ ] エラーは `AppError` でラップ
- [ ] ログは `logger` 経由（`console.log` 直呼びなし）
- [ ] Firestore アクセスは `converter<T>()` を通せる設計
- [ ] 認証状態は `useAuthUser` 経由で参照
- [ ] `.env.local` が `.gitignore` で除外済み
- [ ] セキュリティルールが deny-by-default
- [ ] `README.md` がセットアップを日本語で説明（Firebase 作成 → Vercel 連携まで）
- [ ] `_debug/fs` を Phase 5 で削除すべき TODO として PRD か本プランに記録

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| 非空ディレクトリで `create-next-app` が失敗 | M | L | `.claude/`, `tmp/`, `CLAUDE.md` を一時退避／`--force` で対応。既存 `.gitignore` は手動マージ |
| Firebase 承認済みドメイン設定漏れで Email Link 認証が Phase 2 で詰まる | M | M | Phase 1 の README で「`localhost` と `*.vercel.app`（または本番 URL 個別）を必ず追加」を強調 |
| Security Rules が厳しすぎて `_debug/fs` の疎通確認が出来ない | M | L | `tournaments` の `create` 条件を `ownerUid == request.auth.uid` に限定、書込時に必ず `ownerUid` を付与する仕様で回避 |
| Next.js 15 と Firebase SDK で Server Component 側に Firebase import が漏れて build エラー | L | M | Firebase を使うコンポーネントは必ず `"use client"` 宣言。`/_debug/fs/page.tsx` が client component である点を死守 |
| Vercel Hobby の帯域制限 | L | L | サークル規模では現実的に到達しない |
| `_debug/fs` が本番に残ることによる情報漏洩 | L | M | Phase 5 のチェックリストに削除タスクを明記（本プランの Completion Checklist 参照） |

## Notes

- 本 Phase は **UI の華やかさではなく土台の堅牢性**が目的。Tailwind の見た目調整は Phase 3（参加者閲覧画面）以降で深掘る。
- セキュリティルールは Phase 4 で**参加者自身の登録書込**（`tournaments/{tid}/players`）を許可する方向で緩和予定。Phase 1 では「所有者のみ書込」の保守的ルールに留める。
- Firebase Cloud Functions は Phase 3（タイマードリフト補正）／Phase 4（バランシング）で導入する。本 Phase では**プロジェクト作成時に有効化しない**（課金プラン変更が必要になるため、MVP は Firestore + Auth のみで押し切る想定）。
- `firebase-admin` は現段階で不要（Cloud Functions 導入時に追加）。
- Phase 1 完了時点で以下のコマンドを README に掲載しておくと Phase 2／3 の開発者が迷わない:
  - `npm run dev` / `npm run build` / `npm run lint` / `npm test`
  - `firebase deploy --only firestore:rules`
