# 第3回ドライラン改善（運営代理受付・卓の手動コントロール）

## Problem Statement

3回目のドライラン運用で、運営者が「参加者本人のスマホ任せ」「卓数の自動算出任せ」では捌けない実地のオペレーションに 2 度ぶつかった。①充電切れの参加者を受付できず、②脱落者のリングゲーム用に 1 卓空けたいのにアプリが卓数の手動コントロールに対応せず、いずれも「アプリ外で帳尻を合わせる」回避運用を強いられた。これは「熟練者不在でも TDA 通りに回せる」という本アプリの核心価値を実地で毀損している。

## Evidence

- ドライラン要望①（[07-01_dryrun.md](../../../../tmp/07_third-dryrun/07-01_dryrun.md)）: 「トーナメントの受付を運営側の操作でも行えるようにしたい。スマホの充電が切れていて受付できない人がいた。」
- ドライラン要望②（同）: 「トーナメント脱落者でリングゲームをするためにテーブルを一つ空けたかった。通常運用だと3テーブルのままの人数だったが、2テーブルに参加者をまとめて運営した。ただ、アプリは対応していなかったので、テーブル配置は気にせずに運用するようにして回避した。」
- 技術調査（本 PRD 作成時のコードベース探索）: 参加者登録は `pid == uid == auth.uid` を rule で強制し運営代理経路が無い（[firestore.rules:543-565](../../../../firestore.rules#L543-L565)）。卓数は `ceil(参加者数 / seatsPerTable)` の自動算出のみで、卓閉鎖 `planTableBreak` は `(生存卓数-1) × seatsPerTable >= 参加者数` を要求し上限超過の集約をブロックする（[engine.ts](../../../../src/lib/services/seating/engine.ts)）。卓の再開・追加経路は皆無。

## Proposed Solution

2 つの独立した運営者能力を追加する。**(A) 運営代理受付**: 運営者がダッシュボードから参加者を登録できるようにする。サークルメンバーはアカウント（uid）を指定して、メンバー外は表示名のみ（`uid = null` の運営者管理専用プレイヤー）で登録する。**(B) 卓の手動コントロール**: 運営者が任意の卓を「空けて閉じる」（残卓へ自動再配置＋D&D 微調整、残卓の実効定員を一時的に引き上げ）操作と、レイトレジストで人数が増えたときに「卓を増やす／閉じた卓を再開する」操作を行えるようにする。いずれも既存の seating engine / rule 設計（organizer-update 経路・`uid` nullable schema・`planTableBreak`）を拡張して実現し、Cloud Functions 化は将来課題として見送る。

## Key Hypothesis

We believe **運営者主導の受付代理と卓数の手動コントロール**が **「本人スマホ依存・自動卓数依存で捌けない実地オペレーション」を解消**する for **小規模サークルの運営者**。
We'll know we're right when **次回（第4回）ドライランで、充電切れ等の参加者を運営代理で受付でき、かつ脱落者リングゲーム用に卓を空ける／人数増で卓を増やす操作がアプリ内で完結し、アプリ外の回避運用が発生しない**。

## What We're NOT Building

- **アプリ内でのリングゲーム管理** - 要望②はあくまで「トーナメントから卓を切り離して物理的に空ける」ことが目的。リングゲームのチップ・ブラインド・席は管理しない（ユーザー明言）。
- **名前のみ参加者の本人アカウント紐づけ** - `uid = null` プレイヤーを後から本人の Auth アカウントに移行する機能は作らない（ユーザー回答 1: 名前だけで良い）。運営者管理専用のまま。
- **Cloud Functions による集約** - 代理 create / 卓操作とも既存のクライアント直書き + Security Rules 防御の方針を踏襲。Callable 化は将来課題。
- **卓数の事前手動指定（作成画面）** - 初回卓数は従来通り `ceil(参加者数 / seatsPerTable)` の自動算出を維持。手動コントロールは開催中の「閉じる／増やす」操作として提供する。
- **maxUses 招待コード等、本要望と無関係の既存課題** - 対象外。

## Success Metrics

| Metric                                   | Target                              | How Measured                                       |
| ---------------------------------------- | ----------------------------------- | -------------------------------------------------- |
| 第4回ドライランでの代理受付の成功        | 充電切れ等の参加者を 100% 運営代理で受付 | ドライラン後の運営者フィードバック                 |
| 第4回ドライランでの卓操作の成功          | 「卓を空ける／増やす」をアプリ内で完結 | 同上（アプリ外回避運用の発生 = 0）                 |
| 既存テストの非回帰                       | unit / E2E / rules emulator 全 green | `npm run test` / Playwright / `npm run test:rules-*` |
| Security Rules の invariant 維持         | 名前のみ player 追加後も既存 invariant が bypass されない | 新規 emulator validator（代理 create / 卓操作）    |

## Open Questions

- [ ] `uid = null` プレイヤーの `pid`（doc ID）採番方式: クライアント生成の `crypto.randomUUID()` か Firestore auto-id か。pid==uid invariant に依存する既存 service コード（`assignSeat` / `bustPlayer` / orchestrator の同卓判定）が `pid` を uid として扱う箇所が無いか実装時に精査が必要。
- [ ] 名前のみ player は `/live` を本人端末で開けない（Auth 無し）。運営者 SeatingBoard / 観戦モードでの可視化のみで運用上十分か（次回ドライランで検証）。
- [x] **解決済み**: 卓を「空けて閉じる」際、残卓が 10 名（`seatNum` rule 上限）を超える集約 → **実行ブロック + 警告**とする（tx を発行しない。閉じるボタンは押せるが、収まらなければ実行時に警告表示で中止）。
- [x] **解決済み**: 卓を「増やす／再開」する際の自動配席との責務分担 → **手動配置を正規**とする（増やした／再開した卓へは `autoSeatLateEntry` で自動配席せず、運営者が D&D で配置する）。理由: BB の位置などアプリ外情報を運営者が考慮して配置する必要があるため。アプリは「どこへ動かすべきか」のメッセージ／ガイド表示でサポートする（あるとよりよい）。

---

## Users & Context

**Primary User**

- **Who**: 小規模 NLH サークル（6 卓以下・20 人前後）の**運営者（organizer / owner）**。月 1〜2 回開催を熟練ディーラー不在で回す。
- **Current behavior**: 受付は参加者本人のスマホ任せ。卓数はアプリ自動算出に従い、想定外の卓運用はアプリ外（口頭・紙）で帳尻合わせ。
- **Trigger**: 開催当日に「本人が受付できない（充電切れ等）」「人数に対して卓を 1 つ空けたい／増やしたい」という現場判断が発生した瞬間。
- **Success state**: 運営者がダッシュボード／SeatingBoard 上の操作だけで参加者登録と卓数調整を完結でき、アプリの席指示と現実が一致したまま進行できる。

**Job to Be Done**
When **当日の現場で本人が受付できない、または卓数を運営判断で変えたい状況になった**とき、I want to **運営者の手元操作だけで参加者を代理登録し卓を空ける／増やす**, so I can **アプリの自動指示と現実の卓運用を一致させたままトーナメントを止めずに回せる**。

**Non-Users**
本人スマホで正常に受付できる一般参加者（既存フローのまま）。サークルに属さない不特定多数の公開トーナメント運営（本アプリのスコープ外）。リングゲームの進行管理を求めるユーザー。

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
| -------- | ---------- | --------- |
| Must | 運営者によるメンバー代理受付（uid 指定） | サークルメンバーは uid 紐づけで season 集計も継続（ユーザー回答: 両方必須） |
| Must | 運営者による名前のみ代理受付（`uid = null` 管理専用 player） | 充電切れ等の非メンバー／本人不在を救済（要望①の中核） |
| Must | 卓を「空けて閉じる」: 残卓へ自動再配置＋残卓定員の一時引き上げ | 脱落者リングゲーム用に卓を空ける（要望②の中核） |
| Must | 自動再配置後の D&D 手動微調整 | ユーザー回答 Q1:「両方（自動配置後に手動微調整）」 |
| Must | 卓を増やす／閉じた卓を再開する | ユーザー回答 Q2: レイトレジストで人数増 → 卓追加が必要 |
| Should | 名前のみ player の SeatingBoard / PlayerList 上の視覚的区別（管理専用バッジ等） | 本人端末で見えないことを運営者が認識できるように |
| Must | 卓閉鎖時の残卓 10 名超ブロック＋警告 | 残卓定員超過は rule deny で tx 失敗するため、実行前にブロックして中止（ユーザー確定） |
| Must | 代理受付した名前のみ player の運営者編集（表示名修正） | 入力ミス救済。既存 organizer-update 経路で実現可能（ユーザー回答で Must 格上げ） |
| Should | 卓を増やす／再開時の配置ガイドメッセージ | 手動配置時に「どこへ動かすべきか」を運営者にサポート表示（BB 位置等はアプリ外情報のため自動配置はしない） |
| Won't | 名前のみ player の本人アカウント移行 | 明示的に対象外（ユーザー回答） |
| Won't | アプリ内リングゲーム管理 | 明示的に対象外 |
| Won't | Cloud Functions 化 | 将来課題（信頼ロール内のため遅延可） |

### MVP Scope

仮説検証の最小単位は **「運営者が(1)メンバーと名前のみの両方を代理受付でき、(2)任意の卓を空けて閉じられ（自動再配置）、(3)人数増時に卓を増やせる」** こと。D&D 微調整・視覚バッジ・定員警告は MVP に含めるが、本人アカウント移行・リングゲーム管理は含めない。

### User Flow

**受付代理（クリティカルパス）**
1. 運営者がダッシュボード（setup / 開催中）で「参加者を追加」を開く
2. タブ選択: 「メンバーから選ぶ」→ グループメンバー一覧から選択 / 「名前で追加」→ 表示名入力（≤15 字）
3. 確定 → player doc を create（メンバー: `pid=uid` / 名前のみ: `pid=合成id, uid=null`）
4. 以降は通常の参加者と同様に席決め・自動配席・バランシング対象になる（名前のみは運営者管理のみ）

**卓を空けて閉じる（クリティカルパス）**
1. 運営者が SeatingBoard で対象卓の「この卓を閉じる」を選択
2. アプリが残卓の空席へ自動再配置（必要なら残卓定員を ≤10 で一時引き上げ）。残卓に収まらない場合は警告して中止
3. 確定 → 閉鎖卓 `isBroken=true` + 移動を同一 tx で commit
4. 必要なら D&D で席を微調整

**卓を増やす／再開（クリティカルパス）**
1. レイトレジスト等で人数が増え既存卓が満杯になる
2. 運営者が「卓を増やす」（新規卓）または「閉じた卓を再開」（`isBroken=false`）を選択
3. 増えた卓へ手動 D&D もしくは自動配席で参加者を配置

---

## Technical Approach

**Feasibility**: MEDIUM

**Architecture Notes**

- **名前のみ player（要望①-B）**: `playerBodySchema.uid` は既に `z.string().nullable()`（[schemas/player.ts:8](../../../../src/lib/firebase/schemas/player.ts#L8)）で schema 変更不要。`firestore.rules` の `players/{pid}` `allow create` に**第3ブランチ（organizer-proxy-create）**を additive 追加する: `isOrganizer(parent.groupId)` + `pid != auth.uid`（合成 id 許容）+ `request.resource.data.uid == null` + invariants（`isBusted==false` / no seat / `isPlayingDealer==false`）+ 受付可能 state（setup / seating / running / paused）。`finishTournament` は既に `uid === null` を season 集計から skip 済みのため下流耐性あり。
- **メンバー代理 player（要望①-A）**: 既存 organizer-clone ブランチ（[firestore.rules:553-564](../../../../firestore.rules#L553-L564)）が `pid == uid` の organizer create を許可するが `state == "setup"` 限定。これを受付可能 state へ拡張する（レイトエントリ代理を許すため）。write 経路は `upsertPlayer` を運営者が member uid 指定で呼べる service ラッパとして追加。
- **卓を空けて閉じる（要望②-A）**: 既存 `planTableBreak` の `(生存卓数-1) × seatsPerTable >= 参加者数` 制約を、手動閉鎖では**残卓 ≤ `MAX_SEATS_PER_TABLE`(10) に収まれば許可**する形へ engine を拡張（実効定員の一時引き上げ）。`isBroken=true` + 再配置を `applyTableBreak` 同様 tx で原子的に commit。D&D 微調整は既存 `applyManualSeatChange` を流用。
- **卓を増やす／再開（要望②-B）**: `tables/{tableId}` の `isBroken` を `false` に戻す repository / service / UI を新設（現状 reopen 経路皆無）。新規卓追加は `upsertTable(isBroken=false)` を運営者操作から呼ぶ。`MAX_TABLES`(6) 上限と rule `tableNum <= 6` は維持。
- **rule リテラル drift**: `seatNum <= 10` / `tableNum <= 6` は [limits.ts](../../../../src/lib/limits.ts) と連動。閉鎖時の定員引き上げは上限 10 を超えない範囲に限定し drift を発生させない。

**Technical Risks**

| Risk | Likelihood | Mitigation |
| ---- | ---------- | ---------- |
| `pid == uid` invariant に依存する既存 service コードが `uid = null` player で破綻（同卓判定・bust・seat） | M | 実装前に `pid` を uid として扱う callsite を grep で精査し characterization test を先行投入。pid は合成 id とし `uid` フィールドのみ null |
| 名前のみ player の create rule 第3ブランチが既存 strict invariant（self/clone）を bypass する穴を作る | M | wildcard 厳禁原則を踏襲し explicit ブランチで追加。`scripts/test-rules-clone-players.mjs` を雛形に専用 emulator validator を新設し deny ケースを必ず含める |
| 卓閉鎖時の定員引き上げで残卓が 10 名超 → rule deny で tx 失敗・トーナメント停止 | M | engine で事前に「残卓 ≤10 に収まるか」を判定し、収まらなければ UI でブロック＋警告（tx を発行しない） |
| 手動卓操作と `autoSeatLateEntry` の自動配席が競合（閉じた卓に自動再配席される等） | M | `isBroken` 卓を自動配席候補から除外する既存ロジックを確認・補強。手動操作直後の re-subscribe spike は許容 |
| 名前のみ player が `/live` を開けず参加者が混乱 | L | 運営者管理専用である旨を UI バッジで明示。次回ドライランで運用上の十分性を検証 |

---

## Implementation Phases

<!--
  STATUS: pending | in-progress | complete
  PARALLEL: phases that can run concurrently
  DEPENDS: phases that must complete first
  PRP: link to generated plan file once created
-->

| #   | Phase                          | Description                                                              | Status  | Parallel | Depends | PRP Plan |
| --- | ------------------------------ | ----------------------------------------------------------------------- | ------- | -------- | ------- | -------- |
| 1   | 受付代理 データ層              | rule 第3ブランチ＋clone 拡張、service/repository、emulator validator     | complete | with 3   | -       | [completed/phase-1-proxy-receipt-data-layer.plan.md](../plans/completed/phase-1-proxy-receipt-data-layer.plan.md) ／ [report](../reports/phase-1-proxy-receipt-data-layer-report.md) |
| 2   | 受付代理 UI                    | ダッシュボードの「参加者を追加」（メンバー選択 / 名前入力）、視覚バッジ   | complete | with 3   | 1       | [completed/phase-2-proxy-receipt-ui.plan.md](../plans/completed/phase-2-proxy-receipt-ui.plan.md) ／ [report](../reports/phase-2-proxy-receipt-ui-report.md) |
| 3   | 卓を空けて閉じる               | engine 定員引き上げ＋手動閉鎖 service/rule、自動再配置＋D&D 微調整 UI     | pending | with 1   | -       | -        |
| 4   | 卓を増やす／再開               | reopen / 卓追加 repository・service・UI、autoSeatLateEntry との責務整理   | pending | -        | 3       | -        |

### Phase Details

**Phase 1: 受付代理 データ層**

- **Goal**: 運営者がメンバー（uid 指定）と名前のみ（uid=null）の player を rule 適合で代理 create できる基盤を作る。
- **Scope**: `firestore.rules` の `players/{pid}` create に organizer-proxy-create ブランチ追加＋organizer-clone の state 拡張、`upsertPlayer` を運営者経路で呼ぶ service ラッパ、`pid==uid` 依存 callsite の characterization test、専用 emulator validator（`test-rules-proxy-create.mjs` 想定）。
- **Success signal**: emulator で「organizer が uid=null player / member uid player を受付可能 state で create できる」「member / 一般ユーザーが不正値で create すると deny」が green。既存 self-create / clone の deny ケースが非回帰。

**Phase 2: 受付代理 UI**

- **Goal**: 運営者がダッシュボードから 2 方式の代理受付を操作できる。
- **Scope**: 「参加者を追加」ダイアログ（タブ: メンバー一覧から選択 / 表示名入力 ≤15 字）、名前のみ player の管理専用バッジ（PlayerList / SeatingBoard）、**名前のみ player の表示名修正 UI（運営者編集、organizer-update 経路）**、エラー/重複ハンドリング（AppError + logger 準拠）。
- **Success signal**: E2E で「運営者がメンバーと名前のみの両方を追加 → PlayerList に反映 → 席決め対象になる」。本人不在 player が管理専用と分かる表示。

**Phase 3: 卓を空けて閉じる**

- **Goal**: 運営者が任意の卓を空けて閉じ、残卓へ自動再配置（定員一時引き上げ）＋D&D 微調整できる。
- **Scope**: engine の閉鎖判定を「残卓 ≤ MAX_SEATS_PER_TABLE で許可」へ拡張（pure function + characterization test）、手動閉鎖 service（`isBroken=true` + 再配置 tx）、SeatingBoard の「この卓を閉じる」UI、残卓超過時のブロック警告、既存 `applyManualSeatChange` 流用の微調整。
- **Success signal**: 「6名×3卓 → 8名×2卓」の集約が emulator/E2E で成立。残卓 10 名超の集約は実行前にブロック。`planTableBreak` 既存テスト非回帰。

**Phase 4: 卓を増やす／再開**

- **Goal**: レイトレジスト人数増時に運営者が卓を増やす／閉じた卓を再開し、**手動 D&D で配置**できる。
- **Scope**: `isBroken=false` へ戻す repository/service/UI（reopen）、新規卓追加経路、**増やした／再開した卓を `autoSeatLateEntry` の自動配席対象から除外**（手動配置を正規とする）、配置ガイドメッセージ（「どこへ動かすべきか」サポート表示）、rule の `tableNum <= 6` 上限維持確認。
- **Success signal**: 閉じた卓を再開／新規卓追加 → 自動配席されず → 運営者が手動 D&D で late entrant を配置できる E2E。`MAX_TABLES` 超過は deny。

### Parallelism Notes

要望①（Phase 1→2）と要望②（Phase 3→4）は対象データ（players vs tables）・rule ブランチ・UI が独立しているため**並行開発可能**。Phase 1 と 3 は同時着手でき、それぞれ UI（2）/ 拡張（4）が後続する。両系列とも seating orchestrator と SeatingBoard を触るため、最終統合時にマージ競合の確認を行う。

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| -------- | ------ | ------------ | --------- |
| 名前のみ player のモデル | `uid = null` の運営者管理専用 player（新 create ブランチ） | 本人アカウント移行可能にする | ユーザー回答「名前だけで良い」。schema は既に uid nullable で additive |
| メンバー代理の識別 | アカウント（uid）指定で `pid=uid` | 名前のみで統一 | ユーザー回答。uid 紐づけで season 集計を継続できる |
| 卓閉鎖時のプレイヤー移動 | 自動再配置＋D&D 手動微調整の両方 | 自動のみ / 手動のみ | ユーザー回答 Q1「両方」 |
| 卓数の双方向コントロール | 閉じる＋増やす（reopen / 追加）を両方提供 | 閉じるのみ | ユーザー回答 Q2: レイトレジスト人数増で卓追加が必要 |
| 残卓定員 | 閉鎖時に ≤ MAX_SEATS_PER_TABLE(10) で一時引き上げ | seatsPerTable 固定のまま | 「6名→8名」要望を満たしつつ rule の seatNum<=10 と drift しない |
| 残卓 10 名超の要求 | 実行ブロック + 警告（tx 発行せず中止） | ボタン disabled / 強行 | rule deny でトーナメント停止を避ける。ユーザー確定 |
| 卓追加／再開時の配置 | 手動 D&D 配置を正規（自動配席対象外）＋ガイドメッセージ | 自動配席する | BB 位置等アプリ外情報を運営者が考慮する必要があるため。ユーザー確定 |
| 名前のみ player の表示名修正 | Must（運営者編集 UI） | Could（後回し） | 入力ミス救済を必須化。ユーザー回答 |
| 集約方式 | クライアント直書き + Security Rules 防御 | Cloud Functions 化 | 既存方針踏襲。organizer は信頼ロールのため遅延可 |
| 初回卓数 | 従来通り自動算出を維持 | 作成画面で手動指定 | 要望は「開催中の閉じる/増やす」が本質。作成時手動指定はスコープ外 |

---

## Research Summary

**Market Context**
本アプリは MIT 公開の小規模サークル向け内製ツールであり、競合製品比較より実地ドライランのフィードバックが最も価値の高い検証源。一般的なポーカートーナメントタイマー（Tournament Director 系）は運営者による参加者の手動 add/remove と卓の手動 open/close を標準装備しており、本要望はその水準への追従に当たる。代理受付（本人 Auth 不要のゲスト管理）も一般的なパターン。

**Technical Context**
- 参加者登録は `upsertPlayer`（[repositories/players.ts](../../../../src/lib/firebase/repositories/players.ts)）に集約され、create rule は self-create / organizer-clone の 2 ブランチ（[firestore.rules:543-565](../../../../firestore.rules#L543-L565)）。`player.uid` は nullable schema 済み（[schemas/player.ts:8](../../../../src/lib/firebase/schemas/player.ts#L8)）。
- 席決め・バランシングは pure engine（[engine.ts](../../../../src/lib/services/seating/engine.ts)）＋ orchestrator（[orchestrator.ts](../../../../src/lib/services/seating/orchestrator.ts)）。卓数は `ceil(参加者数 / seatsPerTable)` 自動算出で `MAX_TABLES`(6) 制約。
- `tables/{tableId}` の有効/無効は `isBroken` 一方向フラグのみ（[schemas/table.ts](../../../../src/lib/firebase/schemas/table.ts)）。reopen / 追加 UI 経路は未実装。`markTableBroken`（[repositories/tables.ts](../../../../src/lib/firebase/repositories/tables.ts)）は呼出元なし。
- rule 変更は subcollection wildcard 厳禁・explicit ブランチ積み上げ・emulator validator 必須の既存規約（[firebase-patterns.md](../../../rules/firebase-patterns.md) / [group-membership.md](../../../rules/group-membership.md)）に従う。

---

_Generated: 2026-06-06_
_Status: DRAFT - needs validation_
