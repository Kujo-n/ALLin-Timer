# セキュリティ・機密情報規約

**MIT ライセンスで GitHub 公開前提**のため、秘密情報の漏洩防止を最優先とする。

## 環境変数

- Firebase 認証情報（`NEXT_PUBLIC_FIREBASE_*` 等）は **`.env.local`（gitignore 済み）と Vercel 環境変数の両方で管理**
- `.env` / `.env.production` / `.env.*.local` はすべて gitignore 対象（`.gitignore` 済み）
- `NEXT_PUBLIC_*` プレフィックス付き変数はクライアントバンドルに含まれる前提で扱う（公開可能な値のみ）
- サーバ専用の秘密（Service Account Key 等）は `NEXT_PUBLIC_*` を**絶対に付けない**

## サークル固有情報

- 参加者名・メール・トーナメント記録などの**サークル固有データは Firestore にのみ保存**
- テストデータ・サンプルデータ含め、**リポジトリには一切コミットしない**
- `src/` や `tests/` に実データを貼り付けない（ダミーは明らかにダミーと分かる名前で）

## 公開リポジトリ運用

- コミット前に `git diff` で `.env` / `apiKey` / `token` / `secret` の残存チェック
- Firebase Security Rules は deny-by-default（詳細は [firebase-patterns.md](firebase-patterns.md) 参照）
- GitHub 公開前の最終チェック: `git log -p -- '.env*'` で履歴に秘密が混入していないか確認

## 依存関係

- `npm install` / `pnpm add` 等のインストール系コマンドは **ask モード**（settings.local.json で設定済み）
- 依存追加時は用途・ライセンス・メンテナンス状況を確認してから承認
