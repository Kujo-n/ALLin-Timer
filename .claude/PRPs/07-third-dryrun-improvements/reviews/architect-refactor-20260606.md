# Architect Refactor 監査 — 20260606

## 所属

- PRD: `07-third-dryrun-improvements`（受付代理 Phase 1 データ層〜Phase 2 UI の安定後リファクタ）
- 作業ブランチ: `feat/phase-1-proxy-receipt-data-layer`（現ブランチ上で続行）
- スコープ: 受付代理（proxy-receipt）＋直近変更領域中心（`main..HEAD` の 07 work-stream）

## レンズ

- Lens A: Senior Web Architect（SoC / DRY / KISS / YAGNI / a11y / perf / testability）
- Lens B: Security Specialist（zero-trust / least-privilege / defense-in-depth / OWASP）

## Baseline（Phase 1 確認済み）

| チェック | 結果 |
| --- | --- |
| typecheck | ✓ green |
| lint | ✓ No ESLint warnings or errors |
| unit (vitest) | ✓ 95 files / 1517 tests |
| build | ✓ 成功 |
| E2E（scope: proxy-receipt / clone-tournament-with-players / playing-dealer） | ✓ 6 passed |

## 監査対象ファイル（`main..HEAD` の src 変更 + 直接依存）

- `src/lib/services/proxy-receipt.ts`（受付代理 service の核）
- `src/lib/services/entry-guards.ts`（共有ガード）
- `src/lib/services/receipt.ts`（通常受付・entry-guards 共有側）
- `src/lib/services/tournament-state.ts`（`isAcceptingProxyEntry`）
- `src/lib/firebase/repositories/players.ts`（`createNamedOnlyPlayer` / `updatePlayerDisplayName` / `upsertPlayer` / `clonePlayersFromTournament`）
- `src/components/tournament/AddParticipantDialog.tsx`
- `src/components/tournament/PlayerList.tsx`
- `src/app/tournaments/[tid]/dashboard-client.tsx`（受付代理 UI 配線）
- `firestore.rules`（players `allow create` 3 ブランチ）

---

## 所見リスト

### finding-1: players.ts の fresh-player doc literal が 3 重複
- Lens: architect
- Severity: medium
- 場所: `src/lib/firebase/repositories/players.ts:106-116`（upsertPlayer create 分岐）/ `:145-155`（createNamedOnlyPlayer）/ `:353-363`（clonePlayersFromTournament）
- 観察事実: 新規 player doc を書く 3 経路が、同一の 9 フィールド object literal（`displayName` / `uid` / `entryAt: serverTimestamp()` / `isBusted:false` / `bustedAt:null` / `tableNum:null` / `seatNum:null` / `lastMovedAt:null` / `isPlayingDealer:false`）を個別に複製している。差分は `uid`（`uid` / `null` / `body.uid`）と `displayName` のみ。
- 影響: `firebase-patterns.md` の DRIFT WARNING「players schema に新フィールドを追加する場合は self-create / member-proxy / name-only の **3 ブランチすべて** に同じ invariant を反映」と直結する。3 箇所のうち 1 つでも更新を漏らすと、経路ごとに doc 形が drift し、rule の deny（型不一致）や schema validate 失敗を引き起こす。
- 案: `players.ts` 内に `newPlayerBody({ displayName, uid })` の factory pure 関数を追加し、3 経路を経由させる。`entryAt`/席フィールド/`isBusted`/`isPlayingDealer` の初期値を単一真実源化。`serverTimestamp()` は factory 内で 1 回呼ぶ（書込ごとに同形）。
- テスト保護: `players.test.ts` が各関数（upsertPlayer create / createNamedOnlyPlayer / clonePlayersFromTournament）の `setDoc` 引数形を assert。factory 化後も同 assert が通れば観測同値。
- リスク: 観測可能な動作変更なし（内部抽出のみ）。`serverTimestamp()` の呼出回数は変わらない（各書込で 1 回）。

### finding-2: proxy-receipt.ts が「organizer 再認可」preamble を 3 重複
- Lens: both（architect + security）
- Severity: medium
- 場所: `src/lib/services/proxy-receipt.ts:57-59` / `:92-94` / `:133-135`
- 観察事実: 3 つの export 関数すべてが `const t = await getTournament(tid); const group = await getGroup(t.groupId); assertOrganizer(group, organizerUid);` を逐語複製している。これは「UI から渡された gid を信頼せず、tournament 自身の groupId 経由で organizer を再評価する」というゼロトラスト由来のセキュリティ不変条件（doc comment にも明記）。
- 影響: セキュリティ上重要な「再認可の起点を tournament.groupId に固定する」ロジックが 3 箇所に散る。将来 1 箇所だけ別 gid 源（例: 引数の gid）に書き換える誤りが入ると、他経路と非対称な認可になり検知しづらい。DRY 違反であると同時に、防御不変条件の単一真実源化が望ましい。
- 案: `proxy-receipt.ts` 内（または近接 service）に `resolveOrganizerContext(tid, organizerUid): Promise<{ tournament: TournamentDoc; group: GroupDoc }>` を追加。tournament read → group read → `assertOrganizer` を 1 関数に集約し、3 経路から呼ぶ。`updatePlayerDisplayNameByOrganizer` は `assertAcceptingEntries` を呼ばない差異があるが、この差異は preamble の外（context 解決後）にあるため集約に影響しない。
- テスト保護: `proxy-receipt.test.ts` が各経路の organizer 検証失敗（非 organizer で throw）と read 順序を assert。境界（service API）での assert が維持されれば内部集約は透過。
- リスク: 観測可能な動作変更なし。read 回数（getTournament 1 + getGroup 1）も不変。

### finding-3: PlayerList.tsx の肥大化（327 行 / 8 useState / inline 3 ダイアログ）
- Lens: architect
- Severity: medium
- 場所: `src/components/tournament/PlayerList.tsx:57-327`
- 観察事実: 単一 client component が「参加者行 render（PD checkbox / bust / 編集 / 取消）」「取消確認ダイアログ」「表示名編集ダイアログ」「受付代理ダイアログの wrapper」を 1 ファイルに同居させ、`useState` を 8 個持つ。`refactor-conventions.md` の分割閾値（300 行超 または useState 5 個以上）を超過。
- 影響: 受付代理 UI（編集ダイアログ）の追加で責務が増え、行・状態が増加した。編集ダイアログ周りの state（`editTarget` / `editName` / `editError` / `editSaving`）は他 UI と独立しており、抽出することで PlayerList 本体の見通しと再 render 範囲が改善する。
- 案: 表示名編集ダイアログを `src/components/tournament/EditPlayerNameDialog.tsx`（domain co-location）へ抽出し、4 state とハンドラを内包。PlayerList は `editTarget` の open/close と「どの player を編集対象にするか」だけを持つ薄い props 受け渡しにする。
- テスト保護: `PlayerList.test.tsx`（編集導線の存在・aria-label）＋ `proxy-receipt.spec.ts` E2E（「organizer が名前のみ参加者を代理受付し、表示名を編集できる」）。抽出後も同テストが通れば観測同値。
- リスク: props 受け渡しの結線ミスで編集導線が動かなくなる可能性 → unit + E2E で担保。観測可能な動作変更は 0 を維持。

### finding-4: tournament-state.ts のコメントが存在しない関数名を参照
- Lens: architect（documentation）
- Severity: low
- 場所: `src/lib/services/tournament-state.ts:205`
- 観察事実: `isAcceptingProxyEntry` の doc comment 末尾が「late entry deadline 超過の扱いは service 側（proxy-receipt の `assertAcceptingProxyEntry`）」と記すが、実際の guard は `entry-guards.ts` の `assertAcceptingEntries` であり `assertAcceptingProxyEntry` は存在しない。
- 影響: コメントの誤誘導。将来の保守者が存在しない関数を探す。動作影響なし。
- 案: コメントを `entry-guards.ts` の `assertAcceptingEntries` 参照に修正（1 行）。
- テスト保護: コメントのみのため不要（typecheck / lint が green であれば回帰なし）。
- リスク: なし。

### finding-5: firestore.rules の member-proxy / name-only ブランチが 6 invariant 行を重複（defer 推奨）
- Lens: security
- Severity: low
- 場所: `firestore.rules:567-588`（players `allow create` の 2・3 番目ブランチ）
- 観察事実: member-proxy と name-only ブランチが `exists()` / `isOrganizer(...)` / `state in [...]` / `isBusted==false` / `tableNum==null` / `seatNum==null` / `isPlayingDealer==false` の計 6〜7 行を共有し、discriminator（`pid==uid && uid is string` ↔ `uid == null`）だけが異なる。
- 影響: schema にフィールド追加時、両ブランチ（+ self ブランチ）に invariant を反映する必要があり、Cloud Rules に function 抽出はあるものの現状は inline で drift しやすい。
- 案: `firestore.rules` に `function isProxyCreatableState(tid)` 等の rule function を切る選択肢はあるが、**本サイクルでは defer**。rule 変更は emulator validation（`test-rules-proxy-create.mjs`）の再走行コストとリスクが高く、6 行重複の費用対効果が低い。記録に留め、次に players rule を触る機会に合わせて再評価する。
- テスト保護: `scripts/test-rules-proxy-create.mjs`（`npm run test:rules-proxy-create`）。
- リスク: rule refactor は OR 評価の落とし穴（過去 Phase 5.4 の wildcard bug 先例）があり、本サイクルのスコープ外。

---

## Severity サマリ

| finding | Lens | Severity | 本サイクル対応 |
| --- | --- | --- | --- |
| finding-1: fresh-player literal 3 重複 | architect | medium | 対応推奨 |
| finding-2: organizer 再認可 preamble 3 重複 | both | medium | 対応推奨 |
| finding-3: PlayerList 肥大化 | architect | medium | 対応推奨（要ユーザー判断） |
| finding-4: stale コメント | architect | low | 対応推奨（ついで） |
| finding-5: rule ブランチ重複 | security | low | defer（記録のみ） |

critical / high はなし（受付代理は Phase 1〜2 で rule + service の二重防御・emulator validation 済みのため、構造的負債は medium 以下）。
