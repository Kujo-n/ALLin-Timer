# Local Review: Phase A.1 — Storage Foundation

**Reviewed**: 2026-05-11
**Author**: ローカル未コミット差分
**Branch**: `feat/phase-a.1-storage-foundation` → `main`
**Decision**: ✅ **APPROVE**（CRITICAL/HIGH なし、レビュー中に MEDIUM 1 件・LOW 1 件をその場で修正済み）

## Summary

Phase A.1 は Firebase Storage SDK 導入 + `groups/{gid}` への 2 nullable フィールド追加で
構成される backend / 基盤 PR。UI 変更なし。security-reviewer と typescript-reviewer の
2 エージェント並行レビューで CRITICAL/HIGH 0 件、MEDIUM 3 件 / LOW 6 件を検出。
このうち実コード反映が有意義な MEDIUM 1 件・LOW 1 件をその場で修正、残りは accepted
design tradeoff または coverage 拡張のみで挙動に影響しないため report に記載のみ。

## Findings

### CRITICAL

なし

### HIGH

なし

### MEDIUM

1. **`validateCardBackground` の post-guard 型 narrowing が optional chaining 防御で不明瞭**
   ([src/lib/firebase/repositories/groups.ts:467-486](../../../../src/lib/firebase/repositories/groups.ts#L467-L486))
   - **Before**: `parsed.data?.imageUrl === null && parsed.data?.storageAssetId === null` の
     形で `safeParse` 後も optional chaining を残しており、`parsed.data === null` のケース
     （実行時には発生しないが型レベルでは可能）で両 invariant が silent に false 判定されて
     誤メッセージで throw する可能性があった。
   - **Fix applied**: `if (!parsed.success || parsed.data === null)` でガードを統合し、
     後段の dot アクセスを `parsed.data.imageUrl` / `parsed.data.storageAssetId` に narrow。
     コメントで「nullable schema + 早期 return の関係」を明示。
   - 修正後 vitest 45/45 PASS、typecheck clean。

2. **Public Storage read による hotlinking / egress abuse の理論リスク**
   ([storage.rules:23](../../../../storage.rules#L23))
   - `allow read: if true;` は OG SSR の anon fetch を成立させるための accepted design。
     `storageAssetId` を `crypto.randomUUID()` で発行する前提（Phase A.2 で実装予定）
     なら ~122bit エントロピーで enumeration 不可。
   - **判断**: 現状のサークル規模では Blaze 無料枠（5GB ストレージ / 1GB egress/day）に
     収まる。OG タグで公開 URL が広まった場合に再評価する余地はあるが、本 phase の
     段階では accepted。`storage.rules` 冒頭コメントで OG SSR の read 要件は明記済み。
   - **No code change**.

3. **既知の design limitation: 広い owner-update branch が narrow branch の textTheme
   enum / "both-or-neither" invariant を bypass する**
   ([firestore.rules:285-340](../../../../firestore.rules#L285-L340))
   - owner-update branch は `affectedKeys` 制約なしで全フィールド書込可。SDK 直叩きで
     owner が `winnerCardBackground.textTheme = "auto"` や
     `{ imageUrl: "x", storageAssetId: null }` を書込可能。
   - **判断**: plan の Task 7 GOTCHA / 本 phase の `firebase-patterns.md` 設計原則
     「narrow branch は将来 owner-update を狭めるための足場」で **明示的 accepted**。
     application 層 (`cardBackgroundSchema` zod enum + `validateCardBackground` の
     "both-or-neither" invariant) が最終ライン。Phase A.2 UI は service 層経由でしか
     書込まないため通常 owner ユーザーは到達不能。
   - emulator validator のケース 4 は `expectAllow` で characterization 化済み
     ([scripts/test-rules-card-background.mjs:218](../../../../scripts/test-rules-card-background.mjs#L218))。
   - **No code change**.

### LOW

1. **`createGroup` test の `toMatchObject` が新 seed フィールドを assert していなかった**
   ([src/lib/firebase/repositories/groups.test.ts:62-69](../../../../src/lib/firebase/repositories/groups.test.ts#L62-L69))
   - **Before**: 既存 `joinCodeId: null` までは assert していたが、新規
     `winnerCardBackground: null` / `seasonCardBackground: null` は未確認。
   - **Fix applied**: `toMatchObject` に 2 行追加。回帰防御を強化。

2. **Storage rules `deny-by-default` コメントが Firestore rules 慣習に依存した表現**
   ([storage.rules:5](../../../../storage.rules#L5))
   - Firestore rules では `deny-by-default` が典型的だが、Storage rules も同じ
     first-match-wins セマンティクスを持つ。コメントに「Storage rules は他のいかなる
     match block にも `allow` が無ければ deny」という文言を足してもよいが、優先順位
     自体は正しく書かれているため挙動に影響なし。
   - **No code change**.

3. **`firestore.exists` ガード未通過時の挙動が undocumented**
   ([storage.rules:25](../../../../storage.rules#L25))
   - `groups/{gid}` doc が存在しない場合は `exists()` で false 短絡し、後続の
     `firestore.get(...).data.ownerUids` は評価されない。挙動は安全。
   - **No code change**.

4. **owner-overwrites-owner が rule で許容される（並行 upload race）**
   ([storage.rules:24-26](../../../../storage.rules#L24-L26))
   - サークルあたり owner は通常 1 名想定 / Phase A.2 UI が単一書込経路のため race window
     極小。orphan asset の best-effort delete は Phase A.2 で対応（plan「Notes」参照）。
   - **No code change**.

5. **emulator validator coverage gaps**
   - `test-storage-rules.mjs`: `image/webp` 上昇テスト未追加（jpeg/png は cover）。
     同 regex 分岐のため代替検証で十分。
   - `test-rules-card-background.mjs`: organizer-audioSettings branch + 新フィールド
     同時改竄テスト未追加。`affectedKeys.hasOnly(['audioSettings'])` で deny されるため
     既存 affectedKeys 検証で実質 cover。
   - **No code change**.

6. **`updateSeasonCardBackground` unit test の網羅が `updateWinnerCardBackground` より浅い**
   ([src/lib/firebase/repositories/groups.test.ts:531-547](../../../../src/lib/firebase/repositories/groups.test.ts#L531-L547))
   - `updateSeasonCardBackground` は同一 helper を経由するため field name 確認のみで
     代表性確保済み。
   - **No code change**.

## Validation Results

| Check       | Result      |
| ----------- | ----------- |
| Type Check  | ✅ Pass     |
| Lint        | ✅ Pass     |
| Tests (vitest) | ✅ Pass — 1286/1286 |
| Build       | ✅ Pass     |
| Drift (test:rules-limits) | ✅ Pass — 14/14 |
| Emulator (test:rules-card-background) | ✅ Pass — 11/11 |
| Emulator (test:storage-rules) | ✅ Pass — 10/10 |
| E2E (playwright) | ⏭ Skipped（UI 変更なし、emulator は auth+firestore のみ起動するため Storage 影響なし） |

## Files Reviewed

| File | Change Type |
| --- | --- |
| `src/lib/firebase/client.ts` | Modified（`firebaseStorage` singleton + emulator connect 追加） |
| `src/lib/firebase/schemas/group.ts` | Modified（`cardBackgroundSchema` + 2 フィールド additive） |
| `src/lib/firebase/repositories/groups.ts` | Modified（`validateCardBackground` + `updateWinner/SeasonCardBackground` + `createGroup` seed; レビュー中 type narrowing 改善） |
| `src/lib/services/group.ts` | Modified（`setWinner/SeasonCardBackground` + `assertOwner`） |
| `firebase.json` | Modified（storage rules + emulator port 9199） |
| `firestore.rules` | Modified（owner-only narrow branches × 2） |
| `storage.rules` | **Added**（deny-by-default + groups/{gid}/bgImages owner-only） |
| `scripts/test-rules-card-background.mjs` | **Added**（11 ケース emulator validator） |
| `scripts/test-storage-rules.mjs` | **Added**（10 ケース emulator validator、2-step resumable upload プロトコル） |
| `package.json` | Modified（新 scripts × 2 + emulator script に storage 追加） |
| `README.md` | Modified（Blaze 移行手順 step 6/7、deploy 統合コマンド、Validation Commands 表 × 2 行） |
| `src/lib/firebase/repositories/groups.test.ts` | Modified（11 ケース追加 + `createGroup` seed assertion 強化） |
| `src/lib/firebase/schemas/index.test.ts` | Modified（fixture 同期） |
| `src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.test.tsx` | Modified（fixture 同期） |
| `src/lib/hooks/useAudioPlayer.test.tsx` | Modified（fixture 同期） |
| `src/lib/services/account-delete.test.ts` | Modified（fixture 同期） |
| `src/lib/services/group.test.ts` | Modified（fixture 同期） |
| `src/lib/services/tournament.test.ts` | Modified（fixture 同期） |
| `.claude/PRPs/05-post-launch-polish/prds/05-post-launch-polish.prd.md` | Modified（Phase A.1 進捗を complete に更新） |

## Sub-Agent Reports

- **security-reviewer**: APPROVE — F-1〜F-9 の 9 findings、CRITICAL/HIGH なし。`affectedKeys` 検証で「self-add / self-leave / self-key-displayName / audioSettings / finishedTournamentCount / defaultSeatsPerTable / seasonStartDate / defaultTableLabels / seasonPointsRule の全ブランチが新フィールドを許可しない」を機械確認済み。
- **typescript-reviewer**: APPROVE — MEDIUM 1 件（修正済み）・LOW 2 件（1 件修正済み・1 件 accepted）。`any` 不使用、unsafe cast 不使用、`console.*` 不使用、`wrapFirestoreWrite` の規約準拠を確認。

## Required Before Merge

⚠️ **本番 deploy を merge 直後に実行する**（emulator green でも本番未 deploy で
permission-denied する罠 — memory: `feedback_firestore_rules_deploy`）:

```bash
firebase deploy --only firestore:rules,storage
```

Blaze 未移行のサークルは本機能のみ無効化（README に明記済み）、アプリ本体は通常動作。

## Next Steps

- `/prp-commit` で日本語コミットメッセージ作成（commit 規約参照）
- `/prp-pr` で PR 作成
- マージ後: `firebase deploy --only firestore:rules,storage` 実行
- Phase A.2 plan 作成: サークル詳細画面の WinnerCardBackgroundCard / SeasonCardBackgroundCard、client-side resize、旧 asset retry 削除 helper、OG route 拡張
