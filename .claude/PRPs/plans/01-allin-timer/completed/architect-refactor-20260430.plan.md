# Plan: Architect Refactor — 2026-04-30

## Summary

`/architect-refactor` で実施した [監査レポート](../../reviews/architect-refactor-20260430.md) の 16 finding 全件（critical 0 / high 1 / medium 7 / low 8）を atomic な commit に分解し、**既存テスト網（unit 523 件 + E2E）を常に green に保ちながら段階的にリファクタリング**する計画。

**観測可能な動作変更は 0**。ユーザー体験 / 永続化フォーマット / Firestore スキーマ / URL / 環境変数の破壊的変更を一切起こさない。1 commit = 1 finding を原則とし、依存がある finding（`limits.ts` 集約 → repositories 移行 → wrap helper など）は 2-3 commit に分割する。

## Invariants（不変条件）

各 commit でこれらをすべて満たす:

1. `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` がすべて pass。
2. 既存 unit test 523 件のうち skip / disable / 削除なし。テストの書換は「実装の内部詳細に依存していた」ケースのみ、commit message に明記する。
3. 公開 API（pages / URL / Firestore schema / 招待コード文字列フォーマット / 環境変数）に破壊的変更なし。
4. プロジェクト規約（[firebase-patterns.md](../../../rules/firebase-patterns.md) / [error-logging.md](../../../rules/error-logging.md) / [security.md](../../../rules/security.md) / [group-membership.md](../../../rules/group-membership.md)）を維持。
5. `.claude/rules/` の更新は本リファクタで「定数の出所」「招待コード長」「allowed-keys 一覧表」を変更する commit と同じ commit に含める。

E2E は **(P0) 着手前** と **(P5) 最終検証** の 2 回走らせる。中間 commit では unit + typecheck + lint + build で代替する（emulator 起動コストを抑えるため）。

## Metadata

- **Complexity**: Large（11–14 commit、約 1,500–2,500 行の差分）
- **Source review**: [.claude/PRPs/reviews/architect-refactor-20260430.md](../../reviews/architect-refactor-20260430.md)
- **Branch**: `feature/hole-refactor`（既に存在 / clean）
- **Estimated Files Touched**: 約 25 file（src 配下 約 20 / scripts 1 / rules ドキュメント 2 / 新規 hooks/services/components 約 6）

## Phase 順序と依存関係

```
P0  baseline E2E（外部）
P1  安全網拡張（先行 / 1 commit + 1 commit）
     └─ tournament-state.test.ts（finding-5 の前提）
     └─ scripts/test-rules-limits.mjs（finding-2 の前提）
P2  共通基盤 — 定数集約とエラー helpers（2 commit）
     └─ limits.ts 集約 → finding-2 完了
     └─ errors.ts 拡張（unwrapOrFrom / getErrorCode） → finding-9 / 14 完了
P3  共通基盤 — repository wrap helper（2 commit）
     └─ wrap.ts 追加（テスト付き）
     └─ repositories 順次移行 → finding-4 完了
P4  state-machine 純関数化（1 commit）
     └─ tournament-state.ts 抽出 → finding-5 完了
P5  大物 component 分割（3 commit）
     └─ useInlineNumberEdit + group-detail 分割 → finding-1 完了
     └─ useFullscreen / useAutoFinish / useGroupRole + dashboard 分割 → finding-3 / 8 完了
     └─ TimerControls sub-components 化 → finding-13 完了
P6  微修正（5 commit、独立して並べられる）
     └─ useTournamentTimer fingerprint 化 → finding-6
     └─ attemptAnonymousSelfDelete 集約 → finding-7
     └─ 招待コード 25 文字化 → finding-12
     └─ defaultSeatsPerTable 等の dead fallback 削除 → finding-16
     └─ rules ドキュメント整備（コード変更なし） → finding-15
P7  最終検証 — E2E 全件再走行 + レポート出力
```

依存:

- P3 commit-2 は P3 commit-1 完了が前提。
- P4 は P1 commit-1（test 先行）が前提。
- P5 commit-1 は P2 commit-2 の `unwrapOrFrom` を使うが、未完でも依存はない（独立可）。
- P6 はすべて並列・独立で commit 可能。

## Atomic Tasks（commit 単位の詳細）

各タスクで以下をループする:

```
1. Edit / Write
2. npm run typecheck
3. npm run lint
4. npm test
5. （P5 大物分割の commit のみ）npm run build
6. 全部 green なら git add -p + 日本語 commit message
7. 1 つでも red なら revert / 再分割 / ユーザーに相談
```

---

### P0 — ベースライン E2E 走行（**プラン外で実施・既に開始済み**）

- ユーザー承認後にバックグラウンドで `npm run test:e2e` を起動済み。完了を待ってから P1 commit-1 着手。
- 既存 E2E が green であることを確認できれば、後段 commit でテストが落ちたとき「refactor 由来 vs 元から壊れていた」を切り分けられる。
- 万一 1 件でも fail した場合は P1 着手前にユーザーに報告し、修復するか / 計画を見直すかを相談。

---

### P1-1 — `tournament-state.ts` の characterization test 先行追加

**目的**: P4 の純関数抽出が「現状の挙動を一切変えない」ことを保証する safety net を先に置く。

**変更**:

- 新規: `src/lib/services/tournament-state.test.ts`
- 内容: `setup` / `seating` / `running` / `paused` / `finished` の 5 state について、現状 `dashboard-client.tsx` / `TimerControls.tsx` / `tournaments.ts` で書かれている条件式を pure function 仕様として記述。**この commit 時点では関数本体はまだ無い**ので test は import 経由で fail する想定だが、本 commit ではまず `expect.fail` を使わず、関数を仮実装（`return false` で OK）して green にする。
- 仮実装 file: `src/lib/services/tournament-state.ts` に下記の純関数を空で書く（return は spec が要求する trivial な値）。

  ```ts
  export function canEdit(t: TournamentDoc): boolean { /* TBD in P4 */ return t.state === "setup"; }
  export function canDelete(t: TournamentDoc): boolean { /* TBD */ ... }
  // ...
  ```

  これにより本 commit 時点で test が **green** になる。P4 で同 file の各 state guard 関数を本実装に置換し、呼出側を切り替える。

**テスト保護**: 自身が test。

**検証**: `npm test` で 523 + N pass を確認。

**Commit message プレビュー**:

```
test: tournament state-machine の characterization test を先行追加

Phase 4 リファクタの安全網として、各 state での canEdit / canDelete /
canBeginSeating / canConfirmSeating / canPause / canResume / canFinish /
isInProgress の挙動を pure function 仕様で固定化する。本実装は P4 で
dashboard-client / TimerControls / repositories から条件式を集約する際に行う。

trace: .claude/PRPs/plans/architect-refactor-20260430.plan.md (P1-1)
```

---

### P1-2 — `scripts/test-rules-limits.mjs` 追加（rules 内ハードコード値の lock）

**目的**: P2-1 で `limits.ts` を集約したあと、`firestore.rules` 内の数値リテラル（6 / 10）が drift しないことを機械検査。

**変更**:

- 新規: `scripts/test-rules-limits.mjs`
- 既存 `scripts/test-rules-finished-count.mjs` をモデルに、`firestore.rules` を読み込んで `tableNum <= 6` / `seatNum <= 10` / `defaultSeatsPerTable >= 2` / `defaultSeatsPerTable <= 10` の 4 リテラルを正規表現で検出 → 期待値と比較 → 不一致なら `process.exit(1)`。
- `package.json` の scripts に `"test:rules-limits": "node scripts/test-rules-limits.mjs"` を追加。
- `.claude/rules/firebase-patterns.md` の DRIFT WARNING セクションにスクリプト名を追記。

**テスト保護**: 自身が安全網。

**検証**: `npm run test:rules-limits` が green。

**Commit message プレビュー**:

```
test(rules): firestore.rules の数値リテラルを機械検査するスクリプトを追加

MAX_TABLES = 6 / MAX_SEATS_PER_TABLE = 10 が rules / engine / schemas で
drift しないように、rules 内のハードコード値を正規表現で抽出して期待値と
比較する scripts/test-rules-limits.mjs を追加する。Phase 4 で limits.ts に
集約したあと、CI でも回せるように package.json に script 追加。

trace: .claude/PRPs/plans/architect-refactor-20260430.plan.md (P1-2)
```

---

### P2-1 — `src/lib/limits.ts` 集約（finding-2）

**変更**:

- 新規: `src/lib/limits.ts`
  ```ts
  export const MIN_SEATS_PER_TABLE = 2;
  export const MAX_SEATS_PER_TABLE = 10;
  export const MAX_TABLES = 6;
  ```
- 編集:
  - `src/lib/services/seating/engine.ts:18` → `export const MAX_TABLES = 6;` を削除し、`limits.ts` 経由で再 export。
  - `src/lib/firebase/schemas/tournament.ts:44` → `.min(2).max(10)` を `.min(MIN_SEATS_PER_TABLE).max(MAX_SEATS_PER_TABLE)` に。
  - `src/lib/firebase/schemas/group.ts:84` → 同上。
  - `src/components/tournament/TournamentForm.tsx:35` → `DEFAULT_SEATS_PER_TABLE` は維持（9 はビジネスデフォルト）、ただし `min` / `max` 表示を limits.ts から。
  - その他 `2..10` リテラルが直書きされている箇所を grep で洗い出して全置換（service group.ts の `setDefaultSeatsPerTable` バリデーション等）。
- `firestore.rules` 自体はリテラル維持（ルール言語に const 機構はない）。`.claude/rules/firebase-patterns.md` の DRIFT WARNING に「`limits.ts` を真実源とする」と追記。

**テスト保護**: P1-2 の `test:rules-limits` + 既存 `engine.test.ts`。

**検証**: typecheck / lint / test / `npm run test:rules-limits`。

**Commit message プレビュー**:

```
refactor(limits): MAX_TABLES / MIN/MAX_SEATS_PER_TABLE を limits.ts に集約

engine.ts / schemas/tournament.ts / schemas/group.ts / service/group.ts /
TournamentForm.tsx に分散していた 6 / 2 / 10 のリテラルを src/lib/limits.ts に
集約。firestore.rules は言語制約のためリテラル維持だが、scripts/
test-rules-limits.mjs で drift を機械検査する。

trace: .claude/PRPs/plans/architect-refactor-20260430.plan.md (P2-1)
```

---

### P2-2 — `errors.ts` に `unwrapOrFrom` / `getErrorCode` 追加（finding-9 / 14）

**変更**:

- 編集: `src/lib/errors.ts`
  ```ts
  export function unwrapOrFrom(e: unknown, code: string, message: string): AppError {
    return e instanceof AppError ? e : AppError.from(e, code, message);
  }
  export function getErrorCode(e: unknown): string {
    if (e instanceof AppError) return e.code;
    if (e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string") {
      return (e as { code: string }).code;
    }
    return "unknown";
  }
  ```
- 編集（呼出側）:
  - `src/app/tournaments/[tid]/dashboard-client.tsx:347-362` → `unwrapOrFrom` で 1 行化。
  - `src/lib/services/current-group.tsx:103` → `getErrorCode(reason)` 利用。
  - `src/app/tournaments/[tid]/live/live-client.tsx:97-102` → `getErrorCode(e)` 利用。
  - `src/lib/services/group.ts:159-167` → `getErrorCode(reason)` 利用。
- 新規: `src/lib/errors.test.ts` に 2 helper のテスト追加。

**テスト保護**: 既存 `errors.test.ts`。

**検証**: typecheck / lint / test。

**Commit message プレビュー**:

```
refactor(errors): unwrapOrFrom / getErrorCode helper を追加し重複を解消

- unwrapOrFrom: AppError なら素通し、それ以外を AppError.from する。
  dashboard-client の updateAudioSettings 二重 wrap を 1 行に圧縮。
- getErrorCode: unknown から code 文字列を安全に取り出す helper。
  current-group / live-client / services/group の手書き型ガードを置換。

trace: .claude/PRPs/plans/architect-refactor-20260430.plan.md (P2-2)
```

---

### P3-1 — `src/lib/firebase/wrap.ts` 追加（finding-4 の基盤）

**変更**:

- 新規: `src/lib/firebase/wrap.ts`
  ```ts
  export async function wrapFirestoreWrite<T>(
    code: string,
    message: string,
    op: () => Promise<T>,
    meta?: Record<string, unknown>,
  ): Promise<T> {
    try {
      return await op();
    } catch (e) {
      const wrapped = AppError.from(e, code, message);
      logger.warn(wrapped.message, { code: wrapped.code, ...meta });
      throw wrapped;
    }
  }
  // wrapFirestoreRead も同形（logger.warn の meta を {tid, ...meta} で拡張）
  ```
- 新規: `src/lib/firebase/wrap.test.ts`（成功 / 失敗 / AppError 透過の 3 ケース）。

この commit では wrap.ts 自体だけを追加し、repositories はまだ移行しない（独立 commit にして revert 容易性を確保）。

**テスト保護**: 自身が test。

**検証**: typecheck / lint / test。

**Commit message プレビュー**:

```
refactor(firebase): wrapFirestoreWrite / wrapFirestoreRead helper を追加

repositories で 30+ 箇所反復している try/catch + AppError.from + logger.warn の
3 行ボイラープレートを集約する higher-order helper。本 commit では helper の
追加と test のみで、repository 側の移行は次 commit で順次実施する。

trace: .claude/PRPs/plans/architect-refactor-20260430.plan.md (P3-1)
```

---

### P3-2 — repositories の `wrapFirestoreWrite` / `wrapFirestoreRead` 移行（finding-4）

**変更**:

- 編集: `src/lib/firebase/repositories/*.ts` 9 file
  - `tournaments.ts` / `groups.ts` / `players.ts` / `tables.ts` / `users.ts` / `groupJoinCodes.ts` / `structures.ts` / `structureTemplates.ts` / `templateAdmins.ts`
- 各関数で:
  ```ts
  // before
  try {
    await updateDoc(...);
    logger.info("...ok", {...});
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "...");
    logger.warn(wrapped.message, { code: wrapped.code, ... });
    throw wrapped;
  }
  
  // after
  await wrapFirestoreWrite("firestore/write_failed", "...", async () => {
    await updateDoc(...);
  }, { gid });
  logger.info("...ok", {...});
  ```
  `logger.info` は wrap の外（成功時のみ）に残す。
- transaction を含む関数（`finishTournament` / `commitInitialSeating` / `consumeJoinCode` 等）も同様だが、tx 内 throw を warn ログに変えない方針を維持（既存挙動を厳密に保つ）。
- repository 単位で動作確認するため、可能なら **2 file ずつ** で sub-commit 分割するのも可（safer）。本計画では「順次移行 1 commit」として扱うが、実装中に diff が膨れる場合は分割。

**テスト保護**: 既存 repository test 群（`templateAdmins.test.ts` / `players.test.ts` / `tables.test.ts` / `structureTemplates.test.ts`）が code / message を assert している。

**検証**: typecheck / lint / test。テスト全 523 件 + P1-1 の N 件が green。

**Commit message プレビュー**:

```
refactor(repositories): mutation/read を wrapFirestoreWrite/Read 経由に統一

repositories/{tournaments,groups,players,tables,users,groupJoinCodes,
structures,structureTemplates,templateAdmins}.ts の try/catch ラップを
helper 経由に置換。挙動は完全等価（throw する AppError の code / message /
warn ログの code / meta すべて同一）。tx 内の skipReason / race ログは保持。

trace: .claude/PRPs/plans/architect-refactor-20260430.plan.md (P3-2)
```

---

### P4 — `tournament-state.ts` 純関数化（finding-5）

**変更**:

- 編集: `src/lib/services/tournament-state.ts` の P1-1 仮実装を本実装に置換。
- 編集: 呼出側
  - `src/lib/firebase/repositories/tournaments.ts` の各遷移関数（`beginSeating` / `confirmSeating` / `pauseTournament` / `resumeTournament` / `advanceLevel` / `revertLevel` / `finishTournament` / `deleteTournament`）の `if (t.state !== ...) throw new AppError("...", "tournament/invalid-state")` を `if (!canX(t)) throw ...` に置換。
  - `src/components/tournament/TimerControls.tsx` の `if (tournament.state === "setup") { ... }` ブランチを残しつつ、内部のボタン disable 判定を `canX(tournament)` で。
  - `src/app/tournaments/[tid]/dashboard-client.tsx:253-261` の `canEdit` / `canDelete` / `showSeatingBoard` / `showBalancing` を import 経由に。
- `tournament-state.test.ts`（P1-1）の `expect` を本実装の挙動に合わせて拡張（必要に応じて）。

**テスト保護**: P1-1 + 既存 E2E。

**検証**: typecheck / lint / test。

**Commit message プレビュー**:

```
refactor(tournament-state): state ごとの許可判定を純関数に集約

dashboard-client / TimerControls / repositories/tournaments に分散していた
tournament.state 条件式を src/lib/services/tournament-state.ts に集約。
P1-1 で先行追加した characterization test が green を維持することで
挙動が変わっていないことを担保する。

trace: .claude/PRPs/plans/architect-refactor-20260430.plan.md (P4)
```

---

### P5-1 — `useInlineNumberEdit` + `group-detail-client.tsx` 分割（finding-1）

**変更**:

- 新規: `src/lib/hooks/useInlineNumberEdit.ts`（汎用 hook + test）
  - props: `{ initialValue, validate, save, ariaLabel }`
  - return: `{ editing, value, inputRef, start, cancel, onSubmit, onChange, onKeyDown, error }`
- 新規 component: `src/components/group/InlineNumberEditCard.tsx`
  - title / description / unit suffix（"回" / "席"）/ min / max を props で受ける汎用カード
- 新規ファイル分割（`src/app/groups/[gid]/_components/`）:
  - `GroupHeaderCard.tsx`（rename inline edit）
  - `FinishedCountCard.tsx`（finishedTournamentCount）
  - `DefaultSeatsCard.tsx`（defaultSeatsPerTable）
  - `MemberRoleList.tsx`（3 階層ロール操作）
  - `InviteCodeCard.tsx`（招待コード発行）
  - `LeaveDeleteDialogs.tsx`（leave + delete dialog）
- `group-detail-client.tsx` を 786 → 約 150 行（state 統合 + 子コンポ並べ）に圧縮。

**テスト保護**: `tests/e2e/groups-navigation.spec.ts` / `member-role-split.spec.ts` / `dashboard-polish.spec.ts`。新規 unit test として `useInlineNumberEdit.test.tsx` を追加。

**検証**: typecheck / lint / test / **build**（ファイル数増加のため Next.js build を確認）。

**Commit message プレビュー**:

```
refactor(group-detail): useInlineNumberEdit hook と子 component に分割

786 行のサークル詳細 client を以下に分割:
- useInlineNumberEdit: inline 数値編集の編集状態 / validate / save 共通化
- InlineNumberEditCard: タイトル + 単位 + min/max を持つ汎用カード
- GroupHeaderCard / FinishedCountCard / DefaultSeatsCard /
  MemberRoleList / InviteCodeCard / LeaveDeleteDialogs

UI は完全に同一。E2E (groups-navigation / member-role-split /
dashboard-polish) が安全網。

trace: .claude/PRPs/plans/architect-refactor-20260430.plan.md (P5-1)
```

---

### P5-2 — `useFullscreen` / `useAutoFinish` / `useGroupRole` 抽出 + `dashboard-client.tsx` 分割（finding-3 / 8）

**変更**:

- 新規 hooks（`src/lib/hooks/`）:
  - `useFullscreen.ts` — `document.fullscreenElement` の購読と `requestFullscreen` / `exitFullscreen` のラッパ
  - `useAutoFinish.ts` — winner 検出時に 2 秒待って `finishTournament` を呼ぶ effect
  - `useTournamentRoleRedirect.ts` — owner / organizer 以外を `/live` へ replace
- 新規: `src/lib/services/current-group.tsx` から `useGroupRole(gid: string | null | undefined): MemberRole | null` を export
- 編集: `dashboard-client.tsx` を 455 → 約 200 行に圧縮。
- 編集: `live-client.tsx` の role 判定を `useGroupRole` に置換。
- 編集: `useAudioPlayer.ts` 呼出側（dashboard / live）の role 算出を `useGroupRole` に置換。

**テスト保護**: `tests/e2e/winner-banner-and-auto-finish.spec.ts` / `dashboard-polish.spec.ts` / `timer-control-polish.spec.ts` / `member-role-split.spec.ts`。新規 unit test として `useFullscreen.test.tsx`。

**検証**: typecheck / lint / test / build。

**Commit message プレビュー**:

```
refactor(dashboard): useFullscreen / useAutoFinish / useGroupRole 抽出

dashboard-client.tsx の 455 行 / hook 5 個縦積みを以下に分割:
- useFullscreen: Fullscreen API toggle + 状態購読
- useAutoFinish: winner 検出 → 2 秒後 finishTournament
- useGroupRole(gid): tournament の groupId に対する自分の role を導出
  current-group.tsx から export し、dashboard / live / useAudioPlayer 呼出側で再利用

UI / 挙動は完全等価。E2E (winner-banner-and-auto-finish /
dashboard-polish / timer-control-polish / member-role-split) が安全網。

trace: .claude/PRPs/plans/architect-refactor-20260430.plan.md (P5-2)
```

---

### P5-3 — `TimerControls` を sub-components に分割（finding-13）

**変更**:

- 新規（`src/components/tournament/_timer-controls/`）:
  - `TimerControlsSetup.tsx`
  - `TimerControlsSeating.tsx`
  - `TimerControlsRunningPaused.tsx`
  - `TimerControlsFinished.tsx`
- 編集: `TimerControls.tsx` を `busy` state + `run()` helper + 共通 chrome（fullscreen / connection / audio）を持つ親 component に縮小し、state ごとに sub-component を render。
- 365 → 約 150 行（親） + 各子 50–100 行に分散。

**テスト保護**: `tests/e2e/timer-control-polish.spec.ts` / `winner-banner-and-auto-finish.spec.ts`。

**検証**: typecheck / lint / test / build。

**Commit message プレビュー**:

```
refactor(timer-controls): state branch を sub-components に分割

TimerControls.tsx の 365 行 / 4 state branch を以下に分割:
- TimerControlsSetup / Seating / RunningPaused / Finished の 4 子 component
- 親 component は busy state / run() helper / 共通 chrome
  (fullscreen / connection / audio) のみを保持

UI / aria-label / disabled 条件 / busy 表示はすべて等価。

trace: .claude/PRPs/plans/architect-refactor-20260430.plan.md (P5-3)
```

---

### P6-1 — `useTournamentTimer` の autoAdvance dep を fingerprint 化（finding-6）

**変更**:

- 編集: `src/lib/hooks/useTournamentTimer.ts:121`
  - `options.autoAdvance` object を deps から外し、`autoUid = options.autoAdvance?.uid ?? null` / `autoGroupIdsKey = options.autoAdvance?.userGroupIds.join(",") ?? null` を `useMemo` で派生して deps に。
- 新規 unit test: `src/lib/hooks/useTournamentTimer.test.tsx`（最低限：mock subscribe で autoAdvance 試行回数を assert）。

**検証**: typecheck / lint / test。

**Commit message プレビュー**:

```
refactor(timer-hook): useTournamentTimer の autoAdvance dep を primitive 化

options.autoAdvance object 参照を deps に直接入れていたため、呼出側が
inline で { uid, userGroupIds: groupIds } を渡すと毎レンダで新参照になり
effect が再 fire する。useSeatingAutoOrchestrator と同じ fingerprint
パターン (uid / groupIdsKey) で安定化。
advanceInflightRef での抑止は維持されているため動作変更はないが、無駄な
transaction 試行が減る。

trace: .claude/PRPs/plans/architect-refactor-20260430.plan.md (P6-1)
```

---

### P6-2 — `attemptAnonymousSelfDelete` 集約（finding-7）

**変更**:

- 編集: `src/lib/services/auth-actions.ts` に追加:
  ```ts
  export async function attemptAnonymousSelfDelete(
    user: User,
    contextLabel: string,
  ): Promise<void> { /* deleteUserProfile + user.delete + logger.info / warn */ }
  ```
- 編集: `auth-actions.ts:298-322` (logout) / `receipt.ts:163-178` (cancelOwnEntry) / `live-client.tsx:84-105` (finished 検知) を helper 呼出に統一。
- 既存 logger.info / warn メッセージは `contextLabel` 付きで等価に保つ。

**テスト保護**: `tests/e2e/anonymous-self-delete.spec.ts`。

**検証**: typecheck / lint / test。

**Commit message プレビュー**:

```
refactor(anon-cleanup): attemptAnonymousSelfDelete を auth-actions に集約

logout / cancelOwnEntry / live-client (finished 検知) の 3 か所に
重複していた「匿名ユーザーの users/{uid} + auth.user.delete()」を helper
関数に集約。各呼出箇所は contextLabel ("logout" / "cancel" / "finish") を
渡すだけ。E2E (anonymous-self-delete) が安全網。

trace: .claude/PRPs/plans/architect-refactor-20260430.plan.md (P6-2)
```

---

### P6-3 — 招待コード長を 25 文字に拡張（finding-12）

**変更**:

- 編集: `src/lib/firebase/repositories/groupJoinCodes.ts:29` `CODE_LENGTH = 16` → `25`
- 既存の 16 文字コード（DB 上に残存）は読込・消費パスで長さチェックを行わないため互換維持される。新規発行のみ 25 文字に。
- 編集: `.claude/rules/security.md` の「招待コード設計原則」を「base36・25 文字 ≈ 129 bit のランダム値」に更新。

**テスト保護**: `tests/e2e/organizer-self-join.spec.ts` / `nav-and-sound-toggle.spec.ts`（招待コード経路）。

**検証**: typecheck / lint / test。

**Commit message プレビュー**:

```
fix(security): 招待コードのエントロピーを 82bit → 129bit に増強

security.md の「128bit 以上のランダム値」要件を満たすため、
groupJoinCodes の CODE_LENGTH を 16 → 25 に拡張する (base36 で
25 × log2(36) ≈ 129 bit)。既存の 16 文字コードは長さチェックなしで
互換消費可能。security.md の記述も実装に合わせて更新。

trace: .claude/PRPs/plans/architect-refactor-20260430.plan.md (P6-3)
```

---

### P6-4 — `?? 9` / `?? 0` の dead fallback を削除（finding-16）

**変更**:

- 編集: `src/app/groups/[gid]/_components/DefaultSeatsCard.tsx`（P5-1 で分割済）
- 編集: `src/app/groups/[gid]/_components/FinishedCountCard.tsx`（P5-1 で分割済）
- `g.defaultSeatsPerTable ?? 9` / `g.finishedTournamentCount ?? 0` を直接 number として扱う。
- schema コメントに「常に hydrate される」旨を追記。

**検証**: typecheck / lint / test。

**Commit message プレビュー**:

```
refactor(dead-code): defaultSeatsPerTable / finishedTournamentCount の
dead fallback を削除

schema の z.number().int().nonnegative().default(0) /
.default(9) で必ず number に hydrate されるため、UI 側の ?? 0 / ?? 9 は
dead code。schema コメントで invariant を明示。

trace: .claude/PRPs/plans/architect-refactor-20260430.plan.md (P6-4)
```

---

### P6-5 — `firebase-patterns.md` に `affectedKeys` 一覧表を追加（finding-15）

**変更**:

- 編集: `.claude/rules/firebase-patterns.md`
  - 新セクション「`groups/{gid}` の update branch ごとの allowed-keys」表を追加
  - 各 branch（owner-update / self-add / self-leave / self-key memberDisplayNames / audioSettings / finishedTournamentCount / defaultSeatsPerTable）の許可キー一覧を表形式で
  - 「新規フィールド追加時は必ずこの表を更新し、`scripts/test-rules-*` のいずれかでテストすること」を明記
- コード変更なし。

**検証**: 不要（doc のみ）。

**Commit message プレビュー**:

```
docs(rules): groups update branch の allowed-keys 一覧表を追加

firestore.rules の groups update は 7 branch あり、各 branch で
affectedKeys().hasOnly([...]) を別々に列挙している。新規フィールド
追加時の見落としを防ぐため、firebase-patterns.md に表形式の一覧を追加。
Phase 4.16 で発覚した「self-* update の affectedKeys 抜け」型のバグを
構造的に防ぐための運用ルール強化。

trace: .claude/PRPs/plans/architect-refactor-20260430.plan.md (P6-5)
```

---

### P7 — 最終検証 + レポート出力

**作業**:

- 全 commit が積み終わった状態で:
  1. `npm run typecheck` / `npm run lint` / `npm test` / `npm run test:rules-limits` / `npm run build` を全件再走行 → 全 green 確認
  2. `npm run test:e2e` を再走行 → 全 green 確認
  3. `git log --oneline <baseline>..HEAD` で commit が atomic な単位で並んでいることを確認
- レポート生成: `.claude/PRPs/reports/architect-refactor-20260430.md`（[テンプレート](../../../skills/architect-refactor/references/report-template.md) 準拠）
- ユーザーに PR 起票の意向を確認（必要なら `/prp-pr` を促す）

## ロールバック戦略

- 各 commit は revert 1 つで安全に戻せる粒度。
- 大物分割（P5-1 / P5-2 / P5-3）で E2E 異常を観測した場合、当該 commit を `git revert` し、内部的にさらに細分化（hook だけ追加 → 呼び出し置換 → 旧コード削除）して再挑戦する。
- P6-3（招待コード長拡張）は破壊的に見えるが既存コード互換のため revert 不要だが、万一新規発行コードに問題があれば revert で 16 文字に戻る。

## 中断時の再開手順

途中で中断した場合、`git log --oneline feature/hole-refactor` で完了済み commit を確認し、本 plan の P0–P7 の対応箇所から再開する。各 commit は他に依存しないため（P3-2 → P3-1、P4 → P1-1、P6-4 → P5-1 を除く）、順序入れ替えは可能。

## 期待成果

- `group-detail-client.tsx` 786 → 約 150 行
- `dashboard-client.tsx` 455 → 約 200 行
- `TimerControls.tsx` 365 → 約 150 行
- repositories の boilerplate 30+ 箇所削減
- `tournament.state` 条件式の単一真実源化
- `MAX_TABLES` / `MAX_SEATS_PER_TABLE` 等の単一真実源化
- 招待コードのエントロピー 82bit → 129bit
- 観測可能な動作変更: **0**
- 新規 unit test: 5–7 個追加（hook test + state-machine spec + wrap helper）
