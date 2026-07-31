# Implementation Report: Phase 2 — 受付フロー統合（トーナメント受付によるサークル自動所属）

## Summary

Phase 1 で用意した `joinGroupViaTournament`（rule ブランチ + service）を、受付フロー
[receipt.ts](../../../../src/lib/services/receipt.ts) の 3 経路（Google / 既存ログイン / ログイン済み継続）に接続した。
`joinAsGuest`（匿名）だけは接続せず、rule 側の `isSignedInNotAnon()` と併せた二重防御とした。

- 受付の戻り値を `ReceiptResult`（string union）から `ReceiptOutcome { result, autoJoin }` に additive 拡張
- 共通 helper `receiveEntry`（player 作成 → 自動所属の順序を強制）を新設し、自動所属を best-effort で握る
- 受付完了画面に所属フィードバックを追加（`joined` のみ強調表示 / `failed` は控えめ注記 /
  `already-member` `skipped-anonymous` は無表示）
- `setCurrentGroupId` + `refreshGroups` でサイドバー・`/groups` に即反映
- `GroupProvider` の in-flight ガードを uid 一致から単調増加カウンタに置換し、
  「加入前に始まった load が加入後の load より遅れて着地して新サークルが消える」race を封じた
- `refreshGroups` に SDK `currentUser` フォールバックを追加（Google popup / メールログイン直後の
  `onAuthStateChanged` 遅延で no-op になるのを防ぐ）

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual |
| ------------- | ---------------- | ------ |
| Complexity    | Medium           | Medium（想定どおり） |
| Confidence    | —                | High（deviation は E2E locator の 1 点のみ） |
| Files Changed | 9（新規 3 / 更新 6） | 10（新規 3 / 更新 7）※report を除くと 9 |

## Tasks Completed

| #   | Task | Status | Notes |
| --- | --- | --- | --- |
| 1 | `receipt.ts` に自動所属を接続 | 完了 | 計画どおり。`ReceiptOutcome` / `receiveEntry` を新設 |
| 2 | `join-client.tsx` にフィードバック + group コンテキスト反映 | 完了 | `applyReceiptOutcome` を 5 callsite（4 handler + `onLinked`）に適用 |
| 3 | `current-group.tsx` の `refreshGroups` 堅牢化 | 完了 | `inflightUidRef` → `reqIdRef`（単調増加）／SDK フォールバック |
| 4 | `receipt.test.ts` 更新 | 完了 | 既存 assertion を新シェイプに追従 ＋ 自動所属 9 ケース追加（計 31 tests） |
| 5 | `join-client.test.tsx` 新規作成 | 完了 | Deviated — mock 境界を変更（下記） |
| 6 | `current-group.test.tsx` 新規作成 | 完了 | Deviated — 逆順着地テストの mock 制御方式を変更（下記） |
| 7 | `live-client.test.tsx` の receipt mock 追従 | 完了 | 戻り値を `{ result, autoJoin }` に変更（drift 防止のみ、挙動不変） |
| 8 | E2E spec `auto-group-join.spec.ts` 新規作成 | 完了 | Deviated — `/groups` の locator を `#main` にスコープ（下記） |
| 9 | ドキュメント更新（group-membership.md / PRD） | 完了 | 計画どおり |

## Validation Results

| Level           | Status | Notes |
| --------------- | ------ | ----- |
| Static Analysis | Pass   | `npm run typecheck` 0 error / `npm run lint` 0 warning |
| Unit Tests      | Pass   | `npm run test` → **1612 passed / 103 files**（Phase 1 時点 1595 / 101 から +17 tests / +2 files） |
| Build           | Pass   | `npm run build` 成功（exit 0） |
| Rules 非回帰    | Pass   | `npm run test:rules-limits` 14/14 ／ `npm run test:rules-tournament-join` 16/16 ／ `npm run test:rules-list-scope` 9/9 いずれも ALL GREEN。`git diff --stat firestore.rules` は空（rule 変更ゼロ） |
| E2E（新規 spec） | Pass  | `tests/e2e/auto-group-join.spec.ts` **3/3 pass**（46.7s） |
| E2E（全件）     | Pass   | `npm run test:e2e` → **111 passed / 3 skipped / 0 failed**（10.3m）。skip 3 件は本 Phase と無関係の既存分（`note-screenshots.spec.ts` は `CAPTURE_SCREENSHOTS` 未設定で env gate、`anonymous-self-delete.spec.ts` に `test.fixme` 1 件）。`anonymous-flow-completion` / `organizer-self-join` / `member-role-split` / `proxy-receipt` を含む既存 spec は全て非回帰 |
| Edge Cases      | Pass   | Testing Strategy のチェックリストを unit / E2E で網羅（下記） |

## Files Changed

| File | Action | Lines |
| --- | --- | --- |
| `src/lib/services/receipt.ts` | UPDATED | +125 / -19 相当（型 3 種 + `receiveEntry` 追加、4 関数の戻り値変更） |
| `src/app/join/[tid]/join-client.tsx` | UPDATED | +67 / -13 相当 |
| `src/lib/services/current-group.tsx` | UPDATED | +30 / -12 相当 |
| `src/lib/services/receipt.test.ts` | UPDATED | +230 / -14 相当 |
| `src/app/tournaments/[tid]/live/live-client.test.tsx` | UPDATED | +4 / -2 |
| `src/app/join/[tid]/join-client.test.tsx` | CREATED | +210 |
| `src/lib/services/current-group.test.tsx` | CREATED | +200 |
| `tests/e2e/auto-group-join.spec.ts` | CREATED | +176 |
| `.claude/rules/group-membership.md` | UPDATED | +17 |
| `.claude/PRPs/08-auto-group-join-on-entry/prds/08-auto-group-join-on-entry.prd.md` | UPDATED | Phase 2 進捗更新 |
| `firestore.rules` | **変更なし** | 0（Acceptance Criteria） |

## Deviations from Plan

1. **`join-client.test.tsx` の mock 境界**（Task 5）
   - **WHAT**: 計画の mock 一覧に加えて `@/lib/services/auth-actions` を mock した
     （`AccountLinkRequired` をローカル class で置換）。計画では mock 対象外だった。
   - **WHY**: `join-client.tsx` は `AccountLinkRequired` を import しており、その実体 module が
     `@/lib/firebase/client` → `repositories/users`（module scope で `collection()` を評価）を辿るため、
     suite が collect 時点で落ちた。`@/lib/firebase/client` だけを mock しても repository 側の
     `collection()` が dummy firestore を拒否したため、helper 境界（auth-actions）で割る形に倒した。
     [testing.md](../../../rules/testing.md) の「mock は helper / service の API 境界で割る」に合致。

2. **`current-group.test.tsx` ケース 3 の mock 制御**（Task 6）
   - **WHAT**: `listMyGroups` を `mockResolvedValueOnce` の呼出順ではなく、
     引数（`ids`）の内容で分岐する `mockImplementation` にした。
   - **WHY**: 逆順着地を再現するテストでは `getUserProfile` の resolve 順と `listMyGroups` の
     呼出順が逆転するため、`Once` を並べると 1 本目と 2 本目の返却が入れ替わる。
     「加入前 profile → 0 件 / 加入後 profile → 1 件」を引数で決める方が意図に忠実。

3. **E2E の `/groups` locator スコープ**（Task 8）
   - **WHAT**: `getByText(GROUP_NAME)` を `locator("#main").getByText(GROUP_NAME)` に変更し、
     サイドバー反映は `getByRole("link", { name: GROUP_NAME })` で別途 assert した。
   - **WHY**: 初回実行で strict mode 違反（サイドバーのリンクと一覧カード見出しの 2 要素に一致）。
     計画の GOTCHA が「衝突しないことを確認済み」としていたが実際には衝突した。
     スコープを分けたことで「サイドバーにも即反映される」という UX 要件を明示的に検証できるようになり、
     結果的に検証が 1 段強くなった。

## Issues Encountered

- **firebase client の module-scope 初期化がテスト collect を壊す**（上記 Deviation 1）
  → helper 境界の mock で解決。
- **`act()` 環境警告**: `await screen.findByRole(...)` を `act()` 内で呼ぶと
  「The current testing environment is not configured to support act(...)」が 5 件出力された。
  → button の取得を `act()` の外に出して解消（テスト自体は当初から pass していたが、ノイズを除去）。
- **E2E strict mode 違反 2 件**（上記 Deviation 3）→ locator スコープで解決。

## Tests Written

| Test File | Tests | Coverage |
| --- | --- | --- |
| `src/lib/services/receipt.test.ts` | +9（計 31） | 4 経路の自動所属呼出 / 呼出順序（`upsertPlayer` → `joinGroupViaTournament`）/ 匿名除外 / `already-joined` での実行 / 失敗時 best-effort（warn 1 本）/ `skipped-anonymous`・`already-member` 透過 / displayName 受渡 |
| `src/app/join/[tid]/join-client.test.tsx` | 5 | 完了画面の 5 分岐（joined + 名前解決 / joined + 名前不明 fallback / failed / already-member / autoJoin=null）と `setCurrentGroupId` / `refreshGroups` の呼出有無 |
| `src/lib/services/current-group.test.tsx` | 3 | 通常ロード / SDK `currentUser` フォールバック / 同一 uid の逆順着地で後発 load が残る |
| `tests/e2e/auto-group-join.spec.ts` | 3 | 「このアカウントで受付」→ メンバー化 + サイドバー / 一覧 / 詳細到達 + owner 側メンバー一覧出現 ／ 未サインイン端末の「ログインして受付」→ メンバー化 ／ 匿名ゲスト受付でメンバーが増えない |

### Edge Cases Checklist（Testing Strategy）

- [x] 空入力（displayName 空でのゲスト受付）— 既存 `validation/display-name-required` が非回帰
- [x] 15 字超の displayName — 受け渡しのみ検証（切り詰めは Phase 1 の service 責務・既存 test で担保）
- [x] 既メンバーの再受付 — 所属メッセージを出さない（unit）
- [x] `already-joined` の再受付 — 自動所属は実行される（unit）
- [x] 匿名ゲスト — 自動所属を一切呼ばない（unit の未呼出 assert ＋ E2E のメンバー数不変）
- [x] 自動所属失敗（permission-denied / network）— 受付は成功のまま（unit）
- [x] 同時実行 / 多端末 — Phase 1 の再 probe で `already-member`（本 Phase で不変）
- [x] group 名が取得できない — 汎用文言に fallback（unit）
- [x] サインアウト直後の in-flight load — `reqIdRef` のガードで groups を復活させない

## Next Steps

- [x] **本番 rules の deploy** — ユーザーが `firebase deploy --only firestore:rules` を実行済み。
      Phase 1 で追加した `groups/{gid}` self-add ブランチと `tournaments` / collectionGroup `players` の
      list scope 絞り込みが本番に反映されている（本 Phase は rule 変更ゼロのため追加 deploy は不要）。
- [ ] **deploy 後の目視確認**（`tournaments` の list 挙動変更に伴う）— 絞り込みなしクエリが
      deploy 後は deny されるため、`/tournaments` 一覧・サイドバーの参加中トーナメント・
      サークル切替後の一覧が本番で正常表示されることを確認する。
- [ ] Manual Validation（実機）: `/join/[tid]` を未所属の通常アカウントで開いて所属メッセージ確認、
      サイドバー / `/groups` 反映、ゲスト受付でメッセージが出ないこと、再受付が壊れないこと
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
- [ ] Phase 3（受付画面の新規登録タブ）— **必ず `receiveEntry` を経由**させること
      （`ensurePlayerCreated` 直接呼出は自動所属を素通しする。`group-membership.md` に DRIFT WARNING 記載済み）
