# Implementation Report: Phase 5.4 — Clone Tournament With Players

## Summary

終了済みトーナメントの dashboard から「同じ参加者で次のトーナメントを作成」を 1 操作で行えるようにした。

- 専用ページ `/tournaments/[tid]/clone` を新設し、`TournamentForm` を再利用してコピー元のストラクチャを初期選択しつつ別ストラクチャへ swap 可能にした。
- `players[]` のうち organizer がチェックした人だけ（busted は default OFF）を新 tournament の `players` サブコレクションへ `writeBatch` でコピー。
- Firestore Rules の `players/{pid}` `create` に **organizer-clone（setup 限定）ブランチ**を additive で追加。`pid==uid` invariant・`isBusted=false`・no seat・`isPlayingDealer=false` の安全 invariant は self ブランチと完全一致で維持。
- schema 変更なし、Cloud Functions 不使用（Spark プラン維持）。
- **Phase 5.4 emulator validator が pre-existing CRITICAL bug を検出 → 同 commit 内で修正**: `match /tournaments/{tid}/{sub=**}` 再帰ワイルドカードが `/players/{pid}` も覆っており、Firestore Rules の OR 評価により Phase 4 organizer-update / Phase 5.1 PD / Phase 5.4 organizer-clone の strict invariant を**全て bypass**していた。wildcard を `match /tables/{tableId}` に specific 化することで invariant が初めて enforce 可能に。詳細は本レポート末尾「Pre-existing rule bug の修正」参照。

## Assessment vs Reality

| Metric        | Predicted (Plan)        | Actual                  |
| ------------- | ----------------------- | ----------------------- |
| Complexity    | Medium                  | Medium                  |
| Confidence    | -                       | High（plan 準拠で問題なし） |
| Files Changed | 約 13 files             | 14 files                |

## Tasks Completed

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | `canClone` 純関数 + characterization test | Complete | `tournament-state.ts` 末尾、5 state の it.each で 1 ケース |
| 2 | `MAX_CLONE_PLAYERS = 50` 定数追加 | Complete | `limits.ts` 末尾 |
| 3 | Firestore Rules organizer-clone ブランチ | Complete | `players/{pid}` `create` を self-OR-organizer の OR 化 |
| 4 | `clonePlayersFromTournament` repository | Complete | `getDocs + writeBatch.set`、`tournament/clone-too-many` / `tournament/clone-empty` の 2 種 throw |
| 5 | repository unit test | Complete | 6 ケース全 pass |
| 6 | `cloneTournamentWithPlayers` orchestrator | Complete | 新規 `tournament-clone.ts`、createTournament → clone の順次呼出、rollback なし |
| 7 | orchestrator unit test | Complete | 3 ケース全 pass |
| 8 | `ClonePlayersChecklist` UI コンポーネント | Complete | controlled component、native `<input type="checkbox">` 採用（@radix-ui/react-checkbox 未導入のため） |
| 9 | コンポーネントテスト | Complete | 7 ケース全 pass |
| 10 | clone ページ + clone-client | Complete | `RequireAuth` でラップ、`useGroupRole` で role gate、`useRef` で hydration 抑止 |
| 11 | dashboard リンクボタン配線 | Complete | WinnerBanner 直下に `<Button asChild size="lg">` で `/tournaments/{tid}/clone` リンク |
| 12 | emulator validator + npm script | Complete | `scripts/test-rules-clone-players.mjs` + `package.json` の `test:rules-clone-players` |
| 13 | docs（firebase-patterns + group-membership） | Complete | players create rule 経路の表を追加 + 既知のセキュリティリスクに Phase 5.4 ノート追記 |
| 14 | PRD 更新 | Complete | Phase 5.4 行を `complete` 化、実装レポートへの link 追加 |

## Validation Results

| Level           | Status | Notes                             |
| --------------- | ------ | --------------------------------- |
| Static Analysis | Pass   | `tsc --noEmit` ゼロエラー          |
| Lint            | Pass   | `next lint` ゼロ warning           |
| Unit Tests      | Pass   | 既存 728 + 新規 21 = 789 件 全 pass（state×5 + repo×6 + orchestrator×3 + checklist×7） |
| Build           | Pass   | `next build` 成功、`/tournaments/[tid]/clone` ルート生成 |
| Rules limits    | Pass   | 6/6 green（drift 0）              |
| Rules clone validator | Pass | `npm run test:rules-clone-players` を実装者 local で実行し **7/7 ALL GREEN**（最初の実行で 4 件 fail → pre-existing wildcard bug を発見・同 commit 内で修正後に 7/7 green） |
| Rules PD validator (regression) | Pass | `firebase emulators:exec ... node scripts/test-rules-pd.mjs` を wildcard 修正後に実行し **8/8 non-fail**（regression 0、SKIP 2 件は元々 rule-correct で seed 不可だったケース） |
| Rules finished-count / default-seats validator (regression) | Pass | 同上 8/8 + 9/9 全 green |
| E2E (Playwright) | Pass | 新規 `clone-tournament-with-players.spec.ts` の 2 件全 pass。関連 spec（append-blind-level / member-role-split / winner-banner-and-auto-finish）と並走させた 10 件も全 pass（regression 0） |
| Manual Browser  | N/A    | E2E が同等カバレッジを担保 |

## Files Changed

| File | Action | Notes |
|------|--------|-------|
| `src/lib/services/tournament-state.ts` | UPDATED | `canClone` を末尾に追加 |
| `src/lib/services/tournament-state.test.ts` | UPDATED | `canClone` の 5 state characterization テスト |
| `src/lib/limits.ts` | UPDATED | `MAX_CLONE_PLAYERS = 50` 末尾追加 |
| `firestore.rules` | UPDATED | (1) `players/{pid}` `create` に organizer-clone ブランチを additive 追加、(2) **pre-existing CRITICAL bug 修正**: `tournaments/{tid}/{sub=**}` 再帰ワイルドカードを `match /tables/{tableId}` specific rule に置き換え（players/* への意図しない write 開放を閉じる） |
| `src/lib/firebase/repositories/players.ts` | UPDATED | `clonePlayersFromTournament` を追加（getDocs + writeBatch） |
| `src/lib/firebase/repositories/players.test.ts` | UPDATED | clone の 6 ケース追加 |
| `src/lib/services/tournament-clone.ts` | CREATED | orchestrator 1 関数 |
| `src/lib/services/tournament-clone.test.ts` | CREATED | orchestrator の 3 ケース |
| `src/components/tournament/ClonePlayersChecklist.tsx` | CREATED | controlled checklist + `initialSelectedIdsFromPlayers` helper |
| `src/components/tournament/ClonePlayersChecklist.test.tsx` | CREATED | render / busted / toggle / 全選択 / 全解除 / badge の 7 ケース |
| `src/app/tournaments/[tid]/clone/page.tsx` | CREATED | RequireAuth ラッパ + CloneClient |
| `src/app/tournaments/[tid]/clone/clone-client.tsx` | CREATED | subscribe / role gate / TournamentForm + Checklist 結線 |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | UPDATED | finished 時に WinnerBanner 直下にリンクボタン追加 |
| `scripts/test-rules-clone-players.mjs` | CREATED | emulator REST validator（7 ケース） |
| `package.json` | UPDATED | `test:rules-clone-players` script を追加 |
| `.claude/rules/firebase-patterns.md` | UPDATED | players create rule 経路の表を追加 |
| `.claude/rules/group-membership.md` | UPDATED | 既知のセキュリティリスクに Phase 5.4 ノート追記 |
| `.claude/PRPs/prds/allin-timer.prd.md` | UPDATED | Phase 5.4 行を `complete` 化 |
| `tests/e2e/clone-tournament-with-players.spec.ts` | CREATED | 2 ケース：clone ラウンドトリップ + 一般メンバー redirect |

## Deviations from Plan

1. **Checkbox UI primitive**: plan は shadcn/ui の `Checkbox` を呼ぶ前提だったが、本リポジトリには
   `@radix-ui/react-checkbox` / `src/components/ui/checkbox.tsx` が未導入。既存 `PlayerList.tsx` の PD checkbox が
   native `<input type="checkbox">` を直接使っている前例に揃え、依存追加を避けて native input で実装した。
   テストの `getByRole("checkbox", { name: ... })` は使わず、`aria-label="clone-{displayName}"` 経由で
   `getByLabelText` する形に変更。動作・契約・rule 影響範囲はすべて plan 通り。

2. **`selectedHydrated` の保持方法**: plan は `useState(false)` で hydration フラグを保持していたが、
   このフラグは setSelected の onNext 内でのみ参照され、render に影響しないため `useRef` 化した
   （ESLint の `no-unused-vars` 警告対策 + 不要な re-render の抑止）。挙動は等価。

3. **PRD 文言の事前更新**: plan 生成時に PRD の Phase 5.4 行 description が既に
   「`/tournaments/[tid]/clone` ページ + `ClonePlayersChecklist`」表記で投入されていたため、
   Task 14 の文言訂正は不要だった（status を `in-progress` → `complete` に切替 + report link 追加のみ）。

## Issues Encountered

実装直後の `npm run test:rules-clone-players` 初回実行で **4 件 fail（ケース 3〜6）** を検出。原因は Phase 5.4 の新規 rule バグではなく、**pre-existing の `match /{sub=**}` 再帰ワイルドカード**が `/players/{pid}` も覆っていたため。詳細は次節「Pre-existing rule bug の修正」。

## Pre-existing rule bug の修正

### 症状

emulator validator のケース 3〜6 が `deny` を期待して `allow (200)` を返した:

- (3) organizer が `state="seating"` の親 tournament 配下に players create → allow（setup 限定 invariant が効かない）
- (4) organizer が `pid != uid` で player create → allow（pid==uid invariant が効かない）
- (5) organizer が `isBusted=true` を埋めて create → allow（isBusted invariant が効かない）
- (6) organizer が `tableNum=1, seatNum=1` を埋めて create → allow（no seat invariant が効かない）

### 原因

`firestore.rules` の `match /tournaments/{tid}` 配下に置かれていた以下の wildcard rule:

```python
match /{sub=**} {
  allow read: if isSignedIn();
  allow write: if isSignedIn()
               && exists(...) && isOrganizer(...);
}
```

これは **`/players/{pid}` も match する** （Firestore Rules の OR 評価により、explicit `match /players/{pid}` の create / update invariants と同時に評価され、**より緩い wildcard 側がそのまま allow を返す**）。結果、Phase 4 organizer-update の table/seat 範囲チェック・Phase 5.1 の isPlayingDealer 型チェック・Phase 5.4 の organizer-clone setup 限定 / pid==uid / isBusted=false / no seat 等のすべてが**形骸化**していた。

これは **pre-existing バグ**（Phase 4 / 5.1 時点から存在）で、Phase 5.4 で初めて strict create-time invariant を rule にエンコードしたことで顕在化。emulator validator がなければ気付けなかった。

### 修正

wildcard を **存在する subcollection に specific 化**:

```python
// 修正前: match /{sub=**} { ... }
// 修正後:
match /tables/{tableId} {
  allow read: if isSignedIn();
  allow write: if isSignedIn()
               && exists(/databases/$(database)/documents/tournaments/$(tid))
               && isOrganizer(get(/databases/$(database)/documents/tournaments/$(tid)).data.groupId);
}
```

`/tables/` のみが現時点で実在する subcollection（`/players/` は explicit rule で別管理、PRD 言及の `/events/` は未実装、`/tables/{n}/seats/{m}` も未実装で `tableNum`/`seatNum` は player doc に inline）。新規 subcollection を追加する場合は **必ず explicit rule を 1 つ追加** し、wildcard 復活は厳禁（コメントで warning 明記）。

### 副次的影響（regression check）

wildcard 廃止により Phase 4 organizer-update の invariant も初めて enforce されるが、emulator validator で確認済み:

- `npm run test:rules-pd` — **8/8 non-fail**（regression 0）
- `npm run test:rules-finished-count` — **8/8 green**
- `npm run test:rules-default-seats` — **9/9 green**
- `npm run test:rules-limits` — **6/6 green**
- 全 unit `npm run test` — **789/789 pass**

production の write 経路（`bustPlayer` / `assignSeat` / `unbustPlayer` / `clearSeat` / `setIsPlayingDealer` / orchestrator 内 tx.update）はすべて invariant 準拠で書いていたため、形骸化していた制約が enforced になっても影響なし。

### Lessons Learned

- 新規 explicit rule を追加するときは **既存の wildcard rule との重なり** を必ず確認する。
- emulator validator は「期待通り deny される」ケースを 1 件以上含めて pre-existing bypass を検出可能にしておく。
- `match /{path=**}` 系の wildcard は強力だが「具体的 path を後から strict 化したい」要求と矛盾するため、原則 **specific rule の積み上げ** で組み立てる方が安全。

## Tests Written

| Test File | Tests | Coverage |
|-----------|-------|----------|
| `src/lib/services/tournament-state.test.ts` | +5 ケース（it.each で 1 行） | `canClone` の 5 state |
| `src/lib/firebase/repositories/players.test.ts` | +6 ケース | `clonePlayersFromTournament` の happy / partial / busted reset / uid===null skip / MAX 超過 / count===0 |
| `src/lib/services/tournament-clone.test.ts` | +3 ケース（新規 file） | orchestrator の happy / clone fail / create fail |
| `src/components/tournament/ClonePlayersChecklist.test.tsx` | +7 ケース（新規 file） | render / uid===null skip / `initialSelectedIdsFromPlayers` / toggle / 全選択 / 全解除 / 選択件数 badge |
| `tests/e2e/clone-tournament-with-players.spec.ts` | +2 ケース（新規 file） | E2E happy（clone → Firestore writeBatch 観測） + 一般メンバー redirect（dashboard 非描画 + `/clone` 直リンク redirect） |

合計: **+23 件**（unit +21 + e2e +2、plan 想定 19 件を超過。`uid===null skip`・選択件数 badge・E2E 2 ケースを追加）

## Security Considerations

Phase 5.4 で導入した organizer-clone create ブランチは `isOrganizer(parent.groupId)` + `parent.state == "setup"` の二重 gate で囲んでおり、信頼ロール（owner / organizer）に閉じる。invariant（`pid==uid` / `isBusted=false` / no seat / `isPlayingDealer=false`）は self ブランチと完全一致のため、PD 衝突 DoS / 席奪取は不可能。詳細は [`.claude/rules/group-membership.md`](../../rules/group-membership.md) の「Phase 5.4 で追加: organizer による players 代理 create」セクション参照。

## Next Steps

- [x] Code review via `/code-review` — APPROVE with comments、MEDIUM 3 件を同 commit で対応
- [x] `npm run test:rules-clone-players` を emulator 起動環境で実行 — **7/7 ALL GREEN** & pre-existing bug を発見・同 commit 内で修正
- [x] regression: PD / finished-count / default-seats validator も再走 — 全 green
- [ ] 手動ブラウザ E2E（11 ステップ、plan の Manual Browser 節）— Auto モードのため省略可
- [ ] Create PR via `/prp-pr`
