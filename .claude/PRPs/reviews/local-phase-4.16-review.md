# ローカルレビュー: Phase 4.16 — 終了トーナメント数からの新規名デフォルト

**Reviewed**: 2026-04-28
**Branch**: develop（uncommitted changes）
**Decision**: APPROVE WITH COMMENTS（変更小さく、検証 3 種すべて green。MEDIUM 1 件・LOW 数件の指摘あり）

## 概要

`groups/{gid}.finishedTournamentCount` を additive に追加し、
`finishTournament()` が writeBatch で `increment(1)` する自動経路と、サークル詳細画面の inline edit による手動補正経路の 2 経路を整備。新規トーナメント作成画面の name デフォルトを `[サークル名]トーナメント-X` に切替えている。schema / repository / service / rules / docs / tests の同時更新が揃っており、Phase 4.6 以降の規約（3 階層ロール・rule 二重防御・additive default）を概ね遵守している。

## 指摘事項

### CRITICAL

なし。

### HIGH

なし。

### MEDIUM

#### M1: `finishTournament()` の writeBatch は同時呼び出しで二重 increment しうる（解消済み）

> **ステータス**: 2026-04-28 に `runTransaction` 化で対応済み。tx 内で `state !== "finished"` を再 read し、別端末が先に確定した場合は no-op で抜ける。テストは「同時呼び出しで increment が走らないこと」「tx 内で doc が消えた場合 `firestore/not-found` を返すこと」をカバー。schema / rule / 規約コメントの「writeBatch」表記も `runTransaction` に揃えた。


**該当箇所**: [src/lib/firebase/repositories/tournaments.ts:358-383](../../../src/lib/firebase/repositories/tournaments.ts#L358-L383)

```ts
const t = await assertCanManage(tid, userGroupIds);
if (t.state === "finished") return;
try {
  const batch = writeBatch(firestore);
  batch.update(doc(tournamentsRef, tid), { state: "finished", ... });
  batch.update(doc(firestore, "groups", t.groupId), {
    finishedTournamentCount: increment(1),
  });
  await batch.commit();
```

`getTournament`（read）と `batch.commit`（write）は **atomic ではない**。
2 端末（手動「終了」ボタン × 自動 finish、または運営 2 名の同時操作）が同じ tournament で `finishTournament()` を呼ぶと、両端末とも `state !== "finished"` を観測してから batch を発火し、`groups/{gid}.finishedTournamentCount` が **+2** されうる。

呼出経路は 2 つあり、衝突可能性はゼロではない:

- 手動: [src/components/tournament/TimerControls.tsx:354](../../../src/components/tournament/TimerControls.tsx#L354)
- 自動: [src/app/tournaments/\[tid\]/dashboard-client.tsx:178](../../../src/app/tournaments/[tid]/dashboard-client.tsx#L178)（同一クライアント内は `autoFinishInflightRef` で防御済みだが、別端末間は防御なし）

**実害**: 次回新規作成画面のデフォルト名連番が +1 ぶん飛ぶ。permission や billing 等への波及はなし。security.md の既知リスク欄でも「organizer の任意値書換は受容」と整理されているため、致命傷ではない。

**推奨修正（low cost）**: writeBatch を `runTransaction` に置き換え、tx 内で再 read して `state !== "finished"` を最終 guard する。`advanceLevel` の `expectedLevel` 経路と同形のパターンで揃えられる。

```ts
await runTransaction(firestore, async (tx) => {
  const snap = await tx.get(doc(tournamentsRef, tid));
  if (!snap.exists()) throw new AppError(`tournament not found: ${tid}`, "firestore/not-found");
  const cur: TournamentDoc = { id: snap.id, ...snap.data() };
  if (cur.state === "finished") return; // 別端末が先に確定済み
  tx.update(doc(tournamentsRef, tid), { state: "finished", ... });
  tx.update(doc(firestore, "groups", cur.groupId), {
    finishedTournamentCount: increment(1),
  });
});
```

修正しない場合は、PRD / group-membership.md の既知リスク節に「マルチ端末競合で counter が +N される race」を追記しておくと将来ハマりにくい。

### LOW

#### L1: editingCount 中に group が再 reload されると入力値が消える

[src/app/groups/\[gid\]/group-detail-client.tsx:148-151](../../../src/app/groups/[gid]/group-detail-client.tsx#L148-L151)

```tsx
useEffect(() => {
  if (group) setCountValue(String(group.finishedTournamentCount ?? 0));
}, [group]);
```

`group` 参照が新しくなる（reload 完了など）たびに `setCountValue` が走る。ユーザーが入力途中に同画面の他操作（rename / promote 等）をすると `reload()` が走り、`group` 参照更新で入力値が破棄される。
現実的には UI 操作で重なる可能性は低いため LOW だが、`if (!editingCount) setCountValue(...)` で gate するか、reload 系操作を編集中は disabled にしておくと安全。

#### L2: `tournament-new-client.tsx` の `initialName` 反映タイミング

[src/app/tournaments/new/tournament-new-client.tsx:27-33](../../../src/app/tournaments/new/tournament-new-client.tsx#L27-L33)

`groups` が初回 fetch 中は `defaultName === ""` のままで `<TournamentForm initialName="">` が render される。
`<TournamentForm>` が `initialName` 変更を再同期する実装か、初回のみ採用する実装かによって、ローディング後にデフォルト名が空のまま残る恐れがある。`if (loading) return null` で待つようガードするか、`<TournamentForm key={defaultName}>` 等で確実に再評価させると堅牢。
（本 PR では `if (loading || !isOrganizer) return <Loading />` の分岐があるので、実害は出ていない可能性が高い。要動作確認。）

#### L3: `finishedTournamentCount` の手動補正に上限がない

rule / schema / UI のいずれも上限を設けていないため、UI 上で 1 億等の異常値を入れられる。表示や連番には大きな影響はないが、`type="number"` の `max` 属性や rule 側で `< 100000` 程度の sanity cap を入れておくとミスタイプを弾ける。優先度は低い。

#### L4: 既知リスクのドキュメント表現の整合

[.claude/rules/group-membership.md](../../rules/group-membership.md) の「既知のセキュリティリスク」節に Phase 4.16 リスクを追記済みで内容は適切。M1 の race を追加リスクとして併記するか、`finishTournament` のコメントにリンクを置いておくと一覧性が上がる。

## 検証結果

| Check | Result |
| ----- | ------ |
| Type check (`tsc --noEmit`) | Pass |
| Lint (`next lint`) | Pass |
| Tests (`vitest run`) | Pass — 29 files / 497 tests green |
| Build | 未実行（差分が schema/rules/UI 局所のため省略可と判断） |

## レビュー対象ファイル

- Modified
  - [.claude/PRPs/prds/allin-timer.prd.md](../../PRPs/prds/allin-timer.prd.md) — 進捗表更新
  - [.claude/rules/firebase-patterns.md](../../rules/firebase-patterns.md) — `finishedTournamentCount` 書込経路の限定ルール追記
  - [.claude/rules/group-membership.md](../../rules/group-membership.md) — 権限マトリクス・既知リスク更新
  - [firestore.rules](../../../firestore.rules) — `groups` update に `finishedTournamentCount` 単独書換 branch を追加
  - [src/app/groups/\[gid\]/group-detail-client.tsx](../../../src/app/groups/[gid]/group-detail-client.tsx) — 開催数 inline edit カード追加
  - [src/app/tournaments/new/tournament-new-client.tsx](../../../src/app/tournaments/new/tournament-new-client.tsx) — defaultName 連番化
  - [src/lib/firebase/repositories/groups.ts](../../../src/lib/firebase/repositories/groups.ts) — `updateFinishedTournamentCount` 追加
  - [src/lib/firebase/repositories/tournaments.ts](../../../src/lib/firebase/repositories/tournaments.ts) — `finishTournament` を writeBatch に変更し group counter を increment
  - [src/lib/firebase/schemas/group.ts](../../../src/lib/firebase/schemas/group.ts) — `finishedTournamentCount: z.number().int().nonnegative().default(0)`
  - [src/lib/services/group.ts](../../../src/lib/services/group.ts) — `setFinishedTournamentCount` service 追加
  - tests: groups.test / tournaments.test / index.test / group.test / useAudioPlayer.test に finishedTournamentCount 系を追加
- Untracked（成果物）
  - .claude/PRPs/plans/completed/phase-4.16-tournament-default-name-from-finished-counter.plan.md
  - .claude/PRPs/reports/phase-4.16-tournament-default-name-from-finished-counter-report.md

## 推奨アクション

1. M1（race による二重 increment）について、`runTransaction` 化するか docs に既知制約として明記するかを選択。
2. L1〜L3 は次の polish PR でまとめて対応可。
3. コミット前に `.env*` の差分が無いことを確認済み（`git status` 上に該当なし）。
