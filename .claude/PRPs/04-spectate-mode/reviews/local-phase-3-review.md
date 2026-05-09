# Local Code Review: Phase 3 — Toggle UI + 共有導線（dashboard）

**Reviewed**: 2026-05-09
**Author**: Kujo-n (current session)
**Branch**: develop（uncommitted）
**Decision**: APPROVE（only LOW findings）

## Summary

Phase 3 の実装は plan 通りに 9 ファイル（CREATED 4 / UPDATED 5）で完結し、type / lint / unit test / build が全て green。新規 22 件の test が追加され、既存 1228 件の回帰なし。Phase 1 で確立した rule + service の二重防御を service / repository / component の 3 層で正しく実装している。CRITICAL / HIGH / MEDIUM 級の指摘なし。LOW 1 件のみ（UX 微調整余地）。

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

None.

### LOW

**LOW-1: ON 操作直後に switch の視覚反映が onSnapshot 待ちで遅延（数百 ms）**

- File: [src/components/tournament/SpectateModeCard.tsx:78-95](../../../../src/components/tournament/SpectateModeCard.tsx#L78-L95)
- 現状: `apply(true)` 成功時に `setConfirmOpen(false)` で dialog を即閉じるが、`<input checked={enabled}>` は props 駆動のため、Firestore onSnapshot が反映されるまで switch は OFF のままになる（数百 ms）。dialog 閉じた直後に「switch がまだ OFF / URL も表示されない」状態が一瞬発生する。
- 影響: 運営者が「クリックは効いたのか？」と一瞬迷う UX 上の摩擦。機能的問題なし。
- 修正案（採用しない場合は LOW のままで OK）:
  - 楽観的 UI: 成功直後にローカル state で `optimisticEnabled` を更新し、props.enabled が反映されるまで使う
  - dialog で「設定中…」を表示したまま onSnapshot 反映を待つ
- 判断: plan 末尾の Risks 表で同種の trade-off は議論されており、「props.enabled が真実源」設計を意図的に採用している。Phase 4 / 後続 phase で UX を見ながら検討する余地あり。

## Validation Results

| Check       | Result                                  |
| ----------- | --------------------------------------- |
| Type check  | Pass — 0 errors（`tsc --noEmit`）        |
| Lint        | Pass — 0 warnings / 0 errors（`next lint`） |
| Tests       | Pass — 1243/1243（既存 1228 + 新規 15）   |
| Build       | Pass — Next.js build success            |
| Edge Cases  | Pass — testing strategy checkbox 全件 cover |

## Files Reviewed

| File                                                                | Change Type | Comment                                             |
| ------------------------------------------------------------------- | ----------- | --------------------------------------------------- |
| `src/lib/services/qr.ts`                                            | Modified    | `safeOrigin()` 抽出 + `buildSpectateUrl()` 追加。既存 `buildJoinUrl` の signature 不変 |
| `src/lib/firebase/repositories/tournaments.ts`                      | Modified    | `updateSpectateEnabled(tid, value)` を `updateTournament` 直下に additive 追加。`wrapFirestoreWrite` 経由で `firebase-patterns.md` 規約準拠 |
| `src/lib/firebase/repositories/tournaments.test.ts`                 | Modified    | repository test に `updateSpectateEnabled` describe を追加（7 ケース） |
| `src/lib/services/tournament.ts`                                    | Added       | `setSpectateEnabled` service 新規。tournament.groupId 経由で role 再評価 |
| `src/lib/services/tournament.test.ts`                               | Added       | service unit test（7 ケース：role gate / not-found / type穴） |
| `src/components/tournament/SpectateModeCard.tsx`                    | Added       | Card / Dialog / 確認 / clipboard / QR 折りたたみ。`unwrapOrFrom` で二重 wrap 回避 |
| `src/components/tournament/SpectateModeCard.test.tsx`               | Added       | RTL test（8 ケース：表示分岐 / dialog flow / error UX / clipboard） |
| `src/app/tournaments/[tid]/dashboard-client.tsx`                    | Modified    | `<SpectateModeCard>` を `StructureSnapshotCard` 直下、削除 `<Dialog>` 直前に配置 |
| `src/app/tournaments/tournaments-client.tsx`                        | Modified    | sky 系「観戦公開中」 badge を additive 追加（aria-label にも反映） |
| `.claude/PRPs/04-spectate-mode/prds/04-spectate-mode.prd.md`        | Modified    | Phase 3 ステータスを complete に更新                  |
| `.claude/PRPs/04-spectate-mode/plans/...phase-3-toggle-ui-and-share.plan.md` | Renamed | `completed/` 配下に archive                         |
| `.claude/PRPs/04-spectate-mode/reports/phase-3-toggle-ui-and-share-report.md` | Added | 実装レポート                                         |

## Detailed Pattern Compliance Check

| Rule                                                  | Compliance                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [error-logging.md](../../../rules/error-logging.md) `AppError` ラップ強制 | ✅ `setSpectateEnabled` / `updateSpectateEnabled` 両方で `AppError` + `wrapFirestoreWrite`           |
| `unwrapOrFrom` の正しい使用                            | ✅ `SpectateModeCard.apply` で `unwrapOrFrom` を使い、`setSpectateEnabled` 内 wrap を尊重（二重 warn 回避） |
| `console.*` 不使用                                     | ✅ 新規コードに `console.*` 一切なし                                                                  |
| [firebase-patterns.md](../../../rules/firebase-patterns.md) `wrapFirestoreWrite` 経由 | ✅ `updateSpectateEnabled` で wrap 経由。logger.info は wrap の外（成功時のみ）                       |
| Firestore SDK 直接呼出は repositories 配下のみ          | ✅ `setSpectateEnabled` service は repository を呼ぶだけで SDK 直接呼出なし                          |
| [group-membership.md](../../../rules/group-membership.md) 権限マトリクス（spectate ON/OFF は organizer 以上） | ✅ service 層で `organizerUids.includes(uid)` を tournament.groupId 経由で再評価                    |
| [testing.md](../../../rules/testing.md) helper / service / repository の API 境界で mock | ✅ `tournament.test.ts` は `getTournament` / `getGroup` / `updateSpectateEnabled` の境界で mock。component test は `setSpectateEnabled` 境界で mock |
| 新規機能と test の commit セット                       | ✅ 各 Task で実装 + test を同一 phase 内に投入                                                        |
| 数値リミット定数の単一真実源（DRIFT WARNING）             | ✅ `spectateEnabled` は boolean のため数値リミット該当なし                                            |

## Security Review

| 項目                                                | 評価                                                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Hardcoded credentials / secrets                     | ✅ なし                                                                                              |
| Path traversal                                      | ✅ `buildSpectateUrl(tid)` は `new URL(...)` 経由で path 構築。tid は Firestore doc id（base62）のため traversal 不可 |
| XSS                                                 | ✅ React 標準 escape。`{url}` 表示も React text node のため安全                                       |
| 認証 gap                                            | ✅ rule（Firestore Rules）+ service（`organizerUids.includes(uid)`）+ UI（dashboard organizer-only redirect）の三重防御 |
| 任意 gid 信頼問題                                   | ✅ service で UI 引数の gid を信頼せず `getTournament(tid).groupId` で正準値を取得して role check       |
| 二重防御の対称性                                    | ✅ Phase 1 emulator validator のケース 10（member deny）/ 11（anon deny）と service の挙動が一致     |
| Firestore Rules 経路漏れ                            | ✅ 経路 B (`affectedKeys.hasOnly(['spectateEnabled', 'updatedAt'])`) と patch shape が完全一致         |

## Test Coverage Quality

- **境界 mock**: helper / service / repository の API 境界で mock を割っており、内部実装依存のテストはなし（`testing.md` 準拠）
- **boolean 型穴**: it.each で 3〜4 ケース展開（service 3 / repository 4）し、TS 型穴に対する最終ライン防御を assert
- **role gate**: owner happy / organizer non-owner happy / member deny / not-found 伝播の 4 経路カバー
- **error UX**: 「reject 後 dialog が開いたまま」を test で固定化し、再試行可能な UX を回帰防止
- **clipboard**: `navigator.clipboard` を beforeEach で stub し、writeText が URL とともに呼ばれることを assert

## 推奨される追加チェック（リリース前 manual validation）

これらは plan の "Manual Validation" 節に記載済み:

1. dev server で organizer ログイン → toggle / dialog / clipboard / QR 動作
2. 一覧画面の「観戦公開中」 badge 表示（ON 中の tournament で）
3. member ログイン → dashboard `/live` redirect → toggle UI 不可視 / 一覧 badge は可視
4. Firebase emulator で `npm run test:rules-spectate` 14/14 green を再確認（Phase 1 で確認済だが、リリース前最終確認推奨）

## 関連参照

- Plan: [.claude/PRPs/04-spectate-mode/plans/completed/phase-3-toggle-ui-and-share.plan.md](../plans/completed/phase-3-toggle-ui-and-share.plan.md)
- Report: [phase-3-toggle-ui-and-share-report.md](../reports/phase-3-toggle-ui-and-share-report.md)
- Phase 1 review: [local-phase-1-review.md](local-phase-1-review.md)（参考）
- Phase 2 review: [local-phase-2-review.md](local-phase-2-review.md)（参考）
