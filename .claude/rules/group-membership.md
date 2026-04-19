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

## 既知のセキュリティリスク（Phase 3+ で対応予定）

### `groupJoinCodes.usesCount` の悪意ある第三者による空消費

**現状**: [firestore.rules](../../firestore.rules) の `groupJoinCodes` `allow update` ルールは、認証済みユーザーであれば誰でも `usesCount` を `+1` する更新を許可している（`request.resource.data.usesCount == resource.data.usesCount + 1` のみで判定）。group メンバー追加とは独立して評価される。

**攻撃シナリオ**: 招待コード文字列がチャット等で第三者に流出した場合、加入意図のない第三者が `usesCount` だけを繰り返しインクリメントし、`maxUses` まで到達させてコードを無効化できる（DoS）。

**現行の緩和**: Phase 2.5 の `generateJoinCode` の default は `maxUses: null`（無制限）。UI からも `maxUses` 設定機能を提供していないため、本番運用上は顕在化しない。

**Phase 3+ で `maxUses` UI を追加する際の必須対応**:
1. `usesCount` 更新と `groups/{gid}.memberUids` への自分追加を **atomic に検証** する仕組みが必要
2. Firestore Security Rules 単独では複数 doc 同期検証が表現困難なため、**Cloud Functions（Callable）化が現実解**
   - Callable function で `code` 検証 → group 加入 → `usesCount` 更新 を 1 トランザクションで実行
   - クライアントから `groupJoinCodes` を直接更新できないよう、rule の `allow update` を deny に戻す
3. 代替案として、招待コードを「単一回使用 + クライアント発行」ではなく「サーバ生成・短命 token」モデルに変更する選択肢もある

**判定基準**: `maxUses` を運営者 UI から設定できるようになった時点で対策必須。デフォルトの `maxUses: null` 利用に留まる限りは Phase 3+ でも遅延可。

## 参照

- PRD: [.claude/PRPs/prds/allin-timer.prd.md](../PRPs/prds/allin-timer.prd.md) — Implementation Phases / Phase 2.5 / Technical Risks
- Phase 2.5 ローカルレビュー記録: [.claude/PRPs/reviews/local-phase-2.5-review.md](../PRPs/reviews/local-phase-2.5-review.md) — M2 finding
- 関連ルール: [firebase-patterns.md](firebase-patterns.md) / [security.md](security.md)
