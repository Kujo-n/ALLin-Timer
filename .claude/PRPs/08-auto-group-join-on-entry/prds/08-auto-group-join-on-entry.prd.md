# トーナメント受付によるサークル自動所属

## Problem Statement

トーナメント参加者は現在、**QR コードを 2 回読む**必要がある — 1 つは受付（`/join/[tid]`）、もう 1 つはサークル加入（`/groups/join/[code]`）。実地運用では**サークル加入の方が高頻度で忘れられており**、受付は済んでいるのにサークルメンバーになっていない参加者が発生する。シーズン戦績（PRD 02）の導入によって「メンバーとして登録されていること」が集計・ランキング表示の前提になったため、この取りこぼしは単なる手間ではなく**戦績データの欠落**として顕在化するようになった。

## Evidence

- ユーザー報告（本 PRD 作成時 Q&A）: 「トーナメント受付した人にサークル登録の QR 読み込みも発生している。**サークル登録の方がよく忘れられている**。」
- ユーザー報告（同）: 「シーズン戦績ができたことで、メンバー登録した上での管理の重要性が増した。」
- 技術調査（同、コードベース探索）: 受付フロー [receipt.ts](../../../../src/lib/services/receipt.ts) は `players/{uid}` を作るのみで `groups/{gid}` に一切触れていない。サークル加入経路は [group.ts:101](../../../../src/lib/services/group.ts#L101) `consumeJoinCode`（招待コード）**のみ**で、[firestore.rules:116](../../../../firestore.rules#L116) の self-add 分岐は `hasValidJoinCodeConsumption` を必須にしている。2 導線が構造的に分離している。
- 技術調査（同）: サークルからメンバーを外す UI が存在しない（`removeMemberSelf` = 自己脱退のみ。rule 上 owner の full update は可能だが呼び出す UI がない）。

## Proposed Solution

**トーナメント受付そのものを、サークル加入の消費証明として使う**。通常アカウント（Google / メール＋PW）で受付した参加者は、`players/{tid}/{uid}` の存在を根拠に、そのトーナメントの開催サークル（`tournaments/{tid}.groupId`）へ `member` ロールで**自動的に所属**する。招待コードの `hasValidJoinCodeConsumption` と同じ設計思想で、`groups/{gid}` に `joinedViaTournamentId` を消費証明として書かせ、Firestore Rules 側で「その tid のトーナメントが本当にこの gid のもので、かつ自分の player doc が実在する」ことを atomic に検証する。招待コードを他のトーナメント doc に埋め込む案（rule 変更ゼロ）は、観戦モード ON 時に `tournaments/{tid}` が anon read 可能になるため**招待コードが観戦者に漏れる**ので採らない。自動所属の副作用（誤参加者・一見さんの滞留）に対しては、**オーナーによるメンバー除名 UI** を同 PRD 内で対にして提供する。

## Key Hypothesis

We believe **トーナメント受付を根拠としたサークル自動所属**が **「サークル登録 QR の読み忘れによるメンバー未登録・戦績欠落」を解消**する for **小規模サークルの運営者と参加者**。
We'll know we're right when **次回開催で招待コードを 1 回も配らずに運営が完結し、受付した通常アカウント参加者が全員サークルメンバーとしてシーズンランキングに載る**。

## What We're NOT Building

- **匿名ゲストの自動所属** - 匿名アカウントは端末を跨げず参加取消時に auth ごと削除される。サークルメンバーとして永続させる意味がない（ユーザー回答 Q1）。
- **匿名 → アカウント連携（`LinkAccountDialog`）時の自動所属** - 匿名で受付した人が後から Google 連携した場合の遡及加入は作らない（ユーザー回答 Q2: 対象外）。必要なら本人が受付画面に戻れば加入する。
- **加入確認ダイアログ / チェックボックス** - 「完全自動（無言で所属）」をユーザーが明示選択（Q4）。同意 UI は挟まない。
- **招待コード導線の廃止** - `/groups/join/[code]` は残す。トーナメント外での加入（運営スタッフの招集など）に依然必要（ユーザー回答 Q5）。
- **「名前だけ」代理受付 player（`uid = null`）の自動所属** - uid を持たないため技術的に不可能。運営者管理専用のまま（PRD 07 の設計を維持）。
- **Cloud Functions 化** - クライアント直書き + Security Rules 防御という既存方針を踏襲。Callable 化は将来課題。
- **除名された参加者の再加入ブロック（ban リスト）** - 除名は「間違えて入った人を消す」用途。敵対的な再加入への対処は作らない。

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| 招待コード配布回数（次回開催） | **0 回** | 開催後の運営者フィードバック |
| 受付した通常アカウント参加者のメンバー化率 | **100%** | 開催後にサークルメンバー一覧と参加者一覧を突合 |
| 誤加入メンバーの除去 | 運営者がアプリ内で完結して除名できる | 開催後の運営者フィードバック |
| Security Rules の invariant 維持 | 新ブランチ追加後も既存 deny ケースが非回帰 | 新規 emulator validator + 既存 `npm run test:rules-*` 全 green |
| 既存テストの非回帰 | unit / E2E / typecheck / lint 全 green | `npm run test` / Playwright |

## Open Questions

- [ ] **除名後の `users/{uid}.groupIds` 残留**: owner は他人の `users/{uid}` を書けないため、除名しても対象者の `groupIds` に gid が残る（`deleteGroupByOwner` と同じ既知の制約）。[listMyGroups](../../../../src/lib/firebase/repositories/groups.ts#L119) は read 失敗を `failedGids` として warn + skip する耐性があるため実害は限定的だが、**除名された人が再受付したときに「既メンバー」と誤判定されないか**を実装で担保する必要がある（後述の membership probe 設計で解決する想定 → 実装時に検証）。
- [ ] **`joinedViaTournamentId` は最後の加入者の tid で上書きされる**（`joinCodeId` と同じ性質）。監査ログ用途には使えない。誰がどのトーナメント経由で入ったかを残す需要が出たら別途設計が必要。
- [ ] **rule 側の受付可能 state ガードを入れるか**: `players` doc の存在だけを条件にすると、終了済みトーナメントの過去参加者が後からいつでも自動加入できる。service 層は `assertAcceptingEntries` で既に塞いでいるため、rule にも同じ 4 state（`setup` / `seating` / `running` / `paused`）ガードを入れる方針で計画するが、その場合 [tournament-state.ts](../../../../src/lib/services/tournament-state.ts) の `isAcceptingProxyEntry` との**手動同期リテラルが 1 つ増える**（drift リスク）。Phase 1 の実装判断で最終確定する。
- [ ] **受付画面の新規メール登録タブ**（Q3 で追加を決定）: 既存の `/login` 登録フォームとの UI 重複をどう整理するか（共通コンポーネント抽出 or 受付画面専用の簡易版）。Phase 3 で判断。

---

## Users & Context

**Primary User**

- **Who**: 小規模 NLH サークル（6 卓以下・20 人前後、月 1〜2 回開催）の**参加メンバー**。会場で運営者が提示する QR を読んで受付する。副次的に、その手順を案内する**運営者**。
- **Current behavior**: 受付 QR を読んで `/join/[tid]` で参加登録 → その後にサークル加入 QR も読むよう口頭で案内されるが、**2 枚目を読まずに離脱しがち**。
- **Trigger**: 会場に到着し、運営者から受付 QR を提示された瞬間。
- **Success state**: QR を 1 枚読むだけで、トーナメント参加登録とサークル所属の両方が完了している。以降はシーズンランキング・過去戦績を自分の端末から閲覧できる。

**Job to Be Done**
When **会場で受付をするとき**, I want to **QR を 1 枚読むだけで参加登録とサークル所属が両方済む**, so I can **案内を聞き逃してもシーズン戦績に自分が正しく載る**。

**Non-Users**

- **匿名ゲスト参加者** — 端末跨ぎ不可・取消時に削除される設計のため、サークルメンバーとして永続させる対象外。
- **観戦者** — `/spectate/[tid]` は read-only であり、そもそも player doc を持たない。
- **サークルに属さない不特定多数向けの公開トーナメント運営** — 本アプリのスコープ外。トーナメント QR は「サークルに入れてよい相手」にのみ提示する運用前提（ユーザー確認済み）。

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
| --- | --- | --- |
| Must | トーナメント参加証明による `groups/{gid}` self-add の rule 新ブランチ | これがないと自動所属が rule で deny される。本 PRD の技術的な芯 |
| Must | 通常アカウント（Google / 既存ログイン / 現在ログイン中）受付時の自動所属 | 中核価値。招待コード QR を不要にする |
| Must | 匿名ゲストの明示的除外（`isSignedInNotAnon()` を rule で強制） | 匿名を混ぜるとサークルメンバー一覧が使い捨てアカウントで汚染される |
| Must | 受付操作のたびに未所属なら加入（`already-joined` でも実行） | ユーザー回答 Q1(b)。既受付者の取りこぼしを回収する |
| Must | サークル加入失敗が受付そのものを失敗させないこと（best-effort） | 受付は当日オペレーションのクリティカルパス。group 加入の失敗で受付が止まってはならない |
| Must | オーナーによるメンバー除名 UI | 自動所属の副作用（誤参加者滞留）の対処。ユーザー回答 Q4(a)。「後で削除できれば問題なし」が Q7 の許容条件 |
| Must | `/join/[tid]` への新規メール登録タブ | 「受付画面でアカウント作成」を成立させる。現状は Google と既存ログインのみ（ユーザー回答 Q3(a)） |
| Must | 専用 emulator validator（allow / deny 両方） | rule 新ブランチが既存 invariant を bypass しないことの機械検証。既存 PRD の設計原則 |
| Should | 受付完了画面での所属フィードバック（「◯◯ のメンバーになりました」） | 無言で所属させる方針でも、事後に何が起きたかは伝える |
| Should | 加入直後の group コンテキスト反映（サイドバー / サークル一覧に即出る） | 「受付したのに何も出ない」迷子の解消 |
| Could | 運営者向け「未所属の受付者」可視化 | 匿名ゲストなど自動所属対象外の参加者を運営者が把握できる |
| Won't | 匿名ゲストの自動所属 / 連携時の遡及加入 | 明示的に対象外（ユーザー回答 Q1・Q2） |
| Won't | 加入確認ダイアログ | 完全自動を選択（ユーザー回答 Q4） |
| Won't | 招待コード導線の廃止 | 残す（ユーザー回答 Q5） |
| Won't | Cloud Functions 化 | 既存方針踏襲。将来課題 |

### MVP Scope

仮説検証の最小単位は **「rule 新ブランチ ＋ 受付フロー（Google / 既存ログイン / ログイン済み継続）からの自動所属」**（Phase 1 + 2）。これだけで「次回開催で招待コードを配らずに済む」が検証できる。新規メール登録タブ（Phase 3）とメンバー除名 UI（Phase 4）は同 PRD 内で提供するが、仮説検証そのものには必須ではない。

### User Flow

**自動所属（クリティカルパス）**

1. 参加者が会場で受付 QR を読み `/join/[tid]` を開く
2. 「Google で参加」/「ログインして受付」/「このアカウントで受付」のいずれかを選ぶ（新規メール登録も Phase 3 以降で選択肢に加わる）
3. 受付処理が `players/{tid}/{uid}` を作成（既存挙動）
4. **続けて自動所属処理**: 自分がそのサークルのメンバーか判定 → 未所属なら `groups/{gid}` へ self-add（`memberUids` + `memberDisplayNames[uid]` + `joinedViaTournamentId`）→ `users/{uid}.groupIds` に gid を追加
5. 受付完了画面に「受付完了」＋「◯◯ のメンバーになりました」を表示。サイドバー / サークル一覧にも即反映
6. **失敗時**: 受付は成功のまま。加入失敗は `logger.warn` で記録し、完了画面に控えめな注記を出す（受付をロールバックしない）

**メンバー除名（オーナー）**

1. オーナーがサークル詳細画面のメンバー一覧を開く
2. 対象メンバーの「除名」を選択 → 確認ダイアログ
3. 確定 → `memberUids` / `organizerUids` / `memberDisplayNames[uid]` から対象を除去（owner full update 経路）
4. 最後のオーナー・自分自身は除名不可（service + UI の二重ガード）

---

## Technical Approach

**Feasibility**: MEDIUM-HIGH

**Architecture Notes**

- **rule 新ブランチ（案 A: トーナメント参加証明による self-add）**: [firestore.rules](../../../../firestore.rules) の `groups/{gid}` `allow update` に、既存 self-add（招待コード）と**並列の第 2 の self-add ブランチ**を additive 追加する。招待コードの `hasValidJoinCodeConsumption(gid, code)` に対応する `hasTournamentEntryProof(gid, tid)` ヘルパーを新設し、`exists(tournaments/{tid})` + `get(tournaments/{tid}).data.groupId == gid` + `exists(tournaments/{tid}/players/{auth.uid})` を検証する。ペイロード側は `joinedViaTournamentId: <tid>` を消費証明として持たせる（`joinCodeId` と同じ役割）。`affectedKeys().hasOnly(['memberUids', 'organizerUids', 'memberDisplayNames', 'joinedViaTournamentId'])` で他フィールド汚染を deny し、`organizerUids` / `ownerUids` / `name` / `createdAt` の不変性は既存 self-add と同一の条件を並べる。
- **匿名除外**: 新ブランチの入口を `isSignedIn()` ではなく既存 [`isSignedInNotAnon()`](../../../../firestore.rules#L14)（`structureTemplates` で実績あり）にする。UI 側でも匿名経路（`joinAsGuest`）からは自動所属を呼ばず、**二重防御**とする。
- **却下した案 B（招待コードをトーナメント doc に埋める）**: rule 変更ゼロで済むが、[firestore.rules:494](../../../../firestore.rules#L494) により観戦モード ON の `tournaments/{tid}` は **anon read 可能**。招待コードが観戦者に漏れ、`groupJoinCodes` の推測困難性設計（129bit ランダム）が無意味になるため不採用。
- **membership probe**: 加入前のユーザーは `groups/{gid}` を read できない（rule が `memberUids` 所属を要求）。`consumeJoinCode` は `users/{uid}.groupIds` で既メンバー判定しているが、除名後に `groupIds` が stale で残る問題（Open Questions）があるため、本 PRD では **`getGroup(gid)` の成否そのものをメンバーシップ判定に使う**方針を検討する（成功＝メンバー確定 / `permission-denied`＝非メンバー確定）。これなら stale な `groupIds` に引きずられず、再受付時に自己修復する。
- **`memberDisplayNames` の 15 字制限**: rule は `size() <= 15` を強制する（[firestore.rules:123](../../../../firestore.rules#L123)）が、Google の表示名は 15 字を超え得る。`seasonStats` で同じ罠を踏んだ先例（[group-membership.md](../../../rules/group-membership.md) の Phase A 節）に倣い、service 側で `displayName.slice(0, DISPLAY_NAME_MAX_LENGTH)` を必ず通す。これを怠ると rule deny で自動所属が静かに失敗する。
- **書込順序**: `players/{uid}` の create が rule 評価の前提なので、**受付（player 作成）→ 自動所属**の順を厳守する。逆順や並列実行は deny になる。
- **失敗の扱い**: 自動所属は best-effort。`AppError` でラップして `logger.warn` で記録し、受付処理自体は成功として返す（[error-logging.md](../../../rules/error-logging.md) 準拠、握りつぶし禁止）。新規エラーコードは `group/auto-join-failed` を想定。
- **除名 UI（rule 変更不要）**: owner-update 経路は既に `memberUids` を含む full update を許可している（[firestore.rules:85-91](../../../../firestore.rules#L85-L91)）。`updateGroupRoles` + `memberDisplayNames` の削除を組み合わせた service を追加し、サークル詳細画面から呼ぶだけでよい。最後のオーナー保護は `demoteOwner` / `leaveGroup` の既存パターンを踏襲する。
- **rule read コスト**: 新ブランチ評価で `exists` + `get` + `exists` の 2〜3 read を消費する（加入時 1 回のみ、既メンバーは probe の 1 read で終了）。20 人規模では無視できる。

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| 新 self-add ブランチが既存 invariant を bypass する穴を作る（Phase 5.4 の wildcard バグ類似） | M | wildcard 厳禁原則を踏襲し explicit ブランチのみ追加。既存 self-add と同一の不変条件を全て並べる。専用 emulator validator に「招待コードなし・player doc なし・別 group の tid・匿名 uid・他フィールド同時改竄」の deny ケースを必ず含める |
| 15 字超の Google 表示名で rule deny → 自動所属が静かに失敗 | **H** | service で `slice(0, DISPLAY_NAME_MAX_LENGTH)` を必須化し、unit test で 15 字超ケースを固定。`seasonStats` の先例をそのまま適用 |
| 除名された uid の stale `groupIds` により再受付時に「既メンバー」と誤判定され再加入されない | M | membership probe を `getGroup` の成否ベースにする（stale に依存しない）。除名 → 再受付 → 再加入の E2E を追加 |
| 受付と自動所属の間で失敗し、player はいるがメンバーでない中途半端な状態 | M | best-effort 設計（受付は成功扱い）＋ 次回受付操作で自動リトライされる（Q1(b) の「受付操作のたび」がリカバリ機構を兼ねる） |
| トーナメント QR の拡散で意図しない人物がメンバー化 | L | ユーザー確認済みの運用前提（QR を不特定多数に見える場所へ公開しない）＋ 除名 UI（Phase 4）で事後回収。rule 側でも受付可能 state ガードを検討 |
| 同一ユーザーの多端末・連打による同時 self-add で片方が deny | L | 片方は rule の `!(uid in resource.data.memberUids)` で deny → 「既に加入済み」として info ログに倒す。ユーザーには成功として見せる |
| `/join/[tid]` の登録タブ追加でタブ数が増え受付画面が煩雑化 | L | Phase 3 で UI 整理（Google 優先・タブは「ゲスト / ログイン / 新規登録」）。実機幅で確認 |

---

## Implementation Phases

<!--
  STATUS: pending | in-progress | complete
  PARALLEL: phases that can run concurrently
  DEPENDS: phases that must complete first
  PRP: link to generated plan file once created
-->

| #   | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 自動所属 データ層 | rule 新ブランチ＋`joinedViaTournamentId` schema、`joinGroupViaTournament` service、emulator validator | complete | with 4 | - | [phase-1-auto-join-data-layer.plan.md](../plans/completed/phase-1-auto-join-data-layer.plan.md) ／ [実装レポート](../reports/phase-1-auto-join-data-layer-report.md) |
| 2 | 受付フロー統合 | `receipt.ts` の 4 経路に自動所属を接続、完了画面フィードバック、group コンテキスト反映 | complete | with 4 | 1 | [phase-2-receipt-flow-integration.plan.md](../plans/completed/phase-2-receipt-flow-integration.plan.md) ／ [実装レポート](../reports/phase-2-receipt-flow-integration-report.md) |
| 3 | 受付画面の新規登録タブ | `/join/[tid]` にメール新規登録タブを追加し、自動所属と接続 | pending | - | 2 | - |
| 4 | メンバー除名 UI | オーナーがメンバーを除名できる service + サークル詳細 UI（rule 変更なし） | in-progress | with 1, 2 | - | [phase-4-member-removal-ui.plan.md](../plans/phase-4-member-removal-ui.plan.md) |

### Phase Details

**Phase 1: 自動所属 データ層**

- **Goal**: 通常アカウントが「トーナメント参加証明」だけで `groups/{gid}` に member として self-add できる基盤を rule レベルで確立する。
- **Scope**: `firestore.rules` に `hasTournamentEntryProof(gid, tid)` ヘルパー ＋ 第 2 self-add ブランチを additive 追加（`isSignedInNotAnon()` / `affectedKeys` 限定 / 既存 self-add と同一の不変条件）。`schemas/group.ts` に `joinedViaTournamentId`（nullable・default null）を additive 追加。`joinGroupViaTournament({ tid, gid, uid })` service（membership probe → self-add → `users/{uid}.groupIds` 更新、`displayName` の 15 字切り詰め込み）。`group/auto-join-failed` エラーコード追加。専用 emulator validator（`scripts/test-rules-tournament-join.mjs` 想定）＋ `package.json` に `test:rules-tournament-join` を追加。[group-membership.md](../../../rules/group-membership.md) / [firebase-patterns.md](../../../rules/firebase-patterns.md) の rule 経路表を更新。
- **Success signal**: emulator で「通常アカウント＋自分の player doc あり → allow」「匿名 / player doc なし / 別 group の tid / 存在しない tid / 他フィールド同時改竄 / organizerUids 昇格 → 全て deny」が green。既存の招待コード self-add / self-leave / self-key update の deny ケースが非回帰。`npm run test:rules-*` 全 green。

**Phase 2: 受付フロー統合**

- **Goal**: 受付操作をするだけでサークルメンバーになる状態を成立させる（本 PRD の中核価値）。
- **Scope**: [receipt.ts](../../../../src/lib/services/receipt.ts) の `joinViaGoogle` / `joinAsExistingUser` / `joinAsCurrentUser` に自動所属を接続（`joinAsGuest` は**接続しない**＝匿名除外）。`already-joined` でも実行する（Q1(b)）。best-effort（失敗時は `logger.warn` ＋ 受付は成功扱い）。受付完了画面に所属結果のフィードバックを追加。`GroupProvider` / サイドバーへの即時反映。unit test（15 字超 displayName / 既メンバー no-op / 失敗時に受付が成功のまま / 匿名は呼ばれない）＋ E2E。
- **Success signal**: E2E で「Google 受付 → サークル一覧に当該サークルが出る → シーズンランキングが見える」。匿名ゲスト受付ではメンバーが増えないことも E2E で固定。招待コードを一度も使わずに一連の流れが通る。

**Phase 3: 受付画面の新規登録タブ**

- **Goal**: 受付画面だけでアカウント作成まで完結し、その場で自動所属する。
- **Scope**: [join-client.tsx](../../../../src/app/join/[tid]/join-client.tsx) に「新規登録」タブを追加（メール / パスワード / 表示名）。既存 [`registerWithEmail`](../../../../src/lib/services/auth-actions.ts#L102) を再利用し、`/login` の登録フォームとの共通化方針を決めて実装。登録直後に Phase 2 の自動所属経路へ合流。表示名は `DISPLAY_NAME_MAX_LENGTH` を UI でも強制。
- **Success signal**: E2E で「受付画面から新規メール登録 → 参加者として登録 → サークルメンバーになる」が 1 画面で完結。既存タブ（ゲスト / ログイン）と Google 経路が非回帰。

**Phase 4: メンバー除名 UI**

- **Goal**: 自動所属で入った誤参加者・一見さんをオーナーが後から消せるようにする（Q7 の許容条件）。
- **Scope**: `removeMemberByOwner({ gid, actorUid, targetUid })` service（`assertOwner` ＋ 最後のオーナー保護 ＋ 自分自身は除名不可 ＋ `memberUids` / `organizerUids` / `ownerUids` / `memberDisplayNames[uid]` の整合更新）。サークル詳細画面のメンバー一覧に「除名」操作＋確認ダイアログ。除名対象の `users/{uid}.groupIds` は更新できない既知の制約をコメント＋ドキュメントに明記。unit test（最後のオーナー / 自己除名 / organizer 兼務メンバー / 非 owner からの実行）。
- **Success signal**: E2E で「オーナーがメンバーを除名 → メンバー一覧から消える → 除名された人が再受付すると再びメンバーになる（stale groupIds に阻害されない）」。rule 変更ゼロで成立していること。

### Parallelism Notes

- **Phase 4（除名 UI）は Phase 1〜3 と完全に独立**。owner-update 経路は既存 rule で足りており、schema 変更も rule 変更も伴わない。触るファイル（サークル詳細画面 / `group.ts` の owner 系 service）も自動所属側（`receipt.ts` / `join-client.tsx` / `firestore.rules`）と重ならないため、同時着手して構わない。
- **Phase 1 → 2 → 3 は直列**。Phase 2 は Phase 1 の rule と service がないと動かず、Phase 3 は Phase 2 の自動所属経路に合流する形で実装するため。
- Phase 2 と 3 は同じ [join-client.tsx](../../../../src/app/join/[tid]/join-client.tsx) を編集するので、並行させずに順に進める（マージ競合回避）。

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| 自動所属の実現方式 | 案 A: トーナメント参加証明による rule 新ブランチ | 案 B: 招待コードをトーナメント doc に埋めて自動消費 / 案 C: 運営者による一括メンバー化 | 案 B は観戦モード ON 時に `tournaments/{tid}` が anon read 可のため招待コードが漏れる。案 C は「完全自動」の要件を満たさない |
| 同意の取り方 | 完全自動（無言で所属） | チェックボックス（既定 ON）/ 事後ダイアログ | ユーザー回答 Q4(a)。QR は「サークルに入れてよい相手」にしか渡さない運用前提（Q7） |
| 匿名ゲストの扱い | 対象外（rule + service の二重防御で除外） | 匿名も所属させる | 端末跨ぎ不可・取消時に auth ごと削除される設計。メンバー一覧が使い捨てアカウントで汚れる（ユーザー回答 Q1） |
| 加入トリガの範囲 | 受付操作のたびに未所属なら加入（`already-joined` も対象） | 新規 player 作成時のみ | ユーザー回答 Q1(b)。既受付者の取りこぼし回収と、失敗時の自動リトライを兼ねる |
| 匿名 → アカウント連携時の遡及加入 | 作らない | 連携時に自動所属 | ユーザー回答 Q2(a)。MVP を絞る。必要なら受付画面に戻れば加入する |
| 消費証明の持たせ方 | `groups/{gid}.joinedViaTournamentId` に tid を書かせる | rule に request パラメータを渡す（不可能） | Firestore Rules は書込ドキュメント経由でしか値を受け取れない。既存 `joinCodeId` と同じパターンで一貫性を保つ |
| メンバーシップ判定 | `getGroup(gid)` の成否で判定（permission-denied = 非メンバー） | `users/{uid}.groupIds` を見る（`consumeJoinCode` 方式） | 除名後の stale `groupIds` に引きずられず自己修復する。read コストも同等 |
| 加入失敗時の受付 | 受付は成功扱い（best-effort、warn ログ） | 受付ごと失敗させる / ロールバック | 受付は当日オペレーションのクリティカルパス。group 加入の失敗で受付を止める方が害が大きい |
| 除名 UI | 本 PRD に含める（Phase 4） | 別 PRD に切る | ユーザー回答 Q4(a)。自動所属の許容条件（Q7「後で削除できれば問題なし」）そのもの |
| 招待コード導線 | 残す | 廃止する | ユーザー回答 Q5(a)。トーナメント外での加入・運営スタッフ招集に必要 |
| 受付画面の新規メール登録 | タブを追加する | Google のみで済ませる | ユーザー回答 Q3(a)。Google を持たない参加者の受け皿 |
| 集約方式 | クライアント直書き + Security Rules 防御 | Cloud Functions 化 | 既存方針踏襲（PRD 07 と同じ）。将来課題 |

---

## Research Summary

**Market Context**

外部の競合調査は本 PRD では実施していない（ユーザー合意済み）。「イベント参加をきっかけにコミュニティへ自動加入させる」パターン自体は一般的だが、本アプリは 20 人前後のクローズドなサークル運用が前提で、公開イベントプラットフォームの設計（審査・承認フロー・公開プロフィール）をそのまま持ち込む必要がない。外部事例より**既存の招待コード設計（`hasValidJoinCodeConsumption`）との一貫性**を優先する方が、この規模では合理的と判断した。必要になった時点で調査する。

**Technical Context**

- 受付フロー [receipt.ts](../../../../src/lib/services/receipt.ts) は `players/{uid}` 作成のみで group に触れていない。自動所属は `ensurePlayerCreated` の**直後**に差し込むのが自然（rule が player doc の存在を要求するため順序も必然）。
- `groups/{gid}` の self-add は [firestore.rules:102-123](../../../../firestore.rules#L102-L123) で招待コード消費証明を必須にしている。同じ形の第 2 ブランチを additive に足す設計が、既存の「ブランチごとに `affectedKeys().hasOnly` を列挙する」規約（[firebase-patterns.md](../../../rules/firebase-patterns.md) の allowed-keys 一覧）に最も素直に乗る。
- 匿名除外に使える `isSignedInNotAnon()` は [firestore.rules:14](../../../../firestore.rules#L14) に既存（`structureTemplates` で実績あり）。
- `registerWithEmail` / `signUpWithGoogle` は [auth-actions.ts](../../../../src/lib/services/auth-actions.ts) に実装済みで、受付画面への登録タブ追加は新規 auth 実装を伴わない。
- **除名 UI は rule 変更不要**。owner-update 経路が既に `memberUids` の full update を許可しており、不足しているのは service と UI のみ。
- `listMyGroups` は read 失敗を `failedGids` として warn + skip する耐性が既にあり（[groups.ts:119](../../../../src/lib/firebase/repositories/groups.ts#L119)）、除名後の stale `groupIds` でアプリが壊れることはない。
- `memberDisplayNames` の 15 字 rule 制限と外部由来 displayName の衝突は、`seasonStats` で既に踏んだ罠（[group-membership.md](../../../rules/group-membership.md) Phase A 節）。同じ `slice` 対策をそのまま適用できる。

---

_Generated: 2026-07-31_
_Status: DRAFT - needs validation_
