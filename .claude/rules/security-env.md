---
applyAlways: false
applyOnPaths:
  - ".env*"
  - "next.config.*"
  - "vercel.json"
  - "src/lib/firebase/client.ts"
applyOnPathsExclude:
  - "**/*.test.{ts,tsx}"
---

# 環境変数規約

`.env*` / `next.config.*` / Firebase 初期化など、**機密性のある環境変数を扱うパス**でのみ適用する規約。
公開リポジトリ運用全般・コミット前チェックなど universal な規約は [security-base.md](security-base.md) を参照。

## 適用範囲

- **対象**: `.env*`, `next.config.*`, `vercel.json`, `src/lib/firebase/client.ts`
- **除外**: `**/*.test.{ts,tsx}`
- **対象外（include に含まれない）**:
  - `src/lib/logger.ts` — `process.env.NODE_ENV` 等の非機密フラグ参照のみ
  - `src/app/api/og/_lib/og-image-fetch.ts` — `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` を
    背景画像 URL の allowlist 判定に参照するのみ（公開値・秘密を持たない）
  - 新規に `process.env.*` を追加する場合は、本ファイルを Read してから作業すること

## 環境変数の管理

- Firebase 認証情報（`NEXT_PUBLIC_FIREBASE_*` 等）は **`.env.local`（gitignore 済み）と Vercel 環境変数の両方で管理**
- `.env` / `.env.production` / `.env.*.local` はすべて gitignore 対象（`.gitignore` 済み）
- `NEXT_PUBLIC_*` プレフィックス付き変数はクライアントバンドルに含まれる前提で扱う（公開可能な値のみ）
- サーバ専用の秘密（Service Account Key 等）は `NEXT_PUBLIC_*` を**絶対に付けない**

## 関連

- 公開リポジトリ運用全般: [security-base.md](security-base.md)
- Firebase 初期化 singleton 設計: [firebase-patterns.md](firebase-patterns.md)
