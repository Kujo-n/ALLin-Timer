# Architect Refactor 実装計画 — 20260507

## 起点

監査結果: [.claude/PRPs/02-season-stats-and-share/reviews/architect-refactor-20260507.md](../reviews/architect-refactor-20260507.md)

ベースライン: typecheck / lint / unit (1030) / build / e2e (65) すべて green
作業ブランチ: `refactor/full-scope-20260507`

## 不変条件（再掲）

1. 既存テストは常に green に戻す（中間 commit でも red のまま次に進まない）
2. 観測可能な動作変更は 0
3. 公開 API（URL / Firestore スキーマ / 環境変数 / 永続化フォーマット）は変更しない
4. 1 commit = 1 atomic refactor
5. プロジェクト固有ルール（`.claude/rules/`）優先
6. コミットメッセージは日本語（type prefix のみ英語）

## タスク順序の原則

1. 構造的な土台（純関数 helper）の抽出を先に行う
2. 上流から下流へ（service / repository → component / hook）
3. 各タスク後に typecheck / lint / unit を必ず走らせる。重い E2E は finding 群を全部終えた後に Phase 5 で 1 回だけ実施。

## タスク分解

### T1: og-payload に share-input builder 純関数を追加（characterization first）

**finding-1 の安全網先行投入**。新しい純関数を導入し、テストで仕様を固定化。後段で UI から呼び出す。

- 追加対象: `src/app/api/og/_lib/og-payload.ts`
  - `buildWinnerShareInputs(tid: string, params: { winnerName, tournamentName, participants, finishedAt: Date }): { url, filenameStem }`
  - `buildSeasonShareInputs(gid: string, group: { name, seasonStartDate }, stats: readonly { displayName, totalPoints }[]): { url, filenameStem } | null`
    - `stats.length === 0` → null（ガード簡略化）
    - top1〜top3 抽出は内部で
- 追加テスト: `src/app/api/og/_lib/og-payload.test.ts`
  - winner: 既知 fixture から `{ url, filenameStem }` の同型比較
  - season: 1〜3 件の stats / 開始日 null・有 / の matrix
  - sanitize 結果と date format（`sv-SE` / `ja-JP`）が既存 download/share 経路と一致
- 振る舞い変更: なし（呼出側はまだ未差替）
- 想定差分: +約 80 LOC（実装 + テスト）
- commit: `refactor(og): ShareCard 用 URL/filename 計算を純関数に抽出`

### T2: WinnerCardDownloadButton と SeasonTopCardDownloadButton を T1 helper 経由に

**finding-1 の上流側適用**。既存 download ボタンが新 helper を経由する形に書き換え。

- 編集対象:
  - `src/components/tournament/WinnerCardDownloadButton.tsx` → `buildWinnerShareInputs` から `url` / `filenameStem` を受け取る形へ
  - `src/components/group/SeasonTopCardDownloadButton.tsx` → `buildSeasonShareInputs` から同様に受け取る形へ
- 既存テスト（`WinnerCardDownloadButton.test.tsx` / `SeasonTopCardDownloadButton.test.tsx`）が同 URL を返すことで自動的に validate
- 振る舞い変更: なし
- commit: `refactor(share): download ボタンを buildXxxShareInputs helper 経由に統一`

### T3: dashboard-client / season-ranking-client の二重計算を解消（finding-1 完了）

**finding-1 の下流側適用**。ShareCardButton 用にローカル計算していた箇所を T1 helper 経由に切替。

- 編集対象:
  - `src/app/tournaments/[tid]/dashboard-client.tsx:362-403` — IIFE を `buildWinnerShareInputs` 呼出に置換
  - `src/app/groups/[gid]/season/season-ranking-client.tsx:117-162` — IIFE を `buildSeasonShareInputs` 呼出に置換
  - 不要な import（`formatDateForFilename` / `formatDateForLabel` / `sanitizeFilename` / `buildXxxCardUrl` / `SeasonCardQuery` 等）を削除
- 振る舞い変更: なし
- 想定差分: -約 80 LOC（コメント含む）
- commit: `refactor(client): ShareCardButton 用 URL/filename 計算を helper に集約し dashboard / season-ranking の二重化を解消`

### T4: client component の二重 warn を unwrapOrFrom に集約（finding-2）

**finding-2 適用**。client 側で `AppError.from + logger.warn` を行っていた箇所を `unwrapOrFrom + setError` に書き換える。

判定基準（safety net）:
- catch している throw 元が repository / service の wrap 経由なら → `unwrapOrFrom` 化、`logger.warn` 削除
- catch している throw 元が外部 API（DOM / WebAudio / fetch）なら → 既存形維持

対象（current scan の高確信度ヒット）:
- `src/app/groups/[gid]/group-detail-client.tsx`
  - L121 (`getGroup`)
  - L196 (`generateJoinCode`)
  - L224 (`leaveGroup`)
  - L241 (`deleteGroupByOwner`)
  - L258 (`startNewSeason`)
  - L274 (`promoteToOrganizer` / `demoteToMember` / `promoteToOwner` / `demoteOwner`)
- `src/app/tournaments/[tid]/dashboard-client.tsx:185-187` (`deleteTournament`)
- `src/app/groups/[gid]/season/season-ranking-client.tsx:48-50` (`getGroup`)
- `src/app/tournaments/[tid]/edit/tournament-edit-client.tsx`
- `src/app/templates/[tid]/edit/template-edit-client.tsx`
- `src/components/tournament/BalancingInstructionCard.tsx`

各ファイルを順に Read → 該当箇所を確認 → 該当する場合のみ書換。

判定が曖昧な箇所はスキップして commit メッセージに「次回フォロー」と明記。

- 振る舞い変更: なし（setError 文字列は同一 / logger.warn が 1 行 → 0 行）
- 想定差分: -数十行（catch 内 `logger.warn` 行と `wrapped` 変数の整理）
- commit: `refactor(errors): client 側で wrap 済み AppError を unwrapOrFrom 化し二重 warn を解消`

### T5: orchestrator の write 関数 5 件を wrapFirestoreWrite 経由に（finding-3）

- 編集対象: `src/lib/services/seating/orchestrator.ts`
  - `autoSeatLateEntry` (L242-345)
  - `applyCascadeMoves` (L605-726)
  - `applySingleMove` (L728-843)
  - `applyTableBreak` (L845-958)
  - `setIsPlayingDealer` (L986-1088) — 内部 `if (e instanceof AppError)` 分岐は wrap の中で保持
  - `commitInitialSeating` は対象外（engine error 特殊処理あり）
- パターン:
  ```ts
  // before
  try {
    await runTransaction(...);
    logger.info("...");
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "...");
    logger.warn(wrapped.message, { code: wrapped.code, ... });
    throw wrapped;
  }

  // after
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "...",
    async () => { await runTransaction(...); },
    { tid },
  );
  logger.info("...");
  ```
- skipReason ベースの no-op 経路（`if (!applied) { logger.info(...skipped...); return ... }`）は wrap の外で記述（成功 info と同じく）
- `setIsPlayingDealer` は AppError instance check を wrap の中で `try/catch` し、AppError なら `throw e` で素通し、それ以外なら raw error を wrap に投げる形式
- 振る舞い変更: なし（AppError code / message 完全保持）
- 既存 `src/lib/services/seating/orchestrator.test.ts` で validate
- commit: `refactor(seating): orchestrator の write 関数を wrapFirestoreWrite に集約`

## 検証ループ（各 task ごと）

```
1. Edit / Write
2. npm run typecheck
3. npm run lint
4. npm test
5. npm run build （T3 / T5 のみ。bundle サイズ影響を確認）
6. 全 green なら git add 個別ファイル + 日本語コミット
7. 1 つでも red → revert / 分割 / 修正
```

T1〜T5 の全 commit 完了後、Phase 5 で:

```
A. npm run typecheck / lint / test / build
B. npm run test:e2e （emulator 起動含めて約 7 分）
C. git log --oneline base..HEAD で atomic commit が並ぶことを確認
D. レポートを `.claude/PRPs/02-season-stats-and-share/reports/architect-refactor-20260507.md` に書き出し
```

## 想定総差分

- LOC: ±数百行（差し引き -50 〜 -100 LOC 程度）
- 新規ファイル: 0
- 削除ファイル: 0
- 観測可能な動作変更: 0
- ログ行数（warn）: 数十行 / イベント減
- E2E の影響: 0（テスト全数維持）

## ロールバック

各 commit は `git revert` 1 つで個別に巻き戻せる粒度。万が一統合段階で問題が発覚した場合は branch 全体を破棄して develop に戻す（破壊的操作はユーザー承認後）。

## ユーザー承認

着手前に上記計画の承認をお願いします。
