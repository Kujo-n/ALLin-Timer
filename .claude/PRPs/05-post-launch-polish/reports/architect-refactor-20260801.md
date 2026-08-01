# Architect Refactor Report — 20260801

## Scope

- **対象**: `src/` 全域（着手前 29,564 行 / 非テスト）＋ `firestore.rules` / `storage.rules` / README / `env.local.example`
- **ベースライン commit**: `ed0ed1b`（PRD 08「トーナメント受付によるサークル自動所属」Phase 1〜4 完了時点）
- **作業ブランチ**: `refactor/architect-refactor-20260801`（`feture/auto-group-join` から分岐）
- **所属 PRD**: `05-post-launch-polish`（過去 3 サイクルの architect-refactor と同じ帰属。
  PRD 08 は全 Phase complete かつ `plans/` 直下が空の immutable アーカイブのため新規 plan を置かない）

## Findings 概要

- critical: 0 件 / high: 0 件 / medium: 6 件 / low: 4 件 / info: 2 件
- 詳細監査結果: [.claude/PRPs/05-post-launch-polish/reviews/architect-refactor-20260801.md](../reviews/architect-refactor-20260801.md)
- 実施計画: [.claude/PRPs/05-post-launch-polish/plans/architect-refactor-20260801.plan.md](../plans/architect-refactor-20260801.plan.md)

### 前提として確認できたこと（規約遵守は良好）

監査の冒頭で機械チェックを行い、全フェーズ規約が守られていることを確認した。
結果として本サイクルの所見は「規約違反の摘発」ではなく **重複の集約 / 死んだ足場の撤去 /
allowlist の最小権限化** が中心になった。

| 検査 | 結果 |
| --- | --- |
| `console.*` の残置 | 0 件（`logger.ts` 内の実装のみ） |
| `tournament.state === "..."` の直接比較 | 0 件（全ヒットがコメント。`tournament-state.ts` に統一済み） |
| Firestore SDK の repositories 外呼出 | `app/debug/fs` のみ（= finding-1）。他は型 import か文書化済み例外 |
| `wrapFirestoreWrite/Read` の適用 | repositories 全域で徹底 |
| 数値リミット | `limits.ts` に集約済み |
| knip（未使用 export） | 4 件検出、すべて自モジュール内で使用（誤検出） |

## 実施した変更

11 commit、すべて 1 コミット = 1 リファクタの atomic 単位。

| commit | 要約 | 影響範囲 |
| --- | --- | --- |
| `2b50ff2` | **fix(security)**: OG 背景画像の allowlist を自プロジェクトのバケットに限定 | `og-image-fetch.ts` + test |
| `7d4e37d` | docs(rules): DRIFT WARNING の参照先を `limits.ts` / explicit subcollection rule に修正 | `firestore.rules` / `repositories/tournaments.ts`（コメントのみ） |
| `3484f9d` | refactor(auth): 表示名バリデータを `entry-guards.parseDisplayName` に統一 | `services/auth-actions.ts` |
| `e1eb1fe` | refactor(group): `generateJoinCode` の未使用 import とダミー `void` 参照を削除 | `services/group.ts` |
| `b38eebe` | refactor(group): 設定値バリデーションを共有 pure validator に集約 | 新規 `lib/validation/group-settings.ts` + service / repository |
| `efb15f0` | refactor(seating): tx 内 race guard を `checkPlayerMoveGuard` に集約 | `tx-helpers.ts` / `seating/orchestrator.ts` |
| `c1d34d9` | refactor(firebase): collection ref factory を `refs.ts` に集約 | 新規 `lib/firebase/refs.ts` + 5 消費モジュール |
| `1be4d74` | refactor(seating): `SeatingBoard` の内部 component を `_seating-board/` に分割 | `SeatingBoard.tsx` + 新規 5 ファイル |
| `53c1c58` | refactor(join): 受付結果画面を `JoinResultCard` に抽出 | `join-client.tsx` + 新規 1 ファイル |
| `11731b0` | refactor(join): 受付 submit の boilerplate を `runReceiptAction` に集約 | `join-client.tsx` |
| `9b3ab91` | **chore**: Phase 1 の疎通確認ルート `/debug/fs` を撤去 | `src/app/debug/` 削除 + README / `env.local.example` / `security-env.md` |
| `831e408` | test(e2e): allowlist 絞り込みに合わせて card-background の fixture を修正 ＋ deny の positive coverage 追加 | `card-background.spec.ts` / `fixtures/emulator.ts` |

### 解消した重複

| 対象 | Before | After |
| --- | --- | --- |
| group 設定の値域検証 | service 層と repository 層に約 120 行を逐語重複 | 共有 pure validator 1 箇所（両層が同じ関数を呼ぶ＝多層防御は維持） |
| tx 内 race guard（missing/busted/moved/race） | orchestrator の 3 関数に重複 | `checkPlayerMoveGuard` 1 箇所 |
| collection ref factory | tournaments × 3 / players × 2 / tables × 2 | `refs.ts` 1 箇所 |
| 表示名バリデータ | `auth-actions` と `entry-guards` に完全同一実装 | `parseDisplayName` 1 箇所 |

### ファイル分割

| ファイル | Before | After |
| --- | --- | --- |
| `SeatingBoard.tsx` | 626 行 / 5 component 同居 | **239 行**（-62%）+ `_seating-board/` 5 ファイル |
| `join-client.tsx` | 516 行 | **451 行** + `_components/JoinResultCard.tsx` 123 行 |

### セキュリティ修正の詳細（`2b50ff2`）

`isAllowedBgImageUrl` は host allowlist のみを検査していたが、
`storage.googleapis.com` / `firebasestorage.googleapis.com` はいずれも **GCS 全体で共有される
マルチテナントホスト**であり、`https://storage.googleapis.com/<任意の公開バケット>/<obj>` が
同じ host に解決する。このため未認証の OG route に任意の `bgImageUrl` を渡せば、
**世界中の公開 GCS オブジェクトを取得して PNG に埋め込んで返す汎用画像プロキシ**として
第三者が利用できる状態だった。

内部ネットワークへの SSRF ではない（https 限定 / content-type 3 種 / 2MB / 8s タイムアウトが
既に効いている）が、最小権限の原則からの逸脱であり、Vercel の帯域・実行時間を無関係な配信に
流用できる。ソース内コメントは「同一バケットに対する両形式を受容する」と設計意図を述べており、
**実装がその意図を満たしていなかった**点が本質的な問題だった。

host 検査の後段に bucket 一致検査を追加し、`NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
未設定時は従来の host-only 判定にフォールバックする。

#### この修正が E2E を 1 件落とした（`831e408` で対応）

Phase 5 の E2E 全件走行で `card-background.spec.ts:60` が 200 ではなく
**400 (`og/invalid-params`)** を返して失敗した。

- **なぜ unit で捕捉できなかったか**: vitest は `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` を
  設定しないため **フォールバック（host-only）経路**を通る。一方 Playwright は
  `playwright.config.ts` が dev server に `allin-pokertimer-e2e.appspot.com` を注入するため
  **strict 経路**が有効になる。T1 で追加した unit は strict 経路を `vi.stubEnv` で
  個別に検証していたが、「実環境の既定はどちらか」という観点が抜けていた
- **なぜテスト側を直すのが正しかったか**: 当該 test の検証対象は
  「背景画像の fetch が失敗しても render が止まらずグラデ fallback で 200 を返すこと」で、
  この振る舞いは今も変わっていない。壊れたのは fixture が **旧 allowlist の広さ**
  （バケットを問わない）に依存して `v0/b/nonexistent/o/missing.jpg` を使っていた点で、
  これは T1 が意図的に狭めた当の性質そのもの
- **対応**: fixture を「設定済みバケット + 存在しないオブジェクト」に変更し test の意図を保持。
  併せて **他バケットが 400 で拒否されることを assert する E2E を新規追加**し、
  回帰を positive coverage に転換した

## 見送った提案（理由付き）

| finding | 見送り理由 |
| --- | --- |
| finding-10 の後半（`services/group.ts` 887 行の分割） | 6 責務が同居しているが、import 波及が 10+ ファイルに及び 1 commit の atomic 性を保てない。次サイクル候補 |
| finding-10 の後半（`getGroup` + `assertOrganizer` の集約） | `proxy-receipt.ts` の `resolveOrganizerContext` に倣う案。8 callsite すべてで後続処理が異なり抽象化の利得が薄い |
| **finding-12（表示名「解決」順序の統一）** | 4 実装 / 3 通りの優先順位（profile と auth の順序が逆転）。統一すると **表示名が変わる = 観測可能な動作変更**になるため不変条件 2 に抵触。**仕様判断が必要なので別タスクとして提起する**（下記「残課題」参照） |
| `groups` repository の空文字メッセージ統一 | `"表示名が空です"` → `"表示名を入力してください"` は観測可能変更 |
| finding-11（knip の未使用 export 4 件） | すべて自モジュール内で使用中の誤検出。`export` を外すと `group.test.ts` の `seasonHistoryRef` mock が壊れる |
| `CardBackgroundCard.tsx` 447 行の hook 抽出 | 20260512 サイクルからの継続 deferred。既存 test の mock 境界書換が前提条件で、今回のスコープでは safety net を崩す |
| `join-client.tsx` の `onRegisterSubmit` / `onGoogleJoin` | 3 分岐 catch / early return を持ち、helper 経由化すると `setError` 挙動が変わる（前サイクルと同じ判断基準） |

## 追加したテスト

新規 63 ケース（unit 1702 → 1747、+45 は下記のうち重複計上を除いた純増）。

| ファイル | 件数 | カバーした振る舞い |
| --- | --- | --- |
| `src/lib/validation/group-settings.test.ts`（新規） | 25 | 4 フィールドの境界値（`MAX_TABLES` / `TABLE_LABEL_MAX_LENGTH` / `SEASON_POINTS_BASE_MAX_LENGTH` / 席数範囲）、層をまたいだ AppError code の一致、`parse*` と `assert*` の非対称（trim・丸めの有無） |
| `src/lib/firebase/tx-helpers.test.ts`（追記） | 13 | race guard の 4 段判定と**判定順序**（busted > moved > race）、`expectedLastMovedAtMs` の null 経路 |
| `src/app/api/og/_lib/og-image-fetch.test.ts`（追記） | 12 | 自バケット allow（2 形式）/ 他バケット deny（2 形式）/ bucket 抽出不能な path 形 deny / 設定値未指定時のフォールバック |
| `tests/e2e/card-background.spec.ts`（追記） | 1 | **HTTP 層**で他プロジェクトのバケット URL（2 形式）が 400 で拒否されること。bucket 設定済みの本番相当環境で allowlist が効いていることを固定する |

unit はいずれも **抽出した pure 関数の仕様を直接固定する** characterization test で、
次に同じ箇所を触る人の回帰防壁になる。E2E の 1 件は Phase 5 で顕在化した回帰を
positive coverage に転換したもの。

## ベースライン vs 最終

| 項目 | Baseline (`ed0ed1b`) | After (`9b3ab91`) |
| --- | --- | --- |
| typecheck | ✅ pass | ✅ pass |
| lint | ✅ pass（0 warnings） | ✅ pass（0 warnings） |
| unit test | ✅ 107 files / **1702 pass** / 0 fail | ✅ 109 files / **1747 pass** / 0 fail |
| build | ✅ pass | ✅ pass |
| e2e test | ✅ **116 pass** / 0 fail / 3 skip（10.8 分） | ✅ **117 pass** / 0 fail / 3 skip（11.3 分） |
| rules drift check | ✅ 14/14 | ✅ 14/14 |

E2E の +1 は T11 で追加した「他バケットの `bgImageUrl` は 400 で拒否される」ケース。
**Phase 5 の 1 回目の全件走行では 115 pass / 1 fail** だったが、原因（T1 由来の fixture 依存）を
特定して `831e408` で修正し、**2 回目の全件走行で 117 pass / 0 fail** を確認した。

### 観測可能な動作変更が無いことの根拠

1. **T1〜T9 は全て内部リファクタ**。抽出した関数の AppError code / message、
   skipReason の文字列書式、DOM 構造 / aria 属性 / data-testid / class / inline style を
   すべて逐語維持した（各 commit メッセージに根拠を明記）
2. **既存 unit 1702 ケースは 1 件も書き換えずに pass し続けた**。
   これが、外部から見た契約が変わっていないことの直接的な証拠
3. E2E 116 ケース（受付 / 席決め / PD / 卓閉鎖・再開 / 卓 label / 観戦 / シーズン / メンバー除外）
   がベースラインと同じ結果

**観測可能な変更を伴った 2 点（いずれも意図的）**:

| # | 変更 | 位置づけ |
| --- | --- | --- |
| T10 | `NEXT_PUBLIC_ENABLE_DEBUG=1` の環境で `/debug/fs` が 200 → 404 | **ユーザー承認済み**。当該ページの両ボタンは現行 rule 下で必ず permission-denied になる完全な dead code だったため機能的損失はゼロ |
| T1 | 他プロジェクトのバケットの `bgImageUrl` が 200（グラデ fallback）→ 400 | **セキュリティ修正そのもの**（不変条件 2 の例外に該当）。アプリが生成する URL は常に自バケットの download URL のため、正常系の経路には影響しない |

T1 の変更は E2E fixture の前提を壊したため 1 度 red になったが、
**テストの検証対象ではなく fixture の前提が旧 allowlist に依存していた**ケースであり、
`831e408` で fixture を修正しつつ deny 側を positive coverage として追加した
（詳細は上記「この修正が E2E を 1 件落とした」節）。

### 手動 smoke test の推奨

自動テストで担保済みだが、UI 分割を伴った 2 箇所は実機で 1 度確認することを推奨する:

1. **席表（SeatingBoard）** — 卓カードの色帯・ドット表示、D&D による席移動、
   PD チェックボックス、卓の「編集 / 閉じる / 再開」ボタンが従来どおり動くこと
2. **受付画面（`/join/[tid]`）** — ゲスト受付 → 完了画面 →「参加を取り消す」→
   「受付画面に戻る」の往復、および自動所属メッセージの表示

## 残課題 / Next Step

1. **表示名「解決」順序の統一（finding-12）— 仕様判断が必要**

   同じ「ユーザーの表示名を解決する」概念が 4 箇所で、profile と auth の優先順位が
   逆転する 3 通りで実装されている:

   | 実装 | 優先順位 |
   | --- | --- |
   | `receipt.resolveDisplayName` | hint → users profile → auth → throw |
   | `auto-group-join.resolveMemberDisplayName` | hint → auth → users profile → uid（15 字 slice） |
   | `group.consumeJoinCode` 内 | auth → users profile → uid |
   | `group.createGroupWithOwner` 内 | auth → uid |

   受付経路では `receipt` が解決した名前を hint として渡すため実害は出ていないが、
   独立に呼ばれる経路（招待コード加入 / サークル作成）では `players.displayName` と
   `memberDisplayNames[uid]` が食い違い得る。
   **統一は表示名が変わる観測可能変更**のため、「どの順序を正とするか」をユーザーと
   決めてから別タスクで実施する。

2. **`services/group.ts` 887 行の分割** — group CRUD / 招待コード / ロール / シーズン /
   カード背景 / メンバー除外の 6 責務が同居。次サイクルの主要候補。

3. **継続 deferred（20260512 / 20260514 から）**
   - `CardBackgroundCard.tsx` 447 行の hook 抽出 → 既存 test の mock 境界書換が前提
   - Storage rule の 2 read 削減 → owner-only 経路で実害なし
   - `retry.ts` signal sleep → `deleteWithRetry` の callsite が増えた時点で対応
   - shadcn `<CardTitle>` の semantic 化（`asChild` で `<h2>` / `<h3>` を受ける）

4. **`firestore.rules` の deploy は不要** — 本サイクルの rules 変更は**コメントのみ**で、
   条件式は 1 文字も変えていない（`npm run test:rules-limits` 14/14 green で確認）。
   したがって `firebase deploy --only firestore:rules` は不要。

5. **PR 化** — `/prp-pr` で起票する場合、本レポートの「実施した変更」表を PR 本文の
   出発点にできる。PR 説明には「観測可能な動作変更なし（T10 のみ承認済みの例外）」と
   「全テスト green を維持」を明記すること。

## ワークフロー上の運用学習

- **`.next/types/` の stale 参照**: ルートを削除した直後の `npm run typecheck` は、
  `.next/types/app/<deleted-route>/page.ts` が残っているため `TS2307` で失敗する。
  `npm run build` を 1 度走らせて型生成物を再構築すれば解消する。
  ルート削除を伴うタスクでは **build → typecheck の順**で確認するのが確実。
- **E2E と build の競合は今回発生しなかった**: Phase 1 のベースライン E2E 完了後に
  ポート 3001 / 4000 / 8080 / 9099 を確認したところ Playwright が正常に停止させており、
  以降の build も問題なく通った（20260507 の症状は再現せず）。
  それでも build 前のポート確認は継続する価値がある。
- **⚠ 環境変数に分岐する実装を触ったら、unit だけで green を信じてはいけない**（本サイクル最大の学び）:
  T1 は `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` の有無で挙動が分かれる実装を入れたが、
  **vitest（未設定 = フォールバック経路）と Playwright（設定済み = strict 経路）で
  既定の分岐先が逆**だった。unit 1747 green でも E2E で初めて落ちた。
  `process.env` を読む分岐を追加・変更するタスクでは、
  **中間 commit であっても該当領域の E2E spec だけは先に走らせる**のが安全。
  今回は Phase 5 まで発覚が遅れ、原因切り分けに時間を要した。
- **Playwright は `npm run test:e2e` 経由でしか起動できない**: `npx playwright test` を
  直接叩くと本番 Firebase 流出予防の gate に弾かれる。単一 spec を回すときは
  `npm run test:e2e -- tests/e2e/<file>.spec.ts` の形にする。
- **ルート削除後の `npm run typecheck` は先に build が必要**: `.next/types/app/<deleted>/page.ts`
  が残っていて `TS2307` になる。`npm run build` で型生成物を再構築すれば解消する。

## 関連リンク

- 監査結果: [architect-refactor-20260801.md](../reviews/architect-refactor-20260801.md)
- 実施計画: [architect-refactor-20260801.plan.md](../plans/architect-refactor-20260801.plan.md)
- 前サイクル: [architect-refactor-20260514-2.md](architect-refactor-20260514-2.md)
- 元 PRD: [05-post-launch-polish.prd.md](../prds/05-post-launch-polish.prd.md)
- レンズ: [web_architect.md](../../../skills/architect-refactor/references/web_architect.md) /
  [security_specialist.md](../../../skills/architect-refactor/references/security_specialist.md)
