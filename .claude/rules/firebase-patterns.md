# Firebase / Firestore 実装規約

Phase 1 で確立した Firebase 利用パターン。Phase 2 以降も必ず従うこと。

## 初期化

- Auth / Firestore への直接アクセスは **`src/lib/firebase/client.ts` の singleton 経由のみ**
- コンポーネント・hook・ユーティリティから `initializeApp` / `getAuth` / `getFirestore` を直接呼ばない
- SSR / CSR の両方に対応した初期化ガード（`getApps().length` チェック）を singleton 側に集約

## 認証購読

- 認証状態の購読は **`useAuthUser`（`AuthProvider` 配下）経由のみ**
- `onAuthStateChanged` をコンポーネントや hook から**直接呼ばない**
- 購読の重複とメモリリーク防止のため

## Firestore アクセス

- Firestore の read / write は **`converter<T>()`（`src/lib/firebase/converters.ts`）経由**で型安全に
- 生の `DocumentData` を UI まで持ち込まない
- collection / doc 参照は converter 適用済みヘルパ関数にまとめる
- **Phase 2 時点で runtime validator（zod 等）を `fromFirestore` に統合**する。Phase 1 の converter は `as T` キャストのみで型保証が弱い（converters.ts に `TODO(phase-2)` あり）。コレクション別に zod schema を定義し、`snap.data()` を validate してから返す設計に差し替えること

## セキュリティルール

- **deny-by-default**（`allow read, write: if false;` から開始）
- 書込条件の基本形: `request.auth.uid == resource.data.ownerUid`
- 参加者の読取は対象トーナメントドキュメントのみに限定
- ルール変更時は必ずエミュレータでテスト → `firebase deploy --only firestore:rules`

## 変更時のチェック

- Firestore スキーマ変更は converter と security rules の両方を同時更新
- 新規 collection 追加時は必ず deny ルールから書き始める
