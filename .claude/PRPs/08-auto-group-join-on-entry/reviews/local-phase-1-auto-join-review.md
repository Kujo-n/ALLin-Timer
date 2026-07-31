# ローカルレビュー: 08-auto-group-join-on-entry Phase 1（自動所属 データ層）

**レビュー日**: 2026-07-31
**対象**: 未コミット変更（`feture/auto-group-join` ブランチ）
**判定**: **APPROVE**（全 CRITICAL / HIGH 解消済み。deploy 待ち）

| # | 内容 | 状態 |
| --- | --- | --- |
| C-1 | tid 列挙により任意サークルへ自己加入できる | **対応済み**（案 (b) を採用し `tournaments` / collectionGroup `players` の list scope を絞り込み） |
| H-1 | 除名が進行中は巻き戻る | **クローズ**（ユーザー判断: 進行中の除名は運用上ありえない） |
| M-1 | repository unit test 不足 | **対応済み**（`groups.test.ts` に 10 ケース追加） |
| M-2 | 正常系で warn ログが出る | **対応済み**（`getGroupIfMember` 追加・probe を切替） |
| L-1〜3 | doc コメント / 擬似コード / currentUser 依存 | L-1 は M-2 対応時に解消。L-2 / L-3 は未対応 |

## サマリ

rule 新ブランチ・schema・service・emulator validator の作り込みは既存規約（`affectedKeys().hasOnly` 列挙 / wildcard 厳禁 / `wrapFirestoreWrite` 経由 / DRIFT WARNING 同期 / drift check の `minOccurrences` 更新）を丁寧に踏襲しており、実装品質そのものは高い。unit 11 件・emulator 16 件も適切な deny ケースを押さえている。

ただし **新 self-add ブランチの安全性が「tid は QR を見た人しか知り得ない」という前提に依存している**のに対し、`tournaments` の `allow list: if isSignedIn()`（既存）によって **tid は全ログインユーザーが列挙可能**である。この 2 つが噛み合うと「ログイン済みユーザーなら任意のサークルにメンバーとして自己加入できる」経路が成立するため、本 Phase を本番 deploy する前に discovery 経路を塞ぐ必要がある。

---

## Findings

### CRITICAL

#### C-1. `tournaments` の list 開放により、任意のログインユーザーが任意のサークルへ自己加入できる

**該当**: [firestore.rules:83-89](../../../../firestore.rules#L83-L89)（`hasTournamentEntryProof`）/ [firestore.rules:153-190](../../../../firestore.rules#L153-L190)（新 self-add ブランチ）/ [firestore.rules:563](../../../../firestore.rules#L563)（既存 `allow list`）/ [firestore.rules:621-630](../../../../firestore.rules#L621-L630)（players self-create）

**攻撃手順**（すべて公開 SDK の標準 API のみで成立）:

1. 任意の通常アカウントでログインし `getDocs(collection(db, "tournaments"))` を実行する。
   `allow list: if isSignedIn()` は `resource` を参照しないため、**クエリ絞り込みなしの全件列挙が rule で許可される**。
   これで全サークルの `tid` / `groupId` / `state` が手に入る。
2. `state` が受付可能 4 state のいずれかである tid を 1 つ選び、
   `setDoc(doc(db, "tournaments/{tid}/players/{myUid}"), {...})` を実行する。
   players の self-create ブランチは `pid == auth.uid` / `uid == auth.uid` / `isBusted == false` /
   no seat / no PD しか要求せず、**親 tournament の exists・state・group メンバーシップを一切問わない**。
3. `updateDoc(doc(db, "groups/{groupId}"), { memberUids: arrayUnion(myUid), joinedViaTournamentId: tid, "memberDisplayNames.myUid": "x" })`
   を実行する。新ブランチの条件（非匿名 / 非メンバー / +1 / proof）をすべて満たすため **allow される**。

**影響**: 加入後は member ロールとして
`groups/{gid}`（サークル名・全メンバーの uid と表示名）、`groups/{gid}/seasonStats/*`（全メンバーの戦績と表示名）、
`seasonHistory/*`、`structures/*`、当該サークルの全 `tournaments` を read できる。
サークル固有情報（実名に近い表示名を含む）が第三者に露出するため、
[security-base.md](../../../rules/security-base.md) の「サークル固有データ」保護方針に直接抵触する。

**PRD の想定との差分**: PRD の Technical Risks は本件を
「トーナメント QR の拡散で意図しない人物がメンバー化 / Likelihood **L** / 運用前提で緩和」
と評価している。この評価は「tid は QR 提示の場にいた人しか知らない（base62 ≈ 117bit で推測困難）」
が前提だが、`allow list` により **推測ではなく列挙で取得できる**ため前提が成立していない。
実際、案 B（招待コードを tournament doc に埋める）を却下した理由が「`tournaments/{tid}` は
観戦モード ON で anon read 可能だから招待コードが漏れる」であり、
tournament doc の read 面の広さは PRD 自身が認識している。その広さが今回 proof 側に効いてしまっている。

**補足（もう 1 つの discovery 経路）**: 仮に `tournaments` の list を閉じても、
[firestore.rules:800-802](../../../../firestore.rules#L800-L802) の
`match /{path=**}/players/{pid} { allow read: if isSignedIn(); }` により
`collectionGroup("players")` の無絞り込みクエリで全 player doc（= 全 tid をパスに含む）が読める。
tid の秘匿性に依存する設計を採るなら、こちらも同時に塞ぐ必要がある。

**修正案**（いずれか、または組合せ）:

- **(a) 推奨: proof を列挙不能な値にする** — `tournaments/{tid}` に QR にのみ載せる
  短命ランダム `entryToken`（招待コードと同じ 128bit 級）を持たせ、
  `hasTournamentEntryProof` で `request.resource.data.joinedViaTournamentEntryToken ==
  get(tournaments/{tid}).data.entryToken` を検証する。
  「QR を見せた相手だけが加入できる」という PRD の意図をそのまま rule に落とせる。
  ただし tournament doc は観戦モード ON で anon read 可能なため、**token を tournament doc 本体に
  平置きしない**（別 doc に切る／観戦公開時に読めないパスへ置く）設計が必須。
- **(b) discovery 経路を閉じる** — `tournaments` の `allow list` を
  `isSignedIn() && isGroupMember(resource.data.groupId)` に狭め、
  `match /{path=**}/players/{pid}` の read も `uid == request.auth.uid` 相当に絞る。
  既存クエリはすべて `where("groupId","==",gid)` / `where("uid","==",myUid)` 形なので
  アプリ側の改修は不要だが、doc あたり `get()` が増える read コストを見積もること。
- **(c) 単独では不十分だが併用推奨** — players の self-create に
  `exists(parent)` + 受付可能 state ガードを追加する。攻撃手順 2 のコストは上がるが
  (1)(3) は塞げないため、これだけで CRITICAL は解消しない。

**判断が必要な点**: (a) は PRD の設計（QR 提示 = 加入許可）に忠実、(b) は影響範囲が広い代わりに
根本的。どちらを採るかは Phase 2 の受付フロー実装前に確定させたい。

#### C-1 補足: 案 (b) の read コスト実測（Firestore エミュレータ）

一時的な experiment rules（`allow list: if isSignedIn() && isGroupMember(resource.data.groupId)` /
`match /{path=**}/players/{pid}` を `resource.data.uid == request.auth.uid` に）を当てて、
REST `:runQuery` で実測した結果:

| ケース | 結果 |
| --- | --- |
| 同一 group の tournament **15 件**を `where("groupId","==",gid)` で取得 | **200 / 15 件返却** |
| 非メンバー group を `where` 指定 | 403 |
| 無絞り込みの全件列挙（攻撃者の discovery 経路） | 403 `Property groupId is undefined on object` |
| 自分がメンバーの group 6 件を跨ぐ無絞り込み列挙 | 403（同上） |
| collectionGroup `players` を `where("uid","==",me)` で取得 | **200 / 6 件返却** |
| collectionGroup `players` の無絞り込み列挙 | 403 `Property uid is undefined on object` |

**結論: list の rule はクエリ 1 回につき 1 度、クエリの制約から導いた `resource` に対して評価される**
（返却 doc ごとではない）。403 のメッセージが「制約が無いのでフィールド値が未定義」である点、
および 15 件返却が **10 access call 上限**（[Firebase 公式](https://firebase.google.com/docs/firestore/security/rules-conditions):
「10 for single-document requests and query requests」）に当たらない点が根拠。

したがってコスト増分は:

| 経路 | 増分 |
| --- | --- |
| `tournaments` の list（`listTournamentsByGroup` / `subscribeTournamentsByGroup`） | **クエリ 1 回あたり +1〜2 read**（`exists` + `get` を同一 `groups/{gid}` に発行。件数に比例しない） |
| collectionGroup `players`（`subscribePlayersByUid`） | **+0 read**（外部 doc 参照なし。`resource.data.uid` を見るだけ） |

実運用での総量見積り（20 人 / 6 卓 / 月 1〜2 回）:

- 一覧画面の `listTournamentsByGroup`: 表示のたびに +1〜2
- `subscribeTournamentsByGroup` は [PrimaryNav.tsx:61](../../../../src/components/nav/PrimaryNav.tsx#L61) で
  **全ページに常時マウント**される listener。tournament doc はレベル進行・一時停止/再開・state 遷移で
  1 イベントあたりおよそ 20〜50 回書き換わるため、20 端末 × 40 更新 ≈ 800 回の再評価
  → **1 イベントあたり +800〜1,600 read**（listener がスナップショット配信のたびに再評価される最悪ケース）
- 月 2 イベントで **月あたり +3,000 read 程度**。無料枠 50,000 read/日 に対して **1 日分の約 0.1%**

**費用面では実質無視できる**。判断材料になるのはむしろ次の 2 点:

- アプリ側のクエリは既に全て `where` で絞られている（[tournaments.ts:205](../../../../src/lib/firebase/repositories/tournaments.ts#L205) /
  [:925](../../../../src/lib/firebase/repositories/tournaments.ts#L925) / [playersByUid.ts:35](../../../../src/lib/firebase/repositories/playersByUid.ts#L35)）ため、
  **クライアント改修は不要**（実測ケース 1・5 で確認済み）
- 一方で「今後 `where` 無しの list を書くと即 403」になる制約が入る。
  観戦モードなど anon 経路の list を将来足す場合は設計時に考慮が要る

#### C-1 対応内容（案 (b) を採用・2026-07-31）

ユーザー判断により **案 (b)（list を絞る）** を採用。以下を実施:

| 変更 | before | after |
| --- | --- | --- |
| [firestore.rules](../../../../firestore.rules) `match /tournaments/{tid}` | `allow list: if isSignedIn()` | `allow list: if isGroupMember(resource.data.groupId)` |
| [firestore.rules](../../../../firestore.rules) `match /{path=**}/players/{pid}` | `allow read: if isSignedIn()` | `allow read: if isSignedIn() && resource.data.uid == request.auth.uid` |

- **アプリ側の改修はゼロ**。既存クエリは全て `where` で絞られているため
  （`listTournamentsByGroup` / `subscribeTournamentsByGroup` は `where("groupId","==",gid)`、
  `subscribePlayersByUid` は `where("uid","==",uid)`）
- **path-specific な read は影響なし**。Firestore は match した rule の **OR** で判定するため、
  `subscribePlayers(tid)`（subcollection list）と観戦モードの anon read は
  `match /tournaments/{tid}/players/{pid}` 側で allow されたまま（validator ケース 9 / spectate 1〜8 で確認）
- 新規 validator [scripts/test-rules-list-scope.mjs](../../../../scripts/test-rules-list-scope.mjs)
  （`npm run test:rules-list-scope`）を追加し **9/9 ALL GREEN**:

  | ケース | 結果 |
  | --- | --- |
  | (1) member が `where(groupId==gid)` で list（15 件） | allow |
  | (2) member が絞り込みなしで全件列挙 | **deny** |
  | (3) 非メンバーが他サークルの gid を明示して list | **deny** |
  | (4) anon が絞り込みなしで list | **deny** |
  | (5) 15 件返却が 10 access call 上限に当たらない | allow（(1) で担保） |
  | (6) collectionGroup `where(uid==self)` | allow |
  | (7) collectionGroup 絞り込みなし列挙 | **deny** |
  | (8) collectionGroup `where(uid==他人)` | **deny** |
  | (9) `tournaments/{tid}/players` の subcollection list | allow（OR 評価の非回帰） |

- [test-rules-spectate.mjs](../../../../scripts/test-rules-spectate.mjs) のケース 16 / 18 は
  **意図的に allow → deny へ反転**（旧仕様「signed-in の無絞り込み list は維持」がまさに塞いだ穴）。
  絞り込み付きの allow 回帰は list-scope validator 側が担当する形に整理
- 規約反映: [firebase-patterns.md](../../../rules/firebase-patterns.md) に
  「list scope の絞り込み」節を新設（**`allow list` に `resource` を参照しない条件を書くと
  絞り込みなし全件列挙が通る**という一般原則 + 現在の設定表 + Firestore の list 評価モデル +
  DRIFT WARNING）。[group-membership.md](../../../rules/group-membership.md) の
  「トーナメント QR の拡散」節にも「この緩和は tid が列挙できないことに完全に依存する」旨を追記

---

### HIGH（クローズ）

#### H-1. 除名（Phase 4）が「進行中トーナメントの間は無効化される」— **クローズ**

> **ユーザー判断（2026-07-31）**: 「トーナメント参加者をトーナメント進行中に除名することはありえない。
> 進行が成り立たなくなる」。除名は必ずトーナメント終了後に行う運用のため、本指摘は成立しない。
>
> この運用前提は rule 側と整合している。`hasTournamentEntryProof` は
> `state in ["setup","seating","running","paused"]` を要求するため、**トーナメントが finished に
> なった時点でその tid は消費証明として失効する**。「終了後に除名」であれば同じ tid での再加入は
> rule で deny され、除名は永続する。
>
> 残る条件は「同じサークルで**別の**トーナメントが受付可能 state にあり、かつ除名対象者が
> そちらにも player doc を持っている」場合のみ。同時開催しない運用であれば発生しない。
> Phase 4 の除名 UI を作る際、この前提を plan にコメントとして残しておくとよい。

<details>
<summary>元の指摘内容（記録として保持）</summary>

**該当**: [firestore.rules:83-89](../../../../firestore.rules#L83-L89) / PRD の Risk 表「除名 UI（Phase 4）で事後回収」

`hasTournamentEntryProof` の消費証明は `players/{auth.uid}` の**存在**であり、
除名しても player doc は残る。したがって:

- オーナーが誤加入メンバーを除名しても、当該ユーザーは同じ update を再送するだけで**即座に再加入できる**
  （トーナメントが受付可能 4 state の間ずっと）。
- Phase 2 で受付操作のたびに自動所属を呼ぶ設計のため、**除名された本人が意図せず自動再加入する**
  ケースも起きる（PRD 上「次回受付で自己修復」と書かれた挙動が、除名に対しては巻き戻しとして働く）。

C-1 の緩和策として PRD が挙げる「除名 UI での事後回収」が、進行中は機能しないことになる。

**修正案**:

- 除名 service が `players/{uid}` の delete も併せて行う
  （organizer は [firestore.rules:711-718](../../../../firestore.rules#L711-L718) で delete 可能）。
  ただしトーナメント進行中の player 削除は席・戦績への影響があるため、
  「終了後に除名」運用に倒すか、削除ではなく下記のフラグ方式にするか要判断。
- または `groups/{gid}` に `removedUids`（denylist）を持たせ、
  新ブランチに `!(request.auth.uid in resource.data.get('removedUids', []))` を追加する。
  rule 変更が 1 行で済み、進行中の席・戦績に触らない点で扱いやすい。

Phase 4 の plan を書く前に方針を決めておくこと。

</details>

---

### MEDIUM（対応済み）

#### M-1. `addSelfViaTournamentEntry` の repository 層 unit test が無い

**該当**: [src/lib/firebase/repositories/groups.ts:232-274](../../../../src/lib/firebase/repositories/groups.ts#L232-L274) / `groups.test.ts`（未変更）

[testing.md](../../../rules/testing.md) の「レイヤごとの責務」では repository 層は
「Firestore SDK 呼出形 + AppError ラップ」を unit で固定する規約だが、
`groups.test.ts` に本関数の describe が無く、以下が未検証:

- `updateDoc` のペイロード形（`arrayUnion(uid)` / `joinedViaTournamentId` /
  `memberDisplayNames.${uid}` の dot-path）— **rule の `affectedKeys().hasOnly` と直結する形**
  なので、ここが崩れると即 permission-denied になる
- `validation/display-name-required` / `validation/display-name-too-long` の 2 分岐
- `wrapFirestoreWrite` による `firestore/write_failed` ラップ

service 側の test はこの関数を丸ごと mock しているため、上記は現状どのテストでも触れられていない。
`updateFinishedTournamentCount` / `removeMemberSelf` の既存 describe を雛形に追加すること。

**✅ 対応済み**: [groups.test.ts](../../../../src/lib/firebase/repositories/groups.test.ts) に
`describe("addSelfViaTournamentEntry ...")` を追加（6 ケース）。

- `updateDoc` の payload が `{ memberUids: arrayUnion(uid), joinedViaTournamentId, "memberDisplayNames.<uid>" }`
  の **3 キーちょうど**であることを `toEqual` で固定（`toMatchObject` にすると
  rule の `affectedKeys().hasOnly` を壊す 4 キー目の混入を検知できない）
- trim / 空文字 / 16 字 deny / **15 字ちょうど allow**（境界）/ `firestore/write_failed` ラップ
- `firebase/firestore` mock に `arrayUnion` を追加

#### M-2. 正常系（初回加入）で `logger.warn` が必ず 1 本出る

**該当**: [src/lib/services/auto-group-join.ts:82-94](../../../../src/lib/services/auto-group-join.ts#L82-L94)

`probeMembership` は `getGroup` の失敗を「非メンバー」の判定シグナルとして使う設計だが、
`getGroup` は `wrapFirestoreRead` 経由のため、**呼び出しの時点で
`logger.warn("サークル取得に失敗しました", { code: "firestore/read_failed", gid })` が出力済み**。
service 側で `logger.debug` に落としても warn は取り消せない。

Phase 2 で受付のたびに呼ばれると、**新規参加者 1 人につき warn 1 本**が本番ログ（Vercel は info 以上を出力）に
積み上がる。[error-logging.md](../../../rules/error-logging.md) のレベル使い分け（warn = 異常）に照らして誤解を招く。

**修正案**: 「メンバーでなければ null を返す」read 用 repository 関数
（例 `tryGetGroup(gid): Promise<GroupDoc | null>` — permission-denied は warn せず `null`、
それ以外のエラーは従来どおり warn + throw）を追加し、probe はこちらを使う。
`templateAdmins.isTemplateAdmin` が「失敗を返却に倒す」既存の先例として
[firebase-patterns.md](../../../rules/firebase-patterns.md) に登録済みなので、同じ契約コメントを付ければ規約内に収まる。

**✅ 対応済み**: `getGroupIfMember(gid): Promise<GroupDoc | null>` を
[groups.ts](../../../../src/lib/firebase/repositories/groups.ts) に追加し、`probeMembership` を切替。

- permission-denied → `logger.debug` + `null`（**warn なし**）／doc 不在 → `null`
- それ以外（ネットワーク / schema 不整合）→ 従来どおり `logger.warn` + `firestore/read_failed` throw
- `getGroup`（wrap 経由）は他の callsite のためそのまま残す。
  使い分けは [firebase-patterns.md](../../../rules/firebase-patterns.md) の
  「例外: subscribe 系 / 失敗を返却に倒す関数」に追記し、判断基準
  （**その失敗が正常系として頻繁に起きるか**）も明文化した
- repository test 4 ケース（read 成功 / doc 不在 / **denied で warn が呼ばれないこと** /
  想定外エラーで warn + throw）と、service test の非メンバー表現を `null` 返却へ更新。
  「probe が throw しても非メンバー扱いで self-add を試みる」ケースも追加

副次的に **L-1（doc コメントが実挙動より楽観的）も解消**。`probeMembership` の doc に
「一時的な障害なら再 probe で `already-member`、継続していれば `group/auto-join-failed`」を明記した。

---

### LOW

#### L-1. `probeMembership` の doc コメントが実挙動より楽観的 — **✅ M-2 対応時に解消**

[src/lib/services/auto-group-join.ts:76-80](../../../../src/lib/services/auto-group-join.ts#L76-L80) は
「ネットワーク一時障害でも … 再 probe で `already-member` に倒れる（呼出側から見た挙動は変わらない）」
と書いているが、障害が継続していれば再 probe も false を返し `group/auto-join-failed` を throw する。
「一時的な障害が解消していれば」という条件を明記するか、
「恒久的な障害では `group/auto-join-failed` になる」を追記すること。

#### L-2. `group/auto-join-groupids-failed` が疑似コードとして log にだけ存在する

[src/lib/services/auto-group-join.ts:161-167](../../../../src/lib/services/auto-group-join.ts#L161-L167) は
`code: "group/auto-join-groupids-failed"` を warn の meta に載せているが、
この文字列は `AppError` の code ではなく、[error-logging.md](../../../rules/error-logging.md) の
`group/*` 一覧にも登録されていない（`group/auto-join-failed` のみ追記済み）。
ログ検索の運用上は有用なので、**error-logging.md に「ログ専用コード」として併記する**か、
meta キー名を `code` 以外（例 `logCode`）にして AppError の code と区別すること。

#### L-3. 匿名判定と表示名解決が引数 `uid` ではなく `firebaseAuth.currentUser` 依存

[src/lib/services/auto-group-join.ts:113](../../../../src/lib/services/auto-group-join.ts#L113) /
[:61](../../../../src/lib/services/auto-group-join.ts#L61) は `currentUser` を見るが、
関数の主語は引数の `uid`。Phase 2 の callsite が常に「今ログインしている本人」で呼ぶ前提なら問題ないが、
`currentUser` が null のとき `isAnonymous` は undefined となり匿名ガードが素通りする
（rule 側で deny されるので実害は無いが、意図しない `group/auto-join-failed` になる）。
入口で `firebaseAuth.currentUser?.uid === uid` を検証するか、`User` オブジェクトを引数で受けると堅い。

---

## Good（維持したい点）

- 新 self-add ブランチの不変条件を招待コード版と**同一順序で並べた**こと。差分レビューで
  「何が違うか」が proof 部分だけに絞られ、Phase 4.16 型の `affectedKeys` 抜けを防いでいる。
- `scripts/test-rules-tournament-join.mjs` が deny → allow の順で実行し、
  allow 成功時のみローカル state（`members` / `displayNames`）を進める作り。
  途中失敗しても後続ケースが誤判定にならない。
- `test-rules-limits.mjs` の `minOccurrences` を 2 → 3 に更新し、displayName 上限の drift check を
  新経路まで拡張していること（追加を忘れると新ブランチだけ 15 から drift しても検知できなかった）。
- DRIFT WARNING の同期先（`tournament-state.ts` / players create の 2 ブランチ / 新 helper）を
  3 ファイルで相互参照させていること。

---

## Validation Results

| Check | Result | Detail |
| --- | --- | --- |
| Type check | Pass | `npm run typecheck` exit 0 |
| Lint | Pass | `npm run lint` → No ESLint warnings or errors |
| Tests | Pass | `npm test` → 101 files / 1584 tests passed |
| Build | Pass | `npm run build` exit 0 |
| Rules emulator（新規） | Pass | `npm run test:rules-list-scope` → **9/9 ALL GREEN** |
| Rules emulator（非回帰） | Pass | 既存 13 validator すべて ALL GREEN（spectate 19 / tournament-join 16 / proxy-create 11 / clone-players 7 / latest-join-code 9 / season 12 / season-points-rule 11 / table-labels 16 / card-background 11 / limits 14 / finished-count 8 / default-seats 9 / pd 8） |

C-1 / M-1 / M-2 対応後の再実行結果（unit は 1584 → **1595 件**に増加）。

> ⚠ `firebase deploy --only firestore:rules` は**未実行**。
> 今回の rules 変更（self-add ブランチ + list scope 絞り込み）は本番未反映のため、
> Phase 2 に進む前にユーザー承認のうえ実行すること。
> **deploy 前後で `tournaments` の list 挙動が変わる**点に注意（絞り込みなしのクエリは deploy 後 deny）。

---

## Files Reviewed

| File | 種別 |
| --- | --- |
| `firestore.rules` | Modified — `hasTournamentEntryProof` + 第 2 self-add ブランチ追加 |
| `src/lib/firebase/schemas/group.ts` | Modified — `joinedViaTournamentId` を additive 追加 |
| `src/lib/firebase/repositories/groups.ts` | Modified — `addSelfViaTournamentEntry` 追加 ＋ **M-2 対応で `getGroupIfMember` 追加** |
| `src/lib/firebase/repositories/groups.test.ts` | Modified — **M-1 対応で 10 ケース追加**（`addSelfViaTournamentEntry` 6 / `getGroupIfMember` 4） |
| `src/lib/services/auto-group-join.ts` | Added — `joinGroupViaTournament` service（M-2 で probe を `getGroupIfMember` へ切替） |
| `src/lib/services/auto-group-join.test.ts` | Added — unit 11 ケース ＋ **M-2 対応で 1 ケース追加**（probe throw 時も self-add） |
| `src/lib/services/tournament-state.ts` | Modified — DRIFT WARNING に新 helper を追記 |
| `scripts/test-rules-tournament-join.mjs` | Added — emulator validator 16 ケース |
| `scripts/test-rules-limits.mjs` | Modified — `minOccurrences` 2 → 3 |
| `package.json` | Modified — `test:rules-tournament-join` script 追加 |
| `.claude/rules/{error-logging,firebase-patterns,group-membership}.md` | Modified — 規約反映 |
| `src/**/**.test.{ts,tsx}` × 5 | Modified — fixture に `joinedViaTournamentId: null` を追加 |
| `.claude/PRPs/08-auto-group-join-on-entry/**` | Added — PRD / plan / report |

---

## 次のアクション

1. ~~C-1~~ — 案 (b) で対応済み（`tournaments` / collectionGroup `players` の list scope 絞り込み）
2. ~~H-1~~ — クローズ（進行中の除名は運用上ありえない）。Phase 4 plan に
   「除名は終了後に行う」前提をコメントとして残す
3. ~~M-1~~ / ~~M-2~~ — 対応済み
4. **`firebase deploy --only firestore:rules` をユーザー承認のうえ実行**（Phase 2 の前提）
5. L-2 / L-3 は任意（Phase 2 の実装時にまとめて対応でも可）
6. Phase 2（受付フロー統合）で `receipt.ts` の 4 経路から `joinGroupViaTournament` を呼ぶ。
   **呼出順序は「受付（player 作成）→ 自動所属」を厳守**（rule が player doc の存在を前提とする）
