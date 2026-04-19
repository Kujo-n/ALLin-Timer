# ALLin-PokerTimer

NLH（ノーリミットテキサスホールデム）小規模サークル向けトーナメント進行支援 Web アプリ。熟練者不在でも TDA ルール通りに回せることを目標に、席決め・テーブルバランシングの自動指示を提供します。

- 対象規模: 6 テーブル以下、20 人前後
- ライセンス: MIT
- スタック: Next.js 15（App Router / TypeScript）+ Tailwind CSS + shadcn/ui + Firebase（Firestore + Authentication）
- デプロイ: Vercel Hobby（GitHub 連携）

詳細は [.claude/PRPs/prds/allin-timer.prd.md](.claude/PRPs/prds/allin-timer.prd.md) を参照してください。

## セットアップ手順

### 前提

- Node.js 20 以上（24 系で動作確認）
- Google アカウント（Firebase / Vercel 用）

### 1. リポジトリ取得と依存インストール

```bash
git clone https://github.com/<your-account>/ALLin-PokerTimer.git
cd ALLin-PokerTimer
npm install
```

### 2. Firebase プロジェクトの作成

1. [Firebase Console](https://console.firebase.google.com/) で新規プロジェクトを作成（Google Analytics は任意）
2. **Authentication** → 「Sign-in method」から以下 4 方式を有効化
   - 匿名
   - メール / パスワード
   - メールリンク（パスワードなしでのログイン）
   - Google（運営者 / 参加者の簡易ログイン用）
     - Google プロバイダ有効化時に **Project support email** の設定が求められるので、`Project Settings → General` で設定しておくこと
     - 承認済みドメインに `localhost` と本番／プレビュー URL が入っていれば OAuth 同意画面はそのまま動く
3. **Authentication** → 「Settings」→「承認済みドメイン」に以下を追加
   - `localhost`（開発用）
   - Vercel 本番 URL（例: `allin-pokertimer.vercel.app`）
   - プレビュー URL は PR ごとに変わるので、運用が辛い場合は `*.vercel.app` を追加
4. **Firestore Database** を「本番モード」で作成（ルールは後段で別途デプロイ）
5. **プロジェクト設定** → 「全般」→ 「マイアプリ」で Web アプリを追加し、`firebaseConfig` の値を控える

### 3. 環境変数の設定

テンプレートファイルをコピーしてドット付きのローカル env に改名します:

```bash
cp env.local.example .env.local
```

`.env.local` に Firebase Console で取得した設定値を記入してください（`.env.local` は `.gitignore` 対象）。

### 4. ローカル起動

```bash
npm run dev
```

- <http://localhost:3000/> で「ALLin-PokerTimer」見出しが表示されれば OK
- <http://localhost:3000/debug/fs> で [書込] → [一覧] を押し、作成したドキュメント ID が表示されれば Firestore 疎通 OK
- <http://localhost:3000/login> で新規登録 → <http://localhost:3000/structures/new> → <http://localhost:3000/tournaments/new> でトーナメント作成が可能

> `/debug/fs` は Phase 1 の疎通確認用ページです。本番公開を避けるため `NEXT_PUBLIC_ENABLE_DEBUG=1` が設定されている環境でのみ表示されます（未設定なら 404）。Phase 5 で削除予定。

### 運営者 / 参加者フロー（Phase 2）

- **運営者**: `/login` でログイン（Google / メール+PW / メールリンク）→ `/structures` でプリセット作成 → `/tournaments/new` でトーナメント作成 → `/tournaments/[tid]` ダッシュボードで受付 URL / QR をコピーし参加者に共有
- **参加者**: 配布された `/join/[tid]` URL から 4 つのいずれかで受付
  - **Google で参加**: ポップアップでアカウント選択するだけで完了（displayName は Google プロフィールを自動利用）
  - (a) ログイン: 既存メール+PW アカウント
  - (b) ゲスト: 表示名のみ（匿名 Auth）
  - (c) アカウント登録: 表示名＋メール入力 → Firebase から届くリンクをタップして完了（`/auth/email-link` コールバック）

### 受付方式ごとの「次回以降のログイン」と「端末跨ぎ」

| 登録方式 | パスワード | 端末跨ぎ | 次回アクセス方法 |
|---|---|---|---|
| Google | なし（Google 側） | **可能**（同じ Google アカウントで各端末からログイン → 同一 uid） | `/login` または `/join/[tid]` の「Google でログイン/参加」ボタン |
| (a) ログイン（メール+PW） | あり | **可能**（同じメール+PW で PC/スマホ両方ログイン → 同一 uid） | `/login` タブ「ログイン」 |
| (b) ゲスト（匿名 Auth） | なし | **不可**（端末ごとに別 uid が発行される） | 同一端末のセッション維持のみ。別端末からは別ゲスト扱い |
| (c) メールリンク | なし | **可能**（別端末でリンクを開いたとき、メール再入力を促される）| `/login` タブ「メールリンク」または `/join/[tid]` メール登録から再発行 |

> Google は **displayName を自動取得**し、スマホで 1 タップで参加できるので、Phase 2 E2E では最も快適な導線。Firebase Console で Google プロバイダの有効化と Project support email 設定が済んでいることが前提。

### 同じメールアドレスに複数認証方式が紐づいた場合

Firebase の既定設定（One account per email）では、メール+PW 登録済みアドレスで Google ログインすると `auth/account-exists-with-different-credential` になる。本アプリは **自動リンク導線**を実装済み:

1. Google ログインを試みる
2. 衝突検知 → 「Google アカウントを連携」ダイアログが開く
3. 既存パスワードを入力 → `linkWithCredential` で同一 uid に Google が連携される
4. 以降は Google / パスワードのどちらでもログイン可能

パスワード側メールが検証済みの場合は Firebase が自動でリンクするため、このフローは未検証メール（本アプリのデフォルト）でのみ発動する。

### プロフィール編集（`/settings`）

- ヘッダーの認証バッジ（緑●＋ユーザー名）をクリックすると `/settings` に遷移
- **表示名**をいつでも変更可能（Firebase Auth プロフィール + `users/{uid}` の両方に反映、端末跨ぎで同期）
- 変更は以降のトーナメント参加に反映。過去の参加者ドキュメントは上書きしない（履歴として保持）

**運営者の「PC + スマホ 同一トーナメント参加」想定**: (a) または (c) で登録していれば、PC とスマホ両方でログインして同じ `uid` として振る舞える。displayName は Firebase Auth プロフィールに同期されるため、どちらの端末からトーナメント参加しても参加者一覧には同じ名前が表示される。

### 表示名（displayName）は全アカウント必須

トーナメント席表・参加者一覧への表示に displayName が必要なため、以下のフローすべてで displayName を保証する:

- `/login` 新規登録（メール+PW）: **表示名フィールド必須**。登録時に Firebase Auth の displayName と `users/{uid}` プロフィールに書き込む
- `/login` メールリンク: 初回登録なら表示名を入力（任意入力欄、コールバック時に Auth プロフィールへ反映）
- `/join/[tid]` ゲスト: 表示名必須
- `/join/[tid]` メール登録: 表示名必須
- `/join/[tid]` ログイン／このアカウントで受付: 既存プロフィールの displayName を利用（未設定なら `validation/display-name-required` エラー）

受付時の displayName 解決優先順位: フォーム入力 → `users/{uid}` プロフィール → Firebase Auth プロフィール → エラー。
これにより別端末でログインしても displayName が保持され、参加者一覧表示がブレない。

> Phase 2 以前に displayName なしで登録された既存アカウントが join で `validation/display-name-required` を踏んだ場合は、`/login` メールリンクから表示名付きで再登録するか、Phase 5 でプロフィール編集 UI を追加する（未着手）。

### メールリンクのドメイン登録

- Email Link 認証の遷移先は `/auth/email-link?redirect=/join/[tid]`
- **Firebase Console → Authentication → 設定 → 承認済みドメイン** に `localhost` と Vercel 本番／プレビュー URL を追加しておくこと（未登録だと `auth/unauthorized-continue-uri` で失敗する）
- プレビュー URL は PR ごとに変わるため、運用が辛い場合は Vercel のカスタムドメイン or プレビュー毎の手動追加を検討

### メールテンプレートの日本語化 / ブランド調整

Firebase 標準テンプレートは英語で、件名も「Sign in to ...」となり迷惑メール扱いされやすい。以下の手順で日本語化とブランド明示を行う。

#### 最低限やること（無料プラン・編集不要）

1. クライアント側は既に `firebaseAuth.languageCode = "ja"` に固定済み（[client.ts](src/lib/firebase/client.ts)）。これだけで既定テンプレートが英語 → 日本語に切り替わる
2. **Firebase Console → Project Settings → General → Public-facing name** を `ALLin-PokerTimer` に変更。本文内 `%APP_NAME%` がこの値に置換され、「ALLin-PokerTimer にログインするには〜」のような日本語本文になる
3. **Project Settings → General → Support email** に運営者の連絡先メールを設定（受信者が不審に思った際の確認窓口になる）

ここまでで「件名: `ALLin-PokerTimer へのログイン`」「本文に運営メール」になり、迷惑メール誤検出率が大幅に下がる。件名／本文の詳細カスタマイズには下の **上級カスタマイズ** 参照。

#### 上級カスタマイズ（件名・本文を自由に書き換えたい場合）

Firebase Console → Authentication → Templates → `メールリンクでのログイン` の編集導線が出ない・グレーアウトする場合のトラブルシュート:

| 症状 | 対処 |
|---|---|
| 編集アイコンが見当たらない | Console の表示言語を英語に切替（右上歯車 → Languages → English）。日本語 UI では編集導線が隠れているケースあり |
| プレビューのみで保存不可 | Authentication → Settings で **Identity Platform にアップグレード**（無料・不可逆）。Auth 機能が拡張されて編集解禁される |
| 件名／本文が完全グレーアウト | Google Cloud Console → IAM で Owner / Editor 権限があるか確認 |
| Identity Platform も不可 | カスタム SMTP（Google Workspace 等）を Console に設定し、自社ドメインから送信する。送信元アドレスも自由になる |

件名の例: `【ALLin-PokerTimer】トーナメント参加のログインリンク`

**注意**: Firebase テンプレートは**プロジェクト単位の固定**で、`tid` やトーナメント名などの動的パラメータを件名に差し込むことは不可。参加者はメール内リンク URL（`/join/{tid}` が含まれる）で判別する前提。動的件名が必須なら Firebase Extensions `Trigger Email` + Blaze プラン + SendGrid/Mailgun が必要（Phase 5 での検討事項）。

#### 送信後に届かない場合のチェック順

1. 受信側の **迷惑メールフォルダ**（最頻）
2. Console → Authentication → Usage で **送信上限（無料枠 100 通/日）** を確認
3. テンプレート設定の保存漏れ（ブラウザ戻る等で未保存）
4. 企業メールで受信拒否される場合は **SMTP カスタム設定**（Google Workspace 等）で自社ドメイン送信へ

### 5. Firestore セキュリティルールのデプロイ

```bash
npm install -g firebase-tools  # 初回のみ
firebase login
# .firebaserc の projectId を自分の Firebase プロジェクト ID に書き換えてから:
firebase deploy --only firestore:rules
```

> **Phase 2 で `firestore.rules` を更新済み**。`tournaments/{tid}/players/{pid}` が参加者本人による自己作成を許容するように変更したため、ルールを再デプロイすること。未反映だと受付が `permission-denied` で失敗する。

### 6. Vercel にデプロイ

1. GitHub に本リポジトリを push
2. [Vercel](https://vercel.com/) で「Import Git Repository」から選択
3. 環境変数 `NEXT_PUBLIC_FIREBASE_*` と `NEXT_PUBLIC_LOG_LEVEL` を **Production / Preview** の両方に設定
4. `NEXT_PUBLIC_ENABLE_DEBUG=1` は **Preview のみ**に設定（Production は未設定で放置）。これにより本番 URL では `/debug/fs` が 404 になる
5. デプロイ後、Firebase Console → Authentication → 承認済みドメインに本番 URL を追加
6. Vercel Preview URL の `/debug/fs` で動作確認（本番 URL ではなく）

## よく使うコマンド

<!-- AUTO-GENERATED: scripts — source of truth は package.json scripts。追加・変更時はここも同期 -->
| コマンド | 用途 |
|---|---|
| `npm run dev` | 開発サーバ起動 (`next dev`) |
| `npm run build` | 本番ビルド (`next build`) |
| `npm run start` | 本番ビルドのローカル起動 (`next start`) |
| `npm run lint` | ESLint 実行 (`next lint`) |
| `npm run lint:fix` | 自動修正付き ESLint (`next lint --fix`) |
| `npm run typecheck` | TypeScript 型チェックのみ (`tsc --noEmit`) |
| `npm test` | Vitest 実行（単発、`vitest run`） |
| `npm run test:watch` | Vitest ウォッチモード (`vitest`) |
| `firebase deploy --only firestore:rules` | Firestore セキュリティルールのデプロイ（npm script ではなく firebase CLI）|
<!-- /AUTO-GENERATED -->

## ディレクトリ構成

<!-- AUTO-GENERATED: directory-tree — src/ ツリーの代表ディレクトリのみ。機能追加時はここを同期すること -->
```
src/
├─ app/                 # Next.js App Router
│  ├─ auth/email-link/  # Email Link コールバック
│  ├─ debug/fs/         # Firestore 疎通確認（Phase 5 で削除、ENABLE_DEBUG ゲート）
│  ├─ join/[tid]/       # 参加者向け受付（Google / ゲスト / ログイン / メールリンク）
│  ├─ login/            # 運営者ログイン / 新規登録 / メールリンク
│  ├─ settings/         # プロフィール編集（displayName 変更）
│  ├─ structures/       # ストラクチャプリセット CRUD
│  ├─ tournaments/      # トーナメント一覧 / 作成 / ダッシュボード / 編集
│  ├─ globals.css
│  ├─ layout.tsx        # AuthProvider でラップし AuthBadge を全画面上部に常設
│  └─ page.tsx
├─ components/
│  ├─ auth/             # RequireAuth / AuthBadge / GoogleIcon / LinkAccountDialog
│  ├─ qr/               # QrPanel（受付 URL + QR）
│  ├─ structure/        # StructureForm / LevelTable
│  ├─ tournament/       # TournamentForm / PlayerList
│  └─ ui/               # shadcn/ui
├─ lib/
│  ├─ errors.ts         # AppError 基底
│  ├─ logger.ts         # レベル制御付きロガー
│  ├─ utils.ts          # cn()
│  ├─ firebase/
│  │  ├─ AuthProvider.tsx
│  │  ├─ client.ts            # singleton 初期化（languageCode="ja" 固定）
│  │  ├─ converters.ts        # zod ベース withConverter
│  │  ├─ schemas/             # 各コレクションの zod schema（Firestore 真実源）
│  │  └─ repositories/        # Firestore CRUD 集約（UI から SDK を直接呼ばない）
│  └─ services/         # auth-actions / receipt / qr / redirect
└─ types/
   └─ tournament.ts     # Phase 2 以降は schemas/ 側を真実源とする
```
<!-- /AUTO-GENERATED -->

## 環境変数

<!-- AUTO-GENERATED: env-vars — source of truth は env.local.example。追加・変更時はここも同期 -->
ローカルでは `.env.local`（`env.local.example` をコピー）、本番／プレビューは Vercel の環境変数で管理。すべて `NEXT_PUBLIC_*` のためクライアントバンドルに含まれる前提（公開可能な値のみ）。

| 変数 | 必須 | 説明 |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Yes | Firebase Web SDK 設定（Console → Project settings → General → Web app）|
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Yes | 同上 |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Yes | 同上 |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Yes | 同上 |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Yes | 同上 |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Yes | 同上 |
| `NEXT_PUBLIC_LOG_LEVEL` | No | ログレベル。`debug` / `info`（既定） / `warn` / `error` |
| `NEXT_PUBLIC_ENABLE_DEBUG` | No | `/debug/fs` を有効化（local dev と Preview のみ `1`、Production は未設定）|
<!-- /AUTO-GENERATED -->

## 実装規約

- [.claude/rules/firebase-patterns.md](.claude/rules/firebase-patterns.md) — Firebase 初期化、認証購読、Firestore converter、セキュリティルール
- [.claude/rules/error-logging.md](.claude/rules/error-logging.md) — `AppError` ラップ、`logger` 経由のログ
- [.claude/rules/security.md](.claude/rules/security.md) — `.env.local` 管理、サークル固有情報の Firestore 限定保存

## ライセンス

MIT License — 詳細は [LICENSE](LICENSE) を参照。
