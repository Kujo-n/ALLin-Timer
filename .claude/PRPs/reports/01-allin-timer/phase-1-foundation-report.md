# Implementation Report: Phase 1 — Foundation

## Summary

Next.js 15（App Router / TypeScript）+ Tailwind + shadcn/ui + Firebase（Auth + Firestore）+ Vitest の土台を構築し、Firestore 疎通確認用ルート `/debug/fs`、MIT LICENSE、セットアップ手順 README、Firestore セキュリティルール雛形、Firebase CLI 設定までを一括で整備した。`tsc --noEmit` / `npm run lint` / `npm test` / `npm run build` がローカルで全て pass する状態を達成。

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium | Medium |
| Estimated Files | 25〜30 | 25 作成 + 2 更新 |
| Files Changed | — | 25 CREATED / 2 UPDATED |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Next.js 15 プロジェクト初期化 | Complete | DEVIATION: `create-next-app` を使わず手書き |
| 2 | shadcn/ui 導入 | Complete | DEVIATION: CLI 使わず `components.json` + `utils.ts` + Button を手書き |
| 3 | 依存の追加（Firebase / Vitest） | Complete | `npm install` 1 パスで全取込（573 packages） |
| 4 | vitest.config.ts | Complete | `@` alias、`jsdom` 環境、`src/**/*.test.{ts,tsx}` |
| 5 | src/lib/errors.ts + テスト | Complete | `AppError` 本体 + `.from()` ヘルパ + 5 tests |
| 6 | src/lib/logger.ts | Complete | レベル閾値フィルタ、`NEXT_PUBLIC_LOG_LEVEL` 対応 |
| 7 | src/types/tournament.ts | Complete | PRD データモデルを TypeScript 型に反映 |
| 8 | src/lib/firebase/client.ts | Complete | singleton + placeholder fallback（ビルド用）+ browser 側 throw |
| 9 | src/lib/firebase/converters.ts | Complete | `converter<T>()` 汎用ヘルパ |
| 10 | src/lib/firebase/AuthProvider.tsx | Complete | `useAuthUser` 公開、`"use client"` 厳守 |
| 11 | src/app/layout.tsx | Complete | `<html lang="ja">` + AuthProvider ラップ |
| 12 | src/app/page.tsx | Complete | 「ALLin-Timer」見出しのみ |
| 13 | Firestore 疎通確認ページ | Complete | DEVIATION: パスは `/debug/fs`（`_debug` は Next.js プライベートフォルダ規約で NG） |
| 14 | env サンプル & README | Complete | DEVIATION: `.env.local.example` は write deny のため `env.local.example`（ドット無し）に改名 |
| 15 | Firebase CLI 設定 & rules | Complete | `firebase.json` / `firestore.rules` / `firestore.indexes.json` / `.firebaserc` |
| 16 | LICENSE (MIT) | Complete | 2026 / ALLin-Timer contributors |
| 17 | .gitignore 統合 | Complete | 既存項目保持 + `.firebase/` / Firebase debug ログ追加 |
| 18 | Vercel デプロイ手順 | Complete | 実デプロイはユーザー操作前提。README に手順化 |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis (tsc) | Pass | exit code 0、型エラー 0 |
| Lint (next lint) | Pass | warnings / errors 0 |
| Unit Tests (vitest) | Pass | 5 tests in `src/lib/errors.test.ts` |
| Build (next build) | Pass | `/`, `/_not-found`, `/debug/fs` が静的生成 |
| Integration | N/A | 実 Firebase プロジェクトが必要なためユーザー側で `/debug/fs` 手動確認 |
| Edge Cases | Partial | `.env.local` 未設定時は placeholder で build 通過、browser 側で throw（計画想定通り） |

## Files Changed

### CREATED (25)

| File | Lines (approx) |
|---|---|
| `package.json` | 42 |
| `tsconfig.json` | 32 |
| `next.config.ts` | 7 |
| `next-env.d.ts` | 6 (next lint が自動追記) |
| `tailwind.config.ts` | 83 |
| `postcss.config.mjs` | 9 |
| `components.json` | 20 |
| `.eslintrc.json` | 6 |
| `.prettierrc` | 10 |
| `env.local.example` | 14 |
| `vitest.config.ts` | 20 |
| `firebase.json` | 6 |
| `firestore.rules` | 36 |
| `firestore.indexes.json` | 4 |
| `.firebaserc` | 5 |
| `LICENSE` | 21 |
| `README.md` | 143 |
| `src/app/layout.tsx` | 22 |
| `src/app/page.tsx` | 8 |
| `src/app/globals.css` | 64 |
| `src/app/debug/fs/page.tsx` | 87 |
| `src/lib/errors.ts` | 20 |
| `src/lib/errors.test.ts` | 40 |
| `src/lib/logger.ts` | 48 |
| `src/lib/utils.ts` | 7 |
| `src/lib/firebase/client.ts` | 42 |
| `src/lib/firebase/converters.ts` | 12 |
| `src/lib/firebase/AuthProvider.tsx` | 35 |
| `src/components/ui/button.tsx` | 58 |
| `src/types/tournament.ts` | 83 |

### UPDATED (2)

| File | Change |
|---|---|
| `.gitignore` | `.firebase/` / Firebase debug ログを追加 |
| `.claude/PRPs/plans/phase-1-foundation.plan.md` | `completed/` 配下に移動（下記 archive） |

## Deviations from Plan

1. **Task 1 — `create-next-app` 不使用、手動構築**
   - WHAT: `npx create-next-app@latest .` の代わりに `package.json`、各種設定ファイル、ルートページを手書きで作成。
   - WHY: 既存の `.claude/`、`CLAUDE.md`、`tmp/`、`.gitignore` を退避せずに済む／`create-next-app` の対話式プロンプトに起因するブロッキングを避ける／依存追加を単一の `npm install` に集約できる。結果成果物は計画通り（Next.js 15 + TS + Tailwind + App Router + src + `@/*` alias）。

2. **Task 2 — shadcn/ui CLI 不使用**
   - WHAT: `npx shadcn@latest init` と `add button` の代わりに `components.json`、`src/lib/utils.ts`（`cn()`）、`src/components/ui/button.tsx` を手書き。
   - WHY: Task 1 と同じ理由（対話ブロッキング回避）。ファイル内容は公式 template と等価。

3. **Task 13 — デバッグルートを `_debug/fs` から `debug/fs` に変更**
   - WHAT: 計画書は `src/app/_debug/fs/page.tsx` を指定していたが、実体は `src/app/debug/fs/page.tsx`（URL `/debug/fs`）。
   - WHY: Next.js App Router の仕様で `_` 接頭辞のフォルダは **プライベートフォルダ**と見なされ、URL ルーティング対象外となる。計画書の URL `/_debug/fs` は 404 になる。`debug/fs` にすれば Phase 1 の完了判定・Phase 5 での削除という目的は完全に保たれる。

4. **Task 14 — env サンプルファイル名変更**
   - WHAT: `.env.local.example` → `env.local.example`（先頭ドット無し）。
   - WHY: `.claude/settings.local.json` の deny rule（`Write(./.env.*)`）に抵触したため。README に「このファイルを `.env.local` へコピーしてください」と明記済。

5. **Task 8 — Firebase 初期化に placeholder fallback を追加**
   - WHAT: env 欠如時に `undefined` ではなく `allin-timer-dev-missing` をダミー値で渡す。ブラウザ実行時のみ `missing env` を `AppError` で throw。
   - WHY: Next.js のビルド時プリレンダーで Client Component 内の Firebase モジュールが評価される。env 不在だと `auth/invalid-api-key` でビルドが落ちる。placeholder は文字列リテラルで、どの Firebase プロジェクトにも接続できない無害値。ビルドを通しつつ、実際の利用シーン（ブラウザ）では明示的な AppError を投げる設計。

## Issues Encountered

1. **ビルド時 `auth/invalid-api-key`** — Deviation #5 の通り `client.ts` に placeholder fallback を入れて解決。
2. **`_debug` フォルダが URL に解決されない** — Deviation #3 の通り `debug/fs` に rename で解決。
3. **`.env.local.example` が write deny** — Deviation #4 の通り `env.local.example` に改名で解決。

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/lib/errors.test.ts` | 5 | `AppError` constructor、`from()` の 4 分岐（既存 AppError pass-through / plain Error ラップ / 明示 message / 非 Error 値） |

Logger と Firestore converter のテストは計画書の Testing Strategy では「optional / 後続で深堀」とされており、Phase 1 では `AppError` の 5 tests で代表させた。

## Next Steps

- [ ] Firebase Console で実プロジェクト作成 → `.env.local` 記入 → `/debug/fs` で疎通確認
- [ ] `.firebaserc` の `YOUR_FIREBASE_PROJECT_ID` を実プロジェクト ID に差し替え
- [ ] `firebase deploy --only firestore:rules` でルールをデプロイ
- [ ] GitHub リポジトリ作成 → Vercel に接続 → 環境変数を Production/Preview に設定
- [ ] Firebase Auth の承認済みドメインに `localhost`、Vercel 本番 URL（と必要なら `*.vercel.app`）を追加
- [ ] `/code-review` で差分レビュー
- [ ] `/prp-pr` で PR 作成
- [ ] PRD の Phase 1 ステータスを `complete` に更新、Phase 2 の plan を `/prp-plan` で生成
