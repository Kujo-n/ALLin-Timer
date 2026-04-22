# Group（サークル）メンバーシップ規約

Phase 2.5 で確立した group ベース所有権・権限モデル。**Phase 4.6 で 3 階層ロール（owner / organizer / member）に拡張**。Phase 3 以降はここを参照する。

## スコープ

Phase 2.5 で以下を `ownerUid` 個人所有モデルから `groupId` 共有所有モデルに移行済み。Phase 4.6 でロールを追加:

- `structures/{sid}` — サークルで共有されるストラクチャプリセット
- `tournaments/{tid}` — サークルで開催されるトーナメント

## データモデル

- `groups/{gid}` — name / **ownerUids[]** / **organizerUids[]** / memberUids / createdAt / **joinCodeId**
  - invariant: `ownerUids ⊆ organizerUids ⊆ memberUids`（`ownerUids.length >= 1`）
  - Phase 2.5 の `ownerUid: string` は Phase 4.6 migration で廃止（`scripts/migrate-phase-4.6-roles.ts`）
  - `joinCodeId`（Phase 4.6.1 追加）: 直近の self-add で消費された `groupJoinCodes/{code}` の doc ID。rule 側の consumption proof として利用する（下記「招待コードの rule 側検証」）。新規 group / 未消費状態では `null`。owner は owner update 経路で自由に上書き／null 化してよい
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
| 招待コード発行（`groupJoinCodes` create） | ○ | ○ | × |
| 招待コード削除 | ○ | × | × |
| structures CRUD | ○ | ○ | read のみ |
| tournaments CRUD（create/update/delete） | ○ | ○ | read のみ |
| tournaments/players create（自分の参加） | ○ | ○ | ○ |
| tournaments/players bust / seat（他人） | ○ | ○ | × |
| tournaments/players self-delete | ○ | ○ | ○ |

## ロール遷移

- 招待コード加入は常に `member`（一般メンバー）でスタート
- owner 操作で以下の遷移が可能:
  - `member` ↔ `organizer`（`promoteToOrganizer` / `demoteToMember`）
  - `organizer` ↔ `owner`（`promoteToOwner` / `demoteOwner`）
  - 直接 `member` → `owner` は禁止（先に `organizer` に昇格）
- 最後のオーナーは降格 / 脱退不可（rule + service の二重防御）

## 実装上の注意

- `get(/groups/{groupId})` によるメンバーシップチェックは **Firestore rule の read quota を 1 件消費**する。Phase 4.6 で `isGroupMember` / `isOrganizer` / `isOwner` の 3 helper を追加したが、同一評価内の同一 path に対する get は cache されるため、単一 rule 評価あたり +1 read 程度
- group 切替時のコンテキスト管理は `src/lib/services/current-group.tsx`（`GroupProvider` / `useCurrentGroup`）経由で行う。Phase 4.6 で `currentGroupRole` / `isOrganizer` / `isOwner` を導出フィールドとして追加
- 招待コード仕様は [security.md](security.md) の「招待コード設計原則」に従う
- 既存データのマイグレーション手順:
  - Phase 2.5 → [phase-2.5-group-management.plan.md](../PRPs/plans/completed/phase-2.5-group-management.plan.md)
  - Phase 4.6 → [scripts/migrate-phase-4.6-roles.ts](../../scripts/migrate-phase-4.6-roles.ts) + README の migration 手順
- **互換レイヤは作らない**（Phase 2.5 先例に従う）。migration 実行前の旧コード／旧クライアントは動作不可

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

## 参照

- PRD: [.claude/PRPs/prds/allin-timer.prd.md](../PRPs/prds/allin-timer.prd.md) — Implementation Phases / Phase 2.5 / Phase 4.6 / Technical Risks
- Phase 4.6 実装計画: [.claude/PRPs/plans/completed/phase-4.6-member-role-split.plan.md](../PRPs/plans/completed/phase-4.6-member-role-split.plan.md)
- Phase 2.5 ローカルレビュー記録: [.claude/PRPs/reviews/local-phase-2.5-review.md](../PRPs/reviews/local-phase-2.5-review.md) — M2 finding
- 関連ルール: [firebase-patterns.md](firebase-patterns.md) / [security.md](security.md)
