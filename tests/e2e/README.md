# E2E Tests

Phase 4.5 以降で導入した Playwright + Firebase Emulator 構成の E2E テスト。

## 前提

| 項目                  | 必要バージョン                  |
| --------------------- | ------------------------------- |
| Node.js               | 20+（`package.json` と合わせる） |
| `@playwright/test`    | devDependency にインストール済み |
| Playwright Chromium   | `npx playwright install chromium` で取得 |
| Firebase CLI          | 15.x（`firebase --version` で確認） |
| **Java 11+**          | Firestore Emulator に必須         |

Java が未インストールの場合は [Adoptium Temurin](https://adoptium.net/) を推奨。
Windows なら `winget install EclipseAdoptium.Temurin.17.JDK` で入る。

## 実行

### 一発実行（推奨）

```bash
npm run test:e2e
```

`playwright.config.ts` の `webServer` 配列が以下を自動起動・自動終了します:

1. `firebase emulators:start --only auth,firestore,ui --project allin-pokertimer-e2e`
2. `next dev -p 3001`（`NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true` 付き）
3. Playwright tests 実行（Chromium、worker=1）

### デバッグ系

```bash
npm run test:e2e:ui       # Playwright UI Runner（推奨デバッグ手段）
npm run test:e2e:headed   # ヘッドフル Chromium で観察
npm run test:e2e:debug    # PWDEBUG=1 inspector 起動
```

### Emulator だけを単独起動（開発中の手動確認用）

```bash
npm run emulator
# → http://127.0.0.1:4000 で Emulator UI が開く
```

別ターミナルで dev server を `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true` で起動すれば、
ブラウザで手動確認しつつ Firestore / Auth のデータは emulator へ隔離できる。

## 構成

```
tests/e2e/
├── pages/                 # Page Object Model
│   ├── BasePage.ts
│   ├── TopPage.ts
│   ├── LoginPage.ts
│   ├── GroupsPage.ts
│   ├── TournamentsPage.ts
│   └── JoinPage.ts
├── fixtures/
│   ├── emulator.ts        # Emulator REST API ヘルパ（reset / listUsers / getDocument）
│   ├── flows.ts           # UI 経由のセットアップフロー
│   └── test-context.ts    # Playwright カスタム fixture（autoReset + POM 注入）
├── email-link-removed.spec.ts
├── organizer-self-join.spec.ts
├── winner-banner-and-auto-finish.spec.ts
├── anonymous-self-delete.spec.ts
├── groups-navigation.spec.ts
├── displayname-propagation.spec.ts  # Phase 4.5: displayName 伝播 / 15 文字制約
├── member-role-split.spec.ts        # Phase 4.6: 一般メンバーの role gate / ワンタップ参加
└── structure-templates.spec.ts      # Phase 4.8: Structure Templates の作成 / 適用 / 削除導線
```

## テスト間の隔離

`fixtures/test-context.ts` の `autoResetEmulator` fixture が `auto: true` で全テスト前に発火し、
`resetFirestore` + `resetAuth` で Emulator 状態を完全初期化します。これにより:

- テスト間で `users/{uid}` や `tournaments/{tid}` が残らない
- 匿名 uid の衝突が起きない
- `worker=1`（`playwright.config.ts`）と合わせて決定論的に動作

## 新しい spec を追加する場合

1. `pages/` に POM を追加 / 既存を拡張
2. `fixtures/flows.ts` で再利用できるフローを共通化
3. `tests/e2e/*.spec.ts` として新設
4. `test` は `./fixtures/test-context` から import（Emulator 自動 reset が付く）

## トラブルシュート

### `Error: browserType.launch: Executable doesn't exist`

Chromium バイナリ未インストール。`npx playwright install chromium` を実行。

### `Error: cannot start firebase emulator (Java not found)`

Java 11+ をインストール。`java -version` で確認できなければ Temurin をどうぞ。

### `NEXT_PUBLIC_FIREBASE_* is missing` ランタイム例外

Emulator 起動時の env 注入は `playwright.config.ts` の `webServer[].env` で行っている。
手動で dev server を起動する場合、同じ env を `$env:NEXT_PUBLIC_USE_FIREBASE_EMULATOR="true"`
等で設定すること。

### Emulator UI の port (4000) が空かない

`playwright.config.ts` の `reuseExistingServer: !process.env.CI` により、ローカルでは既存の
emulator を使い回す。占有中ならそのまま流用される。ポート競合が疑わしい場合は `firebase
emulators:stop`（Ctrl+C）後に再実行。

### テストが flaky

- `await expect.poll(...)` のタイムアウトが短すぎる可能性: Firebase snapshot 伝搬は
  ローカル Emulator でも数百 ms〜数秒揺れる
- `page.context().browser()?.newContext()` で作った context の `close()` 忘れが残留を起こす
  場合あり → test 末尾で必ず close
