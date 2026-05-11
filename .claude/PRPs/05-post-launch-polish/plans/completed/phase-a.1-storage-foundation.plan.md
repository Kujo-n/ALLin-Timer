# Plan: Track A Phase A.1 — Storage Foundation（結果カード背景画像の基盤）

## Summary

Firebase Storage を本プロジェクトに新規導入し、`groups/{gid}.winnerCardBackground` /
`groups/{gid}.seasonCardBackground` の 2 フィールドを additive に追加することで、
Phase A.2 以降の「サークル詳細画面で背景画像アップロード + OG SSR で背景反映」が
動く土台を構築する。本 phase では UI 変更 / OG route 拡張は行わず、**Storage SDK
singleton + emulator 統合 + zod schema 追加 + repository / service / Firestore rules
ブランチ + emulator validator** までを 1 PR にまとめる。

## User Story

As a サークル代表（owner）,
I want 自分のサークルに「優勝者カード」「シーズン戦績カード」用の背景画像メタデータを
持たせ、後続 Phase で UI から読み書きできる状態にする,
So that Phase A.2 で UI からアップロードした画像が即座に Storage と Firestore に
反映され、Phase A.3 で OG カードに描画される改善ループへ進める。

## Problem → Solution

[現状]
- カード SSR は全サークル同一の amber/navy グラデーション固定で、ブランディング差分ゼロ
- `groups/{gid}` には背景画像 / テキストテーマを保持するフィールドが存在しない
- Firebase Storage SDK は本プロジェクトに未導入（`firebaseStorage` singleton も
  `storage.rules` も `firebase.json` の storage emulator port もない）

→

[望ましい状態]
- `firebase` パッケージ既存 v11.1.0 に同梱の `firebase/storage` SDK を `client.ts` で
  singleton 化し、emulator 接続も Firestore / Auth と同じ flag で透過的に切替できる
- `groups/{gid}` に `winnerCardBackground` / `seasonCardBackground` が nullable +
  default(null) で hydrate され、旧 doc は破壊的 migration なしで `null` 互換
- owner のみが新フィールドを書き換えできることが Firestore Rules で enforce され、
  emulator validator (`npm run test:rules-card-background`) で機械的に検証される
- Storage rule で `groups/{gid}/bgImages/{assetId}` のみ public read + owner-only
  write を enforce し、`npm run test:storage-rules` で検証される
- Blaze プラン移行手順を README に追記し、fork した運営者が本機能を有効化する
  ための導線がある

## Metadata

- **Complexity**: Medium（10 ファイル前後、200〜350 行。新規 SDK 導入 + rule 追加
  + emulator validator 2 本 + README 追記）
- **Source PRD**: `.claude/PRPs/05-post-launch-polish/prds/05-post-launch-polish.prd.md`
- **PRD Phase**: A.1（Track A: Storage Foundation）
- **Estimated Files**:
  - 修正: 8 件（`src/lib/firebase/client.ts` / `src/lib/firebase/schemas/group.ts` /
    `src/lib/firebase/repositories/groups.ts` / `src/lib/services/group.ts` /
    `firebase.json` / `firestore.rules` / `package.json` / `README.md`）
  - 新規: 3 件（`storage.rules` / `scripts/test-rules-card-background.mjs` /
    `scripts/test-storage-rules.mjs`）

---

## UX Design

### Before

N/A — 本 phase は backend / 基盤のみで UI 変更なし。

### After

N/A — owner が `/groups/[gid]` で確認できる変更は無い（Phase A.2 で UI が追加される）。

### Interaction Changes

内部変更のみ。UI 触点なし。

---

## Mandatory Reading

実装前に必ず読むファイル:

| Priority       | File                                                                                  | Lines     | Why                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0 (critical)  | [src/lib/firebase/client.ts](../../../../src/lib/firebase/client.ts)                  | 1-113     | Auth / Firestore singleton + emulator connect の現行構造。`firebaseStorage` を 同じ guard pattern で追加する                                     |
| P0 (critical)  | [src/lib/firebase/schemas/group.ts](../../../../src/lib/firebase/schemas/group.ts)    | 1-249     | `seasonPointsRule`（nullable + default(null)）の先例。`audioSettings` の `.default()` 先例も含む。`assertOwner` ヘルパーの location              |
| P0 (critical)  | [firestore.rules](../../../../firestore.rules)                                        | 195-275   | `groups/{gid}` `allow update` の `affectedKeys.hasOnly` ブランチパターン。`seasonPointsRule` ブランチ（247-274 行）が本 phase の最近接の雛形     |
| P0 (critical)  | [src/lib/firebase/repositories/groups.ts](../../../../src/lib/firebase/repositories/groups.ts) | 386-449   | `updateSeasonPointsRule` の wrap pattern。本 phase が追加する 2 repository 関数の直前の先例                                                      |
| P0 (critical)  | [src/lib/services/group.ts](../../../../src/lib/services/group.ts)                    | 460-512   | `setSeasonPointsRule` の owner / organizer 役割確認 + repository 呼出パターン。`assertOwner` を使う想定                                          |
| P1 (important) | [scripts/test-rules-default-seats.mjs](../../../../scripts/test-rules-default-seats.mjs) | 1-275     | emulator validator の REST 直叩きパターン。本 phase の `test-rules-card-background.mjs` のテンプレ                                                |
| P1 (important) | [scripts/test-rules-table-labels.mjs](../../../../scripts/test-rules-table-labels.mjs) | 1-417     | より複雑な multi-collection validator の先例（groups + tables 親 doc seed）                                                                       |
| P1 (important) | [src/lib/firebase/wrap.ts](../../../../src/lib/firebase/wrap.ts)                      | 1-68      | `wrapFirestoreWrite` / `wrapFirestoreRead` の使い方。Phase 4 architect-refactor 以降の推奨形                                                     |
| P1 (important) | [src/lib/errors.ts](../../../../src/lib/errors.ts)                                    | 1-93      | `AppError` / `AppError.from` / `assertNonEmptyString`                                                                                            |
| P1 (important) | [firebase.json](../../../../firebase.json)                                            | 1-19      | 既存 emulators 設定。storage port を追加する位置                                                                                                  |
| P2 (reference) | [.claude/rules/firebase-patterns.md](../../../../.claude/rules/firebase-patterns.md)  | all       | 「数値リミット定数の単一真実源」「`groups/{gid}` の allowed-keys 一覧」「subcollection rule 設計原則」「repository の error wrap」                |
| P2 (reference) | [.claude/rules/group-membership.md](../../../../.claude/rules/group-membership.md)    | all       | 3 階層ロール / 権限マトリクス。本 phase で「owner only」を選んだ根拠                                                                              |
| P2 (reference) | [.claude/rules/security-base.md](../../../../.claude/rules/security-base.md)          | all       | 公開リポジトリ運用 / 秘密情報の扱い。Storage バケット ID は `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` で公開可能                                       |

## External Documentation

| Topic                                                        | Source                                                                                                                                                                  | Key Takeaway                                                                                                                                                                                                            |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Firebase Storage Web SDK init                                | <https://firebase.google.com/docs/storage/web/start>                                                                                                                    | `getStorage(app, bucket?)` で取得。バケット未指定なら `firebaseConfig.storageBucket` が使われる                                                                                                                          |
| Storage emulator                                             | <https://firebase.google.com/docs/emulator-suite/connect_storage>                                                                                                       | `connectStorageEmulator(storage, host, port)`。デフォルト port 9199                                                                                                                                                     |
| Storage rules: cross-service Firestore                       | <https://firebase.google.com/docs/storage/security/rules-conditions#access_other_documents>                                                                              | `firestore.get(/databases/(default)/documents/groups/$(gid))` で Firestore doc を rule 内で読める（GA）。1 read を消費                                                                                                  |
| Blaze プラン要件                                             | <https://firebase.google.com/pricing>                                                                                                                                   | Storage を使うには Blaze (pay-as-you-go) プランへ移行が必要。20 人 × 月 1〜2 回 規模では実質無料枠 (5GB storage / 1GB egress per day) 内に収まる                                                                       |

---

## Patterns to Mirror

実装パターンはすべて既存コードから抽出。新規 invention 禁止。

### SINGLETON_GUARD

```ts
// SOURCE: src/lib/firebase/client.ts:101-113
if (useEmulator) {
  type EmulatorFlag = { __FIREBASE_EMULATORS_CONNECTED__?: boolean };
  const g = globalThis as typeof globalThis & EmulatorFlag;
  if (!g.__FIREBASE_EMULATORS_CONNECTED__) {
    connectAuthEmulator(firebaseAuth, AUTH_EMULATOR_URL, { disableWarnings: true });
    connectFirestoreEmulator(firestore, FIRESTORE_EMULATOR_HOST, FIRESTORE_EMULATOR_PORT);
    g.__FIREBASE_EMULATORS_CONNECTED__ = true;
    logger.info("firebase emulators connected", {...});
  }
}
```

Phase A.1 では同じ flag 配下に `connectStorageEmulator(firebaseStorage, STORAGE_EMULATOR_HOST, STORAGE_EMULATOR_PORT)` を追加する（同一 flag で守ることで HMR / 多重 import に強い）。

### ADDITIVE_NULLABLE_SCHEMA

```ts
// SOURCE: src/lib/firebase/schemas/group.ts:68-82
export const seasonPointsRuleSchema = z
  .object({
    base: z.array(z.number().nonnegative()).min(1).max(SEASON_POINTS_BASE_MAX_LENGTH),
    baseline: z.number().int().min(MIN_SEATS_PER_TABLE).max(MAX_SEATS_PER_TABLE),
  })
  .nullable()
  .default(null);
```

新 `cardBackgroundSchema` も「object を nullable + default(null)」で旧 doc 互換を担保する。

### REPOSITORY_WRAP_PATTERN

```ts
// SOURCE: src/lib/firebase/repositories/groups.ts:400-448
export async function updateSeasonPointsRule(
  gid: string,
  value: SeasonPointsRule | null,
): Promise<void> {
  if (value !== null) {
    // pre-validation（schema と同じ条件を二重防御）
  }
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "シーズンポイント計算ルールの更新に失敗しました",
    async () => {
      await updateDoc(groupDocRef(gid), { seasonPointsRule: value });
    },
    { gid },
  );
  logger.info("group seasonPointsRule updated", { gid, reset: value === null });
}
```

### SERVICE_ROLE_GATE

```ts
// SOURCE: src/lib/services/group.ts:464-509
export async function setSeasonPointsRule({ gid, uid, value }: {...}): Promise<void> {
  // pre-validation
  const group = await getGroup(gid);
  assertOrganizer(group, uid);  // ← 本 phase は assertOwner に置換
  await updateSeasonPointsRule(gid, value);
  logger.info("setSeasonPointsRule ok", { gid, uid, reset: value === null });
}
```

Phase A.1 は **owner only** なので `assertOrganizer` ではなく `assertOwner` を使う。

### RULE_AFFECTEDKEYS_BRANCH

```rules
// SOURCE: firestore.rules:247-275 (seasonPointsRule ブランチ)
) || (
  isOrganizer(gid)
  && request.resource.data.diff(resource.data).affectedKeys()
       .hasOnly(['seasonPointsRule'])
  && (
    request.resource.data.seasonPointsRule == null
    || (
      request.resource.data.seasonPointsRule is map
      && request.resource.data.seasonPointsRule.base is list
      && ...
    )
  )
)
```

本 phase は **`isOwner(gid)`**（owner-only）+ `affectedKeys.hasOnly(['winnerCardBackground'])` /
`['seasonCardBackground']` の 2 ブランチを追加。

### EMULATOR_VALIDATOR_STRUCTURE

```js
// SOURCE: scripts/test-rules-default-seats.mjs:108-127
async function expectAllow(label, fn) {
  const r = await fn();
  if (r.ok) results.push({ label, status: "PASS (allow)" });
  else { ... }
}
async function expectDeny(label, fn) {
  const r = await fn();
  if (r.status === 403) results.push({ label, status: "PASS (deny 403)" });
  else { ... }
}
```

REST 直叩き + HTTP status code judge。Firebase Web SDK の楽観 resolve 問題を回避するため必須。

---

## Files to Change

| File                                                                                  | Action  | Justification                                                                                                                  |
| ------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [src/lib/firebase/client.ts](../../../../src/lib/firebase/client.ts)                  | UPDATE  | `firebaseStorage` singleton + emulator connect を追加                                                                          |
| [src/lib/firebase/schemas/group.ts](../../../../src/lib/firebase/schemas/group.ts)    | UPDATE  | `cardBackgroundSchema` 型 + `winnerCardBackground` / `seasonCardBackground` を `groupBodySchema` に additive 追加              |
| [src/lib/firebase/repositories/groups.ts](../../../../src/lib/firebase/repositories/groups.ts) | UPDATE  | `updateWinnerCardBackground` / `updateSeasonCardBackground` を `wrapFirestoreWrite` 経由で追加。`createGroup` の seed も更新   |
| [src/lib/services/group.ts](../../../../src/lib/services/group.ts)                    | UPDATE  | `setWinnerCardBackground` / `setSeasonCardBackground` を `assertOwner` 役割確認付きで追加                                       |
| [firebase.json](../../../../firebase.json)                                            | UPDATE  | `"storage": { "rules": "storage.rules" }` + `emulators.storage.port = 9199` を追加                                              |
| [firestore.rules](../../../../firestore.rules)                                        | UPDATE  | owner-only `winnerCardBackground` / `seasonCardBackground` ブランチを `groups/{gid}` `allow update` に additive 追加              |
| [storage.rules](../../../../storage.rules)                                            | CREATE  | deny-by-default + `groups/{gid}/bgImages/{assetId}` 公開 read + owner-only write（`firestore.get` 経由）                       |
| [scripts/test-rules-card-background.mjs](../../../../scripts/test-rules-card-background.mjs) | CREATE  | `groups/{gid}` の card background ブランチを REST 直叩きで emulator 検証                                                         |
| [scripts/test-storage-rules.mjs](../../../../scripts/test-storage-rules.mjs)          | CREATE  | Storage rules を Storage emulator REST で検証                                                                                  |
| [package.json](../../../../package.json)                                              | UPDATE  | `test:rules-card-background` / `test:storage-rules` の 2 script を追加。`emulator` script に `,storage` も追加                  |
| [README.md](../../../../README.md)                                                    | UPDATE  | Blaze プラン移行 + Storage bucket setup の手順を「2. Firebase プロジェクトの作成」「Validation Commands」に追記                  |
| [playwright.config.ts](../../../../playwright.config.ts)                              | KEEP    | Phase A.1 は UI 変更なしのため emulator 設定への storage 追加は不要（Phase A.2 で追加検討）。本 phase では touch しない         |

## NOT Building

本 phase で **絶対に作らない** もの（Phase A.2 以降に持ち越し）:

- **UI**: サークル詳細画面の `WinnerCardBackgroundCard` / `SeasonCardBackgroundCard` コンポーネントは追加しない
- **クライアント画像処理**: `src/lib/utils/image-resize.ts`（canvas API resize）は本 phase で作らない
- **OG route 拡張**: `WINNER_CARD_QUERY_SCHEMA` / `SEASON_CARD_QUERY_SCHEMA` に
  `bgImageUrl` / `bgTextTheme` を追加しない。`buildWinnerShareInputs` / `buildSeasonShareInputs`
  にも触れない
- **アクセスログ / 画像数 metrics**: 設定サークル数の集計は手動コンソール確認で十分
- **複数画像ストック / 画像クロップ UI**: PRD「NOT Building」と同じ
- **organizer / member への設定権限拡張**: owner only に限定

---

## Step-by-Step Tasks

### Task 1: `firebaseStorage` singleton + emulator connect を追加

- **ACTION**: `src/lib/firebase/client.ts` に Storage SDK 初期化と emulator 接続を追加
- **IMPLEMENT**:
  - import に `import { connectStorageEmulator, getStorage } from "firebase/storage";` を追加
  - `STORAGE_EMULATOR_HOST = "127.0.0.1"` / `STORAGE_EMULATOR_PORT = 9199` を定数追加
  - `export const firebaseStorage = getStorage(firebaseApp);` を `firestore` 宣言の直後に
  - emulator flag guard 内で `connectStorageEmulator(firebaseStorage, STORAGE_EMULATOR_HOST, STORAGE_EMULATOR_PORT)` を呼ぶ
  - `logger.info("firebase emulators connected", ...)` の object に `storage` キーを追加
- **MIRROR**: SINGLETON_GUARD パターン（既存 Auth / Firestore の flag 共有）
- **IMPORTS**: `firebase/storage`（同梱、新規 npm 不要）
- **GOTCHA**: `getStorage(firebaseApp)` は build / SSR 時点でも評価される。Firestore singleton と同様に **`storageBucket: storageBucket || \`${PLACEHOLDER}.appspot.com\``** で SSR ガードが効くため追加コードは不要。emulator port 9199 は Firebase Storage Emulator の default
- **VALIDATE**: `npm run typecheck` が clean。`npm run build` で SSR 評価エラーが出ない

### Task 2: `cardBackgroundSchema` を schemas/group.ts に追加

- **ACTION**: `groupBodySchema` 内に 2 つの additive nullable フィールドを追加
- **IMPLEMENT**:
  ```ts
  // schemas/group.ts に追加（seasonPointsRuleSchema の直前 or 直後）
  export const CARD_TEXT_THEMES = ["light", "dark"] as const;
  export type CardTextTheme = (typeof CARD_TEXT_THEMES)[number];

  export const cardBackgroundSchema = z
    .object({
      imageUrl: z.string().min(1).nullable(),
      storageAssetId: z.string().min(1).nullable(),
      textTheme: z.enum(CARD_TEXT_THEMES),
    })
    .nullable()
    .default(null);
  export type CardBackground = z.infer<typeof cardBackgroundSchema>;

  export const DEFAULT_CARD_BACKGROUND_TEXT_THEME: CardTextTheme = "light";
  ```
  `groupBodySchema` の `.object({...})` 内に 2 フィールド追加:
  ```ts
  // Phase A.1 (05-post-launch-polish Track A): 優勝者カード / シーズン戦績カード の
  //   背景画像 + テキストテーマ。owner のみが書換可（rule で enforce）。
  //   旧 doc（Phase E 以前）はフィールド不在のため default(null) で hydrate される。
  //   非 null 時の構造: { imageUrl: string | null, storageAssetId: string | null,
  //     textTheme: "light" | "dark" }
  //   imageUrl / storageAssetId を nullable に保つのは「テキストテーマだけ先に決めて
  //   後で画像を載せる」UX を阻害しないためだが、運用上 imageUrl == null かつ
  //   storageAssetId != null は service 層 invariant で禁じる。
  winnerCardBackground: cardBackgroundSchema,
  seasonCardBackground: cardBackgroundSchema,
  ```
- **MIRROR**: ADDITIVE_NULLABLE_SCHEMA（`seasonPointsRuleSchema` の `.nullable().default(null)` パターン）
- **IMPORTS**: 既存の `zod` のみ。追加 import 不要
- **GOTCHA**: `z.enum(["light", "dark"])` のリテラル配列を `as const` で抜き出して export しておくと、後段の UI で `<select>` option を回せる。enum を使うのは「`textTheme` の値が将来 `auto` 等に拡張される可能性」に備える設計（PRD「Could」に `auto` モード言及あり）
- **VALIDATE**: `npm run typecheck` clean。schema unit を `vitest` でこれまで通り暗黙的に通すだけで OK（schema 用 explicit test は本 phase では追加しない — `zodConverter` で旧 doc が `null` で hydrate されることは Phase A.2 の repository test で担保）

### Task 3: repository に `updateWinnerCardBackground` / `updateSeasonCardBackground` を追加

- **ACTION**: `src/lib/firebase/repositories/groups.ts` に 2 つの write 関数を追加
- **IMPLEMENT**:
  ```ts
  // import に CardBackground 型を追加
  import {
    ...,
    cardBackgroundSchema,
    type CardBackground,
    ...,
  } from "@/lib/firebase/schemas/group";

  /**
   * Phase A.1 (05-post-launch-polish): groups/{gid}.winnerCardBackground を更新する。
   *   - owner-only（service 層で assertOwner、rule 側も isOwner enforce）
   *   - null 渡しで「背景解除」、object 渡しで設定。
   *   - imageUrl / storageAssetId は同時に null か同時に string であることを invariant とする
   *     (Storage asset と Firestore pointer の同期保護)。
   *   - rule は `affectedKeys.hasOnly(['winnerCardBackground'])` + 型のみを enforce。
   *     値域は本関数の zod safeParse + invariant check が最終ライン。
   */
  export async function updateWinnerCardBackground(
    gid: string,
    value: CardBackground,
  ): Promise<void> {
    validateCardBackground(value);  // ← invariant check helper（file-local）
    await wrapFirestoreWrite(
      "firestore/write_failed",
      "結果カード背景画像の更新に失敗しました",
      async () => {
        await updateDoc(groupDocRef(gid), { winnerCardBackground: value });
      },
      { gid },
    );
    logger.info("group winnerCardBackground updated", {
      gid,
      cleared: value === null,
      hasImage: value?.imageUrl != null,
      textTheme: value?.textTheme,
    });
  }

  // updateSeasonCardBackground も同じ構造。フィールド名のみ差し替え
  ```
  `validateCardBackground` の本体:
  ```ts
  function validateCardBackground(value: CardBackground): void {
    if (value === null) return;
    const parsed = cardBackgroundSchema.safeParse(value);
    if (!parsed.success) {
      throw new AppError(
        "結果カード背景画像の値が不正です",
        "validation/card-background-invalid",
      );
    }
    // imageUrl と storageAssetId は同時 null / 同時 string でなければならない
    const bothNull = value.imageUrl === null && value.storageAssetId === null;
    const bothSet = value.imageUrl !== null && value.storageAssetId !== null;
    if (!bothNull && !bothSet) {
      throw new AppError(
        "imageUrl と storageAssetId は同時に設定または解除してください",
        "validation/card-background-invalid",
      );
    }
  }
  ```
  `createGroup` の addDoc payload に新 2 フィールドを追加（default(null) でも明示する方が
  下流の hydrate コストが下がるため）:
  ```ts
  // createGroup 内
  winnerCardBackground: null,
  seasonCardBackground: null,
  ```
- **MIRROR**: REPOSITORY_WRAP_PATTERN（`updateSeasonPointsRule` 完全踏襲）
- **IMPORTS**: 既存 + `cardBackgroundSchema`, `CardBackground`
- **GOTCHA**: `validateCardBackground` の invariant は **Cloud Firestore Rules では表現できない**（imageUrl と storageAssetId の同時設定/解除）。schema / application 層が最終ライン。imageUrl は public URL（Storage download URL）想定で、Storage rule で write の content-type / size を別途 enforce する
- **VALIDATE**: `npm run typecheck` clean。`grep -n "winnerCardBackground\|seasonCardBackground" src/lib/firebase/repositories/groups.ts` で 2 関数 + createGroup seed の 3 箇所追加が見える

### Task 4: service 層に `setWinnerCardBackground` / `setSeasonCardBackground` を追加

- **ACTION**: `src/lib/services/group.ts` に 2 つの service 関数を追加（owner-only ゲート付き）
- **IMPLEMENT**:
  ```ts
  // import 追加
  import {
    ...,
    updateWinnerCardBackground,
    updateSeasonCardBackground,
    ...,
  } from "@/lib/firebase/repositories/groups";
  import {
    assertOwner,
    type CardBackground,
    ...,
  } from "@/lib/firebase/schemas/group";

  /**
   * Phase A.1 (05-post-launch-polish Track A):
   * 優勝者カード背景画像メタデータを設定・解除する。owner-only。
   * - value=null で解除（imageUrl / storageAssetId / textTheme をフィールドごと null 化）
   * - value=object で設定。imageUrl と storageAssetId は同時に string が必須
   * - 実際の Storage upload / 旧 asset delete は Phase A.2 の UI 側で行い、
   *   本 service は Firestore pointer 更新のみ責務とする
   */
  export async function setWinnerCardBackground({
    gid,
    uid,
    value,
  }: {
    gid: string;
    uid: string;
    value: CardBackground;
  }): Promise<void> {
    const group = await getGroup(gid);
    assertOwner(group, uid);
    await updateWinnerCardBackground(gid, value);
    logger.info("setWinnerCardBackground ok", {
      gid,
      uid,
      cleared: value === null,
    });
  }
  // setSeasonCardBackground も同構造
  ```
- **MIRROR**: SERVICE_ROLE_GATE（`setSeasonPointsRule` 踏襲）+ `assertOwner` 切替
- **IMPORTS**: 上記
- **GOTCHA**: PRD の権限マトリクスでは **owner only**（organizer 以下は不可）。`assertOrganizer` ではなく `assertOwner` を使うこと
- **VALIDATE**: `npm run typecheck` clean。`grep -n "setWinnerCardBackground\|setSeasonCardBackground" src/lib/services/group.ts` で 2 関数追加を確認

### Task 5: `firebase.json` に storage / storage emulator を追加

- **ACTION**: `firebase.json` を更新
- **IMPLEMENT**:
  ```json
  {
    "firestore": {
      "rules": "firestore.rules",
      "indexes": "firestore.indexes.json"
    },
    "storage": {
      "rules": "storage.rules"
    },
    "emulators": {
      "auth": { "port": 9099 },
      "firestore": { "port": 8080 },
      "storage": { "port": 9199 },
      "ui": { "enabled": true, "port": 4000 },
      "singleProjectMode": true
    }
  }
  ```
- **MIRROR**: 既存 `firestore` / `auth` セクションと同形式
- **IMPORTS**: N/A
- **GOTCHA**: `singleProjectMode` を維持（複数プロジェクト統合は本プロジェクト範疇外）。storage port 9199 は Firebase Storage Emulator のデフォルト
- **VALIDATE**: `firebase emulators:start --only auth,firestore,storage,ui --project allin-pokertimer-e2e` が起動成功する（手動）

### Task 6: `storage.rules` を新規作成

- **ACTION**: `storage.rules` を repo root に新規作成
- **IMPLEMENT**:
  ```
  rules_version = '2';
  service firebase.storage {
    match /b/{bucket}/o {

      // deny-by-default — 明示的に許可した path 以外は read / write 不可
      match /{allPaths=**} {
        allow read, write: if false;
      }

      // Phase A.1 (05-post-launch-polish Track A):
      //   groups/{gid}/bgImages/{assetId} は結果カード背景画像。
      //   - read: public（OG SSR route の Vercel Node から fetch するため）
      //   - write: owner のみ + 1MB 以下 + image content-type
      //     - firestore.get で /groups/{gid}.ownerUids を参照（cross-service 機能、GA）
      //     - 1 read を消費するが upload 頻度は低く許容
      //   - delete: owner のみ（差し替え時の旧 asset 削除 / 明示解除）
      //   - 既知のリスク: 非 owner authenticated user が rule を突破することは出来ないが、
      //     orphan upload は firestore-side で発見不能（Phase A.2 の Storage asset best-effort
      //     delete でカバー）
      match /groups/{gid}/bgImages/{assetId} {
        allow read: if true;
        allow create, update: if request.auth != null
                              && firestore.exists(/databases/(default)/documents/groups/$(gid))
                              && request.auth.uid in firestore.get(/databases/(default)/documents/groups/$(gid)).data.ownerUids
                              && request.resource.size < 1 * 1024 * 1024
                              && request.resource.contentType.matches('image/(jpeg|png|webp)');
        allow delete: if request.auth != null
                      && firestore.exists(/databases/(default)/documents/groups/$(gid))
                      && request.auth.uid in firestore.get(/databases/(default)/documents/groups/$(gid)).data.ownerUids;
      }
    }
  }
  ```
- **MIRROR**: `firestore.rules` の deny-by-default + 個別 `match` パターン
- **IMPORTS**: N/A
- **GOTCHA**: `firestore.get` は **cross-service** 機能で、Firebase Storage Rules が Firestore のドキュメントを read できる。1 評価につき Firestore read を 1 件消費するが、upload 頻度（月 1〜2 回 × 数サークル）では実質無視できる。`firestore.exists` + `firestore.get` を併用し、対象 group doc が削除済みの場合は deny に倒す。content-type は **`image/(jpeg|png|webp)`** に限定（PRD で「`jpg quality 0.8`」を想定しているが、ユーザーが PNG / WebP をアップロードする可能性を残す。`Phase A.2 で client-side 圧縮で jpeg に統一する設計だが、rule では緩めに）
- **VALIDATE**: Task 8 の emulator validator で機械検証

### Task 7: `firestore.rules` に owner-only `winnerCardBackground` / `seasonCardBackground` ブランチを追加

- **ACTION**: `firestore.rules` の `groups/{gid}` `allow update` に 2 ブランチを additive 追加
- **IMPLEMENT**: 既存の `seasonPointsRule` ブランチ（247-274 行）の直後に以下を追加:
  ```
  ) || (
    // Phase A.1 (05-post-launch-polish Track A): owner による
    //   winnerCardBackground の単独書換。サークル詳細画面 inline edit から
    //   `setWinnerCardBackground({ gid, uid, value })` 経由で発火。
    //   affectedKeys は 'winnerCardBackground' のみに限定。他フィールドは触らせない。
    //   null セット（背景解除）も同 branch で許可。
    //   非 null 時は map + textTheme が string、imageUrl / storageAssetId は nullable string。
    //   各値の長さ / format（URL の整合性 / imageUrl と storageAssetId の同時設定）は
    //   service / application 層に委譲（rule 言語仕様でクロスフィールド invariant 表現困難）。
    //   organizer / member は不可（権限マトリクス）— isOwner で限定。
    isOwner(gid)
    && request.resource.data.diff(resource.data).affectedKeys()
         .hasOnly(['winnerCardBackground'])
    && (
      request.resource.data.winnerCardBackground == null
      || (
        request.resource.data.winnerCardBackground is map
        && (
          request.resource.data.winnerCardBackground.imageUrl == null
          || request.resource.data.winnerCardBackground.imageUrl is string
        )
        && (
          request.resource.data.winnerCardBackground.storageAssetId == null
          || request.resource.data.winnerCardBackground.storageAssetId is string
        )
        && request.resource.data.winnerCardBackground.textTheme is string
        && (
          request.resource.data.winnerCardBackground.textTheme == 'light'
          || request.resource.data.winnerCardBackground.textTheme == 'dark'
        )
      )
    )
  ) || (
    // Phase A.1 (05-post-launch-polish Track A): owner による
    //   seasonCardBackground の単独書換。winnerCardBackground と同型・同制約。
    isOwner(gid)
    && request.resource.data.diff(resource.data).affectedKeys()
         .hasOnly(['seasonCardBackground'])
    && (
      request.resource.data.seasonCardBackground == null
      || (
        request.resource.data.seasonCardBackground is map
        && (
          request.resource.data.seasonCardBackground.imageUrl == null
          || request.resource.data.seasonCardBackground.imageUrl is string
        )
        && (
          request.resource.data.seasonCardBackground.storageAssetId == null
          || request.resource.data.seasonCardBackground.storageAssetId is string
        )
        && request.resource.data.seasonCardBackground.textTheme is string
        && (
          request.resource.data.seasonCardBackground.textTheme == 'light'
          || request.resource.data.seasonCardBackground.textTheme == 'dark'
        )
      )
    )
  );
  ```
  併せて [firebase-patterns.md](../../../../.claude/rules/firebase-patterns.md) の「`groups/{gid}` update の allowed-keys 一覧」表を 2 行追加すべきだが、**docs 更新は Phase A.3 完了時に rule 全体の合流が終わってから行う**（A.2 で UI が触れる前にドキュメントが先行して陳腐化するのを避ける）
- **MIRROR**: RULE_AFFECTEDKEYS_BRANCH（`seasonPointsRule` 完全踏襲）+ `isOrganizer` → `isOwner` 切替
- **IMPORTS**: N/A
- **GOTCHA**:
  - 既存ブランチ（owner-update / self-add / self-leave / self-key memberDisplayNames / audioSettings / finishedTournamentCount / defaultSeatsPerTable / seasonStartDate / defaultTableLabels / seasonPointsRule）の **末尾に追加**すること。最初の owner-update ブランチが既に「全フィールド書換可」なので、新 narrow branch は owner-only 分岐の **subset** になる。これは表面的に redundant に見えるが、`firebase-patterns.md` の設計原則「単独フィールド書換の rule 経路を限定」に揃えるためであり、将来 Cloud Functions 化で broad owner-update を狭めるための足場
  - rule の最後の `);` の前に追加する（11 行目以降の `allow update: if (` … `);` のクロージング括弧の直前）
- **VALIDATE**:
  - `firebase emulators:start --only firestore --project allin-pokertimer-e2e` で起動時に rule の文法エラーが出ない
  - Task 8 の emulator validator で機械検証

### Task 8: `scripts/test-rules-card-background.mjs` emulator validator を作成

- **ACTION**: `scripts/test-rules-card-background.mjs` を新規作成
- **IMPLEMENT**: `test-rules-default-seats.mjs` をテンプレに、以下のケースを実装:
  1. owner が `winnerCardBackground = null` セット — allow
  2. owner が `winnerCardBackground = { imageUrl: "https://...", storageAssetId: "asset-1", textTheme: "light" }` セット — allow
  3. owner が `winnerCardBackground.textTheme = "dark"` セット — allow
  4. owner が `winnerCardBackground.textTheme = "auto"`（無効値）セット — deny
  5. owner が `winnerCardBackground` + `name` 同時書換 — deny（affectedKeys 違反）
  6. organizer が `winnerCardBackground = null` セット — deny（isOwner 違反）
  7. member が同上 — deny
  8. owner が `seasonCardBackground = { ... }` セット — allow（winner と対称）
  9. organizer が `seasonCardBackground = null` セット — deny
  10. legacy doc（winnerCardBackground フィールド不在）への owner 初回 set — allow
  11. owner branch 経由のフルアクセス（`name` + `winnerCardBackground` 同時）— allow（既存の owner-update branch を踏むため）

  seed: `groups/{gid}` を owner で create し、organizer / member を owner full-update で expand する（test-rules-default-seats.mjs と同パターン）
- **MIRROR**: EMULATOR_VALIDATOR_STRUCTURE（test-rules-default-seats.mjs を 1:1 で踏襲）
- **IMPORTS**: N/A（REST 直叩き、fetch のみ使用）
- **GOTCHA**: `nullValue: null` を使ったマップ内 null フィールドの送信は test-rules-default-seats.mjs の `tv` 関数が既にサポート。複合 map（`mapValue.fields`）は再帰的にネストできる
- **VALIDATE**: `npm run test:rules-card-background` で 11/11 PASS（後段 Task 10 で script 追加後）

### Task 9: `scripts/test-storage-rules.mjs` emulator validator を作成

- **ACTION**: `scripts/test-storage-rules.mjs` を新規作成
- **IMPLEMENT**:
  - Auth / Firestore emulator で owner / non-owner ユーザーと group doc を seed
  - Firebase Storage Emulator の REST API（`firebasestorage.googleapis.com/v0/b/{bucket}/o`）を idToken 付きで叩く
  - 想定ケース:
    1. anon が `groups/{gid}/bgImages/asset-1` を read — allow（public）
    2. owner が image/jpeg (< 1MB) を `groups/{gid}/bgImages/asset-1` に upload — allow
    3. organizer が同上 upload — deny
    4. member が同上 upload — deny
    5. unauthenticated が upload — deny
    6. owner が image/jpeg (> 1MB) を upload — deny（size 違反）
    7. owner が text/plain を `groups/{gid}/bgImages/asset-2` に upload — deny（content-type 違反）
    8. owner が `groups/{gid}/otherImages/asset-1` に upload — deny（path 違反、deny-by-default）
    9. owner が asset を delete — allow
    10. organizer が asset を delete — deny
  - emulator endpoint: `http://127.0.0.1:9199/v0/b/{E2E_PROJECT_ID}.appspot.com/o`
  - upload: `POST /v0/b/{bucket}/o?uploadType=media&name={encoded path}` with binary body
  - read: `GET /v0/b/{bucket}/o/{encoded path}` (auth via Authorization header) または **public**（auth なし）
  - delete: `DELETE /v0/b/{bucket}/o/{encoded path}`
- **MIRROR**: EMULATOR_VALIDATOR_STRUCTURE（`signUpOrIn` / `expectAllow` / `expectDeny` の構造は test-rules-default-seats.mjs と共通）
- **IMPORTS**: N/A
- **GOTCHA**:
  - Storage emulator は **REST endpoint が Firebase Storage 本番と微妙に異なる**（Google Cloud Storage 互換層）。upload は `POST /v0/b/{bucket}/o?name={path}&uploadType=media` 形式が確実
  - `firestore.get` を含む rule は **storage rule + firestore rule の両方を emulator が同時に起動している必要がある**。本 validator は `firebase emulators:exec --only auth,firestore,storage --project allin-pokertimer-e2e` で起動すること
  - 1MB ぎりぎりのテスト用画像 は `Buffer.alloc(1024 * 1024 + 1, 0)` 等で生成。本 phase は emulator が deny を返すことだけ検証するので JPEG validity は要らない（content-type は header で送信できる）。ただし「allow」テスト用には**有効な小さな JPEG**（数十バイトのプリベイク）を埋め込む（base64 リテラルで OK）
- **VALIDATE**: `npm run test:storage-rules` で 10/10 PASS

### Task 10: `package.json` に新 script を追加

- **ACTION**: `package.json` の `scripts` セクションを更新
- **IMPLEMENT**:
  ```json
  "test:rules-card-background": "firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e \"node scripts/test-rules-card-background.mjs\"",
  "test:storage-rules": "firebase emulators:exec --only auth,firestore,storage --project allin-pokertimer-e2e \"node scripts/test-storage-rules.mjs\"",
  ```
  既存 `emulator` script を更新:
  ```json
  "emulator": "firebase emulators:start --only auth,firestore,storage,ui --project allin-pokertimer-e2e",
  ```
- **MIRROR**: 既存 `test:rules-*` script の命名 / option（`firebase emulators:exec --only ...`）と完全同形
- **IMPORTS**: N/A
- **GOTCHA**: `--only` に `storage` を追加することで storage emulator が起動。既存 firestore-only / auth-only 検証 script には影響なし（同じ flag を持たないため）
- **VALIDATE**: `npm run test:rules-card-background` と `npm run test:storage-rules` が 0 exit で完走

### Task 11: README に Blaze プラン移行手順を追記

- **ACTION**: `README.md` の「2. Firebase プロジェクトの作成」セクションに Blaze プラン移行と Storage 初期化を追記
- **IMPLEMENT**: 既存 step 5（Web アプリ追加）の後に以下を挿入:
  ```markdown
  6. **Cloud Storage for Firebase** を初期化（**Blaze プラン必須**）

     結果カード背景画像（[Phase A.1 以降](.claude/PRPs/05-post-launch-polish/prds/05-post-launch-polish.prd.md)）を利用する場合のみ必要:

     1. Firebase Console → **使用量と請求** → 「プランを変更」で **Blaze（従量制）** に切替（5GB ストレージ・1GB egress/day までは無料枠）
     2. **Storage** → 「使ってみる」→ ロケーション（推奨: `asia-northeast1`）を選択
     3. ルールは後段の `firebase deploy --only storage` で `storage.rules` を反映する
     4. 既定バケット名は `<project-id>.appspot.com` 形式で、`.env.local` の `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` に設定済みのはず（step 5 の `firebaseConfig` から取得）

     > Blaze プランへ移行しなくてもアプリは動きます（背景画像機能のみ無効化されます）。本機能を使わない fork ユーザーは本 step を skip して問題ありません。

  7. **Storage ルールのデプロイ**

     ```bash
     firebase deploy --only storage
     ```
  ```
  既存「ルールデプロイ」セクション（line ~115-125 付近）にも:
  ```bash
  # Firestore + Storage を両方デプロイする統合コマンド
  firebase deploy --only firestore:rules,firestore:indexes,storage
  ```
  「Validation Commands」テーブルに以下 2 行を追加:
  ```
  | `npm run test:rules-card-background` | groups/{gid} の card background ブランチを emulator 上で検証（Phase A.1）  |
  | `npm run test:storage-rules`         | Storage rules を emulator 上で検証（Phase A.1）                              |
  ```
- **MIRROR**: 既存 README の手順 step 構造（番号付きリスト + `> 注意` callout）
- **IMPORTS**: N/A
- **GOTCHA**:
  - Blaze 移行はユーザー（Firebase プロジェクト所有者）の Console 操作で、自動化不可
  - **「Blaze 不要なら本機能だけ無効化される」** を明示することで fork 障壁を下げる（PRD「Track A 技術リスク」の「Blaze プラン移行をユーザーが忘れて Storage が動かない」対策）
- **VALIDATE**: README を rendered preview で確認し、step 番号の連番が揃っている / Markdown が崩れていない

### Task 12: 全体検証ループ

- **ACTION**: 以下を順に実行し、すべて green になることを確認
- **IMPLEMENT**:
  ```bash
  # 静的検証
  npm run typecheck
  npm run lint

  # ユニットテスト（schema / repository の暗黙的 hydrate 検証含む）
  npm run test

  # build（SSR 評価時のストレージ初期化エラー検出用）
  npm run build

  # emulator rule 検証
  npm run test:rules-limits        # 既存 — drift 確認
  npm run test:rules-card-background   # 新規
  npm run test:storage-rules           # 新規
  npm run test:rules-default-seats     # 既存 — 回帰確認（任意）
  npm run test:rules-season            # 既存 — 回帰確認（任意）

  # E2E は Phase A.1 では UI 変更が無いため変更不要だが、回帰確認のため 1 回流す
  npm run test:e2e
  ```
- **MIRROR**: Phase B.1 / Phase E の完了条件と同パターン
- **IMPORTS**: N/A
- **GOTCHA**: `npm run test:e2e` は Storage emulator なしで動く（Phase A.1 は UI / SDK の Storage 触らないため）。Storage emulator は手動 / npm script からのみ起動
- **VALIDATE**: 全コマンドが 0 exit。Codex レビュー前のコミット直前で必ず実行

---

## Testing Strategy

### Unit Tests

本 phase は schema / repository / service の追加が中心。explicit unit test は最小限に留め、emulator validator で behavior を担保する方針（既存 `seasonPointsRule` / `defaultSeatsPerTable` と同方針）。

| Test                                          | Input                                          | Expected Output                                         | Edge Case?            |
| --------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------- | --------------------- |
| `validateCardBackground(null)`                | `null`                                         | 例外なし                                                | yes                   |
| `validateCardBackground({...full...})`        | `{ imageUrl, storageAssetId, textTheme }`      | 例外なし                                                | yes                   |
| `validateCardBackground({imageUrl:"x", storageAssetId:null, textTheme:"light"})` | invariant 違反 | `AppError("validation/card-background-invalid")` throw | yes（同時設定 invariant） |

これらは `repositories/groups.ts` の file-local helper を直接 test するのは難しいため、repository import 経由でテストするか、`schemas/group.ts` 側に invariant helper を export して unit test する。**判断は実装時に簡潔な方を選ぶ。** PRD の `tdd-workflow` skill 規約に従い、最低でも `validateCardBackground` の 3 ケースは vitest で書き起こす。

### Edge Cases Checklist

- [x] 既存 group doc が `winnerCardBackground` フィールド不在 → schema `default(null)` で hydrate
- [x] owner が `winnerCardBackground = null` set（解除）
- [x] owner が初回 set（旧 doc から非 null へ遷移）
- [x] organizer / member が write → rule で deny
- [x] `affectedKeys` に他フィールド混入 → rule で deny
- [x] `textTheme` 不正値（`"auto"` 等）→ rule で deny
- [x] Storage upload に non-image content-type → storage rule で deny
- [x] Storage upload > 1MB → storage rule で deny
- [x] 非 owner が Storage に upload → storage rule で deny
- [x] anon が Storage を read → allow（public）
- [x] anon が Firestore の `winnerCardBackground` を read → 既存 group read rule（メンバーのみ）で deny（Phase A.1 では変更しない）

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
```

EXPECT: ゼロ型エラー

```bash
npm run lint
```

EXPECT: ゼロ lint エラー

### Unit Tests

```bash
npm run test
```

EXPECT: 全 vitest テスト pass（既存 + `validateCardBackground` の追加分）

### Build

```bash
npm run build
```

EXPECT: Next.js build 成功（SSR 評価時に `getStorage` で初期化エラーが出ない）

### Emulator Rule Validation

```bash
npm run test:rules-card-background
```

EXPECT: 11/11 PASS

```bash
npm run test:storage-rules
```

EXPECT: 10/10 PASS

```bash
npm run test:rules-limits
```

EXPECT: drift なし（本 phase は新 limit 定数を導入しないが、既存リテラル check を確認）

### E2E Smoke

```bash
npm run test:e2e
```

EXPECT: 全 spec pass（本 phase は UI 変更なし、回帰確認のみ）

### Manual Validation

- [ ] `firebase emulators:start --only auth,firestore,storage,ui --project allin-pokertimer-e2e` で起動成功
  → Firestore Emulator UI（<http://127.0.0.1:4000>）の「Storage」タブが表示される
- [ ] dev server（`npm run dev`、emulator なし）で **`/groups/[gid]` ページが既存通り動く**
  → Phase A.1 は UI 変更なしのため見た目に差分なし、`winnerCardBackground` フィールド未設定でもエラーが出ない
- [ ] Firestore Console（実プロジェクト）で既存 `groups/{gid}` doc が読める
  → 旧 doc は `winnerCardBackground` 未定義のままだが、SDK 側で `null` hydrate されることを `npm run dev` のクライアントログで確認
- [ ] **Firestore rules の本番デプロイ**（Phase A.1 マージ後）
  ```bash
  firebase deploy --only firestore:rules,storage
  ```
  → 本番反映を**必ず行う**（emulator green でも本番未 deploy で permission-denied する罠）

---

## Acceptance Criteria

- [ ] 全 Task が completed
- [ ] 全 Validation Commands が pass
- [ ] `npm run test:rules-card-background` 新規 / `npm run test:storage-rules` 新規 / `npm run test:rules-limits` 既存が green
- [ ] 既存 `groups/{gid}` doc が破壊的 migration なしで `winnerCardBackground == null` で hydrate される
- [ ] Storage emulator が `firebase emulators:start` で起動し、port 9199 で listen
- [ ] README に Blaze プラン移行手順が追加され、fork user が辿れる
- [ ] **`firebase deploy --only firestore:rules,storage` を本番に反映**したことを Phase 完了報告に明記
- [ ] Codex review に通る

## Completion Checklist

- [ ] Singleton / emulator connect は SINGLETON_GUARD パターンを踏襲（重複初期化対策の flag を共有）
- [ ] Schema は ADDITIVE_NULLABLE_SCHEMA（`seasonPointsRuleSchema` と完全同形）
- [ ] Repository / Service は REPOSITORY_WRAP_PATTERN / SERVICE_ROLE_GATE（`updateSeasonPointsRule` / `setSeasonPointsRule` と完全同形）+ `assertOwner` 切替
- [ ] Rule は RULE_AFFECTEDKEYS_BRANCH（`seasonPointsRule` と完全同形）+ `isOwner` 切替
- [ ] Emulator validator は EMULATOR_VALIDATOR_STRUCTURE（REST 直叩き + HTTP status assert）
- [ ] 新 `*.{ts,tsx}` で `console.*` 直呼び / 素の `throw new Error` がない（[error-logging.md](../../../../.claude/rules/error-logging.md) 準拠）
- [ ] schema / rule / service / repository の **3 点同時更新**完了
- [ ] **本番 Firestore rules + Storage rules deploy** を Phase 報告書に記載

## Risks

| Risk                                                                                  | Likelihood | Impact | Mitigation                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blaze プラン未移行で Storage が初期化エラーになる                                     | M          | M      | `getStorage(firebaseApp)` 自体は Blaze 不要で初期化可能。実 upload で 403 になるが本 phase は upload しない（Phase A.2 課題）。README で明示済                                                |
| `firestore.get` を含む storage.rules が emulator で動かない                          | L          | H      | Firebase Storage Emulator は cross-service `firestore.get` を **2023+ から正式サポート**。万一動かなければ `auth.uid in groups/{gid}.ownerUids` の検証を application 層に倒し rule は緩める |
| Storage emulator の REST endpoint が本番と微妙に異なる                              | M          | L      | Task 9 の GOTCHA で記載。`POST /v0/b/{bucket}/o?name=...&uploadType=media` 形式で統一                                                                                                       |
| 既存 `npm run test:e2e` が storage emulator なしで動かなくなる                       | L          | M      | Phase A.1 は SDK 側で Storage を呼ばないため影響なし（client.ts で初期化のみ）。万一影響があれば `playwright.config.ts` の `--only` に `,storage` を追加                                    |
| 旧 doc に `winnerCardBackground` フィールド不在で `zodConverter` が fail             | L          | H      | `schema.default(null)` で hydrate されるため発生しない（先例: `seasonPointsRule` / `seasonStartDate` / `defaultTableColors`）                                                                |
| Storage rule の `request.resource.size` が emulator で異なる挙動                      | L          | L      | emulator validator で 1MB ぎりぎり / 超過の両ケースを検証。失敗時は rule 側の上限値を `< 1024 * 1024` から `<= 1048575` に明示化                                                              |
| owner-only ブランチが既存 owner-update branch の subset で「dead branch」に見える    | -          | -      | これは設計意図（将来 broad owner-update を狭めるための足場）。コメントに明記し review 時の confusion を予防                                                                                  |

## Notes

- **旧 asset 削除ポリシー（2026-05-10 ユーザー確認）**: サークルあたり保持画像数を「winner / season カード分の最大 2 枚」に収束させるため、Phase A.2 の upload 差し替えフローは **最大 3 回 retry の確実削除**（指数 backoff: 200ms / 600ms / 1.8s）で旧 asset を削除する。3 回失敗時のみ `logger.warn("orphan card background asset", { gid, assetId })` で記録しアップロード自体は成功扱いとする。詳細は PRD「Track A: Technical Approach / Architecture Notes」と「Decisions Log: Track A 旧 asset の扱い」参照
  - Phase A.1 では retry helper を導入しない（A.1 は UI / upload を持たないため不要）
  - A.2 で `src/lib/utils/retry.ts` 等に再利用可能な helper を新設し、A.2 plan の Task で明示
  - A.1 の storage rule（Task 6）は **owner-only delete を既に許可**しているため、A.2 で retry 削除を実装するための rule 側の足場は本 phase で完成する
- 本 phase は **PRD 進捗表で `pending` → `in-progress`** に更新する必要がある。`/prp-implement` 実行時に PR タイトル / コミットメッセージで Phase A.1 を明示
- A.2 の commit 前に A.1 だけを単独 PR でマージするのが推奨（Storage / Rule 変更は本番 deploy が必要なため、UI 変更とは独立に dry-run できる）
- 本 phase 完了後、PRD の Implementation Phases 表の A.1 行に **plan ファイルへの link** と **status: in-progress** を反映する。完了時にレポート（`reports/phase-a.1-storage-foundation-report.md`）を生成して `complete` に倒す
- **Codex review 前のチェック**: `firebase deploy --only firestore:rules,storage` の **本番反映** を必ず Phase 完了報告に書く（memory: `feedback_firestore_rules_deploy` — emulator green でも本番未 deploy で permission-denied する罠）
- ユーザー向けメッセージ（dialog / toast / AppError.message）には **「Firebase」「Firestore」「Storage」を露出させない**（memory: `feedback_no_tech_stack_in_user_messages`）。本 phase は UI 変更がないため直接影響なし
