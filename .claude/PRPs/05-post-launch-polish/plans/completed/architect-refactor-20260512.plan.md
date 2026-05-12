# Architect Refactor Plan — 20260512

## 目的

PRD 05 Phase A.1〜A.3 で追加された結果カード背景画像 / OG SSR readability 周辺の duplication
を atomic 単位で集約する。観測可能な動作変更は 0、既存テスト（unit 1357 件 + E2E）は常に green。

**ベースブランチ**: `feat/phase-a.2-background-image-ui-and-ssr` → 作業ブランチを切る
**監査結果**: [reviews/architect-refactor-20260512.md](../reviews/architect-refactor-20260512.md)
**所属 PRD**: `05-post-launch-polish`（Phase A.1〜A.3 follow-up）

## 不変条件

1. 既存テスト（unit / E2E）は各タスク後で常に green
2. 観測可能な動作変更なし（API 表面・PNG バイト・Firestore 書込形状・UI を変えない）
3. 公開 API（service / repository の export 名）は thin wrapper を残して破壊なし
4. 1 タスク = 1 commit（atomic 性維持）

## 順序

依存方向に沿って外側 → 内側の順で集約する:

- T1 → T2 → T3: winner/season 軸の集約を **下位層から**（service → repository → group service）
- T4: OG route の純関数 helper 抽出（独立スコープ）
- T5: tournament-state 純関数経由化（独立スコープ）
- T6: limits.ts と og-payload.ts の数値定数連動化（独立スコープ）

各タスクは独立に revert 可能。先に T1〜T3 を入れることで T1 が壊れても後段は分離検証できる。

## タスク一覧

### T1: `refactor(card-bg): service の winner/season 6 関数を internal _impl に集約`

- **finding**: finding-1
- **対象**:
  - [src/lib/services/card-background.ts](../../../../src/lib/services/card-background.ts) — 6 export 関数を thin wrapper に
  - [src/lib/services/card-background.test.ts](../../../../src/lib/services/card-background.test.ts) — 既存契約テスト（変更なしの想定）
- **手順**:
  1. internal `kindToSetter(kind)` で `setWinnerCardBackground` / `setSeasonCardBackground` を dispatch するヘルパを追加
  2. `_uploadAndSetCardBackground(kind, opts)` / `_clearCardBackground(kind, opts)` /
     `_updateCardBackgroundTextTheme(kind, opts)` の 3 internal 関数を実装
  3. 既存 6 export 関数（`uploadAndSet{Winner|Season}CardBackground` /
     `clear{Winner|Season}CardBackground` / `update{Winner|Season}CardBackgroundTextTheme`）は
     **export 名・引数型を維持**し、内部実装を 1 行で `_impl` 呼出に置換
  4. `logOrphanWarn` は引数の `kind` を取るため使い回し可能 — そのまま
- **テスト保護**:
  - 既存 `card-background.test.ts`（274 行）の 6 関数 × 5 シナリオ
  - 期待される mock 呼出順序（uploadCardBackgroundAsset → setXxxCardBackground → deleteCardBackgroundAsset）は不変
- **検証**: typecheck / lint / test（card-background.test.ts 中心）
- **リスク**: 観測可能な動作変更なし。setter dispatch を間違えると winner ↔ season が逆転するため、
  既存テストの `setWinnerCardBackground.toHaveBeenCalled` / `setSeasonCardBackground.toHaveBeenCalled`
  別 assertion で検出可能

### T2: `refactor(card-bg): repository の updateWinner/SeasonCardBackground を field 駆動で集約`

- **finding**: finding-2 の repository 部
- **対象**:
  - [src/lib/firebase/repositories/groups.ts:501-547](../../../../src/lib/firebase/repositories/groups.ts#L501-L547)
  - [src/lib/firebase/repositories/groups.test.ts](../../../../src/lib/firebase/repositories/groups.test.ts)
- **手順**:
  1. internal `updateCardBackground(field: "winnerCardBackground" | "seasonCardBackground", gid, value)` を追加
     - 既存 `updateWinnerCardBackground` / `updateSeasonCardBackground` の本体を統合し、
       field 名と logger.info の path string をパラメタライズ
  2. export 関数 2 個は thin wrapper として残し、引数 `(gid, value)` で internal を呼ぶ
  3. `validateCardBackground` は共通のためそのまま使う
- **テスト保護**:
  - 既存 `groups.test.ts` の `updateWinnerCardBackground` / `updateSeasonCardBackground` テスト
- **検証**: typecheck / lint / test
- **リスク**: 観測可能な動作変更なし。`updateDoc` の field 引数が逆転すると `winnerCardBackground` ↔
  `seasonCardBackground` の取り違えが起きる → 既存テストの `expect(updateDocMock).toHaveBeenCalledWith(...{ winnerCardBackground: ... })` で検出

### T3: `refactor(card-bg): group service の setWinner/SeasonCardBackground を kind 駆動で集約`

- **finding**: finding-2 の service 部
- **対象**:
  - [src/lib/services/group.ts:528-571](../../../../src/lib/services/group.ts#L528-L571)
  - [src/lib/services/group.test.ts](../../../../src/lib/services/group.test.ts)
- **手順**:
  1. internal `setCardBackground({ kind, gid, uid, value })` を追加し、`assertOwner` + repository 呼出 +
     logger.info を集約
  2. export 関数 2 個は thin wrapper として残し、kind を渡して internal を呼ぶ
- **テスト保護**:
  - `group.test.ts` の setWinner / setSeason テスト（assertOwner pre-check 含む）
- **検証**: typecheck / lint / test
- **リスク**: assertOwner の引数（group, uid）が同じ経路で呼ばれることを保証

### T4: `refactor(og): bgImage 取得 / response headers / error response を純関数 helper に抽出`

- **finding**: finding-3
- **対象**:
  - [src/app/api/og/_lib/og-image-fetch.ts](../../../../src/app/api/og/_lib/og-image-fetch.ts) — `prepareBgDataUri` を追加
  - **新規**: [src/app/api/og/_lib/og-response.ts](../../../../src/app/api/og/_lib/og-response.ts) — `applyOgImageResponseHeaders` / `respondWithOgRenderError` / `CACHE_CONTROL` constant
  - [src/app/api/og/winner/[tid]/route.tsx](../../../../src/app/api/og/winner/[tid]/route.tsx) — helper 呼出に置換
  - [src/app/api/og/season/[gid]/route.tsx](../../../../src/app/api/og/season/[gid]/route.tsx) — 同
  - **新規**: [src/app/api/og/_lib/og-response.test.ts](../../../../src/app/api/og/_lib/og-response.test.ts) — 単体テスト
  - **新規**: 拡張 [src/app/api/og/_lib/og-image-fetch.test.ts](../../../../src/app/api/og/_lib/og-image-fetch.test.ts) — `prepareBgDataUri` の null fallback テスト
- **手順**:
  1. `prepareBgDataUri({ url, onError })` を `og-image-fetch.ts` に追加。`url == null` で `null` 即返し、
     非 null で `fetchAsDataUri` を try/catch して失敗時は `onError(e)` を呼んで null 返す
  2. `og-response.ts` に以下を export:
     - `const OG_CACHE_CONTROL = "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800";`
     - `applyOgImageResponseHeaders(response, { filenameStem })` — content-disposition + cache-control を set
     - `respondWithOgRenderError(e, { logTag, ctx })` — `AppError.from(e, "og/render-failed", ...)` +
       `logger.warn` + `NextResponse.json` の集約 helper
  3. winner / season route の `bgDataUri = q.bgImageUrl ? await fetchAsDataUri(q.bgImageUrl).catch(...) ...`
     を 1 行 `prepareBgDataUri({ url: q.bgImageUrl, onError: (e) => logger.warn("og winner bg fetch failed", { tid, code: getErrorCode(e) }) })` に置換
  4. winner / season route の response.headers.set(...) 2 行を `applyOgImageResponseHeaders` 呼出 1 行に
  5. winner / season route の `catch (e)` ブロック 13 行を `return respondWithOgRenderError(e, { logTag: "og winner render failed", ctx: { tid } })` 1 行に
- **テスト保護**:
  - `og-image-fetch.test.ts` 既存 9 件 + 新規 `prepareBgDataUri` 3 件（null url / 成功 / fetch 失敗）
  - 新規 `og-response.test.ts` 4 件（`applyOgImageResponseHeaders` の cache-control / content-disposition / `respondWithOgRenderError` の status 500 + AppError code / known AppError は code 維持）
  - E2E `tests/e2e/card-background.spec.ts`（OG fallback / upload / clear）が PNG バイト同値を保つ
- **検証**: typecheck / lint / test。**E2E は Phase 5 で実施**
- **リスク**:
  - response header の文字列 drift（cache-control / content-disposition）
  - `og/render-failed` の AppError.from idempotency が壊れると known AppError を二重 wrap → 既存テストで検出
  - **JSX の外側 wrapper は今回触らない**（Satori 制約と PNG byte-identicality 維持のため）

### T5: `refactor(state): live / edit client の tournament.state 直接比較を helper 経由化`

- **finding**: finding-4
- **対象**:
  - [src/app/tournaments/[tid]/live/live-client.tsx:123](../../../../src/app/tournaments/[tid]/live/live-client.tsx#L123) — `tournament.state !== "finished"` → `!isFinished(tournament)`
  - [src/app/tournaments/[tid]/edit/tournament-edit-client.tsx:52](../../../../src/app/tournaments/[tid]/edit/tournament-edit-client.tsx#L52) — `data.state !== "setup"` → `!canEdit(data)` または `!isSetup(data)`
- **手順**:
  1. live-client: `import { isFinished } from "@/lib/services/tournament-state";` を追加して比較置換
  2. tournament-edit-client: 同じく `isSetup` を import して置換（`canEdit` は同義だが「編集可能か」の意味で適切。
     state-machine の semantic に従い `canEdit` を採用）
- **テスト保護**:
  - `tournament-state.test.ts`（既存 80 件）の characterization
  - live / edit client の UI flow tests がある場合は確認
- **検証**: typecheck / lint / test
- **リスク**: bool 値同値性。pure helper のみ呼ぶため動作変更なし

### T6: `refactor(og): WINNER_GROUP_NAME_MAX 冗長 alias 削除 + MAX_PARTICIPANTS を limits.ts 連動化`

- **finding**: finding-9 + finding-8
- **対象**:
  - [src/app/api/og/_lib/og-payload.ts:23-27](../../../../src/app/api/og/_lib/og-payload.ts#L23-L27)
- **手順**:
  1. `WINNER_GROUP_NAME_MAX = SEASON_GROUP_NAME_MAX;` の行を削除し、`SEASON_GROUP_NAME_MAX` を
     `GROUP_NAME_MAX` にリネーム
  2. `MAX_PARTICIPANTS = 60;` のハードコードを `MAX_PARTICIPANTS = MAX_TABLES * MAX_SEATS_PER_TABLE;` に置換し、
     `@/lib/limits` から import
  3. 既存 zod schema での参照は変数名追従のみ
- **テスト保護**:
  - `og-payload.test.ts` の境界値（max 60 / min 1）テスト
  - 数値リテラルが変わらないため挙動同値
- **検証**: typecheck / lint / test
- **リスク**: なし（同値定数の再配置）

## 想定検証フロー

各タスク後:
1. `npm run typecheck`
2. `npm run lint`
3. `npm test` （該当領域のテストが green）
4. `git add` で意図したファイルだけステージ
5. 日本語 commit message（type prefix は英語）

すべて完了後 Phase 5 で:
1. `npm run typecheck && npm run lint && npm test`
2. `npm run build`（dev server が停止していることを確認後）
3. `npm run test:e2e`（E2E で OG / card background が PNG byte-identical / UI 動作不変であることを最終確認）

## 想定変更量

| タスク | files | 想定 diff |
| --- | --- | --- |
| T1 | 1（test 変更なし） | +60 / -120 |
| T2 | 1（test 変更なし） | +25 / -45 |
| T3 | 1（test 変更なし） | +25 / -40 |
| T4 | 4 新規 / 2 編集 | +200 / -100 |
| T5 | 2 編集 | +4 / -2 |
| T6 | 1 編集 | +5 / -5 |
| **合計** | **約 6 files** | **+320 / -310** |

実装後に純削減（finding-1/2/3 のおかげで wrapper 関数が縮む）の見込み。

## 見送り（次サイクル）

- **finding-5（CardBackgroundCard.tsx の 447 行）**: hook 抽出は `useCardBackgroundFilePicker` 化 +
  `<ClearConfirmDialog>` 切り出しが候補。ただし `CardBackgroundCard.test.tsx`（358 行）の mock 境界が
  service 関数 + UI flow に張られており、hook 抽出はテスト書換が必要。今回スコープ外
- **`retry.ts` Promise.race による signal 反応化**（finding-7）
- **Storage rule の `firestore.exists + firestore.get` 1 read 化**（finding-6）

## ロールバック手順

各タスクは atomic に commit するため、問題があれば `git revert <sha>` で 1 つずつ戻せる。
タスク間の依存は基本独立だが、T1 → T2 → T3 は winner/season 軸の集約で同階層依存があるため、
順序を守って revert する（最後に入れたタスクから戻す）。

## 想定承認質問

ユーザー承認時に確認すべき項目:

- T4 の純関数 helper 抽出は OG PNG の byte-identical を保証する形（JSX 触らず）でよいか
- T5 の `canEdit` vs `isSetup` の semantic 選択（推奨: `canEdit`）
- T6 の `SEASON_GROUP_NAME_MAX → GROUP_NAME_MAX` rename が他 callsite を破壊しないか（grep で確認済）
- 見送り finding-5 / 6 / 7 を次サイクルで再評価する合意
