# ローカルレビュー: Phase 4 — オーナーによるメンバー除外 UI

**レビュー日**: 2026-08-01
**対象**: 未コミット差分（`feture/auto-group-join` ブランチ）
**PRD**: [08-auto-group-join-on-entry](../prds/08-auto-group-join-on-entry.prd.md) Phase 4
**判定**: **APPROVE（コメント付き）** — CRITICAL / HIGH なし

## Summary

`removeMemberByOwner` service + `removeOtherMember` repository + 確認ダイアログ付き UI が、
既存の owner-update ブランチだけで成立していることを確認した。ガード（自己除外禁止 /
assertOwner / 冪等 no-op / last-owner）は service・UI・rule の三層で整合しており、
書込 patch も 1 回の `updateDoc` で invariant（`ownerUids ⊆ organizerUids ⊆ memberUids`）を
壊さない。unit / component / E2E のカバレッジも規約に沿っている。

指摘は「除外の永続性が運用前提に依存する点が UI に出ていない」（MEDIUM）と、
テスト・差分衛生まわりの LOW が中心。

### Firestore Rules の非変更を検証

計画どおり `firestore.rules` は無変更。`removeOtherMember` の patch
（3 配列 `arrayRemove` + `memberDisplayNames.<uid>` の `deleteField()`）が
owner-update ブランチ（[firestore.rules:113-119](../../../../firestore.rules)）の
3 条件 — `auth.uid in resource.data.ownerUids` / `ownerUids.size() >= 1` /
`createdAt` 不変 — をすべて満たすことを確認した。
**`firebase deploy --only firestore:rules` は不要**。

## 対応状況（レビュー後・ユーザー判断）

| Finding | 判断 | 内容 |
| --- | --- | --- |
| M-1 | **対応済み（提案 1）** | [group-membership.md](../../../rules/group-membership.md) の「オーナーによるメンバー除外」節の既知の制約に、除外が永続する条件（`finished` / 締切超過は二層で塞がる ／ `setup` / `seating` は締切判定の対象外で窓が残る）を追記。既存の「既知のセキュリティリスク → トーナメント QR の拡散」節と相互リンクし、同節の「除名との関係」にも `setup` 放置ケースを明記。コード変更なし |
| M-2 | **今回は対象外** | 次回リファクタリング時の検討事項として記録（group service の責務分割） |
| L-1〜L-6 | 未対応 | 本レビュー時点では記録のみ |

## Findings

### CRITICAL

なし。

### HIGH

なし。

### MEDIUM

#### M-1: 除外の永続性が「受付可能 state のトーナメントが無いこと」に依存し、UI に警告がない

> **注記（レビュー後の追加検証）**: 「終了したトーナメントの QR は無効化されないのか」という
> 指摘を受けて確認した結果、**finished では 2 層で塞がれている**（下表）。本 finding は
> 「終了後も QR が生きている」という指摘ではなく、**finished になる前の窓**についての指摘。
> 窓は当初の記載より狭く、実質的な severity は **LOW 寄りの MEDIUM**。

- **場所**: [src/lib/services/group.ts:858](../../../../src/lib/services/group.ts#L858) /
  [RemoveMemberDialog.tsx:39-44](../../../../src/app/groups/[gid]/_components/RemoveMemberDialog.tsx#L39-L44)
- **内容**: 除外後も、対象者が **同じサークルの受付可能なトーナメントに `players/{uid}` を
  持っている限り**、`/join/[tid]` を開き直して受付し直すだけで member に戻る。
  - [receipt.ts の `receiveEntry`](../../../../src/lib/services/receipt.ts#L99-L115) は
    `already-joined` でも `joinGroupViaTournament` を実行する（Phase 2 の設計どおり）
  - [`probeMembership`](../../../../src/lib/services/auto-group-join.ts) は
    `getGroupIfMember` の成否で判定するため、stale な `users/{uid}.groupIds` に
    引きずられず**即座に**再 self-add が通る

- **state 別の可否**:

  | state | 再加入 | 塞いでいる箇所 |
  | --- | --- | --- |
  | `finished` | ✗ | service: [`assertAcceptingEntries`](../../../../src/lib/services/entry-guards.ts#L24-L27) の `isFinished` ／ rule: `hasTournamentEntryProof` の受付可能 4 state 要求（**二層防御 = 除外は永続**） |
  | `running` / `paused` かつ `currentLevel > lateEntryDeadlineLevel` | ✗ | service: 同 guard の late entry 締切判定（rule では未強制） |
  | `running` / `paused` かつ締切前 | ✓ | — |
  | `setup` / `seating` | ✓ | — （`isInProgress` ではないため締切判定の対象外＝期限なく開いたまま） |

- **影響**: 残る窓は 2 パターン。(a) イベントの `finishTournament` を押す**前**に
  「一見さんを外しておく」操作をした場合、(b) 次回枠や clone で作った **`setup` のまま
  放置されたトーナメント**が同じサークルにあり、対象者がそこにも player doc を持つ場合。
  どちらも対象者が自分で受付リンクを開き直す能動的な操作を要し、自然発生はしない。
  ただし成立するとオーナー側に通知はなく、次に一覧を開くまで気づけない。
  ダイアログの本文は「再び参加してもらう場合は…トーナメント受付をしてもらってください」と
  再加入経路を案内しており、裏返すと**意図しない再加入も同じ経路で起きる**ことを示している。
- **既知性**: [group-membership.md の「既知のセキュリティリスク → 除名との関係」](../../../rules/group-membership.md)
  に運用前提として記載済み（「除名は運用上トーナメント終了後に行う」）。
  ただし今回追加した「オーナーによるメンバー除外」節の**既知の制約には未記載**で、
  そこには「トーナメント受付経由の自動所属は stale `groupIds` の影響を受けない」と
  利点としてのみ書かれている。
- **提案**（軽い順）:
  1. 新設節の「既知の制約」に 1 行追記し、既存のセキュリティリスク節へ相互リンクする
  2. ダイアログに「受付中のトーナメントがある場合、対象者が受付し直すと再加入します」の注意文を追加
  3. さらに踏み込むなら、service で当該 group の受付可能 state トーナメントを検出して
     UI に警告を返す（rule 変更は不要）

#### M-2: `src/lib/services/group.ts` が 887 行（>800 行の閾値超過）

- **場所**: [src/lib/services/group.ts](../../../../src/lib/services/group.ts)
- **内容**: 835 → 887 行。本 Phase 以前から閾値超過だが、group service に
  ロール操作 / シーズン / カード背景 / 各種デフォルト値 / 招待コードが同居し続けている。
- **影響**: 本 Phase をブロックする問題ではない（新規追加は 30 行程度で責務も適切）。
- **提案**: 次回 `/architect-refactor` で `group-roles.ts` / `group-season.ts` /
  `group-settings.ts` あたりへの分割を候補に挙げる。

### LOW

#### L-1: 「除外」ボタンの accessible name が表示名の一意性に依存

- **場所**: [MemberRoleList.tsx:161](../../../../src/app/groups/[gid]/_components/MemberRoleList.tsx#L161)
- `aria-label={`${m.displayName} を除外`}` は同名メンバーが 2 人いると重複する。
  コメントは「行ごとにユニークにする」と述べているが、`memberDisplayNames` に一意性制約はない。
  重複時は E2E / component test の `getByRole` が strict-mode violation で落ち、
  スクリーンリーダーでも区別できない。
- **提案**: `${m.displayName}（${shortUid(m.uid)}）を除外` のように uid 短縮を混ぜる。

#### L-2: `group/last-owner` の unit test が矛盾 fixture に依存

- **場所**: [src/lib/services/group.test.ts](../../../../src/lib/services/group.test.ts)（`throws group/last-owner when target is the only owner`）
- `ownerUids.includes` をインスタンスごと差し替えて、`length === 1` なのに 2 uid に true を
  返す配列を作っている。テスト自身のコメントどおりこの分岐は到達不能であり、
  「観測可能な振る舞いを検証する」（[testing.md](../../../rules/testing.md)）から外れる。
- **提案**: 到達不能ガードであることを service 側コメントに残し、テストは落とす。
  残すなら fixture ハックではなく「`getGroup` の戻り値を直接組む helper」で
  意図を明示する形にしたい。

#### L-3: E2E の「除外された側の一覧から消える」が vacuous pass しうる

- **場所**: [tests/e2e/member-removal.spec.ts:70-73](../../../../tests/e2e/member-removal.spec.ts#L70-L73)
- 除外**前**に member 側で「Removal Group」が見えることを assert していないため、
  ページが読み込めていないだけでも `toHaveCount(0)` が通る。
- **提案**: 除外前に `memberPage.goto("/groups")` → 当該サークルが visible を確認してから
  除外し、その後に消えることを検証する。

#### L-4: `memberRow()` の `hasText` は部分一致

- **場所**: [tests/e2e/pages/GroupsPage.ts:117-119](../../../../tests/e2e/pages/GroupsPage.ts#L117-L119)
- `filter({ hasText })` は部分文字列マッチ。表示名が他の行の部分文字列になると誤マッチする。
  現行 spec は `randomOrganizer` 由来のランダム名なので実害はない。
- **提案**: 完全一致が必要になった時点で `hasText: new RegExp(`^${escape(name)}$`)` へ。

#### L-5: Phase 4 と無関係な差分が同一変更に混在

- `src/lib/services/group.test.ts` の増分 473 行のうち約 360 行は
  `setDefaultTableSettings`（Phase C）と `setWinnerCardBackground` /
  `setSeasonCardBackground`（Phase A.1）のテスト追加で、Phase 4 とは無関係。
- 加えて既存テストの prettier 整形差分（`it.each` の折返し変更等）がノイズとして混ざっている。
- カバレッジ拡充自体は歓迎だが、[testing.md の「新規機能と test の commit セット」](../../../rules/testing.md)
  の狙い（`git bisect` / revert の atomic 性）から、**別コミットに分離**を推奨。

#### L-6: 除外失敗時に画面全体がエラー表示へ置き換わる

- **場所**: [group-detail-client.tsx:204-215](../../../../src/app/groups/[gid]/group-detail-client.tsx#L204-L215)
- `runReloadRefreshAction` の `setError` により、サークル詳細画面ごと
  「エラー文 + サークル一覧へ」に差し替わる。ロール昇降格・シーズン開始と同じ既存挙動のため
  本 Phase 起因ではないが、除外のように「一覧に戻って続けて操作したい」ケースでは
  インライン表示のほうが自然。
- **提案**: 将来の polish で `runReloadRefreshAction` にインライン error 表示の選択肢を持たせる。

## Validation Results

| Check      | Result  | 備考                                                        |
| ---------- | ------- | ----------------------------------------------------------- |
| Type check | Pass    | `tsc --noEmit` エラーなし                                   |
| Lint       | Pass    | `next lint` — warning / error 0                             |
| Tests      | Pass    | vitest 107 files / **1702 tests** 全 pass                   |
| Build      | Pass    | `next build` 成功                                           |
| E2E        | 未再実行 | 実装レポートに新規 spec 3/3 pass の記録あり（emulator 必要） |
| Rules      | 変更なし | deploy 不要（owner-update ブランチで成立することを確認）    |

## Files Reviewed

| ファイル                                                        | 変更     |
| --------------------------------------------------------------- | -------- |
| `src/lib/services/group.ts`                                       | Modified |
| `src/lib/firebase/repositories/groups.ts`                         | Modified |
| `src/app/groups/[gid]/_components/MemberRoleList.tsx`             | Modified |
| `src/app/groups/[gid]/_components/RemoveMemberDialog.tsx`         | Added    |
| `src/app/groups/[gid]/group-detail-client.tsx`                    | Modified |
| `src/lib/services/group.test.ts`                                  | Modified |
| `src/lib/firebase/repositories/groups.test.ts`                    | Modified |
| `src/app/groups/[gid]/_components/MemberRoleList.test.tsx`        | Added    |
| `src/app/groups/[gid]/_components/RemoveMemberDialog.test.tsx`    | Added    |
| `tests/e2e/member-removal.spec.ts`                                | Added    |
| `tests/e2e/pages/GroupsPage.ts`                                   | Modified |
| `.claude/rules/group-membership.md`                               | Modified |
| `.claude/PRPs/08-auto-group-join-on-entry/prds/…prd.md`           | Modified |
| `.claude/PRPs/08-auto-group-join-on-entry/plans/…plan.md`         | Moved → `completed/` |
| `.claude/PRPs/08-auto-group-join-on-entry/reports/…report.md`     | Added    |

## 良かった点

- `removeOtherMember` を **1 回の `updateDoc`** に収め、3 配列 + `memberDisplayNames` を
  atomic に適用している。分割すると invariant が一時的に破れる点をテストのコメントで明示済み。
- 自己除外を `getGroup` **前**に弾く順序（無駄な read を消費しないフェイルファスト）と、
  それを固定する unit test。
- 「除外 → stale `groupIds` → 自己修復 → 再加入」の順序を E2E で emulator REST の
  poll として表現し、「仕様であって実装都合ではない」ことをコメントで rule ドキュメントに
  紐づけている。
- `deleteGroupByOwner` と同じ `users/{uid}` self-only 制約を踏襲し、独自の抜け道を作っていない。
