# Implementation Report: Phase 1 — 自動所属 データ層

## Summary

トーナメント受付（`tournaments/{tid}/players/{uid}` の存在）を **サークル加入の消費証明**として使う基盤を、Firestore Security Rules・zod schema・repository・service の 4 層で確立した。

- `firestore.rules` に `hasTournamentEntryProof(gid, tid)` helper と、`groups/{gid}` `allow update` の **第 2 self-add ブランチ**を additive 追加
- `groups/{gid}` schema に `joinedViaTournamentId`（nullable / default null）を additive 追加
- `addSelfViaTournamentEntry`（repository）／ `joinGroupViaTournament`（service）を新設
- 専用 emulator validator（16 ケース）と unit test（11 ケース）を投入

UI 接続（受付フローへの結線）は Phase 2 の担当で、本 Phase では `joinGroupViaTournament` を export するのみ（呼出側は作っていない）。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual |
| ------------- | ---------------- | ------ |
| Complexity    | Medium           | Medium（想定どおり。rule ブランチのミラーが機械的に済んだ） |
| Confidence    | —（plan に記載なし） | High（emulator validator 16/16 が初回で green） |
| Files Changed | 15（新規 3 / 更新 12） | 17（新規 3 / 更新 14）— PRD 進捗表 1 件と error-logging.md 1 件が plan の一覧に含まれていなかった |

## Tasks Completed

| # | Task | Status | Notes |
| --- | --- | --- | --- |
| 1 | `firestore.rules` に `hasTournamentEntryProof` helper | 完了 | `hasValidJoinCodeConsumption` の直後に配置。`exists()` → `get()` の順序を厳守 |
| 2 | `firestore.rules` に第 2 self-add ブランチ | 完了 | 招待コードブランチとの機械 diff で不変条件 15 行が 1:1 であることを確認 |
| 3 | `schemas/group.ts` に `joinedViaTournamentId` | 完了 | `.nullable().default(null)`（最新形） |
| 4 | `repositories/groups.ts` に `addSelfViaTournamentEntry` | 完了 | `arrayUnion` import 追加 ＋ `createGroup` seed にも `joinedViaTournamentId: null` |
| 5 | `services/auto-group-join.ts` を新規作成 | 完了 | plan のコードをそのまま実装 |
| 6 | `services/auto-group-join.test.ts` を新規作成 | 完了 | plan の 9 ケース想定に対し **11 ケース**（displayName フォールバックを auth / profile / uid の 3 段に分割し、空文字を 3 引数分まとめて 1 ケース化） |
| 7 | `package.json` に `test:rules-tournament-join` | 完了 | `test:rules-season` の直前に挿入 |
| 8 | `scripts/test-rules-tournament-join.mjs` を新規作成 | 完了 | 16 ケース。deny 12 → allow 4 の順に実行（allow が `memberUids` を伸ばすため） |
| 9 | `scripts/test-rules-limits.mjs` の drift check | 完了 | `minOccurrences` 2 → 3。ヘッダーの「3 経路」も「4 経路」に更新 |
| 10 | ドキュメント（rules ファイル）3 件 | 完了 | 詳細は Deviations 参照 |
| 11 | `isAcceptingProxyEntry` の DRIFT WARNING | 完了 | コメントのみ変更（実装は無変更） |
| 12 | 既存 fixture 6 箇所に `joinedViaTournamentId: null` | 完了 | `npm run typecheck` で漏れゼロを機械確認 |

## Validation Results

| Level | Status | Notes |
| --- | --- | --- |
| Static Analysis | Pass | `npm run typecheck` 0 errors ／ `npm run lint` 0 warnings |
| Unit Tests | Pass | 全 101 files / **1584 tests** green（新規 11 tests 含む） |
| Build | Pass | `npm run build` 成功 |
| Rules Drift Check | Pass | `npm run test:rules-limits` → 14/14 `ALL GREEN`（memberDisplayNames が `15 × 3` で検出） |
| Rules Emulator（新規） | Pass | `npm run test:rules-tournament-join` → **16/16 `ALL GREEN`** |
| Rules Emulator（非回帰） | Pass | 既存 11 validator すべて `ALL GREEN`（下表） |
| Edge Cases | Pass | plan の Edge Cases Checklist 8 項目を unit test / validator で網羅 |

### Emulator validator 非回帰の内訳

| Validator | 結果 |
| --- | --- |
| `test:rules-proxy-create` | 11/11 ALL GREEN |
| `test:rules-clone-players` | 7/7 ALL GREEN |
| `test:rules-latest-join-code` | 9/9 ALL GREEN |
| `test:rules-season` | 12/12 ALL GREEN |
| `test:rules-season-points-rule` | 11/11 ALL GREEN |
| `test:rules-spectate` | 19/19 ALL GREEN |
| `test:rules-table-labels` | 16/16 ALL GREEN |
| `test:rules-card-background` | 11/11 ALL GREEN |
| `test-rules-finished-count.mjs`（npm script なし） | 8/8 ALL GREEN — self-* 分岐の `affectedKeys` 回帰なし |
| `test-rules-default-seats.mjs`（同上） | 9/9 ALL GREEN |
| `test-rules-pd.mjs`（同上） | 8/8 ALL GREEN |

### 新規 validator のケース内訳（16/16 PASS）

deny 12 件を先に、allow 4 件を後に実行する（allow が `memberUids` を伸ばすため）。

| # | ケース | 期待 | 結果 |
| --- | --- | --- | --- |
| 4 | 匿名アカウント（player doc あり）が加入 | deny | PASS (403) |
| 5 | player doc を持たないユーザーが加入 | deny | PASS (403) |
| 6 | 別サークルの tid を proof に使う | deny | PASS (403) |
| 7 | 存在しない tid を proof に使う | deny | PASS (403) |
| 8 | finished tournament の tid を proof に使う（player doc あり） | deny | PASS (403) |
| 9 | 加入と同時に `organizerUids` へ自分を追加 | deny | PASS (403) |
| 10 | 加入と同時に `name` を書換 | deny | PASS (403) |
| 11 | 加入と同時に `finishedTournamentCount` を書換 | deny | PASS (403) |
| 12 | `memberDisplayNames` に 16 字を書く | deny | PASS (403) |
| 13 | `memberDisplayNames` に他人のキーを書く | deny | PASS (403) |
| 14 | 既メンバーが同じ書込を行う | deny | PASS (403) |
| 15 | `joinedViaTournamentId` 抜きで memberUids だけ +1 | deny | PASS (403) |
| 1 | 通常アカウント（player doc あり・running）が加入 | allow | PASS |
| 2 | 別の通常アカウントが同 tid で加入 | allow | PASS |
| 3 | setup state の tournament 経由で加入 | allow | PASS |
| 16 | 非回帰: 既メンバーの self-key displayName 更新 | allow | PASS |

### Manual Validation

- [x] `firestore.rules` に `match /{...=**}` パターンが**追加されていない**（既存の `match /{path=**}/players/{pid}`（collectionGroup 用・Phase 5.1）のみで、本 Phase では未変更）
- [x] 新ブランチの不変条件が既存 self-add（招待コード）と 1:1 対応 — 両ブランチを機械 diff し、差分が **4 点のみ**（`isSignedIn()`→`isSignedInNotAnon()` / `joinCodeId`→`joinedViaTournamentId` × 2 / proof helper 名）であることを確認
- [x] `.claude/rules/*.md` のリンク先パスが実在
- [x] `git diff` に `.env` / `apiKey` / `token` / `secret` の混入なし

## Files Changed

| File | Action | Lines |
| --- | --- | --- |
| `firestore.rules` | UPDATED | +65 / -2 |
| `src/lib/firebase/schemas/group.ts` | UPDATED | +8 |
| `src/lib/firebase/repositories/groups.ts` | UPDATED | +48 |
| `src/lib/services/auto-group-join.ts` | CREATED | +166 |
| `src/lib/services/auto-group-join.test.ts` | CREATED | +263 |
| `scripts/test-rules-tournament-join.mjs` | CREATED | +438 |
| `package.json` | UPDATED | +1 |
| `scripts/test-rules-limits.mjs` | UPDATED | +8 / -5 |
| `src/lib/services/tournament-state.ts` | UPDATED | +7 / -5 |
| `.claude/rules/group-membership.md` | UPDATED | +41 / -1 |
| `.claude/rules/firebase-patterns.md` | UPDATED | +4 / -1 |
| `.claude/rules/error-logging.md` | UPDATED | +1 / -1 |
| `src/lib/services/group.test.ts` | UPDATED | +1 |
| `src/lib/firebase/schemas/index.test.ts` | UPDATED | +2 |
| `src/lib/hooks/useAudioPlayer.test.tsx` | UPDATED | +1 |
| `src/lib/services/account-delete.test.ts` | UPDATED | +1 |
| `src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.test.tsx` | UPDATED | +1 |
| `.claude/PRPs/08-auto-group-join-on-entry/prds/08-auto-group-join-on-entry.prd.md` | UPDATED | Phase 1 を `complete` に |

## Deviations from Plan

1. **`firebase-patterns.md` の allowed-keys 表に既存 2 行を補完**（WHAT: `winnerCardBackground update` / `seasonCardBackground update`（ともに Phase A.1・owner 限定）の行を追加。WHY: plan は「ブランチ数の記述を実数に合わせて更新する」と指示していたが、実数は 14 で表は 12 行しかなく、数と表が矛盾する状態になるため。表は「新規フィールド追加時の見落とし防止のための単一参照点」という設計意図なので、欠落を残すと本 Phase の追記自体の信頼性が落ちる）。

2. **unit test を 9 → 11 ケースに増やした**（WHAT: displayName フォールバックを「auth.displayName」「users/{uid}.displayName」「uid」の 3 ケースに分割し、空文字引数を `tid` / `gid` / `uid` の 3 パターンまとめて 1 ケースに集約。WHY: plan の Testing Strategy 表が 10 行あり、Task 6 のコメント欄の 9 ケースと不一致だった。Testing Strategy 表を正として実装した）。

3. **`test-rules-tournament-join.mjs` の finished tournament seed を「running で受付 → owner が finished へ遷移」の 2 段階にした**（WHAT: plan は tournament を直接 `finished` で seed する構成。WHY: `players` の self-create ブランチには state 条件がないため直接 seed でも動くが、将来 self-create に state ガードが入ると seed が silent に壊れる。実運用順序で seed することで validator の耐久性を上げた）。

4. **`error-logging.md` が plan の「Files to Change」表に載っていなかった**（WHAT: Task 10 (c) では更新対象として指示されているが、上部の Files to Change 表からは漏れていた。WHY: Task 10 の指示に従って更新済み。表の漏れなので実装上の判断は不要）。

## Issues Encountered

なし。emulator validator は初回実行で 16/16 green、既存 validator も全件非回帰だった。

（実装中の一時的なトラブル: fixture 一括置換に `perl -0pi` を使ったところ、Windows の CRLF 改行により正規表現がマッチせず no-op になった。ファイル破損はなく、Edit ツールで個別に置換して解決。）

## Tests Written

| Test File | Tests | Coverage |
| --- | --- | --- |
| `src/lib/services/auto-group-join.test.ts` | 11 tests | `joinGroupViaTournament` の全分岐（既メンバー no-op / 初回加入 / displayName 解決 4 段 + 15 字切り詰め / 匿名 skip / 同時 self-add race / 恒久失敗 / groupIds 補修失敗の best-effort / 空文字引数） |
| `scripts/test-rules-tournament-join.mjs` | 16 cases | rule 新ブランチの allow 3 / deny 12 / 既存ブランチ非回帰 1 |

## レビュー後の追補（2026-07-31 / `/code-review`）

ローカルレビュー [local-phase-1-auto-join-review.md](../reviews/local-phase-1-auto-join-review.md) の
指摘に対応し、以下を本 Phase の成果物に追加した。

### C-1（CRITICAL）: tid 列挙による任意サークルへの自己加入 — 案 (b) で対応

新 self-add ブランチは「tid を知っている = 受付 QR を提示された人」を前提にしていたが、
`tournaments` の `allow list: if isSignedIn()` と collectionGroup `players` の wildcard read が
**絞り込みなしの全件列挙**を許していたため、前提が成立していなかった
（全 tid 取得 → player 自作 → 任意サークルへ加入の 3 手が成立）。

| 変更 | before | after |
| --- | --- | --- |
| `match /tournaments/{tid}` | `allow list: if isSignedIn()` | `allow list: if isGroupMember(resource.data.groupId)` |
| `match /{path=**}/players/{pid}` | `allow read: if isSignedIn()` | `allow read: if isSignedIn() && resource.data.uid == request.auth.uid` |

- アプリ側の改修は**ゼロ**（既存クエリは全て `where` で絞られている）
- コストは 1 クエリあたり +1〜2 read（**返却件数に比例しない**。list rule はクエリの制約から導いた
  `resource` に対してクエリ 1 回につき 1 度だけ評価される）。実運用で月 +3,000 read 程度
- 新規 validator [scripts/test-rules-list-scope.mjs](../../../../scripts/test-rules-list-scope.mjs)
  （`npm run test:rules-list-scope`）を追加 — **9/9 ALL GREEN**
- [test-rules-spectate.mjs](../../../../scripts/test-rules-spectate.mjs) のケース 16 / 18 は
  意図的に allow → deny へ反転（旧仕様がまさに塞いだ穴）
- 規約反映: [firebase-patterns.md](../../../rules/firebase-patterns.md) に「list scope の絞り込み」節を新設

### M-1 / M-2（MEDIUM）

- **M-1**: `addSelfViaTournamentEntry` の repository unit test を 6 ケース追加
  （payload 3 キーちょうどを `toEqual` で固定 / trim / 空文字 / 16 字 deny / 15 字境界 / wrap）
- **M-2**: `getGroupIfMember` を追加し `probeMembership` を切替。
  **非メンバー（正常系）で warn ログが出なくなった**。repository test 4 ケース + service test 1 ケース追加

### 追補後の検証

| Check | Result |
| --- | --- |
| typecheck / lint / build | Pass |
| unit test | **1595 passed**（101 files。1584 → +11） |
| Rules emulator | 新規 list-scope 9/9 + 既存 13 validator すべて ALL GREEN |

## Next Steps

- [x] **`firebase deploy --only firestore:rules` の実行** — ユーザーが実行済み（Phase 2 実装完了時点で確認）。self-add ブランチ追加に加えて **`tournaments` の list 挙動が変わる**（絞り込みなしのクエリは deploy 後 deny）ため、本番での一覧表示の目視確認は Phase 2 レポートの Next Steps に引き継いだ
- [x] `/code-review` でレビュー（[local-phase-1-auto-join-review.md](../reviews/local-phase-1-auto-join-review.md)）
- [ ] `/prp-commit` でコミット（実装とテストは同一 commit にペアで入れる）
- [ ] `/prp-plan` で Phase 2（受付フロー統合）へ

### Phase 2 への申し送り（plan より再掲）

- 呼出順序は **`ensurePlayerCreated`（player doc 作成）→ `joinGroupViaTournament`** を厳守する。逆順・並列は rule で必ず deny される
- 呼出は `joinViaGoogle` / `joinAsExistingUser` / `joinAsCurrentUser` の 3 経路のみ。**`joinAsGuest` には接続しない**（匿名除外）
- best-effort 化は Phase 2 の callsite の責務。`try { ... } catch (e) { logger.warn(..., { errorCode: getErrorCode(e) }) }` で握り、受付結果はそのまま返す
- 戻り値 `AutoJoinOutcome`（`joined` / `already-member` / `skipped-anonymous`）が受付完了画面のフィードバック文言の分岐に使える
- `already-joined` の再受付でも呼ぶ（PRD の Q1(b)）— 本 service は既メンバーなら no-op で安全
