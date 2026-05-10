# 観戦モード URL（`/spectate/[tid]`）

## Problem Statement

会場の予備モニタを操作する運営者と、サークル開始時刻に間に合わない遅刻参加者が、現状ログイン必須の `/live` を見られないため、トーナメントの進行状況（タイマー / 残人数 / 席表）とレイトレジスト可否を**手元で即座に把握できない**。運営者は会場の別画面に投影できず、遅刻参加者は会場に着くまで「もう始まっているのか / レイトレジストに間に合うのか」が不明で、チャットで都度問い合わせる手間が発生する。

## Evidence

- 入力ヒアリングで運営者本人から確認: 「会場の予備モニタに席表 / タイマーを別画面で映したい」「遅れて参加するメンバーから『もう始まってる？』『レイトレジスト間に合う？』を頻繁に聞かれる」（2026-05-09 ヒアリング、`tmp/02_DryRun時の要望対応/02-03_残りアイテム.md` 記録）
- 現状 `/live` は `RequireAuth(allowAnonymous)` のため anonymous でも login 必須（[src/app/tournaments/[tid]/live/page.tsx:1-19](src/app/tournaments/[tid]/live/page.tsx#L1-L19)）。家族 / 配信視聴者 / 会場未到着の参加者は閲覧不可
- 既存ドライラン（`tmp/02_DryRun時の要望対応/02-01_追加機能要求.md` の「15. 観戦モード URL」）でも明示的に挙げられた要望

## Proposed Solution

`tournaments/{tid}` に `spectateEnabled?: boolean` を additive 追加し、owner / organizer が明示的に ON にした tournament のみを **unauthenticated read** で公開する。新規ルート `/spectate/[tid]` で既存の `subscribeTournament` / `subscribePlayers` / `subscribeTables` をそのまま使い、タイマー・ブラインド・残人数・席表・レイトレジスト banner を read-only 表示する。Firestore Rules で `spectateEnabled == true` の document のみ unauthenticated read を許可し、書込経路は既存ロールに据え置き。Service Worker の `NAVIGATE_CACHE_ALLOWLIST` に `/spectate` を追加して会場のオフライン耐性を確保する。

代替案として「別 subcollection で sync」「`spectateCode` revocable token」を検討したが、実装コスト・整合性リスクが MVP に見合わないため採用しなかった（[Decisions Log](#decisions-log) 参照）。

## Key Hypothesis

`/spectate/[tid]` という unauthenticated read-only URL を運営者が明示的に発行することで、会場の予備モニタ表示と遅刻参加者の状況把握が、**ログイン操作 / チャット問い合わせなしに完結**する。
**観戦モードを ON にする tournament の割合が運用 3 ヶ月で 30% を超えれば**、本機能は仮説どおり「あったらいい」レベルの価値を提供できたと判断する。

## What We're NOT Building

- **賞金構造（prize structure）の表示** — 現 `tournament.structureSnapshot` schema に `prizeStructure` フィールドが存在しない。schema 追加は別 PRD で扱う
- **`spectateCode`（短命 / revocable token）** — tid は 20 char base62（≈117bit）で推測困難なため、初版では tid 直貼りで割り切る。漏洩前提でも公開対象は意図的に絞られている
- **uid / email の隠蔽** — `players/{pid}` は `pid == uid` invariant が depth integrated（[firebase-patterns.md](.claude/rules/firebase-patterns.md) `match /players/{pid}` の create rule）。document ID として uid は必ず漏れるため、初版では「Firebase Auth UID は乱数で個人特定情報と紐付かない」と割り切る。完全隠蔽が必要なら別 subcollection 設計が将来課題
- **チップ量（chip count）の表示** — schema に存在しない。ALLin-PokerTimer はチップ管理を行わない設計
- **観戦者向けインタラクション**（chip up 通知 / リアクション / チャット）— read-only に徹する
- **member 向け toggle 権限** — owner / organizer のみ。誤公開防止
- **/spectate からの「参加する」導線** — 受付フローは既存 `/join/[tid]` に集約。観戦と参加は明示的に別経路

## Success Metrics

| Metric                              | Target                                  | How Measured                                                                                  |
| ----------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------- |
| 観戦モード ON 率（**Primary**）     | 運用 3 ヶ月で 30% の tournament で ON   | `tournaments` 集計：`spectateEnabled == true` の比率。Firestore で手動集計 / 月次レビュー     |
| 観戦モード機能起因の不具合報告      | リリース後 1 ヶ月でゼロ                 | GitHub Issues / 直接フィードバック                                                            |
| Rules deploy 後の permission-denied | リリース直後 0 件（ON した tournament） | Vercel logs / Firestore audit logs（手動）                                                    |

## Open Questions

_全ての open question は 2026-05-09 のヒアリングで Must 格上げに決定済み（[Decisions Log](#decisions-log) 参照）。_

---

## Users & Context

**Primary User 1: 会場の予備モニタを操作する運営者**

- **Who**: サークル開催の運営担当（owner / organizer）。会場で本体機（PC / Mac）と予備モニタ（iPad / 別 PC / プロジェクタ）を 2 台以上運用
- **Current behavior**: 本体機の dashboard は organizer 操作用、予備モニタはタイマー投影専用にしたい。現状は本体機の `/live` 画面を二画面に複製するか、別 PC で再ログインしている
- **Trigger**: 開場前のセットアップ時、もしくはトーナメント開始直前
- **Success state**: 予備モニタで `/spectate/[tid]` を開けば、ログイン操作なしで現在のタイマー / 卓配置 / 残人数が見える

**Primary User 2: 遅刻参加者**

- **Who**: サークルメンバー（member ロール）で、開始時刻に間に合わず会場に向かっている途中の人
- **Current behavior**: 会場到着前にチャット（LINE / Discord）で「もう始まってる？レイトレジスト間に合う？」と運営者に問い合わせる
- **Trigger**: 開始時刻を過ぎてからの移動中（電車・タクシー）
- **Success state**: 共有された `/spectate/[tid]` URL を開けば、現在 Level / レイトレジスト受付状況 / 残人数が即座に分かり、間に合う場合は急ぐ判断ができる

**Job to Be Done**

When 会場以外の場所からトーナメントの進行を確認したい when, I want to ログインせず即座にタイマーと残人数とレイトレジスト可否を見たい to motivation, so I can 「投影できる / 急ぐべきか判断できる / 家族に状況を共有できる」 outcome.

**Non-Users**

- **完全な不特定多数**（バイラル拡散ターゲット）— サークル単位の小規模運用が前提。観戦 URL は意図的に share する人に届く想定
- **チップ管理を求める tournament organizer** — ALLin-PokerTimer 自体がチップを扱わない
- **member ロールでの toggle** — 誤公開防止のため対象外

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability                                                                  | Rationale                                                                  |
| -------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Must     | `tournaments.spectateEnabled` field 追加（zod schema additive）             | 全機能の基盤。default false で既存 doc 互換                                |
| Must     | Firestore Rules で `spectateEnabled == true` のとき unauthenticated read 許可 | tournaments / players / tables の 3 collection + collectionGroup wildcard  |
| Must     | `/spectate/[tid]` page + client（タイマー / ブラインド / 残人数 / 席表）     | 主要 UX。既存 subscribe を再利用                                           |
| Must     | レイトレジスト受付 banner（`Lv X まで受付中` / `受付終了`）                     | Primary User 2 の主要 JTBD を直接解決                                      |
| Must     | dashboard に owner / organizer 用 spectate toggle                           | 運営者が opt-in。誤公開防止のため確認 dialog 付き                          |
| Must     | emulator validator（`scripts/test-rules-spectate.mjs`）                     | 「unauthenticated read が想定範囲だけ通る」を機械検証。drift 防止          |
| Must     | Service Worker `NAVIGATE_CACHE_ALLOWLIST` に `/spectate` を追加              | 会場予備モニタの Wi-Fi 不安定耐性。Phase D PWA 基盤の小拡張。stale 許容 = 数分（network-first / max-age 短め） |
| Must     | spectate URL コピー button + QR code 表示                                   | 共有導線の摩擦をリリース時点で消す。チャット貼付 / 会場 QR 提示の両動線を一発で       |
| Must     | dashboard の tournament 一覧で「観戦モード ON 中」badge                     | 運営者が「どの tournament を公開中か」一覧で即把握。誤公開放置の検知に必須         |
| Must     | `/spectate/[tid]` を OFF にしたときの「観戦終了しました」graceful handling  | spectateEnabled OFF 後の permission-denied を綺麗に見せる。toggle 即時反映 UX に直結 |
| Won't    | 賞金構造の表示                                                              | schema に prizeStructure 不在。別 PRD で先に schema を追加してから対応     |
| Won't    | `spectateCode`（短命 / revocable token）                                    | tid 自体が推測困難。初版は tid 直貼りで割り切り                            |
| Won't    | uid 完全隠蔽（別 subcollection sync）                                       | `pid == uid` invariant と矛盾。document ID 経由で uid は構造的に漏れる    |
| Won't    | チップ量表示                                                                | ALLin-PokerTimer はチップ管理しない                                        |
| Won't    | 観戦者向けインタラクション（chat / reaction）                               | read-only スコープから外れる                                               |

### MVP Scope

**全 Must 項目を 1 リリースに含める**:

1. `tournaments.spectateEnabled` schema 追加（default false）
2. Firestore Rules 更新（4 経路: tournaments / players / tables / collectionGroup players）+ emulator validator
3. dashboard に owner / organizer 限定の spectate toggle UI（確認 dialog + URL コピー button + QR code 表示）
4. dashboard の tournament 一覧に「観戦モード ON 中」badge
5. `/spectate/[tid]` page（タイマー / ブラインド / 残人数 / 席表 / レイトレジスト banner）
6. spectateEnabled OFF 後の graceful handling（「観戦が終了しました」表示）
7. PWA cache allowlist に `/spectate` 追加（stale 許容 = 数分。network-first または短い max-age）

検証指標:
- Vercel preview で実機（iPad / Android スマホ）で unauthenticated 状態で URL 開けることを確認
- emulator: spectateEnabled=true で unauthenticated read 通過 / spectateEnabled=false で deny / write 経路は引き続き deny
- PWA: offline 時に `/spectate` の cache hit + Firestore IndexedDB の last seen state 表示

### User Flow

**運営者フロー（予備モニタセットアップ）**:

1. dashboard で対象 tournament を開く
2. 「観戦モード」 toggle を ON（確認 dialog で「URL は誰でも閲覧可能になります」と注意喚起）
3. 表示された URL（`/spectate/{tid}`）を予備モニタの browser で開く
4. ログイン画面を経由せず、タイマー / 席表が即座に表示される

**遅刻参加者フロー**:

1. 運営者から共有された `/spectate/{tid}` URL を chat / SMS で受け取る
2. 開く（ログイン不要）
3. 上部 banner で「レイトレジスト受付中（Lv 2 まで）」を確認 → 急ぐべきか判断
4. 残人数 / 自分の知り合いが参加しているか（displayName 一覧）を確認
5. 会場到着後、別途 `/join/[tid]` で正規参加

---

## Technical Approach

**Feasibility**: **HIGH**

既存の `subscribeTournament` / `subscribePlayers` / `subscribeTables` がそのまま使え、`/live` の表示ロジックの大半が再利用可能。schema 追加は additive、rule 追加は既存 `match` ブロックへの分岐追加で済む。新規概念は最小。

**Architecture Notes**

- **schema additive**: [`tournament.ts`](src/lib/firebase/schemas/tournament.ts) に `spectateEnabled: z.boolean().default(false)` を追加。既存 doc は default で hydrate
- **Rule 4 経路の同時更新**:
  1. `match /tournaments/{tid}` `allow read`: 既存 `isSignedIn()` に **OR** で `resource.data.spectateEnabled == true` を追加
  2. `match /tournaments/{tid}/players/{pid}` `allow read`: `get(parent).data.spectateEnabled == true` を追加
  3. `match /tournaments/{tid}/tables/{tableId}` `allow read`: 同上
  4. `match /{path=**}/players/{pid}`（collectionGroup）: 親 tournament の spectateEnabled を check（[firebase-patterns.md](.claude/rules/firebase-patterns.md) の「subcollection 設計原則: wildcard 厳禁」原則は維持。read 経路のみ enable）
- **書込経路は据え置き**: spectateEnabled toggle 自体は `groups/{gid}` 既存パターン（`affectedKeys.hasOnly(['spectateEnabled'])` + `is bool`）に倣い、`tournaments/{tid}` 既存 update branch に additive に許可キーを追加。owner / organizer 限定（既存 `isOrganizer(resource.data.groupId)`）
- **converter は触らない**: uid 隠蔽は割り切り済み。`subscribePlayers` の onSnapshot は schema の uid を含む raw doc を返す。`/spectate-client.tsx` 側でも uid を表示しないだけで、SDK レベルでは見える状態を許容
- **`/spectate/[tid]` 構成**: `/live` を参考にした 2 ファイル構成（[src/app/tournaments/[tid]/live/page.tsx](src/app/tournaments/[tid]/live/page.tsx) + [live-client.tsx](src/app/tournaments/[tid]/live/live-client.tsx) のパターン）。RequireAuth は使わず、useAuthUser も読まない（純粋 unauthenticated）
- **PWA cache**: [`public/sw.js`](public/sw.js) の `NAVIGATE_CACHE_ALLOWLIST` に `/spectate` を追加。Phase D で確立した `shouldCacheNavigate` パターンを踏襲
- **エラー prefix**: `spectate/*`（[error-logging.md](.claude/rules/error-logging.md) の prefix 一覧に追加）

**Technical Risks**

| Risk                                                                                          | Likelihood | Mitigation                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Firestore Rules deploy 漏れで本番 permission-denied                                            | M          | Phase 完了報告チェック項目に `firebase deploy --only firestore:rules` を必須化（メモリ規約準拠）                                                                                        |
| collectionGroup wildcard rule の bypass（`match /{path=**}/players/{pid}`）で strict invariant 損失 | H          | [firebase-patterns.md](.claude/rules/firebase-patterns.md) Phase 5.4 の教訓を踏襲。**read 経路のみ追加**、write 系は触らない。emulator validator で「想定外 path / write 経路 deny」を網羅 |
| spectateEnabled OFF 後も観戦中 client が古い snapshot を表示し続ける                            | M          | onSnapshot の error callback でハンドリング、graceful な「観戦終了しました」表示。Should 項目                                                                                            |
| PWA cache の stale `/spectate` HTML が古いブラインドを表示                                     | L          | shell cache version bump で対応可能。Open Question で許容範囲を確認                                                                                                                     |
| `pid == uid` invariant に依存する将来機能（PD rotation 等）が観戦経路を考慮せず破綻              | L          | rule の write 経路は触らない / read 経路のみ拡張、で invariants は不変                                                                                                                  |
| toggle 誤操作で意図せず公開                                                                    | M          | dashboard の toggle 操作に確認 dialog（「URL を知る人は誰でも閲覧可能になります」）                                                                                                      |
| spectate URL の brute force / SNS 拡散                                                         | L          | tid 117bit で推測困難 + 公開対象は意図的に絞り込み済み。割り切り（Won't 項目）                                                                                                           |

---

## Implementation Phases

<!--
  STATUS: pending | in-progress | complete
  PARALLEL: phases that can run concurrently
  DEPENDS: phases that must complete first
  PRP: link to generated plan file once created
-->

| #   | Phase                                  | Description                                                                                                                | Status  | Parallel    | Depends | PRP Plan |
| --- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------- | ----------- | ------- | -------- |
| 1   | Schema + Rule + Emulator Validator     | `spectateEnabled` field 追加、firestore.rules 4 経路更新、test-rules-spectate.mjs 追加、`spectate/*` error prefix 追加     | complete    | -           | -       | [phase-1-schema-rule-emulator.plan.md](../plans/completed/phase-1-schema-rule-emulator.plan.md) ([report](../reports/phase-1-schema-rule-emulator-report.md)) |
| 2   | `/spectate/[tid]` Read-only Page       | page.tsx + spectate-client.tsx（タイマー / ブラインド / 残人数 / 席表 / レイトレジスト banner / OFF 後の graceful handling）。`/live` を参照に独立実装 | complete    | with 3, 4   | 1       | [phase-2-spectate-readonly-page.plan.md](../plans/completed/phase-2-spectate-readonly-page.plan.md) ([report](../reports/phase-2-spectate-readonly-page-report.md)) |
| 3   | Toggle UI + 共有導線（dashboard）       | owner / organizer 限定の spectate toggle、確認 dialog、URL コピー button、QR code 表示、tournament 一覧 badge、`setSpectateEnabled` service + `updateSpectateEnabled` repository | complete    | with 2, 4   | 1       | [phase-3-toggle-ui-and-share.plan.md](../plans/completed/phase-3-toggle-ui-and-share.plan.md) ([report](../reports/phase-3-toggle-ui-and-share-report.md)) |
| 4   | PWA Cache Allowlist 追加                | `public/sw.js` の `NAVIGATE_CACHE_ALLOWLIST` に `/spectate` 追加、CACHE_VERSION bump、stale 許容 = 数分（network-first or 短い max-age） | complete    | with 2, 3   | -       | [phase-4-pwa-cache-allowlist.plan.md](../plans/completed/phase-4-pwa-cache-allowlist.plan.md) ([report](../reports/phase-4-pwa-cache-allowlist-report.md)) |

### Phase Details

**Phase 1: Schema + Rule + Emulator Validator**

- **Goal**: 観戦モードの基盤データモデルとセキュリティ境界を確立する
- **Scope**:
  - `src/lib/firebase/schemas/tournament.ts` に `spectateEnabled: z.boolean().default(false)` を additive 追加
  - `firestore.rules` の 4 経路に分岐追加（tournaments read / players read / tables read / collectionGroup players read）
  - `firestore.rules` の `tournaments/{tid}` `allow update` に `affectedKeys.hasOnly(['spectateEnabled', 'updatedAt']) + is bool` の owner/organizer 専用ブランチを additive 追加
  - `scripts/test-rules-spectate.mjs` を新規作成（unauthenticated allow / deny / write 経路据え置きの網羅検証）
  - `package.json` に `test:rules-spectate` script 追加
  - `src/lib/errors.ts` の prefix table に `spectate/*` を追加
  - [error-logging.md](.claude/rules/error-logging.md) / [firebase-patterns.md](.claude/rules/firebase-patterns.md) / [group-membership.md](.claude/rules/group-membership.md) の関連節を更新
- **Success signal**:
  - `npm run test:rules-spectate` が green
  - `firebase emulators:exec` 経由で「spectateEnabled=true で unauthenticated read 通過」「spectateEnabled=false で deny」「toggle 自体は organizer 以上のみ」「member は toggle deny」を確認
  - 既存の `test:rules-*` 群（finished-count / default-seats / season / clone-players / pd / limits）が引き続き green

**Phase 2: `/spectate/[tid]` Read-only Page**

- **Goal**: 観戦者の主要 UX（タイマー / 残人数 / 席表 / レイトレジスト banner）を提供し、spectateEnabled OFF 時も graceful にハンドリングする
- **Scope**:
  - `src/app/spectate/[tid]/page.tsx`（Server Component、tid 受け取り）
  - `src/app/spectate/[tid]/spectate-client.tsx`（Client Component）
    - `subscribeTournament` / `subscribePlayers` / `subscribeTables` の購読
    - タイマー表示（`useTournamentTimer` を再利用 or 観戦専用 hook 切り出し検討）
    - ブラインド + Ante 表示
    - 残人数（`!isBusted` count）
    - 席表（卓 label / color、displayName を席に配置）
    - レイトレジスト banner（`currentLevel <= lateEntryDeadlineLevel` で「Lv X まで受付中」、超過で「受付終了」）
    - tournament が見つからない / spectateEnabled=false の時の guard 表示（「観戦が公開されていません」）
    - **OFF 切替後の graceful handling**: onSnapshot error callback で `firestore/permission-denied` を捕捉し、「観戦が終了しました」に画面遷移（white screen / error 画面にならない）
  - `RequireAuth` は使わない、`useAuthUser` 経由のロジックも避ける
  - `/live` 側の DOM / ロジックには触らない（独立進化）
- **Success signal**:
  - Vercel preview で実機（iPad / Android）で完全 unauthenticated 状態で URL を開ける
  - タイマーが onSnapshot でリアルタイム更新される
  - dashboard で toggle OFF した瞬間に「観戦が終了しました」に遷移する E2E
  - PWA Lighthouse score が `/spectate/[tid]` で 90+

**Phase 3: Toggle UI + 共有導線（dashboard）**

- **Goal**: owner / organizer が tournament 単位で spectate 公開を opt-in でき、URL を即座に共有でき、一覧で公開状態を即把握できる
- **Scope**:
  - `src/lib/services/tournament.ts` 等に `setSpectateEnabled({ tid, uid, gid, value })` service を追加
  - `src/lib/firebase/repositories/tournaments.ts` に `updateSpectateEnabled(tid, value)` を追加（`wrapFirestoreWrite` 経由）
  - dashboard の tournament 詳細画面（[src/app/tournaments/[tid]/dashboard-client.tsx](src/app/tournaments/[tid]/dashboard-client.tsx)）に **SpectateModeCard** を追加:
    - toggle（ON / OFF）+ 確認 dialog（「観戦モードを ON にすると、URL を知る人は誰でも閲覧できます」）
    - 観戦 URL の表示（フル URL）
    - **URL コピー button**（クリップボード API、コピー後 toast feedback）
    - **QR code 表示**（軽量 QR ライブラリ。会場で来訪者にスキャンしてもらう想定。ライブラリ追加は ask モード経由で承認）
  - **tournament 一覧 badge**（[src/app/tournaments/page.tsx](src/app/tournaments/page.tsx) 等）に `spectateEnabled === true` の tournament に「観戦公開中」badge を追加
  - role gate: `useGroupRole(tournament.groupId)` で owner / organizer のみ toggle UI を表示。member には toggle 自体が見えない
- **Success signal**:
  - organizer / owner で toggle ON → Firestore に反映 → `/spectate/[tid]` が anonymous で開ける
  - member で toggle UI が表示されない（rule + UI 二重防御）
  - 確認 dialog 経由でないと toggle が反映されない（誤操作防止 E2E test）
  - URL コピー button でクリップボードに正しく入る
  - QR code をスマホでスキャンして `/spectate/[tid]` が開ける（実機検証）
  - tournament 一覧で ON 中の tournament に badge が表示される

**Phase 4: PWA Cache Allowlist 追加**

- **Goal**: 会場の予備モニタが Wi-Fi 不安定でも `/spectate` を表示できる。stale 許容範囲は数分以内に抑える
- **Scope**:
  - `public/sw.js` の `NAVIGATE_CACHE_ALLOWLIST` に `/spectate` を追加
  - **stale 戦略**: network-first（オンラインなら最新を取りに行き、失敗時のみ cache fallback）、または stale-while-revalidate + 短い max-age（数分）。「数時間前のブラインド」を見せないことを優先
  - `CACHE_VERSION` bump（既存 cache を破棄し新版で再 build）
  - `shouldCacheNavigate` の挙動 unit test 追加
- **Success signal**:
  - DevTools の Application > Service Workers で `/spectate/{tid}` が cache hit
  - 機内モード状態で `/spectate` をリロード → cached HTML + Firestore IndexedDB の last seen state が表示
  - オンライン復帰後、cache が数分以内に最新化される（network-first または short-TTL の挙動確認）

### Parallelism Notes

- **Phase 1** は他全ての前提（schema / rule なしには Phase 2 / 3 が動かない）
- **Phase 2 / 3 / 4 は並列実装可能**:
  - Phase 2 は read 経路の UI（OFF 後の graceful handling 含む）、Phase 3 は write toggle UI + 共有導線 + 一覧 badge、Phase 4 は SW 設定でファイル境界が明確に分離
  - 別ブランチで並走させて統合 PR で merge しても良い
- 全 4 Phase を 1 リリースに含める（MVP scope）

---

## Decisions Log

| Decision                                       | Choice                                                                                                                | Alternatives                                                            | Rationale                                                                                                                                                                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 公開範囲                                       | C: タイマー + ブラインド + 残人数 + displayName + 席表（PD フラグは optional）                                        | A: タイマーのみ / B: + displayName / D: 別                              | Primary User 1（運営者の予備モニタ）と User 2（遅刻参加者）の両方の JTBD を最小スコープで満たす                                                                                                                          |
| uid 公開                                       | A: 割り切る（document ID = uid invariant）                                                                            | B: 別 subcollection sync / C: players 非公開で B 範囲に降格              | `pid == uid` invariant が depth integrated（[firebase-patterns.md](.claude/rules/firebase-patterns.md)）。完全隠蔽は別 subcollection が必要で実装コスト大。UID 単体では人物特定不可と判断                                |
| URL アクセス制御                               | A: tid そのまま（短期 token なし）                                                                                    | B: spectateCode（短命 / revocable）                                     | tid は 20 char base62（≈117bit）で推測困難。漏洩前提でも公開対象は意図的に絞り込み済み                                                                                                                                   |
| 賞金構造                                       | 対象外（Won't）                                                                                                       | schema 追加して含める                                                   | 現 schema に prizeStructure 不在。schema 追加は別 PRD で先行                                                                                                                                                             |
| Toggle 権限                                    | owner + organizer                                                                                                     | owner のみ                                                              | organizer も既に structures / tournaments の CRUD を持つ信頼ロール（[group-membership.md](.claude/rules/group-membership.md) 権限マトリクス）。運営の機動性を優先                                                        |
| PWA cache 連携                                 | この PRD に含める                                                                                                     | 別 PRD（03-pwa-app-shell の architect-refactor で）                     | 会場予備モニタ要件 1 と直結。SW の小拡張で済むため scope 内                                                                                                                                                              |
| レイトレジスト表示                                 | 明示的 banner（「Lv X まで受付中」/「受付終了」）                                                                     | currentLevel + lateEntryDeadlineLevel の生表示のみ                      | Primary User 2 の主要 JTBD 解決を最優先。生表示は計算負荷を user に押し付ける                                                                                                                                            |
| MVP 範囲                                       | 全 Must 項目を 1 リリース                                                                                             | Phase 1: schema/timer のみ → Phase 2: 席表/banner 段階リリース           | scope コンパクト（4 Phase）で並列実装可能。1 リリースに収めて review コストを削減                                                                                                                                        |
| URL 共有導線（Open Q1）                        | コピー button + QR code をリリース時点で必須                                                                          | feedback 待ちで段階追加                                                  | Primary User 1（運営者）の予備モニタ要件と Primary User 2（遅刻参加者）への共有要件の両方をリリース時点で満たす。後追い追加だと「一旦使って試す」初動が阻害される                                                          |
| 一覧での視認性（Open Q2）                      | tournament 一覧に「観戦公開中」badge を必須                                                                           | badge なし、詳細画面でのみ確認                                          | 誤公開放置の検知に必須。toggle ON のまま忘れていると次回開催も公開され続けるリスク                                                                                                                                       |
| PWA cache stale 許容範囲（Open Q3）            | 数分（network-first または短い max-age）                                                                              | 1 時間程度の stale を許容                                                | ブラインド情報は数分単位で変化するため、stale が 1 時間あると遅刻参加者が誤った Level を見て判断ミスする                                                                                                                  |
| OFF 後の graceful handling（Open Q4）          | Must 格上げ                                                                                                           | Should（Phase 5 に分離）                                                 | toggle 切替の UX 直結。「toggle OFF → 観戦タブが white screen」だと運営者が「何が起きたか分からない」と混乱する                                                                                                            |

---

## Research Summary

**Market Context**

ポーカートーナメント tracker（PokerStars Live / Tournament Director / Blinds Are Up）の観戦機能はいずれも「public URL でログイン不要 read-only、displayName 公開 / contact info 非公開、運営者の opt-in toggle」というパターンに収束している。本 PRD もこの業界標準を踏襲する。

**Technical Context**

既存 codebase は観戦モード追加に対して非常に好条件:

- **subscribe API は再利用可能** — `subscribeTournament` / `subscribePlayers` / `subscribeTables` がそのまま動く（[repositories/tournaments.ts:823](src/lib/firebase/repositories/tournaments.ts#L823) 他）
- **schema additive で旧 doc 互換** — `spectateEnabled.default(false)` で既存 tournament は自動的に「公開されていない」状態
- **Rules の分岐パターンが確立** — `groups/{gid}` の単一フィールド書換 rule 経路（finishedTournamentCount / defaultSeatsPerTable）が先例として存在し、`affectedKeys.hasOnly` パターンを再利用できる
- **PWA 基盤が Phase D で完成** — `NAVIGATE_CACHE_ALLOWLIST` への追加だけで cache 対応完了

ただし以下の制約は決定的:

- **`pid == uid` invariant** — players の document ID 経由で uid が必ず漏れる。完全隠蔽は別 subcollection が必要で本 PRD では対象外
- **collectionGroup wildcard rule** — Phase 5.4 で発見した「wildcard match による strict invariant bypass」の教訓があり、read 経路のみ慎重に追加する設計（[firebase-patterns.md](.claude/rules/firebase-patterns.md) `subcollection 設計原則`）
- **Rules deploy 忘れリスク** — emulator green でも本番未 deploy で permission-denied する罠。Phase 完了報告に deploy 確認を必須化（メモリ規約準拠）

---

_Generated: 2026-05-09_
_Status: DRAFT - needs validation_
