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

## Phase 2.5 以降の注意: `get()` による参照は rule read を消費

- Security rule 内の `get(/documents/...)` は **1 回の評価につき Firestore の読取クォータを 1 件消費**する
- 同一トランザクションでの連続書込やリアルタイム購読（`onSnapshot`）の接続時に毎回評価される
- 対策:
  - rule 内でメンバーシップ判定に使う path は**同じ document を参照**するよう統一し、Firebase の rule 内 cache を活かす
  - 可能なら書込時に `request.auth.uid` と `resource.data.memberUids`（冗長フィールド）を突き合わせる設計も検討
  - 20 人 × 月 1〜2 回規模では総量的に問題は出ないが、UI 側で無駄な re-subscribe を避ける
- group ベース権限モデルの全容は [group-membership.md](group-membership.md) を参照
