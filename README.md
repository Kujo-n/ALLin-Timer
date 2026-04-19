# ALLin-Timer

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
git clone https://github.com/<your-account>/ALLin-Timer.git
cd ALLin-Timer
npm install
```

### 2. Firebase プロジェクトの作成

1. [Firebase Console](https://console.firebase.google.com/) で新規プロジェクトを作成（Google Analytics は任意）
2. **Authentication** → 「Sign-in method」から以下 3 方式を有効化
   - 匿名
   - メール / パスワード
   - メールリンク（パスワードなしでのログイン）
3. **Authentication** → 「Settings」→「承認済みドメイン」に以下を追加
   - `localhost`（開発用）
   - Vercel 本番 URL（例: `allin-timer.vercel.app`）
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

- <http://localhost:3000/> で「ALLin-Timer」見出しが表示されれば OK
- <http://localhost:3000/debug/fs> で [書込] → [一覧] を押し、作成したドキュメント ID が表示されれば Firestore 疎通 OK

> `/debug/fs` は Phase 1 の疎通確認用ページです。本番公開を避けるため `NEXT_PUBLIC_ENABLE_DEBUG=1` が設定されている環境でのみ表示されます（未設定なら 404）。Phase 5 で削除予定。

### 5. Firestore セキュリティルールのデプロイ

```bash
npm install -g firebase-tools  # 初回のみ
firebase login
# .firebaserc の projectId を自分の Firebase プロジェクト ID に書き換えてから:
firebase deploy --only firestore:rules
```

### 6. Vercel にデプロイ

1. GitHub に本リポジトリを push
2. [Vercel](https://vercel.com/) で「Import Git Repository」から選択
3. 環境変数 `NEXT_PUBLIC_FIREBASE_*` と `NEXT_PUBLIC_LOG_LEVEL` を **Production / Preview** の両方に設定
4. `NEXT_PUBLIC_ENABLE_DEBUG=1` は **Preview のみ**に設定（Production は未設定で放置）。これにより本番 URL では `/debug/fs` が 404 になる
5. デプロイ後、Firebase Console → Authentication → 承認済みドメインに本番 URL を追加
6. Vercel Preview URL の `/debug/fs` で動作確認（本番 URL ではなく）

## よく使うコマンド

| コマンド | 用途 |
|---|---|
| `npm run dev` | 開発サーバ起動 |
| `npm run build` | 本番ビルド |
| `npm run start` | 本番ビルドのローカル起動 |
| `npm run lint` | ESLint 実行 |
| `npm run lint:fix` | 自動修正付き ESLint |
| `npm run typecheck` | TypeScript 型チェックのみ |
| `npm test` | Vitest 実行（単発） |
| `npm run test:watch` | Vitest ウォッチモード |
| `firebase deploy --only firestore:rules` | Firestore セキュリティルールのデプロイ |

## ディレクトリ構成

```
src/
├─ app/                 # Next.js App Router
│  ├─ debug/fs/         # Firestore 疎通確認ページ（Phase 5 で削除、ENABLE_DEBUG ゲート）
│  ├─ globals.css
│  ├─ layout.tsx        # AuthProvider でラップ
│  └─ page.tsx
├─ components/ui/       # shadcn/ui
├─ lib/
│  ├─ errors.ts         # AppError 基底
│  ├─ logger.ts         # レベル制御付きロガー
│  ├─ utils.ts          # cn()
│  └─ firebase/
│     ├─ AuthProvider.tsx
│     ├─ client.ts      # singleton 初期化
│     └─ converters.ts  # withConverter 用
└─ types/
   └─ tournament.ts
```

## 実装規約

- [.claude/rules/firebase-patterns.md](.claude/rules/firebase-patterns.md) — Firebase 初期化、認証購読、Firestore converter、セキュリティルール
- [.claude/rules/error-logging.md](.claude/rules/error-logging.md) — `AppError` ラップ、`logger` 経由のログ
- [.claude/rules/security.md](.claude/rules/security.md) — `.env.local` 管理、サークル固有情報の Firestore 限定保存

## ライセンス

MIT License — 詳細は [LICENSE](LICENSE) を参照。
