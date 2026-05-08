# Local Code Review: PWA Phase A + Phase C（uncommitted changes）

**Reviewed**: 2026-05-08
**Branch**: develop
**Scope**: 03-pwa-app-shell の PWA 基盤（Phase A）と端末コントロール（Phase C）
**Decision**: APPROVE with comments（CRITICAL / HIGH なし、MEDIUM 4 件 / LOW 4 件）

## Summary

PWA manifest・Service Worker・Wake Lock / Orientation Lock 系の追加で、既存の error-logging / firebase-patterns 規約に沿った設計になっており、validation（typecheck / lint / 1149 unit / build）はすべて green。
ただし `useWakeLock` に pause→resume 急 toggle 時の race（in-flight request が原因で再取得を取りこぼす）と、Service Worker `RUNTIME_CACHE` の eviction 戦略不在が中位の懸念。CRITICAL / HIGH 級のセキュリティ・データ損失リスクは検出されなかった。

## Findings

### CRITICAL

None

### HIGH

None

### MEDIUM

#### M1. `useWakeLock` で active=true→false→true の急 toggle 時に再取得を取り落とす可能性

[src/lib/hooks/useWakeLock.ts:66-107](src/lib/hooks/useWakeLock.ts#L66-L107)

`acquire()` が `inflightRef.current` 非 null で early return する設計。以下のシーケンスで wake lock が静かに保持されない状態に陥る:

1. effect 1 mount（`active=true`）→ `inflightRef = p1`、await 中
2. `active=false` で effect 1 cleanup（`cancelled=true` / `releaseSentinel()`）。`p1` は in-flight なので `sentinelRef` は null のまま、release されずスルー
3. `active=true` に戻る → effect 3 の `acquire()` が `inflightRef.current === p1`（非 null）で early return
4. p1 resolve 時に `cancelled=true` 判定で sentinel が即 release され、`inflightRef = null`。だが effect 3 は再取得トリガを持たない
5. 結果: running 中なのに sentinel 未取得。`visibilitychange` 復帰までユーザは画面消灯リスクに晒される

**Fix（推奨）**: 新しい effect の `acquire()` は `inflightRef` を見て early return するのではなく、`await inflightRef.current` で待ってから自分の取得に進むか、generation counter / cleanup の中で `inflightRef` の cancel を検知して新 effect 側で retry を仕掛ける形が安全。最低限、test に「mid-request の active toggle」シナリオを追加し characterization する。

#### M2. Service Worker の `RUNTIME_CACHE` に eviction 戦略がない

[public/sw.js:96-98](public/sw.js#L96-L98)・[public/sw.js:113-115](public/sw.js#L113-L115)

`networkFirst` / `staleWhileRevalidate` のいずれも `cache.put(req, res.clone())` のみで容量制限・LRU・最古エントリ削除がない。長期 PWA 利用で:

- 全 HTML ナビゲーション結果が蓄積
- `_next/static/` のチャンク（Next.js は build ID ごとにチャンク URL が変わる）がデプロイ毎に積もる
- `/sounds/` の音声ファイルがすべて滞留

storage 上限（Chrome デフォルト ~60% of available disk）に達すると quota error で `cache.put` が突然失敗する。Phase A の運用範囲では顕在化しないが、最低限 `_next/static/` 用に「version key で古い chunks を活性 activate 時に削除する」戦略を入れるか、entry 数上限ベースの簡易 LRU を実装するのが望ましい。

**Mitigation**: 当面 `CACHE_VERSION` を bump すれば古 cache がまとめて消えるので Phase B/D で具体化する旨を README / Phase A report に明記。

#### M3. Service Worker が auth/ユーザ状態に依存する HTML を `RUNTIME_CACHE` に保存

[public/sw.js:92-108](public/sw.js#L92-L108)

`networkFirst` は `request.mode === "navigate"` のすべての HTML を runtime cache に格納する。本アプリは App Router の "use client" 比重が高く SSR HTML は概ねシェルだが、将来的に server component で auth-aware な内容（ユーザ名 / 役割 chip 等）を埋め込むと、別端末（同 PWA install）に cache 経由で透過する経路が成立する。

現状は実害ないが、`/groups/[gid]` 等の動的ルートを cache に詰める意義も薄い。「navigate でも auth scope を含む可能性のある path（`/groups/**` / `/tournaments/**` / `/settings`）は cache 対象外」とする allowlist 化を Phase D 以降で検討すること。最低限コメントで「現時点で SSR 経路に user-private データが乗らない前提」を明記しておくと将来の踏み外しが防げる。

#### M4. `DeviceFallbackHints` の `aria-label` が機械可読 ID で人間向けでない

[src/components/tournament/DeviceFallbackHints.tsx:23](src/components/tournament/DeviceFallbackHints.tsx#L23)

```tsx
<section aria-label="device-fallback-hint" ...>
```

スクリーンリーダーは aria-label の文字列をそのまま読み上げるため「device fallback hint」と発話される。`accessibility` 規約と CLAUDE.md の「ユーザー向けメッセージに技術スタック名を出さない」方針に照らして、人間が理解できるラベルに直す:

```tsx
<section aria-label="端末の注意" ...>
```

または `<section role="note">` で `aria-label` を外し、本文をラベル代わりにする（`<IOsInstallHint>` がこの形を採用済み — 同じパターンに揃えると統一感が出る）。

### LOW

#### L1. `IOsInstallHint` に dismiss 経路がない

[src/components/pwa/IOsInstallHint.tsx](src/components/pwa/IOsInstallHint.tsx)

iOS 訪問者は毎回バナーを見せられる。Phase D で role gating（member 以外に非表示）を入れる予定とコメントにあるため低優先で OK だが、`localStorage` で「閉じた」フラグを管理する経路を最終的に検討すること。

#### L2. `resumeAudioContext().catch(...)` の挙動に test がない

[src/components/tournament/_timer-controls/TimerControlsRunningPaused.tsx:121-128](src/components/tournament/_timer-controls/TimerControlsRunningPaused.tsx#L121-L128)
[src/components/tournament/_timer-controls/TimerControlsSeating.tsx:50-57](src/components/tournament/_timer-controls/TimerControlsSeating.tsx#L50-L57)

resume 直後 / seating confirm 直後の AudioContext unlock は `audio-context.ts` 側で wrap 済みとはいえ、TimerControls の click ハンドラ経路で必ず `resumeAudioContext` が呼ばれることを担保する unit test がない。今後 button onClick の構造変更でリグレッションが入った際に検出できない。`run` callback 内で resume が確実に呼ばれるテストを追加すると安全。

#### L3. `useWakeLock` の戻り値のうち `held` / `lastError` が consumer 側で未使用

[src/app/tournaments/[tid]/dashboard-client.tsx:104](src/app/tournaments/[tid]/dashboard-client.tsx#L104)

`wakeLock.supported` のみ参照されており、`held` / `lastError` を提供する API 設計が現状用途に対して過剰。Phase D 以降で wake lock 状態を UI に表示する用途が確定するまで `useWakeLockSupported(): boolean` のような最小化を検討してもよい（YAGNI）。今 phase では現状で OK。

#### L4. `useOrientationLock` は `unlock()` を呼ばない

[src/lib/hooks/useOrientationLock.ts](src/lib/hooks/useOrientationLock.ts)

dashboard unmount 時に `screen.orientation.unlock()` を呼ばないため、PWA standalone で別ページに遷移しても landscape 固定が残る可能性。Phase C 設計では「セッション中ずっと landscape」を意図しているとのコメントがあり、実害はないが、明示的にコメントで「unlock せず維持する設計」と記録しておくと将来の改修者が驚かない。

## 設計妥当性のチェック（PASS）

- **既存規約準拠** ✅
  - `error-logging.md`: すべて `AppError.from` + logger.warn 経由、`console.*` 直呼びなし
  - `firebase-patterns.md`: Firestore SDK 直接呼出なし（PWA 層は Firestore 非依存）
  - `security-base.md`: 秘密情報なし。manifest / SW 内に外部キーなし
  - `testing.md`: hook / component に対し helper 境界での mock を使用、observable behavior 検証
- **Service Worker 設計** ✅
  - cross-origin（Firestore / Google APIs）は SW で扱わずスルー（IndexedDB の既存パスを壊さない）
  - HTML は network-first / static は SWR で TDA ガイドラインを踏襲
  - dev では SW を register しない（`process.env.NODE_ENV !== "production"` で early return）
  - `/sw.js` への `Cache-Control: no-cache` を [next.config.ts](next.config.ts) で強制し、`updateViaCache: "none"` と二重防御
- **a11y** ✅（M4 を除く）
  - `IOsInstallHint`: `role="note"` + 本文ラベル、Lucide icon に `aria-hidden`
  - `DeviceFallbackHints`: 同様、ただし aria-label が機械的（M4 で指摘）
- **YAGNI / KISS** ✅
  - Service Worker は precache + 最小限の runtime caching に絞る（workbox 等の依存を増やしていない）
  - PWA icon は monogram の自前生成スクリプト（`sharp` 1 件のみ追加）
- **type safety** ✅
  - `Navigator & { standalone?: boolean }` / `ScreenOrientation & { lock?: ... }` の structural type で any を使わず feature detection

## Validation Results

| Check       | Result   | Notes                                  |
| ----------- | -------- | -------------------------------------- |
| Type check  | **Pass** | `tsc --noEmit` 完走、エラー 0          |
| Lint        | **Pass** | ESLint warnings 0 / errors 0           |
| Unit tests  | **Pass** | 64 files / 1149 tests pass             |
| Build       | **Pass** | `next build` 完走、`/manifest.webmanifest` を含む全ルート出力 |
| Emulator rules | Skipped | rules / firestore 未変更のため対象外  |

## Files Reviewed

### Modified

- `README.md` — PWA 動作確認手順の追記（Modified）
- `next.config.ts` — `/sw.js` の Cache-Control / Content-Type ヘッダ追加（Modified）
- `src/app/layout.tsx` — manifest / icons / appleWebApp / viewport 追加、SW 登録 / iOS hint mount（Modified）
- `src/app/tournaments/[tid]/dashboard-client.tsx` — useWakeLock / useOrientationLock 統合、DeviceFallbackHints mount（Modified）
- `src/components/tournament/_timer-controls/TimerControlsRunningPaused.tsx` — resume click で `resumeAudioContext` 経由 unlock（Modified）
- `src/components/tournament/_timer-controls/TimerControlsSeating.tsx` — confirmSeating click で同上（Modified）

### Added

- `src/app/manifest.ts` — Next.js 15 公式パターンの `MetadataRoute.Manifest`（Added）
- `public/sw.js` — vanilla JS の Service Worker（Added）
- `public/icons/{apple-icon-180,icon-192,icon-512,icon-512-maskable}.png` — 自動生成 PWA アイコン（Added）
- `scripts/generate-pwa-icons.mjs` — sharp ベースの icon generator（Added）
- `src/components/pwa/IOsInstallHint.tsx` + `.test.tsx` — iOS 向け install hint バナー（Added、4 unit tests）
- `src/components/pwa/ServiceWorkerRegistration.tsx` — production 限定 SW 登録 client component（Added）
- `src/components/tournament/DeviceFallbackHints.tsx` — Wake Lock 未対応 UA 向け案内カード（Added）
- `src/lib/hooks/useWakeLock.ts` + `.test.tsx` — Wake Lock API hook（Added、6 unit tests）
- `src/lib/hooks/useOrientationLock.ts` + `.test.tsx` — Orientation Lock API hook（Added、4 unit tests）
- `.claude/PRPs/03-pwa-app-shell/` — PRD / plans / reports 一式（Added、本レビュー対象外）

## Suggested Next Steps

1. **M1（wake lock race）** を Phase B 着手前に修正、もしくは `phase-c-device-controls-report.md` の Known Issues に明記して受容判断を残す
2. **M4（aria-label）** を本 PR の段階で修正（小コスト・a11y 規約）
3. **M2 / M3（SW cache）** を Phase D の「PWA polish」フォローアップ項目として `03-pwa-app-shell.prd.md` に追記
4. iOS Safari 16.4+ の実機 / Android Chrome 実機での Lighthouse PWA スコア確認結果を `phase-a-pwa-foundation-report.md` に追記（README 手順に従って）
