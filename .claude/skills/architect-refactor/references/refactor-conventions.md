# Refactor Conventions

`/architect-refactor` 実施時に**集約・統一を狙う先**としての規約集。通常開発時（ステップ 1）には強制せず、リファクタリング時（ステップ 3）に「ここに揃える」基準として使う。

開発思想:

```
ステップ 1: 動くアプリを作る（設計ルールはゆるめでよい）
ステップ 2: 要件を満たすテストを書く
ステップ 3: 厳密なルールでリファクタする ← 本ドキュメントが効く
ステップ 4: テスト全 pass で要件担保
```

`.claude/rules/*` は全フェーズに適用される境界規約だが、本ドキュメントは **architect-refactor が読み込むときだけ参照**される refactor 専用集約先。

## ファイル分割の閾値

- Client component が **300 行を超える**、または `useEffect` / `useState` が 5 個以上並ぶ場合は分割を検討
- 子 component の置き場所: 同階層に **`_components/`** または **`_<feature>/`** を作る（Next.js convention で `_` prefix は route 化されない）
- hook 抽出の閾値: 副作用 + state を持つロジックが 30 行を超える、または複数 component で再利用される
- Pure function 抽出: state 比較 / 計算式が複数箇所で重複している、または条件分岐が 3 つ以上

先例（Phase 4 architect-refactor）:

| Before | After | 削減率 |
| --- | --- | --- |
| `src/app/groups/[gid]/group-detail-client.tsx` 791 行 | 354 行 + 4 子 component (`_components/`) | -55% |
| `src/components/tournament/TimerControls.tsx` 379 行 | 222 行 + 4 sub-components (`_timer-controls/`) | -41% |
| `src/app/tournaments/[tid]/dashboard-client.tsx` 459 行 | 394 行 + 3 hooks 抽出 | -14% |

## tournament state-machine

`tournament.state === "running"` 等の直接比較は禁止（refactor で集約する）。`@/lib/services/tournament-state.ts` の純関数を経由する:

- 状態判定: `isSetup` / `isSeating` / `isRunning` / `isPaused` / `isFinished` / `isInProgress`
- 操作許可: `canEdit` / `canDelete` / `canBeginSeating` / `canConfirmSeating` / `canCommitInitialSeating` / `canPause` / `canResume` / `canAdvanceLevel` / `canRevertLevel` / `canFinish`
- 表示判定: `showSeatingBoard`

新規 state 追加時は `tournament-state.ts` の関数と `tournament-state.test.ts` の characterization test を更新する。

## hook 依存配列の primitive fingerprint

Firestore subscribe / 親 context から渡る配列・object は再 render で参照が不安定なため、`useEffect` の依存配列に直接入れない。`useMemo` で primitive fingerprint を作って依存に入れる。

```ts
// 不安定（毎レンダで参照変化）
useEffect(() => {
  // ...
}, [userGroupIds]);  // ← bad

// 安定化
const groupIdsKey = useMemo(() => userGroupIds.join(","), [userGroupIds]);
useEffect(() => {
  // ...
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fingerprint で参照不安定性を吸収
}, [groupIdsKey]);
```

先例:

- [`useSeatingAutoOrchestrator`](../../../src/lib/hooks/useSeatingAutoOrchestrator.ts): `players` / `tables` / `tournament` / `groupIds` の fingerprint
- [`useTournamentTimer`](../../../src/lib/hooks/useTournamentTimer.ts): `autoAdvance.uid` / `autoAdvance.userGroupIds` の fingerprint
- [`useAutoFinish`](../../../src/lib/hooks/useAutoFinish.ts): primitive 分解（`winnerId` / `dataState` / `dataGroupId` 等）

## 共通 hook / shared component

以下を再利用可能 hook / component として用意済み。新規類似ロジックは既存を再利用するか、必ず一般化して同 file に追加する:

| 抽出物 | 場所 | 用途 |
| --- | --- | --- |
| `useInlineNumberEdit` | `lib/hooks/useInlineNumberEdit.ts` | 表示 ↔ 数字入力 + 保存/キャンセル |
| `<InlineNumberEditCard>` | `components/group/InlineNumberEditCard.tsx` | inline 数値編集の共通 view |
| `useFullscreen` | `lib/hooks/useFullscreen.ts` | Fullscreen API toggle + 状態購読 |
| `useGroupRole(gid)` | `lib/hooks/useGroupRole.ts` | 任意 gid に対する group + role 導出 |
| `useAutoFinish` | `lib/hooks/useAutoFinish.ts` | winner 検出 → 遅延 finishTournament |
| `wrapFirestoreWrite/Read` | `lib/firebase/wrap.ts` | repository の error wrap helper |
| `unwrapOrFrom` / `getErrorCode` | `lib/errors.ts` | エラー透過と code 取得 |
| `attemptAnonymousSelfDelete` | `lib/services/auth-actions.ts` | 匿名ユーザー best-effort 削除 |
| `tournament-state.ts` 純関数 | `lib/services/tournament-state.ts` | tournament.state の判定 |

## 数値リミット定数

`src/lib/limits.ts` を真実源とする（運用詳細は [`firebase-patterns.md`](../../../rules/firebase-patterns.md) の「数値リミット定数の単一真実源」参照）。

## 内部 sub-component の co-location

Next.js convention で `_` prefix のディレクトリは route 化されない。これを利用して page-specific の sub-components を **同階層 `_components/`** に置く。共通化が必要になったら `src/components/<domain>/` に昇格する。

```
src/app/groups/[gid]/
├── _components/          # この page だけが使う子 component
│   ├── GroupHeaderCard.tsx
│   ├── MemberRoleList.tsx
│   └── ...
├── group-detail-client.tsx  # orchestrator
└── page.tsx
```

汎用化したら:

```
src/components/group/
└── InlineNumberEditCard.tsx  # page を跨いで使う
```

## architect-refactor 実施時の参照順

`/architect-refactor` 起動時、Phase 2（監査）以降で本ファイルを Read し、上記の集約先と照らして所見を作る。`.claude/rules/*` の全フェーズ規約は別途必読（CLAUDE.md の「ルール参照の義務」）。

## 関連

- 全フェーズ境界規約: [`error-logging.md`](../../../rules/error-logging.md) / [`firebase-patterns.md`](../../../rules/firebase-patterns.md) / [`testing.md`](../../../rules/testing.md)
- レンズ: [`web_architect.md`](web_architect.md) / [`security_specialist.md`](security_specialist.md)
- 直近の実例: [`.claude/PRPs/reports/architect-refactor-20260430.md`](../../../PRPs/reports/architect-refactor-20260430.md)
