# 第 2 回ドライラン改善（ストラクチャ一括設定・シーズン導線・音声タイミング）

## Problem Statement

第 2 回ドライラン（実会場での運営テスト）で、運営者から 5 件の改善要望が挙がった。いずれも「運営オペレーションの手間」「不具合による違和感」「タイマー進行の体感品質」に直結し、放置すると本番運用時に運営者の負荷増大・参加者への誤った演出（終了済みなのに優勝音が鳴る）・タイマーへの不信感につながる。小規模サークルの「熟練者不在でも回せる」という核心価値を損なわないために、運営 UX の摩擦を取り除く。

## Evidence

- ドライラン要望ファイル [tmp/06_second-dryrun/06-01_要望.md](../../../../tmp/06_second-dryrun/06-01_要望.md) に運営者の生の声を記録:
  - 「ストラクチャの時間を一括設定できるようにしてほしい。ただし、今の個別設定は必要。切り替えられるようにしたい」
  - 「サークル詳細で『シーズン』タブを選択したら今シーズンの順位が見える状態にしてほしい。たどり着くまでの階層が深い」
  - 「終了済みのトーナメントの『運営』ボタンを押下してページを開いた際に優勝音が再生されないようにしたい」
  - 「ブラインドアップ時の音声再生のタイミングをブラインド開始時ではなく、ブラインド終了時にしたい」
  - 「現状はブラインド開始時のタイマーが 2 秒ほど飛ぶ。音声再生が引っかかっているように感じる」
- コードベース調査による裏付け:
  - 終了済み優勝音バグは [useAudioPlayer.ts:195-205](../../../../src/lib/hooks/useAudioPlayer.ts#L195-L205) で再現条件を確認（`resolveWinner` が finished でも winner を返し、null→winner 遷移で発火）。**確証のあるバグ**。
  - 音声は既に `void play()` の fire-and-forget（[useAudioPlayer.ts:126](../../../../src/lib/hooks/useAudioPlayer.ts#L126)）。要望 ⑤ の「非同期化で解決」という仮説は**コード上は既に非同期**であり、2 秒飛びの真因は別（要調査）。

## Proposed Solution

5 件を 1 つの改善 PRD として扱い、独立性の高い 3 領域（ストラクチャ編集 UI / シーズン導線 / 音声・タイマー）に分けて段階実装する。各領域は既存実装への additive な変更で、schema 変更は原則不要（ストラクチャは `durationSec` の一括代入のみ、音声・タイマーはトリガー条件の変更のみ）。最もリスクの高い音声・タイマー領域（④⑤）は characterization test で現行挙動を固定してから着手する。

## Key Hypothesis

We believe **ストラクチャ時間の一括設定・シーズン順位のワンタップ表示・音声タイミングのローカル前倒し** will **運営オペレーションの手間と進行中の違和感を取り除く** for **小規模サークルの運営者**。
We'll know we're right when **次回ドライラン（または本番運用）で同じ 5 要望が再提起されず、運営者がストラクチャ作成・シーズン確認・タイマー進行を違和感なく完了できる**。

## What We're NOT Building

- **ストラクチャレベルの並べ替え（ドラッグ&ドロップ）** — 今回の要望外。現状 [LevelTable.tsx](../../../../src/components/structure/LevelTable.tsx) は並べ替え未実装だが、本 PRD のスコープに含めない。
- **音声カタログ・音源追加・音量カーブの変更** — 既存の audioSettings 体系はそのまま。今回はトリガー**タイミング**のみ変更。
- **シーズンポイント計算ルール・履歴機能の刷新** — 既存の `/season` ページ機能は維持。今回は導線（タブ内インライン表示）のみ。
- **タイマーのサーバー権威モデルの再設計（Cloud Functions 化等）** — 2 秒飛びはまず原因特定とクライアント側の体感改善で対応し、アーキテクチャ刷新は将来課題。

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| ストラクチャ一括設定の所要操作 | 全レベルの時間設定が 1 操作で完了 | 一括モードで 1 入力 → 全レベル `durationSec` 反映を E2E / 手動確認 |
| シーズン順位到達クリック数 | 2 クリック → 1 クリック（タブ選択のみ） | シーズンタブ選択で順位表が即表示されることを E2E 確認 |
| 終了済み優勝音の再発防止 | 0 件（finished ページ表示で鳴らない） | characterization test + 手動確認 |
| ブラインドアップ音のタイミング | レベル終了（残り 0）の瞬間に再生 | 手動確認（体感）＋ unit でトリガー条件を検証 |
| タイマー 2 秒飛びの体感 | 飛びが知覚されない、または原因が特定され緩和される | 手動確認 + 原因調査レポート |

## Open Questions

- [ ] 2 秒飛びの真因はどこか — `levelStartedAt` の Firestore 往復遅延か、`getRemainingMs` の計算か、tick 解像度（1 秒 setInterval）か。Phase 3 の調査で確定する。
- [ ] ローカルで「残り 0 検知」して音を鳴らした後、Firestore の `currentLevel` 確定が遅延した場合の二重再生防止をどう担保するか（ローカル検知済みフラグで currentLevel 変化トリガーを抑止する設計が必要）。
- [ ] 手動レベル変更（運営者ボタン）時のローカル検知の扱い — 現状 `lastLevelChangeKind === "manual"` で skip しているが、ローカル前倒しでも同等の skip を維持するか。
- [ ] ストラクチャ一括設定モードの状態（一括/個別トグル）を永続化するか、画面を開くたびに個別モード既定にするか。

---

## Users & Context

**Primary User**

- **Who**: 小規模ポーカーサークルの運営者（owner / organizer）。熟練者とは限らず、アプリの指示通りに会を進める想定。
- **Current behavior**: トーナメント前にストラクチャをレベルごとに 1 行ずつ時間入力。シーズン順位を見るためにサークル詳細 → シーズンタブ → 「ランキングを見る」と 2 段階で遷移。会の進行中はタイマーを大画面に映して運営。
- **Trigger**: トーナメント準備時（ストラクチャ作成）／会の合間や終了後（順位確認）／レベルアップの瞬間（音声・タイマー）。
- **Success state**: 設定が速く済み、順位が即見え、レベルアップ演出が違和感なく、終了後に誤った演出が出ない。

**Job to Be Done**
When **トーナメントを準備・進行・締めるとき**, I want to **最小操作でストラクチャを組み、順位を即確認し、タイマーと音が正しく鳴る状態にしたい**, so I can **熟練者がいなくても会をスムーズに回せる**。

**Non-Users**
一般参加者（member）・観戦者は本 PRD の直接対象外。ただし音声・タイマーの改善は参加者の観戦体験にも波及する（副次効果）。

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
| --- | --- | --- |
| Must | ストラクチャ編集に「一括設定モード」を追加し、個別設定モードとトグル切替（一括は**全レベル一律同じ分数**） | 要望 ①。運営の準備手間を直接削減 |
| Must | シーズンタブ選択時に順位表をタブ内インライン表示 | 要望 ②。導線の階層を 1 段削減 |
| Must | 終了済み（finished）トーナメントで優勝音を鳴らさないガード | 要望 ③。確証のあるバグ修正 |
| Must | ブラインドアップ音を「ローカルで残り 0 検知」した瞬間に非同期再生 | 要望 ④。タイミング改善 |
| Must | タイマー 2 秒飛びの原因調査と緩和（④と同 PR で根本対応まで） | 要望 ⑤。進行品質の信頼性 |
| Should | ローカル検知再生と Firestore currentLevel 変化トリガーの二重再生防止 | ④ の副作用を防ぐ実装要件 |
| Could | 一括/個別トグル状態の永続化 | あれば便利だが MVP には不要 |
| Won't | ストラクチャレベルの並べ替え（D&D） | 今回要望外・スコープ膨張防止 |
| Won't | 音源・音量・カタログ変更 | タイミングのみ対象 |

### MVP Scope

要望 5 件すべてを満たすことが MVP。各要望は独立して価値があるため、領域単位（ストラクチャ / シーズン / 音声・タイマー）でインクリメンタルにリリース可能。最低限、③（バグ修正）は最優先で単独リリースしてよい。

### User Flow

- **ストラクチャ**: 編集画面で「一括/個別」トグル → 一括選択 → 全レベル共通の分数を 1 入力 → 全レベルの `durationSec` に反映 → 保存。
- **シーズン**: サークル詳細 → 「シーズン」タブ選択 → その場に今シーズン順位表が表示（追加クリック不要）。
- **音声**: 会進行中、レベルの残り時間がローカルで 0 に到達した瞬間にブラインドアップ音が非同期で鳴る。終了済みトーナメントの運営ページを開いても優勝音は鳴らない。

---

## Technical Approach

**Feasibility**: HIGH（領域 ① ② ③）／ MEDIUM（領域 ④ ⑤ — 二重再生防止とタイマー原因調査に不確実性）

**Architecture Notes**

- **①ストラクチャ一括設定**: [LevelTable.tsx](../../../../src/components/structure/LevelTable.tsx)（新規作成 [structure-new-client.tsx](../../../../src/app/structures/new/structure-new-client.tsx) と編集 [structure-edit-client.tsx](../../../../src/app/structures/[sid]/edit/structure-edit-client.tsx) の両方が共有）に一括/個別トグルと一括入力 UI を追加。`durationSec`（分入力→秒変換）を全行に代入する純関数を切り出す。schema（[structure.ts](../../../../src/lib/firebase/schemas/structure.ts)）・repository（[structures.ts](../../../../src/lib/firebase/repositories/structures.ts)）は変更不要。
- **②シーズンタブ**: [group-detail-client.tsx:413-429](../../../../src/app/groups/[gid]/group-detail-client.tsx#L413-L429) のシーズンタブに、[season-ranking-client.tsx](../../../../src/app/groups/[gid]/season/season-ranking-client.tsx) の順位表描画を再利用するインライン版を組み込む。`subscribeSeasonStats`（[seasonStats.ts:81-116](../../../../src/lib/firebase/repositories/seasonStats.ts#L81-L116)）をタブ内で購読。既存 `/season` ページは過去履歴詳細用に維持。順位表描画を共有コンポーネント化して重複を避ける。
- **③終了済み優勝音**: [useAudioPlayer.ts:195-205](../../../../src/lib/hooks/useAudioPlayer.ts#L195-L205) の winner effect に finished ガードを追加（`isInProgress` / `isFinished` の [tournament-state.ts](../../../../src/lib/services/tournament-state.ts) helper を経由）。finished のときは `prevWinnerIdRef` を更新するが `play()` しない。
- **④音声タイミング**: 現状 [useAudioPlayer.ts:174-193](../../../../src/lib/hooks/useAudioPlayer.ts#L174-L193) は Firestore の `currentLevel` 変化を検知して再生。これを、タイマー（[useTournamentTimer.ts](../../../../src/lib/hooks/useTournamentTimer.ts) / [timer.ts](../../../../src/lib/services/timer.ts) の `getRemainingMs`）が**ローカルで残り 0 を検知**したタイミングで非同期再生するよう変更。currentLevel 変化トリガーは二重再生防止のためローカル検知済みフラグで抑止。`lastLevelChangeKind === "manual"` の skip は維持。
- **⑤タイマー 2 秒飛び**: まず原因を特定（`levelStartedAt` の Firestore 往復遅延 / pending write / tick 解像度のいずれか）。[timer.ts:40](../../../../src/lib/services/timer.ts#L40) の計算式とサーバータイムスタンプ依存を中心に調査。④のローカル前倒しと合わせて体感改善し、残差があればクライアント側で楽観的に levelStartedAt を補正する等で緩和。

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| ④で二重再生（ローカル検知 + currentLevel 変化の両方で鳴る） | M | ローカル検知済みフラグ（level 単位）で currentLevel トリガーを抑止。unit でトリガー条件を固定 |
| ⑤の真因がアーキ起因で完全解消できない | M | まず原因調査レポートを出し、クライアント側の緩和で体感改善。完全 race-free は将来課題として明記 |
| 音声・タイマー変更による既存挙動のデグレ（手動レベル変更・seating→running 遷移・ミュート） | M | characterization test ファースト（着手前に現行トリガー条件を unit で固定）。[testing.md](../../../../.claude/rules/testing.md) 準拠 |
| ②インライン化で `/season` ページとの描画ロジック重複 | L | 順位表を共有コンポーネントに抽出してから両所で利用 |
| ①一括代入でブレイクレベルの扱いが想定と異なる | L | 「全レベル一律同じ分数」の決定に従い、ブレイク含め一律代入。E2E / 手動で確認 |

---

## Implementation Phases

<!--
  STATUS: pending | in-progress | complete
  PARALLEL: phases that can run concurrently
  DEPENDS: phases that must complete first
  PRP: link to generated plan file once created
-->

| #   | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1   | ストラクチャ一括設定 | LevelTable に一括/個別トグル＋全レベル一律時間入力を追加（要望①） | complete | with 2, 3 | - | [structure-bulk-duration.plan.md](../plans/completed/structure-bulk-duration.plan.md) · [report](../reports/structure-bulk-duration-report.md) |
| 2   | シーズンタブ順位インライン | シーズンタブ選択で順位表を即表示（要望②） | complete | with 1, 3 | - | [season-tab-inline-ranking.plan.md](../plans/completed/season-tab-inline-ranking.plan.md) · [report](../reports/season-tab-inline-ranking-report.md) |
| 3   | 終了済み優勝音バグ修正 | finished で優勝音を鳴らさないガード（要望③） | complete | with 1, 2 | - | [finished-winner-sound-guard.plan.md](../plans/completed/finished-winner-sound-guard.plan.md) · [report](../reports/finished-winner-sound-guard-report.md) |
| 4   | 音声タイミング＋2秒飛び | ローカル残り0検知で非同期再生＋タイマー2秒飛び原因調査・緩和（要望④⑤） | pending | -        | 3       | - |

### Phase Details

**Phase 1: ストラクチャ一括設定（要望①）**

- **Goal**: 全レベルの時間を 1 操作で一律設定でき、個別設定モードにトグルで戻せる。
- **Scope**: [LevelTable.tsx](../../../../src/components/structure/LevelTable.tsx) に一括/個別トグル UI と一括分数入力を追加。全行 `durationSec` 一律代入の純関数を切り出し unit test。新規作成・編集の両クライアントで利用可能に。schema / repository は不変。
- **Success signal**: 一括モードで 1 入力 → 全レベル（ブレイク含む）が同分数で保存される。個別モードは従来通り動作。

**Phase 2: シーズンタブ順位インライン（要望②）**

- **Goal**: シーズンタブを開くだけで今シーズン順位が見える（追加クリック不要）。
- **Scope**: 順位表描画を共有コンポーネント化し、[group-detail-client.tsx](../../../../src/app/groups/[gid]/group-detail-client.tsx) のシーズンタブにインライン埋め込み。`subscribeSeasonStats` 購読。既存 `/season` ページは過去履歴詳細用に維持。
- **Success signal**: タブ選択のみで順位表が表示される（E2E）。既存 `/season` ページも引き続き動作。

**Phase 3: 終了済み優勝音バグ修正（要望③）**

- **Goal**: finished トーナメントの運営ページを開いても優勝音が鳴らない。
- **Scope**: [useAudioPlayer.ts](../../../../src/lib/hooks/useAudioPlayer.ts) の winner effect に finished ガードを追加。characterization test で「進行中は鳴る / finished は鳴らない」を固定。
- **Success signal**: finished 表示で無音、進行中の正常な優勝音は維持（unit + 手動）。

**Phase 4: 音声タイミング＋タイマー 2 秒飛び（要望④⑤）**

- **Goal**: ブラインドアップ音をレベル終了（残り 0）の瞬間にローカル検知で非同期再生し、2 秒飛びの原因を特定して体感を改善する。
- **Scope**: ④トリガーを currentLevel 変化からローカル残り 0 検知に変更（二重再生防止フラグ込み）。⑤ `levelStartedAt` / `getRemainingMs` / tick 解像度を調査し原因レポートを出力、クライアント側で緩和。characterization test ファースト。
- **Success signal**: レベル終了瞬間に音が鳴る／二重再生なし／手動レベル変更・seating→running で誤発火しない／2 秒飛びの原因が特定され体感が改善。

### Parallelism Notes

- Phase 1 / 2 / 3 は対象ファイルが分離（ストラクチャ UI / シーズン UI / 音声 hook）しており並行実装可能。
- Phase 4 は Phase 3 と同じ [useAudioPlayer.ts](../../../../src/lib/hooks/useAudioPlayer.ts) を触るため、Phase 3 のガード追加後に着手して衝突を避ける（DEPENDS: 3）。④⑤は密結合のため同一 PR で扱う。

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| 一括設定の挙動 | 全レベル一律同じ分数 | プレイのみ一律＋ブレイク個別 / プレイとブレイクを別々に一括 | ユーザー決定。最もシンプルで要望を満たす |
| シーズン導線改善の範囲 | 順位表をタブ内にインライン表示（`/season` ページは履歴詳細用に維持） | 別ページごとタブに統合し `/season` 廃止 | ユーザー決定。既存履歴機能を壊さず導線だけ短縮 |
| ブラインドアップ音のタイミング | ローカルで残り 0 検知時に即（非同期）再生 | currentLevel 変化トリガーのまま音声プリロードで高速化 | ユーザー決定。Firestore 往復遅延の影響を受けず④⑤両方に効く |
| 2 秒飛びのスコープ | ④と同一 PR で根本調査・対応まで | ④の前倒しで様子見し残れば別 Phase / 今回は調査のみ | ユーザー決定。④と密接なため同時対応 |
| 5 要望の PRD 構成 | 1 PRD・4 Phase（領域別） | 要望ごとに 5 PRD | 規模が小さく相互に独立、1 PRD で十分管理可能 |

---

## Research Summary

**Market Context**
ポーカートーナメントタイマー（Poker Timer / Blind Timer 系アプリ）では、ブラインド構造の一括時間設定（全レベル同一 duration のクイック設定）と個別カスタムの併用は一般的な UX パターン。レベルアップ音はカウントダウン終端（残り 0）で鳴らすのが標準で、本要望 ④ は業界標準への接近。順位・スタンディングをワンタップで見せるのもトーナメント運営アプリの定石。

**Technical Context**
- ストラクチャ編集はレベルごとの個別入力 UI（[LevelTable.tsx](../../../../src/components/structure/LevelTable.tsx)）。schema [structure.ts](../../../../src/lib/firebase/schemas/structure.ts) は `level/sb/bb/ante/durationSec/isBreak` の 6 フィールド。一括代入は `durationSec` への一律セットのみで schema 不変。
- シーズン順位は別ページ [season-ranking-client.tsx](../../../../src/app/groups/[gid]/season/season-ranking-client.tsx) に存在。`subscribeSeasonStats` をタブ内で購読すればインライン化可能。
- 音声は [useAudioPlayer.ts](../../../../src/lib/hooks/useAudioPlayer.ts) に集約。levelUp は `currentLevel` 変化検知（174-193）、winner は `resolveWinner` の null→winner 遷移（195-205）。**両方とも `void play()` で既に非同期**。終了済み優勝音バグは winner effect が finished をガードしていないため。
- タイマーは [useTournamentTimer.ts](../../../../src/lib/hooks/useTournamentTimer.ts)（1 秒 setInterval tick）＋ [timer.ts](../../../../src/lib/services/timer.ts) の `getRemainingMs`（`Date.now()` とサーバー `levelStartedAt` の差分）。2 秒飛びは音声ブロッキングではなく、レベル遷移時の `levelStartedAt` 確定遅延（Firestore 往復）が有力。要調査。

---

_Generated: 2026-05-30_
_Status: DRAFT - needs validation_
