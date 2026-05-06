# Local Code Review: Phase A — Season Stats Foundation

**Reviewed**: 2026-05-06
**Branch**: develop（uncommitted）
**Scope**: PRD 02 Phase A シーズン戦績基盤（`seasonStats` / `seasonHistory` / `seasonStartDate` /
`finishTournament` 拡張 / `startNewSeason` 新設 / シーズンランキング画面）

**Decision**: REQUEST CHANGES（初版）→ **APPROVE（H-1 / M-1 / M-2 修正反映後）**

## 修正後の検証結果（2026-05-06 後段、L-1 / L-2 / L-3 追加対応後）

| Check                  | Result                       |
| ---------------------- | ---------------------------- |
| typecheck              | Pass                         |
| lint                   | Pass                         |
| vitest                 | **889 passed**（+10 新規追加、-3 削除） |
| Next.js build          | Pass                         |
| rules-limits drift     | **Pass (9/9 ALL GREEN)**（+3 displayName 上限） |

修正コミット対象:
- [src/lib/firebase/repositories/seasonStats.ts](src/lib/firebase/repositories/seasonStats.ts) — `seasonStatsRawDocRef` を export
- [src/lib/firebase/repositories/tournaments.ts](src/lib/firebase/repositories/tournaments.ts) — `toPrevStats` helper 追加 / tx.get を raw ref に切替 / displayName slice
- [src/lib/firebase/repositories/groups.ts](src/lib/firebase/repositories/groups.ts) — **L-1**: `updateSeasonStartDate` 削除（YAGNI、startNewSeason の tx.update に集約）
- [src/lib/services/group.ts](src/lib/services/group.ts) — `startNewSeason` に進行中 tournament pre-check / history entries の displayName slice 追加
- [src/lib/services/group.test.ts](src/lib/services/group.test.ts) — listTournamentsByGroup mock + 新規 4 テスト
- [src/lib/services/season-points.test.ts](src/lib/services/season-points.test.ts) — **L-3**: `Math.round(x*100)/100` 半丸め境界 7 サンプルを `it.each` で characterize
- [scripts/test-rules-limits.mjs](scripts/test-rules-limits.mjs) — **L-2**: drift check に displayName 上限の 3 経路を追加。`parseConstFromText` を一般化し group.ts からも `DISPLAY_NAME_MAX_LENGTH` を抽出。`pattern` / `minOccurrences` で複雑形 LHS 対応。
- [.claude/rules/firebase-patterns.md](.claude/rules/firebase-patterns.md) — **L-2**: drift check カバレッジと新規リミット追加手順を更新
- [src/lib/firebase/repositories/tournaments.test.ts](src/lib/firebase/repositories/tournaments.test.ts) — H-1 / M-1 防御テスト 2 件
- [src/lib/firebase/repositories/groups.test.ts](src/lib/firebase/repositories/groups.test.ts) — `updateSeasonStartDate` 系 3 テスト削除（L-1 連動）
- [.claude/rules/group-membership.md](.claude/rules/group-membership.md) / [.claude/rules/error-logging.md](.claude/rules/error-logging.md) — 規約に防御方針と新エラーコードを反映

## Summary

PRD 02 Phase A の実装は規約遵守・テスト充実・ルール検証スクリプト整備の点で堅実だが、
`finishTournament` の `seasonStats` 書込で **player/user の `displayName` が
15 文字超過のケース** が rule によって deny され、トーナメント終了が
全体失敗する可能性がある（HIGH）。同経路には converter 経由 read による
schema-drift 障害も潜在し、実運用でブロッカーになり得る。
他はテスト・ルール・UI とも green で、build / typecheck / lint / 879 unit / rules-limits 全て pass。

## Findings

### CRITICAL

None.

### HIGH

#### H-1: `finishTournament` で displayName 長 15 超過の player がいると tx 全体が rule deny で失敗する

**Location**: [src/lib/firebase/repositories/tournaments.ts:639-650](src/lib/firebase/repositories/tournaments.ts#L639-L650),
[firestore.rules:253-255](firestore.rules#L253-L255)

**症状**: `seasonStats/{uid}` の rule は
```
displayName.size() >= 1 && displayName.size() <= 15
```
を強制する。一方 player 側スキーマは `playerBodySchema.displayName = z.string().min(1)`（max なし、
[src/lib/firebase/schemas/player.ts:7](src/lib/firebase/schemas/player.ts#L7)）、`userProfileBodySchema.displayName` も
同じく min(1) のみ（[src/lib/firebase/schemas/user.ts:10](src/lib/firebase/schemas/user.ts#L10)）。
受付フローの `joinInputSchema`（[player.ts:31-38](src/lib/firebase/schemas/player.ts#L31-L38)）は max を強制するが、
`receipt.ts` の `resolveDisplayName` は `users/{uid}.displayName` / `auth.displayName` をそのまま採用し、
**長文字列をフィルタしない**。つまり Google アカウントの本名等が 15 文字を超える場合、
players doc にはそのまま書かれ、`finishTournament` の `tx.set(seasonStatsDocRef, { displayName: e.displayName, ... })` が
rule で deny → tx rollback → `firestore/write_failed` で **トーナメント終了不能**。

実運用での再現性: 日本人名 + フルネーム（漢字 6〜8 字、ローマ字 15+）/ Google 本名表示が
ハンドル名でない場合に十分起こり得る。1 人でも該当者がいると全員の終了処理が止まる。

**推奨修正**: tournaments.ts の seasonStats 書込時に displayName を 15 文字に切り詰める:

```ts
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/firebase/schemas/group";
// ...
const next = {
  uid: e.playerUid,
  displayName: e.displayName.slice(0, DISPLAY_NAME_MAX_LENGTH),
  // ...
};
```

副次的に `seasonHistoryEntrySchema` の `displayName` も `max(DISPLAY_NAME_MAX_LENGTH)` を持つため
`startNewSeason` の snapshot でも同じ truncation が必要（startNewSeason は `data.displayName` を
そのまま entries に詰めているので、同様に slice すべき）。

別案: `playerBodySchema` / `userProfileBodySchema` に `max(DISPLAY_NAME_MAX_LENGTH)` を追加して
全経路で 15 字制約に揃える（影響範囲は広いが根本治療）。本 Phase の最小修正としては
slice 防御 + `players` 経路の長期 cleanup を別途計画推奨。

### MEDIUM

#### M-1: `tx.get` 内で `seasonStats` の converter が schema mismatch を起こすと finish 全体が失敗する

**Location**: [src/lib/firebase/repositories/tournaments.ts:610-624](src/lib/firebase/repositories/tournaments.ts#L610-L624)

`seasonStatsDocRef(gid, uid)` は `withConverter(zodConverter(...))` を持つため、
`existing.data()` 呼出時に zod validation が走る。**過去シーズンのスキーマで作られた
1 件の不整合 doc** があると、tx.get がそのまま `firestore/invalid-data` を throw し、
`finishTournament` 全体が失敗する。`listSeasonStats` / `subscribeSeasonStats` は
個別 doc の try/catch を備えるが、tx.get には同等の防御がない。

将来 schema を additive で進化させる場合、旧 doc の field 不在は default で吸収できるが、
**型変換不能な値**（例: 旧 `totalPoints: string`）が混入すると tx を起こせなくなる。

**推奨修正**:
- (a) tx 内では converter を当てない素の `doc(firestore, "groups", gid, "seasonStats", uid)` で読み、
      `existing.data()` を `Record<string, unknown>` として扱い、必要な数値を `Number(...)` で
      防御的に取得する（list/subscribe は converter のままで OK）。
- (b) または `seasonStatsBodySchema` を additive に保つ規約を [firebase-patterns.md](.claude/rules/firebase-patterns.md) に明記し、
      breaking change を禁ずる（移行パスは別途）。

20 人規模のサークルでは現状 1 件の corrupt doc も発生確率は低いが、
PRD 02 の Phase B 以降で `seasonStats` を additive 拡張する際の事故防衛として
今段階で対処しておくのが望ましい。

#### M-2: `startNewSeason` と `finishTournament` の race で新シーズンに旧 stats が漏れる

**Location**: [src/lib/services/group.ts:386-420](src/lib/services/group.ts#L386-L420)

実装コメントが既に言及済みの既知のリスク:
1. `startNewSeason` は tx 起動前に `getDocs(seasonStatsRef(gid))` で旧 stats を pre-read
2. tx 内で `tx.delete(d.ref)` を pre-read で得た ref に対してのみ発行
3. pre-read 後・tx commit 前に `finishTournament` が走り、**新規 uid の seasonStats doc を作る** と、
   その doc は (a) `entries` snapshot に含まれず、(b) tx.delete 対象でもないため、
   **新シーズンに旧トーナメントの stat が混在**する。

20 人規模で月 1〜2 回開催・運営者がシーズン切替を意図的に行う前提では発生確率は低いが、
「シーズン切替直後にもう 1 戦走らせて締めた」運用で容易に踏める。

**推奨修正（軽量）**:
- `startNewSeason` の前提条件として「進行中（running/paused/seating）の tournament が
  当該 group に存在しないこと」を pre-check で要求し、UI でも進行中があるとボタン disabled に倒す。
- もしくは `finishTournament` 側で `groups/{gid}.seasonStartDate` を tx.get で読み、
  「自分の tournament 終了が *新* シーズンに帰属するべきか」を tx 内で再評価する（実装複雑度高）。

長期的には Cloud Functions 化で完全 race-free にする計画（コメント記載済み）でよい。
本 Phase では UI の進行中ガード追加だけでも実害は十分に塞げる。

### LOW

#### L-1: `updateSeasonStartDate` repository は service / UI から呼ばれない

**Location**: [src/lib/firebase/repositories/groups.ts:309-328](src/lib/firebase/repositories/groups.ts#L309-L328)

「テスト・運用補正用の保険経路」と明示的にコメントされているが、UI から呼出経路がない。
[CLAUDE.md](CLAUDE.md) の YAGNI 原則と整合させる場合、削除して
`startNewSeason` の tx.update 単独に絞るほうが drift しにくい。残すなら repository test
（[groups.test.ts:211-236](src/lib/firebase/repositories/groups.test.ts#L211-L236)）が拾うので acceptable。
判断は実装者に委ねる。

#### L-2: `seasonStats` rule の displayName 制約と zod schema が局所的に二重定義

`firestore.rules` の `seasonStats` rule は `displayName.size() <= 15` をハードコードする一方、
schema は `DISPLAY_NAME_MAX_LENGTH = 15` を import 経由で使う。drift 検出は
[scripts/test-rules-limits.mjs](scripts/test-rules-limits.mjs) に追加されていないため、
将来 `DISPLAY_NAME_MAX_LENGTH` を変えると rule 側がずれる。

**推奨**: `test-rules-limits.mjs` の `EXPECTED` / `checks` に displayName 上限の検査を 1 件追加する
（[firebase-patterns.md](.claude/rules/firebase-patterns.md) の「数値リミット定数の単一真実源」節の手順に従う）。

#### L-3: `season-points.test.ts` に「100 倍丸めの境界（0.005）」テストがない

`Math.round(... * 100) / 100` は 0.005 では銀行家丸めではなく半丸め切り上げになるが、
現実値（base × sqrt(N/8)）でこの境界を踏むケースが起きにくいため副作用は薄い。
ただし将来 base/baseline を変える際に挙動が変わる可能性があるので、
`calcSeasonPoints(rank=1, totalParticipants=...)` で 0.005 ぴったりの値を生む組合せを
1 件 characterize しておくと安全。

#### L-4: PRD/plan の `defaultSeatsPerTable` default 9→8 変更に伴う既存 group の hydrate 挙動

[group.ts:87-92](src/lib/firebase/schemas/group.ts#L87-L92) の `default(8)` は **新規 hydrate 時のみ**適用。
旧 group が「過去に明示的に 9 を保存」している場合は引き続き 9 で hydrate される
（コメント記載済み）。挙動として正しいが、シーズンポイント baseline=8 と
ずれる group が残るのが意図と整合するか PRD 上で明記しておくと運用上安心。

## Validation Results

| Check               | Result                                |
| ------------------- | ------------------------------------- |
| Type check          | Pass（`tsc --noEmit` 0 errors）       |
| Lint                | Pass（`next lint` 0 warnings/errors） |
| Tests               | Pass（vitest 879/879）                |
| Build               | Pass（Next.js build 成功）            |
| rules-limits drift  | Pass（6/6 ALL GREEN）                 |
| rules-season (emu)  | Skipped（ローカルでは emulator 必要、scripts は整備済み） |

## Files Reviewed

### Added
- [src/lib/firebase/schemas/seasonStats.ts](src/lib/firebase/schemas/seasonStats.ts)
- [src/lib/firebase/schemas/seasonHistory.ts](src/lib/firebase/schemas/seasonHistory.ts)
- [src/lib/firebase/repositories/seasonStats.ts](src/lib/firebase/repositories/seasonStats.ts)
- [src/lib/firebase/repositories/seasonStats.test.ts](src/lib/firebase/repositories/seasonStats.test.ts)
- [src/lib/firebase/repositories/seasonHistory.ts](src/lib/firebase/repositories/seasonHistory.ts)
- [src/lib/firebase/repositories/seasonHistory.test.ts](src/lib/firebase/repositories/seasonHistory.test.ts)
- [src/lib/services/season-points.ts](src/lib/services/season-points.ts)
- [src/lib/services/season-points.test.ts](src/lib/services/season-points.test.ts)
- [src/app/groups/[gid]/_components/SeasonCard.tsx](src/app/groups/%5Bgid%5D/_components/SeasonCard.tsx)
- [src/app/groups/[gid]/_components/StartSeasonDialog.tsx](src/app/groups/%5Bgid%5D/_components/StartSeasonDialog.tsx)
- [src/app/groups/[gid]/season/page.tsx](src/app/groups/%5Bgid%5D/season/page.tsx)
- [src/app/groups/[gid]/season/season-ranking-client.tsx](src/app/groups/%5Bgid%5D/season/season-ranking-client.tsx)
- [scripts/test-rules-season.mjs](scripts/test-rules-season.mjs)

### Modified
- [firestore.rules](firestore.rules)（+47 行: seasonStartDate / seasonStats / seasonHistory rule 追加）
- [src/lib/firebase/schemas/group.ts](src/lib/firebase/schemas/group.ts)（seasonStartDate field 追加）
- [src/lib/firebase/repositories/groups.ts](src/lib/firebase/repositories/groups.ts)（updateSeasonStartDate 追加）
- [src/lib/firebase/repositories/tournaments.ts](src/lib/firebase/repositories/tournaments.ts)（finishTournament tx 拡張）
- [src/lib/firebase/repositories/players.ts](src/lib/firebase/repositories/players.ts)（listPlayers 追加）
- [src/lib/services/group.ts](src/lib/services/group.ts)（startNewSeason 追加）
- [src/lib/services/timer.ts](src/lib/services/timer.ts)（resolveRanking 追加）
- [src/lib/limits.ts](src/lib/limits.ts)（SEASON_POINTS_BASE / BASELINE_PARTICIPANTS / FINAL_TABLE_THRESHOLD 追加、DEFAULT_SEATS_PER_TABLE 9→8）
- [src/app/groups/[gid]/group-detail-client.tsx](src/app/groups/%5Bgid%5D/group-detail-client.tsx)（SeasonCard 配置）
- 関連テスト 6 ファイル（all green）
- 規約: [.claude/rules/error-logging.md](.claude/rules/error-logging.md) / [firebase-patterns.md](.claude/rules/firebase-patterns.md) / [group-membership.md](.claude/rules/group-membership.md) に Phase A 記述追加
- [package.json](package.json)（test:rules-season script 追加）

### Deleted
- [.claude/PRPs/plans/02-season-stats-and-share/phase-a-season-stats-foundation.plan.md](.claude/PRPs/plans/02-season-stats-and-share/phase-a-season-stats-foundation.plan.md)（completed/ への移動）

## 次の手順

1. **H-1 修正必須**: tournaments.ts と group.ts（startNewSeason）で displayName を slice 防御
2. **M-1**: tx 内 seasonStats read を converter 抜きに切替えるか、schema additive 規約を明文化
3. **M-2**: startNewSeason で「進行中 tournament 存在チェック」を pre-condition に追加
4. （optional）L-2: rules-limits drift check に displayName 上限を追加
5. emulator 環境で `npm run test:rules-season` を 1 回流して all-green 確認
