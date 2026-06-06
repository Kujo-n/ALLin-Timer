# ローカルコードレビュー: Phase 1 受付代理データ層（07-third-dryrun-improvements）

**レビュー日**: 2026-06-06
**ブランチ**: feat/phase-1-proxy-receipt-data-layer
**対象**: 未コミットの作業ツリー差分（9 modified + 4 untracked）
**判定**: APPROVE（コメント付き — MEDIUM 2 件 / LOW 2 件、CRITICAL / HIGH なし）
**対応状況**: MEDIUM 2 件は本レビュー後に修正済み（2026-06-06）。詳細は末尾「対応記録」参照

## サマリー

運営者による受付代理（member-proxy / name-only）のデータ層を、rule・schema・service・repository・テスト・ドキュメントの整合を取りながら追加する良質な実装。DRIFT WARNING の運用（4-state リテラルを rule / `isAcceptingProxyEntry` / test / コメントで同期）が一貫しており、二重防御（rule + service）・invariant の各ブランチ反映も適切。型検査・lint・unit（139 件）・build すべて green。指摘はいずれも信頼境界内（organizer）の整合性・保守性に関する改善提案で、マージを妨げるものではない。

## Findings

### CRITICAL

なし

### HIGH

なし

### MEDIUM

**M1. `assertAcceptingProxyEntry` / `parseProxyDisplayName` が `receipt.ts` のロジックを複製しており drift する**
[proxy-receipt.ts:39-72](src/lib/services/proxy-receipt.ts#L39-L72)

`assertAcceptingProxyEntry` は [receipt.ts:20-32](src/lib/services/receipt.ts#L20-L32) の `assertAcceptingEntries` と、`parseProxyDisplayName` は同 file の `requireDisplayName` と semantics が完全一致するコピーになっている。コメントに「receipt の private 関数を export 変更すると receipt.test に影響するため複製」とあるが、将来 late-entry 締切の判定（例: deadline を `>=` に変える等）を `receipt.ts` 側だけ直すと、受付代理経路が静かに乖離する。両者の parity を担保するテストも無い。

**Suggested fix**: receipt の private 関数を export 変更するのではなく、`assertAcceptingEntries(t)` / `parseDisplayName(name)` を新規の共有モジュール（例: `services/entry-guards.ts`）に切り出し、`receipt.ts` と `proxy-receipt.ts` の両方から import する。`tournament-state.ts` は「state のみを扱う（late entry deadline は service 側）」と明記しているため、そこへは置かない。receipt.test は helper 境界を assert する形（[testing.md](.claude/rules/testing.md) の mock 境界規約）に寄せれば export 変更の影響を吸収できる。

**M2. `addMemberPlayerByOrganizer` が `memberUid` の group メンバーシップを検証していない**
[proxy-receipt.ts:78-104](src/lib/services/proxy-receipt.ts#L78-L104)

service は `memberUid` を非空文字列チェックするだけで、`group.memberUids`（既に `getGroup` で取得済み）に含まれるかを検証していない。rule 側も `uid is string` + `pid == uid` のみで membership を問わない。このため organizer は「実在しない uid」や「サークル外の uid」、あるいは「参加していない実在メンバーの uid」で player doc を作れる。後者が問題で、[tournaments.ts:813-823](src/lib/firebase/repositories/tournaments.ts#L813-L823) の `finishTournament` は `uid === null` のみ skip するため、**proxy で作られた uid=string の player はシーズン戦績（participations / wins / FT / points）に加算される**。Phase 2 UI で uid を手入力・typo した場合、不参加メンバーに戦績が付く静かな整合性バグになり得る。

[group-membership.md](.claude/rules/group-membership.md) の「既知のセキュリティリスク」には「member の uid を流用」とあるが、実装は membership 非検証なので記述より広い（"member"-proxy という命名は実態より限定的）。organizer は信頼ロールのため実害は限定的だが、group 取得済みで検証コストはゼロに近い。

**Suggested fix**: service で `if (!group.memberUids.includes(memberUid)) throw new AppError("...", "group/not-member")` を追加（defense-in-depth）。Phase 2 UI が member 一覧から選ぶ設計でも、データ層で弾いておくと typo / 将来の別呼出元に強い。困難なら最低限ドキュメントの「member の uid を流用」を「任意 uid を指定可能・membership 非検証」に正す。

### LOW

**L1. `addNamedOnlyPlayerByOrganizer` のテスト網羅が member 側より薄い**
[proxy-receipt.test.ts:165-218](src/lib/services/proxy-receipt.test.ts#L165-L218)

name-only 側は late-entry 締切超過ケース（`running + currentLevel > deadline`）と displayName 16 文字超過ケースが無い（member 側にはある）。`assertAcceptingProxyEntry` / `parseProxyDisplayName` を共有するため実害リスクは低いが、両関数の対称性のため 2 ケース追加が望ましい。また両 service とも `seating` state の allow ケースが明示されていない（`isAcceptingProxyEntry` の unit では網羅済み）。

**L2. `parseProxyDisplayName` が role / state チェックより先に走る**
[proxy-receipt.ts:92](src/lib/services/proxy-receipt.ts#L92), [121](src/lib/services/proxy-receipt.ts#L121)

displayName 検証が `getTournament` → `assertOrganizer` より前にあるため、非 organizer が空名で呼ぶと `validation/*` が先に返る。情報漏洩には当たらず（tournament の存在有無を漏らさない方向）実害なしだが、`receipt.ts` も同順のため意図的なら問題なし。指摘は記録のみ。

## Validation Results

| Check      | Result  | 備考 |
| ---------- | ------- | ---- |
| Type check | Pass    | `tsc --noEmit` クリーン |
| Lint       | Pass    | ESLint 警告・エラーなし |
| Tests      | Pass    | unit 139 件 green（proxy-receipt / players / tournament-state） |
| Build      | Pass    | `next build` 成功 |
| Rules (emulator) | Skipped | `test:rules-proxy-create` / `test:rules-clone-players` は emulator 必須のため未実行。マージ前に手動実行（`npm run test:rules-proxy-create`）を推奨 |

## Files Reviewed

- `src/lib/services/proxy-receipt.ts`（Added）
- `src/lib/services/proxy-receipt.test.ts`（Added）
- `scripts/test-rules-proxy-create.mjs`（Added）
- `src/lib/firebase/repositories/players.ts`（Modified — `createNamedOnlyPlayer`）
- `src/lib/firebase/repositories/players.test.ts`（Modified）
- `src/lib/services/tournament-state.ts`（Modified — `isAcceptingProxyEntry`）
- `src/lib/services/tournament-state.test.ts`（Modified）
- `firestore.rules`（Modified — players create: member-proxy 拡張 + name-only ブランチ）
- `scripts/test-rules-clone-players.mjs`（Modified — ケース 3 を allow に更新）
- `package.json`（Modified — `test:rules-proxy-create` script）
- `.claude/rules/firebase-patterns.md` / `.claude/rules/group-membership.md`（Modified — ドキュメント）

## 対応記録（2026-06-06）

レビュー後、MEDIUM 2 件を修正。LOW 2 件のうち L1（テスト網羅）も M1 対応に併せて補完した。L2 は意図的挙動のため対応なし。

### M1 対応 — 受付ガードの共有モジュール化

`receipt.ts` と `proxy-receipt.ts` のロジック複製を解消し、両経路の真実源を集約。

- **新規** [entry-guards.ts](src/lib/services/entry-guards.ts): `assertAcceptingEntries(t)`（受付可能 state 判定）と `parseDisplayName(name, { maxLength? })`（trim + min(1) + 任意 max）を export。`tournament-state.ts` は「state のみ扱う」方針のため、late-entry deadline を絡める本ガードは別モジュールに配置。
- [receipt.ts](src/lib/services/receipt.ts): ローカル private 関数 `assertAcceptingEntries` / `requireDisplayName` を削除し共有 import に置換。`joinAsGuest` は `parseDisplayName(displayName)`（上限なし＝従来挙動）。
- [proxy-receipt.ts](src/lib/services/proxy-receipt.ts): コピー `assertAcceptingProxyEntry` / `parseProxyDisplayName` を削除し、`parseDisplayName(name, { maxLength: DISPLAY_NAME_MAX_LENGTH })` で上限を強制。
- **新規** [entry-guards.test.ts](src/lib/services/entry-guards.test.ts): state 境界・displayName 必須/上限/境界値のパリティテストを追加。`receipt.test`（private 関数を mock せず実装を通過）は無改変で全 pass＝回帰なし。

### M2 対応 — `memberUid` の membership 検証

- [proxy-receipt.ts](src/lib/services/proxy-receipt.ts) の `addMemberPlayerByOrganizer` に `group.memberUids.includes(memberUid)` ガードを追加（取得済み group を再利用・追加 read なし）。非メンバーは `group/not-member`（既存コード）で throw。不参加メンバー / サークル外 uid への誤作成と `finishTournament` でのシーズン戦績誤加算を防止。
- [proxy-receipt.test.ts](src/lib/services/proxy-receipt.test.ts) に非メンバー deny テストを追加。あわせて L1 の name-only 側カバレッジ穴（締切超過・名前長超過）も補完。
- rule 層（`firestore.rules`）は不変更。membership 検証は service 層の防御（rule で `get()` を増やすコストを避け、organizer 信頼境界内のため service で十分と判断）。ドキュメント（[group-membership.md](.claude/rules/group-membership.md) / [firebase-patterns.md](.claude/rules/firebase-patterns.md)）を「service が membership 検証、rule 直叩きのみ残存リスク」と実態に合わせて更新。

### 修正後の検証

| Check      | Result | 備考 |
| ---------- | ------ | ---- |
| Type check | Pass   | `tsc --noEmit` クリーン |
| Lint       | Pass   | ESLint 警告・エラーなし |
| Tests      | Pass   | full suite 1495 件 / 93 files green（receipt 含む回帰なし） |
| Build      | Pass   | `next build` 成功 |
| Rules (emulator) | 未実行 | `npm run test:rules-proxy-create` はコミット前に手動実行を推奨（rule 層は M2 で不変更） |

### 追加・変更ファイル（対応分）

- `src/lib/services/entry-guards.ts`（Added）
- `src/lib/services/entry-guards.test.ts`（Added）
- `src/lib/services/receipt.ts`（Modified — 共有ガードへ移行）
- `src/lib/services/proxy-receipt.ts`（Modified — 共有ガード利用 + membership 検証）
- `src/lib/services/proxy-receipt.test.ts`（Modified — 非メンバー deny + name-only カバレッジ）
