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

## 招待コード設計原則（Phase 2.5 以降）

`groupJoinCodes/{code}` による group 加入フローで遵守すること:

- **推測困難性**: code は **Web Crypto API で生成した 128bit 以上のランダム値**を base36 / base62 等で短縮。連番・時刻ベース・UUID v1 など予測可能な方式禁止。現行実装は base36 × 25 文字 ≈ 129bit（[repositories/groupJoinCodes.ts](../../src/lib/firebase/repositories/groupJoinCodes.ts) の `CODE_LENGTH`）
- **有効期限**: `expiresAt` 必須。default 7 日・最大 30 日。期限切れコードは rule で read 拒否
- **使用回数制限**: `maxUses` / `usedCount` を持ち、`usedCount >= maxUses` のコードは rule で加入拒否
- **失効操作**: group オーナーは任意時点でコードを削除（失効）できること
- **ログ**: 加入成功・失敗イベントは `logger.info` / `logger.warn` で記録（[error-logging.md](error-logging.md) 準拠）
- **rule 側の保護**: 加入書込は `groupJoinCodes/{code}` の有効性チェックを rule に必ず含める（クライアント検証のみに依存しない）

詳細モデルは [group-membership.md](group-membership.md) 参照。

## Structure Templates（Phase 4.8 以降）

サークル横断の `structureTemplates/{tid}` コレクションと、そのクリーンアップ権限を持つ `templateAdmins/{uid}` コレクションの運用規約。

### 匿名ユーザー除外（read / create）

`structureTemplates` の `read` / `create` は **通常アカウント（Google / メール / メールリンク）限定**とし、匿名ユーザー（`signInAnonymously`）は rule で deny する。

- **rule 側**: [firestore.rules](../../firestore.rules) の `isSignedInNotAnon()`（`token.firebase.sign_in_provider != 'anonymous'`）で判定
- **UI 側**: `RequireAuth(allowAnonymous=false)` でも同じ gate をかけており、二重防御
- **理由**:
  - `createdByDisplayName` の信頼性担保（匿名は表示名を持たない）
  - description に運用者が誤ってサークル固有事情を書いたとき、`/join/[tid]` 経由の匿名ゲストへ read 経路を空けておかない

更新 / 削除は作成者本人または管理者に限定されており、匿名で create できない以上 update / delete 経路から匿名が漏れることはない。

### テンプレート管理者（`templateAdmins/{uid}`）

作成者脱会後のテンプレ整理のために導入したグローバル役割。`templateAdmins/{uid}` の doc 存在自体が管理者を示すマーカー。

- **read**: `allow get: if request.auth.uid == uid` のみ。`allow list: if false` で **管理者一覧の列挙を明示的に禁止**（`groupJoinCodes` と同方針）
- **write**: `allow create, delete: if isTemplateAdmin()` で既存管理者からの操作のみ許可。`allow update: if false`（空 doc のため更新不要）
- **Bootstrap 制約**: rule が既存管理者の存在を前提とするため、**最初の 1 人目は Firestore Console で手動 seed が必須**（chicken-and-egg 回避）。手順は README の「Phase 4.8: テンプレート管理者の bootstrap」参照
- **最後の 1 人の保護**: 管理者が 0 人になると自力復旧不可（Console で再 seed するしかない）。本 Phase では grant / revoke の UI を提供しないため事故リスクは低いが、将来 UI 化する際は「最後の 1 人の self-revoke 禁止」を rule か Callable で実装すること
- **`createdByDisplayName` snapshot**: `users/{uid}` が self-only read のため、テンプレ一覧で他人の作成者名を表示できない制約がある。対策として `structureTemplates` doc に `createdByDisplayName` を snapshot で保存（rename 追従は仕様として放棄）
