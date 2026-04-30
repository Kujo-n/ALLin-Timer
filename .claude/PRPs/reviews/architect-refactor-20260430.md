# Architect Refactor Review — 2026-04-30

ユーザー指示: `/architect-refactor リポジトリ全体を調査して`
ブランチ: `feature/hole-refactor`（直近 commit: 7e8ab3b、Phase 4.17 完了直後 / clean）

## ベースライン（Phase 1）

| 項目 | 結果 |
| --- | --- |
| typecheck (`tsc --noEmit`) | pass |
| lint (`next lint`) | pass — warnings 0 |
| unit test (`vitest run`) | 29 files / 523 tests pass |
| build (`next build`) | pass |
| E2E (`playwright test`) | **未走行**（監査時点では Phase 4 実装直前に再走行する想定） |

> E2E は Firebase Emulator 起動を要するため、Phase 4 のリファクタ着手前と最終検証時の 2 回に絞る。Phase 1 では unit / typecheck / lint / build までで「壊れていないこと」を確認した。

## スコープ

| 領域 | ファイル数 / 規模 |
| --- | --- |
| `src/app/**` page + client components | 21 file / 約 3,360 行 |
| `src/components/**` | 約 35 file（うち tournament 系 19 file / 2,200 行） |
| `src/lib/**` services / hooks / repositories / schemas | 約 50 file |
| `firestore.rules` | 397 行 |
| `scripts/` rules / migration | 3 file |
| 全体 src + tests + scripts | 175 file |

## Findings

サマリ: **critical 0 / high 1 / medium 7 / low 8**

---

### finding-1 — `group-detail-client.tsx` が 786 行・inline-edit が 3 重複

- **Lens**: architect
- **Severity**: high
- **場所**: [src/app/groups/[gid]/group-detail-client.tsx:70-786](../../../src/app/groups/[gid]/group-detail-client.tsx#L70-L786)
- **観察事実**: 1 ファイルに「ヘッダ + rename inline edit」「`finishedTournamentCount` inline edit」「`defaultSeatsPerTable` inline edit」「3 階層ロール操作付きメンバーリスト」「招待コード発行カード」「leave / delete dialog」が同居。3 つの inline edit は `editing*` / `*Value` / `*InputRef` / `startEditing*` / `cancelEditing*` / `onSave*` を別々に持ち、ほぼ同形のロジックを 3 回手書きしている（[L240-326](../../../src/app/groups/[gid]/group-detail-client.tsx#L240-L326)）。
- **影響**: 新しい数値フィールドを 1 つ足すだけで 4 個目を写経することになる。1 か所のバグが他の 2 つに波及するリスク。SRP / DRY 違反。
- **案**:
  - (A) `useInlineNumberEdit({ initialValue, validate, save, ariaLabel })` フックに収斂し、`<InlineNumberEdit>` shared component で View を共有（`finishedTournamentCount` / `defaultSeatsPerTable` / 将来追加分）。
  - (B) ファイル分割: `GroupHeaderCard` / `FinishedCountCard` / `DefaultSeatsCard` / `MemberRoleList` / `InviteCodeCard` / `GroupLeaveDeleteDialogs`。各 100 行未満を狙う。
- **テスト保護**: `tests/e2e/groups-navigation.spec.ts` / `member-role-split.spec.ts` / `dashboard-polish.spec.ts` 等。挙動を変えない範囲で安全網は十分。
- **リスク**: 観測可能な動作変更なし（純粋な内部リファクタ）。

---

### finding-2 — `MAX_TABLES` / `seatNum` 上限の DRIFT WARNING がコメントベース

- **Lens**: architect / security（多層防御の同期欠落）
- **Severity**: medium
- **場所**:
  - [src/lib/services/seating/engine.ts:18](../../../src/lib/services/seating/engine.ts#L18) `MAX_TABLES = 6`
  - [firestore.rules:363](../../../firestore.rules#L363) `tableNum <= 6`
  - [firestore.rules:369](../../../firestore.rules#L369) `seatNum <= 10`
  - [src/lib/firebase/schemas/tournament.ts:44](../../../src/lib/firebase/schemas/tournament.ts#L44) `seatsPerTable.min(2).max(10)`
  - [src/lib/firebase/schemas/group.ts:84](../../../src/lib/firebase/schemas/group.ts#L84) `defaultSeatsPerTable.max(10)`
- **観察事実**: 5 箇所の数値リテラルが「⚠ DRIFT WARNING」コメントだけで運用同期されており、機械的な検査がない。
- **影響**: 将来 8 卓拡張する際、片方を直して他方を見落とすと「テストが通るが本番でだけ permission-denied」型の障害になり得る。
- **案**:
  - `src/lib/limits.ts` に `MAX_TABLES = 6` / `MAX_SEATS_PER_TABLE = 10` / `MIN_SEATS_PER_TABLE = 2` を集約。`engine.ts` / schemas はこの定数を参照に切替。
  - rules 側はリテラル維持だが、`scripts/test-rules-default-seats.mjs` 系に「rules 内ハードコードが limits.ts と一致するか」を assert する parse-based test を追加。
- **テスト保護**: `engine.test.ts` は `MAX_TABLES` を直接 import している。新規 lock test がベスト。
- **リスク**: 観測可能な動作変更なし。

---

### finding-3 — `dashboard-client.tsx` が 455 行・hook 5 個が縦積み

- **Lens**: architect
- **Severity**: medium
- **場所**: [src/app/tournaments/[tid]/dashboard-client.tsx:50-455](../../../src/app/tournaments/[tid]/dashboard-client.tsx#L50-L455)
- **観察事実**: subscribe (players / tables) ×2、Fullscreen API toggle、auto-finish タイマー、role-based redirect、audio toggle wrapper、削除 dialog、grid レイアウト計算がすべて同居し `useEffect` が 5 個並ぶ。早期 return より前に hook 順を一定にするためのコメントが多い。
- **影響**: hook 順制御が複雑。`isOrganizer` 判定後の loading 状態が「早期 return が 3 種類ある」状況で読みづらい。auto-finish の依存配列が primitive 化されている工夫はあるが、その隣の `useFullscreen`（仮）と混ざって認知負荷が高い。
- **案**:
  - `useFullscreen()` hook を `src/lib/hooks/useFullscreen.ts` に抽出。
  - `useAutoFinish({ winnerId, dataState, dataGroupId, userUid, groupIds, dataId })` を hook 化。
  - `useTournamentRoleRedirect(tournament, role)` を hook 化（`/live` redirect ロジック）。
  - レイアウト（grid 3 列 + winner banner + balancing card など）は `<DashboardLayout>` 子コンポーネントへ。
- **テスト保護**: `tests/e2e/winner-banner-and-auto-finish.spec.ts` / `dashboard-polish.spec.ts` / `timer-control-polish.spec.ts` で auto-finish / fullscreen / レイアウトを E2E カバー済み。
- **リスク**: 観測可能な動作変更なし。

---

### finding-4 — repository の try/catch ラップが 30+ 箇所反復

- **Lens**: architect (DRY)
- **Severity**: medium
- **場所**: [src/lib/firebase/repositories/](../../../src/lib/firebase/repositories/) 全般。特に [tournaments.ts](../../../src/lib/firebase/repositories/tournaments.ts) は同形が 7 箇所、[groups.ts](../../../src/lib/firebase/repositories/groups.ts) は 9 箇所。
- **観察事実**: 全 mutation 関数で
  ```ts
  try {
    await xxx;
    logger.info(...);
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "...message...");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
  ```
  の同形が反復。1 関数 5–10 行が wrap ロジックで占められる。
- **影響**: ボイラープレートが目立ち、新規 mutation 追加時に同形を再現するため code rule 逸脱（log なし / domain code 不付与）が起きやすい。
- **案**:
  - `wrapFirestoreWrite("firestore/write_failed", "...message...", async () => { ... })` のような higher-order helper を `src/lib/firebase/wrap.ts` に追加。
  - 取得系は `wrapFirestoreRead` を別途。
  - 移行は repository 1 つずつ・1 commit ずつ実施可能（Phase 4 で順次）。
- **テスト保護**: 既存 repository test（`templateAdmins.test.ts` 等）が AppError code を assert しているので helper 化後も担保される。
- **リスク**: 観測可能な動作変更なし（log レベル / code / message が一致する限り）。

---

### finding-5 — tournament state-machine が 3 箇所に分散

- **Lens**: architect
- **Severity**: medium
- **場所**:
  - [src/components/tournament/TimerControls.tsx:142-364](../../../src/components/tournament/TimerControls.tsx#L142-L364) （state ごとのボタン分岐）
  - [src/lib/firebase/repositories/tournaments.ts:139-350](../../../src/lib/firebase/repositories/tournaments.ts#L139-L350) （各遷移の state guard）
  - [src/app/tournaments/[tid]/dashboard-client.tsx:253-261](../../../src/app/tournaments/[tid]/dashboard-client.tsx#L253-L261) （`canEdit` / `canDelete` / `showSeatingBoard` / `showBalancing`）
- **観察事実**: `tournament.state` への許可判定が 3 箇所で別々の bare 条件式として書かれている。`assertCanManage` は権限のみで state を見ない。
- **影響**: 将来 state を追加する際の改修箇所が多い。dashboard / TimerControls の `state === "running" || state === "paused"` 系の重複が drift しやすい。
- **案**:
  - `src/lib/services/tournament-state.ts` に純関数群を集約: `canEdit`/`canDelete`/`canBeginSeating`/`canConfirmSeating`/`canPause`/`canResume`/`canFinish`/`isInProgress`/`needsBalancing`。
  - tournaments.ts の各 mutation 内 `if (t.state !== ...) throw new AppError("...", "tournament/invalid-state")` を `if (!canX(t)) throw ...` に置換。
  - dashboard / TimerControls から同 helper を import。
- **テスト保護**: `timer.test.ts` のスタイルを真似た `tournament-state.test.ts` を新規追加するのが望ましい（pure function なので test しやすい）。
- **リスク**: 観測可能な動作変更なし。

---

### finding-6 — `useTournamentTimer` の autoAdvance dep が object 参照

- **Lens**: architect (perf / hook stability)
- **Severity**: low
- **場所**: [src/lib/hooks/useTournamentTimer.ts:100-121](../../../src/lib/hooks/useTournamentTimer.ts#L100-L121)
- **観察事実**: `useEffect` の依存に `options.autoAdvance` の object をそのまま入れている。dashboard-client は `{ uid: user.uid, userGroupIds: groupIds }` を inline で渡しており（[L65](../../../src/app/tournaments/[tid]/dashboard-client.tsx#L65)）、`groupIds` 配列は親 context で再生成されると新参照になる。`useSeatingAutoOrchestrator` は同じ問題を fingerprint で解いているが、ここでは未対策。
- **影響**: subscribe → setTournament → re-render → effect re-fire のループで no-op transaction を不要に走らせる。`advanceInflightRef` で抑止されるため実害は限定的だが、無駄な write 試行 / log が発生し得る。
- **案**: `useSeatingAutoOrchestrator` と同じ fingerprint パターン（`groupIdsKey = userGroupIds.join(",")`）を導入し、deps を primitive に。
- **テスト保護**: 不在。`tests/unit/useTournamentTimer.test.tsx` 追加が望ましい。
- **リスク**: 観測可能な動作変更なし（advance 試行がより少なくなるだけ）。

---

### finding-7 — 匿名 self-delete ロジックが 3 か所に分散

- **Lens**: architect (DRY)
- **Severity**: low
- **場所**:
  - [src/lib/services/auth-actions.ts:298-322](../../../src/lib/services/auth-actions.ts#L298-L322) (`logout`)
  - [src/lib/services/receipt.ts:163-178](../../../src/lib/services/receipt.ts#L163-L178) (`cancelOwnEntry`)
  - [src/app/tournaments/[tid]/live/live-client.tsx:84-105](../../../src/app/tournaments/[tid]/live/live-client.tsx#L84-L105) (`finished` 検知)
- **観察事実**: `if (user.isAnonymous) { try { await deleteUserProfile(user.uid); await user.delete(); logger.info(...) } catch ... }` がほぼ同形で 3 箇所に。
- **影響**: 一箇所修正漏れで「ログアウトでは消えるが finish では残る」ような不整合が起きる。ログメッセージの code が 3 種類（`auth/anon-delete-failed` / なし / なし）でばらつく。
- **案**: `attemptAnonymousSelfDelete(user, contextLabel)` を `auth-actions.ts` に集約し、3 か所から呼ぶ。
- **テスト保護**: `tests/e2e/anonymous-self-delete.spec.ts` で 3 経路カバー済み。
- **リスク**: 観測可能な動作変更なし。

---

### finding-8 — `deriveRole` + tournament-group role 判定が複数画面で重複

- **Lens**: architect
- **Severity**: low
- **場所**:
  - [src/app/tournaments/[tid]/dashboard-client.tsx:198,247](../../../src/app/tournaments/[tid]/dashboard-client.tsx#L198)
  - [src/app/tournaments/[tid]/live/live-client.tsx:62-67](../../../src/app/tournaments/[tid]/live/live-client.tsx#L62-L67)
  - [src/lib/hooks/useAudioPlayer.ts:78](../../../src/lib/hooks/useAudioPlayer.ts#L78) （引数で受けるが呼び側で derive）
- **観察事実**: 「tournament の groupId に対する自分の role」を呼び側 3 箇所で `groups.find(...)` → `deriveRole(g, uid)` と書いている。`useCurrentGroup` の `currentGroupRole` は「現在選択中の group」しか扱わないので、tournament view では使えない。
- **案**: `useGroupRole(gid: string | null | undefined): MemberRole | null` を `current-group.tsx` から export。3 画面でこれを使う。
- **テスト保護**: 既存 E2E でカバー（`member-role-split.spec.ts`）。
- **リスク**: なし。

---

### finding-9 — dashboard の `updateAudioSettings` 二重 wrap

- **Lens**: architect
- **Severity**: low
- **場所**: [src/app/tournaments/[tid]/dashboard-client.tsx:347-362](../../../src/app/tournaments/[tid]/dashboard-client.tsx#L347-L362)
- **観察事実**: `updateAudioSettings` 自身が AppError ラップ + `logger.warn` 出力済みなのに、catch 側でも `e instanceof AppError ? e : AppError.from(...)` で再 wrap。コメントで二重ログ回避を明示しているが実装がぎこちない。
- **案**: `errors.ts` に `unwrapOrFrom(e, code, msg)` を追加（=「既に AppError ならそのまま、そうでなければ wrap」）。catch 全体を 3 行に圧縮可能。
- **テスト保護**: 不要。
- **リスク**: なし。

---

### finding-10 — `structureTemplates.description` の size cap は同期済み

- **Lens**: security
- **Severity**: low（**修正不要**）
- **場所**: [firestore.rules:283,293](../../../firestore.rules#L283) / [src/lib/firebase/schemas/structureTemplate.ts](../../../src/lib/firebase/schemas/structureTemplate.ts)
- **観察事実**: rule で 200 字 cap、schema 側にも 200 字 cap。`createdByDisplayName` は 1〜15 字に rule + schema で同期済み。多層防御 OK。
- **対応**: 観察ベース。所見保留（次回フィールド追加時の参照用）。

---

### finding-11 — `groupJoinCodes` の `usesCount` 空消費 DoS（既知・スコープ外）

- **Lens**: security
- **Severity**: medium だが**修正見送り推奨**
- **場所**: [firestore.rules:240-249](../../../firestore.rules#L240-L249)
- **観察事実**: 認証済みユーザー全員が任意の有効コードに対して `usesCount + 1` を行える。`maxUses: null` 運用なので顕在化していない。`group-membership.md` の「既知のセキュリティリスク」で明記済み。
- **影響**: 招待コード文字列が流出した場合、第三者が `usesCount` を `maxUses` まで増やしてコードを無効化できる。
- **案**: 本リファクタで触らない。Cloud Functions 化（Phase 5+）と一緒に解決する設計判断。
- **理由**: 現行ルールでは「単一トランザクション内で `groupJoinCodes` 更新と `groups.memberUids` 追加を atomic 検証」できない。Callable function 化以外の根本対策はない。
- **テスト保護**: 触らないので不要。

---

### finding-12 — 招待コードのエントロピーが security.md 規定を下回る可能性

- **Lens**: security
- **Severity**: low
- **場所**: [src/lib/firebase/repositories/groupJoinCodes.ts:28-48](../../../src/lib/firebase/repositories/groupJoinCodes.ts#L28-L48)
- **観察事実**: 16 文字 × log2(36) ≈ **82.7 bit** のエントロピー。`security.md` の「128 bit 以上のランダム値」要求に対して数値上は不足。実用上は推測困難だが、ルール文書とずれている。
- **案**:
  - (A) `CODE_LENGTH = 25` に拡張（25 × 5.17 ≈ 129 bit）。
  - (B) alphabet を base62（小文字 + 大文字 + 数字 = 62）にすれば 16 文字でも ≈ 95 bit。25 文字なら ≈ 149 bit。
  - (C) `security.md` を「16 字 base36 ≈ 82 bit」に追従させる（実装変更なし）。
- **判断**: (A) が最小工数。**既存コードは互換のまま、新規発行が長くなるだけ**。
- **テスト保護**: 不要（プロダクトコード単体で完結）。
- **リスク**: URL が長くなる UX 影響のみ（25 文字は許容範囲）。

---

### finding-13 — `TimerControls.tsx` 365 行・state branch 4 個が縦積み

- **Lens**: architect
- **Severity**: medium
- **場所**: [src/components/tournament/TimerControls.tsx:81-365](../../../src/components/tournament/TimerControls.tsx#L81-L365)
- **観察事実**: setup / seating / finished / running-paused の 4 分岐が長く、各 branch で `connectionBadge` / `fullscreenButton` を冒頭に同じように埋めている。共通 chrome（fullscreen / connection / audio）と state ごとボタン群の構造が見えにくい。
- **案**: `TimerControlsSetup` / `TimerControlsSeating` / `TimerControlsFinished` / `TimerControlsRunning` の internal sub-component に分割し、shared chrome（fullscreen / connection / audio）は親 component で 1 度だけ render。`busy` state と `run()` ヘルパーは親に置く。
- **テスト保護**: `tests/e2e/timer-control-polish.spec.ts`。
- **リスク**: 観測可能な動作変更なし。

---

### finding-14 — `AppError` type guard 風の手書きチェックが分散

- **Lens**: architect
- **Severity**: low
- **場所**:
  - [src/lib/services/current-group.tsx:103-107](../../../src/lib/services/current-group.tsx#L103-L107)
  - [src/app/tournaments/[tid]/live/live-client.tsx:97-102](../../../src/app/tournaments/[tid]/live/live-client.tsx#L97-L102)
  - [src/lib/services/group.ts:159-167](../../../src/lib/services/group.ts#L159-L167)
- **観察事実**: `if (e && typeof e === "object" && "code" in e)` パターンが点在。AppError でない可能性のために生 object から code を抜き出している。
- **案**: `errors.ts` に `getErrorCode(e: unknown): string` を追加（AppError なら `e.code`、そうでなければ `"unknown"`）。
- **テスト保護**: 不要。
- **リスク**: なし。

---

### finding-15 — `firestore.rules` の `affectedKeys` 列挙が 6 ブランチに分散

- **Lens**: architect / security
- **Severity**: low（**修正は別形でドキュメント側**）
- **場所**: [firestore.rules:103-106 / 132-135 / 169-170 / 191-192 / 202-204 / 215-217](../../../firestore.rules#L103)
- **観察事実**: groups update の 6 ブランチそれぞれで `affectedKeys().hasOnly([...])` を別々に書いている。各ブランチが許可するキー集合の overlap / 排他関係が grep 以外で読み取れない。
- **影響**: 新規フィールド追加時に「どのブランチで許可すべきか」を 6 か所すべて確認する必要がある。Phase 4.16 で実際に self-* update の `affectedKeys` 抜けが発覚した経緯（`group-membership.md` 既記）。
- **案**: rule に共通 helper を作るのは Cloud Firestore の制約上難しい。代わりに `.claude/rules/firebase-patterns.md` に「allowed-keys per branch」一覧表を新設。`affectedKeys` 検証用の emulator test を `scripts/test-rules-affected-keys.mjs` として体系化。
- **テスト保護**: `scripts/test-rules-finished-count.mjs` / `scripts/test-rules-default-seats.mjs` を雛形にし、新規フィールド追加時の test テンプレートを定型化。
- **リスク**: rule ファイル自体は変更しない案を推奨。

---

### finding-16 — `defaultSeatsPerTable ?? 9` の dead fallback が複数箇所

- **Lens**: architect
- **Severity**: low
- **場所**: [src/app/groups/[gid]/group-detail-client.tsx:159,283,293,306,570](../../../src/app/groups/[gid]/group-detail-client.tsx#L159) ほか
- **観察事実**: `g.defaultSeatsPerTable ?? 9` が複数箇所。schema の `defaultSeatsPerTable: z.number().int().min(2).max(10).default(9)` で必ず number に hydrate されるため、TypeScript 型は `number` で `?? 9` は実質 dead code。
- **影響**: 機能影響なし。読み手が「null になり得るのか？」と一瞬考える分の認知負荷のみ。`finishedTournamentCount ?? 0` も同様（schema default 0）。
- **案**: 該当箇所の `?? 9` / `?? 0` を削除。schema コメントで「常に hydrate される」旨を補強。
- **テスト保護**: 不要（schema test）。
- **リスク**: 観測可能な動作変更なし。

---

## 観察した良いパターン（リファクタで壊さない）

- `src/lib/services/seating/engine.ts` ↔ `orchestrator.ts` の **pure / 副作用分離**は教科書的。engine は副作用を持たず、orchestrator が tx + rule の最終防衛。テスト容易性が高い。
- `zodConverter` による Firestore→runtime validate と、failed validate 時の `firestore/invalid-data` ラップ。リスト系で個別 doc validation 失敗を skip する `listTournamentsByGroup` パターンが堅牢。
- `firestore.rules` の `affectedKeys` 強制は Phase 4.16 で過去の抜けを修復済み。`hasValidJoinCodeConsumption` で `getAfter()` を使った atomic 検証は Firebase 仕様の正しい使い方。
- `useSeatingAutoOrchestrator` の primitive fingerprint による effect dep 安定化は、Firestore subscribe の object 参照不安定性に対する正答。
- 全 mutation で `logger.info` の成功 log を漏らさず、`AppError` と log code を一致させている。

## ルール / プロジェクト規約との適合

- [`.claude/rules/firebase-patterns.md`](../../rules/firebase-patterns.md): 全 repository 経由 / `zodConverter` / deny-by-default。**準拠**。
- [`.claude/rules/error-logging.md`](../../rules/error-logging.md): `AppError` ラップ + domain code prefix + `logger`。**準拠**（`console.*` 残置なし）。
- [`.claude/rules/security.md`](../../rules/security.md): `.env.local` 管理 + サークル固有情報 Firestore 限定 + 招待コード設計。**準拠（finding-12 は規定との数値ずれ）**。
- [`.claude/rules/group-membership.md`](../../rules/group-membership.md): 3 階層ロール + `affectedKeys` 強制 + `joinCodeId` consumption proof。**準拠**。

## まとめと方針提案（Phase 3 ドラフト）

### 提案する優先順位

1. **安全網拡張（先行 / 1 commit）**
   - `tests/unit/tournament-state.test.ts`（finding-5 の前提）。pure function なので軽量。
   - `scripts/test-rules-limits.mjs`（finding-2）。rules 内ハードコードと limits.ts を機械チェック。

2. **共通基盤の集約（middle path / 2-3 commit）**
   - finding-2 — `src/lib/limits.ts` 集約 + import 切替。
   - finding-4 — `src/lib/firebase/wrap.ts`（`wrapFirestoreWrite` / `wrapFirestoreRead`）+ repositories 順次置換。
   - finding-9 / 14 — `errors.ts` に `unwrapOrFrom` / `getErrorCode` 追加。

3. **state-machine 純関数化（middle / 1 commit）**
   - finding-5 — `src/lib/services/tournament-state.ts` 抽出 + 3 呼出側差替え。

4. **大物 component の分割（high impact / 2-3 commit）**
   - finding-1 — `useInlineNumberEdit` hook + `<InlineNumberEdit>` + `group-detail-client` を 5-6 ファイルに分割。
   - finding-3 — `useFullscreen` / `useAutoFinish` / `useTournamentRoleRedirect` 抽出。
   - finding-13 — `TimerControls` を 4 sub-components に分割。

5. **微修正（low / 各 1 commit）**
   - finding-6 — `useTournamentTimer` の dep fingerprint 化。
   - finding-7 — `attemptAnonymousSelfDelete` 集約。
   - finding-8 — `useGroupRole(gid)` export。
   - finding-12 — 招待コード長 25 文字に拡張。
   - finding-15 — ドキュメント追記のみ（コード変更なし）。
   - finding-16 — dead fallback 削除。

### 想定 commit 数: 11–14（atomic 単位）

各 commit で `npm run typecheck` / `lint` / `test` / `build` を全 green に保ち、観測可能な動作変更を一切起こさない方針。E2E は安全網拡張後と最終検証で 2 回走らせる。

### 見送り（明示）

- **finding-11**（招待コード `usesCount` DoS）— Cloud Functions 化が必要なため Phase 5+ に持ち越し。
- **finding-15** の rule ファイル変更 — Cloud Firestore Security Rules の言語制約上、helper 抽出が困難。ドキュメント整備のみ。
- 既存テスト網が薄い箇所への characterization test 追加は、必要に応じて対応 commit とペアで実施。

### Phase 3 開始前の確認事項

1. **スコープ承認**: 上記 16 finding のうち、対応する範囲（priority 1-4 まで / 1-5 まで / その他）。
2. **E2E 走行**: ベースライン E2E をリファクタ着手前に走らせるべきか（Firebase Emulator 起動 + 日本語環境）。
3. **commit 粒度**: 1 finding = 1 commit を原則とするが、`wrap.ts` 導入と repositories 移行のように依存がある場合は数 commit に分割する方針で良いか。
