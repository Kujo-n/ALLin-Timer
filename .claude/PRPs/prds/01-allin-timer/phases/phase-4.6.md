# Phase 4.6: Member Role Split

> [allin-timer.prd.md](../../allin-timer.prd.md) の Phase Details から分離。状態 / 依存関係 / PRP Plan link は主 PRD の Implementation Phases 表が真実源。

- **Goal**: サークル所属を「運営（organizer）」と「一般メンバー（general member）」に分離し、一般メンバーがアプリ上から参加サークルのトーナメントを見てワンタップ参加できるようにする
- **背景**: Phase 2.5 のフラットな `memberUids` モデルでは「見るだけ・参加だけ」の権限レベルが存在せず、実サークルで非運営者をそのままメンバーに加えると全員が CRUD 権限を持ってしまう。実運用では「運営 2-3 人 + 参加する側の一般メンバー多数」の構成が必要
- **Scope**:
  - `groups/{gid}` スキーマ拡張: `ownerUid: string` → `ownerUids: string[]`（**オーナー複数可**）、`organizerUids: string[]` 新設（`memberUids ⊇ organizerUids ⊇ ownerUids` の invariant）
  - 既存メンバーは全員 organizer として migration（運営権限は保持、破壊なし）。既存 `ownerUid` は `ownerUids: [ownerUid]` に昇格
  - 招待コード加入のデフォルトを「一般メンバー」に変更（`memberUids` のみ +1、organizerUids / ownerUids には追加しない）
  - ロール昇降格 UI は **オーナー専用**（owner のみ member ↔ organizer ↔ owner を操作可能）
  - 最後のオーナーは降格 / 脱退 / group 削除不可（service + rule の二重ガード）
  - `/tournaments` 一覧は一般メンバーも閲覧可能、カードに「参加する」ボタン追加（`joinAsCurrentUser` ワンタップ）
  - 一般メンバーが `/tournaments/{tid}` （運営ダッシュボード）URL を直打ちした場合、`/tournaments/{tid}/live` にリダイレクト
  - Firestore Security Rules: structures / tournaments / groupJoinCodes の write 条件を `isGroupMember` → `isOrganizer` に強化、groups の rename / delete / roles update は `isOwner` 判定（ownerUids 配列対応）
  - 既存データ移行用 migration スクリプト（admin SDK、dry-run 対応）
- **Success signal**:
  - Owner / Organizer / Member の 3 視点でブラウザ検証がすべて通る（運営 UI の表示/非表示、参加ボタンの挙動、ロール変更の反映）
  - Migration スクリプトが既存 groups を破壊せず新スキーマに揃える
  - 最後のオーナー保護などの invariant が service + rule 両層で enforce されている
