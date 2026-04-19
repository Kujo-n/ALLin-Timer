# Plan: Phase 2 — Tournament Setup & Receipt（ストラクチャ／トーナメント CRUD ＋ 参加者受付）

## Summary

ALLin-Timer v1 の Phase 2 として、運営者がトーナメントを設定し、参加者を集められる状態を作る。具体的には (1) ストラクチャ（ブラインド構造・初期スタック・レイトエントリー締切レベル）の編集 UI とプリセット保存、(2) トーナメントの CRUD（作成／一覧／編集／削除）、(3) 参加者受付画面（URL/QR）と 3 択フロー（既存ログイン／ゲスト匿名参加／Email Link でのアカウント登録）を実装する。あわせて Phase 1 で TODO となっていた Firestore converter の **zod ベース runtime validation** を導入し、Phase 3 / 4 が安全に Firestore データを扱える基盤に引き上げる。

## User Story

As a ポーカー初心者中心サークルの兼任運営者,
I want トーナメント開始前に自サークル仕様のストラクチャを保存・流用しつつトーナメントを作成し、参加者には URL／QR を渡すだけで（ログイン／ゲスト／新規登録のいずれかで）受付を完結させたい,
So that 開催当日の事前準備が PC とスマホだけで完結し、参加者の受付に運営者の口頭対応や紙運用を一切介在させずに済む。

## Problem → Solution

**現状（Phase 1 完了時点）**: Firebase + Auth Provider + Firestore singleton + 型定義 + デバッグ書込ページ（`/debug/fs`）のみ。トーナメントの本物の作成導線も、ストラクチャを編集する UI も、参加者が受付するページも存在しない。`converter<T>()` は `as T` キャストのみで、Firestore からの malformed データが UI 深部まで伝播する穴がある（[converters.ts:7-12](src/lib/firebase/converters.ts#L7-L12) の `TODO(phase-2)`）。

**目標状態**:
- 運営者がブラウザで `/login` → `/tournaments` → 新規ストラクチャ作成 → 新規トーナメント作成 → 受付 URL／QR 表示まで一気通貫で操作できる。
- 参加者は配布された URL（`/join/{tid}`）から 3 択（ログイン／ゲスト／アカウント登録）で受付完了し、`tournaments/{tid}/players/{pid}` に自分のドキュメントが作成される。
- Firestore からの読取は、すべて zod schema で validate された型安全データになっている。

## Metadata

- **Complexity**: Large
- **Source PRD**: [.claude/PRPs/prds/allin-timer.prd.md](.claude/PRPs/prds/allin-timer.prd.md)
- **PRD Phase**: Phase 2 — Tournament Setup & Receipt
- **Dependencies**: Phase 1（complete）
- **Parallel With**: Phase 3（Timer & Realtime & Viewer）
- **Estimated Files**: 35〜45（route／component／lib／test 含む）

---

## UX Design

### Before

```
┌──────────────────────────────────────────────────┐
│  /                : ALLin-Timer 見出しのみ        │
│  /debug/fs        : 匿名で書込／一覧（debug 限定）│
│  認証 UI なし／受付なし／ストラクチャなし          │
└──────────────────────────────────────────────────┘
```

### After

```
┌────────────────────────────────────────────────────────────────────┐
│ 運営者フロー                                                       │
│  /login                  → メール+PW でログイン or 新規作成        │
│  /tournaments            → 自分のトーナメント一覧 ＋「新規作成」    │
│  /tournaments/new        → 名前 ＋ ストラクチャ選択 ＋ 作成        │
│  /tournaments/[tid]      → ダッシュボード（QR・URL・参加者一覧）   │
│  /tournaments/[tid]/edit → 名前変更 ／ ストラクチャ差替（setup 限）│
│  /structures             → プリセット一覧 ＋「新規」               │
│  /structures/new         → ブラインド構造エディタ（行追加／削除）  │
│  /structures/[sid]/edit  → 既存プリセット編集                      │
│                                                                    │
│ 参加者フロー（共通受付 URL）                                        │
│  /join/[tid]                                                       │
│   ├ (a) ログイン   → 既存メール+PW で完了                         │
│   ├ (b) ゲスト参加 → 表示名入力 → 匿名 Auth で完了                │
│   └ (c) アカウント登録 → メール入力 → メールリンク → 戻り先で完了 │
│                                                                    │
│ メールリンク戻り先                                                  │
│  /auth/email-link?tid={tid}&apiKey=...   ← Firebase Auth 戻り URL  │
└────────────────────────────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| 認証 | `/debug/fs` で匿名のみ | `/login` で Email+PW、`/join/[tid]` で 3 択 | Email Link は `actionCodeSettings.url` に戻り先を含める |
| ストラクチャ | 概念のみ（型定義） | プリセット保存／編集 UI、トーナメント作成時に snapshot コピー | 編集後の変更は既存トーナメントに伝播させない（snapshot による遮断） |
| トーナメント | なし | 作成／一覧／削除（`state==="setup"` のみ）／編集（名前・snapshot 差替） | 開始後（`running` 以降）の編集／削除は不可 |
| 参加者受付 | なし | QR 生成＋共有可能 URL 発行＋3 択フロー | 重複参加（同 uid）は冪等処理 |
| Firestore 読取 | `as T` キャスト | zod による runtime validate | 失敗は `firestore/invalid-data` で AppError ラップ |

---

## Mandatory Reading

実装着手前に必ず読むファイル。記憶に頼らず毎回 Read で現物確認する。

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | [CLAUDE.md](CLAUDE.md) | 全体 | プロジェクト全体規約・日本語応答・ルール参照義務 |
| P0 | [.claude/rules/firebase-patterns.md](.claude/rules/firebase-patterns.md) | 全体 | singleton／`useAuthUser`／`converter<T>()`／deny-by-default。**Phase 2 で converter に zod 統合する明示指示あり** |
| P0 | [.claude/rules/error-logging.md](.claude/rules/error-logging.md) | 全体 | `AppError` ラップ、ドメインコード命名、`logger` 経由 |
| P0 | [.claude/rules/security.md](.claude/rules/security.md) | 全体 | `.env.local` 管理、サークル固有情報の Firestore 限定保存、依存追加は ask モード |
| P0 | [src/lib/firebase/client.ts](src/lib/firebase/client.ts) | 1-49 | singleton の正規取り出し方／env 欠落時の throw 仕様 |
| P0 | [src/lib/firebase/AuthProvider.tsx](src/lib/firebase/AuthProvider.tsx) | 1-43 | `useAuthUser` の戻り値型／`onAuthStateChanged` の購読位置 |
| P0 | [src/lib/firebase/converters.ts](src/lib/firebase/converters.ts) | 1-18 | 既存 converter の API と TODO の所在（差し替え対象） |
| P0 | [src/lib/errors.ts](src/lib/errors.ts) | 1-18 | `AppError` 構造／`AppError.from()` の挙動（既存 AppError の pass-through） |
| P0 | [src/lib/logger.ts](src/lib/logger.ts) | 1-46 | レベル閾値挙動／`console` 直呼び禁止 |
| P0 | [src/types/tournament.ts](src/types/tournament.ts) | 1-83 | データモデル型（zod schema の真実源）／`Timestamp` 型は Web SDK 由来 |
| P0 | [firestore.rules](firestore.rules) | 1-34 | 既存ルール。Phase 2 で参加者書込許可に拡張する |
| P1 | [src/app/debug/fs/debug-fs-client.tsx](src/app/debug/fs/debug-fs-client.tsx) | 1-99 | `withConverter` 適用例／`AppError.from` 使用例／`logger.warn` 使用例（Phase 2 の Firestore 操作はここの形を踏襲する） |
| P1 | [src/app/layout.tsx](src/app/layout.tsx) | 1-22 | `AuthProvider` でラップ済み。新ページは Provider が効いている前提で書ける |
| P1 | [src/components/ui/button.tsx](src/components/ui/button.tsx) | 1-57 | shadcn 流の `forwardRef` + `cva` + `cn()` 構造（追加 UI コンポーネントもこの形） |
| P1 | [src/lib/utils.ts](src/lib/utils.ts) | 1-7 | `cn()` の所在（追加 shadcn コンポーネントから import） |
| P1 | [src/lib/errors.test.ts](src/lib/errors.test.ts) | 1-39 | テスト命名／配置／Vitest スタイル（同階層 `*.test.ts`） |
| P1 | [package.json](package.json) | 1-46 | 既存依存／`scripts`（`typecheck` / `test` / `lint`） |
| P1 | [tsconfig.json](tsconfig.json) | 1-34 | `strict`、`paths: { "@/*": ["./src/*"] }`、`vitest/globals` 型 |
| P1 | [components.json](components.json) | 1-21 | shadcn 設定（`new-york`、`zinc`、`@/components`、`@/lib/utils`） |
| P2 | [.claude/PRPs/plans/completed/phase-1-foundation.plan.md](.claude/PRPs/plans/completed/phase-1-foundation.plan.md) | 全体 | Phase 1 の決定事項全体 |
| P2 | [.claude/PRPs/reports/phase-1-foundation-report.md](.claude/PRPs/reports/phase-1-foundation-report.md) | 全体 | Phase 1 の deviation（`debug/`、`env.local.example`、placeholder fallback）／既知の落とし穴 |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Firebase Auth — Email/Password | https://firebase.google.com/docs/auth/web/password-auth | `createUserWithEmailAndPassword` / `signInWithEmailAndPassword` |
| Firebase Auth — Anonymous | https://firebase.google.com/docs/auth/web/anonymous-auth | `signInAnonymously(auth)` → `updateProfile(user, { displayName })` |
| Firebase Auth — Email Link | https://firebase.google.com/docs/auth/web/email-link-auth | `sendSignInLinkToEmail` → `actionCodeSettings.url` に戻り先（承認済みドメイン必須） |
| Firebase Auth — Email Link 戻り | 同上 | `isSignInWithEmailLink(auth, url)` → `signInWithEmailLink(auth, email, url)`、`window.localStorage` で email を保持 |
| Firestore — Server timestamps | https://firebase.google.com/docs/firestore/manage-data/add-data#server_timestamp | `serverTimestamp()` を `createdAt` / `updatedAt` に使う |
| Firestore — withConverter | https://firebase.google.com/docs/reference/js/firestore_.firestoredataconverter | `fromFirestore(snap, options)` で読取、`toFirestore` で書込時の型保証 |
| Firestore — Security Rules で参加者作成許可 | https://firebase.google.com/docs/firestore/security/rules-conditions | `request.resource.data.uid == request.auth.uid` などで自己ドキュメント作成許可 |
| zod | https://zod.dev/?id=basic-usage | `z.object({...}).parse(data)` で同期検証、失敗は `ZodError` |
| qrcode.react | https://github.com/zpao/qrcode.react | `<QRCodeSVG value={url} size={256} />` のみ。SVG なのでスケールしてもボケない |
| Next.js App Router — Dynamic Routes | https://nextjs.org/docs/app/building-your-application/routing/dynamic-routes | `app/tournaments/[tid]/page.tsx`、`params: { tid: string }` |
| Next.js App Router — `notFound()` | https://nextjs.org/docs/app/api-reference/functions/not-found | サーバ／クライアントどちらでも `notFound()` 呼べる |

**Research Findings**

```
KEY_INSIGHT: Email Link Sign-in は actionCodeSettings.url に戻り URL を完全 URL で指定する必要があり、
URL のホストは Firebase Console の「承認済みドメイン」に登録されていなければならない
APPLIES_TO: Task: Email Link 受付ルートと /auth/email-link コールバック実装
GOTCHA: localhost / Vercel 本番 / Vercel プレビュー の 3 種を Firebase Console に追加。
        プレビュー URL は PR ごとに変わるため `*.vercel.app` 一括許可 or 都度追加（README に既記載）
```

```
KEY_INSIGHT: 匿名ユーザーに `displayName` をつけるには `updateProfile(user, { displayName })` を
signInAnonymously の後に明示的に呼ぶ必要がある（匿名 Auth はデフォルトで displayName 空）
APPLIES_TO: ゲスト参加フロー
GOTCHA: `updateProfile` は Promise。完了前に Firestore に書込むと displayName が空になる場合がある
```

```
KEY_INSIGHT: Email Link コールバック時、ユーザーがメールリンクを別端末で開く可能性があるため
`window.localStorage.getItem("emailForSignIn")` が無いケースのフォールバック（メール再入力）が必要
APPLIES_TO: /auth/email-link ハンドラ
GOTCHA: Firebase 公式サンプル通り、未取得時は prompt() ではなく専用 UI でメール再入力させる
```

```
KEY_INSIGHT: Firestore Security Rules では list クエリ時に各ドキュメントが個別に評価されない場合がある
（ルールの `read: list` をフィルタ条件と整合させる必要あり）
APPLIES_TO: 「自分が ownerUid のトーナメント一覧」を取得する `where("ownerUid", "==", uid)` クエリ
GOTCHA: `tournaments` の read は現状「認証済みなら誰でも読める」緩いルールなので、
        Phase 2 では list レベルでの追加制約は不要。ただし将来 Phase 4 で参加者ドキュメント書込許可を
        追加する際、参加者自身が他人のトーナメントの players を列挙できないようにルールを精緻化する
```

```
KEY_INSIGHT: Next.js App Router の `notFound()` は build 時の静的生成中にも呼べる
APPLIES_TO: /debug/fs でも使われている（Phase 1 で導入済み）。Phase 2 でも同パターン使用可
GOTCHA: dynamic route の `[tid]` ページで「存在しないトーナメント」のとき、
        サーバ側で getDoc → exists() チェックして notFound() するのが最も素直
```

```
KEY_INSIGHT: zod schema を `fromFirestore` に統合する標準パターンは、
schema を取り回すために `converter<T>(schema)` を schema 引数化すること
APPLIES_TO: src/lib/firebase/converters.ts のリプレース
GOTCHA: `Timestamp` は zod ネイティブの primitive ではないので `z.instanceof(Timestamp)` を使う。
        `serverTimestamp()` の戻りは `FieldValue` で書込時のみ。読取時は `Timestamp` に解決される
```

---

## Patterns to Mirror

新たに導入する標準パターン。Phase 3／4 はこれらをそのまま踏襲する。

### NAMING_CONVENTION
```
// SOURCE: Phase 1 で確立（NAMING_CONVENTION セクション）
// 維持事項:
//   - ディレクトリ kebab-case（例: `src/app/tournaments/`）
//   - React コンポーネント PascalCase、default export 可
//   - フック camelCase + `use` 接頭辞
//   - 型 PascalCase、`I` 接頭辞なし
//   - ファイル単位 1 責務、`page.tsx` / `layout.tsx` / `route.ts` は予約名厳守
//
// Phase 2 追加:
//   - dynamic route セグメント `[tid]`、`[sid]`（PRD 用語と一致：tournament id / structure id）
//   - クライアント専用ページは `*-client.tsx` を分離、`page.tsx` から default 描画
//     （SOURCE: src/app/debug/fs/page.tsx + debug-fs-client.tsx）
//   - Firestore リポジトリは `src/lib/firebase/repositories/{collection}.ts`
//   - zod schema は `src/lib/firebase/schemas/{collection}.ts`
```

### ERROR_HANDLING
```ts
// SOURCE: src/lib/errors.ts:1-18 + src/app/debug/fs/debug-fs-client.tsx:53-58
// 1) すべての例外を AppError でラップ
// 2) ドメインコードは `firestore/*` `auth/*` `tournament/*` `validation/*` のいずれか
// 3) UI 側は logger.warn を併走させたうえで code を表示

try {
  const ref = await addDoc(tournamentsRef, payload);
  logger.info("tournament create ok", { id: ref.id });
} catch (e) {
  const wrapped = AppError.from(e, "firestore/write_failed", "トーナメント作成に失敗しました");
  logger.warn(wrapped.message, { code: wrapped.code });
  setError(`${wrapped.code}: ${wrapped.message}`);
}
```

```ts
// 新規ドメインコード（Phase 2 で導入）
// firestore/invalid-data           — converter の zod parse 失敗
// firestore/not-found              — getDoc().exists() === false
// firestore/permission-denied      — Firebase 'permission-denied' を再ラップ
// auth/email-link-invalid          — isSignInWithEmailLink === false
// auth/email-missing-on-callback   — localStorage に email が無く UI で再入力中
// auth/already-exists              — createUserWithEmailAndPassword で 'auth/email-already-in-use'
// validation/structure-empty       — levels が空
// validation/level-non-positive    — sb/bb/durationSec が 0 以下
// tournament/already-started       — state !== "setup" の編集／削除
// tournament/late-entry-closed     — 受付フォーム提出時に state === "finished" or 締切超過
```

### LOGGING_PATTERN
```ts
// SOURCE: src/lib/logger.ts:40-45 + src/app/debug/fs/debug-fs-client.tsx:52,55
// console.* 直呼び禁止（Phase 1 で確立）。常に logger 経由。
// meta は構造化オブジェクト。code を含めると後続の grep/フィルタが楽。

logger.info("structure preset saved", { sid: ref.id, levelsCount: levels.length });
logger.warn(wrapped.message, { code: wrapped.code, tid });
logger.error("email link callback failed", { code: wrapped.code });
```

### FIREBASE_INIT_PATTERN
```ts
// SOURCE: src/lib/firebase/client.ts:46-48
// Phase 2 でも import は @/lib/firebase/client から固定。
// initializeApp / getApp / getAuth / getFirestore を他所で呼ばない。

import { firebaseAuth, firestore } from "@/lib/firebase/client";
```

### AUTH_PROVIDER_PATTERN
```tsx
// SOURCE: src/lib/firebase/AuthProvider.tsx:21-42
// Phase 2 でも認証状態は useAuthUser 経由のみ。
// onAuthStateChanged を Component で直接購読しない。
// loading: true の間は「読込中」UI を出して保護ページの中身を出さない。

"use client";
import { useAuthUser } from "@/lib/firebase/AuthProvider";

function ProtectedPage() {
  const { user, loading } = useAuthUser();
  if (loading) return <p>読込中…</p>;
  if (!user) return <RedirectToLogin />;
  return <Content user={user} />;
}
```

### FIRESTORE_CONVERTER_PATTERN（Phase 2 で zod 統合へリプレース）
```ts
// SOURCE: 新規（src/lib/firebase/converters.ts を差し替え）
// Phase 1 の TODO(phase-2) を解消。schema を引数化して runtime validate する。

import {
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
  type WithFieldValue,
} from "firebase/firestore";
import type { ZodType } from "zod";

import { AppError } from "@/lib/errors";

export function zodConverter<TRead, TWrite extends Record<string, unknown> = TRead & Record<string, unknown>>(
  schema: ZodType<TRead>,
  collectionName: string,
): FirestoreDataConverter<TRead, TWrite> {
  return {
    toFirestore: (data: WithFieldValue<TWrite>) => data as Record<string, unknown>,
    fromFirestore: (snap: QueryDocumentSnapshot) => {
      const raw = snap.data();
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        throw new AppError(
          `Firestore document failed schema validation: ${collectionName}/${snap.id}`,
          "firestore/invalid-data",
          parsed.error,
        );
      }
      return parsed.data;
    },
  };
}
```

```ts
// 既存 `converter<T>()` は後方互換のため一時的に残し、debug-fs-client.tsx などの
// テスト的呼び出しは zodConverter 化で置換する。Phase 2 完了時点で converter<T>() は削除する。
```

### ZOD_SCHEMA_PATTERN（Phase 2 新規）
```ts
// SOURCE: 新規（src/lib/firebase/schemas/structure.ts 等）
// schema は src/types/tournament.ts の TypeScript 型と 1 対 1 で対応させる。
// Timestamp は z.instanceof(Timestamp) で扱う（Web SDK の Timestamp）。

import { Timestamp } from "firebase/firestore";
import { z } from "zod";

export const levelSchema = z.object({
  level: z.number().int().positive(),
  sb: z.number().int().nonnegative(),
  bb: z.number().int().positive(),
  ante: z.number().int().nonnegative(),
  durationSec: z.number().int().positive(),
});

export const structureSchema = z.object({
  id: z.string().min(1),
  ownerUid: z.string().min(1),
  name: z.string().min(1),
  initialStack: z.number().int().positive(),
  lateEntryDeadlineLevel: z.number().int().positive(),
  levels: z.array(levelSchema).min(1),
  createdAt: z.instanceof(Timestamp),
});

export type StructureDoc = z.infer<typeof structureSchema>;
```

### REPOSITORY_PATTERN（Phase 2 新規）
```ts
// SOURCE: 新規（src/lib/firebase/repositories/tournaments.ts）
// 1 collection = 1 ファイル。Firestore SDK 呼び出しはここに集約し、
// UI/component から直接 collection() / doc() / addDoc() を呼ばない。

import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, query,
  serverTimestamp, updateDoc, where,
} from "firebase/firestore";

import { firestore } from "@/lib/firebase/client";
import { AppError } from "@/lib/errors";
import { zodConverter } from "@/lib/firebase/converters";
import { tournamentSchema, type TournamentDoc } from "@/lib/firebase/schemas/tournament";

const tournamentsRef = collection(firestore, "tournaments")
  .withConverter(zodConverter(tournamentSchema, "tournaments"));

export async function createTournament(input: CreateTournamentInput): Promise<string> {
  const docRef = await addDoc(tournamentsRef, {
    ...input,
    state: "setup",
    currentLevel: 0,
    startedAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
}

export async function getTournament(tid: string): Promise<TournamentDoc> {
  const snap = await getDoc(doc(tournamentsRef, tid));
  if (!snap.exists()) {
    throw new AppError(`tournament not found: ${tid}`, "firestore/not-found");
  }
  return snap.data();
}

export async function listMyTournaments(uid: string): Promise<TournamentDoc[]> {
  const q = query(tournamentsRef, where("ownerUid", "==", uid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data());
}

export async function deleteTournamentIfSetup(tid: string, uid: string): Promise<void> {
  const t = await getTournament(tid);
  if (t.ownerUid !== uid) {
    throw new AppError("not allowed", "firestore/permission-denied");
  }
  if (t.state !== "setup") {
    throw new AppError("既に開始済みのトーナメントは削除できません", "tournament/already-started");
  }
  await deleteDoc(doc(tournamentsRef, tid));
}
```

### SERVICE_PATTERN（Phase 2 新規・必要最小限）
```ts
// SOURCE: 新規（src/lib/services/receipt.ts）
// 受付ロジックは「認証 → ユーザープロフィール upsert → players 書込 → state チェック」と
// 順序依存があるためサービス層に集約。UI は呼び出すだけ。

import { joinAsExistingUser, joinAsGuest } from "@/lib/services/receipt";

await joinAsGuest({ tid, displayName: "Alice" });
```

### ZOD_FORM_PATTERN（Phase 2 新規）
```tsx
// SOURCE: 新規（src/app/structures/new/structure-form.tsx 等）
// react-hook-form は Phase 2 では未導入。controlled state + 提出時 schema.parse のみ。
// バリデーション失敗は AppError("validation/...") に変換し、フォーム下にメッセージ表示。

const result = structureFormSchema.safeParse(formState);
if (!result.success) {
  setError(`validation/structure: ${result.error.issues.map(i => i.message).join(", ")}`);
  return;
}
await createStructure({ ...result.data, ownerUid: user.uid });
```

### TEST_STRUCTURE
```ts
// SOURCE: src/lib/errors.test.ts:1-39 + vitest.config.ts
// Vitest、対象と同階層 *.test.ts。jsdom 環境（vitest.config.ts で設定済み）。
// Phase 2 のテスト対象:
//   - zod schema（valid / invalid 両方の例）
//   - zodConverter（fromFirestore で AppError("firestore/invalid-data") を投げる）
//   - 受付サービスのドメイン分岐（state チェック、displayName 必須）
// Firestore SDK そのもののモックはしない（Phase 4 で必要になったら検討）。
```

### SECURITY_RULES_PATTERN（Phase 2 で参加者作成許可を追加）
```
// SOURCE: 既存 firestore.rules:1-34 を拡張
// 既存の subcollection ルールは「親トーナメントの owner のみ書込可」だが、
// Phase 2 で参加者が自分自身の players ドキュメントを作れるよう exception を追加する。

match /tournaments/{tid}/players/{pid} {
  allow read: if request.auth != null;
  // 参加者本人による自己作成（Phase 2: 受付フロー）
  // 条件: 認証済み／pid が auth.uid と一致／ownerUid フィールドはなく uid フィールドが auth.uid
  allow create: if request.auth != null
                && pid == request.auth.uid
                && request.resource.data.uid == request.auth.uid
                && request.resource.data.isBusted == false;
  // 自己更新は表示名変更のみ許容（Phase 2 では編集 UI なし、将来用）
  allow update: if request.auth != null
                && pid == request.auth.uid
                && resource.data.uid == request.auth.uid;
  // 削除は所有者のみ
  allow delete: if request.auth != null
                && get(/databases/$(database)/documents/tournaments/$(tid)).data.ownerUid == request.auth.uid;
}
```

```
// 補足: 参加者ドキュメント ID を auth.uid と一致させることで「同 uid による重複参加を冪等」化。
// ゲスト（匿名 Auth）の uid は Firebase 側で一意発行されるため、再来訪時も同じ uid。
// ただし「同じユーザーが別端末からゲスト参加」した場合は別 uid になる（既知の制約。Phase 5 で必要なら検討）。
```

---

## Files to Change

### 依存追加（package.json）

| Package | Where | Justification |
|---|---|---|
| `zod` | dependencies | converter の runtime validation／フォーム送信時 validate |
| `qrcode.react` | dependencies | 受付 URL の QR を SVG で生成（軽量・SVG なのでスケール可） |
| `@radix-ui/react-label` | dependencies | shadcn label コンポーネント基盤 |
| `@radix-ui/react-dialog` | dependencies | shadcn dialog（削除確認・QR モーダル） |
| `@radix-ui/react-select` | dependencies | shadcn select（ストラクチャ選択） |

`react-hook-form` は導入しない（controlled state + zod safeParse で十分）。

### CREATE / UPDATE

| File | Action | Justification |
|---|---|---|
| `package.json` | UPDATE | 上記依存追加 |
| `src/lib/firebase/converters.ts` | UPDATE | `zodConverter` を追加。既存 `converter<T>()` を Phase 2 完了時点で削除 |
| `src/lib/firebase/schemas/structure.ts` | CREATE | `levelSchema` / `structureSchema` |
| `src/lib/firebase/schemas/tournament.ts` | CREATE | `tournamentSchema` / `createTournamentInputSchema` |
| `src/lib/firebase/schemas/player.ts` | CREATE | `playerSchema` / `joinInputSchema` |
| `src/lib/firebase/schemas/user.ts` | CREATE | `userProfileSchema` |
| `src/lib/firebase/schemas/index.test.ts` | CREATE | 各 schema の valid / invalid サンプルテスト |
| `src/lib/firebase/converters.test.ts` | CREATE | `zodConverter` の fromFirestore 成功／失敗テスト |
| `src/lib/firebase/repositories/structures.ts` | CREATE | structure CRUD |
| `src/lib/firebase/repositories/tournaments.ts` | CREATE | tournament CRUD |
| `src/lib/firebase/repositories/players.ts` | CREATE | player 受付（create / list） |
| `src/lib/firebase/repositories/users.ts` | CREATE | userProfile upsert |
| `src/lib/services/receipt.ts` | CREATE | 受付サービス（3 択それぞれ） |
| `src/lib/services/receipt.test.ts` | CREATE | 受付サービスの分岐テスト（state 不可、displayName 空など） |
| `src/lib/services/auth-actions.ts` | CREATE | login / register / sendEmailLink / completeEmailLink ヘルパ |
| `src/lib/services/qr.ts` | CREATE | 受付 URL 組み立て（`new URL("/join/" + tid, origin)`） |
| `src/components/ui/input.tsx` | CREATE | shadcn input（手書き or shadcn copy） |
| `src/components/ui/label.tsx` | CREATE | shadcn label |
| `src/components/ui/card.tsx` | CREATE | shadcn card |
| `src/components/ui/dialog.tsx` | CREATE | shadcn dialog |
| `src/components/ui/select.tsx` | CREATE | shadcn select |
| `src/components/ui/textarea.tsx` | CREATE | shadcn textarea（structure name 等） |
| `src/components/auth/RequireAuth.tsx` | CREATE | `useAuthUser` で gate、未認証は `/login?redirect=...` |
| `src/components/auth/AuthBadge.tsx` | CREATE | header に表示（任意） |
| `src/components/qr/QrPanel.tsx` | CREATE | URL 表示＋QR＋コピー |
| `src/components/structure/StructureForm.tsx` | CREATE | 行追加／削除／blur 時 validate |
| `src/components/structure/LevelTable.tsx` | CREATE | 編集セル（input） |
| `src/components/tournament/TournamentForm.tsx` | CREATE | 名前 ＋ ストラクチャ select |
| `src/components/tournament/PlayerList.tsx` | CREATE | 参加者一覧（受付確認用、`onSnapshot` は Phase 3 で導入。Phase 2 は getDocs で都度取得） |
| `src/app/login/page.tsx` | CREATE | `/login` |
| `src/app/login/login-client.tsx` | CREATE | login + register UI |
| `src/app/auth/email-link/page.tsx` | CREATE | コールバック handler。`isSignInWithEmailLink` チェック |
| `src/app/auth/email-link/email-link-client.tsx` | CREATE | URL 検証 → 完了 → `redirect` クエリ先へ |
| `src/app/structures/page.tsx` | CREATE | 一覧 |
| `src/app/structures/structures-client.tsx` | CREATE | 一覧 UI（owner only） |
| `src/app/structures/new/page.tsx` | CREATE | 新規 |
| `src/app/structures/new/structure-new-client.tsx` | CREATE | StructureForm wrapper |
| `src/app/structures/[sid]/edit/page.tsx` | CREATE | 編集 |
| `src/app/structures/[sid]/edit/structure-edit-client.tsx` | CREATE | StructureForm wrapper（既存読み込み） |
| `src/app/tournaments/page.tsx` | CREATE | 一覧 |
| `src/app/tournaments/tournaments-client.tsx` | CREATE | 一覧 UI |
| `src/app/tournaments/new/page.tsx` | CREATE | 新規 |
| `src/app/tournaments/new/tournament-new-client.tsx` | CREATE | TournamentForm wrapper |
| `src/app/tournaments/[tid]/page.tsx` | CREATE | ダッシュボード |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | CREATE | QR/URL 表示・参加者リスト・編集／削除リンク |
| `src/app/tournaments/[tid]/edit/page.tsx` | CREATE | 編集（state==="setup" のみ） |
| `src/app/tournaments/[tid]/edit/tournament-edit-client.tsx` | CREATE | TournamentForm wrapper |
| `src/app/join/[tid]/page.tsx` | CREATE | 受付エントリ |
| `src/app/join/[tid]/join-client.tsx` | CREATE | 3 択 UI（タブ／カード） |
| `src/app/page.tsx` | UPDATE | トップページから `/login` ／ `/tournaments` への導線追加 |
| `firestore.rules` | UPDATE | `tournaments/{tid}/players/{pid}` の create/update を本人許可、`structures` の list 条件 |
| `README.md` | UPDATE | Auth 3 方式の有効化／承認済みドメイン手順／QR 共有手順を追記 |

### NOT Building（Phase 2 のスコープ外）

- **タイマーカウントダウン UI／レベル自動繰り上げ／`onSnapshot` 同期** — Phase 3
- **接続切断時 UI（最終時刻＋「接続切れ」表示）** — Phase 3
- **参加者閲覧画面（モバイル最適化）** — Phase 3
- **初回席決め／バスト／TDA バランシング／レイトエントリー自動配席** — Phase 4
- **テーブル／座席ドキュメントの作成・初期化** — Phase 4（Phase 2 は `players` のみ）
- **トーナメント開始操作・state 遷移ロジック** — Phase 3 で `running` への遷移を実装
- **賞金計算（単純分配）** — Phase 5（Should）
- **ストラクチャ JSON インポート／エクスポート** — v1.1 以降
- **同 uid 重複参加の高度な制御（別端末からのゲスト再参加）** — 既知制約として記録のみ
- **国際化（i18n）** — 日本語固定で良い（PRD 準拠）
- **ダークモードトグル** — globals.css は両対応だが UI トグル不要
- **CI（GitHub Actions）** — Vercel Preview ／ ローカル `npm test` で代替

---

## Step-by-Step Tasks

### Task 1: 依存追加（ask モードで承認）

- **ACTION**: zod / qrcode.react / radix-ui の必要パッケージを追加
- **IMPLEMENT**:
  ```bash
  npm install zod qrcode.react @radix-ui/react-label @radix-ui/react-dialog @radix-ui/react-select
  ```
- **MIRROR**: —（[security.md](.claude/rules/security.md) の依存追加ポリシーに従い、ask モードで実行され承認を取る）
- **IMPORTS**: —
- **GOTCHA**: `qrcode.react` は v4 系で named export `QRCodeSVG`／`QRCodeCanvas`。default export ではない
- **VALIDATE**: `package.json` の `dependencies` に上記 5 つが追加されている

### Task 2: zod schema 群（structure / tournament / player / user）

- **ACTION**: `src/lib/firebase/schemas/{structure,tournament,player,user}.ts` を新規作成
- **IMPLEMENT**: 「Patterns to Mirror / ZOD_SCHEMA_PATTERN」を踏襲。`src/types/tournament.ts` の各 interface と 1 対 1 で対応する schema を定義。`Timestamp` は `z.instanceof(Timestamp)`、`null` 許容フィールドは `.nullable()`。`createdAt` 等の write-time の型は `z.union([z.instanceof(Timestamp), z.instanceof(FieldValue)])` を使うか、書込用 input schema を別定義（推奨：input schema を別出し）
- **MIRROR**: ZOD_SCHEMA_PATTERN
- **IMPORTS**: `from "firebase/firestore"`、`from "zod"`、`type Tournament from "@/types/tournament"`
- **GOTCHA**: schema と TS 型の二重管理を避けるため、各ファイルで `export type StructureDoc = z.infer<typeof structureSchema>` を export し、`src/types/tournament.ts` の interface はリプレース（または schema 由来型を再 export）。**推奨：interface を残しつつ「schema → infer 型は同じ shape にする責任を持つ」運用。schema 側を真実源とし、`tournament.ts` は将来削除可とコメント**
- **VALIDATE**: `npm test` で各 schema の valid／invalid テスト pass、`npx tsc --noEmit` 通過

### Task 3: zodConverter 実装と既存 converter の置換準備

- **ACTION**: `src/lib/firebase/converters.ts` に `zodConverter` を追加。既存 `converter<T>()` も Phase 2 中の漸進移行のため一旦残し、`@deprecated` JSDoc を付与
- **IMPLEMENT**: 「Patterns to Mirror / FIRESTORE_CONVERTER_PATTERN」をそのまま。`AppError("firestore/invalid-data")` を schema parse 失敗時に throw
- **MIRROR**: FIRESTORE_CONVERTER_PATTERN
- **IMPORTS**: `from "firebase/firestore"`, `from "zod"`, `AppError from "@/lib/errors"`
- **GOTCHA**: `WithFieldValue<TWrite>` の型推論は `serverTimestamp()` を含む書込ペイロード（`FieldValue`）を許容するために必要。`toFirestore` の戻り値はそのまま `data` を返す（変換しない）
- **VALIDATE**: `src/lib/firebase/converters.test.ts` で valid 1／invalid 1（zod が落ちる）／not-exists（呼ばれない）の 2 ケース pass

### Task 4: Firestore Security Rules を Phase 2 形に更新

- **ACTION**: `firestore.rules` を更新し、`tournaments/{tid}/players/{pid}` の create/update を本人 uid に許可（pid == auth.uid 制約）
- **IMPLEMENT**: 「Patterns to Mirror / SECURITY_RULES_PATTERN」の差分をそのまま反映。既存の `match /{sub=**}` ブロックは残しつつ、より具体的な `match /tournaments/{tid}/players/{pid}` を上に追加（具体マッチ優先）
- **MIRROR**: SECURITY_RULES_PATTERN
- **IMPORTS**: —
- **GOTCHA**: Firestore Security Rules は最も具体的なマッチが先に評価されるわけではなく、**全ての一致 match の allow を OR** で評価する。`{sub=**}` の write 条件（owner のみ）と players の create 条件（self）が並列適用される。OR なのでどちらかが通れば許可、よって players は self が通る点だけ確認すればよい
- **VALIDATE**: ローカルで `firebase deploy --only firestore:rules` または Emulator UI でルールテスト（受付 emu 試験は Task 12 と合わせて行う）

### Task 5: shadcn UI コンポーネント追加（手書き）

- **ACTION**: `src/components/ui/{input,label,card,dialog,select,textarea}.tsx` を shadcn 公式テンプレ準拠で配置
- **IMPLEMENT**: 各ファイル shadcn 公式の `new-york` スタイル準拠コードを書く（[button.tsx](src/components/ui/button.tsx) と同様の `forwardRef` + `cn()` 構造）。CLI は既存規約と矛盾するため使わない（Phase 1 の deviation 踏襲）
- **MIRROR**: [src/components/ui/button.tsx](src/components/ui/button.tsx) と [src/lib/utils.ts](src/lib/utils.ts) の `cn()`
- **IMPORTS**: `cn from "@/lib/utils"`、各 radix-ui パッケージ
- **GOTCHA**: shadcn 公式 v1.x のコードを貼る。`select` は radix-ui の `Trigger` `Content` `Item` を組合わせる。Tailwind class は `globals.css` の CSS variable（zinc）と整合する
- **VALIDATE**: トップページや既存 `debug-fs-client.tsx` 等で各コンポーネントの import が型エラーなく成立、`npm run build` 通過

### Task 6: Repositories 層（structures / tournaments / players / users）

- **ACTION**: `src/lib/firebase/repositories/{structures,tournaments,players,users}.ts` を作成
- **IMPLEMENT**: 「Patterns to Mirror / REPOSITORY_PATTERN」テンプレを各コレクション分作成。各ファイルで `xxxRef = collection(firestore, "...").withConverter(zodConverter(xxxSchema, "..."))` を最上位定数に。CRUD 関数の引数／戻り値は zod 由来型（`z.infer`）。例外は `AppError.from(e, "firestore/...")` で必ずラップ
- **MIRROR**: REPOSITORY_PATTERN, ERROR_HANDLING, LOGGING_PATTERN
- **IMPORTS**: `firebase/firestore`、`@/lib/firebase/client`、`@/lib/firebase/converters`、`@/lib/firebase/schemas/*`、`@/lib/errors`、`@/lib/logger`
- **GOTCHA**:
  - `addDoc(ref, payload)` の payload は `serverTimestamp()` 含むため `WithFieldValue` 互換性に注意。zodConverter の write 型が広いので問題ない見込み
  - `players` の作成は `setDoc(doc(playersRef, uid), ...)` で **doc id を auth.uid に固定**（重複参加冪等化、ルールと整合）
  - `getDoc().exists()` を必ずチェック、無ければ `firestore/not-found`
- **VALIDATE**: typecheck 通過。実 Firestore 接続テストは Task 14 で manual 実施

### Task 7: 認証アクションヘルパ（login / register / email link）

- **ACTION**: `src/lib/services/auth-actions.ts` に Firebase Auth 操作をラップした関数群を作成
- **IMPLEMENT**: 提供する関数:
  - `loginWithEmail(email, password): Promise<User>`（`signInWithEmailAndPassword`）
  - `registerWithEmail(email, password): Promise<User>`（`createUserWithEmailAndPassword`）
  - `signInAsGuest(displayName: string): Promise<User>`（`signInAnonymously` → `updateProfile`）
  - `sendEmailLinkForJoin(email: string, redirectPath: string): Promise<void>`（`sendSignInLinkToEmail` + `localStorage.setItem("emailForSignIn", email)`）
  - `completeEmailLink(currentUrl: string, fallbackEmail?: string): Promise<User>`（`isSignInWithEmailLink` → `signInWithEmailLink`）
  - `logout(): Promise<void>`
  すべて `try/catch` で AppError ラップ。`auth/email-already-in-use` → `auth/already-exists`、`auth/wrong-password` → `auth/invalid-credentials` 等にコード正規化
- **MIRROR**: ERROR_HANDLING, LOGGING_PATTERN, FIREBASE_INIT_PATTERN
- **IMPORTS**: `firebase/auth`、`@/lib/firebase/client`、`@/lib/errors`、`@/lib/logger`
- **GOTCHA**:
  - `actionCodeSettings.url` には**完全 URL**を渡す。`new URL("/auth/email-link", window.location.origin).toString()` で組み立て、`?redirect=/join/{tid}` をクエリ付与
  - `actionCodeSettings.handleCodeInApp = true` 必須
  - email link で開いた端末が登録時と異なる場合 `localStorage` に email が無い → `fallbackEmail` 引数で UI から再取得
- **VALIDATE**: typecheck 通過。実テストは Task 13/15 で UI と合わせて

### Task 8: 受付サービス（receipt）

- **ACTION**: `src/lib/services/receipt.ts` に 3 択それぞれの「認証 → user upsert → players 書込」を実装
- **IMPLEMENT**: 提供する関数:
  - `joinAsExistingUser({ tid, email, password }): Promise<void>` — Auth login → players 作成
  - `joinAsGuest({ tid, displayName }): Promise<void>` — anonymous → players 作成
  - `joinViaEmailLinkRequest({ tid, email }): Promise<void>` — email link 送信のみ
  - `joinViaEmailLinkComplete({ tid, currentUrl, fallbackEmail? }): Promise<void>` — email link 完了 → user upsert → players 作成
  共通処理 `ensurePlayerCreated(tid, user)` を内部で呼び、`getTournament(tid)` で `state` チェック（`finished` なら `tournament/late-entry-closed` を投げる）。レイトエントリー締切レベルチェックは Phase 4 で実装するため、Phase 2 では state（`finished` のみ拒否）まで
- **MIRROR**: SERVICE_PATTERN, ERROR_HANDLING, LOGGING_PATTERN
- **IMPORTS**: `@/lib/firebase/repositories/{tournaments,players,users}`、`@/lib/services/auth-actions`
- **GOTCHA**:
  - `displayName` が空文字／空白のみの場合は弾く（`validation/display-name-required`）
  - 同 uid で再来訪したら `setDoc(merge: true)` で displayName 等の更新のみ。新規ドキュメント書込にしない（PRD「重複参加防止」要件）
- **VALIDATE**: `src/lib/services/receipt.test.ts` で displayName 空・state finished・正常系の 3 ケース最低 pass

### Task 9: 認証 gate コンポーネント

- **ACTION**: `src/components/auth/RequireAuth.tsx` で「未認証なら `/login?redirect=現在パス` にリダイレクト」する Provider 風コンポーネント
- **IMPLEMENT**:
  ```tsx
  "use client";
  import { useRouter, usePathname } from "next/navigation";
  import { useEffect, type ReactNode } from "react";
  import { useAuthUser } from "@/lib/firebase/AuthProvider";

  export function RequireAuth({ children, allowAnonymous = false }: { children: ReactNode; allowAnonymous?: boolean }) {
    const { user, loading } = useAuthUser();
    const router = useRouter();
    const pathname = usePathname();
    useEffect(() => {
      if (loading) return;
      if (!user || (!allowAnonymous && user.isAnonymous)) {
        router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
      }
    }, [user, loading, router, pathname, allowAnonymous]);
    if (loading) return <p className="p-8 text-sm">読込中…</p>;
    if (!user) return null;
    if (!allowAnonymous && user.isAnonymous) return null;
    return <>{children}</>;
  }
  ```
- **MIRROR**: AUTH_PROVIDER_PATTERN
- **IMPORTS**: 上記コード参照
- **GOTCHA**: `router.replace` を `useEffect` 内で。レンダ中の遷移は警告
- **VALIDATE**: `/tournaments` 等の保護ページで未認証時に `/login` に飛ぶ

### Task 10: `/login` ページ（メール+PW のログイン／登録）

- **ACTION**: `src/app/login/page.tsx` ＋ `login-client.tsx` を作成
- **IMPLEMENT**: タブ or トグルでログイン／登録切替。`auth-actions.loginWithEmail` / `registerWithEmail` を呼び、成功時は `searchParams.get("redirect") ?? "/tournaments"` に `router.replace`
- **MIRROR**: ZOD_FORM_PATTERN, ERROR_HANDLING, AUTH_PROVIDER_PATTERN
- **IMPORTS**: `@/lib/services/auth-actions`、shadcn `Card` `Input` `Button` `Label`
- **GOTCHA**: 既にログイン済み（`useAuthUser` の user が non-null かつ非匿名）なら `/tournaments` へ飛ばす（`useEffect`）
- **VALIDATE**: 新規登録 → 自動ログイン → `/tournaments` に到達。既存 PW 違いで `auth/invalid-credentials` 表示

### Task 11: ストラクチャ CRUD UI（一覧／新規／編集）

- **ACTION**: `src/app/structures/{page.tsx,structures-client.tsx,new/{page.tsx,structure-new-client.tsx},[sid]/edit/{page.tsx,structure-edit-client.tsx}}` を作成。共通 `src/components/structure/{StructureForm.tsx,LevelTable.tsx}`
- **IMPLEMENT**:
  - 一覧: `listMyStructures(uid)` で取得、Card grid で表示。「編集」「削除」「新規作成」リンク
  - 新規: `StructureForm` で名前／初期スタック／late entry deadline / levels 編集（行追加・削除）→ 提出時 `structureFormSchema.safeParse` → `createStructure(...)`
  - 編集: 既存読込 → 同 form → `updateStructure(sid, patch)`
  - 削除: shadcn `Dialog` で確認 → `deleteStructure(sid)`
- **MIRROR**: REPOSITORY_PATTERN, ZOD_FORM_PATTERN, ERROR_HANDLING
- **IMPORTS**: `@/lib/firebase/repositories/structures`、`@/lib/firebase/schemas/structure`、shadcn UI、`useAuthUser`
- **GOTCHA**:
  - `levels` 配列は順序が意味を持つ（level 1, 2, 3...）。挿入／削除時は `level` フィールドを再採番
  - level 配列が空のまま提出を弾く（`validation/structure-empty`）
  - **編集中のストラクチャを参照するトーナメントが既にある場合**でも、Phase 2 ではトーナメント作成時に snapshot コピーするので影響なし。`structures` 自体の編集は自由
- **VALIDATE**: 一覧→新規→編集→削除のラウンドトリップが Firestore に反映、ページ遷移後も保持

### Task 12: トーナメント CRUD UI（一覧／新規／ダッシュボード／編集）

- **ACTION**: `src/app/tournaments/{page.tsx,tournaments-client.tsx,new/{page.tsx,tournament-new-client.tsx},[tid]/{page.tsx,dashboard-client.tsx,edit/{page.tsx,tournament-edit-client.tsx}}}` を作成。共通 `src/components/tournament/TournamentForm.tsx`
- **IMPLEMENT**:
  - 一覧: `listMyTournaments(uid)` → Card grid（state バッジ・levels 数・参加者数 placeholder）
  - 新規: 名前入力 ＋ ストラクチャ select（自分のプリセット一覧から選択 or 「未保存（フォームで直接入力）」）。提出時に **structure を snapshot として tournament.structureSnapshot にコピー**
  - ダッシュボード: 名前・state バッジ・QR/URL（Task 13 と統合）・参加者一覧（Task 13 と統合）・「編集」「削除」（state==="setup" のみ表示）
  - 編集: 名前変更／snapshot 差替（state==="setup" のみ）→ `updateTournament(tid, patch)`
  - 削除: `deleteTournamentIfSetup(tid, uid)`、Dialog で確認
- **MIRROR**: REPOSITORY_PATTERN, ZOD_FORM_PATTERN, ERROR_HANDLING
- **IMPORTS**: `@/lib/firebase/repositories/{tournaments,structures}`、shadcn UI、`useAuthUser`
- **GOTCHA**:
  - **structureSnapshot は読込時の structure を deep copy**。`structures` 側を後から編集してもこのトーナメントには影響しないことが Phase 2 の重要設計（決定事項として「Notes」に明記）
  - `[tid]/page.tsx` はサーバ component で `notFound()` を呼び（`getTournament` で exists チェック）、`dashboard-client.tsx` を子で render
  - 削除確認 Dialog でキャンセルした場合の state 漏れに注意（Dialog open 状態の clean up）
- **VALIDATE**: 新規作成 → 一覧反映 → ダッシュボード遷移 → 編集 → 削除 のラウンドトリップ

### Task 13: 受付 URL／QR 表示（QrPanel）と参加者リスト

- **ACTION**: `src/components/qr/QrPanel.tsx` ＋ `src/components/tournament/PlayerList.tsx` を作成し、ダッシュボード（Task 12）に組み込む
- **IMPLEMENT**:
  - `QrPanel`: `tid` を受け取り、`buildJoinUrl(tid)`（`src/lib/services/qr.ts`）で生成した URL を表示。`<QRCodeSVG value={url} size={256} />`、URL 文字列 ＋「コピー」ボタン（`navigator.clipboard.writeText`）
  - `PlayerList`: `listPlayers(tid)` を `useEffect` で呼んで表示（`onSnapshot` は Phase 3 で導入。Phase 2 は手動 reload ボタン）
  - `qr.ts`: `export function buildJoinUrl(tid: string): string { return new URL(\`/join/${tid}\`, window.location.origin).toString(); }`
- **MIRROR**: REPOSITORY_PATTERN（PlayerList の `listPlayers`）、ERROR_HANDLING
- **IMPORTS**: `qrcode.react` の `QRCodeSVG`、shadcn `Card` `Button`、`@/lib/firebase/repositories/players`
- **GOTCHA**:
  - `window` は SSR で存在しない。`buildJoinUrl` は client-only から呼ぶ（Dashboard は client component）
  - `navigator.clipboard` は HTTPS or localhost でのみ動く（Vercel preview/production は HTTPS なので OK）
- **VALIDATE**: ダッシュボードで QR が表示・URL コピーが動く・参加者一覧が「リロード」で更新される

### Task 14: 受付ページ `/join/[tid]`（3 択フロー）

- **ACTION**: `src/app/join/[tid]/{page.tsx,join-client.tsx}` を作成
- **IMPLEMENT**:
  - `page.tsx`: サーバ side で `getTournament(tid)` → 無ければ `notFound()`、あれば tournament 名と state を渡して `<JoinClient tournament={t} />`
  - `join-client.tsx`: 3 択 UI（タブ or 縦並び Card）。
    - (a) ログイン: email + password → `joinAsExistingUser({ tid, email, password })`
    - (b) ゲスト: displayName → `joinAsGuest({ tid, displayName })`
    - (c) アカウント登録: email → `joinViaEmailLinkRequest({ tid, email })` → 「メールを送信しました」表示
  - 完了時は `/join/[tid]/done?as={existing|guest|email-link}` 風のサブルートか、同ページ内に「参加完了」表示。シンプルさ優先で同ページ内表示で良い
- **MIRROR**: ZOD_FORM_PATTERN, SERVICE_PATTERN, ERROR_HANDLING
- **IMPORTS**: `@/lib/services/receipt`、shadcn UI
- **GOTCHA**:
  - 既にこのトーナメントに参加済（同 uid の players ドキュメントあり）の場合は受付ボタン押下時にエラーではなく「既に参加済みです」を表示（`receipt.ts` 内で `getPlayer(tid, uid)` チェック）
  - state==="finished" は受付不可。state==="running" 以降のレイトエントリー判定は Phase 4 で精緻化（Phase 2 では「running 以降は受付可（締切判定は Phase 4）」とする）
- **VALIDATE**: 別端末／シークレットウインドウから 3 ルートそれぞれで受付完了し、Firestore `tournaments/{tid}/players/{uid}` にドキュメントが作成される

### Task 15: Email Link コールバックページ `/auth/email-link`

- **ACTION**: `src/app/auth/email-link/{page.tsx,email-link-client.tsx}` を作成
- **IMPLEMENT**:
  - `page.tsx` は client wrapper のみ（クエリ／URL 全文を取り扱う）
  - `email-link-client.tsx`: マウント時 `isSignInWithEmailLink(firebaseAuth, window.location.href)` をチェック。
    - false → エラー表示（`auth/email-link-invalid`）
    - true & `localStorage.emailForSignIn` あり → `joinViaEmailLinkComplete({ tid: searchParams.get("redirect") から抽出, currentUrl, fallbackEmail: undefined })` → 完了
    - true & email 無し → 入力フォーム表示 → 入力後同関数呼び
  - 完了後は `redirect` クエリ先（`/join/{tid}` または `/tournaments`）に `router.replace`
- **MIRROR**: ERROR_HANDLING, SERVICE_PATTERN
- **IMPORTS**: `firebase/auth`、`@/lib/services/{auth-actions,receipt}`
- **GOTCHA**:
  - `redirect` クエリの値は信頼できない（URL を改ざんされうる）。**`/` で始まる相対パスのみ許可**してオープンリダイレクトを防ぐ（`if (!redirect.startsWith("/")) redirect = "/tournaments"`）
  - `localStorage.removeItem("emailForSignIn")` を完了時に呼ぶ
- **VALIDATE**: ローカルでメールリンク受信 → 別タブで開いて完了 → `/join/[tid]` で参加完了表示まで通る

### Task 16: トップページ更新

- **ACTION**: `src/app/page.tsx` を更新し、ログイン状態に応じた導線（未ログインなら `/login`、ログイン済なら `/tournaments`）を追加
- **IMPLEMENT**: シンプルな見出し ＋ Button × 2。`useAuthUser` で表示分岐するなら client 化、しないならサーバ component で両リンク表示
- **MIRROR**: NAMING_CONVENTION, AUTH_PROVIDER_PATTERN
- **IMPORTS**: shadcn `Button`、`next/link`
- **GOTCHA**: トップを client 化するならルートで「読込中…」が常に出てしまう。SSR でリンク両方出す方が UX スムーズ
- **VALIDATE**: 「トーナメント一覧へ」「ログイン」リンクから遷移できる

### Task 17: README とドメイン手順の追記

- **ACTION**: `README.md` に Phase 2 機能と Auth 設定の追加事項を追記
- **IMPLEMENT**:
  - 「ローカル `.env.local` に `NEXT_PUBLIC_ENABLE_DEBUG=1` 任意」（既存に追記）
  - 「メールリンク認証の使用には Firebase Console で `localhost`／本番ドメインを承認済みドメインに登録」（既出だが email link コールバック URL 視点で再強調）
  - 受付 URL の形式と QR コピー手順（運営者向け）
  - **`firebase deploy --only firestore:rules` を Phase 2 ルール変更後に実行する**ことの注意
- **MIRROR**: —
- **IMPORTS**: —
- **GOTCHA**: 既存の README 構造（番号付き手順）を壊さない
- **VALIDATE**: 新規開発者が README に沿って 1 通り操作できる

### Task 18: 既存 `converter<T>()` の参照箇所を `zodConverter` に置換 → 旧 API 削除

- **ACTION**: `src/lib/firebase/converters.ts` の `converter<T>()` を削除し、参照箇所（`src/app/debug/fs/debug-fs-client.tsx`）を `zodConverter` ベースに置換
- **IMPLEMENT**:
  - `debug-fs-client.tsx` の `DebugDoc` をその場限りの `z.object({...})` schema に置き換え、`zodConverter(debugDocSchema, "tournaments")` を使う
  - `converter<T>()` を `converters.ts` から削除
  - `converters.test.ts` から旧 API 由来テストを削除（あれば）
- **MIRROR**: FIRESTORE_CONVERTER_PATTERN
- **IMPORTS**: `zod`, `@/lib/firebase/converters`
- **GOTCHA**: `debug-fs-client.tsx` は `state: "setup"` 等の最小フィールドしか持たない debug 書込なので、`tournaments` 全 schema ではなく専用 minimal schema を当てる方がよい（schema 不一致で読取エラーが起きる）。**もしくは `/debug/fs` を Phase 2 完了タイミングで削除**（PRD では Phase 5 で削除予定だが、Phase 2 で converter リプレースを機に削除しても良い → ユーザー確認）
- **VALIDATE**: typecheck・lint・test・build すべて pass、`grep "converter<" src/` で hit ゼロ

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| `structureSchema` 正常系 | 完全な structure object | parse 成功 | — |
| `structureSchema` levels 空 | `levels: []` | parse 失敗（min(1) 違反） | Y |
| `structureSchema` sb 負数 | `sb: -1` | parse 失敗 | Y |
| `tournamentSchema` `state` 不正 | `state: "unknown"` | parse 失敗 | Y |
| `playerSchema` `uid` null | `uid: null` | parse 成功（ゲスト） | — |
| `zodConverter.fromFirestore` 不正 doc | `{ name: 123 }` を返す snap | `AppError("firestore/invalid-data")` throw | Y |
| `zodConverter.fromFirestore` 正常 | 正規 doc | 型付きオブジェクト返却 | — |
| `joinAsGuest` displayName 空 | `displayName: " "` | `AppError("validation/display-name-required")` | Y |
| `joinAsGuest` state finished | tournament.state === "finished" | `AppError("tournament/late-entry-closed")` | Y |
| `joinAsGuest` 正常 | name "Alice" | players 作成（mock 経由） | — |
| `auth-actions.completeEmailLink` invalid URL | `https://x.com/?` | `AppError("auth/email-link-invalid")` | Y |
| `qr.buildJoinUrl` | `tid: "abc"` | `https://.../join/abc` 完全 URL | — |

**テストファイル配置**: 対象と同階層 `*.test.ts`（[errors.test.ts](src/lib/errors.test.ts) と同様）

### Edge Cases Checklist

- [ ] 同一 uid で同じトーナメントに 2 回受付 → 2 件目はエラーではなく「既に参加済み」表示
- [ ] ゲスト参加で displayName が空文字／空白のみ → `validation/display-name-required`
- [ ] state==="finished" のトーナメントへの受付 → `tournament/late-entry-closed`
- [ ] 存在しない tid で `/join/[tid]` 開く → `notFound()` で 404
- [ ] 存在しない tid で `/tournaments/[tid]` 開く → `notFound()` で 404
- [ ] state!=="setup" のトーナメント編集 → 編集ページがエラー表示／削除ボタン非表示
- [ ] 別ユーザーのトーナメント `/tournaments/[他人の tid]` 開く → ルールで read 可だが、編集／削除 UI は ownerUid 不一致なら非表示
- [ ] Email Link を別端末で開く → localStorage 無し → email 再入力フォーム
- [ ] Email Link 完了後の `redirect` クエリが `http://malicious.com` → `/tournaments` にフォールバック（オープンリダイレクト防止）
- [ ] 未認証で `/tournaments` → `/login?redirect=/tournaments` にリダイレクト
- [ ] zod schema 違反の Firestore ドキュメント遭遇 → UI でエラー表示、画面が真っ白にならない（global error boundary 検討）
- [ ] Firebase env 欠落でローカル起動 → ブラウザで `firebase/config-missing` の AppError（Phase 1 既存挙動）

---

## Validation Commands

### Static Analysis
```bash
npm run typecheck
```
EXPECT: 型エラー 0

```bash
npm run lint
```
EXPECT: warnings/errors 0

### Unit Tests
```bash
npm test
```
EXPECT: 既存 5 + Phase 2 で追加（schema/converter/service の最低 12 件以上）が全 pass

### Build
```bash
npm run build
```
EXPECT: Next.js のビルドが警告ゼロで完了。新規動的ルート `/tournaments/[tid]`、`/structures/[sid]/edit`、`/join/[tid]` が dynamic として認識

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
1. `/login` で新規メール+PW 登録 → `/tournaments` 自動遷移
2. `/structures/new` でストラクチャ作成 → 一覧反映
3. `/tournaments/new` でストラクチャ選択しトーナメント作成 → ダッシュボード遷移
4. ダッシュボードで QR 表示・URL コピー
5. シークレットウィンドウで `/join/[tid]` を開き、3 ルート（ログイン／ゲスト／メールリンク）それぞれで受付完了
6. Firebase Console の Firestore で `tournaments/{tid}/players/{uid}` ドキュメントが作成されている

### Manual Validation
- [ ] Firebase Console → Authentication で「匿名」「メール / パスワード」「メールリンク」3 方式すべて有効
- [ ] Firebase Console → 承認済みドメインに `localhost`（と Vercel preview/production）登録
- [ ] `firebase deploy --only firestore:rules` 後に Console の Rules ビューで Phase 2 ルールが反映
- [ ] 受付 URL を物理デバイス（スマホ）で QR 経由スキャン → 受付完了
- [ ] 同 uid 再来訪 → 重複参加にならない
- [ ] 別ユーザーで他人のトーナメントを開いて編集／削除ボタンが非表示

---

## Acceptance Criteria

- [ ] `/login` でメール+PW のログイン／新規登録が動作
- [ ] `/structures` で自分のストラクチャプリセットを作成／編集／削除できる
- [ ] `/tournaments` で自分のトーナメントを作成／編集（setup 限）／削除（setup 限）できる
- [ ] トーナメント作成時に選択したストラクチャが `tournament.structureSnapshot` に deep copy される
- [ ] `/tournaments/[tid]` で受付 URL ／ QR ／参加者リストが表示される
- [ ] `/join/[tid]` で 3 ルート（ログイン／ゲスト／アカウント登録 via Email Link）すべて受付完了できる
- [ ] 同 uid による重複参加が冪等（2 回目はエラーにならず既参加表示）
- [ ] 受付完了で `tournaments/{tid}/players/{uid}` ドキュメントが作成され、Firestore Console で確認できる
- [ ] Firestore Security Rules が Phase 2 仕様で deploy 済み
- [ ] Firestore からの読取がすべて `zodConverter` 経由で runtime validate されている（`grep "converter<" src/` で hit 0）
- [ ] `npm run typecheck` ／ `npm run lint` ／ `npm test` ／ `npm run build` が全 pass
- [ ] [.claude/rules/firebase-patterns.md](.claude/rules/firebase-patterns.md) の `TODO(phase-2)` が converters.ts から消えている

## Completion Checklist

- [ ] ファイル命名・配置が NAMING_CONVENTION に準拠（kebab-case ディレクトリ／PascalCase コンポーネント／`use*` フック／`*-client.tsx` 分離）
- [ ] すべての Firebase 初期化が `@/lib/firebase/client` 経由（直接 `initializeApp` 呼びゼロ）
- [ ] 認証状態は `useAuthUser` 経由のみ（`onAuthStateChanged` 直接購読ゼロ）
- [ ] Firestore アクセスは Repositories 層に集約され、UI は `collection()`/`doc()`/`addDoc()` を直接呼ばない
- [ ] エラーは `AppError` でラップ（`throw new Error` 直書きゼロ）。ドメインコードは `firestore/*` `auth/*` `tournament/*` `validation/*` のいずれか
- [ ] ログは `logger` 経由（`console.*` 直呼びゼロ。Lint で検出されないなら手で grep 確認）
- [ ] Firestore Security Rules が deny-by-default を維持しつつ players self-create を許可
- [ ] zod schema が `src/types/tournament.ts` の interface と shape 一致（または schema を真実源化）
- [ ] `_debug` 系ルート（`/debug/fs`）の扱いを Phase 5 削除のままにするか、Phase 2 で削除するか決定して TODO に記録
- [ ] README が Phase 2 操作手順を含む（運営者向け＋参加者向け）
- [ ] `.env.local` がリポジトリに残っていない（`git status` 確認）

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| zod schema と TS interface の二重管理で drift が発生 | M | M | schema を真実源とし、`tournament.ts` の interface は `z.infer` の再 export に置換。または schema 同階層に型もまとめる。Phase 2 終了時に方針確定 |
| Email Link コールバックの承認済みドメイン未登録で詰まる | H | M | README で `localhost` ／本番／プレビュー の 3 種登録を強調。`auth-actions.sendEmailLinkForJoin` 内で `actionCodeSettings.url` を console.info でログし、デバッグ容易に |
| Email Link を別端末で開いた場合の email 再入力 UX が不安定 | M | L | `email-link-client.tsx` で email 再入力フォームを丁寧に出す。失敗時は `auth/email-missing-on-callback` で UI に明示 |
| Security Rules の self-create で「他人のトーナメントの players に書込」できてしまう | L | H | rule で `pid == request.auth.uid` を必須化。テスト：他人の `tid` で書込 → permission-denied になることを Emulator で手動確認 |
| ストラクチャ snapshot 設計で「snapshot 更新タイミング」が曖昧化 | M | M | **設計決定として「トーナメント作成時のみ deep copy、以降は不変」**を Plan の Notes に明記。トーナメント開始後の構造変更は Phase 3 で別 UI（手動レベル変更）で対応 |
| Firestore リード回数が想定外に増える（ダッシュボード手動 reload） | L | L | Phase 2 では問題なし（手動操作・小規模）。Phase 3 で `onSnapshot` 化されると差分のみ reads になる |
| `/debug/fs` の旧 `converter<T>()` 削除で Phase 1 検証ルートが壊れる | M | L | Task 18 で `/debug/fs` 自体を最小 schema 化するか削除。Phase 1 報告では Phase 5 削除予定なので、削除でも整合 |
| Vercel preview URL の毎回変動で Email Link が失敗 | M | M | README で `*.vercel.app` 一括許可 or プレビュー URL 都度追加を案内。Phase 2 動作確認は本番デプロイ前にローカル＋ Vercel 1 環境で実施 |
| Phase 2 と Phase 3 の並列開発で Firestore schema の競合 | M | M | Phase 2 は schemas/ ディレクトリで真実源を確立。Phase 3 担当者は schema 追加時に既存ファイルを Read してから作業（CLAUDE.md のルール参照義務に従う） |

## Notes

- **設計決定: ストラクチャ snapshot は不変** — `tournaments/{tid}` 作成時に `structureSnapshot` として deep copy し、以降は変更しない（PRD Solution Detail と整合）。トーナメント開始後の構造変更は Phase 3 で「手動レベル変更」UI として別途実装する。これにより `structures/{sid}` 側の編集が既存トーナメントへ意図せず波及することを防ぐ
- **設計決定: 受付 player ドキュメント ID = auth.uid** — 同 uid による重複参加を冪等化するため、`addDoc(playersRef, ...)` ではなく `setDoc(doc(playersRef, uid), ..., { merge: true })` を使う。Security Rules の `pid == request.auth.uid` 制約とも整合
- **設計決定: zod schema を Firestore データモデルの真実源に** — Phase 1 の `src/types/tournament.ts` の interface は Phase 2 終了時に `z.infer` ベースに統一する方向。手作業の二重管理は drift の温床なので避ける
- **未確定: `/debug/fs` の Phase 2 削除可否** — PRD では Phase 5 削除予定。Task 18 で `converter<T>()` 削除に合わせて `/debug/fs` も削除する案を提示するが、最終判断はユーザー確認後（auto モードでは「最小 schema を当てて残す」を採用）
- **Firebase Cloud Functions は Phase 2 でも未導入** — タイマードリフト補正（Phase 3）／バランシング（Phase 4）まで延期。Phase 2 で必要なロジックは全て client/Firestore Rules で完結
- **`react-hook-form` 不採用** — controlled state + `zod.safeParse` で十分。フォームが大規模化したら Phase 5 で再評価
- **CI（GitHub Actions）も未導入** — Vercel Preview のビルドを「PR ごとの validate」として代替。テストを CI で走らせる必要が出たら Phase 5 で追加
- **Phase 3 への申し送り** — `PlayerList` は Phase 2 で `getDocs` の手動 reload。Phase 3 で `onSnapshot` 化する。Firestore リスナーの unsubscribe 規律は Phase 3 計画で確立
- **Phase 4 への申し送り** — レイトエントリー締切レベル（`lateEntryDeadlineLevel`）の判定ロジックは Phase 4。Phase 2 では「state==="finished" のみ拒否」までで十分
