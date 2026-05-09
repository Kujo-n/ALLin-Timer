# Architect Refactor Review — 04-spectate-mode 周辺＋全体横断（2026-05-10）

## メタ情報

- 起動: `/architect-refactor`（明示呼び出し）
- ベース branch: `develop`（last commit `575805e`）
- 作業 branch: `refactor/spectate-and-global-20260510`
- スコープ: 04-spectate-mode 周辺 + 全体横断（user 選択）
- 動作変更ポリシー: セキュリティ / バグ修正は許容（それ以外 0）
- ベースライン状態: typecheck / lint / unit (1267 tests) / build = green、E2E は監査と並行確認中

## レンズ A: Senior Web Architect

### finding-1: tournament.state 直接比較が service / component 全層に残存（refactor-conventions 違反）

- **Lens**: architect
- **Severity**: high
- **場所**:
  - `src/lib/services/timer.ts:44, 47, 52, 59, 83-84, 159-161, 195`（service layer / 純関数）
  - `src/lib/services/receipt.ts:20, 26-27`（service layer / 純関数）
  - `src/app/tournaments/[tid]/live/live-client.tsx:266-269, 335`
  - `src/app/tournaments/[tid]/dashboard-client.tsx:108, 370, 557`
  - `src/components/tournament/TimerDisplay.tsx:29-37`（3-way 三項演算子）
  - `src/components/tournament/TimerControls.tsx:134, 148, 162`
  - `src/app/spectate/[tid]/spectate-client.tsx:200, 210`（SpectateLateEntryBanner）
- **観察事実**: `src/lib/services/tournament-state.ts` に `isSetup` / `isSeating` / `isRunning` / `isPaused` / `isFinished` / `isInProgress` / `isBeforeStart` の純関数 helper が揃っているが、合計 25+ 箇所で `tournament.state === "..."` の直接比較が残っている。`refactor-conventions.md` で「直接比較は禁止（refactor で集約する）」と明示されている集約先がスキップされた状態。
- **影響**: 新 state 追加 / 名称変更時の修正範囲が分散。同 file 内で helper 経由 vs 直接比較の混在もあり可読性が低い（dashboard-client.tsx:108 vs 162 は同 file 内で混在）。
- **案**:
  1. service layer（timer.ts / receipt.ts）から先に置換 → 純関数なのでテスト破壊リスク最小
  2. component layer（TimerControls / TimerDisplay / live-client / dashboard-client）は characterization test を確認しながら順次
  3. spectate-client.tsx 内 `SpectateLateEntryBanner` は同時に対応
- **既存テスト**: `src/lib/services/tournament-state.test.ts` に 80+ 件の述語テスト。`timer.ts` / `receipt.ts` には個別 unit test あり。
- **動作変更**: 0（純粋な内部リファクタ。helper の戻り値は `state ===` と同値）

### finding-2: spectate-client の subscribe onError ハンドラ 3 重複

- **Lens**: architect
- **Severity**: medium
- **場所**: `src/app/spectate/[tid]/spectate-client.tsx:50-104`
- **観察事実**: useTournamentTimer / subscribePlayers / subscribeTables の 3 つの useEffect で、ほぼ同一の「`getErrorCode(err.cause) === "permission-denied"` を検出 → `logger.warn(...)` → `setSpectateEnded(true)`」パターンが 3 度繰り返される。
- **影響**: spectate 終了の検出ロジックが分散。permission-denied 以外の code を後で扱う場合に 3 箇所更新が必要。
- **案**:
  1. local helper 関数 `function handleSpectateSubscribeError(err, scope, tid, setSpectateEnded)` を file 内に抽出（小さい手当て）
  2. または `useSpectateSubscriptions(tid)` hook で全 subscribe を集約し `{ tournament, players, tables, spectateEnded }` を返す（大きい手当て）
- **既存テスト**: `spectate-client.test.tsx` に 3 つの permission-denied 経路テスト
- **動作変更**: 0

### finding-3: `assertOrganizer` が file-private で重複実装される

- **Lens**: architect
- **Severity**: medium
- **場所**:
  - 定義: `src/lib/services/group.ts:214-218`（file-private）
  - 重複: `src/lib/services/tournament.ts:40-42`（コメントに「局所コピー」と明記）
- **観察事実**: `setSpectateEnabled` が `assertOrganizer` を import できないため、同じ判定式 `!group.organizerUids.includes(uid) → throw "group/not-organizer"` を局所コピー。group.ts の `assertOwner`（同様に file-private）も将来の callsite から同じ問題を引き起こす可能性。
- **影響**: 役割判定の真実源が 2 つ。3 階層ロール（owner / organizer / member）の更新時に整合性 drift。
- **案**:
  1. `assertOrganizer` / `assertOwner` を `services/group.ts` から `export` する（最小手当て）
  2. もしくは `schemas/group.ts` の `deriveRole` / `isOrganizerRole` 系と統合し、`assertRole(group, uid, "organizer")` 形にしてさらに集約（大きい手当て）
- **既存テスト**: `services/group.test.ts` に各 assert パスのテスト（`assertOrganizer` 単独テストはないが、callsite 経由でカバー）
- **動作変更**: 0

### finding-4: spectate page-specific sub-component の co-location 不在

- **Lens**: architect
- **Severity**: low
- **場所**: `src/app/spectate/[tid]/spectate-client.tsx:183-244`（`SpectateLateEntryBanner` ~62 行）
- **観察事実**: `refactor-conventions.md` で page-specific sub-component は同階層 `_components/` に置く規約。`src/app/groups/[gid]/_components/` / `src/app/tournaments/[tid]/clone/_components/` 等で確立済み。spectate ディレクトリでは未採用。
- **影響**: spectate-client.tsx が 244 行（300 行未満なので閾値内だが）、内部関数の発見性が低い。今後 spectate 用 sub-component が増えた場合に方向性が決まっていない。
- **案**: `src/app/spectate/[tid]/_components/SpectateLateEntryBanner.tsx` に切り出し
- **既存テスト**: `SpectateLateEntryBanner` 単体のテストは無い（spectate-client.test.tsx で間接カバー）
- **動作変更**: 0（コード移動のみ）

### finding-5: subscribe onError handler の `${err.code}: ${err.message}` 構築が複数箇所で手書き

- **Lens**: architect
- **Severity**: low
- **場所**:
  - `dashboard-client.tsx:120, 194, 217, 246` 等 setError 呼出
  - `spectate-client.tsx:90` onError 呼出
  - `BustButton.tsx:53` / `SpectateModeCard.tsx:90` onError 呼出
  - `live-client.tsx:285` setJoinError 呼出
- **観察事実**: 全 callsite で「`unwrapOrFrom` または `AppError.from` で wrap → `${wrapped.code}: ${wrapped.message}` で文字列化 → setError」の同パターン。10+ 箇所で書かれている。
- **影響**: 表示文言フォーマットの将来統一が困難。例えば「code を非表示にして message のみ表示」したくなった時に 10+ 箇所修正必要。
- **案**: `src/lib/errors.ts` に `formatErrorForDisplay(err: unknown, fallbackCode, fallbackMsg): string` を追加。または `useErrorState()` hook で `setError(err)` を受け取り内部で string 化。
- **既存テスト**: 個別 component の test で文字列パターンは検証されている（regex でマッチ）
- **動作変更**: 0（出力 string が同一）

## レンズ B: Security Specialist

### finding-6: rule の tournaments allow update 右側 OR 分岐は dead branch

- **Lens**: security
- **Severity**: low
- **場所**: `firestore.rules:429-435`
- **観察事実**:
  ```
  allow update: if isOrganizer(resource.data.groupId)
                || (
                  isOrganizer(resource.data.groupId)
                  && request.resource.data.diff(resource.data).affectedKeys()
                       .hasOnly(['spectateEnabled', 'updatedAt'])
                  && request.resource.data.spectateEnabled is bool
                );
  ```
  右側 `(isOrganizer && hasOnly && is bool)` は左側 `isOrganizer` の strict subset。右側が true となる入力は左側でも必ず true なので、右側は permissions を全く追加しない。コメントは「将来 organizer 経路を狭める足場」「emulator validator で独立確認」と説明するが、現状の OR では emulator も両分岐を区別できない（左側が常に短絡的に通すため）。
- **影響**: 「intent と実装の乖離」。security 観点では何も悪化しない（緩和もしない）が、rule ファイルの誤読を招く。将来 `affectedKeys` の制約を狭める refactor 時に「なぜここに書かれているのか」を追跡しづらい。
- **案**:
  1. 右側 OR 分岐を削除（最小手当て）+ コメントを「Phase 1 (04-spectate-mode) で経路 B を試作したが redundant のため経路 A に統合」に変更
  2. もしくは経路 A の `isOrganizer` を `isOrganizer && other-than-spectateEnabled` 系に狭め、経路 B が真に独立した narrow update path として機能する形に書き換える（spectate toggle を将来 member に開放するための前提整備）
- **既存テスト**: `scripts/test-rules-spectate.mjs` で organizer 書込 / member deny / 非 bool deny / unauthenticated deny を検証
- **動作変更**: 0（rule の挙動は完全に同じ）

### finding-7: `setSpectateEnabled` の Input validation の型穴

- **Lens**: security
- **Severity**: low
- **場所**: `src/lib/services/tournament.ts:31-36`
- **観察事実**: TypeScript 型では `value: boolean` だが、runtime で `typeof value !== "boolean"` を再チェック。`updateSpectateEnabled` repository 側でも同じ check が入っており、二重防御。ただし `tid` / `uid` は string check が無く（型のみ）、`tid: ""` / `tid: " "` も `getTournament` まで素通る。
- **影響**: 低い（`getTournament` 側で `firestore/not-found` になる）。ただし empty / whitespace tid のロギングは noise を増やす。
- **案**: `assertNonEmptyString(value, code)` ユーティリティを抽出して service 層の入口で `tid` / `uid` を検証
- **既存テスト**: SpectateModeCard.test.tsx で boolean validation はカバー
- **動作変更**: わずかに発生（empty string で 早期 throw する error code が変わる。ただし普通の利用経路では発生しない）→ **適用見送り推奨**

### finding-8: rule 側の boolean 型確認が Phase 1 (04-spectate-mode) 経路でしか effective でない

- **Lens**: security
- **Severity**: informational
- **場所**: `firestore.rules:434`（`request.resource.data.spectateEnabled is bool`）
- **観察事実**: 経路 B（finding-6 の右側）でしか `is bool` 制約が効かないが、左側（経路 A = broad organizer update）では `spectateEnabled` を任意の値で書けてしまう。zod schema は `boolean()` で制約しているのでクライアント経由なら防げるが、SDK 直叩き組織者は数値や string も書ける。
- **影響**: 低い。書込者は organizer ロールに限定される（信頼ロール）。zod は load 時に再 validate されるため、誤った値が書かれても次の `subscribeTournament` で `firestore/invalid-data` になり UI は guard できる。
- **案**: rule の経路 A 側にも `request.resource.data.spectateEnabled is bool` を additive で追加（small）。または finding-6 の方針 1 で経路 B を残しつつ経路 A から `spectateEnabled` を除外する形にし、強制力を分担させる
- **既存テスト**: 経路 B の `is bool` deny は scripts/test-rules-spectate.mjs でテスト済み。経路 A 側の同様 deny テストは無い。
- **動作変更**: 0（zod が同じ制約を強制中なので observed behavior は変わらない）

## レンズ A & B: 共通

### finding-9: 観戦経路の anon read コスト（rule read 1 件 / doc / 評価）

- **Lens**: both（performance / security）
- **Severity**: informational
- **場所**: `firestore.rules:445-450, 580-585`（players / tables の anon 経路）
- **観察事実**: spectate ON 中、player doc 1 件 / table doc 1 件読むたびに `exists() + get()` で親 tournament の `spectateEnabled` を再評価する。rule cache で同一評価内の同一 path は再 read しないが、subscribe 単位（snapshot）ごとに評価が走る。20 人 × 6 卓規模で初回 listen 時に ~26 件、その後 snapshot 更新ごとに同様の cost。
- **影響**: 会場規模では無視できる。CLAUDE.md の `firebase-patterns.md` でも記録されている既知の trade-off。
- **案**: 適用しない。記録のみ。
- **動作変更**: 該当なし

## findings サマリ

| # | Lens | Severity | 案の規模 | refactor 価値 |
|---|------|----------|---------|--------------|
| 1 | architect | high | 大（25+ 箇所） | ◎ 最優先 |
| 2 | architect | medium | 小〜中 | ○ |
| 3 | architect | medium | 小（1 export + 1 import） | ◎ 単純で価値高 |
| 4 | architect | low | 小（ファイル移動） | △ |
| 5 | architect | low | 中（helper 抽出 + 10+ callsite 置換） | △（refactor 価値はあるが影響範囲広く今回は見送り推奨） |
| 6 | security | low | 小（rule 削除 + コメント変更） | ○ |
| 7 | security | low | 中 | × 適用見送り（観測動作変更が出る） |
| 8 | security | informational | 小 | △（zod が同制約を強制中） |
| 9 | both | informational | - | - 記録のみ |

## 対応する Phase 3（リファクタ計画）の方針

Phase 2 で抽出した findings から、以下を Phase 3 で plan 化する候補:

1. **Task A**: `tournament.state` 直接比較を tournament-state helper に置換（finding-1）
   - A-1: service layer (timer.ts / receipt.ts) — 純関数のみ
   - A-2: TimerDisplay.tsx / TimerControls.tsx
   - A-3: live-client.tsx
   - A-4: dashboard-client.tsx
   - A-5: spectate-client.tsx（SpectateLateEntryBanner 含む）
2. **Task B**: `assertOrganizer` / `assertOwner` を export し、tournament.ts の局所コピーを撤去（finding-3）
3. **Task C**: spectate-client.tsx の subscribe onError 3 重複を local helper で集約（finding-2）
4. **Task D**: rule の tournaments allow update 右側 dead branch を整理（finding-6 / finding-8 を合わせて方針 1）
5. **Task E**: `_components/SpectateLateEntryBanner.tsx` に co-location（finding-4、Task A-5 の流れで同時に）

finding-5（error display formatter）と finding-7（input validation）は今回見送り。次回以降の architect-refactor で再評価する。
