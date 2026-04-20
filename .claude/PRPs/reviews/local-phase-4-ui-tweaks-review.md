# Local Review: Phase 4 UI tweaks (E2E フィードバック対応)

**Reviewed**: 2026-04-20
**Branch**: develop (uncommitted)
**Scope**: E2E レビューで挙がった Phase 4 UI 課題 4 件の修正

## Summary

[tmp/07_Phase4_メモ.md](../../../tmp/07_Phase4_メモ.md) の 4 課題を修正。UI 層のみの変更で、ドメインロジック・Firestore スキーマ・セキュリティルールは無変更。CRITICAL / HIGH 相当の指摘なし。validation は typecheck / lint / test 246 件 / next build すべて pass。

## 変更ファイル

| File | Change |
| --- | --- |
| [src/components/tournament/TimerControls.tsx](../../../src/components/tournament/TimerControls.tsx) | Modified — 「席決め待ちに切替」ボタン削除 / 未使用 import & Op union 整理 |
| [src/components/tournament/TimerDisplay.tsx](../../../src/components/tournament/TimerDisplay.tsx) | Modified — setup/seating 中は Lv1 プレビュー（SB/BB/Ante・残り時間・次レベル）表示 |
| [src/app/tournaments/[tid]/dashboard-client.tsx](../../../src/app/tournaments/[tid]/dashboard-client.tsx) | Modified — `showTimer` を常に true に |
| [src/app/tournaments/[tid]/live/live-client.tsx](../../../src/app/tournaments/[tid]/live/live-client.tsx) | Modified — 自席表示を Table / No. の 2 フレーム化 / `playersLoaded` で購読 race を解消 |

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM

#### M1. 新規 UI 挙動に対する自動テスト不足
**場所**: TimerDisplay.tsx / live-client.tsx

- TimerDisplay の setup/seating プレビュー分岐（Lv1 表示・「開始前（プレビュー）」バッジ・`displayRemainingMs` = levels[0].durationSec * 1000）が unit test で carve out されていない。Level schema の `levels.min(1)` 不変条件が崩れた場合（例えば将来、0 件許容の変更が入った場合）に silent に壊れる。
- live-client の `playersLoaded` ゲート（race 解消）も integration-lite なテスト（React Testing Library）が無い。リロード直後に「レイトエントリー締切超過」が一瞬出ないことを検証できていない。

**Suggested fix:** 次のいずれか、あるいは後続 PR で:

1. `TimerDisplay` に snapshot/RTL test を追加:
   - `state: "setup"` + `currentLevel: 0` で `"Lv 1"` ラベル / `levels[0].durationSec` 分の残り時間 / 「開始前（プレビュー）」バッジが出る
   - `state: "running"` + `currentLevel: 2` で既存挙動を維持（回帰テスト）
2. `LiveClient` に RTL test を追加:
   - `subscribePlayers` が一度も fire していない状態で「レイトエントリー締切超過」が **出ない** ことをアサート
   - fire 後に自席ありなら Table/No 枠が表示されることをアサート

### LOW

#### L1. `showTimer = true` はデッド抽象化
**場所**: [dashboard-client.tsx:127](../../../src/app/tournaments/[tid]/dashboard-client.tsx#L127)

```tsx
const showTimer = true;
...
{showTimer ? (
  <TimerDisplay ... />
) : null}
```

今後 `showTimer` を false にする条件が無い以上、変数を介さず `<TimerDisplay />` を直接配置するのが素直。ただしコメントで「setup / seating 中も表示する」という意図が残っていて readability には寄与しており、害はない。

**Suggested fix:** 任意。変数を削除して条件分岐ごと撤去、あるいは現状維持でも可。

#### L2. Table / No. フレームの a11y
**場所**: [live-client.tsx:98-107](../../../src/app/tournaments/[tid]/live/live-client.tsx#L98-L107)

Table 枠と No. 枠はラベルが `div` で視覚的にのみ示されており、DOM 上は `<div>Table</div><div>3</div><div>No.</div><div>5</div>` のような構造。スクリーンリーダーでは「Table 3 No. 5」と順番に読まれるので致命ではないが、以下で明示化すると親切:

```tsx
<dl className="flex gap-3">
  <div className="flex-1 rounded-md border bg-muted/40 px-3 py-2 text-center">
    <dt className="text-xs font-medium text-muted-foreground">Table</dt>
    <dd className="text-3xl font-bold tabular-nums">{me.tableNum}</dd>
  </div>
  ...
</dl>
```

または aria-label で "Table 3 席 No. 5" のような読み上げ文字列を与える。

**Suggested fix:** 任意。`<dl>/<dt>/<dd>` にすれば意味付けが明確になる。

#### L3. `recentlyMoved` の条件における undefined / null 扱い
**場所**: [live-client.tsx:62-67](../../../src/app/tournaments/[tid]/live/live-client.tsx#L62-L67)

```ts
const seatedAt = me?.lastMovedAt ? me.lastMovedAt.toMillis() : null;
const recentlyMoved =
  seatedAt !== null &&
  me?.tableNum !== null &&
  me?.seatNum !== null &&
  now - seatedAt < MOVED_BANNER_MS;
```

`me` が null のとき `me?.tableNum` は `undefined` となり、`undefined !== null` は `true` を返す。`seatedAt !== null` ガードで最終的に false に落ちるため挙動は正しいが、条件式単体だと「me が null でも素通りし得る」見た目になっている。本 PR の変更点ではないが、触ったついでに `me?.tableNum != null` に統一すると安全寄り。

**Suggested fix:** 任意。本 PR のスコープ外として現状維持可。

#### L4. バッジラベル「開始前（プレビュー）」の冗長さ
**場所**: [TimerDisplay.tsx:35](../../../src/components/tournament/TimerDisplay.tsx#L35)

「プレビュー」の言葉が内部実装寄り。参加者視点では「開始前」だけで意味が通じる。既存の「未開始」ラベルとの区別も曖昧なので、両者を統合して「未開始」 or 「開始前」に寄せるのも選択肢。

**Suggested fix:** 任意。UI 文言は別途オーナーに確認推奨。

## Validation Results

| Check      | Result |
| ---------- | ------ |
| Type check (`tsc --noEmit`) | Pass |
| Lint (`next lint`) | Pass |
| Tests (`vitest run`) | Pass (14 files / 246 tests) |
| Build (`next build`) | Pass |

## Decision

**APPROVE with comments** — 4 課題への対応は妥当で、検証もすべて緑。M1（テスト追加）は後続タスクとして残す価値あり。L1〜L4 はいずれも任意対応。

## 補足: 未使用関数 `beginSeating`

[tournaments.ts:beginSeating](../../../src/lib/firebase/repositories/tournaments.ts) の関数本体と [tournaments.test.ts](../../../src/lib/firebase/repositories/tournaments.test.ts) のテストは意図的に残している（将来の手動配席 UI で再利用するため）。現時点では UI からの呼び出し元が存在しないため、長期に渡り手動配席機能が導入されない見込みになった時点で dead code として削除判断するのが良い。
