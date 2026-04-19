# Group（サークル）メンバーシップ規約

Phase 2.5 で確立する group ベース所有権・権限モデル。**Phase 2.5 実装中に本ファイルを充実させ、Phase 3 以降はここを参照する**。

## スコープ

Phase 2.5 で以下を `ownerUid` 個人所有モデルから `groupId` 共有所有モデルに移行する:
- `structures/{sid}` — サークルで共有されるストラクチャプリセット
- `tournaments/{tid}` — サークルで開催されるトーナメント

## データモデル（確定予定）

- `groups/{gid}` — name / ownerUid / memberUids / createdAt
- `groupJoinCodes/{code}` — gid / expiresAt / maxUses / usedCount
- `users/{uid}.groupIds` — 逆引き
- `structures/{sid}` / `tournaments/{tid}` — `groupId` + `createdByUid`

## 権限モデル（確定予定）

| 操作 | 条件 |
|---|---|
| group の structure / tournament を read | `request.auth.uid in get(/groups/{groupId}).data.memberUids` |
| group の structure / tournament を write | 同上（メンバー全員が編集可） |
| group 自体の削除 | `request.auth.uid == group.ownerUid`（オーナーのみ） |
| メンバー追加 | 招待コード経由のみ（直接書込禁止） |

## 実装上の注意（Phase 2.5 実装時に埋める）

- [ ] `get(/groups/{groupId})` によるメンバーシップチェックは **Firestore rule の read quota を 1 件消費**する。クエリ1回あたりの rule 評価コストを意識すること
- [ ] group 切替時のコンテキスト管理（`useActiveGroup` などの hook 設計）
- [ ] 招待コード仕様は [security.md](security.md) の「招待コード設計原則」に従う
- [ ] 既存データのマイグレーション手順は Phase 2.5 plan に記載

## 参照

- PRD: [.claude/PRPs/prds/allin-timer.prd.md](../PRPs/prds/allin-timer.prd.md) — Implementation Phases / Phase 2.5
- 関連ルール: [firebase-patterns.md](firebase-patterns.md) / [security.md](security.md)
