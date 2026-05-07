# Architect Refactor 監査結果 — 20260507

## 起動コンテキスト

- ユーザー指示: `/architect-refactor` を全体スコープで起動
- ベースラインブランチ: `develop`（直近コミット `bb5528c docs: README の scripts table と scripts ツリーを Phase C 対応に同期`）
- 作業ブランチ: `refactor/full-scope-20260507`
- 直近の architect-refactor: 20260506（02-season-stats-and-share/plans/completed/architect-refactor-20260506.plan.md）。本監査はその後追加された Phase D（Web Share & 履歴 polish）周辺と、前回拾えなかった残債を中心に確認。

## ベースライン

| 項目 | 状態 |
| --- | --- |
| typecheck | ✅ pass |
| lint | ✅ pass |
| unit (vitest) | ✅ 1030 passed / 0 failed (58 files) |
| build (next) | ✅ 15/15 static pages, route bundle OK |
| e2e (playwright) | ✅ 65 passed / 0 failed / 2 skipped（6.6 分） |

## 監査範囲

- src/ 全体（233 ファイル / 約 20.8 KLOC）
- 重点: Phase D で追加された share / OG / 履歴 / QR 関連、および 300 行超ファイル
- ルール参照: `.claude/rules/error-logging.md` / `firebase-patterns.md` / `group-membership.md` / `security-base.md` / `security-env.md` / `testing.md`
- レンズ: `architect-refactor/references/web_architect.md` / `security_specialist.md`

## Findings

### finding-1: ShareCardButton 用の URL / filenameStem 計算が download ボタンと二重化

- **Lens**: architect
- **Severity**: medium
- **場所**:
  - `src/app/tournaments/[tid]/dashboard-client.tsx:362-403`
  - `src/app/groups/[gid]/season/season-ranking-client.tsx:117-162`
- **観察事実**: `WinnerCardDownloadButton`（`src/components/tournament/WinnerCardDownloadButton.tsx:40-49`）と `SeasonTopCardDownloadButton`（`src/components/group/SeasonTopCardDownloadButton.tsx:41-62`）の内部と同形の `formatDateForFilename` / `sanitizeFilename` / `buildXxxCardUrl` / `formatDateForLabel` の組合せが、ShareCardButton 用に dashboard / season-ranking クライアントにも展開されている。コード内に「二重計算は ... 内部と重複するが、最小差分優先で許容」のコメントが明記されている。
- **影響**: 表示名・日付フォーマット・sanitize ルールが drift すれば share と download で異なる URL / filename が出る。OG クエリフィールドを増やすときに 4 箇所同時更新が必要。`og-payload.ts` schema 変更時の連鎖が広い。
- **案**: `src/app/api/og/_lib/og-payload.ts` に純関数を追加:
  - `buildWinnerShareInputs(tid, { winnerName, tournamentName, participants, finishedAt })` → `{ url, filenameStem }`
  - `buildSeasonShareInputs(gid, group, stats)` → `{ url, filenameStem }` （stats から top1〜top3 派生も内部で行う）
  - download / share の両方が同 helper を経由する。
- **テスト保護**:
  - 既存 `src/app/api/og/_lib/og-payload.test.ts` / `WinnerCardDownloadButton.test.tsx` / `SeasonTopCardDownloadButton.test.tsx`
  - 新 helper 自体の純関数テストを追加（URL クエリパラメータの完全一致 + filenameStem の sanitize 確認）
- **リスク**: 観測動作変更なし。同じ URL / filename を返す純関数を一段噛ませるだけ。

### finding-2: 大量の client component で AppError.from + logger.warn が二重 warn を引き起こしている

- **Lens**: architect
- **Severity**: medium
- **場所**（代表例 / 全 87 箇所中の高ヒット箇所）:
  - `src/app/groups/[gid]/group-detail-client.tsx:121,196,224,241,258,274`（6 箇所）
  - `src/app/tournaments/[tid]/dashboard-client.tsx:185-187`（onDelete）
  - `src/app/groups/[gid]/season/season-ranking-client.tsx:48-50`
  - `src/app/tournaments/[tid]/edit/tournament-edit-client.tsx`
  - `src/app/templates/[tid]/edit/template-edit-client.tsx`
  - `src/components/tournament/BalancingInstructionCard.tsx`
  - 他多数
- **観察事実**: repository / service 層は `wrapFirestoreWrite/Read`（`src/lib/firebase/wrap.ts`）または手書き try/catch 経由で `logger.warn` を 1 度出力したうえで `AppError` を throw している。UI 側でこれを catch し、さらに `AppError.from(e, "...", "...")` + `logger.warn(wrapped.message, ...)` を行うと、`AppError.from` は既存 AppError を idempotent に返すため code は保持されるが、`logger.warn` が二重発火する。
- **規約**: `error-logging.md` の禁止事項に明記:
  > 既に AppError ラップ済みのエラーをさらに `AppError.from` で wrap 直す（二重 warn を引き起こす）— `unwrapOrFrom` を使う
- **影響**:
  - 本番ログに同一エラーが 2 行 → 監視 / デバッグ時のノイズ
  - UI 側で意図した「補完用 code（例: `group/leave-failed`）」は AppError な引数では適用されないため意図と実態が乖離
- **案**: catch ブロックの **目的が UI 表示用** の場合は次の形式に統一:
  ```ts
  } catch (e) {
    const err = unwrapOrFrom(e, "<fallback-code>", "<fallback-msg>");
    setError(`${err.code}: ${err.message}`);
  }
  ```
  - `logger.warn` を削除（inner で既に warn 済み）
  - catch の意図が「inner が warn しない経路の補完」（例: best-effort fetch / silent failure 監視）の場合は対象外
- **対象外の判定基準**:
  - `useAudioPlayer.ts:110` の `audio/play-failed` のように、外部 API（`HTMLAudioElement.play()`）が直接 reject する経路は inner wrap が無いため AppError.from + logger.warn の組合せが正解
  - `useFullscreen.ts` 等の DOM API も同様
  - 個別判定が必要なため、本 finding では「明らかに repository / service 経由の AppError を再 wrap している箇所」のみ対象
- **テスト保護**: 該当 component の既存 unit test（特に `setError` の値を assert しているもの）。logger.warn の呼出回数を assert しているテストは現状ほぼ存在しないため、warn が 2→1 になっても fail しない。
- **リスク**: 観測動作変更なし。setError に渡る文字列は同一。logger.warn が 1 行減るだけ。

### finding-3: orchestrator.ts の write 関数 5 件が wrapFirestoreWrite 未適用

- **Lens**: architect
- **Severity**: low
- **場所**: `src/lib/services/seating/orchestrator.ts`
  - `autoSeatLateEntry` (L242-345)
  - `applyCascadeMoves` (L605-726)
  - `applySingleMove` (L728-843)
  - `applyTableBreak` (L845-958)
  - `setIsPlayingDealer` (L986-1088) — `if (e instanceof AppError)` の特殊処理あり
- **観察事実**: P3-1 で導入された `wrapFirestoreWrite` が未適用で、`try { ... } catch (e) { const wrapped = AppError.from(...); logger.warn(...); throw wrapped; }` の手書きパターンを維持。
- **影響**:
  - `firebase-patterns.md` の「repository の error wrap」推奨形と乖離（service 層も同方針）
  - 1108 行 → 約 30〜50 行短縮見込み
  - 新規 write 関数追加時にどちらが正解か迷う
- **案**: 5 関数を `wrapFirestoreWrite` 経由に書き換え。
  - `setIsPlayingDealer` は内部の `if (e instanceof AppError) throw e` 分岐を残す形で「wrap の中でさらに try/catch して AppError を re-throw」する方針（仕様維持）
  - `commitInitialSeating` は engine error の `instanceof` 分岐が tx 内 throw に依存しているため対象外（複雑度の割に得が少ない）
- **テスト保護**: `src/lib/services/seating/orchestrator.test.ts` の既存 fixture
- **リスク**: AppError code / message は完全に保持。logger.warn のメタ key 順が変わる可能性があるが既存テストは順序非依存。

### finding-4: 大型ファイル（300 行超）— 主に見送り

- **Lens**: architect
- **Severity**: low
- **場所**:
  - `src/lib/services/seating/orchestrator.ts` 1108 行
  - `src/lib/firebase/repositories/tournaments.ts` 824 行
  - `src/lib/services/group.ts` 669 行
  - `src/components/tournament/SeatingBoard.tsx` 562 行
  - `src/app/tournaments/[tid]/dashboard-client.tsx` 550 行
  - `src/lib/services/seating/engine.ts` 471 行
  - `src/app/groups/[gid]/group-detail-client.tsx` 406 行
- **観察事実**: いずれも **凝集度が高く** ドメイン単一。
  - orchestrator: 「席変更系の atomic write」で一貫
  - tournaments.ts: 16 個の export がすべて tournament CRUD / state transition / structure mutation
  - group.ts: group lifecycle / role / settings / season / join code
  - SeatingBoard.tsx: 既に内部で SeatingBoard / SeatRow / PlainSeat / DnDSeat / PdCheckbox に分割済み
  - dashboard-client.tsx: Phase 4 architect-refactor で既に hooks 抽出済み
  - group-detail-client.tsx: Phase 4 で `_components/` 抽出済み
- **判断**: **見送り**。orchestrator は finding-3 適用後に約 30〜50 行短縮で許容範囲に近づく。dashboard-client は finding-1 適用後にさらに 30 行短縮見込み。
- **理由**: ファイル分割は依存関係を縦にスライスするため、誤った分割は把握困難化を招く。`refactor-conventions.md` の閾値は「分割を検討」であり強制ではない。

### finding-5: 既知のセキュリティリスク（再掲・見送り）

- **Lens**: security
- **Severity**: low
- **場所**: `firestore.rules` の `groupJoinCodes` allow update
- **観察事実**: `group-membership.md` の「既知のセキュリティリスク」セクションに記録済み:
  > `maxUses` UI を追加する際の必須対応: ... Cloud Functions（Callable）化が現実解
- **判断**: **見送り**。default の `maxUses: null` 利用に留まる限り遅延可。Cloud Functions 化は本 refactor のスコープ外。
- **追加観察**: `group-membership.md` の `finishedTournamentCount` / `defaultSeatsPerTable` の任意値書換による嫌がらせも同方針で見送り。

## Severity 集計

- critical: 0 件
- high: 0 件
- medium: 2 件（finding-1, finding-2）
- low: 3 件（finding-3, finding-4, finding-5）

## 良かった点（正の所見）

- `wrapFirestoreWrite` / `unwrapOrFrom` / `getErrorCode` / `tournament-state.ts` 純関数 / `useGroupRole` などの集約済み helper が広範に活用されている
- Phase A / B / C / D の追加コードはいずれもテストファースト + 純関数化が徹底されている
- `firestore.rules` の subcollection は wildcard 廃止 + explicit branch 化が完了し、`affectedKeys` 列挙も全 9 ブランチで明示化済み
- OG image route / share button の入出力検証（zod schema + safeParse）が一貫
- 数値リミットの `src/lib/limits.ts` 集約と drift check（`scripts/test-rules-limits.mjs`）が機械化されている

## 次フェーズへ

→ Phase 3: 実施候補は finding-1 / finding-2 / finding-3 の 3 件。同 PRD 配下に plan を作成しユーザー承認後に Phase 4 着手する。
