---
applyAlways: true
---

# セキュリティ基本規約

**MIT ライセンスで GitHub 公開前提**のため、秘密情報の漏洩防止を最優先とする。
本ファイルはコミット・リポジトリ運用に関する universal な規約。常時適用。

ファイル種別ごとの個別規約は以下に分割:

- 環境変数の取り扱い: [security-env.md](security-env.md)
- 招待コード（`groupJoinCodes`）設計原則: [group-membership.md](group-membership.md) の「招待コード設計原則」
- Structure Templates / templateAdmins 運用: [firebase-patterns.md](firebase-patterns.md) の「Structure Templates / templateAdmins 運用」

## 公開リポジトリ運用

- コミット前に `git diff` で `.env` / `apiKey` / `token` / `secret` の残存チェック
- Firebase Security Rules は deny-by-default（詳細は [firebase-patterns.md](firebase-patterns.md) 参照）
- GitHub 公開前の最終チェック: `git log -p -- '.env*'` で履歴に秘密が混入していないか確認

## サークル固有情報

- 参加者名・メール・トーナメント記録などの**サークル固有データは Firestore にのみ保存**
- テストデータ・サンプルデータ含め、**リポジトリには一切コミットしない**
- `src/` や `tests/` に実データを貼り付けない（ダミーは明らかにダミーと分かる名前で）

## 依存関係

- `npm install` / `pnpm add` 等のインストール系コマンドは **ask モード**（settings.local.json で設定済み）
- 依存追加時は用途・ライセンス・メンテナンス状況を確認してから承認
