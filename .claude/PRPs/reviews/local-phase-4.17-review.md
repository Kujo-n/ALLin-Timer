# Local Review: Phase 4.17 — group の `defaultSeatsPerTable` 追加

**実施日**: 2026-04-28
**対象ブランチ**: develop
**対象**: 未コミット差分（13 ファイル変更 + 3 ファイル新規）
**判定**: APPROVE — CRITICAL/HIGH 0 件、MEDIUM 2 件、LOW 3 件（いずれも Phase 4.16 と同様の既知パターン）

---

## サマリ

`groups/{gid}` に `defaultSeatsPerTable: int [2..10] default 9` を **additive** に追加し、
新規トーナメント作成画面の「1 Table あたりの席数」初期値として流し込む実装。設計は
Phase 4.16 (`finishedTournamentCount`) の **single-field-update + `affectedKeys().hasOnly()` パターン**
を厳密に踏襲しており、rule / schema / repo / service / UI の 5 層に値域 `2..10` を二重防御で配置している。

セキュリティ境界は健全で、self-* 経路（self-add / self-leave / self-key memberDisplayNames update）の
`affectedKeys` 許可リストには本フィールドを含めていないため、一般メンバーからの改竄経路は無い。
DRIFT WARNING は [.claude/rules/firebase-patterns.md](../rules/firebase-patterns.md) と
[.claude/rules/group-membership.md](../rules/group-membership.md) の双方に明記されており、
`tournament.seatsPerTable.max(10)` / `players seatNum <= 10` との連動も維持。

---

## Findings

### CRITICAL

なし。

### HIGH

なし。security-critical な観点を順に確認:

- **rule 側 enforcement**: 新規分岐 [firestore.rules:208-220](../../firestore.rules#L208-L220) は
  `isOrganizer(gid)` + `affectedKeys().hasOnly(['defaultSeatsPerTable'])` + `is int` + `>= 2` + `<= 10`
  の 5 条件を AND で要求。任意フィールド汚染・型不整合・値域外を rule 側でブロック。
- **self-* 経路の不正利用阻止**: self-add / self-leave / self-key memberDisplayNames update の
  3 分岐の `affectedKeys` ホワイトリストには `defaultSeatsPerTable` を含めていない
  ([firestore.rules:104, 134, 170](../../firestore.rules#L104))。
  Phase 4.16 で修復済みの「self-* affectedKeys 抜け」と同方針。
- **DRIFT 整合性**: zod の `.min(2).max(10)`、rule の `>= 2 / <= 10`、`tournament.seatsPerTable.min(2).max(10)`、
  rule の `players seatNum <= 10` がすべて 10 に揃っている。コメントで連動明記。
- **emulator validation**: [scripts/test-rules-default-seats.mjs](../../scripts/test-rules-default-seats.mjs)
  に 9 ケース（境界値 / 範囲外 / affectedKeys 違反 / member 拒否 / owner full update / legacy doc）の REST 直叩き
  検証スクリプトを同梱。`finishedTournamentCount` 用と同じ方針。
- **legacy doc 互換**: zod default(9) で hydrate するため破壊的 migration なし。
  emulator script のケース (9) でも `defaultSeatsPerTable` 未設定 doc に対する organizer の追加書込が allow される
  ことを確認。

### MEDIUM

#### M1. `TournamentForm` の `useState` 初期化が prop の遅延到着を反映しない（pre-existing）

[TournamentForm.tsx:61-63](../../src/components/tournament/TournamentForm.tsx#L61-L63)

```tsx
const [seatsPerTable, setSeatsPerTable] = useState<number>(
  initialSeatsPerTable ?? DEFAULT_SEATS_PER_TABLE,
);
```

`useState` の初期化は mount 時のみ。`useCurrentGroup` の `groups` が
form mount 後に hydrate されるケースでは、入力欄は 9 のまま残り、サークル設定の
`defaultSeatsPerTable` が反映されない。

**緩和**: 親 [tournament-new-client.tsx:46-48](../../src/app/tournaments/new/tournament-new-client.tsx#L46-L48) が
`loading || !isOrganizer` で読込中の "読込中…" を表示してから form をマウントしているため、
実用上は initial value が確定した後で form がマウントされる。`initialName`（Phase 4.16）と同じパターン。

**推奨対応**: blocking ではないが、もし `useCurrentGroup` の reactive な再 fetch を将来追加するなら、
`useEffect([initialSeatsPerTable])` で同期する controlled-form パターンへの移行を検討。

#### M2. `editingSeats` 中の `reload()` で入力値が破棄され得る（pre-existing パターン）

[group-detail-client.tsx:158-160](../../src/app/groups/[gid]/group-detail-client.tsx#L158-L160)

```tsx
useEffect(() => {
  if (group) setSeatsValue(String(group.defaultSeatsPerTable ?? 9));
}, [group]);
```

`editingSeats === true` 中に `reload()` が走ると（現状の触媒は無いが、将来 onSnapshot 化する想定）
`useEffect` が `seatsValue` を上書きし、ユーザーの入力中の文字列が消える。
`editingCount`（Phase 4.16）/ `editingName` も同じ挙動。

**推奨対応**: `if (!editingSeats) setSeatsValue(...)` ガードで全 3 inline-edit を一括強化すると
将来 onSnapshot 化したときの UX 後退を防げる。本 PR 範囲外でも可。

### LOW

#### L1. マジックナンバー `9` の重複（5 箇所）

`9` が以下に重複定義:
- [schemas/group.ts:84](../../src/lib/firebase/schemas/group.ts#L84) — zod default
- [repositories/groups.ts:54](../../src/lib/firebase/repositories/groups.ts#L54) — createGroup の seed
- [group-detail-client.tsx:85, 159, 252-253, 283, 293, 306, 570](../../src/app/groups/[gid]/group-detail-client.tsx) — 7 箇所
- [TournamentForm.tsx:35](../../src/components/tournament/TournamentForm.tsx#L35) — `DEFAULT_SEATS_PER_TABLE`
- [test-rules-default-seats.mjs:152](../../scripts/test-rules-default-seats.mjs#L152) — emulator seed

**推奨**: schema 側に `DEFAULT_GROUP_SEATS_PER_TABLE = 9` を export して各所で参照すると将来の値変更時の漏れを防止できる
（`DISPLAY_NAME_MAX_LENGTH` と同方針）。

#### L2. service / repository の値域 pre-check が完全に重複

[services/group.ts:328-333](../../src/lib/services/group.ts#L328-L333) と
[repositories/groups.ts:283-288](../../src/lib/firebase/repositories/groups.ts#L283-L288) は
同じ `Number.isInteger + >= 2 + <= 10` チェックを行っている。`setFinishedTournamentCount`
と同じ重複だが、service 側は `getGroup` 前に early-return することで Firestore read を 1 件節約する意味がある。

**判定**: 意図的な多層防御として許容（Phase 4.16 と一貫）。

#### L3. `cancelEditingSeats` の base 値が型不整合

[group-detail-client.tsx:293](../../src/app/groups/[gid]/group-detail-client.tsx#L293)

```tsx
setSeatsValue(String(group?.defaultSeatsPerTable ?? 9));
```

`group` は早期 return で non-null が保証されているこの位置でも `?.` を使っているため `?? 9` が
保険として残る。実害なしだが、`group` を non-null narrowing して `String(group.defaultSeatsPerTable)` の方が
schema default 9 を信頼する形になり一貫性が出る（schema が defaut(9) を保証している）。
`startEditingSeats` / `cancelEditingCount` も同パターン。

---

## Validation Results

| Check                     | Result                                                                |
| ------------------------- | --------------------------------------------------------------------- |
| Type check (tsc --noEmit) | **Pass**                                                              |
| Vitest (changed)          | **Pass** — 138/138（schemas: 67, repositories/groups: 21, services/group: 50） |
| Lint                      | Skipped（PR 範囲外、別途 CI）                                         |
| Build                     | Skipped                                                               |
| Rules emulator (4.17)     | Not executed in this review — `firebase emulators:exec` 起動が必要。コードレビュー上はシナリオ網羅性 OK |

---

## Files Reviewed

### Modified (source)

- [firestore.rules](../../firestore.rules) — `defaultSeatsPerTable` 単独書換 branch 追加（+14 行）
- [src/lib/firebase/schemas/group.ts](../../src/lib/firebase/schemas/group.ts) — additive field、default(9)、min(2)/max(10)
- [src/lib/firebase/repositories/groups.ts](../../src/lib/firebase/repositories/groups.ts) — `updateDefaultSeatsPerTable` + createGroup 初期値
- [src/lib/services/group.ts](../../src/lib/services/group.ts) — `setDefaultSeatsPerTable`（assertOrganizer + repo 委譲）
- [src/app/groups/[gid]/group-detail-client.tsx](../../src/app/groups/[gid]/group-detail-client.tsx) — inline edit Card（+119 行）
- [src/app/tournaments/new/tournament-new-client.tsx](../../src/app/tournaments/new/tournament-new-client.tsx) — `initialSeatsPerTable` 流し込み

### Modified (tests)

- [src/lib/firebase/schemas/index.test.ts](../../src/lib/firebase/schemas/index.test.ts) — 4.17 schema 検証 4 ケース + fixture 更新
- [src/lib/firebase/repositories/groups.test.ts](../../src/lib/firebase/repositories/groups.test.ts) — `updateDefaultSeatsPerTable` 検証 4 ケース（境界値 / 範囲外 / Firestore reject）
- [src/lib/services/group.test.ts](../../src/lib/services/group.test.ts) — `setDefaultSeatsPerTable` 検証 4 ケース（owner / organizer / member / 範囲外）
- [src/lib/hooks/useAudioPlayer.test.tsx](../../src/lib/hooks/useAudioPlayer.test.tsx) — `makeGroup` fixture に新フィールド追加（必須補完のみ）

### Modified (docs / rules)

- [.claude/rules/firebase-patterns.md](../rules/firebase-patterns.md) — `defaultSeatsPerTable` 経路を「単一フィールド単独書換」セクションに追記
- [.claude/rules/group-membership.md](../rules/group-membership.md) — データモデル / 権限マトリクス / 既知のリスクに追記
- [.claude/PRPs/prds/allin-timer.prd.md](../prds/allin-timer.prd.md) — Phase 4.17 進捗

### New

- [.claude/PRPs/plans/completed/phase-4.17-group-default-seats-per-table.plan.md](../PRPs/plans/completed/phase-4.17-group-default-seats-per-table.plan.md)
- [.claude/PRPs/reports/phase-4.17-group-default-seats-per-table-report.md](../PRPs/reports/phase-4.17-group-default-seats-per-table-report.md)
- [scripts/test-rules-default-seats.mjs](../../scripts/test-rules-default-seats.mjs) — emulator REST 検証 9 ケース

---

## Decision Rationale

- セキュリティ critical な検証点（rule の affectedKeys 制約 / self-* 経路の遮断 / 値域 enforcement /
  DRIFT WARNING / legacy doc 互換）はすべて Phase 4.16 のパターンを忠実に踏襲。
- テストカバレッジは schema / repo / service の 3 層 + emulator script で十分。
- MEDIUM / LOW の指摘はすべて Phase 4.16 と共通の pre-existing パターンで、本 PR の責務外。
  L1（マジックナンバー集約）は将来のリファクタリングで横断的に対応するのが自然。

**Merge ready**。
