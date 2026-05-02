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
2. **Authentication** → 「Sign-in method」から以下 3 方式を有効化
   - 匿名
   - メール / パスワード
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

### 運営者 / 参加者フロー（Phase 2.5）

- **運営者**: `/login` でログイン → **`/groups/new` でサークル（group）を作成**または **招待コードのリンクを踏んで加入** → 自動的にそのサークルが「現在のサークル」となる → `/structures` でプリセット作成 → `/tournaments/new` でトーナメント作成 → `/tournaments/[tid]` ダッシュボードで受付 URL / QR をコピーし参加者に共有
- ストラクチャ／トーナメントは「現在のサークル」配下に紐づき、**メンバー全員で共有・編集・開始・削除可能**。当日プレイヤー兼任の運営者が複数いても相互に代替操作できる。
- **参加者**: 配布された `/join/[tid]` URL から 3 つのいずれかで受付
  - **Google で参加**: ポップアップでアカウント選択するだけで完了（displayName は Google プロフィールを自動利用）
  - (a) ログイン: 既存メール+PW アカウント
  - (b) ゲスト: 表示名のみ（匿名 Auth）— トーナメント終了 / キャンセル / ログアウト時に Firebase Auth と `users/{uid}` を自動削除（Phase 4.5）

### 受付方式ごとの「次回以降のログイン」と「端末跨ぎ」

| 登録方式                  | パスワード        | 端末跨ぎ                                                          | 次回アクセス方法                                                 |
| ------------------------- | ----------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| Google                    | なし（Google 側） | **可能**（同じ Google アカウントで各端末からログイン → 同一 uid） | `/login` または `/join/[tid]` の「Google でログイン/参加」ボタン |
| (a) ログイン（メール+PW） | あり              | **可能**（同じメール+PW で PC/スマホ両方ログイン → 同一 uid）     | `/login` タブ「ログイン」                                        |
| (b) ゲスト（匿名 Auth）   | なし              | **不可**（端末ごとに別 uid が発行される）                         | 同一端末のセッション維持のみ。別端末からは別ゲスト扱い           |

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
- `/join/[tid]` ゲスト: 表示名必須
- `/join/[tid]` ログイン／このアカウントで受付: 既存プロフィールの displayName を利用（未設定なら `validation/display-name-required` エラー）

受付時の displayName 解決優先順位: フォーム入力 → `users/{uid}` プロフィール → Firebase Auth プロフィール → エラー。
これにより別端末でログインしても displayName が保持され、参加者一覧表示がブレない。

> displayName なしで登録された既存アカウントが join で `validation/display-name-required` を踏んだ場合は、`/settings` から表示名を設定して再度参加してください。

### 5. Firestore セキュリティルール / インデックスのデプロイ

```bash
npm install -g firebase-tools  # 初回のみ
firebase login
# .firebaserc の projectId を自分の Firebase プロジェクト ID に書き換えてから:
firebase deploy --only firestore:rules,firestore:indexes
```

> **Phase 2.5 で `firestore.rules` を全面刷新**。`groups/{gid}` / `groupJoinCodes/{code}` を新規追加し、`structures` / `tournaments` の所有モデルが `ownerUid` 個人所有から **`groupId` ＋ group メンバーシップ共有所有** に変更されている。ルール再デプロイ後は **旧 `ownerUid` ベースのドキュメントは読めなくなる**ので、Firebase Console から旧 collection をクリーンアップすること（後述）。

> **Phase 5.1 で `firestore.indexes.json` に collection-group index を追加**。サイドバー「参加中のトーナメント」section（`subscribePlayersByUid`）が `collectionGroup("players").where("uid", "==", uid)` を発行するため、`players.uid` の collection-group scope index が必要。`firestore:indexes` を含めずに `firestore:rules` だけデプロイすると、本番でクエリが `failed-precondition` で reject されサイドバーが silent failure（空表示）になる。本番反映は Firebase Console → Firestore → Indexes で「Building → Enabled」を確認する。

### サークル（group）運用

Phase 2.5 から、ストラクチャ／トーナメントは **「サークル（group）」単位で共有**されるようになった。複数の運営者でサークルを共有することで、当日プレイヤー兼任の運営者が誰でも開始／削除／編集を実行できる。

#### 標準フロー

1. **オーナーがサークル作成**: `/login` → `/groups/new` でサークル名を入力（最大 60 文字）→ 自動的にそのサークルが選択される
2. **招待コードを発行**: `/groups/[gid]` の「招待コードを発行」ボタンで 7 日有効の URL（`/groups/join/[code]`）を生成 → 口頭／チャットで運営者に共有
3. **運営者が加入**: 共有された URL を踏むだけで自動加入。加入後は「現在のサークル」が切り替わる
4. **共有開始**: `/structures` / `/tournaments` がサークル配下の共有データに切り替わる。誰が作ったストラクチャでもメンバー全員が編集できる

#### サークル切替

複数のサークルに所属する場合は、ヘッダ右上のサークル名（`<select>` UI）から切替可能。`/structures` / `/tournaments` の一覧は「現在のサークル」のものに即座に入れ替わる。  
ブラウザ内 `localStorage.allinpt.currentGroupId` に永続化される（デバッグ時はこの key を消すと再選択フローに戻る）。

#### Phase 2.5 移行手順（破壊的・運用者向け）

Phase 2 までで作成した `structures` / `tournaments` には `groupId` が無いため、Phase 2.5 の rule をデプロイすると読めなくなる（client から見ると一覧が空、`getDoc` が `firestore/invalid-data` を返す可能性あり）。**互換レイヤは作らない方針** のため、以下を手動で行う。

1. `firebase deploy --only firestore:rules` の前に **Firebase Console → Firestore → データ** から旧コレクション（`structures` と `tournaments` 配下のすべてのドキュメント）を削除
2. ルールデプロイ
3. アプリで `/groups/new` から新規サークル作成 → `/structures/new` ／ `/tournaments/new` を最初から作り直す

> 削除前にデータを残したい場合は Firebase Console の `データのエクスポート` で先にバックアップを取得すること。Phase 2.5 開始時点では本番運用が無い前提のため、移行スクリプトは用意していない。

#### Phase 4.6 での変更点（3 階層ロール）

Phase 4.6 でメンバーを 3 階層に分割した（スキーマ破壊的変更・互換レイヤなし、Phase 2.5 と同じ方針）。

| ロール | 権限 |
| ------ | ---- |
| **owner** | サークルの名前変更・削除・ロール昇降格ができる最上位。複数人設定可 |
| **organizer**（運営） | structures / tournaments / 招待コードの CRUD、トーナメント進行操作 |
| **member**（一般） | トーナメント一覧閲覧 / 参加、structures 閲覧のみ（編集不可） |

- 招待コードから加入すると**デフォルトで一般メンバー**。運営昇格は owner が `/groups/[gid]` 画面から実施
- `organizer` → `owner` の昇格も owner が実施（直接 `member` → `owner` は不可）
- 最後のオーナーは降格 / 脱退不可
- 一般メンバーが `/tournaments/[tid]` を直接踏んでも自動的に `/live` にリダイレクトされる

##### Phase 4.6 移行手順（Phase 2.5 と同じく全消去パス）

`groups/{gid}` の旧 `ownerUid: string` は新 rules + zod schema では読めなくなる。**本番運用開始前の段階では全消去が最もシンプルかつ安全**（Phase 2.5 の先例に従う）:

1. **Firebase Console → Firestore → データ** から以下の top-level collection を全ドキュメント削除:
   - `groups`
   - `groupJoinCodes`
   - `structures`
   - `tournaments`（配下の `players` / `tables` サブコレクション含む）
   - `users`
2. **Firebase Console → Authentication → Users** から全ユーザを削除（`users/{uid}.groupIds` との drift 防止）
3. rules をデプロイ:
   ```bash
   firebase deploy --only firestore:rules
   ```
4. アプリから新規登録 → `/groups/new` で新しいサークルを作り直す

> 消す前に `Firestore → Import/Export` で backup を取るのを推奨（復旧用途というより「あのストラクチャどうだったっけ」の参照用）。

##### 既存データを保持したい場合（本番投入後の再 migration 用）

本番投入後で既存 `groups` を保持したまま移行する必要が出たら、[scripts/migrate-phase-4.6-roles.ts](scripts/migrate-phase-4.6-roles.ts) を参考に admin SDK スクリプトを実行する。**現状（Phase 4.6 デプロイ時）は全消去パスを推奨**するため、本スクリプトは予備実装として残置しているだけ（実行前に dry-run 必須）。

#### 制約事項

- サークルを削除しても配下の `structures` / `tournaments` は **削除されない**（誰からも見えなくなるだけ）。先に各画面で配下データを削除しておくのが安全。
- 招待コードはコード文字列の発行のみ。メール招待リンク送信は範囲外（Phase 5 以降の検討）。
- Phase 4.6 では招待コードは 1 種類のみ（「運営専用コード」はなし）。加入後に owner が手動で昇格させる前提。

### 5.5. Phase 4.8: テンプレート管理者の bootstrap

Phase 4.8 でサークル横断の **Structure Templates**（`structureTemplates`）を導入した。作成者脱会後のテンプレ整理のために、**最初の管理者は Firestore Console で手動作成**する必要がある（Firestore Security Rules が管理者の create を「既存管理者による操作」に限定しており、chicken-and-egg を避けるため）。

1. Firebase Console で対象プロジェクトの Firestore を開く
2. コレクション ID: `templateAdmins` を作成（初回のみ）
3. ドキュメント ID: 最初の管理者の **`uid`**（Authentication タブで確認）
4. フィールド: `createdAt` (timestamp, 現在時刻)
5. 保存

この 1 回の操作を行わないと、**作成者不明のテンプレートを誰も削除できない状態**で運用が始まる（作成者脱会後のクリーンアップ手段がなくなる）。本 Phase では管理者の grant / revoke UI は未実装。

##### 制約事項（Phase 4.8）

- テンプレート作成は匿名ユーザー不可（`createdByDisplayName` の信頼性担保のため、通常アカウント必須）
- `createdByDisplayName` は作成時の snapshot。作成者が `/settings` で rename しても既存テンプレの表示名は追従しない
- テンプレ削除は本人または管理者のみ。**最後の管理者が 0 人になると Console で再 seed するまで復旧できない**

### 5.6. Phase 4.9: サウンド通知

ブラインドレベル変更／優勝者確定の 2 イベントで音声通知を再生する。デフォルト音源（`public/sounds/blind-up.{mp3,ogg}` / `victory-chime.{mp3,ogg}`）が同梱されているため追加セットアップは不要。

- **再生対象**: `/tournaments/[tid]` ダッシュボード（運営者）／ `/tournaments/[tid]/live` ライブビュー（運営者投影）。**owner / organizer ロールのみ再生**（一般メンバーには無音）
- **設定画面**: `/groups/[gid]/audio-settings` で on/off・音量・試聴を切替（owner / organizer のみアクセス可）。group 詳細画面のボタンから遷移
- **autoplay unlock**: ブラウザ仕様により最初のユーザー操作が必要。画面上部の `SoundUnlockBanner` で「サウンドを有効化」を 1 回タップすれば以降同一タブで自動再生される
- **データ**: `groups/{gid}.audioSettings`（zod additive 拡張）に保持。Firestore Rules で organizer 以上のみ書換可

### 5.7. Phase 5.1: PD（プレイングディーラー）モデル

ディーラー兼任プレイヤー（PD = Playing Dealer）を 1 卓 1 名まで指定できるモデルを導入した。受付（setup）中に PlayerList のチェックボックス、席決め後（seating / running / paused）に SeatingBoard の各席チェックボックスから ON/OFF できる。

- **席 1 固定**: PD 指定者は所属卓の席 1 に強制配置（初回席決め時の事前配分 + 後付け ON 時の rotation）。元の席 1〜PD 席 -1 の player は 1 つずつ後ろへシフト、PD 席より後ろは不変
- **同卓 1 PD**: UI 側で他席の checkbox を disabled、service tx 内でも同卓に既 PD があれば `seating/pd-already-set` AppError で拒否（二重防御）
- **バランシング除外**: `planBalancingMove` は PD を移動候補から除外する。過剰卓が PD だけだとバランシング不能 (null) になるが、1 卓 1 PD 制約下で実質発生しない
- **bust 自動 OFF**: バスト記録時、当該 player + 同卓 PD（最大 1 名）の `isPlayingDealer=false` を batch で書込む
- **卓閉鎖自動 OFF（要注意）**: `applyTableBreak` は閉鎖卓 player の `isPlayingDealer=false` を強制リセット。**閉鎖前に PD だった player は移動先で PD のまま残らない**ので、必要なら移動先で再度 ON にする（同卓 PD と衝突しないようにする設計上の選択）
- **データ**: `tournaments/{tid}/players/{pid}.isPlayingDealer: boolean`（zod additive、default false）。Firestore Rules で self は immutable / organizer は bool 型のみ書込可（同卓 1 PD 制約は rule では表現困難なため service tx で担保）
- **rule 検証**: [scripts/test-rules-pd.mjs](scripts/test-rules-pd.mjs) を `firebase emulators:exec --only auth,firestore "node scripts/test-rules-pd.mjs"` で実行（手動・CI 対象外）

### 6. Vercel にデプロイ

1. GitHub に本リポジトリを push
2. [Vercel](https://vercel.com/) で「Import Git Repository」から選択
3. 環境変数 `NEXT_PUBLIC_FIREBASE_*` と `NEXT_PUBLIC_LOG_LEVEL` を **Production / Preview** の両方に設定
4. `NEXT_PUBLIC_ENABLE_DEBUG=1` は **Preview のみ**に設定（Production は未設定で放置）。これにより本番 URL では `/debug/fs` が 404 になる
5. デプロイ後、Firebase Console → Authentication → 承認済みドメインに本番 URL を追加
6. Vercel Preview URL の `/debug/fs` で動作確認（本番 URL ではなく）

## よく使うコマンド

<!-- AUTO-GENERATED: scripts — source of truth は package.json scripts。追加・変更時はここも同期 -->

| コマンド                                 | 用途                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| `npm run dev`                            | 開発サーバ起動 (`next dev`)                                                         |
| `npm run build`                          | 本番ビルド (`next build`)                                                           |
| `npm run start`                          | 本番ビルドのローカル起動 (`next start`)                                             |
| `npm run lint`                           | ESLint 実行 (`next lint`)                                                           |
| `npm run lint:fix`                       | 自動修正付き ESLint (`next lint --fix`)                                             |
| `npm run typecheck`                      | TypeScript 型チェックのみ (`tsc --noEmit`)                                          |
| `npm test`                               | Vitest 実行（単発、`vitest run`）                                                   |
| `npm run test:watch`                     | Vitest ウォッチモード (`vitest`)                                                    |
| `npm run test:e2e`                       | Playwright E2E テスト実行（emulator と dev server を自動起動）                      |
| `npm run test:e2e:ui`                    | Playwright UI モード（`playwright test --ui`）                                      |
| `npm run test:e2e:headed`                | ヘッドレス無効で E2E 実行（`playwright test --headed`）                             |
| `npm run test:e2e:debug`                 | Playwright inspector で E2E デバッグ（`playwright test --debug`）                   |
| `npm run emulator`                       | Firebase Emulator (auth + firestore + ui) のみ起動（`allin-pokertimer-e2e` 隔離）   |
| `npm run format`                         | Prettier で書式修正 (`prettier --write .`)                                          |
| `npm run format:check`                   | Prettier で書式チェックのみ (`prettier --check .`)                                  |
| `firebase deploy --only firestore:rules` | Firestore セキュリティルールのデプロイ（npm script ではなく firebase CLI）          |

<!-- /AUTO-GENERATED -->

## E2E テスト（Phase 4.5 以降）

Playwright + Firebase Emulator で統合テストを自動化している。`npm run test:e2e` を叩けば Emulator → dev server（port 3001）→ test 実行まで一気通貫で走る。Emulator 起動には **Java ランタイム**が必要（未インストールだと `firestore` / `auth` が起動失敗）。

- 設定: [playwright.config.ts](playwright.config.ts)
- 詳細（Page Object 構成・前提条件・トラブルシュート）: [tests/e2e/README.md](tests/e2e/README.md)
- `allin-pokertimer-e2e` という Firebase プロジェクト名で **実 Firebase プロジェクトと隔離**されているため、Emulator 内のデータは本番／開発の Firestore には影響しない

## ディレクトリ構成

<!-- AUTO-GENERATED: directory-tree — src/ ツリーの代表ディレクトリのみ。機能追加時はここを同期すること -->

```
src/
├─ app/                           # Next.js App Router
│  ├─ debug/fs/                   # Firestore 疎通確認（Phase 5 で削除、ENABLE_DEBUG ゲート）
│  ├─ groups/                     # サークル一覧 / 作成 / 詳細 / 招待コードによる加入（Phase 2.5）
│  │                              # / [gid]/audio-settings（サウンド設定、Phase 4.9）
│  ├─ join/[tid]/                 # 参加者向け受付（Google / ゲスト / ログイン）
│  ├─ login/                      # 運営者ログイン / 新規登録
│  ├─ settings/                   # プロフィール編集（displayName 変更）
│  ├─ structures/                 # ストラクチャプリセット CRUD（group メンバーで共有）
│  ├─ templates/                  # Structure Templates（サークル横断のストラクチャ図書館、Phase 4.8）
│  ├─ tournaments/                # トーナメント一覧 / 作成 / ダッシュボード / 編集（group メンバーで共有）
│  │  └─ [tid]/live/              # 参加者ライブビュー（タイマー / 自席表示 / 移動通知 / Winner バナー）
│  ├─ globals.css
│  ├─ layout.tsx                  # AuthProvider + GroupProvider + NavStateProvider でラップし
│  │                              # HeaderMenuButton + AuthBadge + AppShell を常設（Phase 4.13）
│  └─ page.tsx                    # 未ログイン時はログインボタンのみ、ログイン後はサークル/トーナメント導線（Phase 4.5）
├─ components/
│  ├─ audio/                      # SoundUnlockBanner（AudioContext unlock 導線、Phase 4.9）
│  ├─ auth/                       # RequireAuth / RequireGroup / AuthBadge / GoogleIcon
│  │                              # / LinkAccountDialog / DisplayNameDialog
│  ├─ nav/                        # AppShell / HeaderMenuButton / PrimaryNav / nav-state（Phase 4.13 ナビ刷新）
│  ├─ qr/                         # QrPanel（受付 URL + QR）
│  ├─ structure/                  # StructureForm / LevelTable
│  │                              # / StructureTemplateCard / StructureTemplatePicker（Phase 4.8）
│  ├─ tournament/                 # TournamentForm / PlayerList / TimerDisplay / TimerControls / WinnerBanner
│  │                              # / BustButton / SeatingBoard / BalancingInstructionCard
│  │                              # / AverageStackCard / ConnectionBadge / NextBreakCard
│  │                              # / PlayersCard / StructureSnapshotCard / SoundToggleButton（Phase 4.13）
│  └─ ui/                         # shadcn/ui
├─ lib/
│  ├─ errors.ts                   # AppError 基底
│  ├─ logger.ts                   # レベル制御付きロガー
│  ├─ utils.ts                    # cn()
│  ├─ audio/                      # audio-context（Web Audio API ラッパ）/ sound-catalog（既定音源、Phase 4.9）
│  ├─ firebase/
│  │  ├─ AuthProvider.tsx
│  │  ├─ client.ts                # singleton 初期化（languageCode="ja" 固定、E2E 時は Emulator 接続）
│  │  ├─ converters.ts            # zod ベース withConverter
│  │  ├─ schemas/                 # 各コレクションの zod schema（Firestore 真実源）
│  │  │                           # group / groupJoinCode / structure / structureTemplate / templateAdmin
│  │  │                           # / tournament / player / table / user
│  │  └─ repositories/            # Firestore CRUD 集約（UI から SDK を直接呼ばない）
│  │                              # groups / groupJoinCodes / structures / structureTemplates
│  │                              # / templateAdmins / tournaments / players / tables / users
│  ├─ hooks/                      # useTournamentTimer / useSeatingAutoOrchestrator
│  │                              # / useIsTemplateAdmin / useAudioPlayer（Phase 4.9）
│  └─ services/                   # auth-actions / receipt / qr / redirect / group / current-group / timer
│     └─ seating/                 # engine（純粋関数の TDA バランシング）/ orchestrator（Firestore 副作用）/ prng
scripts/
└─ migrate-phase-4.6-roles.ts     # Phase 4.6 admin SDK migration（本番運用 group 向けの予備実装）
tests/
└─ e2e/                           # Playwright + Firebase Emulator ベースの E2E（Phase 4.5）
```

<!-- /AUTO-GENERATED -->

## 環境変数

<!-- AUTO-GENERATED: env-vars — source of truth は env.local.example。追加・変更時はここも同期 -->

ローカルでは `.env.local`（`env.local.example` をコピー）、本番／プレビューは Vercel の環境変数で管理。すべて `NEXT_PUBLIC_*` のためクライアントバンドルに含まれる前提（公開可能な値のみ）。

| 変数                                       | 必須 | 説明                                                                       |
| ------------------------------------------ | ---- | -------------------------------------------------------------------------- |
| `NEXT_PUBLIC_FIREBASE_API_KEY`             | Yes  | Firebase Web SDK 設定（Console → Project settings → General → Web app）    |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`         | Yes  | 同上                                                                       |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID`          | Yes  | 同上                                                                       |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`      | Yes  | 同上                                                                       |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Yes  | 同上                                                                       |
| `NEXT_PUBLIC_FIREBASE_APP_ID`              | Yes  | 同上                                                                       |
| `NEXT_PUBLIC_LOG_LEVEL`                    | No   | ログレベル。`debug` / `info`（既定） / `warn` / `error`                    |
| `NEXT_PUBLIC_ENABLE_DEBUG`                 | No   | `/debug/fs` を有効化（local dev と Preview のみ `1`、Production は未設定） |

> `NEXT_PUBLIC_USE_FIREBASE_EMULATOR` は E2E テスト時に Playwright が自動で設定する変数で、`.env.local` には記載しない（`true` のとき Auth 9099 / Firestore 8080 の Emulator に接続）。

<!-- /AUTO-GENERATED -->

## 実装規約

- [.claude/rules/firebase-patterns.md](.claude/rules/firebase-patterns.md) — Firebase 初期化、認証購読、Firestore converter、セキュリティルール
- [.claude/rules/error-logging.md](.claude/rules/error-logging.md) — `AppError` ラップ、`logger` 経由のログ
- [.claude/rules/security-base.md](.claude/rules/security-base.md) — 公開リポジトリ運用、サークル固有情報の Firestore 限定保存、依存追加 ask モード（常時適用）
- [.claude/rules/security-env.md](.claude/rules/security-env.md) — `.env.local` 管理、`NEXT_PUBLIC_*` 扱い（`.env*` / `next.config.*` / `firebase/client.ts` 編集時）
- [.claude/rules/group-membership.md](.claude/rules/group-membership.md) — group ベース所有権モデル（Phase 2.5）

## ライセンス

MIT License — 詳細は [LICENSE](LICENSE) を参照。
