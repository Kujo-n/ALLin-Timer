# Local Review: Phase 2 — Tournament Setup & Receipt

**Reviewed**: 2026-04-19
**Scope**: ローカル未コミット変更（Phase 2 実装 + コードレビュー指摘修正）
**Decision**: APPROVE（全 HIGH / 主要 MEDIUM を修正済み、validation pass）

## Summary

Security-reviewer と typescript-reviewer を並列実行して Phase 2 の新規 / 更新ファイルをレビュー。HIGH 3 件、MEDIUM 複数を検出。`assertAcceptingEntries` の Phase 4 先送りは計画の明示的スコープ、`/{sub=**}` の owner-OR-leak は Phase 4 でのバスト／移動操作を見据えた既知設計として据え置き。残る HIGH / MEDIUM は修正実施。

## Findings

### CRITICAL
None.

### HIGH

| # | File | Issue | 対応 |
|---|---|---|---|
| 1 | `src/lib/firebase/repositories/tournaments.ts` `getTournament` | 他 read 関数と違い try/catch なしで Firestore エラーが生のまま伝播 | **Fixed** — `try/catch` + `AppError.from("firestore/read_failed")` + logger.warn |
| 2 | `src/app/tournaments/[tid]/dashboard-client.tsx` / `src/app/structures/structures-client.tsx` | `onClick={onDelete}` で async 関数の Promise が浮動、アンマウント時に rejection が捨てられる | **Fixed** — `onClick={() => { void onDelete(); }}` |
| 3 | `src/lib/firebase/converters.ts` | `toFirestore` が `unknown` を返すため `as unknown as FirestoreDataConverter<T, T>` 二段キャストで SDK 型制約を迂回 | **Fixed** — `FirestoreDataConverter<T>`（単一型引数）を使用し素直な `as DocumentData` 1 段のみに |

**HIGH（未修正・Phase 4 スコープ）**

- `src/lib/services/receipt.ts` `assertAcceptingEntries` が `finished` しか弾かない
  - **Why deferred**: Phase 2 計画 L640 で明示的に Phase 4 送り（`lateEntryDeadlineLevel` による判定は Phase 4）。既知スコープとして許容。

### MEDIUM

| # | File | Issue | 対応 |
|---|---|---|---|
| 1 | `src/lib/services/redirect.ts` | `%2F%2F` パーセントエンコードと `/\` バックスラッシュによる open-redirect bypass の可能性 | **Fixed** — decodeURIComponent + `//` / `/\` / 不正エンコードを明示拒否。テスト 8 件追加 |
| 2 | `src/components/structure/LevelTable.tsx` | `key={i}` によるリスト reconciliation ズレ | **Fixed** — `key={l.level}` |
| 3 | `src/components/structure/StructureForm.tsx` | `Number()` は数値型 input の空入力で NaN / 0 切替になる | **Fixed** — `parseNonNegativeInt` ヘルパで統一 |
| 4 | `src/app/auth/email-link/email-link-client.tsx` | React Strict Mode で `signInWithEmailLink` が 2 回実行され `auth/invalid-action-code` になる | **Fixed** — `useRef` フラグで 1 回限りに |
| 5 | `src/lib/firebase/repositories/structures.ts` `getStructure` | catch で logger.warn 未呼び出し（規約違反） | **Fixed** — logger.warn 追加 |

**MEDIUM（受容・未修正）**

- `firestore.rules` の `match /{sub=**}` と `match /players/{pid}` の OR 評価で、owner が他プレイヤーの players を update できる → **Phase 4 のバスト／移動 UI でオーナー操作が必要になるため仕様許容**。ただし Phase 4 で update 条件を精緻化する前提。
- `assertAcceptingEntries` と auth の TOCTOU → クライアント専用・小規模運用で許容、Phase 4 でルール側にも state ガード追加予定。
- `playerBodySchema.uid` が `.nullable()` → 匿名参加者の forward-compat のため維持。
- `upsertPlayer` が内部で再度 `getPlayer` する二重読取 → 小規模用途で実害なし、API 変更は別途。
- `users.ts` `getUserProfile` が id 合成しない → `UserProfileDoc = UserProfileBody` で設計上 id フィールドを持たない意図的な差異。

### LOW（未修正 / 許容）

- `src/lib/services/auth-actions.ts` `continueUrl` のログ出力 → URL のみで PII ではない、Email Link デバッグに有用なため維持。
- `/join/[tid]` のエラー表示にドメインコード露出 → サークル運用での自己診断に有用、維持。
- `RequireAuth` のフリッカー → 影響軽微。
- `npm audit` の esbuild moderate CVE → vitest 経由 devDependency、本番バンドル外。

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (`next lint`) | Pass |
| Tests (`vitest run`) | Pass（29 件、+8 sanitizeRedirect） |
| Build (`next build`) | Pass（11 ルート） |

## Files Reviewed / Updated in this Review

| File | Action |
|---|---|
| `src/lib/firebase/converters.ts` | Simplified (cast を 1 段に) |
| `src/lib/firebase/repositories/tournaments.ts` | `getTournament` を AppError 化 |
| `src/lib/firebase/repositories/structures.ts` | `getStructure` に logger.warn |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | 浮動 Promise 修正 |
| `src/app/structures/structures-client.tsx` | 浮動 Promise 修正 |
| `src/lib/services/redirect.ts` | decode + backslash ガード |
| `src/lib/services/redirect.test.ts` | **CREATE** — 8 ケース |
| `src/components/structure/LevelTable.tsx` | key を `l.level` に |
| `src/components/structure/StructureForm.tsx` | `parseNonNegativeInt` で NaN ガード |
| `src/app/auth/email-link/email-link-client.tsx` | Strict Mode 二重実行ガード |

## 手動 E2E フィードバック対応（2026-04-19）

E2E 実施で判明した 3 件を追加修正。

| # | 症状 | 原因 | 対応 |
|---|---|---|---|
| 1 | 新規登録直後に「トーナメント一覧取得に失敗しました」が表示される | `where("ownerUid") + orderBy("createdAt")` が Firestore の複合インデックス必須。未作成だと `failed-precondition` | `listMyTournaments` から `orderBy` を外し、client 側で `createdAt.toMillis()` 降順ソート |
| 2 | レベル入力が「秒」で分かりづらい | UI 単位が秒だった | `LevelTable` を「分」入力に変更（内部は `durationSec` 維持、入力値 × 60 で保存）。Dashboard snapshot 表示も分表示に統一 |
| 3 | ストラクチャ保存後に一覧が空 | 同じく複合インデックス欠落で list 失敗 → 空状態表示 | `listMyStructures` も `orderBy` 外して client ソート |

### 設計判断: `durationSec` を内部単位として維持した理由

「UI は分 / 内部は秒」という変換レイヤを挟む設計とした根拠:

1. **Phase 3 のタイマーが秒単位で動くため** — トーナメントタイマーは「9:45 残り」のように秒単位でカウントダウンするので、内部を秒で持っておくとランタイムは素直に `remainingSec--` で動かせる。分で保存すると毎回 `× 60` する必要があり、精度や切り上げ判断のブレが出やすい。
2. **スキーマ変更の波及が大きい** — `durationSec` は `levelSchema` / `structureSnapshotSchema.levels` / Firestore 既存ドキュメントに跨り、単位変更は 3 箇所同期更新が必要。Phase 2 の UI 表記変更としては過剰。
3. **将来の粒度要件に備える** — TDA 通常レベル（15/20/30分）に加え、Phase 5 でハイパーターボや分未満ブレイクが必要になった場合、秒単位なら拡張しやすい。

**トレードオフ**: 分↔秒の変換が `secToMin` と `minutes * 60` の 2 箇所で発生する。現状は軽量で、Phase 3 のタイマー実装時に最終判断を確定する前提で durationSec を維持。

## 次のアクション

- [ ] `firebase deploy --only firestore:rules` で Phase 2 ルールを反映
- [ ] 手動 E2E（ログイン → ストラクチャ → トーナメント → 受付 3 ルート）
- [ ] `/prp-commit` または `/prp-pr`
