# PWA 化と一時通信障害耐性

## Problem Statement

ALLin-PokerTimer は会場 Wi-Fi が不安定な環境（特に Wi-Fi 設備のない会場）でも運営者がタイマーを止めずに進行する必要があるが、現状は通信が一瞬切れただけで **ブラインドレベルの自動進行が止まる**。原因は `advanceLevel(auto)` が `runTransaction` ベースで実装されており、Firestore のオフライン書込キューに乗らず即時失敗するため。
加えて、URL ブックマーク経由の起動では会場到着時の手間が大きく、運営者が「タイマー画面を投影 → 操作」する一連の所作の摩擦になっている。
両者の不在は、月 1〜2 回の小規模サークル運用で「会場での運営精度低下」と「タイマー停止による進行ミス」を招き、PRD 01 / 02 で築いた基盤の最後の体感品質ギャップになっている。

## Evidence

- 開発者本人が会場参加した際、よく使う会場の一つに **Wi-Fi 設備がない**ことを確認している。当該会場ではスマホのモバイル回線で運営する前提が成立しているが、地下・トンネル隣接など一時的な通信障害は避けられない
- ドライラン時の会場は Wi-Fi ありだったため「タイマーが止まる」事象は未観測。ただし `advanceLevel(auto)` の `runTransaction` 実装（[tournaments.ts#L398-L429](src/lib/firebase/repositories/tournaments.ts#L398-L429)）は **Firestore のオフライン書込キューに乗らず即時失敗する** 仕様であり、通信障害が起きれば再現する（市場リサーチで Firestore 公式ドキュメントが明示）
- PRD 01 / 02 の機能群が一通り揃った今、会場運用の体感最終仕上げとして優先度が上がっている（ユーザー Q4 a 回答）

## Proposed Solution

3 つの領域を「**会場運用体感パック**」として 1 PRD にまとめる。

1. **⑪ PWA 化**: `app/manifest.ts` または `public/manifest.json` を導入し、apple-touch-icon meta tags + アイコン素材を整備。Service Worker でアプリシェル precache + runtime stale-while-revalidate を行い、一時通信障害時に UI が真っ白にならないようにする。Next.js 15 公式 PWA ガイドの素 SW 構成を採用（Turbopack 互換性のため）
2. **🆕 タイマー進行のオフライン耐性化**: `advanceLevel(auto)` の `runTransaction` を「**tx 試行 → tx 失敗時は updateDoc fallback**」の二段構えに書き換え、一時通信障害時もブラインドレベルが進むようにする。手動「次レベル」ボタン / `pauseTournament` / `resumeTournament` は既に `updateDoc` ベースのため修正不要
3. **🆕 デバイス制御**: タイマー画面で Wake Lock API（画面消灯防止）と `screen.orientation.lock`（横向き固定）を有効化。AudioContext unlock を「タイマー開始ボタン押下時に確実に実行」する設計に強化（既存 `SoundUnlockBanner` の補助）
4. **🆕 運営者向けインストール促進**: `useGroupRole(gid)` で `role !== "member"` のときに `beforeinstallprompt` イベントを保持してカスタムバナーを出す（Android Chrome）。iOS は `beforeinstallprompt` 非対応のため UA 判定で「共有 → ホーム画面に追加」のテキスト案内を出す

採用理由: PWA 化と「auto-advance fallback」は技術的に独立しているが、**両者が揃って初めて「会場で起動 → 通信障害でも止まらない」体感**が成立する。マスター機 1 台モード / ゲスト受付（旧スコープ）は影響範囲が大きすぎるため別 PRD に分離（PRD 01 Phase 5.x 候補に戻す）。

## Key Hypothesis

我々は「**PWA 化（ホーム画面追加 + 一時通信障害耐性）と運営者向けインストール促進**」が「**会場 Wi-Fi 不安定によるタイマー停止イベントと、URL 再アクセスの煩わしさ**」を「**月 1〜2 回開催のサークル運営者**」に対して解決すると信じている。
我々が正しかったと判断するのは、以下が観測されたとき:

- **開発者がサークル参加時に、ホーム画面アイコンから起動した PWA でタイマー進行中に通信が一瞬切れても、ブラインドレベルが正しく進むことを目視確認**できること
- **運営者の誰かがホーム画面に PWA インストールしたと運営チャットで報告**されること

## What We're NOT Building

- **マスター機 1 台モード（メンバー選択代理受付・ゲスト受付）** — 影響範囲が大きく、`pid==uid` invariant の rule branch 拡張、Firestore 書込経路の大規模見直しが必要。ユーザー方針として「Wi-Fi が無い会場ではモバイル回線でオンライン保持」が前提のため、本 PRD では扱わない。将来 PRD 01 Phase 5.x 候補として再評価
- **オフラインで優勝者確定（`finishTournament` の writeBatch 化）** — `seasonStats` 集計の atomicity を保つため tx 必須。一時通信障害ケアの範疇外で、`finishTournament` は引き続き online 必須として許容。会場でモバイル回線が完全に死んでいる場合は復帰後に「終了」ボタンを押す運用
- **`commitInitialSeating` / `applyTableBreak` / `assignSeat` のオフライン耐性化** — これらも `runTransaction` ベースだが、初回席決め・テーブル閉鎖・席変更は会場到着前 / 通信回復後に実施できる運用前提
- **Web Push 通知** — iOS の制約多（iOS 16.4+ + ホーム画面追加 + EU 圏外）+ サークル運用での必要性が低い
- **Persistent Storage API** — 通知許可が必須となり、CLAUDE.md の「ユーザー向けメッセージに技術スタック名を出さない」規約とも整合させづらい
- **観戦モード URL（`/spectate/[tid]`）** — 別 PRD（04）として後続。Firestore Rules の unauthenticated read 解放という別軸の話
- **multi-tab 同時運用の完全サポート** — Firestore SDK の multi-tab leader race 既知バグ（[firebase-js-sdk#6511](https://github.com/firebase/firebase-js-sdk/issues/6511)）回避のため、Could として「警告 UI のみ」で対応。「複数端末で同時に運営者が操作する」シナリオは公式サポート外
- **`display: "fullscreen"` モード対応** — iOS Safari は `standalone` のみ。fullscreen 表現は `useFullscreen` の既存 Fullscreen API と PWA standalone display の組合せで擬似的に実現

## Success Metrics

| Metric | Target | How Measured |
| ---- | ---- | ---- |
| 一時通信障害時のタイマー継続 | 開発者がサークル参加時に**目視確認**で 1 回以上観測 | サークル参加時に DevTools で network throttling → ブラインド進行確認 |
| 運営者の PWA インストール | 運営チャットで**1 回以上報告**される | 運営者からの定性的フィードバック |
| 自動レベル進行のオフライン耐性 | `advanceLevel(auto)` が tx 失敗時 100% updateDoc fallback で完遂 | unit test で fallback 経路の挙動を assert |

## Open Questions

- [x] Service Worker の precache 対象 routes 範囲 — **shell URLs（`/`, `/login`, `/manifest.webmanifest`, `/icons/*`）に限定**。動的 route は runtime cache（network-first / SWR）に倒す（Phase A plan で確定）
- [x] アイコン素材の作成方針 — **運営者提供のロゴ（`public/icons/icon_pwa.png` — 赤円 + 白三角 + "ALL IN" 文字）を採用**。`scripts/generate-pwa-icons.mjs` が source を trim → 円形マスク → 4 サイズに自動変換する（Phase A 実装で確定）
- [ ] PWA install promotion UI の表示頻度 — 毎回 / 初回のみ / dismiss 永続化。Phase D 実装計画で確定
- [ ] `advanceLevel(auto)` の二段構え実装の race 解決方式 — tx 失敗時 updateDoc fallback で「現値 +1」を投げると、復帰時に他端末の advance と二重 increment する race の余地がある。`if (currentLevel === expected) updateDoc({ currentLevel: expected + 1 })` の楽観 update でガードするか、復帰時 reconcile を入れるか。Phase B 実装計画で確定
- [ ] iOS Safari Wake Lock API の対応状況（2026 時点） — Phase C 着手時に DevTools で確認、対応外なら fallback として「画面 off にしないでください」テキスト案内
- [x] 7 日無アクセス自動削除（iOS の ITP 7-day cap）への対策 — **起動時 SW re-register（`ServiceWorkerRegistration` が mount のたびに `register` 呼出）で対処**。critical asset 再取得は `updateViaCache: "none"` + `Cache-Control: no-cache, no-store, must-revalidate` で SW スクリプト自身が cache されないことで間接的に保証（Phase A plan で確定）

---

## Users & Context

**Primary User**

- **Who**: ALLin-PokerTimer を月 1〜2 回利用するサークルの **owner / organizer（運営者）**。会場でタイマー画面を投影 / 手元端末で操作する人
- **Current behavior**: ブラウザブックマークまたは URL 直打ちで `/tournaments/[tid]` を開いている。会場 Wi-Fi が不安定だと「ブラインドが上がらない」「リロードで止まる」事象を経験。アプリ起動の所作にも摩擦がある
- **Trigger**: 会場到着 → タイマー起動の瞬間 / 進行中に通信障害が起きた瞬間
- **Success state**: ホーム画面アイコンタップ → standalone 起動（URL バー / タブが消える） → 通信が一時切れてもタイマー継続 → 復帰時に状態が正しく同期。会場プロジェクタ投影中に画面が消灯しない

**Job to Be Done**

- 運営者: 「**会場でタイマー進行中**、**会場 Wi-Fi が不安定 / モバイル回線が一瞬切れる**ので、**ブラインド進行を止めずに運営を完遂したい**」
- 運営者: 「**会場到着時のアプリ起動所作を最小化**したいので、**ホーム画面のアイコン 1 タップで standalone 起動**したい」
- 運営者: 「**会場プロジェクタ投影中**、**画面消灯やローテーションでタイマーが見えなくなる**ので、**画面消灯防止と横向きロックをアプリ側で制御**したい」

**Non-Users**

- **会場参加者（member）**: 自分の席を確認する用途。PWA インストールを必須とせず、ブラウザ閲覧でも体験は維持される（インストール促進 UI は表示しない）
- **完全オフライン環境で運営したい人**: 本 PRD のスコープ外。Wi-Fi 設備のない会場でもモバイル回線で online 保持する前提
- **観戦者・家族・配信視聴者**: 観戦モード URL は別 PRD（04）として後続
- **大規模公式トーナメント運営者**: multi-tab 同時運用 / 複数端末からの並行操作は公式サポート外

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
| ---- | ---- | ---- |
| Must | ⑪ `app/manifest.ts` または `public/manifest.json` 設置（display: "standalone" / theme-color / icons） | ホーム画面追加のための最低線。Next.js 15 App Router の公式 metadata API で記述 |
| Must | ⑪ apple-touch-icon / theme-color / status-bar-style meta tags | iOS Safari でのホーム画面追加時の体験品質確保 |
| Must | ⑪ アイコン素材（192x192 / 512x512 / apple-touch-icon 180x180） | manifest と同時に必要 |
| Must | ⑪ Service Worker（app shell precache + runtime stale-while-revalidate） | 一時通信障害時の UI 凍結防止 |
| Must | 🆕 **`advanceLevel(auto)` の tx → updateDoc fallback** | オフライン耐性の核心。「ブラインドレベルが上がらない」の直接修正 |
| Must | 🆕 オフライン状態の可視化（pending writes badge / 通信障害中バナー） | 運営者が「今 queue 中」を理解できる |
| Must | 🆕 PWA install 促進 UI（owner / organizer 限定） | Q3「運営者にはインストールを進める」に直接対応 |
| Should | 🆕 Wake Lock API（タイマー画面で画面消灯防止） | 会場プロジェクタ投影で重要 |
| Should | 🆕 `screen.orientation.lock`（横向きロック） | タイマー画面の安定表示 |
| Should | 🆕 AudioContext unlock の自動化強化（タイマー開始ボタン押下で確実に unlock） | autoplay 制約対策。既存 `SoundUnlockBanner` の補助 |
| Should | 🆕 iOS 用「共有 → ホーム画面に追加」テキスト案内 | `beforeinstallprompt` 非対応 fallback |
| Could | 🆕 multi-tab 同時オープン警告 UI | Firestore multi-tab leader race 既知バグ回避 |
| Won't | マスター機 1 台モード（メンバー選択受付・ゲスト受付） | 別 PRD。`pid==uid` invariant の大規模再設計が必要 |
| Won't | オフラインで優勝者確定（`finishTournament` writeBatch 化） | `seasonStats` の atomicity 維持のため online 必須として許容 |
| Won't | 観戦モード URL | 次 PRD 04 |
| Won't | Web Push 通知 | iOS 制約多 + 必要性低 |

### MVP Scope

仮説検証に最低限必要な範囲:

- ⑪ manifest.json + apple-touch-icon meta tags + アイコン素材 192/512/180
- ⑪ Service Worker による static asset precache + runtime cache（network-first for HTML / stale-while-revalidate for static）
- 🆕 `advanceLevel(auto)` の tx 失敗時 updateDoc fallback
- 🆕 オフライン状態の可視化バナー（`onSnapshot({ includeMetadataChanges })` + `hasPendingWrites` 検出ベース）
- 🆕 owner / organizer 限定の PWA install 促進バナー（`beforeinstallprompt` event 保持 + iOS UA 判定 fallback）

### User Flow

**運営者の会場運用フロー**:
1. （初回）`/tournaments/[tid]` 訪問 → owner / organizer ロール検出 → 「ホーム画面に追加」バナー表示
2. インストール → ホーム画面アイコンから standalone 起動 → URL バー消失 + status bar 半透明
3. タイマー画面で「開始」ボタン押下 → AudioContext unlock + Wake Lock 取得 + screen.orientation.lock
4. 進行中に通信が一瞬切れる → 通信障害バナー表示 + タイマー継続 + auto-advance は updateDoc fallback で進む
5. 通信復帰 → pending writes flush + バナー消失

**参加者の閲覧フロー**:
1. `/tournaments/[tid]/live` または `/join/[tid]` 訪問 → member ロール検出 → install バナー非表示
2. ブラウザ閲覧で席表 / タイマー確認 → PWA インストールは任意

**通信障害時のフロー**:
1. ネットワーク切断 → SW が cache から HTML/JS 提供 → UI 凍結なし
2. 進行中の `updateDoc` / `writeBatch` は queue → online 復帰時 flush
3. `runTransaction` 経路（auto-advance）は fallback で updateDoc 化 → ブラインドレベル進行
4. `finishTournament`（優勝者確定）は online 必須 → 「終了」ボタン押下時に「通信を確認してから再試行してください」エラー表示

---

## Technical Approach

**Feasibility**: HIGH

既存の Firestore オフライン永続化（[client.ts#L86-L88](src/lib/firebase/client.ts#L86-L88) で `persistentLocalCache + persistentMultipleTabManager` 有効化済み）と既存の AudioContext unlock pattern（[audio-context.ts](src/lib/audio/audio-context.ts) / [SoundUnlockBanner.tsx](src/components/audio/SoundUnlockBanner.tsx)）と既存の Fullscreen hook（[useFullscreen.ts](src/lib/hooks/useFullscreen.ts)）が活用できる。新規発明する設計要素は **PWA 関連ファイル一式 + auto-advance fallback** のみ。

**Architecture Notes**

- ⑪ PWA 構築は **Next.js 15 公式 PWA ガイドの素 SW 構成**を採用（`app/manifest.ts` で manifest 生成、`public/sw.js` で素の Service Worker、`navigator.serviceWorker.register("/sw.js")`）。`@serwist/next` は webpack 用ガイドが正式版で Turbopack β 状態のため避ける（本プロジェクトは `npm run dev` で Turbopack デフォルト）
- ⑪ precache 戦略は **会場で必要な routes に絞る**: `/`, `/groups`, `/groups/[gid]`, `/tournaments/[tid]`, `/tournaments/[tid]/seating`, `/tournaments/[tid]/live`, `/join/[tid]`. 静的アセット（`_next/static/*`）は build manifest から自動 precache。iOS Cache 50MB 上限に収める
- ⑪ runtime キャッシュ戦略: HTML は **network-first**（最新性優先）、静的アセット（CSS/JS/画像）は **stale-while-revalidate**、Firestore 通信（`firestore.googleapis.com`）は SW で **キャッシュしない**（IndexedDB 側に既存）
- 🆕 `advanceLevel(auto)` の二段構え: 既存の `runTransaction` 経路を保持しつつ、catch で `unwrapOrFrom` 経由で `firestore/unavailable` 系のエラーを判定 → `updateDoc(tournamentsRef, { currentLevel: expected + 1, ...levelTransitionUpdates })` で fallback。tx fallback 経路は **race 解決を諦める**代わりに「online 復帰時に他端末との同期で eventual consistency に倒す」設計
- 🆕 オフライン状態可視化: `subscribeTournament` の payload に既に `hasPendingWrites` が含まれている（[tournaments.ts#L786-L800](src/lib/firebase/repositories/tournaments.ts#L786-L800)）ため、UI 層で `useState + useEffect` 経由でバナーを出すだけ。新規 hook 1 つで対応
- 🆕 PWA install promotion UI: `useGroupRole(gid)` ([useGroupRole.ts](src/lib/hooks/useGroupRole.ts)) で role 判定し、`role !== "member"` のときのみ `beforeinstallprompt` イベントを capture してカスタム install button を render。iOS UA 判定は `navigator.userAgent` で `iPad` / `iPhone` / `iPod` 検出 + `display-mode: standalone` 未起動時のみ表示
- 🆕 Wake Lock / orientation: タイマー画面（`/tournaments/[tid]` の running 状態時）で `navigator.wakeLock.request("screen")` を発行。release は visibilitychange で再取得 + `state="finished"` 遷移時に解放。横向きロックは `screen.orientation.lock("landscape")` を試行（PWA standalone モードのみ動作）
- 🆕 AudioContext unlock 強化: `useAudioPlayer` hook 内でタイマー開始ボタン押下時に **必ず `resumeAudioContext()` を await** し、unlock 失敗時はバナー表示にフォールバック。既存 `SoundUnlockBanner` を保持しつつ呼出経路を二重化
- アイコン素材は `public/icons/` 配下に配置し、`<NextImage>` で参照。192x192 / 512x512 / 180x180（apple-touch-icon）の最低 3 サイズ + maskable icon 1 種

**Technical Risks**

| Risk | Likelihood | Mitigation |
| ---- | ---- | ---- |
| Turbopack（Next.js 15 デフォルト dev runtime）と Service Worker の dev 環境衝突で `npm run dev` が壊れる | M | Phase A の最初に dev 環境動作確認を必ず実施。SW 登録は `process.env.NODE_ENV === "production"` で gate するか、dev は SW 無効化。Vercel build でも別途検証 |
| `advanceLevel(auto)` の updateDoc fallback で他端末と二重 advance が発生し、`currentLevel` が期待外の値になる | L | tx 失敗 → updateDoc fallback は楽観 update（tx 内 expected check と同じ条件を client で再 check）に倒す。万一 race が起きても `currentLevel` は単調増加で値域内のため壊滅的影響はない。Phase B の characterization test で網羅 |
| iOS Cache 50MB 上限超過で precache 失敗 | M | precache 対象を会場で必須の routes に絞る。Vercel build 後の bundle size を測定し、超過しそうなら critical CSS のみ precache + runtime に移行 |
| iOS の 7 日無アクセス自動削除で月 1〜2 回開催の本アプリが「常に未キャッシュ状態」になる | M | 起動時 SW re-register + critical asset re-fetch を入れる。または「初回起動時の precache 時間が許容範囲内」であれば許容（Open Question） |
| Firestore multi-tab leader race の stale data emit バグ（[firebase-js-sdk#6511](https://github.com/firebase/firebase-js-sdk/issues/6511)）が複数端末同時運用で再現 | L | Could として警告バナーで対応。「運営者は 1 端末」を運用ルールとして明示 |
| `beforeinstallprompt` の発火条件（user engagement minimum）を満たさず、Android Chrome でも install banner が出ない | L | manifest の最小要件（HTTPS / display:standalone / icons 192&512 / SW 登録）を全て満たすことで確率を高める。dev 中に Chrome DevTools の Application タブで手動 trigger テスト |
| Wake Lock API が iOS Safari 17 以前で未対応 | L | feature detection で `if ("wakeLock" in navigator)` 判定し、未対応はテキスト案内（「画面 off にしないでください」）に fallback |
| autoplay unlock が standalone PWA でも依然として user gesture 必須で、タイマー開始時の音声が鳴らない | M | 既存 `SoundUnlockBanner` を維持し、タイマー開始ボタン押下時に必ず `resumeAudioContext()` を await。banner と二重化 |
| アイコン素材の作成・ライセンスクリーン化が遅延 | L | Phase A の Open Question として早期に方針確定（自前 / MIT 互換セット / AI 生成）。MIT 互換のアイコンセット（Lucide / Heroicons）を流用するのが最速 |

---

## Implementation Phases

<!--
  STATUS: pending | in-progress | complete
  PARALLEL: phases that can run concurrently
  DEPENDS: phases that must complete first
  PRP: link to generated plan file once created
-->

| #   | Phase                       | Description                                                                                  | Status      | Parallel | Depends | PRP Plan |
| --- | --------------------------- | -------------------------------------------------------------------------------------------- | ----------- | -------- | ------- | -------- |
| A   | PWA Foundation              | manifest + Service Worker + アイコン素材 + meta tags + iOS install テキスト案内               | complete    | with C   | -       | [phase-a-pwa-foundation.plan.md](../plans/completed/phase-a-pwa-foundation.plan.md) |
| B   | Timer Offline Resilience    | `advanceLevel(auto)` の tx → updateDoc fallback、オフライン状態可視化バナー、multi-tab 警告 UI | complete    | -        | A       | [phase-b-timer-offline-resilience.plan.md](../plans/completed/phase-b-timer-offline-resilience.plan.md) |
| C   | Device Controls             | Wake Lock API + `screen.orientation.lock` + AudioContext unlock 強化                         | complete    | with A   | -       | [phase-c-device-controls.plan.md](../plans/completed/phase-c-device-controls.plan.md) |
| D   | Install Promotion & Polish  | role-aware install banner（owner / organizer 限定）+ 観測フェーズ                            | pending     | -        | A, B, C | -        |

### Phase Details

**Phase A: PWA Foundation**

- **Goal**: スマホのホーム画面に追加可能な PWA としての最低線を確立
- **Scope**:
  - `app/manifest.ts`（Next.js 15 公式 metadata API）または `public/manifest.json` で manifest 生成。`display: "standalone"`、`theme_color`、`background_color`、`icons[]`、`start_url: "/"`、`scope: "/"`
  - `public/sw.js` 素の Service Worker。precache 対象は会場で必要な routes（`/`, `/groups`, `/groups/[gid]`, `/tournaments/[tid]`, `/tournaments/[tid]/seating`, `/tournaments/[tid]/live`, `/join/[tid]` + Next.js build manifest 由来の static assets）。runtime キャッシュ戦略は HTML network-first / 静的 stale-while-revalidate / Firestore 通信は SW で扱わない
  - `navigator.serviceWorker.register("/sw.js")` の登録 hook を `app/layout.tsx` または client root で実行（`process.env.NODE_ENV === "production"` で gate、dev では SW 無効化）
  - `app/layout.tsx` に apple-touch-icon / `apple-mobile-web-app-status-bar-style: black-translucent` / `apple-mobile-web-app-capable: yes` / theme-color の meta tags を追加
  - アイコン素材を `public/icons/` 配下に配置（192x192 / 512x512 / 180x180 + maskable）。MIT 互換アイコンセット流用 or 自前デザインで Open Question 確定
  - iOS UA 判定で「共有 → ホーム画面に追加」のテキスト案内コンポーネントを設置
- **Success signal**: Chrome DevTools の Application タブで manifest が valid 認識され、`display-mode: standalone` で起動可能。Vercel 本番で iOS / Android 両方からホーム画面追加できることを目視確認

**Phase B: Timer Offline Resilience**

- **Goal**: 一時通信障害時にタイマーが止まらず、ブラインドレベルが正しく進行する
- **Scope**:
  - `advanceLevel(auto)` の `runTransaction` を try / catch で wrap し、`firestore/unavailable` 系のエラー（およびネットワーク切断系）を検出 → `updateDoc(tournamentsRef, { currentLevel: expected + 1, ...levelTransitionUpdates(state, expected + 1, "auto") })` で fallback。client 側で `currentLevel === expected` を再 check してから書く（楽観 update）
  - 既存の `subscribeTournament` の `hasPendingWrites` を活用し、`useTournamentSync(tid)` のような hook を追加して「通信障害中」バナーを `/tournaments/[tid]` 系画面で表示
  - characterization test を `tournaments.test.ts` または新規 file に追加: tx 成功 / tx 失敗 → updateDoc fallback 成功 / 両方失敗 / race 検出時 no-op の 4 ケース
  - `finishTournament` には fallback を入れない（online 必須を維持）。エラー時は「通信を確認してから再試行してください」のメッセージで UX 上明示
  - multi-tab 同時オープン警告: 簡易 presence doc（`tournaments/{tid}/presence/{uid}` 等）または BroadcastChannel API で検出し、警告バナー表示（Could スコープ、Phase B 内で時間があれば）
- **Success signal**: 開発者がサークル参加時に DevTools で network throttling（Offline モード）→ ブラインドレベルが進む / 復帰時に状態同期されることを目視確認。unit test で fallback 経路 100% カバレッジ

**Phase C: Device Controls**

- **Goal**: 会場プロジェクタ投影に耐えるデバイス制御を提供
- **Scope**:
  - Wake Lock API: `/tournaments/[tid]` の `state === "running"` 時に `navigator.wakeLock.request("screen")` を発行。`visibilitychange` で再取得、`state="finished"` で release
  - `screen.orientation.lock("landscape")` を PWA standalone 時のみ試行（feature detection）
  - AudioContext unlock 強化: `useAudioPlayer` hook 内でタイマー開始ボタン押下時に `await resumeAudioContext()` を確実実行、failed 時は既存 `SoundUnlockBanner` で fallback
  - feature detection の徹底: `if ("wakeLock" in navigator)`、`if (screen.orientation && "lock" in screen.orientation)` 等。未対応ブラウザにはテキスト案内で fallback
- **Success signal**: 開発者がサークル参加時に「タイマー画面で 5 分以上画面が消えない」「横向きで表示される」「タイマー開始時に音声が鳴る」を目視確認

**Phase D: Install Promotion & Polish**

- **Goal**: 運営者の PWA インストール導線を整備し、観測フェーズに入る
- **Scope**:
  - `useGroupRole(gid)` で role 判定し、`role !== "member"` のとき `beforeinstallprompt` イベントを capture してカスタム install button を表示（`/groups/[gid]` または `/tournaments/[tid]` のヘッダ）
  - dismiss 永続化（`localStorage` の `pwa-install-dismissed-at` flag）で「一度 dismiss したら 30 日間表示しない」設計
  - iOS UA 判定は Phase A で設置済みのテキスト案内を role-aware に切替（member には非表示）
  - 成功指標の観測（開発者サークル参加 + 運営者ヒアリング）
  - **Service Worker cache の運用ハードニング**（Phase A レビュー M2 / M3 由来）:
    - **M2 — `RUNTIME_CACHE` の eviction**: 現状無制限で蓄積する `_next/static/*` / 過去 HTML / `/sounds/*` に対して、entry 数または size 上限ベースの簡易 LRU を `public/sw.js` の `cache.put` 直前に挿入する。当面は `CACHE_VERSION` bump で全削除に倒しているが、長期 PWA install で quota error の温床となる
    - **M3 — `networkFirst` の対象 path 絞り込み**: 現状 `request.mode === "navigate"` のすべての HTML を runtime cache に格納している。auth-aware な server component が将来増えた場合に他端末へ透過する経路を予防的に塞ぐため、`/groups/**` / `/tournaments/**` / `/settings` 等の動的ルートを cache 対象外にする allowlist 化を検討（公開ページのみ navigation cache 対象）
- **Success signal**: 運営者が「ホーム画面に追加した」と運営チャットで報告される。開発者がサークル参加時の動作確認で全成功条件をクリア。SW cache の蓄積が長期 PWA install でも quota 上限の 50% 以下を維持する

### Parallelism Notes

- **Phase A と C は依存ゼロ**で並列実行可能。Phase A は PWA インフラ、Phase C はデバイス API という完全に独立した領域
- **Phase B は A に依存**（PWA 化されていない段階で「通信障害時の体感」を語っても意味が薄い）。ただし auto-advance fallback の実装自体は Phase A と並列可能で、検証の段階で A が必要
- **Phase D は A / B / C すべての polish** のため最後

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| ---- | ---- | ---- | ---- |
| オフライン定義 | 一時通信障害（数秒〜数分）でタイマーが止まらない | 完全オフラインで優勝者確定まで / Wi-Fi なし会場で完結 | ユーザー方針変更（[`Q5 補足`](#q5-補足-バスト時のテーブル移動案内)）。マスター機 1 台モードは影響範囲が大きすぎるため別 PRD に分離 |
| マスター機 1 台モード | 本 PRD では Won't | 統合パックとして PRD 03 に含める | 影響範囲（`pid==uid` invariant 再設計、ゲスト受付 rule branch、seating logic 大規模修正）が PRD 03 のスコープを破壊。PRD 01 Phase 5.x 候補に戻す |
| PWA フレームワーク | Next.js 15 公式 PWA ガイド（素 SW） | `@serwist/next` / `next-pwa` | Turbopack β 対応問題回避。素 SW なら Vercel build で確実に動作。Serwist は webpack 安定版だが本プロジェクトは Turbopack デフォルト |
| auto-advance のオフライン耐性化 | tx 試行 → tx 失敗時 updateDoc fallback の二段構え | tx 完全廃止して updateDoc 単独 / 完全 race-free な writeBatch 化 | online 時は tx の atomicity を維持しつつ、offline 時のみ fallback。race は楽観 update で対処、二重 increment は値域内のため壊滅的影響なし |
| `finishTournament` のオフライン対応 | 引き続き online 必須（fallback 入れない） | writeBatch + 後送り reconcile | `seasonStats` の atomicity 維持が必要。一時通信障害ケアの範疇外 |
| multi-tab 同時運用 | Could として警告 UI のみ | フル対応（leader election） | Firestore SDK の既知バグ（[#6511](https://github.com/firebase/firebase-js-sdk/issues/6511)）の対応コストが高い。「運営者は 1 端末」運用ルールで十分 |
| install promotion 表示対象 | owner / organizer 限定 | 全員に表示 | ユーザー Q3 回答「運営者にはインストールを進めるようにしたい」に直接対応。member は任意 |
| iOS install プロンプト | UA 判定で「共有 → ホーム画面に追加」テキスト案内 | iOS でも `beforeinstallprompt` 待つ / install promotion を Android のみに限定 | iOS Safari は `beforeinstallprompt` 永久に非対応。Next.js 公式ガイドも同パターンを推奨 |
| PRD 単位 | PWA + オフライン耐性 + デバイス制御を 1 PRD（B 案） | PRD 03 = PWA only / マスター機含めて統合 | 「会場運用体感パック」として技術領域は分離可能だが体感価値が連動。マスター機モードは別 PRD に分離してスコープ縮小 |

---

## Research Summary

**Market Context**

Next.js 15 App Router での PWA 構築は **公式 PWA ガイド（2024 fall 公開）の素 SW 構成**が現時点の最も安全な選択肢。`@serwist/next`（workbox 後継 fork）は webpack ガイドが正式版で Turbopack β 対応中。`next-pwa` 本家は 2024 年以降メンテ停滞でリスク。iOS Safari の PWA は `display: "standalone"` のみ受付（fullscreen 不可）、Cache Storage 50MB 上限、7 日間無アクセスで自動削除（ITP 7-day cap）。Web Push は iOS 16.4+ で解禁されたがホーム画面追加 + EU 圏外などの制約多。`beforeinstallprompt` は iOS 非対応のため UA 判定での「共有 → ホーム画面に追加」テキスト案内が必要。

Firestore オフライン永続化と Service Worker の住み分けは独立しており、Firestore は IndexedDB ベース、SW は Cache API ベース。**`runTransaction` はオフラインで即時失敗**（read-then-write の atomic 性のためサーバー往復必須）、対して `setDoc` / `updateDoc` / `writeBatch` は queue されオンライン復帰で自動 flush。本 PRD の最大の技術的決定事項は「auto-advance の tx → updateDoc fallback」で、これが直接「現状オフラインだとブラインドレベルが上がらない」を解消する。

**Technical Context**

コードベース調査により、以下が確認済み:

- ⑪ PWA 関連は **完全に未実装** — `public/manifest.json` / `public/sw.js` / `app/manifest.ts` / アイコン素材すべて未配置（[next.config.ts](next.config.ts) / [package.json](package.json)）
- ⑪ Firestore オフライン永続化は **既に有効化済み** — [client.ts#L86-L88](src/lib/firebase/client.ts#L86-L88) で `persistentLocalCache + persistentMultipleTabManager` を `initializeFirestore` に渡す
- 🆕 タイマー進行は **`Date.now()` ベース client-side 計算** — [timer.ts#L39-L69](src/lib/services/timer.ts#L39-L69) で `getRemainingMs` が現在時刻を入力に取り、Firestore Timestamp と相対計算。表示自体はオフラインで動く
- 🆕 タイマー操作は ほとんどが `updateDoc` ベースで queue 可能 — `pauseTournament` ([tournaments.ts#L324](src/lib/firebase/repositories/tournaments.ts#L324)) / `resumeTournament` ([L353](src/lib/firebase/repositories/tournaments.ts#L353)) / 手動 advance ([L440](src/lib/firebase/repositories/tournaments.ts#L440))
- 🚨 **auto-advance のみ `runTransaction` ベース** — [tournaments.ts#L410-L424](src/lib/firebase/repositories/tournaments.ts#L410-L424) で `expectedLevel` 指定時に tx で race 解決。これが「オフラインでブラインド上がらない」の直接原因
- 🆕 AudioContext unlock pattern は **既存** — [audio-context.ts](src/lib/audio/audio-context.ts) の `getOrCreateAudioContext` / `resumeAudioContext` + [SoundUnlockBanner.tsx](src/components/audio/SoundUnlockBanner.tsx) で user gesture 経由 unlock
- 🆕 Fullscreen hook は **既存**、Wake Lock / orientation lock は **未実装** — [useFullscreen.ts](src/lib/hooks/useFullscreen.ts) で webkit fallback 含む。`navigator.wakeLock` / `screen.orientation.lock` は使用箇所なし
- 🆕 role 判定 hook は **既存** — [useGroupRole.ts](src/lib/hooks/useGroupRole.ts) で任意 gid のロール導出可能。install promotion UI の owner/organizer gating に直接利用可能

CLAUDE.md / firebase-patterns.md の規約遵守を Phase 単位の plan で機械検査可能（emulator validator + drift detection script）。本 PRD は新規 schema / rule 追加なし（auto-advance fallback は既存 schema の更新のみ）のため、規約違反リスクは低い。

---

_Generated: 2026-05-08_
_Status: DRAFT - needs validation_
