# Architect Refactor 監査結果 — 20260801

## Scope

- **対象**: `src/` 全域（29,564 行 / 非テスト）＋ `firestore.rules` / `storage.rules`
- **起点ブランチ**: `feture/auto-group-join`（PRD 08 完了時点 `ed0ed1b`）
- **作業ブランチ**: `refactor/architect-refactor-20260801`
- **所属 PRD**: `05-post-launch-polish`（過去 3 サイクルの architect-refactor と同じ帰属。
  PRD 08 は Phase 1〜4 すべて complete かつ `plans/` 直下が空の immutable アーカイブのため
  新規 plan を置かない）
- **レンズ**: [web_architect.md](../../../skills/architect-refactor/references/web_architect.md) /
  [security_specialist.md](../../../skills/architect-refactor/references/security_specialist.md)
- **集約先**: [refactor-conventions.md](../../../skills/architect-refactor/references/refactor-conventions.md)

## ベースライン（Phase 1 実測）

| 検証 | 結果 |
| --- | --- |
| `npm run typecheck` | ✅ pass |
| `npm run lint` | ✅ pass（0 warnings） |
| `npm test` | ✅ 107 files / **1702 pass** / 0 fail |
| `npm run build` | ✅ pass |
| `npm run test:e2e` | ✅ **116 pass** / 0 fail / 3 skip（10.8 分） |
| `knip` | 未使用 export 4 件（すべて自モジュール内で使用 = 誤検出扱い） |

前サイクル（20260514-2）比: unit 1420 → 1702（+282）／ E2E 100 → 116（+16）。
PRD 06 / 07 / 08 の実装で増加。**開始時点で全 green を確定**（前サイクルは E2E 2 fail から開始していた）。

## 前提の確認（規約遵守状況）

今回の監査では、以下の全フェーズ規約は **良好に守られている**ことを機械的に確認した:

- `console.*` の残置: **0 件**（`logger.ts` 内の実装のみ）
- `tournament.state === "..."` の直接比較: **0 件**（全ヒットがコメント。`tournament-state.ts` 経由に統一済み）
- Firestore SDK の repositories 外 import: 型のみ（`Timestamp`）/ 文書化済み例外
  （`services/group.ts` の tx / `orchestrator.ts`）/ **`app/debug/fs` のみが真の違反**（finding-1）
- `wrapFirestoreWrite` / `wrapFirestoreRead` の適用: repositories 全域で徹底
- 数値リミット: `limits.ts` に集約済み

つまり本サイクルの所見は「規約違反の摘発」ではなく **重複の集約 / 死んだ足場の撤去 /
allowlist の最小権限化** が中心になる。

## Findings 概要

- critical: 0 件
- high: 0 件
- medium: 6 件（finding-1 / 2 / 3 / 4 / 5 / 7）
- low: 4 件（finding-6 / 8 / 9 / 10）
- info: 2 件（finding-11 / 12）

---

### finding-1: `/debug/fs` が Phase 1 の残骸として生存し、現行規約に 3 重違反かつ機能的に完全な dead code

- **Lens**: both
- **Severity**: medium
- **場所**: [src/app/debug/fs/debug-fs-client.tsx](../../../../src/app/debug/fs/debug-fs-client.tsx):1-93 /
  [src/app/debug/fs/page.tsx](../../../../src/app/debug/fs/page.tsx) / README.md:79,82,269,271,341,460
- **観察事実**:
  - ソース内コメントに「Phase 1 完了判定用の debug ルート（/debug/fs）。**Phase 5 で削除予定**」と
    明記されているが、PRD 01 の Phase 5 は完了済みで PRD 02〜08 まで進んでいる
  - Firestore SDK（`addDoc` / `getDocs` / `collection`）をコンポーネントから直接呼ぶ
    （[firebase-patterns.md](../../../rules/firebase-patterns.md) の「repositories 配下のみ」違反）
  - `signInAnonymously` を `auth-actions.ts` を経由せず直接呼ぶ
  - schema が `ownerUid` ベース（**Phase 2.5 で `groupId` モデルに移行して廃止された旧形**）
  - **両ボタンとも現在必ず失敗する**:
    - `handleWrite`: rule の tournaments create は
      `request.resource.data.createdByUid == request.auth.uid && isOrganizer(request.resource.data.groupId)`
      を要求。debug doc は両フィールドを持たないため deny
    - `handleList`: `getDocs(tournamentsRef)` は**絞り込みなしの list**。
      08 Phase 1 の C-1 対応で `allow list: if isGroupMember(resource.data.groupId)` に狭めたため deny
- **影響**:
  - **公開リポジトリ**（MIT / GitHub 公開）に「規約違反の実装例」が生きた形で残る。
    新規参加者・AI エージェントがこのファイルを参照して同じ書き方を再生産するリスクが最も大きい害
  - `NEXT_PUBLIC_ENABLE_DEBUG=1` の Preview 環境で、押しても必ず permission-denied を返すだけの
    ボタンが公開される（疎通確認という当初の目的を果たしていない = 誤った安心/不安を与える）
  - 実害としての攻撃面は小さい（本番は env 未設定で 404、rule で二重に deny）
- **案**:
  1. **ルートごと削除**（`src/app/debug/` を撤去）＋ README の該当記述 6 箇所を整理。
     `NEXT_PUBLIC_ENABLE_DEBUG` は他に consumer が無いため env 表からも削除
  2. （代替）現行 repositories 経由に書き直して疎通確認機能を維持 — ただし
     「疎通確認」は E2E 35 spec + emulator で既に恒常的に担保されており **YAGNI**
- **テスト保護**: E2E / unit いずれからも参照なし（grep で確認）。削除の安全性は
  typecheck / build / E2E 全件で担保される
- **リスク**: `NEXT_PUBLIC_ENABLE_DEBUG=1` の環境で `/debug/fs` が 404 になる = **観測可能な動作変更**。
  ただし当該ページの全機能が既に失敗する状態のため機能的損失はゼロ。
  **不変条件 2 に抵触するため、実施はユーザー承認を必須とする**

---

### finding-2: OG 背景画像の host allowlist が「プロジェクトのバケット」ではなく「GCS 全体」を許可している

- **Lens**: security
- **Severity**: medium
- **場所**: [src/app/api/og/_lib/og-image-fetch.ts](../../../../src/app/api/og/_lib/og-image-fetch.ts):23-31, 48-57
- **観察事実**:
  - コメントは「**同一バケットに対する**両形式を受容する」と設計意図を述べているが、
    実装は `parsed.hostname` の集合一致のみで、バケットを一切検査していない
  - `storage.googleapis.com` は **GCS 全体で共有されるマルチテナントホスト**であり、
    `https://storage.googleapis.com/<任意の公開バケット>/<任意のオブジェクト>` がすべて allowlist を通過する
  - `firebasestorage.googleapis.com` も同様に `/v0/b/<任意のプロジェクトのバケット>/o/...` が通る
  - 結果、未認証の `/api/og/winner/[tid]` / `/api/og/season/[gid]` に任意の `bgImageUrl` を渡せば、
    **世界中の公開 GCS オブジェクトを取得して PNG に埋め込んで返す汎用画像プロキシ**として利用できる
- **影響**:
  - 内部ネットワークへの SSRF ではない（外部の公開ホスト限定 / `https` 限定 /
    content-type は jpeg・png・webp のみ / 2MB 上限 / 8s タイムアウトが既に効いている）
  - 実質的な害は「最小権限の原則からの逸脱」と「Vercel の帯域・実行時間を第三者が
    無関係なコンテンツの配信に流用できる」こと（未認証エンドポイントのため rate limit も無い）
  - 設計意図（コメント）と実装が乖離している点自体が、将来 allowlist を触る人を誤らせる
- **案**:
  - `isAllowedBgImageUrl` に **バケット一致検査**を追加する:
    - `firebasestorage.googleapis.com` 形式: pathname が `/v0/b/<bucket>/o/` で始まること
    - `storage.googleapis.com` 形式: pathname が `/<bucket>/` で始まること
  - `<bucket>` は `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` から解決。
    **env 未設定時は現行の host-only 判定にフォールバック**（emulator / テスト環境の非回帰）
- **テスト保護**: [og-image-fetch.test.ts](../../../../src/app/api/og/_lib/og-image-fetch.test.ts) が既存。
  「自バケット allow / 他バケット deny / env 未設定時フォールバック」のケースを追加する
- **リスク**: アプリが生成する URL は必ず自バケットの download URL のため、正常系に観測可能変更なし。
  不変条件 2 の「セキュリティ修正」に該当
- **実施後の追記**: 本 finding の修正（`2b50ff2`）は Phase 5 の E2E で
  `card-background.spec.ts:60` を落とした。同 spec の fixture が **旧 allowlist の広さ**
  （バケットを問わない）に依存して `v0/b/nonexistent/o/...` を使っていたため。
  fixture を設定済みバケットに修正し、deny 側を positive coverage として追加（`831e408`）。
  詳細は [実装レポート](../reports/architect-refactor-20260801.md) の該当節を参照

---

### finding-3: 表示名バリデータが 2 モジュールで完全重複（code / message / 順序すべて一致）

- **Lens**: architect
- **Severity**: medium
- **場所**:
  - [src/lib/services/auth-actions.ts](../../../../src/lib/services/auth-actions.ts):37-49 `validateDisplayName`
  - [src/lib/services/entry-guards.ts](../../../../src/lib/services/entry-guards.ts):45-60 `parseDisplayName`
- **観察事実**: 両者は `trim` → 空なら
  `AppError("表示名を入力してください", "validation/display-name-required")` →
  上限超過なら `AppError("表示名は N 文字以内で入力してください", "validation/display-name-too-long")`
  という **文言・code・分岐順序まで完全に同一**。差は上限が定数固定か引数かのみ。
  すなわち `validateDisplayName(n)` ≡ `parseDisplayName(n, { maxLength: DISPLAY_NAME_MAX_LENGTH })`
- **影響**: 表示名ポリシー（上限・文言・正規化）の変更時に 2 箇所同期が必要。
  片方だけ変えると「登録画面では通るが受付では弾かれる」形の silent drift になる
- **案**: `auth-actions.validateDisplayName` を `parseDisplayName` への薄い委譲に置換
  （`entry-guards` を真実源とする。受付・代理受付・認証の 3 経路すべてが同じ関数を通る形になる）
- **テスト保護**: [auth-actions.test.ts](../../../../src/lib/services/auth-actions.test.ts) /
  [entry-guards.test.ts](../../../../src/lib/services/entry-guards.test.ts) 双方が既存。
  code / message を assert しているため等価性がテストで担保される
- **リスク**: 出力が完全一致するため観測可能変更なし

---

### finding-4: group 設定の値域バリデーションが service 層と repository 層で逐語的に二重実装（約 120 行）

- **Lens**: architect
- **Severity**: medium
- **場所**:
  - `setDefaultTableSettings` [services/group.ts](../../../../src/lib/services/group.ts):413-489
    ↔ `updateDefaultTableSettings` [repositories/groups.ts](../../../../src/lib/firebase/repositories/groups.ts):471-533
  - `setSeasonPointsRule` services/group.ts:506-558 ↔ `updateSeasonPointsRule` repositories/groups.ts:546-594
  - `setFinishedTournamentCount` services/group.ts:349-368 ↔ `updateFinishedTournamentCount` repositories/groups.ts:384-403
  - `setDefaultSeatsPerTable` services/group.ts:375-398 ↔ `updateDefaultSeatsPerTable` repositories/groups.ts:435-458
- **観察事実**: 4 組すべてで「同じ条件式・同じ AppError code・同じ日本語メッセージ」が
  2 ファイルにコピーされている。例えば Table 名の検査は
  `Array.isArray` → `length > MAX_TABLES` → `colors.length !== labels.length` →
  各要素の型 → `trim().length` 範囲 → hex 正規表現、という 6 段が両側に存在する
- **影響**:
  - 「二重防御」は設計意図として正しいが、**同一の検証コードを 2 回書くこと**は二重防御の要件ではない。
    共有の pure validator を両層から呼べば防御の層数は変わらず drift リスクだけが消える
  - 現状は上限値を変えたとき 2 箇所（＋ rules ＋ drift script）の同期が必要で、
    片側だけ緩めると service を迂回した経路（将来の別 callsite）で値域が抜ける
- **案**: `src/lib/validation/group-settings.ts` に純関数を抽出
  （`parseDefaultTableSettings` / `parseSeasonPointsRule` / `parseFinishedCount` /
  `parseDefaultSeats`）。service は「正規化した値を得る」ために、repository は
  「受け取った値を再検証する」ために **同じ関数を呼ぶ**。層構造も防御回数も不変
- **テスト保護**: [group.test.ts](../../../../src/lib/services/group.test.ts) /
  repositories 側の既存 unit。抽出した純関数に対する直接 test も追加する
- **リスク**: 現在 service 側は `trim` 済みの値を repository に渡し、repository は
  `trim()` 後の長さを検査している。抽出時にこの非対称を保つこと（正規化と検証を分離した API にする）

---

### finding-5: orchestrator の tx 内 race guard が 3 関数で重複

- **Lens**: architect
- **Severity**: medium
- **場所**: [src/lib/services/seating/orchestrator.ts](../../../../src/lib/services/seating/orchestrator.ts)
  - `applySingleMove`:824-841
  - `applyCascadeMoves`:713-741
  - `applyTableBreak`:941-962
- **観察事実**: 3 箇所とも「`playerFromSnap` → 不在なら `missing` → busted なら `busted` →
  `tableNum`/`seatNum` が `move.from` と不一致なら `moved` → `lastMovedAt` が期待値と不一致なら `race`」
  という同一の 4 段ガードを、skipReason の文字列書式だけ変えて（`"missing"` vs `"missing:{pid}"`）
  繰り返している
- **影響**: 席移動の競合制御は本アプリの最も壊れやすい部分（同時操作で席が二重占有される）。
  ガード段の追加・修正時に 3 箇所同期が必要で、1 箇所漏らすと特定経路だけ race に穴が開く
- **案**: `tx-helpers.ts` に
  `verifyPlayerUnchangedInTx(tx, playersRef, move, expectedLastMovedAtMs)` を追加し、
  `{ ok: true; player } | { ok: false; reason: "missing"|"busted"|"moved"|"race" }` を返す。
  skipReason の suffix（`:${playerId}`）は呼出側で組み立てて**現行の文字列を完全に維持**する
- **テスト保護**: [orchestrator.test.ts](../../../../src/lib/services/seating/orchestrator.test.ts) が
  skipReason を assert しているため、文字列を保てば等価性が担保される
- **リスク**: skipReason は `logger.info` にしか出ないが、テストが assert しているため
  書式を変えるとテストが落ちる。**書式維持を必須要件とする**

---

### finding-6: Firestore collection ref factory が 3 モジュールで重複定義

- **Lens**: architect
- **Severity**: low
- **場所**:
  - `playersRef`: [orchestrator.ts](../../../../src/lib/services/seating/orchestrator.ts):57-61
    ↔ [repositories/players.ts](../../../../src/lib/firebase/repositories/players.ts):24-28（**完全一致**）
  - `tournamentRef`: orchestrator.ts:48-55 ↔
    [tx-helpers.ts](../../../../src/lib/firebase/tx-helpers.ts):31-36 `tournamentDocRef`
    ↔ [repositories/tournaments.ts](../../../../src/lib/firebase/repositories/tournaments.ts):67-69
  - `tablesRef`: orchestrator.ts:63-67 ↔ repositories/tables.ts
- **観察事実**: `tx-helpers.ts` のコメント自身が
  「orchestrator.ts / repositories/tournaments.ts で重複していた `tournamentRef` の実装と**一致させる**」
  と述べており、重複を認識したうえで手動同期に頼っている
- **影響**: converter（zodConverter の第 2 引数のパス文字列）を変えた際の同期漏れ。
  実害は限定的だが、`refactor-conventions.md` の「共通化先」思想に反する
- **案**: `src/lib/firebase/refs.ts` に ref factory を集約し、3 モジュールから import する
- **テスト保護**: 既存 repository unit test（mock が `collection`/`doc` の呼出引数を assert）
- **リスク**: mock 境界が変わるテストがある可能性 → 実装時に確認し、
  壊れた場合は「内部実装依存テストの helper 境界化」として同 commit に記録する

---

### finding-7: `SeatingBoard.tsx` が 626 行に 5 コンポーネントを同居させている

- **Lens**: architect
- **Severity**: medium
- **場所**: [src/components/tournament/SeatingBoard.tsx](../../../../src/components/tournament/SeatingBoard.tsx)
  （`SeatingBoard` / `SeatRow` / `PlainSeat` / `DnDSeat` / `PdCheckbox`）
- **観察事実**: `refactor-conventions.md` の分割閾値（300 行）の 2 倍。
  同一ディレクトリに `_timer-controls/`（TimerControls 379 → 222 行 + 4 sub）と
  `_table-label-edit/` の分割先例が既にある
- **影響**: 席表は D&D / PD / 卓 label / 卓閉鎖・再開の 4 機能が交差する最も複雑な UI で、
  1 ファイルに全部あるため変更時の影響範囲が読みにくい
- **案**: `src/components/tournament/_seating-board/` を作り
  `SeatRow.tsx` / `PlainSeat.tsx` / `DnDSeat.tsx` / `PdCheckbox.tsx` に分割。
  `SeatingBoard.tsx` は orchestrator として残す（先例と同じ形）
- **テスト保護**: [SeatingBoard.test.tsx](../../../../src/components/tournament/SeatingBoard.test.tsx) 239 行 ＋
  E2E（playing-dealer / manual-table-close / table-add-reopen / table-label-and-color）
- **リスク**: 純粋なファイル移動 + import 修正。DOM 構造・aria 属性は不変

---

### finding-8: `join-client.tsx` 516 行 — 6 handler が同一の submit boilerplate、結果画面が inline

- **Lens**: architect
- **Severity**: low
- **場所**: [src/app/join/[tid]/join-client.tsx](../../../../src/app/join/%5Btid%5D/join-client.tsx):132-258（handler 群）/ 260-346（結果画面）
- **観察事実**:
  - `setError(null)` → `setSubmitting(true)` → `try { ... } catch { wrapError(e) } finally { setSubmitting(false) }`
    が 5 handler で反復（`onLoginSubmit` / `onGuestSubmit` / `onGoogleJoin` /
    `onContinueAsSignedIn` / `onCancelOwnEntry`）。`onRegisterSubmit` はこれに catch 分岐が 2 本増えた形
  - 受付完了 / 取消の結果画面（87 行）が本体 component に inline
- **影響**: 前サイクルで `group-detail-client.tsx` に対して同種の集約
  （`runReloadRefreshAction`）を行った先例があり、同じ負債が受付画面に残っている
- **案**:
  1. `runReceiptAction(fn, { onSuccess? })` helper に 5 handler を寄せる。
     `onRegisterSubmit` / `onGoogleJoin` は独自 catch 分岐を持つため **inline 維持**
     （前サイクルと同じ判断基準: `setError` 挙動が変わる callsite は触らない）
  2. 結果画面を `_components/JoinResultCard.tsx` に抽出
- **テスト保護**: E2E `auto-group-join.spec.ts` / `anonymous-flow-completion.spec.ts` /
  `member-removal.spec.ts`（受付経路）
- **リスク**: `setError(null)` の呼出有無が handler ごとに違うため、helper 適用対象を
  厳密に選別すること。判断を誤ると観測可能変更になる

---

### finding-9: DRIFT WARNING コメントの参照先が実体と乖離している 2 箇所

- **Lens**: both
- **Severity**: low
- **場所**:
  - [firestore.rules](../../../../firestore.rules):679 —
    「`MAX_TABLES = 6 ↔ src/lib/services/seating/engine.ts の MAX_TABLES`」。
    実体は `src/lib/limits.ts`（`engine.ts:19` は `export { MAX_TABLES }` の re-export のみ）
  - [repositories/tournaments.ts](../../../../src/lib/firebase/repositories/tournaments.ts):957 —
    「`rule 側の match /{sub=**} の write は…`」。
    当該 wildcard は **Phase 5.4 で重大バグとして廃止**され、現行は
    `match /players/{pid}` / `match /tables/{tableId}` の explicit rule
- **観察事実**: どちらも「変更時にここを見ろ」と指示する DRIFT WARNING / 設計根拠コメント。
  参照先が誤っているため、指示に従った人が誤った場所を確認して同期漏れを起こす
- **影響**: 直接の実行時影響はゼロ。ただし対象が **security rule の同期指示**であり、
  この種のコメントは誤っているほうが無いより有害
- **案**: 参照先を実体に合わせて修正。`deleteTournament` のコメントは現行 explicit rule
  （親 doc `exists` + `isOrganizer` を要求する点は同じ）に基づく説明へ書き換える
- **テスト保護**: コメントのみの変更のため全テストが不変で通ることが保護
- **リスク**: なし

---

### finding-10: `services/group.ts` 887 行 / `generateJoinCode` の `void defaultExpiresAt;` ダミー参照

- **Lens**: architect
- **Severity**: low
- **場所**: [src/lib/services/group.ts](../../../../src/lib/services/group.ts):271-273
- **観察事実**:
  ```ts
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000));
  // default の場合は 7 日：呼び出し側からの override が無ければ defaultExpiresAt と一致
  void defaultExpiresAt;
  ```
  `defaultExpiresAt` は import されているが実際には**使われておらず**、
  未使用 import の lint エラーを避けるためだけに `void` 演算子で参照している
- **影響**: 「使っていないが消せない」ように見える誤ったシグナルを残す。
  実際には `defaultExpiresAt` は他 callsite（repositories 内）で使われているため、
  本 service からは import ごと削除して問題ない
- **案**: `void` 文とコメントを削除し、import からも `defaultExpiresAt` を外す。
  「default 7 日」の意図はコメントとして残す
- **テスト保護**: `group.test.ts` の `generateJoinCode` ケース
- **リスク**: なし
- **補足（見送り）**: 887 行のファイル分割（group CRUD / 招待コード / ロール / シーズン /
  カード背景 / メンバー除外の 6 責務）は import 波及が大きく、本サイクルでは**見送る**。
  `proxy-receipt.ts` の `resolveOrganizerContext` に倣った
  「`getGroup` + `assertOrganizer` の集約」も、8 callsite それぞれで後続処理が異なるため
  利得が薄く見送り

---

### finding-11: knip 検出の未使用 export 4 件は誤検出

- **Lens**: architect
- **Severity**: info（対応不要）
- **場所**: `seasonHistoryRef` / `seasonPointsRuleSchema` / `seasonHistoryEntrySchema` / `AutoJoinStatus`
- **観察事実**: 4 件とも**自モジュール内で使用されている**（knip は「他モジュールから import されていない」
  ことを検出しているだけ）。`seasonHistoryRef` は `group.test.ts` の mock 対象でもある
- **案**: 対応不要。`export` を外すと `group.test.ts` の mock が壊れる

---

### finding-12: 表示名の「解決」ロジックが 4 実装 / 3 通りの優先順位

- **Lens**: architect
- **Severity**: info（本サイクル見送り）
- **場所**:
  - [receipt.ts](../../../../src/lib/services/receipt.ts):49-60 `resolveDisplayName` — hint → users profile → auth → throw
  - [auto-group-join.ts](../../../../src/lib/services/auto-group-join.ts):55-67 `resolveMemberDisplayName` — hint → auth → users profile → uid（15 字 slice）
  - [group.ts](../../../../src/lib/services/group.ts):138-140 `consumeJoinCode` 内 — auth → users profile → uid
  - group.ts:85 `createGroupWithOwner` 内 — auth → uid
- **観察事実**: 同じ「ユーザーの表示名を解決する」概念が 4 箇所で、
  **profile と auth の優先順位が逆転する 3 通り**で実装されている
- **影響**: 受付経路では `receipt` が解決した名前を hint として渡すため実害は出ていないが、
  独立に呼ばれる経路（招待コード加入 / group 作成）では `players.displayName` と
  `memberDisplayNames[uid]` が食い違い得る
- **案（見送り理由）**: 優先順位を統一すると**観測可能な動作変更**（表示名が変わる）になり
  不変条件 2 に抵触する。順序を引数化した共通 helper に寄せる案もあるが、
  4 callsite すべてで異なる順序を渡すことになり抽象化の利得が薄い。
  **統一するかどうかは仕様判断**のため、別タスクとしてユーザーに提起する

---

## 採用 findings の優先順位

| 順位 | finding | Severity | 根拠 |
| --- | --- | --- | --- |
| 1 | finding-2 | medium (security) | 最小権限化。未認証エンドポイントの allowlist |
| 2 | finding-9 | low (security 文書) | security rule の同期指示の誤り。1 行修正で解消 |
| 3 | finding-3 | medium | 完全重複の解消。リスクゼロ |
| 4 | finding-10 | low | ダミー参照の除去。リスクゼロ |
| 5 | finding-4 | medium | 約 120 行の重複解消。層構造は不変 |
| 6 | finding-5 | medium | race guard の集約。skipReason 維持が条件 |
| 7 | finding-6 | low | ref factory 集約 |
| 8 | finding-7 | medium | SeatingBoard 分割（先例あり） |
| 9 | finding-8 | low | join-client 集約 + 結果画面抽出 |
| 10 | finding-1 | medium | **ユーザー承認必須**（観測可能変更を伴う） |

## 関連リンク

- 実施計画: [architect-refactor-20260801.plan.md](../plans/architect-refactor-20260801.plan.md)
- 前サイクル: [architect-refactor-20260514-2.md](architect-refactor-20260514-2.md) /
  [report](../reports/architect-refactor-20260514-2.md)
- 規約: [firebase-patterns.md](../../../rules/firebase-patterns.md) /
  [error-logging.md](../../../rules/error-logging.md) /
  [group-membership.md](../../../rules/group-membership.md) /
  [testing.md](../../../rules/testing.md) /
  [security-base.md](../../../rules/security-base.md)
