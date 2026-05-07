# シーズン戦績・結果カード・Table 名カスタム

## Problem Statement

ALLin-PokerTimer は月 1〜2 回の小規模サークル運用を前提としているが、開催間隔が空く中で「次回も参加しよう」という engagement を維持する仕組みが現状アプリ側に存在しない。
さらに会場で 3 卓以上展開すると「Table 1 / Table 2 / Table 3」という機械的な番号では口頭伝達ミスが起き、運営精度を地味に削っている。
両者の不在は、サークル継続率と運営効率の双方に同時に効くため、アプリの「単発開催ツール」から「サークル継続支援基盤」への質的転換に必要なギャップである。

## Evidence

- 実サークル運用時に複数人から「結果を記録・共有したい」という要望が直接上がった（Q1 a 回答 — 仮説ではなく観測事実）
- 開発者本人が会場参加した際、テーブル番号の口頭伝達精度に課題を実感している（Q4 後半の検証方針 = サークル参加時の実地確認）
- Phase 4.16 で `groups/{gid}.finishedTournamentCount` が integer 集計可能になり、Phase 5.4 で「同じ参加者で次のトーナメントを作成」が入った結果、「シーズン」という時間軸を扱う素地が整った

## Proposed Solution

3 つの機能を「サークル継続性パック」として 1 PRD にまとめる。

1. **⑧ シーズン戦績**: `groups/{gid}/seasonStats/{uid}` を新設し、`finishTournament` の runTransaction に相乗りする形で参加・優勝・FT・累計ポイントを atomic に増分。シーズン区切りは運営者の手動切替（`groups/{gid}.seasonStartDate` 更新 + 旧 stats を `seasonHistory/{seasonId}` に snapshot）。
2. **⑨ 結果カード生成**: `@vercel/og` で「優勝カード」と「シーズン首位カード」の 2 種を SSR 生成し、画像ダウンロードボタンで提供。Web Share API は Should（実装工数次第で MVP 後）。
3. **⑫ Table 名カスタム**: `tournaments/{tid}/tables/{n}.label` を additive 追加（カスタム文字列必須）、`color` は補助。`groups/{gid}.defaultTableLabels[]` で group 単位の既定値を持たせる。

採用理由: 3 機能とも既存パターン（`finishedTournamentCount` 増分 / `defaultSeatsPerTable` の group default / `affectedKeys` 強制）の純粋な拡張で、技術的リスクが低くスコープも明確。

## Key Hypothesis

我々は「**シーズンランキングと結果カードを LINE / X に貼れる導線、および Table 名のカスタム化**」が「**サークルの継続意欲低下と会場運用ミス**」を「**月 1〜2 開催のサークル運営者・参加者**」に対して解決すると信じている。
我々が正しかったと判断するのは、以下が観測されたとき:

- **結果カードの「画像保存」ボタンが実サークル運用で複数回押下される**こと（運営者・参加者問わず）
- **開発者がサークル参加時に、テーブル No の確認がアプリ上で完結したことを目視確認**できること（Table 名カスタムが口頭伝達ミスを実用上無くしたか）

## What We're NOT Building

- **PWA 化（旧⑪）/ 観戦モード URL（旧⑮）** — 同 `tmp/02_prod-V1/02-01_追加機能要求.md` 内の優先度中項目。別 PRD として後続で起こす
- **ポイント計算式の運営者カスタマイズ** — MVP は固定パラメータ式（順位ベース × 参加人数係数）。式の構造は `base[rank] × sqrt(participants / 8)` で固定し、`base[1..9 位]` の値と baseline=8 をハードコード。`groups/{gid}.seasonPointsRule` の自由化は次フェーズ送り
- **整数 pt への round / floor** — Q14 回答に基づき、ポイントは**小数 2 桁保持**（例: 6 人参加の 1 位 = `10 × sqrt(6/8) = 8.66pt`）。表示時の四捨五入は UI の責務、保存値は小数 2 桁で固定
- **シーズン自動切替（毎月 1 日 / 4 月 1 日 等）** — Q2 b 回答に基づき、運営者の明示的な「シーズン開始」操作のみ
- **OGP メタタグ / X Card 専用最適化** — Q3 回答に基づき、最低限「画像保存できれば各々 SNS にアップロード」で要件を満たす。Web Share API 統合は Should
- **シーズン跨ぎの個人累計（all-time）** — 現在シーズン + 履歴閲覧で十分。all-time 集計は次フェーズ
- **html2canvas 経由のクライアント側画像生成** — `@vercel/og` で SSR 生成に統一（Q9 確認済み、Vercel 依存は許容）

## Success Metrics

| Metric | Target | How Measured |
| ---- | ---- | ---- |
| 結果カード「画像保存」ボタンの押下発生 | 実サークル運用で**複数回**観測 | 開発者がサークル参加時に運用観測（暫定）／将来は logger.info 経由で集計可 |
| Table 名のアプリ上完結 | サークル参加時に「Table 1」表示が消え、カスタム Table 名で口頭伝達が完結 | 開発者がサークル参加時に目視確認（Q4 で本人検証と明示） |
| シーズン首位カードのシェア発生 | 月 1 回以上、サークル LINE / X で共有される | 運営者からの定性的フィードバック（暫定）|

## Open Questions

- [ ] ポイント計算式の `base[rank]` 値（1/2/3/4/5-9 位）と baseline=8 の妥当性が実運用で違和感ないか — シーズン 1 周目で運営者からヒアリング。特に 6 人開催（係数 ≈ 0.87）と 24 人開催（係数 ≈ 1.73）の実感値を比較
- [ ] 小数 2 桁保持の累計値（例: シーズン累計 47.83pt）がサークル LINE で読まれた際の印象 — 表示丸めを 1 桁にすべきか
- [ ] シーズン履歴の保持上限（過去何シーズンまで `seasonHistory/{seasonId}` に残すか）— Phase A 実装中に決定
- [ ] `@vercel/og` での日本語フォント埋込方式（システムフォント / Web フォント / Noto Sans JP の self-host）— Phase B 実装計画で確定
- [ ] テーブル `color` の選択肢（自由 16 進カラー vs 6〜8 色のプリセット）— Phase C 実装計画で確定
- [ ] Web Share API のフォールバック挙動（非対応ブラウザでは画像保存ボタンを表示）— Phase B 実装計画で確定

---

## Users & Context

**Primary User**

- **Who**: ALLin-PokerTimer を月 1〜2 回利用するサークルの **member（参加者）**および **organizer / owner（運営者）**。シーズン首位の LINE / X 投稿は参加者誰でも実施可能（Q6 b 回答）
- **Current behavior**: トーナメント終了後にスマホで Winner 画面を確認するが、「結果を共有したい」要望に対しスクリーンショット手動撮影で対応せざるを得ない。シーズンを跨いだ戦績の積み上げは個人の記憶頼り
- **Trigger**: トーナメント終了直後に Winner 画面を見た瞬間、または月初に「先月のシーズン首位は誰だったか」を運営者が告知したいタイミング
- **Success state**: 1 タップで「優勝カード PNG」「シーズン首位カード PNG」が保存され、各々が LINE / X にアップロードして盛り上がる。会場では「赤卓」「青卓」「初心者卓」のような Table 名で運営側 / 参加側双方の認知が一致

**Job to Be Done**

- 参加者: 「**トーナメントが終わった瞬間**、自分または優勝者の結果を **LINE / X で共有したい**ので、**手動スクリーンショット無しで見栄えの良い画像を即取得**したい」
- 運営者: 「**会場で複数卓を運営している**最中、参加者に **席案内を口頭で伝える**ので、**機械的な番号でなく独自の Table 名で誤認なく案内**したい」
- 運営者: 「**月 1〜2 回しか開催できない中**、参加者の **継続意欲を維持したい**ので、**シーズン首位を可視化してサークル LINE で素材として貼りたい**」

**Non-Users**

- **大規模公式トーナメント運営者**（数百人規模・複数日開催）— 集計データの保持期間や同時実行性が要件外
- **個人プレイ記録ツール利用者**（自分一人の戦績を all-time で追跡したい層）— 当アプリは group 単位の運用が前提で、個人記録の純粋なロガーとしては設計していない
- **匿名 / ゲスト参加者**で SNS 共有を望まない人 — 既存通り、画像保存ボタン非表示やシェア任意で対応

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
| ---- | ---- | ---- |
| Must | ⑧ シーズン参加回数・優勝回数・FT 回数・累計ポイントの集計と表示 | 仮説検証の核心。`finishTournament` tx に相乗りで整合性確保。ポイントは参加人数で重みが変わる（平方根スケール、baseline=8） |
| Must | ⑧ `defaultSeatsPerTable` 既定値の 9 → 8 への統一 | ポイント計算 baseline=8 と一致させ、運営者の体感「1 卓フル = 標準難度」を整合 |
| Must | ⑧ シーズン履歴 snapshot（過去シーズンの首位記録） | 運営者の「先月の首位は誰だったか」要望に直接対応 |
| Must | ⑧ シーズン手動切替（運営者が「シーズン開始」操作） | Q2 b 回答 — 自動切替は運用柔軟性を欠く |
| Must | ⑨ 優勝カード（Winner 画面に画像保存ボタン）| 実運用要望の最低線。`@vercel/og` で SSR 生成 |
| Must | ⑨ シーズン首位カード（ランキング画面に画像保存ボタン）| ⑧ とセットで初めて月 1〜2 開催の継続意欲フックになる |
| Must | ⑫ テーブル `label`（カスタム文字列）の tournament 単位設定 | Q7 — 数値より文字列が口頭伝達精度を上げる |
| Should | ⑫ テーブル `color`（卓カードの色帯） | 補助。3 卓以上で色被りするため label が主、color が副 |
| Should | ⑫ `groups/{gid}.defaultTableLabels[]`（group 単位デフォルト）| 毎回入力する手間を削る。`defaultSeatsPerTable` と同パターン |
| Should | ⑨ Web Share API 統合（OS シェアシートで LINE / X に直接送信）| 工数次第。MVP は画像保存のみで成立 |
| Won't | ⑧ ポイント計算式の運営者カスタマイズ | MVP は固定式。需要観測後に拡張 |
| Won't | ⑧ all-time（シーズン跨ぎ）累計集計 | 現在シーズン + 履歴で要件は満たせる |
| Won't | ⑨ html2canvas 経由クライアント側生成 | `@vercel/og` に統一 |
| Won't | ⑨ X Card / OGP メタタグ専用最適化 | Q3 — 画像保存で十分 |

### MVP Scope

仮説検証に最低限必要な範囲:

- ⑧ `groups/{gid}/seasonStats/{uid}` への atomic 増分（`finishTournament` tx 拡張）
- ⑧ シーズンランキング画面（サークル詳細配下に新規）
- ⑧ 「シーズン開始」操作（owner / organizer 限定）
- ⑨ 優勝カード PNG ダウンロード（Winner 画面）
- ⑨ シーズン首位カード PNG ダウンロード（シーズンランキング画面）
- ⑫ tournament 単位での `label` 設定 UI（テーブル管理画面の inline edit）

### User Flow

**シーズンランキング素材生成（参加者が LINE に貼る）**:
1. トーナメント終了 → Winner 画面 → 「優勝カード保存」ボタン押下 → PNG ダウンロード → 各自 LINE にアップロード
2. 後日、サークル詳細 → シーズンランキング画面 → 「シーズン首位カード保存」ボタン押下 → PNG ダウンロード → LINE / X に貼付

**Table 名カスタム（運営者が会場で）**:
1. トーナメント新規作成 → group の `defaultTableLabels[]` から各卓 label が auto-fill
2. 必要に応じて tournament 単位で label を inline 編集
3. SeatingBoard に「赤卓」「青卓」のように label が表示され、口頭伝達で「赤卓 3 番に座って」が成立

**シーズン切替（運営者・四半期 / 半期に 1 回）**:
1. サークル詳細画面 → 「シーズンを開始する」ボタン押下（owner / organizer 限定）
2. 確認モーダル → 現在の `seasonStats/{uid}` 全件を `seasonHistory/{seasonId}` に snapshot
3. `seasonStartDate` を現在時刻に更新、`seasonStats/{uid}` を空に reset

---

## Technical Approach

**Feasibility**: HIGH

既存の `finishedTournamentCount` 増分（[tournaments.ts#L550-L583](src/lib/firebase/repositories/tournaments.ts#L550-L583)）と `defaultSeatsPerTable` の group default パターン（[group.ts#L73-L92](src/lib/firebase/schemas/group.ts#L73-L92)）の純粋な拡張で、新規発明する設計要素は `@vercel/og` の導入と「シーズン切替の snapshot 操作」のみ。

**Architecture Notes**

- ⑧ `finishTournament` の runTransaction 内で `seasonStats/{uid}` 全プレイヤーを atomic 更新。tx 内で再 read による二重 increment 防止は既存パターン踏襲
- ⑧ ポイント計算は純関数（`src/lib/services/season-points.ts` 新設想定）に集約し、テスト可能性を担保。シグネチャは `calcSeasonPoints(rank: number, totalParticipants: number): number` で、内部式は `base[rank] × sqrt(totalParticipants / 8)` を**小数 2 桁切り上げ / 切り下げどちらか**で固定（実装計画で確定）。base 値は `[10, 7, 5, 3, 1, 1, 1, 1, 1]`（1..9 位、10 位以下は 0pt）を `src/lib/limits.ts` に集約
- ⑧ baseline=8 と既定席数 8 の整合: `src/lib/limits.ts` の `DEFAULT_SEATS_PER_TABLE` および [schemas/group.ts](src/lib/firebase/schemas/group.ts) の `defaultSeatsPerTable` zod default を 9 → 8 に変更。既存 group の保存値は影響なし（zod default は新規 hydrate 時のみ適用）
- ⑧ rule は `tournaments/{tid}` 配下と同じく **explicit match を積み上げ**で書く（CLAUDE.md / firebase-patterns.md の「subcollection rule 設計原則」遵守 — wildcard 復活厳禁）
- ⑨ `@vercel/og` は Next.js 15 の `app/api/og/[...]` route で SSR、Edge Runtime 推奨。日本語フォント埋込は Open Question で確定
- ⑫ rule は `tables/{tableId}` 既存ブランチに `affectedKeys().hasOnly(['label', 'color'])` 拡張で additive
- ⑫ group の `defaultTableLabels[]` は `groups/{gid}` update の新ブランチとして追加、CLAUDE.md の「allowed-keys 一覧」に追記必須

**Technical Risks**

| Risk | Likelihood | Mitigation |
| ---- | ---- | ---- |
| `finishTournament` tx に `seasonStats` 全プレイヤー更新を相乗りすると tx サイズが膨張し失敗率が上がる | M | 20 人規模なら Firestore tx の 500 ops 制限内で十分余裕。E2E で実測しベンチマーク |
| `totalPoints` の小数加算で浮動小数点誤差が累積し、複数シーズン跨ぎで「47.829999...pt」のような値が出る | L | 加算後に毎回 `Math.round(v * 100) / 100` で 2 桁丸め。`season-points.ts` 純関数のテストで 1000 トーナメント連続加算しても誤差が出ないことを確認。Firestore は number を IEEE 754 double で保持するため理論上の累積誤差は無視できる範囲 |
| `defaultSeatsPerTable` 既定値変更で既存サークルの新規 tournament 作成 UI が突然「8」表示になり驚かれる | L | 既存 group の保存値（多くは 9）は zod default が新規 hydrate 時のみ適用のため**そのまま 9 を維持**。新規作成 group のみ 8 になる。リリースノート / README で behavioral change を明示 |
| シーズン切替の snapshot がアトミックでないと「切替最中に finishTournament が走る」と整合崩壊 | L | 切替操作も runTransaction 化し、tx 内で `seasonStartDate` 更新と `seasonStats → seasonHistory` を 1 つに束ねる |
| `@vercel/og` の日本語フォント描画が遅い / フォントファイル サイズが Edge Runtime 制限を超える | M | サブセット化（必要文字のみ）or システムフォント fallback。Open Question で確定 |
| `groups/{gid}.defaultTableLabels[]` で organizer が悪意的に長大な配列を書き、storage を浪費 | L | rule で配列長 `<= MAX_TABLES (=6)` を強制、各要素の string 長制限も schema + rule で |
| シーズン履歴の保持期間が定まらず Firestore コストが想定外に増える | L | Open Question 化。MVP では無制限保持、運用観測後に retention を入れる |

---

## Implementation Phases

<!--
  STATUS: pending | in-progress | complete
  PARALLEL: phases that can run concurrently
  DEPENDS: phases that must complete first
  PRP: link to generated plan file once created
-->

| #   | Phase                       | Description                                                                                  | Status      | Parallel | Depends | PRP Plan                                                                                                          |
| --- | --------------------------- | -------------------------------------------------------------------------------------------- | ----------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| A   | Season Stats Foundation     | `seasonStats` / `seasonHistory` schema + finishTournament tx 拡張 + シーズン切替操作         | complete | with C   | -       | [phase-a-season-stats-foundation.plan.md](../plans/02-season-stats-and-share/completed/phase-a-season-stats-foundation.plan.md) — [report](../reports/02-season-stats-and-share/phase-a-season-stats-foundation-report.md) |
| B   | Result Card Generation      | `@vercel/og` 導入 + 優勝カード / シーズン首位カードの SSR 画像 route + ダウンロードボタン UI | in-progress | -        | A       | [phase-b-result-card-generation.plan.md](../plans/02-season-stats-and-share/completed/phase-b-result-card-generation.plan.md) — [report](../reports/02-season-stats-and-share/phase-b-result-card-generation-report.md) |
| C   | Table Label & Color         | tables.label / color 追加 + group defaultTableLabels + UI inline edit                        | complete | with A   | -       | [phase-c-table-label-color.plan.md](../plans/completed/phase-c-table-label-color.plan.md) — [report](../reports/phase-c-table-label-color-report.md) — [02-02 improvement report](../reports/phase-c-improvement-02-02-report.md) |
| D   | Web Share API & Polish      | Web Share API 統合（Should）+ シーズン履歴閲覧 UI 拡充 + 成功指標観測（Color picker は Phase C improvement-02-02 で完了済のため除外） | in-progress | -        | B, C    | [phase-d-web-share-and-polish.plan.md](../plans/completed/phase-d-web-share-and-polish.plan.md) — [report](../reports/phase-d-web-share-and-polish-report.md) — [improvement: past-season-detail](../plans/phase-d-past-season-detail-view.plan.md) |

### Phase Details

**Phase A: Season Stats Foundation**

- **Goal**: シーズン戦績の集計基盤と切替操作を確立
- **Scope**:
  - `groups/{gid}/seasonStats/{uid}`（`participations` / `wins` / `finalTables` / `totalPoints` / `lastUpdatedAt`）schema + repository + rule。`totalPoints` は **number 型で小数 2 桁保持**（rule で `is number && >= 0`、schema で `z.number().min(0)`）
  - `groups/{gid}/seasonHistory/{seasonId}` snapshot schema + repository + rule
  - `groups/{gid}.seasonStartDate` フィールド additive 追加 + rule の affectedKeys 拡張
  - `finishTournament` runTransaction の拡張（全プレイヤーの順位導出 → ポイント計算 → seasonStats atomic 更新）。`increment` ではなく tx 内で現値読出 → `+ calcSeasonPoints(...)` → set でアトミックに上書き（小数 加算のため）
  - `season-points.ts` 純関数（`calcSeasonPoints(rank, totalParticipants)` = `base[rank] × sqrt(totalParticipants / 8)`、小数 2 桁固定）+ characterization test。base 配列は `src/lib/limits.ts` に集約
  - **`src/lib/limits.ts` の `DEFAULT_SEATS_PER_TABLE` を 9 → 8 へ変更**、`schemas/group.ts` の `defaultSeatsPerTable` zod default も 8 へ。値域 2..10 は据え置き（rule 修正不要）。既存テスト fixture / E2E 期待値で `9` を assert している箇所の grep + 一括更新
  - サークル詳細画面の「シーズンを開始する」ボタン（owner / organizer 限定、確認モーダル付き）
  - シーズンランキング画面の新設（group メンバー全員 read 可）
- **Success signal**: トーナメント終了 → seasonStats が atomic に更新 → ランキング画面で正しい順位表示。emulator validator で rule の affectedKeys 強制を確認。6 人 / 8 人 / 16 人 / 20 人参加の 4 ケースで `calcSeasonPoints` の出力が手計算値と一致するユニットテスト

**Phase B: Result Card Generation**

- **Goal**: PNG 画像ダウンロードによる SNS シェア導線を提供
- **Scope**:
  - `@vercel/og` 依存追加 + 日本語フォント埋込方式の確定
  - `app/api/og/winner/[tid]/route.tsx` — 優勝カード SSR
  - `app/api/og/season/[gid]/route.tsx` — シーズン首位カード SSR
  - WinnerBanner.tsx に「画像保存」ボタン追加
  - シーズンランキング画面に「画像保存」ボタン追加
  - ダウンロードのアクセス制御（観戦モード未実装のため、現状 group メンバー限定で十分）
- **Success signal**: 開発者がサークル参加時に「画像保存」ボタンを押下し、生成画像が LINE / X に貼付できることを確認

**Phase C: Table Label & Color**

- **Goal**: Table 名のカスタム化で会場運用精度を向上
- **Scope**:
  - `tournaments/{tid}/tables/{n}.label` / `.color` を additive 追加（schema + rule の affectedKeys 拡張）
  - `groups/{gid}.defaultTableLabels[]`（配列長 <= MAX_TABLES、各要素 string 長制限）schema + rule + service
  - tournament 新規作成時に `defaultTableLabels` から auto-fill するロジック
  - SeatingBoard / TableCard / 各卓表示の label 反映（label 未設定時は `Table {n}` フォールバック）
  - サークル詳細画面の `defaultTableLabels` inline edit UI
  - tournament テーブル管理画面の label / color inline edit UI
- **Success signal**: 開発者がサークル参加時に「Table 1 / 2 / 3」表示が消え、カスタム Table 名で口頭伝達が完結したことを目視確認

**Phase D: Web Share API & Polish**

- **Goal**: シェア導線の摩擦を更に減らし、観測フェーズに入る
- **Scope**:
  - Web Share API 統合（対応ブラウザでは画像 + テキストを OS シェアシート経由で投げる）
  - 非対応ブラウザでの画像保存ボタン fallback
  - Color picker UI（プリセット 6〜8 色、ピンポイント自由色は次フェーズ）
  - シーズン履歴閲覧 UI のブラッシュアップ（過去 N シーズンの首位一覧）
  - 成功指標の観測（開発者サークル参加 + 運営者ヒアリング）
- **Success signal**: Web Share API 経由で 1 タップ LINE / X 投稿が成立。実サークル運用で「画像保存」ボタンが複数回押下される

### Parallelism Notes

- **Phase A と C は依存ゼロ**で並列実行可能。schema / rule / service / UI の領域が分かれており、コンフリクトしにくい
- **Phase B は A に依存**（シーズン首位カードが seasonStats を読むため）。優勝カード単独なら A 不要だが、PRD としては B を A 後に固める
- **Phase D は B / C 双方の polish** のため最後

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| ---- | ---- | ---- | ---- |
| シーズン区切り方式 | 運営者の手動切替 | 自動（毎月 / 4 月 1 日 等）| Q2 b 回答。サークル毎に開催ペースが異なり、自動切替は運用柔軟性を欠く |
| 結果カードの画像生成方式 | `@vercel/og`（SSR） | html2canvas（クライアント DOM キャプチャ）/ satori 単独 | Q9 確認済み。日本語フォント / 絵文字描画の安定性、Web Share API との相性、Vercel Hobby で動作 |
| ⑫ MVP 対象 | label を Must、color は Should | 両方 Must / 両方 Should | Q7 — 3 卓以上で色被りが起きるため label が主、color は補助 |
| ⑨ MVP の 2 種カード | 優勝カードとシーズン首位カードの 2 種を MVP | 優勝のみ MVP / 順次拡張 | Q8 a 回答。⑧ ⑨ がセットで初めて月 1〜2 開催の engagement フックになる |
| ⑨ Web Share API | Should（MVP は画像保存のみ） | Must（OS シェアシート前提）| Q3 — 各自 SNS にアップロードで最低限要件は満たせる |
| ポイント計算式の構造 | 順位 × 参加人数係数（`base[rank] × sqrt(participants / 8)`）| 単純固定式 / 線形スケール / 位次倍率テーブル | Q12 A 回答。「6 人と 20 人で差が付かないのは違和感」という運営者要望に対応。平方根スケールはポーカー業界（PokerStars 等）で広く採用され直感に合う。線形は差が極端、位次倍率はビン境界の不連続が気になる |
| ポイント計算 baseline 人数 | 8 人 | 9 人（既存 `defaultSeatsPerTable` 既定値）/ 6 人（最少卓） | Q13 回答。`defaultSeatsPerTable` 既定値も 9 → 8 へ統一し、「1 卓フル = 標準難度（係数 1.0）」という運営者の体感と整合させる。既存値域 2..10 は据え置き |
| ポイント保存精度 | 小数 2 桁保持 | 整数 round / 整数 floor / 小数 1 桁 | Q14 回答。8 人 baseline で参加人数が変わると小数が出る（例: 6 人 1 位 = 8.66pt）ため、保存値は小数 2 桁で精度を守り、表示は UI 責務で丸める |
| シーズン跨ぎ集計 | 現在シーズン + 履歴のみ | all-time 累計併設 | スコープ膨張回避。需要観測後に追加 |
| PRD 単位 | 優先度高 3 機能を 1 PRD（B 案） | 5 機能統合（A） / 機能ごと 5 PRD（C） | ユーザー選択。⑧ ⑨ の連続実装価値と PRD の保守性を両立 |
| Phase D の Color picker 取扱い | Phase C improvement-02-02 で完了済のため Phase D scope から除外 | Phase D で再実装 / 新 phase に分離 | 重複作業回避。10 色プリセット + カスタム hex picker + サークル詳細プリセット共有が Wave 1 / Wave 3 で実装済（[phase-c-improvement-02-02-report.md](../reports/phase-c-improvement-02-02-report.md)）。Phase D は Web Share API + シーズン履歴閲覧 + 成功指標観測に集中 |

---

## Research Summary

**Market Context**

ALLin-PokerTimer は「小規模サークル特化 + MIT OSS」のニッチで、商用ポーカー運営ソフトウェア（PokerTH / Poker Mavens 等）はサークル LINE 共有のような UX を提供していない。SNS シェア導線を内蔵するスポーツ・ゲーム系サークルアプリ（一般的な参加型イベント管理 SaaS）でも、「シーズン首位の自動可視化」「会場の Table 名カスタム化」を同時に持つ事例は調査範囲では確認できず。本 PRD のスコープは ALLin-PokerTimer の「サークル継続支援基盤」というポジションで差別化要素になる。

**Technical Context**

コードベース調査により、以下が確認済み:

- ⑧ 増分パターンの素地は完備 — [tournaments.ts#L550-L583](src/lib/firebase/repositories/tournaments.ts#L550-L583) の `finishTournament` が `runTransaction + increment` + tx 内 state 再 read で二重 increment 防止済み
- ⑧ 順位導出は既存データのみで可能 — [timer.ts#L79-L90](src/lib/services/timer.ts#L79-L90) の `resolveWinner` + `players[].bustedAt` で純関数化可。新フィールド追加不要
- ⑫ tables schema は極小（`tableNum / isBroken / createdAt` のみ）で additive 追加が容易 — [table.ts#L9-L13](src/lib/firebase/schemas/table.ts#L9-L13)
- ⑫ group default パターンの先例完備 — `audioSettings` / `defaultSeatsPerTable` が schema + rule + service + UI の 4 点同期で実装済み
- ⑨ Canvas 基盤は未導入 — package.json に html2canvas / @vercel/og / satori 等なし。新規ライブラリ 1 本追加が必要
- groups update ブランチは 6 分岐の精密設計（owner / self-add / self-leave / displayName / audioSettings / finishedTournamentCount / defaultSeatsPerTable）で、新フィールド `seasonStartDate` / `defaultTableLabels` 追加は同パターン

CLAUDE.md / firebase-patterns.md / group-membership.md の規約遵守を Phase 単位の plan で機械検査可能（emulator validator + drift detection script）。

---

_Generated: 2026-05-06_
_Status: DRAFT - needs validation_
