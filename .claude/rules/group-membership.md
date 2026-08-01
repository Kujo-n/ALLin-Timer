---
applyAlways: false
applyOnPaths:
  - "firestore.rules"
  - "src/lib/firebase/schemas/group.ts"
  - "src/lib/firebase/schemas/groupJoinCode.ts"
  - "src/lib/firebase/repositories/groups.ts"
  - "src/lib/firebase/repositories/groupJoinCodes.ts"
  - "src/lib/services/current-group.tsx"
  - "src/lib/services/group.ts"
  - "src/lib/hooks/useGroupRole.ts"
  - "src/app/groups/**"
  - "scripts/migrate-phase-*-roles*.ts"
  - "scripts/test-rules-*.mjs"
applyOnPathsExclude:
  - "**/*.test.{ts,tsx}"
---

# Group（サークル）メンバーシップ規約

Phase 2.5 で確立した group ベース所有権・権限モデル。**Phase 4.6 で 3 階層ロール（owner / organizer / member）に拡張**。Phase 3 以降はここを参照する。

## 適用範囲

- **対象（モデル定義層）**:
  - `firestore.rules` — group ブランチの書込条件
  - `src/lib/firebase/schemas/group.ts` / `groupJoinCode.ts` — zod schema・invariant・`deriveRole`
  - `src/lib/firebase/repositories/groups.ts` / `groupJoinCodes.ts` — write 経路
  - `src/lib/services/current-group.tsx` / `group.ts` — `GroupProvider` / role 操作 service
  - `src/lib/hooks/useGroupRole.ts` — 任意 gid のロール導出
  - `src/app/groups/**` — group 設定 UI（rename / 招待 / role 管理 / audio settings）
  - `scripts/migrate-phase-*-roles*.ts` / `scripts/test-rules-*.mjs`
- **除外**: `**/*.test.{ts,tsx}` — テスト編集時は [testing.md](testing.md) の mock 境界規約を適用
- **対象外（include に含まれない・消費側）**:
  - `src/app/tournaments/**` / `src/app/structures/**` — `useCurrentGroup` / `useGroupRole` を**読むだけ**の消費側。group 設計を変更する場合は本ファイルを Read する
  - `src/components/**` — 同上
  - `src/lib/firebase/repositories/tournaments.ts` / `structures.ts` — `groupId` を保持するが group 設計には立ち入らない

## スコープ

Phase 2.5 で以下を `ownerUid` 個人所有モデルから `groupId` 共有所有モデルに移行済み。Phase 4.6 でロールを追加:

- `structures/{sid}` — サークルで共有されるストラクチャプリセット
- `tournaments/{tid}` — サークルで開催されるトーナメント

## データモデル

- `groups/{gid}` — name / **ownerUids[]** / **organizerUids[]** / memberUids / memberDisplayNames / audioSettings / **finishedTournamentCount** / **defaultSeatsPerTable** / **seasonStartDate** / **seasonPointsRule** / createdAt / **joinCodeId** / **latestJoinCodeId** / **joinedViaTournamentId**
  - invariant: `ownerUids ⊆ organizerUids ⊆ memberUids`（`ownerUids.length >= 1`）
  - Phase 2.5 の `ownerUid: string` は Phase 4.6 migration で廃止（`scripts/migrate-phase-4.6-roles.ts`）
  - `joinCodeId`（Phase 4.6.1 追加）: 直近の self-add で消費された `groupJoinCodes/{code}` の doc ID。rule 側の consumption proof として利用する（下記「招待コードの rule 側検証」）。新規 group / 未消費状態では `null`。owner は owner update 経路で自由に上書き／null 化してよい
  - `latestJoinCodeId`（dryrun-feedback-batch-1 / Phase C.1 追加）: `generateJoinCode` service が新規コード発行直後に書き込むライフサイクル管理用 pointer。
    次回再発行時に旧コードを best-effort delete するためのリンクで、`joinCodeId`（self-add consumption proof）とは意味が別。
    旧 doc（Phase E 以前）はフィールド不在のため `default(null)` で hydrate される。書込経路は service の
    `generateJoinCode` 一系統のみで、rule は organizer 以上が `affectedKeys().hasOnly(['latestJoinCodeId'])` で
    `string | null` を書込可能。owner は full owner-update 経路で自由に変更可能
  - `joinedViaTournamentId`（08-auto-group-join-on-entry Phase 1 追加・default null）:
    トーナメント受付を消費証明とした self-add で書き込まれる tid。`joinCodeId`（招待コードの
    consumption proof）と同じ役割・同じ性質（**最後の加入者の値で上書きされるため監査ログ用途には
    使えない**）。書込経路は `joinGroupViaTournament`（services/auto-group-join.ts）→
    `addSelfViaTournamentEntry`（repositories/groups.ts）の 1 系統のみ。
    旧 doc はフィールド不在のため `default(null)` で hydrate される
  - `finishedTournamentCount`（Phase 4.16 追加）: 当該サークルで `state="finished"` に遷移したトーナメントの累計数。
    自動経路は `finishTournament()` の runTransaction で `increment(1)`（tx 内で `state !== "finished"` を
    再 read することで複数端末同時呼び出し時の二重 increment race を防止）、手動経路はサークル詳細画面の
    inline edit（owner / organizer 限定）。新規作成画面のデフォルト名連番（`Tournament-No.X`）に使用。
    rule は organizer 以上の任意の非負整数値書換を許可（任意フィールド変更は deny）。空書込攻撃のリスクは
    [既知のセキュリティリスク](#既知のセキュリティリスク) 参照。
  - `defaultSeatsPerTable`（Phase 4.17 追加・Phase A で default 9 → 8 に変更）:
    トーナメント新規作成画面の「1 Table あたりの席数」初期値。
    値域は 2..10 で `tournament.seatsPerTable` と完全一致（DRIFT WARNING: `firestore.rules` の `players seatNum`
    上限と連動）。書込経路はサークル詳細画面の inline edit（owner / organizer 限定）の 1 系統のみ。
    rule は organizer 以上で `affectedKeys().hasOnly(['defaultSeatsPerTable'])` + `is int` + 2..10 を強制。
    旧 doc は zod default で 8 として hydrate されるが、明示的に 9 を保存していた既存 group の値は影響なし
    （schema default は新規 hydrate 時のみ適用）。Phase A では「シーズンポイント計算式の baseline=8」
    と整合させるため変更した。
  - `seasonStartDate`（Phase A 追加・default null）: 現在シーズンの開始時刻 Timestamp。
    自動経路は `startNewSeason()` の runTransaction で `serverTimestamp()` 経由更新（旧 stats を
    `seasonHistory/{seasonId}` に snapshot した上で stats を全削除し、新シーズンを開始）。
    rule は organizer 以上で `affectedKeys().hasOnly(['seasonStartDate'])` + `is timestamp` を強制
    （null セットは owner branch のフルアクセス経由でのみ可能）。
    旧 doc は zod default で `null` として hydrate され、初回 startNewSeason まで未設定のまま。
    UI（サークル詳細・ランキング画面）は null のとき「未設定」と表示する。
  - `seasonPointsRule`（Phase E 追加・default null）: シーズンポイント計算式の運営者カスタマイズ。
    `null` または `{ base: number[], baseline: number }`。`null` のとき `DEFAULT_SEASON_POINTS_RULE`
    （`base = SEASON_POINTS_BASE`、`baseline = SEASON_POINTS_BASELINE_PARTICIPANTS = 8`）が
    適用される。書込経路はサークル詳細画面の SeasonPointsRuleCard inline edit のみ
    （`setSeasonPointsRule({ gid, uid, value })` → `updateSeasonPointsRule(gid, value)`）。
    rule は organizer 以上で `affectedKeys().hasOnly(['seasonPointsRule'])` + `null` または
    `is map` + `base.size() 1..9` + `baseline 2..10` を強制。各要素 (`base[i] >= 0 number`) は
    Cloud Firestore Rules で list element の値域を表現できないため schema / service 層に委譲。
    `finishTournament` の runTransaction 内で `groups/{gid}` を tx 内 raw read してアトミックに
    rule を解決し、`calcSeasonPoints(rank, totalParticipants, rule)` で各参加者の totalPoints を
    増分する。tournament 進行中の rule 変更は commit 時点の最新値が適用される。
    過去の `seasonStats` には遡及適用しない（運営者は「シーズンを開始する」で reset 推奨）。
    ⚠ DRIFT WARNING: `base.size() <= 9` / `baseline 2..10` のリテラルは src/lib/limits.ts の
    `SEASON_POINTS_BASE_MAX_LENGTH` / `MIN_SEATS_PER_TABLE` / `MAX_SEATS_PER_TABLE` と連動。
    drift 検出は scripts/test-rules-limits.mjs。
- `groupJoinCodes/{code}` — gid / expiresAt / maxUses / usedCount
- `users/{uid}.groupIds` — 逆引き
- `structures/{sid}` / `tournaments/{tid}` — `groupId` + `createdByUid`

### 招待コードの rule 側検証（Phase 4.6.1）

`groups/{gid}` self-add 経路（非メンバーによる自己加入）は以下を **Firestore Rules** で atomic に強制する:

1. 書込ペイロードに `joinCodeId: <code doc id>` が含まれること（`is string`）
2. `groupJoinCodes/{joinCodeId}` が存在し、`gid` が現在の group と一致
3. `expiresAt > request.time`
4. `getAfter(groupJoinCodes/{joinCodeId}).usesCount == get(...).usesCount + 1`（同 request 内で +1 消費）
5. `maxUses == null || getAfter(...).usesCount <= maxUses`

これにより、認証済みユーザーが `updateDoc(groups/{gid}, { memberUids: arrayUnion })` を **service 層経由せず直接呼ぶ攻撃を rule 側で deny** する（[firestore.rules](../../firestore.rules) の `hasValidJoinCodeConsumption` 参照）。

また `groupJoinCodes` は `allow get` のみ許可し `allow list: if false`。認証済みユーザーによる全コード／全 gid の列挙を防ぐ（gid を知らないと攻撃起点が作れない）。

### トーナメント受付による self-add の rule 側検証（08-auto-group-join-on-entry Phase 1）

`groups/{gid}` の self-add には**第 2 の経路**がある。トーナメント受付そのものを
消費証明として使い、招待コードなしで member として自己加入する経路:

1. 書込者が**通常アカウント**であること（`isSignedInNotAnon()` — 匿名は deny）
2. ペイロードに `joinedViaTournamentId: <tid>` が含まれること（`is string`）
3. `tournaments/{tid}` が存在し、`groupId` が現在の group と一致
4. `tournaments/{tid}.state` が受付可能 4 state（`setup` / `seating` / `running` / `paused`）
5. `tournaments/{tid}/players/{auth.uid}` が存在する（= 受付済み）
6. `affectedKeys().hasOnly(['memberUids','organizerUids','joinedViaTournamentId','memberDisplayNames'])`
   ＋ 招待コード self-add と同一の不変条件（memberUids は +1 のみ / organizerUids・ownerUids・
   name・createdAt は不変 / memberDisplayNames は self-key のみ・1〜15 文字）

⚠ DRIFT WARNING: 受付可能 4 state リテラルは `isAcceptingProxyEntry`（tournament-state.ts）
および `players/{pid}` create の member-proxy / name-only ブランチと**手動同期**する。

emulator validation: [scripts/test-rules-tournament-join.mjs](../../scripts/test-rules-tournament-join.mjs)
（`npm run test:rules-tournament-join`）。

**アプリ側の呼出経路（Phase 2）**: `joinGroupViaTournament`（services/auto-group-join.ts）を
呼ぶのは [receipt.ts](../../src/lib/services/receipt.ts) の内部 helper `receiveEntry` **のみ**。
`joinAsExistingUser` / `joinViaGoogle` / `joinAsCurrentUser` / `joinAsNewUser`（Phase 3）の
4 経路がこれを通り、**`joinAsGuest`（匿名）だけが通らない**
（rule の `isSignedInNotAnon()` と併せた二重防御）。

- **順序**: `ensurePlayerCreated`（player doc 作成）→ `joinGroupViaTournament`。
  rule の `hasTournamentEntryProof` が player doc の存在を前提にするため逆順は必ず deny
- **best-effort**: 失敗は `logger.warn`（`code: "group/auto-join-failed"`）に落とし、
  受付結果は `ReceiptOutcome.autoJoin.status = "failed"` として返す。受付自体は成功扱い
- **`already-joined` でも実行**する。既受付者の取りこぼし回収と失敗時の自動リトライを兼ねる
- UI（`/join/[tid]`）は `status === "joined"` のときだけ所属メッセージを出し、
  `setCurrentGroupId` + `refreshGroups` で group コンテキストへ即反映する
  （`already-member` でも `refreshGroups` のみ実行 — `users/{uid}.groupIds` の補修を一覧へ反映するため）

⚠ DRIFT WARNING: 受付経路を追加する場合は **`receiveEntry` を経由させる**こと。
`ensurePlayerCreated` を直接呼ぶと自動所属が抜ける。
Phase 3 の新規登録タブ（`joinAsNewUser` = `registerWithEmail` → `receiveEntry`）が
この規約に沿った先例。

### 受付画面（`/join/[tid]`）の認証タブ表示条件（Phase 3 レビュー M-1 / M-4）

「ゲスト」「ログイン」「新規登録」タブはいずれも **現在の Firebase Auth セッションを
差し替える**（`signInAnonymously` / `signInWithEmailAndPassword` /
`createUserWithEmailAndPassword` はどれも link ではなく再サインイン）。
uid が変わると `players/{uid}` が別 doc として作られるため、**同一人物が参加者一覧に
二重で並ぶ**。これを UI 側で抑止する規約:

| 認証状態 | 表示するタブ | 補足 |
| --- | --- | --- |
| 未サインイン | ゲスト / ログイン / 新規登録 | 既定は「ゲスト」（当日の最速動線） |
| 匿名（ゲスト受付済みを含む） | 3 つすべて | ログイン / 新規登録タブ選択時に「別の参加者として受付されます」と警告する |
| 通常アカウントでサインイン済み | **ゲストのみ** | ログイン / 新規登録は畳む。別アカウントを使う場合はログアウトが正規手順 |

匿名でタブを残すのは「ゲスト受付した人が後からアカウントへ移行したい」需要があるため。
根本解決（匿名セッションの `linkWithCredential` への移行）は別 PRD 課題。

⚠ DRIFT WARNING: 受付画面に認証タブを追加する場合は上表の分岐に必ず載せること。
`user` の匿名判定を落とすと二重登録の導線が復活する。

## ロール定義（Phase 4.6）

| ロール | 定義 | 典型例 |
| ------ | ---- | ------ |
| **owner** | `ownerUids` に含まれる最上位ロール。複数人設定可 | サークル代表・運営の最終責任者 |
| **organizer** | `organizerUids` に含まれるが owner ではない。structures / tournaments / 招待コードを CRUD | 運営スタッフ |
| **member** | `memberUids` のみに含まれる一般メンバー。トーナメント閲覧・参加のみ | 参加メンバー |

`deriveRole(group, uid)` ヘルパー（[src/lib/firebase/schemas/group.ts](../../src/lib/firebase/schemas/group.ts)）が 3 階層のロールを返す（所属しない場合は `null`）。

## 権限マトリクス

| 操作 | owner | organizer | member |
| ---- | ----- | --------- | ------ |
| group を read（`groups/{gid}`） | ○ | ○ | ○ |
| group の name 変更 / roles 変更 | ○ | × | × |
| group 自体の削除 | ○ | × | × |
| group 脱退 | ○（他 owner が 1 人以上いる場合のみ） | ○ | ○ |
| 他メンバーの除外（`removeMemberByOwner`） | ○ | × | × |
| 招待コード発行（`groupJoinCodes` create） | ○ | ○ | × |
| 招待コード削除 | ○ | × | × |
| structures CRUD | ○ | ○ | read のみ |
| tournaments CRUD（create/update/delete） | ○ | ○ | read のみ |
| tournaments/players create（自分の参加） | ○ | ○ | ○ |
| tournaments/players bust / seat（他人） | ○ | ○ | × |
| tournaments/players self-delete | ○ | ○ | ○ |
| 開催数（`finishedTournamentCount`）の参照 | ○ | ○ | ○ |
| 開催数（`finishedTournamentCount`）の修正 | ○ | ○ | × |
| デフォルト席数（`defaultSeatsPerTable`）の参照 | ○ | ○ | ○ |
| デフォルト席数（`defaultSeatsPerTable`）の修正 | ○ | ○ | × |
| シーズン戦績（`seasonStats/{uid}`）の参照 | ○ | ○ | ○ |
| シーズン戦績（`seasonStats/{uid}`）の更新 | ○ | ○ | ×（`finishTournament` tx 経由のみ自動更新） |
| シーズン履歴（`seasonHistory/{seasonId}`）の参照 | ○ | ○ | ○ |
| シーズン履歴（`seasonHistory/{seasonId}`）の更新・削除 | ×（rule で全員 deny） | × | × |
| シーズン開始（`startNewSeason`） | ○ | ○ | × |
| シーズン開始日（`seasonStartDate`）の参照 | ○ | ○ | ○ |
| Table 名デフォルト（`defaultTableLabels`）の参照 | ○ | ○ | ○ |
| Table 名デフォルト（`defaultTableLabels`）の更新 | ○ | ○ | × |
| シーズンポイント計算ルール（`seasonPointsRule`）の参照 | ○ | ○ | ○ |
| シーズンポイント計算ルール（`seasonPointsRule`）の更新 | ○ | ○ | × |
| 卓 label / color（`tables/{n}.label` / `.color`）の参照 | ○ | ○ | ○ |
| 卓 label / color の更新 | ○ | ○ | × |
| 卓の追加（`tables/{n}` create、Phase 4） | ○ | ○ | × |
| 卓の再開（`tables/{n}.isBroken=false`、Phase 4） | ○ | ○ | × |
| 観戦モード（`tournaments/{tid}.spectateEnabled`）の toggle | ○ | ○ | × |
| 観戦モード ON 中 tournament の **anon read**（`/spectate/[tid]` 経由） | -（anon でも可） | -（同上） | -（同上） |
| アカウント自己削除（`/settings`） | ○（sole-owner サークルがあれば block） | ○ | ○ |
| トーナメント受付経由のサークル自動加入（通常アカウント） | ○ | ○ | ○（未所属者が member として加入） |
| 同上（匿名ゲスト） | - | - | ×（rule + service の二重防御で deny） |

## ロール遷移

- 招待コード加入は常に `member`（一般メンバー）でスタート
- owner 操作で以下の遷移が可能:
  - `member` ↔ `organizer`（`promoteToOrganizer` / `demoteToMember`）
  - `organizer` ↔ `owner`（`promoteToOwner` / `demoteOwner`）
  - 直接 `member` → `owner` は禁止（先に `organizer` に昇格）
- 最後のオーナーは降格 / 脱退不可（rule + service の二重防御）

### オーナーによるメンバー除外（08-auto-group-join-on-entry Phase 4）

トーナメント受付による自動所属（Phase 1〜3）で入った誤参加者・一見さんを、オーナーが
事後に外すための経路。**Firestore Rules の変更を伴わない** —— 既存の owner-update
ブランチ（`auth.uid in resource.data.ownerUids` + `ownerUids.size() >= 1` +
`createdAt` 不変）が `memberUids` を含むフル update を既に許可しているため。

- service: [`removeMemberByOwner({ gid, actorUid, targetUid })`](../../src/lib/services/group.ts)
  1. **自己除外の禁止**（`group/cannot-remove-self`）— 脱退は `leaveGroup` を使う
  2. `assertOwner`（organizer は不可）
  3. 対象が既に非メンバーなら no-op で return（冪等）
  4. 対象が owner かつ `ownerUids.length <= 1` なら `group/last-owner`
- repository: [`removeOtherMember(gid, targetUid)`](../../src/lib/firebase/repositories/groups.ts)
  — `memberUids` / `organizerUids` / `ownerUids` の `arrayRemove` ＋
  `memberDisplayNames[targetUid]` の `deleteField()` を 1 回の `updateDoc` で atomic に適用
- UI: サークル詳細「メンバー」タブの各行（owner 視点・自分以外）に「除外」ボタン ＋
  確認ダイアログ（`RemoveMemberDialog`）

**既知の制約（設計上の割り切り）**:

- 除外対象の `users/{uid}.groupIds` は**本人以外書き換えられない**（`users/{uid}` は
  self-only rule）。`deleteGroupByOwner` と同じ制約。stale な gid は対象者側の
  [`GroupProvider`](../../src/lib/services/current-group.tsx) が `listMyGroups` の
  `failedGids` として検出し `removeGroupIdFromUser` で自己修復する。
- そのため、**除外直後に招待コードで再加入しようとすると `consumeJoinCode` が
  stale な `groupIds` を見て「既メンバー」と誤判定する**。対象者が一度アプリを開いて
  自己修復を走らせれば解消する。トーナメント受付経由の自動所属（Phase 1 の
  `joinGroupViaTournament`）は membership 判定に `getGroup` の成否を使う設計のため、
  stale `groupIds` の影響を受けない。
- ⚠ **除外が永続するのは「受付可能なトーナメントが残っていない」ときだけ** — 上記の裏返しで、
  除外対象者が `setup` / `seating`、または締切前の `running` / `paused` のトーナメントに
  `players/{uid}` を残していると、本人が `/join/[tid]` を開き直すだけで自動所属で戻る
  （`receiveEntry` は `already-joined` でも `joinGroupViaTournament` を実行するため）。
  `finished` 後は service の [`assertAcceptingEntries`](../../src/lib/services/entry-guards.ts) と
  rule の `hasTournamentEntryProof` の二層で塞がり、除外は永続する。
  締切超過（`currentLevel > lateEntryDeadlineLevel`）の `running` / `paused` も service 側で
  塞がるが、**`setup` / `seating` は締切判定の対象外**（`isInProgress` ではない）なので、
  次回枠や clone で `setup` のまま放置されたトーナメントがあると窓が開いたままになる。
  詳細は「既知のセキュリティリスク」の
  [トーナメント QR の拡散による意図しないメンバー化](#トーナメント-qr-の拡散による意図しないメンバー化08-auto-group-join-on-entry-phase-1) →「除名との関係」を参照。
- 過去トーナメントの `players/{pid}` と `seasonStats/{uid}` は**意図的に残す**
  （履歴の継続性。アカウント自己削除と同方針）。

### アカウント自己削除（通常アカウント）

通常アカウント（Google / Email+Password）ユーザーが `/settings` から自分のアカウントを完全削除する経路。匿名アカウントは対象外で、引き続き `attemptAnonymousSelfDelete`（`logout` / `cancelOwnEntry` / `live-client.finish`）で削除される。

- service: [`deleteAccount`](../../src/lib/services/account-delete.ts) の orchestrator
  1. **sole-owner pre-check** — `users/{uid}.groupIds` + `listMyGroups` で
     `isSoleOwner(group, uid)` を評価。1 件でも該当があれば
     `AccountDeleteSoleOwnerBlocked` を throw して UI に block dialog を出させる
  2. **全 group 脱退** — 残った group から `Promise.allSettled` で順次 `leaveGroup`
     （per-gid 失敗は warn ログ、user.delete は best-effort で続行）
  3. **users/{uid} 削除** — `deleteUserProfile` 経由（best-effort）
  4. **`user.delete()`** — `auth/requires-recent-login` のときは throw せず
     `needsReauth: true` を返し、UI の reauth dialog → `reauthenticateAccount`
     ([auth-actions.ts](../../src/lib/services/auth-actions.ts)) → 削除再試行に倒す
- rule: 変更なし。既存の `users/{uid}` self-delete と `groups/{gid}` self-leave
  経路のみで成立する。新ブランチ・新フィールドは追加していない
- 過去 tournament の `players/{pid}` と `seasonStats/{uid}` は意図的に残す
  （履歴の継続性のため。`displayName` は脱退時の値を保持し、UI は orphan として扱える）

「自分が唯一のオーナー」の正準判定は [`isSoleOwner(group, uid)`](../../src/lib/firebase/schemas/group.ts)（pure 関数）。新規 callsite はこの helper を経由すること。

## 実装上の注意

- `get(/groups/{groupId})` によるメンバーシップチェックは **Firestore rule の read quota を 1 件消費**する。Phase 4.6 で `isGroupMember` / `isOrganizer` / `isOwner` の 3 helper を追加したが、同一評価内の同一 path に対する get は cache されるため、単一 rule 評価あたり +1 read 程度
- group 切替時のコンテキスト管理は `src/lib/services/current-group.tsx`（`GroupProvider` / `useCurrentGroup`）経由で行う。Phase 4.6 で `currentGroupRole` / `isOrganizer` / `isOwner` を導出フィールドとして追加
- 招待コード仕様は [security.md](security.md) の「招待コード設計原則」に従う
- 既存データのマイグレーション手順:
  - Phase 2.5 → [phase-2.5-group-management.plan.md](../PRPs/01-allin-timer/plans/completed/phase-2.5-group-management.plan.md)
  - Phase 4.6 → [scripts/migrate-phase-4.6-roles.ts](../../scripts/migrate-phase-4.6-roles.ts) + README の migration 手順
- **互換レイヤは作らない**（Phase 2.5 先例に従う）。migration 実行前の旧コード／旧クライアントは動作不可

### 任意 `gid` への role 導出（Phase 4 architect-refactor 以降・推奨）

`useCurrentGroup().currentGroupRole` は **「現在選択中の group」**のロールしか扱わない。tournament view（`/tournaments/[tid]`）のように URL から決まる group へのロールが必要な画面では **`useGroupRole(gid: string | null | undefined)`**（[`src/lib/hooks/useGroupRole.ts`](../../src/lib/hooks/useGroupRole.ts)）を使うのが推奨。返り値は `{ group, role }` で、group オブジェクトとロール導出を 1 回で得られる。

```ts
// 推奨形
const { group: tournamentGroup, role: myRole } = useGroupRole(data?.groupId);

// 旧パターン（重複・将来 architect-refactor で集約される）
const tournamentGroup = data ? groups.find((x) => x.id === data.groupId) ?? null : null;
const myRole = user && tournamentGroup ? deriveRole(tournamentGroup, user.uid) : null;
```

### Phase A: シーズン管理（`seasonStats` / `seasonHistory` / `seasonStartDate`）

シーズン累計の参加・優勝・FT・ポイントを集計する基盤。`groups/{gid}` 配下の 2 つの subcollection と、
`groups/{gid}.seasonStartDate` フィールドの 3 領域で構成される（[firestore.rules](../../firestore.rules) 参照）。

| Path | 用途 | rule |
| --- | --- | --- |
| `groups/{gid}.seasonStartDate` | 現在シーズンの開始時刻 Timestamp | organizer 以上が `affectedKeys.hasOnly(['seasonStartDate'])` + `is timestamp` で書換可。owner はフルアクセス経由で null 化可 |
| `groups/{gid}/seasonStats/{uid}` | 各メンバーのシーズン累計 stats（uid == doc id） | read: group メンバー全員 / create-update: organizer のみ + 数値非負 / displayName 1〜15 / uid==docId / delete: organizer（reset 経路） |
| `groups/{gid}/seasonHistory/{seasonId}` | 過去シーズンの snapshot（append-only） | read: group メンバー全員 / create: organizer のみ / update-delete: 禁止（履歴改竄を rule で deny） |

書込経路は service 層で 2 系統に固定:

- **自動増分** — `finishTournament(tid, uid, userGroupIds)` の runTransaction
  ([repositories/tournaments.ts](../../src/lib/firebase/repositories/tournaments.ts))。
  事前 read で `listPlayers(tid)` から順位を確定し、tx 内で各 player の `seasonStats/{uid}` を
  `tx.get` → `tx.set` で個別増分する（read-then-write 順序）。`uid === null` の player は skip。
  ポイント計算は [`calcSeasonPoints(rank, totalParticipants)`](../../src/lib/services/season-points.ts) で
  `base[rank-1] × sqrt(participants / 8)` を 2 桁丸め。
  - tx 内 read は **converter 抜きの `seasonStatsRawDocRef`** で行い、過去シーズンに混入した
    schema mismatch doc 1 件で tx 全体（= トーナメント終了）が止まらないように防御する。
    数値フィールドは `Number(...)` + `isFinite` + `>= 0` で読み出す（`toPrevStats` helper）。
    list / subscribe は引き続き converter 経由で schema を強制する。
  - 書込時の `displayName` は **15 字に切り詰める**（`displayName.slice(0, DISPLAY_NAME_MAX_LENGTH)`）。
    player schema には max 制約がないため Google 本名等で 15 字超過の値が混入し得るが、
    seasonStats rule は `<= 15` を強制するため、切り詰めなしだと rule deny で tx 失敗 →
    トーナメント終了不能になる。受付フロー (`joinInputSchema`) は max を強制するが、
    `players` repository / schema 全体での max 強制は行っていない（過去 player との互換性のため）。
- **シーズン切替** — `startNewSeason({ gid, uid })` ([services/group.ts](../../src/lib/services/group.ts))。
  事前 read で `seasonStats` 全件を取り、tx 内で
  `seasonHistory/{newSeasonId}` を `set`（snapshot append）→ 旧 stats を `delete` →
  `groups/{gid}.seasonStartDate` を `update` する。`newSeasonId` は `crypto.randomUUID()`。
  - **進行中 tournament（`seating` / `running` / `paused`）が当該 group にあると pre-check で
    `season/in-progress-tournament` を early throw する**。`finishTournament` との race window を
    最小化する（pre-read 後・tx commit 前の `finishTournament` で新規 stats が新シーズンに leak
    するのを、運営者に「先に終了させる」UX で予防）。完全 race-free は Cloud Functions 化で対応。
  - history `entries` の `displayName` も自動増分経路と同じく 15 字に切り詰める
    （seasonHistoryEntry schema / rule の整合性確保）。

⚠ DRIFT WARNING: `seasonStats` / `seasonHistory` は `groups/{gid}` 配下の subcollection なので
[firebase-patterns.md](firebase-patterns.md) の「subcollection 設計原則: wildcard 厳禁」に該当する。
新規 subcollection を `groups/{gid}` 配下に追加する場合は explicit な `match /<path>` を
追加し、wildcard `match /{sub=**}` は絶対に書かないこと。

emulator validation: [scripts/test-rules-season.mjs](../../scripts/test-rules-season.mjs)（`npm run test:rules-season`）。

### Phase 1 (04-spectate-mode): tournaments.spectateEnabled

観戦モード（spectator-only read-only view）の rule 基盤。observable scope は **tournament 単位**で、
group や season を跨いで開放されることはない。

| Path | 観戦時の挙動 |
| --- | --- |
| `tournaments/{tid}` | `spectateEnabled === true` のとき anon でも read 可 |
| `tournaments/{tid}/players/{pid}` | 親 tournament の `spectateEnabled === true` のとき anon でも read 可 |
| `tournaments/{tid}/tables/{tableId}` | 同上 |

書込（toggle / 進行操作）の権限は通常通り organizer 以上に限定される。`spectateEnabled` toggle 自体は
`tournaments/{tid}` の `allow update` 経路で `affectedKeys.hasOnly(['spectateEnabled', 'updatedAt']) + is bool`
の単独書換ブランチが additive 追加されている（既存の broad organizer update 経路と OR、行動上 redundant
だが将来 organizer 経路を狭める足場）。詳細・rule 経路の DRIFT WARNING は
[firebase-patterns.md](firebase-patterns.md) の「`tournaments/{tid}` / `groups/{gid}` 配下 subcollection の rule 設計原則」
を参照。

emulator validation: [scripts/test-rules-spectate.mjs](../../scripts/test-rules-spectate.mjs)（`npm run test:rules-spectate`）。
詳細仕様は [04-spectate-mode PRD](../PRPs/04-spectate-mode/prds/04-spectate-mode.prd.md)。

### tournament state ごとの許可判定（Phase 4 architect-refactor 以降・推奨）

`tournament.state === "running"` 等の直接比較ではなく、[`src/lib/services/tournament-state.ts`](../../src/lib/services/tournament-state.ts) の純関数（`canPause` / `canResume` / `isInProgress` / `canDelete` / `showSeatingBoard` 等）を経由するのが推奨。新規 state を追加するときは同 file の関数と [`tournament-state.test.ts`](../../src/lib/services/tournament-state.test.ts) の characterization test を更新する。

## 既知のセキュリティリスク

### `groupJoinCodes.usesCount` の悪意ある第三者による空消費

**現状**: [firestore.rules](../../firestore.rules) の `groupJoinCodes` `allow update` ルールは、認証済みユーザーであれば誰でも `usesCount` を `+1` する更新を許可している（`request.resource.data.usesCount == resource.data.usesCount + 1` のみで判定）。group メンバー追加とは独立して評価される。

**攻撃シナリオ**: 招待コード文字列がチャット等で第三者に流出した場合、加入意図のない第三者が `usesCount` だけを繰り返しインクリメントし、`maxUses` まで到達させてコードを無効化できる（DoS）。

**現行の緩和**: Phase 2.5 の `generateJoinCode` の default は `maxUses: null`（無制限）。UI からも `maxUses` 設定機能を提供していないため、本番運用上は顕在化しない。Phase 4.6 では rule を `isOrganizer` に強化したが、update ルール自体は認証済みユーザー全員に開かれているため本質的リスクは残存。

Phase 4.6.1 で `groupJoinCodes` の `allow read` は `get` に限定（list 禁止）。これにより認証済みユーザーが全コード文字列を列挙する経路は塞がれたが、コード文字列が何らかの形で流出した場合の DoS は引き続き攻撃可能。

**`maxUses` UI を追加する際の必須対応**:

1. `usesCount` 更新と `groups/{gid}.memberUids` への自分追加を **atomic に検証** する仕組みが必要
2. Firestore Security Rules 単独では複数 doc 同期検証が表現困難なため、**Cloud Functions（Callable）化が現実解**
   - Callable function で `code` 検証 → group 加入 → `usesCount` 更新 を 1 トランザクションで実行
   - クライアントから `groupJoinCodes` を直接更新できないよう、rule の `allow update` を deny に戻す
3. 代替案として、招待コードを「単一回使用 + クライアント発行」ではなく「サーバ生成・短命 token」モデルに変更する選択肢もある

**判定基準**: `maxUses` を運営者 UI から設定できるようになった時点で対策必須。デフォルトの `maxUses: null` 利用に留まる限りは遅延可。

### `finishedTournamentCount` の任意値書換による嫌がらせ（Phase 4.16〜）

organizer 権限を持つメンバーは `setFinishedTournamentCount` 経由で counter を任意の非負整数値に書き換えできる（rule は `>= 0 の int` のみ許可、任意フィールド変更は deny）。影響範囲は新規作成画面のトーナメント名デフォルト連番のみで、permission / billing / 集計など他のロジックには波及しない。

**緩和**: organizer は既に CRUD 全般を持つ信頼ロールのため、嫌がらせによる実害は無視できる。完全に rule で塞ぐには Cloud Functions 化（`finishTournament` / `setFinishedTournamentCount` を Callable 化し、クライアントから groups.update を deny に戻す）が必要。Phase 5+ で counter を他用途に流用する際は再評価する。

### `defaultSeatsPerTable` の任意値書換による嫌がらせ（Phase 4.17〜）

organizer 権限を持つメンバーは `setDefaultSeatsPerTable` 経由でデフォルト席数を任意の `2..10` の整数値に書き換えできる（rule は値域内の int のみ許可、任意フィールド変更は deny）。影響範囲は新規作成画面の `seatsPerTable` 初期値のみで、卓数・賞金計算・集計には波及しない（運営者は作成時に上書き可能）。

**緩和**: organizer は元々サークルの全 CRUD を持つ信頼ロールのため、嫌がらせによる実害は無視できる。`finishedTournamentCount` と同方針で Cloud Functions 化は将来課題。

### Phase 4.16 で修復: self-* update 分岐の `affectedKeys` 抜けによる任意フィールド改竄

Phase 4.16 のエミュレータ検証で発覚し、同 phase で修復した既存の rule 設計欠陥:

`groups/{gid}` の **self-add（招待コード加入）/ self-leave / self-key memberDisplayNames update** の 3 分岐は、Phase 4.7 時点では「`name == before` / `ownerUids == before` / …」と個別フィールドの不変性をホワイトリストで列挙していたが、**ドキュメント全体の `affectedKeys` を制約していなかった**。このため Phase 4.9 で `audioSettings`、Phase 4.16 で `finishedTournamentCount` が追加された後、**任意の member が**例えば `setMemberDisplayName` の no-op を装って `audioSettings` / `finishedTournamentCount` を改竄できる経路が成立していた（self-key 分岐の `memberDisplayNames.diff().affectedKeys().hasOnly([uid])` は空集合に対して true を返すため、map 自体を変更しない write でも分岐が allow した）。

Phase 4.16 で 3 分岐すべてに `request.resource.data.diff(resource.data).affectedKeys().hasOnly([...])` を追加し、許可される変更フィールドを以下に限定（[firestore.rules](../../firestore.rules) 参照）:

- self-add: `['memberUids', 'organizerUids', 'joinCodeId', 'memberDisplayNames']`
- self-leave: `['memberUids', 'organizerUids', 'memberDisplayNames']`
- self-key memberDisplayNames update: `['memberDisplayNames']`

これにより、今後 `groups/{gid}` に新フィールドが追加されても、明示的に許可しない限り self-* 経路から改竄できない設計となる。エミュレータ検証は [scripts/test-rules-finished-count.mjs](../../scripts/test-rules-finished-count.mjs) を `firebase emulators:exec` から起動して実施する（`firebase` CLI が必要）。

### Phase 5.4 で追加: organizer による players 代理 create（同 group 内・setup 限定）

Phase 5.4 「同じ参加者で次のトーナメントを作成」のため、`tournaments/{tid}/players/{pid}` の `allow create` に **organizer-clone ブランチ**を additive で追加した（[firestore.rules](../../firestore.rules) の `match /players/{pid}` 内 `allow create`）。

経路の影響範囲:

- **トリガ**: 終了済み tournament の dashboard で organizer が `<Link href="/tournaments/{tid}/clone">` をクリック → 専用ページで参加者を選び「作成」
- **書込内容**: 新トーナメント（`state="setup"` で着地）に対する `tournaments/{newTid}/players/{uid}` の bulk setDoc。`MAX_CLONE_PLAYERS = 50` 件まで。invariant（`pid==uid` / `isBusted=false` / no seat / `isPlayingDealer=false`）は self-create と同じ
- **scope**: 親 tournament が `state="setup"` のとき限定。`isOrganizer(parent.groupId)` が必須（一般 member は不可）

**潜在リスク**: 自分が organizer であるサークルの member の `uid` を流用して、別 setup tournament に「参加してもいない player doc」を勝手に作る攻撃が成立する。被害は「参加者画面に prefill された状態で表示される」のみで、`displayName` も src tournament からのコピーであり攻撃者が自由に決められない。`isPlayingDealer=false` / no seat invariant が rule で強制されるため、PD ポジショニング DoS や席奪取は不可能。

**緩和**: organizer は元々サークル内の structures / tournaments 全 CRUD を持つ信頼ロール（[権限マトリクス](#権限マトリクス) 参照）のため、信頼境界を超えた緩和ではない。`finishedTournamentCount` / `defaultSeatsPerTable` の任意値書換と同方針で、Cloud Functions 化（`cloneTournamentWithPlayers` を Callable 化し、クライアントから直接 `players/{pid}` create を deny に戻す）は将来課題。

⚠ DRIFT WARNING: `players` schema に新フィールドを追加する場合は、self-create / organizer-clone 両ブランチに同じ invariant を反映すること。emulator validation: [scripts/test-rules-clone-players.mjs](../../scripts/test-rules-clone-players.mjs) を `npm run test:rules-clone-players` で起動。

### Phase 1 (07-third-dryrun-improvements) で追加: organizer による受付代理 create（member-proxy / name-only・受付可能 state）

Phase 1 受付代理（本人スマホ依存を回避し、運営者の手元操作だけで参加者を登録する）のため、`tournaments/{tid}/players/{pid}` の `allow create` を拡張した（[firestore.rules](../../firestore.rules) の `match /players/{pid}` 内 `allow create`）:

- **member-proxy**（旧 organizer-clone ブランチを拡張）: state 条件を `"setup"` 単独から受付可能 4 state `in ["setup", "seating", "running", "paused"]` へ拡張。organizer が開催中でもメンバーを `pid==uid` で代理 create できる。clone（Phase 5.4）は新規 setup tournament 対象のためサブセットとして動作継続。
- **name-only**（新規ブランチ）: `uid == null`・合成 pid（pid==uid を要求しない）で「名前だけ」の運営者管理専用 player を create。`isBusted=false` / no seat / `isPlayingDealer=false` invariant は self/member-proxy と同期。

経路の影響範囲:

- **トリガ**: Phase 2 UI（「参加者を追加」ダイアログ）から `addMemberPlayerByOrganizer` / `addNamedOnlyPlayerByOrganizer`（[services/proxy-receipt.ts](../../src/lib/services/proxy-receipt.ts)）を呼ぶ。Phase 1 はデータ層のみ（UI は Phase 2）
- **書込内容**: member-proxy は `upsertPlayer` 再利用（pid==uid create/merge）、name-only は `createNamedOnlyPlayer`（合成 pid・uid=null）。displayName は service で trim + ≤15 文字検証（rule では size 未強制のため service が唯一の防御）。member-proxy は加えて `memberUid ∈ group.memberUids` を service で検証する（rule は membership 未強制のため、不参加メンバー / サークル外 uid への誤作成と `finishTournament` でのシーズン戦績誤加算を service が防ぐ）
- **scope**: 受付可能 4 state 限定（finished は deny）。`isOrganizer(parent.groupId)` 必須（一般 member は不可）。late entry deadline 超過は service の受付ガードが拒否。受付可能 state / displayName / late-entry 締切の判定は通常受付（`receipt.ts`）と共有の [`services/entry-guards.ts`](../../src/lib/services/entry-guards.ts)（`assertAcceptingEntries` / `parseDisplayName`）を経由し、両経路の semantics drift を防ぐ

**潜在リスク**: service を経由せず Firestore を直接叩く organizer は、rule が membership を問わないため任意 uid string で「参加していない player doc」を作る（member-proxy）／任意名で「実在しないゲスト player」を作る（name-only）攻撃が依然成立する（通常経路は上記 service ガードで防ぐ）。被害は「参加者画面に表示される」のみで、`isPlayingDealer=false` / no seat invariant が rule で強制されるため PD ポジショニング DoS や席奪取は不可能。`uid=null` player は `finishTournament` の season 集計・`resolveRanking` で skip 済み（下流耐性あり）。

**緩和**: organizer は元々サークル内の structures / tournaments 全 CRUD を持つ信頼ロール（[権限マトリクス](#権限マトリクス) 参照）のため、信頼境界を超えた緩和ではない。`organizer-clone` と同方針で Cloud Functions 化（client から直接 `players/{pid}` create を deny に戻す）は将来課題。

⚠ DRIFT WARNING: `players` schema に新フィールドを追加する場合は、self-create / member-proxy / name-only の **3 ブランチすべて**に同じ invariant を反映すること。受付可能 4 state リテラルは `isAcceptingProxyEntry`（tournament-state.ts）と手動同期。emulator validation: [scripts/test-rules-proxy-create.mjs](../../scripts/test-rules-proxy-create.mjs) を `npm run test:rules-proxy-create` で起動。

### トーナメント QR の拡散による意図しないメンバー化（08-auto-group-join-on-entry Phase 1〜）

受付 QR（`/join/[tid]`）を知る通常アカウントは、受付するだけで当該サークルの member に
なれる。招待コードのような 129bit ランダム性は tid（base62 ≈ 117bit）にもあるが、
**QR を提示した場ではその場の全員が読み取れる**点が招待コードとの違い。

**緩和**: 「トーナメント QR はサークルに入れてよい相手にのみ提示する」運用前提を
ユーザーと合意済み（PRD の Users & Context / Decisions Log）。加えて rule 側で
受付可能 4 state に限定しているため、終了済みトーナメントの QR が後から拡散しても
加入経路にはならない。誤加入メンバーはオーナーの除名 UI（Phase 4）で事後回収する。
member ロールで加入するため、structures / tournaments への write 権限は付かない。

⚠ **この緩和は「tid が列挙できないこと」に完全に依存する**。ローカルレビュー（C-1）で、
旧 `allow list: if isSignedIn()`（`tournaments`）と旧 wildcard read（collectionGroup `players`）が
**絞り込みなしの全件列挙**を許しており、任意のログインユーザーが全 tid を取得 →
player 自作 → 任意サークルへ自己加入できる経路が成立していたことが判明したため、
同 Phase で両者の list scope を絞り込み済み
（[firebase-patterns.md](firebase-patterns.md) の「list scope の絞り込み」）。
**今後 `tournaments` / collectionGroup `players` の list 条件を緩める変更は、
本 self-add 経路の前提を直接壊す**ので、必ず本節と併せてレビューすること。

**除名との関係**（UI は [オーナーによるメンバー除外](#オーナーによるメンバー除外08-auto-group-join-on-entry-phase-4)）:
除名は運用上トーナメント終了後に行う（進行中の除名はトーナメント進行が
成り立たないため発生しない）。`hasTournamentEntryProof` は受付可能 4 state を要求するので、
finished 後はその tid が消費証明として失効し、除名は永続する。
例外は「同じサークルで**別の**トーナメントが受付可能 state にあり、除名対象者が
そちらにも player doc を持つ」ケース。同時開催しない運用でも、
**次回枠や clone で `setup` のまま放置されたトーナメント**が該当し得る点に注意
（`setup` / `seating` は late entry 締切判定の対象外なので、期限なく窓が開いたままになる）。
除名を確実に効かせたい場合は、対象者が player doc を持つ受付可能 state の
トーナメントを先に終了させる。

## 招待コード設計原則（Phase 2.5 以降）

`groupJoinCodes/{code}` による group 加入フローで遵守すること（旧 `security.md` から移管）:

- **推測困難性**: code は **Web Crypto API で生成した 128bit 以上のランダム値**を base36 / base62 等で短縮。連番・時刻ベース・UUID v1 など予測可能な方式禁止。現行実装は base36 × 25 文字 ≈ 129bit（[repositories/groupJoinCodes.ts](../../src/lib/firebase/repositories/groupJoinCodes.ts) の `CODE_LENGTH`）
- **有効期限**: `expiresAt` 必須。default 7 日・最大 30 日。期限切れコードは rule で read 拒否
- **使用回数制限**: `maxUses` / `usedCount` を持ち、`usedCount >= maxUses` のコードは rule で加入拒否
- **失効操作**: group オーナーは任意時点でコードを削除（失効）できること
- **ログ**: 加入成功・失敗イベントは `logger.info` / `logger.warn` で記録（[error-logging.md](error-logging.md) 準拠）
- **rule 側の保護**: 加入書込は `groupJoinCodes/{code}` の有効性チェックを rule に必ず含める（クライアント検証のみに依存しない）。詳細は本ファイル前半の「招待コードの rule 側検証（Phase 4.6.1）」を参照
- **再発行時の旧コード処理**（dryrun-feedback-batch-1 / Phase C.1 追加）: `generateJoinCode` service は新コード create 直後に
  `groups/{gid}.latestJoinCodeId` を新コードに update し、旧 pointer 値が指していたコードを **best-effort delete** する。
  delete 失敗（rule 拒否 / network 等）でも新コード発行は成功扱いとし、後段で `cleanup-orphan-firestore.ts` が
  expired コードを定期清掃する想定。delete の rule 権限は Phase C.1 で `isOwner` → `isOrganizer` に widening 済み
  （issue 経路と delete 経路の権限を揃える整合性向上）

## 参照

- PRD: [.claude/PRPs/01-allin-timer/prds/01-allin-timer.prd.md](../PRPs/01-allin-timer/prds/01-allin-timer.prd.md) — Implementation Phases / Phase 2.5 / Phase 4.6 / Technical Risks
- Phase 4.6 実装計画: [.claude/PRPs/01-allin-timer/plans/completed/phase-4.6-member-role-split.plan.md](../PRPs/01-allin-timer/plans/completed/phase-4.6-member-role-split.plan.md)
- Phase 2.5 ローカルレビュー記録: [.claude/PRPs/01-allin-timer/reviews/local-phase-2.5-review.md](../PRPs/01-allin-timer/reviews/local-phase-2.5-review.md) — M2 finding
- 関連ルール: [firebase-patterns.md](firebase-patterns.md) / [security-base.md](security-base.md) / [security-env.md](security-env.md)
