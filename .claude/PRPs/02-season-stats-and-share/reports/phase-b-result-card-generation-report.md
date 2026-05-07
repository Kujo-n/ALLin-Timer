# Implementation Report: Phase B — Result Card Generation

## Summary

優勝カード（トーナメント終了時）と シーズン首位カード（ランキング画面）の 2 種を、Next.js 15 同梱の `next/og`（`ImageResponse`）で SSR PNG 生成し、`<a download>` 経由でダウンロード可能にした。Node.js runtime + `@fontsource/noto-sans-jp` の WOFF を `node:fs` から読込む構成。データはクライアントが query 文字列で渡す client-pass-data 方式（Phase B では Firebase Admin SDK 不要、観戦モード未実装の現状で UI 認証 gate のみで十分という PRD 判断）。

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
| ----- | ---------------- | ------ |
| Complexity | Medium | Medium（plan 通り） |
| Estimated Files | 約 12 files | 13 files（route handler ペアごとの test を含めた CREATE 11 + UPDATE 4） |
| Confidence | n/a | High（typecheck / lint / test / build 全 PASS、回帰なし） |

## Tasks Completed

| # | Task | Status | Notes |
| - | ---- | ------ | ----- |
| 1 | 依存追加（@fontsource/noto-sans-jp） | [done] Complete | 5.2.9 を追加。`next/og` は next 15.5 に同梱で追加不要を確認 |
| 2 | og-card-styles 定数 | [done] Complete | OG_WIDTH / OG_HEIGHT / 色 / フォント / padding を 1 ファイルに集約 |
| 3 | og-payload zod schema + URL builder + テスト | [done] Complete | 23 件 UT（境界 / null / encodeURIComponent 等） |
| 4 | load-font helper | [done] Complete | Deviated — WOFF を採用（plan は TTF を期待） |
| 5 | winner card route | [done] Complete | 5 件 UT（200/400/500 + 引数 + ISO date 検証） |
| 6 | season card route | [done] Complete | 6 件 UT（top1 のみ / null seasonStartDate / 不正 / font 失敗） |
| 7 | WinnerCardDownloadButton + テスト | [done] Complete | 3 件 UT |
| 8 | SeasonTopCardDownloadButton + テスト | [done] Complete | 5 件 UT（空 / 1 件 / 5 件 / null / filename ASCII） |
| 9 | dashboard-client / live-client にボタン挿入 | [done] Complete | `<WinnerBanner>` 直下に flex justify-center で配置 |
| 10 | season-ranking-client にボタン挿入 | [done] Complete | `stats.length > 0` 分岐内、表の上に右寄せ |
| 11 | PRD 更新（in-progress + plan link） | [done] Complete | 既に in-progress + リンク済（plan 作成時に Phase A 完了に伴い更新済） |
| 12 | README 軽微更新 | [skipped] | scripts 表に変更なし、Phase B の SNS 共有は Phase D で polish するため最終形で更新する判断 |

## Validation Results

| Level | Status | Notes |
| --------------- | ----------- | --------------- |
| Static Analysis (typecheck) | [done] Pass | tsc --noEmit ゼロエラー |
| Lint | [done] Pass | next lint No warnings or errors |
| Unit Tests | [done] Pass | 全 53 ファイル / 978 件 PASS（Phase A の 940 → +38 件追加、全件 green） |
| Build | [done] Pass | `/api/og/winner/[tid]` / `/api/og/season/[gid]` が ƒ Dynamic として登録 |
| Rules Limits | [done] Pass | 9/9 ALL GREEN（Phase B では rules 触らないため変更なし） |
| Integration | [skipped] | dev server 起動・curl 確認は manual validation 分担。font 読込は process.cwd() 経由で local 動作確認済み |

## Files Changed

| File | Action | 概要 |
| ---- | ------ | ---- |
| `package.json` | UPDATED | @fontsource/noto-sans-jp 5.2.9 追加 |
| `src/app/api/og/_lib/og-card-styles.ts` | CREATED | 色 / 寸法 / フォント定数 |
| `src/app/api/og/_lib/og-payload.ts` | CREATED | zod schema + URL builder + sanitizeFilename |
| `src/app/api/og/_lib/og-payload.test.ts` | CREATED | 23 件 UT |
| `src/app/api/og/_lib/load-font.ts` | CREATED | Noto Sans JP WOFF 読込 + module cache |
| `src/app/api/og/winner/[tid]/route.tsx` | CREATED | 優勝カード SSR (Node.js runtime) |
| `src/app/api/og/winner/[tid]/route.test.ts` | CREATED | 5 件 UT (200/400/500) |
| `src/app/api/og/season/[gid]/route.tsx` | CREATED | シーズン首位カード SSR (Node.js runtime) |
| `src/app/api/og/season/[gid]/route.test.ts` | CREATED | 6 件 UT |
| `src/components/tournament/WinnerCardDownloadButton.tsx` | CREATED | shadcn Button asChild + `<a download>` |
| `src/components/tournament/WinnerCardDownloadButton.test.tsx` | CREATED | 3 件 UT |
| `src/components/group/SeasonTopCardDownloadButton.tsx` | CREATED | top3 まで slice + null seasonStartDate 対応 |
| `src/components/group/SeasonTopCardDownloadButton.test.tsx` | CREATED | 5 件 UT |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | UPDATED | WinnerBanner 直下に download ボタン |
| `src/app/tournaments/[tid]/live/live-client.tsx` | UPDATED | 同 |
| `src/app/groups/[gid]/season/season-ranking-client.tsx` | UPDATED | 表の直前に download ボタン |

## Deviations from Plan

### D1: フォントファイル形式 TTF → WOFF

- **WHAT**: plan は `node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-{400,700}-normal.ttf` を読む前提だったが、`@fontsource/noto-sans-jp` 5.2.9 のパッケージレイアウトは `.woff` / `.woff2` のみで `.ttf` を出力しない。
- **WHY**: パッケージの実態に合わせ、Satori（next/og の実体）が解ける WOFF を採用。`load-font.ts` のコメントで deviation を明示。
- **影響**: なし（WOFF も Satori でサポートされ、ファイルサイズも約 1.4MB / weight で同等）

### D2: emoji の扱い

- **WHAT**: plan 記載の 🏆 / 🥇 / 🥈 / 🥉 を ImageResponse 内で使う案を採用せず、英字ラベル（winner: `TOURNAMENT CHAMPION` / season: `1ST` / `2ND` / `3RD`）にした。plan の UX ASCII にあった `OPTIMAL CHAMPION` は英語として不自然（"optimal" は最適化文脈の語で "champion" と相性が悪い）なため、レビュー指摘を受けて `TOURNAMENT CHAMPION` に修正済。
- **WHY**: Satori の emoji レンダリングはフォント依存で 2026 年時点では twemoji オーバーライドが必要。Phase B は最小実装で「日本語が崩れずに描画される」ことを最優先とし、emoji の追加検証は Phase D の polish に回す判断。
- **影響**: 視覚的に控えめだが、サークル LINE 共有用途として可読性が高い ASCII ラベルが使える。WinnerBanner 本体（HTML）の 🏆 はそのまま。

### D3: README 更新を見送り

- **WHAT**: plan の Task 12（README 軽微更新）を skip。
- **WHY**: scripts 表に変更がなく、Phase B の SNS 共有は Phase D（Web Share API）で完成形になるため、最終形で 1 度更新する方が運用ノイズが少ない判断。Phase B 機能自体は本 report と PRD で記録される。
- **影響**: README の「機能」節は Phase D で更新する。

### D4: ImageResponse mock のテスト isolation

- **WHAT**: route.test.ts の `beforeEach` で `vi.mocked(ImageResponse).mockImplementation(...)` を毎回再設定する形にした。
- **WHY**: 当初 `afterEach(restoreAllMocks)` だけだと vi.fn() のインスタンスは impl を失い、2 回目以降のテストで `ImageResponse(...)` が undefined を返してしまった。`mockReset` + `mockImplementation` を beforeEach で揃え、`afterEach(clearAllMocks)` のみに切替。
- **影響**: テストが安定。実装側コードへの影響なし。

## Issues Encountered

### I1: テスト isolation の race condition

- 1 回目は通る、2 回目以降は通らない症状（mock implementation の消失）。
- 解決: D4 参照。

### I2: TypeScript の `ReturnType<typeof ImageResponse>` 不一致

- ImageResponse は class なので `ReturnType` は使えない。`InstanceType<typeof ImageResponse>` に修正。
- 解決: route.test.ts 2 ファイルで `as unknown as InstanceType<typeof ImageResponse>` に変更。

## Tests Written

| Test File | Tests | Coverage |
| --------- | ----- | -------- |
| `src/app/api/og/_lib/og-payload.test.ts` | 23 件 | zod schema 境界 / URL builder / sanitizeFilename |
| `src/app/api/og/winner/[tid]/route.test.ts` | 5 件 | 200/400/500 status / fonts arg / ISO date validation |
| `src/app/api/og/season/[gid]/route.test.ts` | 6 件 | top2/top3 optional / null seasonStartDate / 不正 / font fail |
| `src/components/tournament/WinnerCardDownloadButton.test.tsx` | 3 件 | href / filename ASCII / 特殊文字 escape |
| `src/components/group/SeasonTopCardDownloadButton.test.tsx` | 5 件 | 空 / 1 件 / 5 件 (slice 3) / null seasonStartDate / filename ASCII |
| **合計** | **42 件** | |

Phase A 完了時 940 件 + 本 phase 38 件追加で全 978 件 PASS。

## Risks Realized / Mitigated

- **Risk**: 偽の優勝者カード生成（access control 不在） — **Realized as documented**: 観戦モード未実装の現状ではトレードオフを許容。Phase D 以降で再評価。
- **Risk**: Edge runtime と node:fs の不整合 — **Mitigated**: `runtime = "nodejs"` を両 route 先頭で export。lint 検出はないが、コメントで明示。
- **Risk**: emoji レンダリング失敗 — **Mitigated**: 英字ラベルに切替（D2）。
- **Risk**: `@fontsource/noto-sans-jp` のレイアウト変化 — **Realized**: TTF → WOFF へ deviation（D1）。`load-font.ts` 1 ファイルに path 集約済で将来追従が容易。

## Next Steps

- [ ] Code review via `/code-review`
- [ ] Manual validation（dev server で実際に PNG が生成されるか目視確認、特に日本語フォント描画）
- [ ] Create PR via `/prp-pr`
- [ ] PRD Phase B を `complete` に更新（manual validation 通過後）
- [ ] Phase D で Web Share API + emoji レンダリング polish + README 更新
