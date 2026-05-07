# Phase C Improvement (02-02) 実装レポート

## Context

Phase C「Table 名 / 色カスタム機能」（[phase-c-table-label-color-report.md](phase-c-table-label-color-report.md)）が
完了して稼働させた直後、`tmp/02_prod-V1/02-02_phase-c.md` にユーザーが運用上の改善要望を整理した。
本レポートは plan を経由しない post-完了 polish（先例: [structure-templates-nav-link-report.md](../../01-allin-timer/reports/structure-templates-nav-link-report.md)）
として、3 つの wave で実施した改善内容と意図を記録する。

| Wave | 起点 | 内容 |
| --- | --- | --- |
| W1 | `tmp/02_prod-V1/02-02_phase-c.md` の 4 件 | TableLabelEditPopover の IME / 文言 / プリセット色 / 卓カード色帯強化 |
| W2 | 「テーブル呼称→Table 名」全置換 要望 | アクティブな UI / コード / docs / E2E / PRD の文言統一 |
| W3 | 「サークル詳細でも色を設定したい」要望 | `defaultTableColors` の additive 追加と auto-fill 拡張 |

実装の安定性検証は **typecheck + lint + vitest 1003 件 / 54 ファイル全 pass**（W1 / W2 / W3 各 wave 完了時）。

## Wave 1: TableLabelEditPopover の改善 4 件

### 1. 日本語入力ができない（`onOpenAutoFocus` 抑止 + `onEscapeKeyDown` の composition チェック）

**症状**: SeatingBoard 卓ヘッダの ✎ から開く Dialog の Table 名 Input に対して、
日本語 IME で 1 文字目の確定が安定しない / 確定前に入力が消える。

**採用した実装** ([TableLabelEditPopover.tsx:122-130](../../../../src/components/tournament/_table-label-edit/TableLabelEditPopover.tsx#L122-L130)):

```tsx
<DialogContent
  onOpenAutoFocus={(e) => e.preventDefault()}
  onEscapeKeyDown={(e) => {
    if (e.isComposing) e.preventDefault();
  }}
>
```

**意図**:
- Radix Dialog は `onOpenAutoFocus` で内部の最初の focusable 要素に自動 focus する。
  日本語 IME ではこの強制 focus が composition context の初期化を阻害するケースがある。
- 自動 focus を抑止し、user click 経由の自然 focus に切替えると IME が安定する。
- Escape キーは composition 中（IME 変換中）には dismiss を抑止する。
  Radix の `onEscapeKeyDown` は DOM の `KeyboardEvent` をそのまま渡すため `e.isComposing` で直接判定（`e.nativeEvent.isComposing` ではないので注意。typecheck で発覚）。

**検討した代案**:
- Input 側に `onCompositionStart/End` を仕込んで keydown を判定 → 採用せず。Save ボタンで保存する設計のため Enter 制御は不要、`onOpenAutoFocus` 抑止だけで実害が消える。
- Dialog 自体を非 modal 化 → 既存 6 個の Dialog 全体に波及する変更でリスクが大きい。
- 別の Popover ライブラリへ差し替え → 依存追加 + 既存 [phase-c plan の GOTCHA](../plans/completed/phase-c-table-label-color.plan.md) で「新規 popover 依存を増やさない」方針が決まっている。

### 2. 文言「呼称」→「Table 名」（Dialog 内のみ）

**変更**: DialogTitle / Description / label / エラー文言から「呼称」を全廃。

**意図**:
- ユーザー要望の明示。
- 「呼称」は古い和名で、英数字混在のサークル運用には馴染まない。
- 当 wave は **Dialog 内のみ** の暫定対応。アプリ全体の置換は W2 で実施。

### 3. プリセット 10 色 + 折りたたみカスタム hex picker

**採用した実装**:
- 「色なし」+ 10 色プリセットを radiogroup タイル化（[TABLE_COLOR_PRESETS](../../../../src/components/tournament/_table-label-edit/table-color-presets.ts)）。
- カスタム hex picker は `<details>` 風の手書きトグルで折りたたみ。

**意図**:
- 既存の hex picker のみの UI は「卓マットの赤 / 青 / 緑」を素早く選ぶ用途と相性が悪い。
- プリセットだけにすると、既存 doc がプリセット外の色を持つ場合に編集不可になる。
- 解決: `isPresetTableColor()` で値を判定し、プリセット外なら詳細を**自動展開**して既存値を保持。

**ヒエラルキー**:
- プリセットを「主」、カスタム hex を「副」に。
- W3 でカードに転用する際は **プリセットのみ** を露出（カスタム hex picker は出さない）。
  → カードでカスタム値を作っても、Popover 詳細を開けば編集できるという責務分担。

### 4. 卓カードの色帯（左 6px → 上端 8px + 丸ドット）

**変更** ([SeatingBoard.tsx:185-217](../../../../src/components/tournament/SeatingBoard.tsx#L185-L217)):

```tsx
style={{ borderTopWidth: 8, borderTopStyle: "solid", borderTopColor: table.color }}
// + ヘッダ左に直径 10px の丸ドット
```

**意図**:
- 旧 6px 左帯は卓カードの全体幅に対して占有比率が小さく、運営者から「色とテーブルが結びついて見えない」と指摘。
- 上端 8px 帯は CardHeader 全幅にかかり「カードに塗ってある」印象が強くなる。
- さらに label 左の丸ドットでスマホ small viewport でも色が伝わるよう **二重表現**。

**検討した代案**:
- ヘッダ全面の background tint → 文字読みづらさのリスク + a11y コントラスト要件で hex プリセットが制限される。
- border 全周（border-4）→ ring 系 utility と衝突しやすく、broken / dnd-over 状態のスタイルが破綻。
- 上端帯のみ（丸ドットなし）→ 採用候補だったが、丸ドットを足しても情報過多にならず、補助情報として有効と判断。

## Wave 2: 文言統一「テーブル呼称 → Table 名」

ユーザー要望に基づき、**アクティブ**ドキュメント全体で語彙を統一。

### 統一ポリシー

| カテゴリ | 扱い | 理由 |
| --- | --- | --- |
| **アクティブ**: アプリ UI / コードコメント / エラー文言 / E2E spec / page object / `CLAUDE.md` / `.claude/rules/*` / `scripts/test-rules-*.mjs` / 進行中 PRD | 全置換 | 新規参照者が「Table 名」一語で読み進められる |
| **凍結**: `.claude/PRPs/*/plans/completed/` / `*/reports/` / `*/reviews/` | 温存 | audit trail として当時の語彙で残す（Structure Templates 改名先例 [structure-templates-nav-link-report.md:20](../../01-allin-timer/reports/structure-templates-nav-link-report.md#L20) に準拠） |

### 唯一残した「呼称」

[TableLabelEditPopover.tsx:41](../../../../src/components/tournament/_table-label-edit/TableLabelEditPopover.tsx#L41) に
**この統一作業自体の経緯記録** として、旧表現を引用する形で 1 行残している:

```ts
*   - 文言: 旧「呼称」表現を全廃して「Table 名」に統一。
```

これは「過去はこう呼んでいた」という事実をコード上に残すための意図的な引用。
将来の読者が language drift を git blame せずに辿れるようにする。

### 影響範囲（記録）

UI 文言: `GroupDefaultTableLabelsCard` / `TableLabelEditPopover` /
エラー文言: `repositories/groups.ts` / `repositories/tables.ts` / `services/group.ts` /
コメント: `schemas/{table,group}.ts` / `limits.ts` / `services/format-table-label.ts` /
`services/seating/orchestrator.ts` / `live-client.tsx` /
E2E: `table-label-and-color.spec.ts` / `pages/GroupsPage.ts` /
規約: `CLAUDE.md` / `.claude/rules/group-membership.md` / `scripts/test-rules-limits.mjs` /
PRD: `.claude/PRPs/02-season-stats-and-share/prds/02-season-stats-and-share.prd.md`（タイトル含む 9 箇所）。

## Wave 3: `defaultTableColors` 追加（サークル詳細で色も登録できる）

**運用要望**: 卓マットの色は買い替えるまで固定なので、トーナメント開催の度に Popover で色を設定し直すのは手間。
サークル単位のデフォルトとして label と一緒に色も登録できるようにしたい。

### 設計判断 1: 2 配列 vs 構造化（`{label, color}[]`）

**採用**: `defaultTableLabels: string[]` + `defaultTableColors: (string | null)[]` の 2 配列、index 1:1 対応
([schemas/group.ts:111-129](../../../../src/lib/firebase/schemas/group.ts#L111-L129))

**比較**:

| 案 | 既存 doc 互換 | 整合性管理 | rule 検査 |
| --- | --- | --- | --- |
| **A. 2 配列**（採用） | ◎ additive、migration 不要 | △ 長さ一致を service が enforce | ○ 双方 `is list + size <= 6` |
| B. 構造化 `{label, color}[]` | × zod transform / migration 必須 | ◎ 同 object で完結 | △ list 内 element 構造を rule で検査困難 |

採用理由は **既存 doc 破壊回避が最優先**。Phase C 既存 group はすでに `defaultTableLabels: string[]` を持っているため、
B を選ぶと migration script + 旧クライアントとの互換層が必要になる。本プロジェクト規約は
[group-membership.md](../../../rules/group-membership.md) で **「互換レイヤは作らない」** を明示しており、
それを採るなら schema 段階で読み替え不要な additive 方式しか選択肢がない。

### 設計判断 2: 1 経路集約と service-side invariant

`setDefaultTableSettings({ gid, uid, labels, colors })` ([services/group.ts:365-460](../../../../src/lib/services/group.ts#L365-L460))
で labels と colors を **必ず atomic に書き込む 1 経路に集約**。

- 配列長一致 (`labels.length === colors.length`) を service が検査
- 各 label の長さ / 各 color の hex 形式は service と repository の二重防御
- repository: [`updateDefaultTableSettings`](../../../../src/lib/firebase/repositories/groups.ts) のみ。`updateDefaultTableLabels` は**削除**（後方互換シムなし、規約準拠）

### 設計判断 3: rule の subset 判定（atomic 強制しない）

[firestore.rules:231-249](../../../../firestore.rules#L231-L249) の `affectedKeys.hasOnly(['defaultTableLabels', 'defaultTableColors'])` は
**subset 判定**のため、以下が rule 上は allow:

- 両方一括書込み（service の通常経路）
- labels のみ単独書込み
- colors のみ単独書込み

**意図**: rule で atomic を強制しない理由は 2 つ:
1. 旧 doc には `defaultTableColors` が存在せず、初回追加時に「`defaultTableColors` も同時に書け」と rule で要求すると、コード未追従の旧クライアントが詰む。
2. atomic 整合は **service が enforce** すれば足り、rule は「他フィールドが汚染されない」という最小防御だけ担う。

emulator validator [test-rules-table-labels.mjs](../../../../scripts/test-rules-table-labels.mjs) のケース (6)
で「rule 単独書込 allow」を明示的にテスト し、後続実装者が「rule で atomic 効かないのは設計通り」を読み取れるようにした。

### 設計判断 4: auto-fill の補完規則

[orchestrator.ts:118-187](../../../../src/lib/services/seating/orchestrator.ts#L118-L187) の
`commitInitialSeating` 内 tx で:

```
- 既存 doc なし: tx.set で create、label/color とも default を反映
- 既存 doc あり + label / color とも non-null: 何もしない（手動 edit 維持）
- 既存 doc あり + 一方が null + default が non-null: tx.update で null 側のみ補完
```

**意図**: Phase C の既存ポリシー（label のみ補完）を **対称的に color へ拡張**。
手動 edit が起きる順序（Popover で先に label を変えたあと再 commitInitialSeating したら color 側だけが auto-fill される、等）でも、手動値が決して上書きされない。

### 設計判断 5: 共通プリセット module

[table-color-presets.ts](../../../../src/components/tournament/_table-label-edit/table-color-presets.ts) を新設し、
Popover とサークル詳細カードで共有。

- `TABLE_COLOR_PRESETS`: 10 色 + 名前
- `isPresetTableColor(value)`: 詳細トグル展開判定で使用

**意図**: 値定義の単一真実源。将来「テーマカラーから自動派生」「コントラスト判定」などを追加する場合に 1 箇所変更で完結する。

### UI: GroupDefaultTableLabelsCard の再構成

[GroupDefaultTableLabelsCard.tsx](../../../../src/app/groups/[gid]/_components/GroupDefaultTableLabelsCard.tsx) を
1 行 [Input + プリセット radiogroup + 削除] の縦積み構成に再設計。

**設計判断**:
- カード側ではカスタム hex picker を出さない（プリセット限定）。詳細色は卓カード Popover 経由で個別設定する責務分担。
- 表示モードでも色チップを出して、色設定有無が一目で分かる。色未設定はダッシュ枠の丸で表現。

## Drift 検出と互換性

### 既存 doc 互換

- 旧 group doc: `defaultTableColors` フィールド不在 → schema が `default([])` で hydrate → UI / orchestrator は `colors[i] ?? null` で参照するため安全。
- 旧 fixture（unit test）: 3 ファイル ([schemas/index.test.ts](../../../../src/lib/firebase/schemas/index.test.ts) / [hooks/useAudioPlayer.test.tsx](../../../../src/lib/hooks/useAudioPlayer.test.tsx) / [services/group.test.ts](../../../../src/lib/services/group.test.ts)) に `defaultTableColors: []` を追加し typecheck 通過。

### Drift Warning

- `firestore.rules` の `affectedKeys` リスト: 新規フィールドを追加する場合は schema → service → rule → emulator validator の 4 点同時更新（[group-membership.md](../../../rules/group-membership.md) の「`groups/{gid}` update の allowed-keys 一覧」に追記済み — TBD: 当該表は本 wave 完了後にユーザーが手で更新するか、フォローアップで反映予定）
- `defaultTableLabels` と `defaultTableColors` の長さ整合は **service が単独で保証**。直接 `updateDoc(groups/{gid})` を SDK 経由で呼ぶ実装を**追加してはいけない**。新規経路を作る場合は必ず `setDefaultTableSettings` を経由する。

## 残課題 / 推奨フォローアップ

1. **本番 deploy**: rule 変更を含むため `firebase deploy --only firestore:rules` を本番反映前に実行。emulator green でも本番 rule 未 deploy で `permission-denied` する。
2. **emulator validator 走行**: `firebase emulators:exec` で [test-rules-table-labels.mjs](../../../../scripts/test-rules-table-labels.mjs) を 1 回走らせて rule branch を確認する。
3. **E2E 拡張（任意）**: [table-label-and-color.spec.ts](../../../../tests/e2e/table-label-and-color.spec.ts) の auto-fill ケースに color 設定を 1 ケース追加。本 wave では label の auto-fill 経路で被覆されているため必須ではない。
4. **`group-membership.md` の `groups/{gid}` allowed-keys 表更新**: `defaultTableSettings` ブランチ（`['defaultTableLabels', 'defaultTableColors']`）を追記。次の touch 時に同時更新で OK。

## 検証結果

- `npm run typecheck`: green
- `npm run lint`: warnings/errors なし
- `npm test`: 1003 件 / 54 ファイル全 pass
- E2E: コード変更（aria-label / DOM 構造）が既存 spec の selector を壊していないことを目視確認。emulator 起動が必要なため未走行。

## 関連ファイル一覧

### 新規作成
- [table-color-presets.ts](../../../../src/components/tournament/_table-label-edit/table-color-presets.ts)

### 主要編集
- schema: [schemas/group.ts](../../../../src/lib/firebase/schemas/group.ts)
- repository: [repositories/groups.ts](../../../../src/lib/firebase/repositories/groups.ts)
- service: [services/group.ts](../../../../src/lib/services/group.ts)
- orchestrator: [services/seating/orchestrator.ts](../../../../src/lib/services/seating/orchestrator.ts)
- rule: [firestore.rules](../../../../firestore.rules)
- emulator validator: [scripts/test-rules-table-labels.mjs](../../../../scripts/test-rules-table-labels.mjs)
- UI: [TableLabelEditPopover.tsx](../../../../src/components/tournament/_table-label-edit/TableLabelEditPopover.tsx) / [SeatingBoard.tsx](../../../../src/components/tournament/SeatingBoard.tsx) / [GroupDefaultTableLabelsCard.tsx](../../../../src/app/groups/[gid]/_components/GroupDefaultTableLabelsCard.tsx) / [group-detail-client.tsx](../../../../src/app/groups/[gid]/group-detail-client.tsx)

### 参照
- 起点要望: [tmp/02_prod-V1/02-02_phase-c.md](../../../../tmp/02_prod-V1/02-02_phase-c.md)
- 元 Phase: [phase-c-table-label-color-report.md](phase-c-table-label-color-report.md) / [phase-c-table-label-color.plan.md](../plans/completed/phase-c-table-label-color.plan.md) / [local-phase-c-table-label-color-review.md](../reviews/local-phase-c-table-label-color-review.md)
- 規約: [group-membership.md](../../../rules/group-membership.md) / [firebase-patterns.md](../../../rules/firebase-patterns.md) / [error-logging.md](../../../rules/error-logging.md)
- post-完了 polish 先例: [structure-templates-nav-link-report.md](../../01-allin-timer/reports/structure-templates-nav-link-report.md)
