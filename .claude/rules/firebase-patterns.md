---
applyAlways: false
applyOnPaths:
  - "src/lib/firebase/**"
  - "firestore.rules"
  - "firestore.indexes.json"
  - "src/lib/limits.ts"
  - "scripts/test-rules-*.mjs"
  - "scripts/migrate-*.ts"
applyOnPathsExclude:
  - "**/*.test.{ts,tsx}"
---

# Firebase / Firestore 実装規約

Phase 1 で確立し、Phase 2 で zod runtime validation と repositories 層を追加した Firebase 利用パターン。以降の Phase も必ず従うこと。

## 適用範囲

- **対象**: `src/lib/firebase/**`, `firestore.rules`, `firestore.indexes.json`, `src/lib/limits.ts`, `scripts/test-rules-*.mjs`, `scripts/migrate-*.ts`
- **除外**: `**/*.test.{ts,tsx}` — repository / converter のテスト編集時は本ファイルではなく [testing.md](testing.md) の mock 境界規約を適用する
- **対象外（include に含まれない）**:
  - `src/components/**` / `src/app/**` — repositories 層**経由**で Firestore を読む消費側。SDK 直接呼出が混入する場合のみ本規約を Read する
  - `src/lib/services/**` — 同上（消費側）
- **関連 rule**: `groups/` / `groupJoinCodes` / role 設計は [group-membership.md](group-membership.md) を併読

## 初期化

- Auth / Firestore への直接アクセスは **`src/lib/firebase/client.ts` の singleton 経由のみ**
- コンポーネント・hook・ユーティリティから `initializeApp` / `getAuth` / `getFirestore` を直接呼ばない
- SSR / CSR の両方に対応した初期化ガード（`getApps().length` チェック）を singleton 側に集約
- Firebase Auth のテンプレート言語は `firebaseAuth.languageCode = "ja"` を singleton で固定

## 認証購読

- 認証状態の購読は **`useAuthUser`（`AuthProvider` 配下）経由のみ**
- `onAuthStateChanged` をコンポーネントや hook から**直接呼ばない**
- 購読の重複とメモリリーク防止のため

## Firestore アクセス

- Firestore SDK の直接呼び出し（`collection` / `doc` / `addDoc` / `getDoc` / `getDocs` / `setDoc` / `updateDoc` / `deleteDoc`）は **`src/lib/firebase/repositories/` 配下のみ**で行う
  - UI / component / hook / service 層からは repository 関数を呼ぶ
- 各 collection は **`zodConverter(schema, "collectionName")` で withConverter 適用**（`src/lib/firebase/converters.ts`）
  - schema は **ドキュメント本体**（`id` を含まない）で定義し、repository 側で `{ id: snap.id, ...snap.data() }` の形で合成して UI に返す
  - `fromFirestore` が zod の validate に失敗したら `AppError("firestore/invalid-data")` を自動 throw
- schema は `src/lib/firebase/schemas/{collection}.ts` に配置し、`BodySchema` と UI 向け `Doc`（= body + id）を双方 export
- 生の `DocumentData` を UI まで持ち込まない
- repository 関数はエラーを **必ず `AppError.from(e, "firestore/...", 日本語メッセージ)` でラップ**して throw する。呼び出し側で握りつぶさない

## repository の error wrap（Phase 4 architect-refactor 以降・推奨）

新規 repository 関数は `@/lib/firebase/wrap.ts` の `wrapFirestoreWrite` / `wrapFirestoreRead` を経由するのが**推奨**。手書き try/catch + `AppError.from` + `logger.warn` も動作上は等価だが、次回の architect-refactor で統一されるため最初から helper 経由にしておくと差分が少ない。

```ts
// 推奨形
export async function updateGroupName(gid: string, name: string): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "サークル名の更新に失敗しました",
    async () => {
      await updateDoc(groupDocRef(gid), { name });
    },
    { gid },
  );
  logger.info("group rename ok", { gid });
}
```

成功時の `logger.info` は wrap の**外**に置く（wrap は失敗時の warn のみ責任を持つ）。`runTransaction` を含む関数も tx 全体を wrap 内に納める形で対応可能（先例: `finishTournament` / `commitInitialSeating`）。

### 例外: subscribe 系 / 失敗を返却に倒す関数

以下は wrap を使わず従来形を維持する:

- `onSnapshot` 系（`subscribePlayers` / `subscribeTables` / `subscribeTournament` 等）— エラーを `onError` callback に渡す独自契約
- `templateAdmins.isTemplateAdmin` — 失敗を `false` 返却に倒す独自契約

このような関数はコメントで契約を明示する。

## 数値リミット定数の単一真実源（Phase 4 architect-refactor 以降）

数値リミット（最大卓数 / 最小・最大席数 / 既定値等）は **`src/lib/limits.ts`** に集約する。`engine.ts` / `schemas/*.ts` / `service/*.ts` / repositories / components はここから import する。

ただし `DISPLAY_NAME_MAX_LENGTH` のように **schema 寄りで意味的に group / user の表示名と密結合な定数**は
[`src/lib/firebase/schemas/group.ts`](../../src/lib/firebase/schemas/group.ts) に置き続ける（移管せずそのまま）。
drift check スクリプトは limits.ts と group.ts の両方から `export const NAME = N;` 形式で読み出す。

`firestore.rules` 内のリテラルは Cloud Firestore Security Rules の言語仕様で const 化できないためハードコードのまま、`scripts/test-rules-limits.mjs` で `limits.ts` / `schemas/group.ts` との一致を機械検査する。

現在 drift check が網羅する rule リテラルは以下:

- 卓・席まわり（limits.ts 由来）— `tableNum >= 1` / `<= MAX_TABLES (6)` /
  `seatNum >= 1` / `<= MAX_SEATS_PER_TABLE (10)` /
  `defaultSeatsPerTable >= MIN_SEATS_PER_TABLE (2)` / `<= MAX_SEATS_PER_TABLE (10)`
- displayName 上限（schemas/group.ts の `DISPLAY_NAME_MAX_LENGTH = 15` 由来、Phase A L-2 で追加）—
  `groups.memberDisplayNames[uid].size() <= 15` (× 2 箇所: self-add / self-key update) /
  `structureTemplates.createdByDisplayName.size() <= 15` /
  `seasonStats.displayName.size() <= 15`

新規リミット追加手順:

1. `src/lib/limits.ts`（または schema 密結合なら schema 側）に `export const NAME = N;` を追加
2. schema / service / component を import に切替
3. `firestore.rules` に `>= / <=` 制約を追加（必要なら）
4. `scripts/test-rules-limits.mjs` の `EXPECTED` と `checks` 配列に追加
   - `request.resource.data.<field> <op> <num>` 形式は `{ field, op, expected }` で OK
   - `lhs.size() <= N` のような複雑形は `{ pattern: /.../g, expected, minOccurrences }` を使う
   - `minOccurrences` を指定すると、想定箇所より少ない match 数のとき FAIL する（drift 削除検出）
5. `npm run test:rules-limits` で green 確認

## セキュリティルール

- **deny-by-default**（`allow read, write: if false;` から開始）
- 書込条件の基本形:
  - Phase 2 まで: `request.auth.uid == resource.data.ownerUid`（個人所有）
  - Phase 2.5 以降: `request.auth.uid in get(/databases/$(database)/documents/groups/$(resource.data.groupId)).data.memberUids`（group メンバーシップ）
- 参加者の読取は対象トーナメントドキュメントのみに限定
- **参加者ドキュメント（`tournaments/{tid}/players/{pid}`）** は以下を満たすこと:
  - create: `pid == auth.uid`、`uid == auth.uid`、`isBusted == false` 必須
  - update: 本人のみ、かつ `uid` / `isBusted` / `entryAt` / `bustedAt` は immutable（displayName のみ変更可）
  - delete: self-delete（`pid == auth.uid`）または owner-delete（親 tournament が存在し `ownerUid == auth.uid`）
- 外部ドキュメント参照（`get()`）は **`exists()` ガードと併用**し意図を明示化する
- ルール変更時は必ずエミュレータでテスト → `firebase deploy --only firestore:rules`

## 変更時のチェック

- Firestore スキーマ変更は schema（zod） / repository / security rules の **3 点を同時更新**
- 新規 collection 追加時は必ず deny ルールから書き始める
- `where("field", "==") + orderBy("other")` のクエリは Firestore 複合インデックスが必要。規模が小さい場合は **client 側ソート** を採用して index 追加を回避する設計を優先（詳細は [converters.ts](src/lib/firebase/converters.ts) / `repositories/*.ts` の `listMyXxx` パターン参照）

## 単一フィールド単独書換の rule 経路（Phase 4.16 以降の polish 系列）

`groups/{gid}` に additive で追加された数値フィールドは、書込経路を 1〜2 系統に限定し、rule 側でも `affectedKeys().hasOnly([...])` + 値域制約で他フィールド汚染を deny する設計を踏襲する。新フィールドを追加する場合も同パターンで実装すること（[firestore.rules](../../firestore.rules) の groups update 末尾分岐参照）。

### `finishedTournamentCount`（終了トーナメント累計数）

更新経路は**以下 2 系統に限定**する:

- 自動 +1 — `finishTournament()` の `runTransaction + increment(1)`（[repositories/tournaments.ts](../../src/lib/firebase/repositories/tournaments.ts)）。tx 内で `state !== "finished"` を再 read し、複数端末同時呼び出しでも二重 increment しない
- 手動修正 — `setFinishedTournamentCount({ gid, uid, value })`（service） → `updateFinishedTournamentCount(gid, value)`（repository）

rule: `isOrganizer(gid) + affectedKeys().hasOnly(['finishedTournamentCount']) + is int + >= 0`

### `defaultSeatsPerTable`（新規作成画面の席数初期値、Phase 4.17）

更新経路は**以下 1 系統に限定**する:

- 手動更新 — `setDefaultSeatsPerTable({ gid, uid, value })`（service） → `updateDefaultSeatsPerTable(gid, value)`（repository）。サークル詳細画面の inline edit からのみ呼ばれる

rule: `isOrganizer(gid) + affectedKeys().hasOnly(['defaultSeatsPerTable']) + is int + >= 2 + <= 10`

⚠ DRIFT WARNING: 上限 10 は `firestore.rules` の `players seatNum <= 10` および [tournament.ts](../../src/lib/firebase/schemas/tournament.ts) の `seatsPerTable.max(10)` と連動。同時に変更すること。drift 検出方法は前述の「数値リミット定数の単一真実源」セクション参照。

### `players.isPlayingDealer`（PD フラグ、Phase 5.1）

`tournaments/{tid}/players/{pid}` 上の単独 bool フィールド。1 卓 1 PD 制約は service tx + UI disabled の二重防御（rule 側では bool 型のみ enforce、卓内ユニーク性は rule で表現困難）。

更新経路は**以下 3 系統に限定**する:

- 手動 ON/OFF — `setIsPlayingDealer(tid, uid, gids, pid, value, tablePlayerIds)`（[orchestrator.ts](../../src/lib/services/seating/orchestrator.ts)）の runTransaction。同卓内 rotation を atomic に commit
- 自動 OFF（bust 時） — `bustPlayer(tid, pid, sameTablePlayerIds)`（[repositories/players.ts](../../src/lib/firebase/repositories/players.ts)）の writeBatch で当該 player + 同卓全員の isPlayingDealer を false に倒す
- 自動 OFF（テーブル閉鎖時） — `applyTableBreak`（orchestrator）の tx 内で閉鎖卓 player の isPlayingDealer を false に倒す（移動先での PD 衝突予防）

rule: `players/{pid}` update branches に additive 拡張のみ:
- self 経路: `request.resource.data.get('isPlayingDealer', false) == resource.data.get('isPlayingDealer', false)`（self は immutable）
- organizer 経路: `request.resource.data.get('isPlayingDealer', false) is bool`（型のみ強制）

⚠ DRIFT WARNING: `players` への新フィールド追加は schema (`schemas/player.ts`) / rule (`firestore.rules` players update branches) / service (`orchestrator.ts` setIsPlayingDealer 等) / UI (SeatingBoard / PlayerList の PD checkbox) の 4 点同時更新が必要。emulator validation script は [scripts/test-rules-pd.mjs](../../scripts/test-rules-pd.mjs)。

### `players/{pid}` の create rule 経路（Phase 5.4 以降）

`tournaments/{tid}/players/{pid}` の `allow create` は **2 系統の OR で分岐**する:

| ブランチ | 条件 | 用途 |
| --- | --- | --- |
| **self-create** | `pid == auth.uid` かつ `request.resource.data.uid == auth.uid` | 通常の受付フロー（`/join/[tid]` で参加者本人が登録） |
| **organizer-clone** | 親 tournament が `exists` かつ `isOrganizer(parent.groupId)` かつ `parent.state == "setup"` かつ `pid == request.resource.data.uid` | Phase 5.4 「同じ参加者で次のトーナメントを作成」（運営者が代理 create） |

両ブランチで共通の invariant:

- `pid == request.resource.data.uid`（pid==uid invariant — `assignSeat` / `bustPlayer` 等の self-key 比較を多用する update rule の前提）
- `isBusted == false`
- `tableNum == null` / `seatNum == null`（no seat invariant — 配席は別 update 経路）
- `isPlayingDealer == false`（`.get('isPlayingDealer', false) == false`）

書込経路:

- self-create — `upsertPlayer(tid, uid, { displayName })`（[repositories/players.ts](../../src/lib/firebase/repositories/players.ts)）
- organizer-clone — `clonePlayersFromTournament(srcTid, destTid, selectedPlayerIds)`（同 file）の `writeBatch + setDoc`。1 回の clone で `MAX_CLONE_PLAYERS = 50` 件まで。orchestrator は [`tournament-clone.ts`](../../src/lib/services/tournament-clone.ts) の `cloneTournamentWithPlayers`

⚠ DRIFT WARNING: `players` schema への新フィールド追加時は **両ブランチの invariant** に同時反映すること。片方だけ追加すると、organizer-clone 経路で「self では弾かれる値が clone 経由で混入する」抜け道が成立する。emulator validation: [scripts/test-rules-clone-players.mjs](../../scripts/test-rules-clone-players.mjs) を `npm run test:rules-clone-players` で起動（`firebase emulators:exec` 同梱）。

### `tournaments/{tid}` / `groups/{gid}` 配下 subcollection の rule 設計原則（Phase 5.4 以降・重要、Phase A で `groups/{gid}` 配下にも適用拡大）

**原則**: 親 doc 配下の subcollection は **specific rule の積み上げ** で書く。
`match /{sub=**}` のような再帰ワイルドカードは **使ってはいけない**。
本原則は `tournaments/{tid}` 配下で確立され、Phase A で `groups/{gid}` 配下（`seasonStats` /
`seasonHistory`）にも明示的に拡張した。

**理由**: Phase 5.4 で発見した pre-existing バグ — 旧 wildcard `match /tournaments/{tid}/{sub=**}` が
explicit な `match /players/{pid}` と同時に評価され、Firestore Rules の **OR 評価**により
「より緩い wildcard 側がそのまま allow を返す」 → Phase 4 organizer-update / Phase 5.1 PD /
Phase 5.4 organizer-clone の strict invariants を**全て bypass**する穴があった
（emulator validator のケース 3〜6 で deny を期待して 200 が返って発覚。詳細は
[Phase 5.4 実装レポート](../PRPs/01-allin-timer/reports/phase-5.4-clone-tournament-with-players-report.md) の
「Pre-existing rule bug の修正」節）。

**現状の subcollection rule**:

`match /tournaments/{tid}` 配下:

| Path | 許可 |
| --- | --- |
| `match /players/{pid}` | explicit、4 ブランチ（self-create / organizer-clone / self-update / organizer-update）。Phase 1 (04-spectate-mode) で **read 経路に親 tournament の `spectateEnabled == true` 分岐を OR 追加**（write 経路は据え置き、観戦は read-only） |
| `match /tables/{tableId}` | explicit、organizer のみ書込可。Phase C で `allow write` を `allow create / update / delete` に分割し、update は「label / color に触れない経路」と「`affectedKeys.hasOnly(['label', 'color'])` で `label.size() <= TABLE_LABEL_MAX_LENGTH` / `color matches /^#[0-9a-fA-F]{6}$/` を強制する経路」の OR で構成。Phase 1 (04-spectate-mode) で **read 経路に同じ `spectateEnabled == true` 分岐を OR 追加** |

加えて `match /tournaments/{tid}` 自体（subcollection ではなくドキュメント本体）も Phase 1 (04-spectate-mode) で
拡張済み:

- `allow read` は **`allow get` + `allow list` に明示分割**:
  - `allow get: if isSignedIn() || resource.data.get('spectateEnabled', false) == true`（unauthenticated GET を OR で開放）
  - `allow list: if isSignedIn()`（既存の signed-in 経由 list は維持。**anon の collection 列挙は deny**）
  - 分割理由: `allow read` 複合形のままだと anon が `where("spectateEnabled", "==", true)` で公開中の全 tournament を
    列挙できる discovery 経路が成立する。tid base62 の推測困難性（≈117bit）は GET の防御にしか効かないため、
    LIST 経由 discovery を `groupJoinCodes` と同方針で deny する（defense-in-depth）
- `allow update` は既存 organizer 経路に加え、`affectedKeys.hasOnly(['spectateEnabled', 'updatedAt']) + is bool` の
  単独書換ブランチを additive 追加（経路 A は経路 B を包含するため行動上 redundant だが、`groups/{gid}` の単独
  フィールド書換 rule（finishedTournamentCount / defaultSeatsPerTable / seasonStartDate / defaultTableLabels /
  seasonPointsRule）と設計を揃えるための足場）
- 旧 `allow update, delete` の合体行を分割し、`allow delete` を独立行に（rule 分割の回帰確認は emulator
  validator のケース 14）
- emulator validator: [scripts/test-rules-spectate.mjs](../../scripts/test-rules-spectate.mjs)（`npm run test:rules-spectate`）
  — read allow / deny / write 経路据え置き / delete 回帰 / **anon list deny + signed-in list 維持** までを 16 ケースで網羅
- collectionGroup wildcard `match /{path=**}/players/{pid}` は **触らない**（`/spectate/[tid]` ページは
  path-specific rule 経由でしか read しない設計のため、観戦経路で wildcard を緩める必要がない）

`match /groups/{gid}` 配下（Phase A で追加）:

| Path | 許可 |
| --- | --- |
| `match /seasonStats/{uid}` | read: group メンバー全員 / write: organizer + 数値非負 + uid==docId / delete: organizer（reset 経路）。書込経路は `finishTournament` tx と `startNewSeason` tx の 2 系統 |
| `match /seasonHistory/{seasonId}` | read: group メンバー全員 / create: organizer のみ + endedAt timestamp + entries list / update-delete: 禁止（履歴改竄を rule で deny） |

**新規 subcollection を追加する手順**:

1. `match /tournaments/{tid}/{collection}/{docId}` で explicit rule を 1 つ追加（read 条件と write 条件を別々に書く）
2. nested subcollection があれば同様に explicit（`match /tables/{n}/seats/{m}` 等）
3. emulator validator を 1 本追加し「想定外 path / 想定外 invariant 違反 write が deny される」ケースを必ず含める
4. **wildcard 復活は厳禁** — wildcard を 1 行追加すると explicit rule の strict invariants が即座に bypass される

⚠ DRIFT WARNING: 上記設計原則に違反する rule を追加すると、Phase 4 / 5.1 / 5.4 の invariants が再び形骸化する。code review で `match /{...=**}` パターンが入っていないかを必ず確認すること。

### `groups/{gid}` update の allowed-keys 一覧（Phase 4 architect-refactor 以降）

`firestore.rules` の `groups/{gid}` `allow update` は 9 ブランチに分かれており（Phase A で 1 ブランチ / Phase C で 1 ブランチ / Phase E で 1 ブランチ追加）、各ブランチで `affectedKeys().hasOnly([...])` を別々に列挙している。新規フィールド追加時の見落とし（Phase 4.16 で発覚した self-* 分岐の `affectedKeys` 抜け型のバグ）を防ぐため、ブランチごとに許可するキーを表で一元化する:

| ブランチ | 条件 | 許可される変更キー（`affectedKeys().hasOnly`） |
| --- | --- | --- |
| **owner-update** | owner 全権 | （上限なし。ただし `ownerUids.size >= 1` / `createdAt` 不変は強制） |
| **self-add**（招待コード加入） | 非メンバー + 有効な joinCodeId | `memberUids` / `organizerUids` / `joinCodeId` / `memberDisplayNames` |
| **self-leave**（脱退） | メンバー + 非 owner | `memberUids` / `organizerUids` / `memberDisplayNames` |
| **self-key memberDisplayNames update** | 既メンバー | `memberDisplayNames`（自身の uid キーのみ） |
| **audioSettings update** | organizer | `audioSettings` |
| **finishedTournamentCount update** | organizer | `finishedTournamentCount` |
| **defaultSeatsPerTable update** | organizer | `defaultSeatsPerTable` |
| **seasonStartDate update**（Phase A） | organizer | `seasonStartDate`（`is timestamp`） |
| **defaultTableLabels update**（Phase C） | organizer | `defaultTableLabels`（`is list` + `size() <= 6`、各要素 string 長は service / schema 側で enforce） |
| **seasonPointsRule update**（Phase E） | organizer | `seasonPointsRule`（`null` または `is map` + `base.size() 1..9` + `baseline 2..10`、各要素 `>= 0 number` は schema / service 側で enforce） |

新規フィールドを `groups/{gid}` に追加する場合の手順:

1. zod schema (`schemas/group.ts`) にフィールドを additive で追加（既存 doc に default を流す）
2. 必要な書込経路を決定し、上表に「どのブランチが新フィールドを許可すべきか」を追記
3. `firestore.rules` 該当ブランチの `affectedKeys().hasOnly([...])` に新キーを追加
4. 他のブランチでは新キーが含まれないため、それらの経路から触れないことが自動的に保証される
5. emulator validation スクリプト（[scripts/test-rules-finished-count.mjs](../../scripts/test-rules-finished-count.mjs) / [scripts/test-rules-default-seats.mjs](../../scripts/test-rules-default-seats.mjs) / [scripts/test-rules-season.mjs](../../scripts/test-rules-season.mjs) を雛形）に新フィールドの allow / deny ケースを追加し、`firebase emulators:exec` で検証

`affectedKeys` 列挙を逆算する（rule 側だけ更新して schema を忘れる）と、書込パスの矛盾で動作不能になりやすい。表 → schema → rule → test の順で更新すること。

## Phase 2.5 以降の注意: `get()` による参照は rule read を消費

- Security rule 内の `get(/documents/...)` は **1 回の評価につき Firestore の読取クォータを 1 件消費**する
- 同一トランザクションでの連続書込やリアルタイム購読（`onSnapshot`）の接続時に毎回評価される
- 対策:
  - rule 内でメンバーシップ判定に使う path は**同じ document を参照**するよう統一し、Firebase の rule 内 cache を活かす
  - 可能なら書込時に `request.auth.uid` と `resource.data.memberUids`（冗長フィールド）を突き合わせる設計も検討
  - 20 人 × 月 1〜2 回規模では総量的に問題は出ないが、UI 側で無駄な re-subscribe を避ける
- group ベース権限モデルの全容は [group-membership.md](group-membership.md) を参照

## Structure Templates / templateAdmins 運用（Phase 4.8 以降）

サークル横断の `structureTemplates/{tid}` コレクションと、そのクリーンアップ権限を持つ
`templateAdmins/{uid}` コレクションの運用規約（旧 `security.md` から移管）。

### 匿名ユーザー除外（read / create）

`structureTemplates` の `read` / `create` は **通常アカウント（Google / メール / メールリンク）限定**とし、匿名ユーザー（`signInAnonymously`）は rule で deny する。

- **rule 側**: [firestore.rules](../../firestore.rules) の `isSignedInNotAnon()`（`token.firebase.sign_in_provider != 'anonymous'`）で判定
- **UI 側**: `RequireAuth(allowAnonymous=false)` でも同じ gate をかけており、二重防御
- **理由**:
  - `createdByDisplayName` の信頼性担保（匿名は表示名を持たない）
  - description に運用者が誤ってサークル固有事情を書いたとき、`/join/[tid]` 経由の匿名ゲストへ read 経路を空けておかない

更新 / 削除は作成者本人または管理者に限定されており、匿名で create できない以上 update / delete 経路から匿名が漏れることはない。

### テンプレート管理者（`templateAdmins/{uid}`）

作成者脱会後のテンプレ整理のために導入したグローバル役割。`templateAdmins/{uid}` の doc 存在自体が管理者を示すマーカー。

- **read**: `allow get: if request.auth.uid == uid` のみ。`allow list: if false` で **管理者一覧の列挙を明示的に禁止**（`groupJoinCodes` と同方針）
- **write**: `allow create, delete: if isTemplateAdmin()` で既存管理者からの操作のみ許可。`allow update: if false`（空 doc のため更新不要）
- **Bootstrap 制約**: rule が既存管理者の存在を前提とするため、**最初の 1 人目は Firestore Console で手動 seed が必須**（chicken-and-egg 回避）。手順は README の「Phase 4.8: テンプレート管理者の bootstrap」参照
- **最後の 1 人の保護**: 管理者が 0 人になると自力復旧不可（Console で再 seed するしかない）。本 Phase では grant / revoke の UI を提供しないため事故リスクは低いが、将来 UI 化する際は「最後の 1 人の self-revoke 禁止」を rule か Callable で実装すること
- **`createdByDisplayName` snapshot**: `users/{uid}` が self-only read のため、テンプレ一覧で他人の作成者名を表示できない制約がある。対策として `structureTemplates` doc に `createdByDisplayName` を snapshot で保存（rename 追従は仕様として放棄）
