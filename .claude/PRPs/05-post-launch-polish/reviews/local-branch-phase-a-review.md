# Local Branch Review: `feat/phase-a.2-background-image-ui-and-ssr`

**Reviewed**: 2026-05-12
**Reviewer**: Claude (Opus 4.7) — `/code-review`
**Branch**: `feat/phase-a.2-background-image-ui-and-ssr` → `main`
**Scope**: 28 commits, 58 ファイル, +9,083 / -157 行（Phase A.1 / A.2 / A.3 まとめ）
**Decision**: APPROVE — CRITICAL / HIGH なし。`/prp-pr` で PR 化可能。

## Summary

Phase A.1（Storage foundation）→ A.2（背景画像 UI + OG SSR fetch）→ A.3（読みやすさ層と footer-box）を
一本のブランチに束ねた変更。**セキュリティは多層防御で丁寧に作られており**、Storage rules /
Firestore rules / og-payload zod refine / og-image-fetch helper / service / repository / UI の
**6 層で SSRF・read 量増大・任意フィールド改竄を deny** する設計になっている。

検証: `npm run typecheck` ✅ / `npm run lint` ✅（0 warnings）/ `npm test` ✅（81 files / 1357 tests pass）。

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

#### M-1 Storage rule の `firestore.exists` + `firestore.get` で write 1 回あたり 2 read 消費

[storage.rules:25-31](storage.rules#L25-L31) の `allow create, update` と `allow delete` の両方が
`firestore.exists` + `firestore.get` を呼んでいる。Firebase の cross-service rule 評価では
同一 rule 評価内でも `exists()` と `get()` は **別の operation** とカウントされる場合があり、
upload 1 回あたり 2 read 消費する可能性。owner 操作で頻度は低く、Vercel CDN cache（24h）も
効くため**運用上は無視できる**が、サークル数が増えた将来に再評価する観点として記録。

**Mitigation**: 現状維持で OK。将来 organizer 拡張時に `affectedKeys` 更新と一緒に
rule helper 化を検討。

---

#### M-2 旧 asset 削除の retry を attempt 3 で確実視しているが、最終失敗時の orphan 検出経路がない

[card-background.ts:88-97](src/lib/services/card-background.ts#L88-L97) の `uploadAndSetWinnerCardBackground`
は旧 asset を `deleteWithRetry({ attempts: 3, backoffMs: [200, 600] })` で best-effort 削除し、
最終失敗時は `logger.warn("orphan card background asset", { gid, assetId })` を残す。

PRD の Decisions Log で「orphan 残留は次回上書きでは自動 retry されない既知制約」と明示されており、
**設計判断として承認済み**。ただし運用フェーズで orphan が累積した場合の **検出 / 一括掃除手順** が
README / 運営ガイド側にまだ無い。Phase A.3 report で「**Track A future**: orphan 検出スクリプト」
として Issue 化推奨。

**Mitigation**: 現状の warn ログで開発者が把握可能。Cloud Functions 化（将来）で `onObjectFinalized`
+ 30 日経過 orphan 削除を追加する選択肢が一般的。

---

### LOW

#### L-1 image-resize.ts: 5MB 以内でも高解像度 PNG で client OOM の可能性

[image-resize.ts:51-56](src/lib/utils/image-resize.ts#L51-L56) は `file.size > MAX_UPLOAD_BYTES` (5MB)
で pre-reject するが、5MB の **PNG は decode 後 RGBA で width × height × 4 byte に膨張**する。
例: 20,000×20,000 px PNG が 5MB に収まる極端ケースで decode 後 1.6 GB。canvas が OOM して
クライアントブラウザが落ちる。

owner 操作の自業自得かつ攻撃面ゼロ（攻撃者は他人のブラウザに影響を与えられない）のため放置可。
将来「ピクセル数 cap」（例: `img.width * img.height < 30M pixels`）を追加するなら 1 行で済む。

---

#### L-2 OG route の image fetch で path は任意（同 Firebase project の保証なし）

[og-image-fetch.ts:28-31](src/app/api/og/_lib/og-image-fetch.ts#L28-L31) は host allowlist
（`firebasestorage.googleapis.com` / `storage.googleapis.com`）のみで、path は自由。

しかし `bgImageUrl` を `groups/{gid}.winnerCardBackground.imageUrl` から取得する経路は
**owner のみが Firestore に書き込める**（rule で `isOwner` enforce）ため、攻撃者が任意の URL を
仕込むことは出来ない。さらに OG route の bgDataUri は **PNG 内部の `<img>`** として描画されるだけで、
画像内容がアプリケーションロジックに影響しない（読み出した内容で if 分岐などしない）。**実害なし**。

将来 organizer 等への書込権限拡張時には「画像 URL は当該 Firebase project の bucket に限定」など
ホスト + bucket prefix 制約に強化する選択肢がある。

---

#### L-3 `bgImageUrl` の Vercel CDN cache 24h と「公開リンク」UX

[CardBackgroundCard.tsx:311](src/app/groups/[gid]/_components/CardBackgroundCard.tsx#L311) で
「公開リンクから誰でも閲覧可能になります」と UX 警告を出しているが、`s-maxage=86400` の CDN cache
が間に挟まることで「**解除後も 24h は Vercel CDN 経由で PNG が見える**」状態が成立し得る。

これは設計トレードオフ（cache hit rate 維持）として PRD で許容済み。万一 PII を含む画像を
誤って upload した場合の **失効までの猶予**を運営ガイドで補足するとさらに親切。

**Mitigation**: PRD の Success Metrics で「Track A regression: cache hit rate 維持」を明示しており、
cache 無効化は採用しない。orphan 検出手順と合わせて運営ガイドへの追記候補。

---

#### L-4 CardBackgroundCard.tsx: validation 前に `setWorking(true)` する流れ

[CardBackgroundCard.tsx:184-227](src/app/groups/[gid]/_components/CardBackgroundCard.tsx#L184-L227)
の `onSave` は `setWorking(true)` → `setSavedFlash(false)` → 各分岐 → `else { onError(...); return; }`
の順。`finally { setWorking(false) }` でリセットされるため動作上 OK だが、validation を先に
行う方が読みやすい。**スタイル nit**。

---

#### L-5 retry.ts の `signal?.aborted` は loop 先頭のみで sleep 中は反応しない

[retry.ts:40-52](src/lib/utils/retry.ts#L40-L52) は `if (opts.signal?.aborted) return;` を
試行直前に置くが、`await new Promise<void>((resolve) => setTimeout(resolve, delay))` の sleep
中に abort されても次の試行直前まで気付かない。最大 600ms の遅延が許容できるユースケース
（旧 asset の best-effort 削除）専用のため**実用上問題なし**。汎用化する場合は `Promise.race`
で signal を sleep にも繋ぐ。

---

### INFO

- **テストカバレッジ良好**: og-image-fetch.test.ts（host allowlist / timeout / size / content-type の
  各 deny 経路）、og-payload.test.ts（schema validation）、og-readability.test.tsx（theme resolver）、
  CardBackgroundCard.test.tsx（UI 状態機械）、card-background.test.ts（service orchestration）、
  groups.test.ts（validateCardBackground invariant）、image-resize.test.ts、retry.test.ts、
  tests/e2e/card-background.spec.ts（OG fallback / upload / clear dialog）まで網羅。
- **drift 検出**: storage.rules / firestore.rules / schema / limits.ts の各リテラルが
  scripts/test-rules-card-background.mjs および scripts/test-storage-rules.mjs で機械的に
  検証される設計。
- **PRD の Decisions Log** が異例に詳細で、Post-merge follow-up（2 段）の経緯まで追跡可能。
  Codex review に出すときも判断材料が揃っている。

## Validation Results

| Check          | Result        | Detail                                          |
| -------------- | ------------- | ----------------------------------------------- |
| `npm run typecheck` | ✅ Pass     | `tsc --noEmit` exit 0                           |
| `npm run lint`      | ✅ Pass     | 0 warnings / 0 errors                           |
| `npm test`          | ✅ Pass     | 81 files / 1357 tests / 11.22s                  |
| `npm run build`     | ⏸ Skipped   | local review 範囲外（CI が見る）                |
| `npx playwright test` | ⏸ Skipped | emulator 起動を要するため CI / 手動で確認推奨 |
| `npm run test:rules-card-background` | ⏸ Skipped | emulator 必須。CI で実行されている前提 |
| `npm run test:storage-rules`         | ⏸ Skipped | 同上                                |

## Files Reviewed

主要な変更（コード本体のみ抜粋。テスト / docs / scripts / plan は省略）:

**security boundary（重点レビュー）**
- [storage.rules](storage.rules) — 新規
- [firestore.rules](firestore.rules#L276-L337) — `winnerCardBackground` / `seasonCardBackground` ブランチ追加
- [src/lib/firebase/client.ts](src/lib/firebase/client.ts) — Storage singleton + emulator connect

**OG SSR**
- [src/app/api/og/_lib/og-image-fetch.ts](src/app/api/og/_lib/og-image-fetch.ts) — 新規 (SSRF 防御)
- [src/app/api/og/_lib/og-payload.ts](src/app/api/og/_lib/og-payload.ts) — `bgImageUrl` / `bgTextTheme` / `groupName` 追加
- [src/app/api/og/_lib/og-readability.tsx](src/app/api/og/_lib/og-readability.tsx) — 新規
- [src/app/api/og/_lib/og-card-styles.ts](src/app/api/og/_lib/og-card-styles.ts) — text-shadow / footer-box token 追加
- [src/app/api/og/winner/[tid]/route.tsx](src/app/api/og/winner/[tid]/route.tsx) — レイアウト全面刷新
- [src/app/api/og/season/[gid]/route.tsx](src/app/api/og/season/[gid]/route.tsx) — bgImage + scrim + textShadow

**schema / repository / service**
- [src/lib/firebase/schemas/group.ts](src/lib/firebase/schemas/group.ts) — `cardBackgroundSchema` + `CARD_TEXT_THEMES`
- [src/lib/firebase/repositories/groups.ts](src/lib/firebase/repositories/groups.ts) — `updateWinnerCardBackground` / `updateSeasonCardBackground` / `validateCardBackground`
- [src/lib/firebase/repositories/cardBackgroundStorage.ts](src/lib/firebase/repositories/cardBackgroundStorage.ts) — 新規（Storage SDK 境界）
- [src/lib/services/group.ts](src/lib/services/group.ts) — `setWinnerCardBackground` / `setSeasonCardBackground`
- [src/lib/services/card-background.ts](src/lib/services/card-background.ts) — 新規 orchestrator
- [src/lib/utils/image-resize.ts](src/lib/utils/image-resize.ts) — 新規
- [src/lib/utils/retry.ts](src/lib/utils/retry.ts) — 新規

**UI**
- [src/app/groups/[gid]/_components/CardBackgroundCard.tsx](src/app/groups/[gid]/_components/CardBackgroundCard.tsx) — 新規（共通基底）
- [src/app/groups/[gid]/_components/WinnerCardBackgroundCard.tsx](src/app/groups/[gid]/_components/WinnerCardBackgroundCard.tsx) — 新規（thin wrapper）
- [src/app/groups/[gid]/_components/SeasonCardBackgroundCard.tsx](src/app/groups/[gid]/_components/SeasonCardBackgroundCard.tsx) — 新規
- [src/components/og/CardReadabilityPreview.tsx](src/components/og/CardReadabilityPreview.tsx) — 新規
- [src/app/groups/[gid]/group-detail-client.tsx](src/app/groups/[gid]/group-detail-client.tsx) — owner-only セクション追加
- [src/app/tournaments/[tid]/dashboard-client.tsx](src/app/tournaments/[tid]/dashboard-client.tsx) — cardBackground 伝搬
- [src/app/tournaments/[tid]/live/live-client.tsx](src/app/tournaments/[tid]/live/live-client.tsx) — 同上
- [src/components/tournament/WinnerCardDownloadButton.tsx](src/components/tournament/WinnerCardDownloadButton.tsx) — `cardBackground` / `groupName` prop
- [src/components/group/SeasonTopCardDownloadButton.tsx](src/components/group/SeasonTopCardDownloadButton.tsx) — `cardBackground` prop

**rules / config**
- [firebase.json](firebase.json) — Storage emulator port + rules path
- [playwright.config.ts](playwright.config.ts) — Storage emulator を webServer に追加

## Next Steps

1. `/prp-pr` で PR 作成（Codex review 用）
2. Codex に PR を投げ、本 review の MEDIUM-2（orphan 検出手順）と LOW-3（cache 24h 注意喚起）を
   運営ガイドへ追記するかどうかを別判断
3. CI で `npm run test:rules-card-background` / `npm run test:storage-rules` /
   `npx playwright test card-background.spec.ts` の全 green を確認
4. Vercel preview で OG カードの目視確認（明・暗・中間画像 × light/dark theme の 6 通り）
5. ドライラン投入後の Success Metric「3 サークル以上が `winnerCardBackground.imageUrl != null`」
   モニタリング開始
