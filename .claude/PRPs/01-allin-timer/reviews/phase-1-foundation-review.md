# Code Review: Phase 1 — Foundation

**Reviewed**: 2026-04-19
**Commit range**: `origin/develop~2..HEAD`（`c7fbc82` + `b79ea41`）
**Branch**: `develop` → `main`
**Decision**: **REQUEST CHANGES**（1 件の HIGH を GitHub 公開前に解消、残りは Phase 2 前）

## Summary

Phase 1 Foundation の実装は singleton・`AppError`・`useAuthUser`・`"use client"` 配置など主要な構造が規約どおりで型安全性も `strict: true` で担保されている。ただし `/debug/fs` が本番公開されるリスク（**H-1**）と、Firestore ルールが匿名認証ユーザーに広めの read 権限を与えている（**H-2**）点は GitHub 公開前に閉じるべき。その他 Phase 2 前に対応すべき中粒度の指摘が複数あり、Phase 2 以降の参照実装として規約が伝播する前に修正しておく。

## Findings

### CRITICAL

なし（実 API キー・秘密情報のリポジトリ漏洩なし）。

### HIGH

**H-1. `/debug/fs` が認証ゲートなしで本番公開される**
[src/app/debug/fs/page.tsx](src/app/debug/fs/page.tsx)
- Phase 5 まで残す予定の debug ルートが、Vercel デプロイ後は誰でもアクセス可能になる
- ボタン 1 クリックで匿名サインイン → Firestore 書込が動くため、課金攻撃 + Auth Users 膨張のリスク
- **Fix**: ページ先頭で `if (process.env.NODE_ENV !== "development") notFound();` を実行する（または Vercel Preview 限定ルートに移動）

**H-2. Firestore 読取が匿名ユーザー含む全認証済みユーザーに開放**
[firestore.rules:14,20](firestore.rules#L14)
- `allow read: if request.auth != null;` は `signInAnonymously()` 直後の匿名ユーザーも通す
- 攻撃者が SDK を直接叩けば全トーナメント・サブコレクションを列挙可能
- **Fix**: 暫定で `allow list: if false;` にし、`get` のみ `ownerUid` 一致で許可。Phase 4 で `members` サブコレクション等メンバーシップ概念導入時に緩和

**H-3. `onAuthStateChanged` のエラーコールバックが欠落、無音で `loading=true` 固定化しうる**
[src/lib/firebase/AuthProvider.tsx:23](src/lib/firebase/AuthProvider.tsx#L23)
- `onAuthStateChanged(auth, next)` の 3 引数目（error）を渡しておらず、ネットワーク断や SDK 初期化失敗で `loading` が永続的に `true` のまま
- **Fix**:
  ```ts
  onAuthStateChanged(
    firebaseAuth,
    (user) => setState({ user, loading: false }),
    (error) => { logger.error("auth state change error", { code: error.code }); setState({ user: null, loading: false }); },
  );
  ```

**H-4. `converter<T>()` の `fromFirestore` が `as T` の盲目キャスト**
[src/lib/firebase/converters.ts:10](src/lib/firebase/converters.ts#L10)
- `snap.data() as T` は Firestore の実データと型定義の乖離を検出できない
- firebase-patterns.md の「生 DocumentData を UI に持ち込まない」意図を実装レベルで果たせていない
- **Fix (最小)**: コメントで limitations を明記し、Phase 2 で zod 等 runtime validation を必ず足す issue を立てる。Phase 2 で `tournamentConverter` を定義する際に validator 統合

**H-5. `debug/fs` が converter を使わず生 collection で read/write**
[src/app/debug/fs/page.tsx:34,52](src/app/debug/fs/page.tsx#L34)
- Phase 2 以降のコードが参考にする可能性がある debug 実装で規約違反
- **Fix**: `collection(firestore, "tournaments").withConverter(converter<Tournament>())` に置換

**H-6. `signInAnonymously` 直後の `currentUser` 参照が競合しうる**
[src/app/debug/fs/page.tsx:24-32](src/app/debug/fs/page.tsx#L24)
- `signInAnonymously()` が返す `UserCredential.user.uid` を使うのが正解
- **Fix**:
  ```ts
  const credential = await signInAnonymously(firebaseAuth);
  const uid = credential.user.uid;
  ```

### MEDIUM

**M-1. `ESLint no-console` の `allow: ["warn","error"]` でロガー以外からの `console.warn/.error` 直呼びが素通りする**
[.eslintrc.json:4](.eslintrc.json#L4)
- error-logging.md は `logger` 経由のみを強制しているが、ESLint 設定が warn/error を穴にしている
- **Fix**: `"no-console": "error"` に変更し、`logger.ts` 内の 4 分岐すべてに `// eslint-disable-next-line no-console` を付与

**M-2. Firebase 初期化のトップレベル throw は呼び出し側で catch できない**
[src/lib/firebase/client.ts:39-43](src/lib/firebase/client.ts#L39)
- モジュール評価時の throw は React Error Boundary で補足できず、白画面になる可能性
- Phase 2 で認証 UI を入れる際にユーザー向けエラー表示をするなら `initFirebase()` 関数化を推奨
- **Fix**: 現状維持でも動くが、Phase 2 の最初のタスクで関数化する前提で TODO を残す

**M-3. `logger.resolveLevel()` をログ 1 件ごとに評価している**
[src/lib/logger.ts:11-19](src/lib/logger.ts#L11)
- client bundle では実害小だが SSR 側では毎回 `process.env` アクセス発生
- **Fix**: `const MIN_LEVEL = resolveLevel();` をモジュールトップに移動

**M-4. `AppError` が native `Error.cause` を使っていない**
[src/lib/errors.ts:3-10](src/lib/errors.ts#L3)
- ES2022 target なので `super(message, { cause })` が使える。スタックトレース連鎖のためネイティブに委譲すべき
- **Fix**: `super(message, { cause: cause as Error | undefined }); ` にする（`public readonly cause?: unknown` フィールドは `super` 側に任せる）

**M-5. `tournament.ts` の型名 `Level` は汎用すぎる**
[src/types/tournament.ts:10](src/types/tournament.ts#L10)
- グローバル `Level` 衝突や、ロギング等ドメイン外で名前が被るリスク
- **Fix**: `BlindLevel` にリネーム

**M-6. `AuthProvider` の `useMemo(() => state, [state])` は実質無効**
[src/lib/firebase/AuthProvider.tsx:29](src/lib/firebase/AuthProvider.tsx#L29)
- `state` 依存なので新参照で毎回再計算、メモ化の効果なし。読み手を混乱させる
- **Fix**: `<AuthContext.Provider value={state}>{children}</AuthContext.Provider>` に戻す

**M-7. `structures` コレクションの read ルールが `list` も通している**
[firestore.rules:28](firestore.rules#L28)
- `read` = `get` + `list`。`list` 時は `resource == null` なので `ownerUid` 比較がエラー or false になり挙動が曖昧
- **Fix**: `allow get` と `allow list` を分離、`list` は Phase 4 で用途確定まで `if false`

**M-8. `.gitignore` が `.env.production` を個別に除外していない**
[.gitignore:28-29](.gitignore#L28)
- `.env*.local` と `.env` は除外されているが `.env.production` は漏れる
- **Fix**: `.env.*` を追加

**M-9. esbuild / vite / vitest に MODERATE CVE（GHSA-67mh-4wv8-2f99）**
- 影響は dev サーバのみで本番ビルドには及ばない
- **Fix**: Phase 2 開始前に `vitest@latest` にアップグレードして `npm audit` を再確認

### LOW

**L-1. README にディレクトリ構成の旧パス `app/_debug/fs/` 記載**
[README.md:98](README.md#L98)
- 機能影響なし。`app/debug/fs/` に更新

**L-2. SSR 時に placeholder config で Firebase SDK が初期化される**
[src/lib/firebase/client.ts:46](src/lib/firebase/client.ts#L46)
- 現状実害なし。Admin SDK を使う Phase ではサーバ専用初期化パスに分離（security.md 既存ルール）

**L-3. git 履歴にコミッタ個人メール露出**
- GitHub 「Email privacy」で noreply 化を推奨（既存履歴の書き換えは破壊的なので新規コミットから）

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (`next lint`) | Pass — 0 warnings / 0 errors |
| Tests (`vitest`) | Pass — 5/5 |
| Build (`next build`) | Pass — `/`, `/_not-found`, `/debug/fs` 静的生成 |

## Files Reviewed

35 files changed（Added 33 / Modified 2）。主な対象:
- Source: `src/app/{layout,page,debug/fs/page}.tsx`, `src/components/ui/button.tsx`, `src/lib/{errors,logger,utils}.ts`, `src/lib/firebase/{client,AuthProvider,converters}.ts/tsx`, `src/types/tournament.ts`
- Tests: `src/lib/errors.test.ts`
- Config: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `.eslintrc.json`, `.prettierrc`, `components.json`
- Firebase: `firebase.json`, `firestore.rules`, `firestore.indexes.json`, `.firebaserc`
- Docs: `README.md`, `LICENSE`, `env.local.example`, `CLAUDE.md`, `.gitignore`

## 推奨アクション

1. **公開前必須**: H-1（debug ページのゲート）、H-2（Firestore read を絞る）
2. **Phase 2 開始前**: H-3〜H-6、M-1〜M-4、M-7〜M-9
3. **任意**: M-5（型名変更）、M-6（useMemo 撤去）、L-*
