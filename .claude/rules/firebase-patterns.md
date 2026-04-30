# Firebase / Firestore 実装規約

Phase 1 で確立し、Phase 2 で zod runtime validation と repositories 層を追加した Firebase 利用パターン。以降の Phase も必ず従うこと。

## 初期化

- Auth / Firestore への直接アクセスは **`src/lib/firebase/client.ts` の singleton 経由のみ**
- コンポーネント・hook・ユーティリティから `initializeApp` / `getAuth` / `getFirestore` を直接呼ばない
- SSR / CSR の両方に対応した初期化ガード（`getApps().length` チェック）を singleton 側に集約
- Firebase Auth のテンプレート言語は `firebaseAuth.languageCode = "ja"` を singleton で固定

## 認証購読

- 認証状態の購読は **`useAuthUser`（`AuthProvider` 配下）経由のみ**
- `onAuthStateChanged` をコンポーネントや hook から**直接呼ばない**
- 購読の重複とメモリリーク防止のため

## Firestore アクセス

- Firestore SDK の直接呼び出し（`collection` / `doc` / `addDoc` / `getDoc` / `getDocs` / `setDoc` / `updateDoc` / `deleteDoc`）は **`src/lib/firebase/repositories/` 配下のみ**で行う
  - UI / component / hook / service 層からは repository 関数を呼ぶ
- 各 collection は **`zodConverter(schema, "collectionName")` で withConverter 適用**（`src/lib/firebase/converters.ts`）
  - schema は **ドキュメント本体**（`id` を含まない）で定義し、repository 側で `{ id: snap.id, ...snap.data() }` の形で合成して UI に返す
  - `fromFirestore` が zod の validate に失敗したら `AppError("firestore/invalid-data")` を自動 throw
- schema は `src/lib/firebase/schemas/{collection}.ts` に配置し、`BodySchema` と UI 向け `Doc`（= body + id）を双方 export
- 生の `DocumentData` を UI まで持ち込まない
- repository 関数はエラーを **必ず `AppError.from(e, "firestore/...", 日本語メッセージ)` でラップ**して throw する。呼び出し側で握りつぶさない

## repository の error wrap（Phase 4 architect-refactor 以降・推奨）

新規 repository 関数は `@/lib/firebase/wrap.ts` の `wrapFirestoreWrite` / `wrapFirestoreRead` を経由するのが**推奨**。手書き try/catch + `AppError.from` + `logger.warn` も動作上は等価だが、次回の architect-refactor で統一されるため最初から helper 経由にしておくと差分が少ない。

```ts
// 推奨形
export async function updateGroupName(gid: string, name: string): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "サークル名の更新に失敗しました",
    async () => {
      await updateDoc(groupDocRef(gid), { name });
    },
    { gid },
  );
  logger.info("group rename ok", { gid });
}
```

成功時の `logger.info` は wrap の**外**に置く（wrap は失敗時の warn のみ責任を持つ）。`runTransaction` を含む関数も tx 全体を wrap 内に納める形で対応可能（先例: `finishTournament` / `commitInitialSeating`）。

### 例外: subscribe 系 / 失敗を返却に倒す関数

以下は wrap を使わず従来形を維持する:

- `onSnapshot` 系（`subscribePlayers` / `subscribeTables` / `subscribeTournament` 等）— エラーを `onError` callback に渡す独自契約
- `templateAdmins.isTemplateAdmin` — 失敗を `false` 返却に倒す独自契約

このような関数はコメントで契約を明示する。

## 数値リミット定数の単一真実源（Phase 4 architect-refactor 以降）

数値リミット（最大卓数 / 最小・最大席数 / 既定値等）は **`src/lib/limits.ts`** に集約する。`engine.ts` / `schemas/*.ts` / `service/*.ts` / repositories / components はここから import する。

`firestore.rules` 内のリテラルは Cloud Firestore Security Rules の言語仕様で const 化できないためハードコードのまま、`scripts/test-rules-limits.mjs` で `limits.ts` との一致を機械検査する。新規リミット追加手順:

1. `src/lib/limits.ts` に `export const NAME = N;` を追加
2. schema / service / component を `import { NAME } from "@/lib/limits"` に切替
3. `firestore.rules` に `>= / <=` 制約を追加（必要なら）
4. `scripts/test-rules-limits.mjs` の `EXPECTED` と `checks` 配列に追加
5. `npm run test:rules-limits` で green 確認

## セキュリティルール

- **deny-by-default**（`allow read, write: if false;` から開始）
- 書込条件の基本形:
  - Phase 2 まで: `request.auth.uid == resource.data.ownerUid`（個人所有）
  - Phase 2.5 以降: `request.auth.uid in get(/databases/$(database)/documents/groups/$(resource.data.groupId)).data.memberUids`（group メンバーシップ）
- 参加者の読取は対象トーナメントドキュメントのみに限定
- **参加者ドキュメント（`tournaments/{tid}/players/{pid}`）** は以下を満たすこと:
  - create: `pid == auth.uid`、`uid == auth.uid`、`isBusted == false` 必須
  - update: 本人のみ、かつ `uid` / `isBusted` / `entryAt` / `bustedAt` は immutable（displayName のみ変更可）
  - delete: self-delete（`pid == auth.uid`）または owner-delete（親 tournament が存在し `ownerUid == auth.uid`）
- 外部ドキュメント参照（`get()`）は **`exists()` ガードと併用**し意図を明示化する
- ルール変更時は必ずエミュレータでテスト → `firebase deploy --only firestore:rules`

## 変更時のチェック

- Firestore スキーマ変更は schema（zod） / repository / security rules の **3 点を同時更新**
- 新規 collection 追加時は必ず deny ルールから書き始める
- `where("field", "==") + orderBy("other")` のクエリは Firestore 複合インデックスが必要。規模が小さい場合は **client 側ソート** を採用して index 追加を回避する設計を優先（詳細は [converters.ts](src/lib/firebase/converters.ts) / `repositories/*.ts` の `listMyXxx` パターン参照）

## 単一フィールド単独書換の rule 経路（Phase 4.16 以降の polish 系列）

`groups/{gid}` に additive で追加された数値フィールドは、書込経路を 1〜2 系統に限定し、rule 側でも `affectedKeys().hasOnly([...])` + 値域制約で他フィールド汚染を deny する設計を踏襲する。新フィールドを追加する場合も同パターンで実装すること（[firestore.rules](../../firestore.rules) の groups update 末尾分岐参照）。

### `finishedTournamentCount`（終了トーナメント累計数）

更新経路は**以下 2 系統に限定**する:

- 自動 +1 — `finishTournament()` の `runTransaction + increment(1)`（[repositories/tournaments.ts](../../src/lib/firebase/repositories/tournaments.ts)）。tx 内で `state !== "finished"` を再 read し、複数端末同時呼び出しでも二重 increment しない
- 手動修正 — `setFinishedTournamentCount({ gid, uid, value })`（service） → `updateFinishedTournamentCount(gid, value)`（repository）

rule: `isOrganizer(gid) + affectedKeys().hasOnly(['finishedTournamentCount']) + is int + >= 0`

### `defaultSeatsPerTable`（新規作成画面の席数初期値、Phase 4.17）

更新経路は**以下 1 系統に限定**する:

- 手動更新 — `setDefaultSeatsPerTable({ gid, uid, value })`（service） → `updateDefaultSeatsPerTable(gid, value)`（repository）。サークル詳細画面の inline edit からのみ呼ばれる

rule: `isOrganizer(gid) + affectedKeys().hasOnly(['defaultSeatsPerTable']) + is int + >= 2 + <= 10`

⚠ DRIFT WARNING: 上限 10 は `firestore.rules` の `players seatNum <= 10` および [tournament.ts](../../src/lib/firebase/schemas/tournament.ts) の `seatsPerTable.max(10)` と連動。同時に変更すること。drift 検出方法は前述の「数値リミット定数の単一真実源」セクション参照。

### `groups/{gid}` update の allowed-keys 一覧（Phase 4 architect-refactor 以降）

`firestore.rules` の `groups/{gid}` `allow update` は 6 ブランチに分かれており、各ブランチで `affectedKeys().hasOnly([...])` を別々に列挙している。新規フィールド追加時の見落とし（Phase 4.16 で発覚した self-* 分岐の `affectedKeys` 抜け型のバグ）を防ぐため、ブランチごとに許可するキーを表で一元化する:

| ブランチ | 条件 | 許可される変更キー（`affectedKeys().hasOnly`） |
| --- | --- | --- |
| **owner-update** | owner 全権 | （上限なし。ただし `ownerUids.size >= 1` / `createdAt` 不変は強制） |
| **self-add**（招待コード加入） | 非メンバー + 有効な joinCodeId | `memberUids` / `organizerUids` / `joinCodeId` / `memberDisplayNames` |
| **self-leave**（脱退） | メンバー + 非 owner | `memberUids` / `organizerUids` / `memberDisplayNames` |
| **self-key memberDisplayNames update** | 既メンバー | `memberDisplayNames`（自身の uid キーのみ） |
| **audioSettings update** | organizer | `audioSettings` |
| **finishedTournamentCount update** | organizer | `finishedTournamentCount` |
| **defaultSeatsPerTable update** | organizer | `defaultSeatsPerTable` |

新規フィールドを `groups/{gid}` に追加する場合の手順:

1. zod schema (`schemas/group.ts`) にフィールドを additive で追加（既存 doc に default を流す）
2. 必要な書込経路を決定し、上表に「どのブランチが新フィールドを許可すべきか」を追記
3. `firestore.rules` 該当ブランチの `affectedKeys().hasOnly([...])` に新キーを追加
4. 他のブランチでは新キーが含まれないため、それらの経路から触れないことが自動的に保証される
5. emulator validation スクリプト（[scripts/test-rules-finished-count.mjs](../../scripts/test-rules-finished-count.mjs) / [scripts/test-rules-default-seats.mjs](../../scripts/test-rules-default-seats.mjs) を雛形）に新フィールドの allow / deny ケースを追加し、`firebase emulators:exec` で検証

`affectedKeys` 列挙を逆算する（rule 側だけ更新して schema を忘れる）と、書込パスの矛盾で動作不能になりやすい。表 → schema → rule → test の順で更新すること。

## Phase 2.5 以降の注意: `get()` による参照は rule read を消費

- Security rule 内の `get(/documents/...)` は **1 回の評価につき Firestore の読取クォータを 1 件消費**する
- 同一トランザクションでの連続書込やリアルタイム購読（`onSnapshot`）の接続時に毎回評価される
- 対策:
  - rule 内でメンバーシップ判定に使う path は**同じ document を参照**するよう統一し、Firebase の rule 内 cache を活かす
  - 可能なら書込時に `request.auth.uid` と `resource.data.memberUids`（冗長フィールド）を突き合わせる設計も検討
  - 20 人 × 月 1〜2 回規模では総量的に問題は出ないが、UI 側で無駄な re-subscribe を避ける
- group ベース権限モデルの全容は [group-membership.md](group-membership.md) を参照
