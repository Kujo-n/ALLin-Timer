# Architect Refactor Review — 04-spectate-mode 周辺＋全体横断（2026-05-10 / 2 サイクル目）

直近 architect-refactor 5 サイクル目（同日 2 回目）。前回サイクル `architect-refactor-20260510.md` で見送った findings の再評価と、未踏領域（seating / orchestrator / repositories / scripts 等）の二レンズ新規監査。

## メタ情報

- 作業 branch: `refactor/post-spectate-followup-20260510`
- ベース: develop（直前サイクルの 9 commits を継承した状態）
- 前回 review: [architect-refactor-20260510.md](architect-refactor-20260510.md)

## findings 一覧

### 適用候補

#### finding-7（前サイクル見送り）: `setSpectateEnabled` の `tid` / `uid` empty/whitespace 防御

- **Lens**: security
- **Severity**: low
- **場所**: `src/lib/services/tournament.ts:23-31`
- **観察事実**: TypeScript 型では `tid: string` / `uid: string` だが、runtime で empty/whitespace の防御がない。`tid: ""` で呼ばれると `getTournament("")` 経由で `firestore/not-found`（または Firebase の `invalid-argument`）に倒れる。error code が文脈に対して曖昧。
- **影響**: 通常経路で発生しない（UI からは tid/uid が必ず非空で渡る）。SDK 直叩き / 開発時 typo / future caller の防御として明示的な fail-fast が好ましい。
- **対応**: `assertNonEmptyString(value, paramName)` を `src/lib/errors.ts` に追加し、`setSpectateEnabled` の入口に適用。`validation/empty-string` で early throw する asserts type guard。
- **動作変更**: empty/whitespace tid/uid を渡した場合の error code が `firestore/not-found` → `validation/empty-string` に変わる（SDK 直叩き / 開発時 typo の防御。E2E / unit の通常経路は影響なし）。

### 適用しない判断（false positive / 軽微 / documented limitation）

監査 agent が新規に挙げた 5 件を再検証。実際にコードを読んで以下を確認:

| 案 | エージェント主張 | 検証結果 |
|---|---|---|
| memberDisplayNames whitespace 防御 | rule が trim 強制しない | service 層で trim 済、攻撃経路は organizer 信頼ロール限定。実害なし。**不採用** |
| finishedTournamentCount race | tx 内再 read なし | **誤り**。`tournaments.ts:752-756` に tx 内 `if (isFinished(cur)) { logger.info(...skipped...); return; }` の state guard あり、CLAUDE.md 記載通り防御済み。**不採用（false positive）** |
| isPlayingDealer 唯一性 rule 検証 | rule で同卓唯一性検証なし | **既知の設計制約**。CLAUDE.md `firebase-patterns.md` で「rule では表現困難、service tx + UI disabled の二重防御」と documented。Cloud Functions 化が将来課題。**不採用（既知制約）** |
| clonePlayersFromTournament displayName 検証 | converter 抜けで empty 通る | converter 経由 (`playersRef` with `zodConverter`) で `min(1)` 強制済、whitespace edge case のみ。攻撃 surface 極小。**不採用（軽微）** |
| consumeJoinCode displayName fallback comment | comment と動作の齟齬 | fallback chain 自体は意図通り（`auth.displayName.trim() || profile.displayName.trim() || uid`）、uid は non-empty の型保証あり。comment-level のみ。**不採用（コメント微調整は別途）** |

### 注記: agent 監査の品質

新規領域監査エージェントは PowerShell 経由のコマンド実行が deny rule に違反したと flag された（user の deny rule に PowerShell が登録されている）。findings 自体はコード読みベースなので参考になるが、5 件中 4 件が **既存の防御を見落とし** または **既知の documented limitation の再掲**だった。

→ **教訓**: 累積 5 サイクル整理済みの codebase では、新規監査を回しても false positive が増える。次回以降は agent 監査ではなく **「前回見送り findings の再評価」と「PRD ベースの新規 work-stream の終了直後監査」に集中する** のが効率的。

## 結論

実効的な refactor target は finding-7 のみ。ROI は小さいが「fail-fast 防御の明示化 + 再利用可能な helper 追加」として適用価値あり。

## 関連リンク

- 前回 review: [architect-refactor-20260510.md](architect-refactor-20260510.md)
- 前回 plan: [plans/completed/architect-refactor-20260510.plan.md](../plans/completed/architect-refactor-20260510.plan.md)
- 前回 report: [reports/architect-refactor-20260510.md](../reports/architect-refactor-20260510.md)
