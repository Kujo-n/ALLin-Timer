# テスト用 Firebase Project の分離設計

## 背景

E2E テストはローカルでは Firebase Emulator (`allin-pokertimer-e2e`) に向けて
隔離されているが、以下の経路では本番 Firebase Project (`allin-pokertimer`) に
直接アカウント・データが書き込まれていた:

- 過去の手動統合テスト
- Vercel Preview デプロイ環境（`.env.local` ではなく Vercel 環境変数を参照し、
  既定で本番 Project に向く）
- リリース前の最終動作確認

結果として 2026-04 〜 2026-05 にかけて Auth に `@e2e.local` ドメインの
テスト残骸 48 件が蓄積した（`scripts/cleanup-test-auth-users.ts` で対処）。

Emulator では発覚しない問題（複合インデックス未作成・実 Auth プロバイダー
連携・本番 Security Rules 反映状況）の検証は今後も必要なため、**本番とは別の
Firebase Project（staging）を新設し、emulator では拾えない検証はそこに集約**
する設計を以下に定める。

## ゴール

- 本番 (`allin-pokertimer`) には**実利用者のデータのみ**を残す
- 実 Firebase Project に向けたテスト・検証は **staging Project** で実施
- 切替は環境変数のみで行い、コード修正なしで本番 ⇄ staging を行き来できる

## 設計

### Project 構成

| 用途 | Project ID（例） | 想定用途 |
| --- | --- | --- |
| 本番 | `allin-pokertimer` | エンドユーザー利用。Vercel Production deploy のみ向ける |
| **staging（新設）** | `allin-pokertimer-staging` | 実 Firebase 必須の手動テスト・Vercel Preview deploy |
| Emulator | `allin-pokertimer-e2e`（仮想） | ローカル E2E。`firebase emulators:start --project ...` で隔離 |

staging Project は本番と Firestore Security Rules / Storage Rules / Composite Index
を**完全に同期**させる（`firebase deploy --project allin-pokertimer-staging --only firestore`）。

### 環境変数の配り方

`.env.local` は開発者ローカル / `.env.test` は staging 接続用 / Vercel 環境変数は
deploy target ごとに設定する。Next.js の env 解決順序を踏まえて:

| ファイル / 環境 | 利用シーン | 向き先 Project |
| --- | --- | --- |
| `.env.local` | `npm run dev` ローカル開発 | 開発者の選択（既定: staging 推奨） |
| `.env.test`（新規） | `npm run dev:test` の手動 staging 検証用 | `allin-pokertimer-staging` |
| Vercel Environment Variables (Production) | 本番 deploy | `allin-pokertimer` |
| Vercel Environment Variables (Preview) | Preview deploy | `allin-pokertimer-staging` |

`.env.test` は `.gitignore` 既存の `.env*.local` パターンには含まれないため、
**専用エントリを `.gitignore` に追加**する必要あり（後述「実装手順」参照）。

### Playwright config の扱い

現行 `playwright.config.ts` は emulator 一択で `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true`
を強制している。staging 向け E2E が必要になった段階で、別 config
(`playwright.config.staging.ts`) を作って:

- `webServer.command` から `firebase emulators:start` を除く
- `webServer.env` で staging 用の `NEXT_PUBLIC_FIREBASE_*` を流す
- `tests/e2e/fixtures/test-context.ts` の `autoResetEmulator` を no-op に切替（または
  staging 用 reset endpoint を別途用意）

⚠ staging E2E は emulator のような完全 reset ができないため、各 spec が**自身の
セットアップとクリーンアップを責任**を持って行う設計に変更が必要。本設計書では
範囲外（必要になった時点で別ファイルで設計する）。

## 既知のリスクと緩和

### 1. staging に書き込むテストアカウントが新たに溜まる

emulator で出ない問題の検証は staging で繰り返し行うため、`@e2e.local` 等の
テストアカウントが staging Project に蓄積する。本番ではないので致命的ではないが、
[`scripts/cleanup-test-auth-users.ts`](../../scripts/cleanup-test-auth-users.ts) を
**staging に対しても定期実行できる**よう汎用化しておく（環境変数で project を
切替）。

### 2. staging の Security Rules が古いまま検証することによる偽陽性

staging Project に rules を deploy し忘れると「emulator で OK / staging で OK /
本番で deny」というデバッグが極めて困難な事象が発生する。CI で
`firebase deploy --only firestore:rules --project allin-pokertimer-staging` を
PR マージ時に自動実行する pipeline を整える（範囲外）。

### 3. Vercel Preview の URL が staging に向くことの混乱

PR Preview から実 Firebase の staging に書き込むことになるため、レビュアーが
本番と勘違いしてデータを操作するリスク。**Preview deploy では
"STAGING" バッジを画面右上に常時表示する**等の UI 対策を併用する（別タスク）。

## 実装手順（着手時に実行）

1. Firebase Console で `allin-pokertimer-staging` を新規作成
   - Authentication: 匿名 / Email+Password / Google を有効化（本番と同じ）
   - Firestore: Native mode、リージョンは本番と同じ
   - リソース上限は無料枠のまま
2. ローカル CLI で alias 追加:
   ```bash
   firebase use --add allin-pokertimer-staging --alias staging
   ```
3. Rules / Indexes を staging に deploy:
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes --project staging
   ```
4. `.env.test`（新規）を作成し、staging の `NEXT_PUBLIC_FIREBASE_*` を設定
5. `.gitignore` に `.env.test` を追加
6. `package.json` に staging 向け script を追加:
   ```json
   "dev:test": "dotenv -e .env.test -- next dev"
   ```
   （`dotenv-cli` を devDependency に追加）
7. README に staging 環境の説明を追記（接続方法・データ取扱注意）
8. Vercel Project の Preview 環境変数を staging に切替

## 関連

- 削除スクリプト: [scripts/cleanup-test-auth-users.ts](../../scripts/cleanup-test-auth-users.ts)
- E2E emulator 設定: [playwright.config.ts](../../playwright.config.ts)
- Firebase 初期化 singleton: [src/lib/firebase/client.ts](../../src/lib/firebase/client.ts)
- Firebase 規約: [.claude/rules/firebase-patterns.md](../../.claude/rules/firebase-patterns.md)
- 環境変数規約: [.claude/rules/security-env.md](../../.claude/rules/security-env.md)
