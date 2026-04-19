# Implementation Report: Phase 2 — Tournament Setup & Receipt

## Summary

Phase 2 で運営者がトーナメントを作成し、参加者を集められる状態を作った。
- `/login` でメール + PW ログイン／新規登録
- `/structures` でストラクチャプリセット CRUD
- `/tournaments` でトーナメント CRUD（setup 限で編集／削除）
- `/tournaments/[tid]` ダッシュボードで QR / 受付 URL / 参加者一覧
- `/join/[tid]` で 3 択受付（ログイン／ゲスト／Email Link）
- `/auth/email-link` で Email Link コールバック処理
- Firestore `zodConverter` による runtime validation を全 collection に適用
- `firestore.rules` を参加者自己作成許容に拡張

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large | Large |
| Confidence | — | — |
| Files Changed | 35〜45 | 41 created / 4 updated |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | 依存追加（zod / qrcode.react / radix-ui） | Complete | npm install で 5 パッケージ追加 |
| 2 | zod schema 群 | Complete | schema から `id` を外し、repository 側で合成する設計 |
| 3 | zodConverter 実装 | Complete | `toFirestore` overload は unknown 経由の cast で解決 |
| 4 | firestore.rules 更新 | Complete | `tournaments/{tid}/players/{pid}` に self-create を許可 |
| 5 | shadcn UI コンポーネント | Complete | input/label/card/dialog/select/textarea を手書き配置 |
| 6 | Repositories 層 | Complete | structures/tournaments/players/users の 4 collection |
| 7 | auth-actions サービス | Complete | FirebaseError コード正規化を実装 |
| 8 | receipt サービス + テスト | Complete | 4 ケース pass（displayName 空・finished・happy・already-joined） |
| 9 | RequireAuth コンポーネント | Complete | — |
| 10 | /login ページ | Complete | useSearchParams 用の Suspense 対応 |
| 11 | ストラクチャ CRUD UI | Complete | LevelTable は削除時に level を再採番 |
| 12 | トーナメント CRUD UI | Complete | structureSnapshot は作成時に deep copy |
| 13 | QrPanel + PlayerList | Complete | `QRCodeSVG`、手動リロード |
| 14 | /join/[tid] 受付ページ | Complete | 3 択 + ログイン済ユーザーの即時受付導線 |
| 15 | Email Link コールバック | Complete | オープンリダイレクト防止・別端末 fallback UI 実装 |
| 16 | トップページ更新 | Complete | `/login` と `/tournaments` への導線を追加 |
| 17 | README 更新 | Complete | 運営者／参加者フロー、ドメイン登録注意、ルール再デプロイ注意を追記 |
| 18 | 旧 converter 削除 | Complete | `debug-fs-client.tsx` を zodConverter 化、旧 API を削除 |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis (tsc) | Pass | 型エラー 0 |
| Lint (eslint) | Pass | warnings/errors 0 |
| Unit Tests (vitest) | Pass | 21 tests pass（既存 5 + schemas 9 + converters 3 + receipt 4） |
| Build (next build) | Pass | 11 ルート生成成功、dynamic `/join/[tid]` `/structures/[sid]/edit` `/tournaments/[tid]` `/tournaments/[tid]/edit` |
| Integration / 手動 | N/A | Firebase プロジェクトに接続した手動フロー検証は別作業（README の「Manual Validation」参照） |

## Files Changed

### Created (41)

| File | 概要 |
|---|---|
| `src/lib/firebase/schemas/structure.ts` | structure zod schema + create/update input |
| `src/lib/firebase/schemas/tournament.ts` | tournament zod schema + state / snapshot / update input |
| `src/lib/firebase/schemas/player.ts` | player zod schema + joinInputSchema |
| `src/lib/firebase/schemas/user.ts` | userProfile zod schema |
| `src/lib/firebase/schemas/index.test.ts` | schema valid/invalid テスト |
| `src/lib/firebase/converters.test.ts` | zodConverter テスト |
| `src/lib/firebase/repositories/structures.ts` | structure CRUD |
| `src/lib/firebase/repositories/tournaments.ts` | tournament CRUD（setup 限削除） |
| `src/lib/firebase/repositories/players.ts` | player upsert / list |
| `src/lib/firebase/repositories/users.ts` | userProfile upsert |
| `src/lib/services/auth-actions.ts` | 認証アクション（login/register/guest/email link/logout） |
| `src/lib/services/receipt.ts` | 受付サービス（3 択 + 現ユーザー再参加） |
| `src/lib/services/receipt.test.ts` | 受付サービステスト |
| `src/lib/services/qr.ts` | buildJoinUrl |
| `src/lib/services/redirect.ts` | sanitizeRedirect（オープンリダイレクト防止） |
| `src/components/ui/input.tsx` | shadcn Input |
| `src/components/ui/label.tsx` | shadcn Label |
| `src/components/ui/card.tsx` | shadcn Card 一式 |
| `src/components/ui/dialog.tsx` | shadcn Dialog |
| `src/components/ui/select.tsx` | shadcn Select |
| `src/components/ui/textarea.tsx` | shadcn Textarea |
| `src/components/auth/RequireAuth.tsx` | 認証 gate |
| `src/components/auth/AuthBadge.tsx` | ヘッダー用バッジ |
| `src/components/qr/QrPanel.tsx` | URL + QR + コピー |
| `src/components/structure/StructureForm.tsx` | ストラクチャ入力フォーム |
| `src/components/structure/LevelTable.tsx` | レベル行編集テーブル |
| `src/components/tournament/TournamentForm.tsx` | トーナメント入力フォーム（構造 select） |
| `src/components/tournament/PlayerList.tsx` | 参加者一覧（手動リロード） |
| `src/app/login/page.tsx` | Login ルート（Suspense） |
| `src/app/login/login-client.tsx` | ログイン / 新規登録 UI |
| `src/app/auth/email-link/page.tsx` | Email Link コールバック（Suspense） |
| `src/app/auth/email-link/email-link-client.tsx` | Email Link 検証＋完了処理 |
| `src/app/structures/page.tsx` | ストラクチャ一覧エントリ |
| `src/app/structures/structures-client.tsx` | ストラクチャ一覧 UI（削除 Dialog） |
| `src/app/structures/new/page.tsx` | 新規ストラクチャエントリ |
| `src/app/structures/new/structure-new-client.tsx` | 新規ストラクチャフォーム |
| `src/app/structures/[sid]/edit/page.tsx` | 編集エントリ |
| `src/app/structures/[sid]/edit/structure-edit-client.tsx` | 編集フォーム |
| `src/app/tournaments/page.tsx` | 一覧エントリ |
| `src/app/tournaments/tournaments-client.tsx` | 一覧 UI |
| `src/app/tournaments/new/page.tsx` | 新規エントリ |
| `src/app/tournaments/new/tournament-new-client.tsx` | 新規フォーム |
| `src/app/tournaments/[tid]/page.tsx` | ダッシュボードエントリ |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | ダッシュボード（QR/一覧/削除 Dialog） |
| `src/app/tournaments/[tid]/edit/page.tsx` | 編集エントリ |
| `src/app/tournaments/[tid]/edit/tournament-edit-client.tsx` | 編集フォーム |
| `src/app/join/[tid]/page.tsx` | 受付エントリ |
| `src/app/join/[tid]/join-client.tsx` | 受付 UI（3 択） |

### Updated

| File | Action |
|---|---|
| `package.json` | UPDATED — zod / qrcode.react / radix-ui 3 種を追加 |
| `firestore.rules` | UPDATED — players 本人 self-create 許可 |
| `src/lib/firebase/converters.ts` | UPDATED — `zodConverter` 追加、旧 `converter<T>()` 削除 |
| `src/app/debug/fs/debug-fs-client.tsx` | UPDATED — zodConverter 化 |
| `src/app/page.tsx` | UPDATED — `/login` `/tournaments` 導線を追加 |
| `README.md` | UPDATED — Phase 2 フロー、ドメイン登録、ルール再デプロイを追記 |

## Deviations from Plan

1. **Schema に `id` を含めない設計に変更**
   - 理由: Firestore の `FirestoreDataConverter<AppModel, DbModel>` の `toFirestore` が `WithFieldValue<AppModel>` を要求し、AppModel に `id` を含めると addDoc 時に `id` を必須で渡す必要が出る不整合。
   - 対応: schema を body（id なし）とし、repository 側で `{ id: snap.id, ...snap.data() }` を合成。UI 型は `StructureDoc = StructureBody & { id: string }` で表現。
2. **`/debug/fs` は削除せず残置（zodConverter 化のみ）**
   - 理由: Plan の GOTCHA に「最小 schema 化する or Phase 2 で削除する」選択肢があり、auto モードでは「最小 schema を当てて残す」を採用。Phase 5 で削除予定。
3. **受付ページの Server-side notFound を断念**
   - 理由: Firestore Web SDK は client-only で、rules も `auth != null` を要求するため、/join/[tid] の server component から `getTournament` を呼べない。
   - 対応: `/join/[tid]` を全 client 化。未認証時は 3 択 UI を表示、auth 成立後に tournament 名を取得して表示。
4. **`useSearchParams` の Suspense 対応を追加**
   - 理由: Next.js 15 の static 生成でビルドが `/login` `/auth/email-link` で失敗したため。
   - 対応: page.tsx で Suspense でラップ。
5. **`src/types/tournament.ts` は未削除**
   - 理由: Phase 1 時点の interface を残しつつ、Phase 2 以降は `src/lib/firebase/schemas/` を真実源として段階的に移行。現状利用箇所はない。

## Issues Encountered

- **TS Converter 型不整合（toFirestore overload）**
  - 原因: `FirestoreDataConverter.toFirestore` が 2 overload。単一関数を割り当てると型不一致。
  - 解決: 実装を `unknown` 受けにし、末尾で `as unknown as FirestoreDataConverter<T, T>` で cast。
- **Next.js build で useSearchParams が prerender 失敗**
  - 原因: Static 生成時に `useSearchParams()` を Suspense 境界無しで使うと CSR bail-out エラー。
  - 解決: `Suspense` で囲った。

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/lib/firebase/schemas/index.test.ts` | 9 | structure/tournament/player/user の valid/invalid |
| `src/lib/firebase/converters.test.ts` | 3 | zodConverter fromFirestore 成功／失敗、toFirestore pass-through |
| `src/lib/services/receipt.test.ts` | 4 | joinAsGuest: displayName 空 / finished / happy / already-joined |

## Next Steps

- [ ] `/code-review` で変更をレビュー
- [ ] `firebase deploy --only firestore:rules` で新ルールをデプロイ
- [ ] 手動フロー検証（運営者作成 → 受付 3 ルート → Firestore 確認）
- [ ] `/prp-commit` または `/prp-pr` で PR 作成
- [ ] Phase 3（Timer & Realtime & Viewer）の計画策定
