# Phase 2.5: Group (サークル) Management

> [allin-timer.prd.md](../../allin-timer.prd.md) の Phase Details から分離。状態 / 依存関係 / PRP Plan link は主 PRD の Implementation Phases 表が真実源。

- **Goal**: サークルを第一級エンティティ化し、2〜3 人の運営者で structures / tournaments を共有できるようにする
- **背景**: 実サークルは運営者が複数人いるため、Phase 2 の個人所有モデル（`ownerUid`）では共有できず実運用にならない
- **Scope**:
  - `groups/{gid}` コレクション（name / ownerUid / memberUids / createdAt）
  - `groupJoinCodes/{code}` 招待コード（有効期限付き、1 回 or 複数回使用可）
  - `users/{uid}.groupIds` 逆引きフィールド
  - `structures/{sid}`・`tournaments/{tid}` を **`ownerUid` → `groupId` + `createdByUid` に破壊的変更**
  - `/groups` 一覧 / `/groups/new` 作成 / `/groups/[gid]` 詳細（メンバー一覧・招待コード発行・脱退）
  - `/groups/join/[code]` 加入ページ
  - Phase 2 既存 UI（`/structures` / `/tournaments` など）を「現在選択中の group」をコンテキストとして扱うよう修正
  - Firestore Security Rules: group メンバーシップ（`request.auth.uid in get(...).data.memberUids`）に基づく read/write
  - **既存データは手動削除／マイグレーション前提**（破壊的変更）
- **Success signal**: 運営者 2 人が同じ group に所属した状態で、片方が作った structure / tournament をもう片方が編集・使用できる
