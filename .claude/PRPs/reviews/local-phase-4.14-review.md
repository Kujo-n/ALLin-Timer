# ローカルレビュー: Phase 4.14 — ダッシュボード／サイドバー UX 改善

**レビュー日**: 2026-04-26
**ブランチ**: `develop`（未コミット）
**判定**: APPROVE（指摘事項のうち修正可能なものは反映済み）

## 総評

専門エージェント 2 種（typescript-reviewer / silent-failure-hunter）に並行レビューを依頼し、17 ファイルの差分を確認した。HIGH と判定された 1 件は誤検知、MEDIUM 2 件と LOW 1 件は妥当な指摘で、コミット前に in-tree で修正済み。残る項目は将来対応の検討メモとして記録する。

## 指摘事項

### CRITICAL

なし。

### HIGH

確定した HIGH なし。

**【誤検知】`onDelete` が内側 `AppError` を上書きしている**（typescript-reviewer 指摘）
[src/app/tournaments/[tid]/dashboard-client.tsx:217-225](src/app/tournaments/[tid]/dashboard-client.tsx#L217-L225)

`AppError.from(e, "firestore/write_failed", "削除失敗")` で内側の `tournament/in-progress` 等が握り潰されると指摘された。しかし [src/lib/errors.ts:11-15](src/lib/errors.ts#L11-L15) の実装で `if (error instanceof AppError) return error;` により、既に `AppError` 化されているエラーはそのまま返される。`setError` には内側の code / message が伝わるため、**修正不要**と判定。

### MEDIUM

1. **`subscribeTournamentsByGroup` の素の `catch {}` が原エラーを破棄**（silent-failure-hunter 指摘）— **修正済み**
   [src/lib/firebase/repositories/tournaments.ts:438-446](src/lib/firebase/repositories/tournaments.ts#L438-L446)

   元の `catch { logger.warn(...) }` は SDK / Zod の元エラーを丸ごと捨てていた。`catch (e)` に変更して `AppError.from(e, "firestore/invalid-data", ...)` でラップ、`code` をメタデータに添えて `logger.warn` するように修正（`listTournamentsByGroup` と同じパターン）。

2. **`canDelete` で `isMember` を冗長に AND 連結**（typescript-reviewer 指摘）— **修正済み**
   [src/app/tournaments/[tid]/dashboard-client.tsx:243-247](src/app/tournaments/[tid]/dashboard-client.tsx#L243-L247)

   描画到達時点で 244 行目の `isOrganizer` ガードが成立しているため `isMember` は常に true。`data.state === "setup" || data.state === "finished"` だけに簡略化し、上流ガードに依存する旨をコメントで補足した。

3. **`subscribeTournamentsByGroup` がクライアント側で state フィルタしている**（typescript-reviewer 指摘）
   [src/components/nav/PrimaryNav.tsx:60-63](src/components/nav/PrimaryNav.tsx#L60-L63)

   `where("state", "in", [...])` を付けず、`groupId` 一致の全件を取得して `seating|running|paused` をクライアント側で抽出している。本プロジェクトの想定スケール（月 1〜2 回・20 人前後）では問題にならず、複合インデックス追加も避けられる。**将来 finished/setup の蓄積が増えた場合の検討項目**として記録、本 PR では変更しない。

### LOW

1. **`refreshGroups()` がトグル成功時の try/catch 内に入っていた**（silent-failure-hunter 指摘）— **修正済み**
   [src/app/tournaments/[tid]/dashboard-client.tsx:348-368](src/app/tournaments/[tid]/dashboard-client.tsx#L348-L368)

   音声書込みのエラー経路と再読込のエラー経路が同じ `catch` に紐付き、コメントの「best-effort で握る」意図と乖離していた。`updateAudioSettings` の `await` を `try/catch` 内に残し、失敗時は `setError` → `return`、成功時のみ `void refreshGroups()` で fire-and-forget するように分離。

2. **PrimaryNav の購読エラー後に自動復旧経路がない**
   [src/components/nav/PrimaryNav.tsx:62-67](src/components/nav/PrimaryNav.tsx#L62-L67)

   `onError` で `[]` をセットして `logger.warn` するのみ。再試行 / バックオフは未実装。`currentGroupId` 切替で再 subscribe される設計のため運用上の影響は小さいが、ページ再読込せずに同一マウントで復帰させる経路はない。**現スケールでは許容**。

3. **Firestore Rules の atomic 評価に関するコメントが断定しすぎ**
   [src/lib/firebase/repositories/tournaments.ts:475-481](src/lib/firebase/repositories/tournaments.ts#L475-L481)

   「`exists()` は当該 request 開始時点を見るため同 batch 内で親 doc を最後に delete しても sub-collection delete は許容される」というコメントは、Firebase 公式ドキュメントの明記に拠るものではない。Plan 側で本件はリスクとしてフォローアップ計画（2 段階 commit へのフォールバック）も用意済み。エミュレータテスト緑のため**今回は変更せず**、Plan / Report で扱う扱い。

4. **`previewBreakInfo` で Lv 1 自身が break のとき `levelsAhead: 0` を返す**
   [src/components/tournament/NextBreakCard.tsx:41-43](src/components/tournament/NextBreakCard.tsx#L41-L43)

   「あと 0 レベル」と表示される退化ケース。実運用のストラクチャでは Lv 1 を break にしないため顕在化しない。**修正なし**。

5. **`toggleFullscreen` に `typeof document` ガードがなく effect 側と非対称**
   [src/app/tournaments/[tid]/dashboard-client.tsx:99-110](src/app/tournaments/[tid]/dashboard-client.tsx#L99-L110)

   client component の `onClick` 内でしか呼ばれないため SSR 経路に乗らない。スタイル上の非対称性のみで、実害なし。**修正なし**。

## 検証結果（修正反映後）

| 検査       | 結果 |
| ---------- | ---- |
| 型チェック | Pass |
| Lint       | Pass |
| 単体テスト | Pass（unit 全体 483 件、tournaments.test 単体 55 件を再実行） |
| ビルド     | Pass（修正前に 1 度実行、本修正は API 変更を伴わない局所修正のため再実行は省略） |
| 統合 (E2E) | スキップ — エミュレータ依存、CI で実行 |

## レビュー対象ファイル（変更ありのみ）

- `src/app/tournaments/[tid]/dashboard-client.tsx`（修正反映済み）
- `src/app/tournaments/[tid]/live/live-client.tsx`
- `src/components/nav/PrimaryNav.tsx`
- `src/components/nav/nav-items.ts`
- `src/components/tournament/{NextBreakCard,AverageStackCard,PlayersCard}.tsx`
- `src/components/tournament/{NextBreakCard,AverageStackCard,PlayersCard}.test.tsx`
- `src/lib/firebase/repositories/tournaments.ts`（修正反映済み）
- `src/lib/firebase/repositories/tournaments.test.ts`
- `tests/e2e/{audio-settings,nav-and-sound-toggle,timer-control-polish,winner-banner-and-auto-finish}.spec.ts`
- `tests/e2e/pages/TournamentsPage.ts`
