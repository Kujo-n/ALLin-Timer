# ローカルレビュー: Phase 4.11 — Timer Layout & Control Polish

**Reviewed**: 2026-04-25
**Reviewer**: Claude Code (`/code-review` local mode)
**Scope**: 未コミットの全変更（19 ファイル / 新規 7 + 編集 12 + PRD / レポート）
**Decision**: **APPROVE with comments** — CRITICAL / HIGH なし。MEDIUM × 2 / LOW × 2。

## Summary

Phase 4.11 のフォローアップ実装は、PRD・レポートで宣言したスコープ（3 カラムレイアウト、アイコン化された TimerControls、`getRemainingMs` の finished 固定、`useSyncExternalStore` 経由の AudioContext 同期、`levelTransitionUpdates` による pause invariant 修正、`lastLevelChangeKind` 判定）と忠実に対応しており、478 件の単体テスト・typecheck・lint・build がすべて green。schema 変更は additive のみで破壊的影響なし。

ただし以下の点で MEDIUM 級の改善余地がある:

1. [src/lib/audio/audio-context.ts:14-22](../../../src/lib/audio/audio-context.ts#L14-L22) の `notify()` が listener 例外を**ログなしで握りつぶす**。`.claude/rules/error-logging.md` の「最低でも `logger.warn` で記録」に違反。
2. `seating → running` 遷移（`confirmSeating` での currentLevel 0→1）で、`lastLevelChangeKind` が undefined のまま運営者向けに **levelUp 音が初回再生される**。テスト未網羅で、PRD / レポートでも触れられていない。仕様か漏れかを確認すべき。

その他は LOW（DOM 順序のアクセシビリティ、既知 OOS の二重カウント）と informational。

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

#### M1 — `audio-context.ts` の listener 例外を logger なしで握りつぶしている

**Location**: [src/lib/audio/audio-context.ts:14-22](../../../src/lib/audio/audio-context.ts#L14-L22)

```ts
function notify(state: AudioContextState | null): void {
  listeners.forEach((cb) => {
    try {
      cb(state);
    } catch {
      // listener 例外は他の listener に波及させない
    }
  });
}
```

**Issue**: プロジェクト規約 [`.claude/rules/error-logging.md`](../../rules/error-logging.md) は

> `try { ... } catch (e) { /* swallow */ }` — 握りつぶし禁止。最低でも `logger.warn` で記録

と明記している。listener 例外を他の listener に波及させない判断は妥当だが、ログを残さないと React の `useSyncExternalStore` snapshot が壊れた／未実装環境で notify 経路が黙って失敗するケースを発見できなくなる。

**Suggested fix**:

```ts
import { logger } from "@/lib/logger";

function notify(state: AudioContextState | null): void {
  listeners.forEach((cb) => {
    try {
      cb(state);
    } catch (e) {
      logger.warn("audio listener error", { state, error: e instanceof Error ? e.message : e });
    }
  });
}
```

logger の循環 import が問題になる場合は `console.warn` の例外として残しても良いが、その場合は ESLint disable コメントで明示的にドキュメント化すること。

---

#### M2 — `seating → running` 遷移で運営者にブラインドアップ音が誤発火する可能性

**Location**:
- [src/lib/firebase/repositories/tournaments.ts:163-189](../../../src/lib/firebase/repositories/tournaments.ts#L163-L189) (`confirmSeating`)
- [src/lib/hooks/useAudioPlayer.ts:144-162](../../../src/lib/hooks/useAudioPlayer.ts#L144-L162)

**Issue**: `confirmSeating` は `state="running"` + `currentLevel=1` を書き込むが、`lastLevelChangeKind` を**設定しない**（schema コメントどおり「初回 level 設定は変更しない」）。`useAudioPlayer` の levelUp effect は次のように動作する:

```ts
const lv = tournament?.currentLevel ?? null;   // 0 のとき null にならない
if (lv === null) return;
const prev = prevLevelRef.current;
prevLevelRef.current = lv;
if (prev === null) return;                     // 初回 mount は exit
if (prev === lv) return;
const st = tournament?.state;
if (st !== "running" && st !== "paused") return;   // 状態 gate
if (tournament?.lastLevelChangeKind === "manual") return;  // undefined は通過
void play(...);
```

シナリオ:
1. 運営者が dashboard を開く（state="seating" / currentLevel=0）→ effect 1 回目で `prevLevelRef = 0`、prev=null で exit。
2. 「トーナメント開始」ボタンで `confirmSeating` → snapshot が来る（state="running" / currentLevel=1 / `lastLevelChangeKind` undefined）。
3. effect 2 回目で prev=0, lv=1, state="running", `lastLevelChangeKind !== "manual"` → **play が走り、blind-up サウンドが鳴る**。

これは Phase 4.11 で意図された「auto-advance のみ鳴らす」ポリシーから見ると曖昧で、初回 1 回だけ余分な音が鳴る挙動になる。

**Suggested options** (どれを取るかは運営者目線で判断):

- (a) `confirmSeating` で `lastLevelChangeKind: "manual"` を書き込み、開始時の音を抑制する。
- (b) 受け取り側で `prev === 0 && lv === 1` を「初回開始」として早期 return（ただし revert で 1→0 はあり得ないので「prev=0」で十分）。
- (c) 仕様として「開始時にも音を鳴らす」を明文化し、`schema/tournament.ts` のコメントと `useAudioPlayer` の挙動コメントに追記。回帰テストも追加。

いずれにせよ、現状はテスト未網羅・PRD 未記載のため、ユーザー仕様確認を推奨。

### LOW

#### L1 — モバイル時の DOM 順序が QR → Timer → Info で、視覚順序と乖離

**Location**:
- [src/app/tournaments/[tid]/dashboard-client.tsx:271-308](../../../src/app/tournaments/[tid]/dashboard-client.tsx#L271-L308)
- [src/app/tournaments/[tid]/live/live-client.tsx:153-267](../../../src/app/tournaments/[tid]/live/live-client.tsx#L153-L267)

**Issue**: モバイル（lg 未満）では `order-1`（Timer）/ `order-2`（Info）/ `order-3`（QR）で視覚的に並ぶ一方、DOM 上は QR → Timer → Info の順。Tab キー / スクリーンリーダの読み上げは DOM 順なので、参加者が一番気にするタイマー読み上げまで QR セクションを聞き流すことになる。

**Recommendation**: `aria-label="途中参加用 QR"` などで QR を補助情報と分かるようにラベリング、または DOM 順自体を Timer 先頭にして CSS `order` を PC 用に逆転する設計に変えれば、a11y も改善する。Phase 4.11 の主目的ではないので LOW。

---

#### L2 — `getRemainingMs` の paused → finished 二重カウント問題（既知 OOS）

**Location**: [src/lib/services/timer.ts:52-57](../../../src/lib/services/timer.ts#L52-L57)

`finishTournament` が `pausedAccumMs` を確定書込しないため、paused 状態から終了するとその間の pause 期間が「経過時間」として double count され、表示残り時間が実際より少なくなる。レポート「Deviations from Plan / 設計判断」末尾でも明記済み:

> CR 時の M1（pause→finish の `pausedAccumMs` 二重カウント）はスコープ外

ユーザー判断で許容済みのため再発見扱いではないが、Phase 5 のフィールド投入時に発覚した場合の対処方針を `.claude/PRPs/reports/` に紐付けておくと追跡しやすい。

## Validation Results

| Check      | Result | Notes |
| ---------- | ------ | ----- |
| Typecheck  | ✅ Pass | `tsc --noEmit` zero errors |
| Lint       | ✅ Pass | `next lint` no warnings/errors（next lint 自体は v16 で deprecated 予告あり） |
| Tests      | ✅ Pass | 478 / 478（新規 25 件含む） |
| Build      | ✅ Pass | 全 15 ルート生成成功（/tournaments/[tid] 10.7 kB / /tournaments/[tid]/live 3.61 kB） |
| Integration | N/A | dev server / 実機検証は運営者側で実施想定（report の Next Steps と整合） |

## Files Reviewed

### Modified

| File | Notes |
| ---- | ----- |
| [.claude/PRPs/prds/allin-timer.prd.md](../../prds/allin-timer.prd.md) | Phase 4.11 を Implementation Phases / Phase Details / Parallelism Notes に追記。Phase 5 の前提条件に 4.11 を追加。記述は明確。 |
| [src/app/tournaments/[tid]/dashboard-client.tsx](../../../src/app/tournaments/[tid]/dashboard-client.tsx) | 3 カラム grid 化、`SoundUnlockBanner` 撤去、`audio` props を `TimerControls` に渡す経路追加。`audioPlayer.unlocked` が `useSyncExternalStore` 経由で同期。 |
| [src/app/tournaments/[tid]/live/live-client.tsx](../../../src/app/tournaments/[tid]/live/live-client.tsx) | 3 カラム grid 化、`StructureSnapshotCard` / `NextBreakCard` / `PlayersCard` を新設位置に追加。`SoundUnlockBanner` は /live 側で残置（参加者向け説明 banner）。 |
| [src/app/tournaments/[tid]/live/live-client.test.tsx](../../../src/app/tournaments/[tid]/live/live-client.test.tsx) | `getByText("2")` 衝突回避のため `data-testid="my-table"` / `my-seat` ベースに変更。 |
| [src/components/tournament/AverageStackCard.tsx](../../../src/components/tournament/AverageStackCard.tsx) | 人数表示を `PlayersCard` に分離、3 行構成に整理。 |
| [src/components/tournament/AverageStackCard.test.tsx](../../../src/components/tournament/AverageStackCard.test.tsx) | 人数 assertion 削除、`Average Stack` ラベル assertion を追加。 |
| [src/components/tournament/TimerControls.tsx](../../../src/components/tournament/TimerControls.tsx) | running/paused のボタンをアイコン化（`Pause` / `Play` / `SkipBack` / `SkipForward` / `Square`）+ `SoundToggleButton` 統合。`gap-x-10` でタップ間隔確保。 |
| [src/components/tournament/TimerDisplay.tsx](../../../src/components/tournament/TimerDisplay.tsx) | SB/BB/Ante を `text-3xl/4xl` 太字 + sky 系カラー、`data-testid="blinds-display"` 付与。 |
| [src/components/tournament/TimerDisplay.test.tsx](../../../src/components/tournament/TimerDisplay.test.tsx) | DOM 構造変更に追従（testid ベース）。 |
| [src/lib/audio/audio-context.ts](../../../src/lib/audio/audio-context.ts) | `subscribeAudioContextState` / `readAudioContextState` を export、AudioContext singleton の `statechange` を listener へ転送。**M1 該当**。 |
| [src/lib/firebase/repositories/tournaments.ts](../../../src/lib/firebase/repositories/tournaments.ts) | `levelTransitionUpdates(prevState, newLv, kind)` ヘルパで pause 状態維持 + `lastLevelChangeKind` 書込。`advanceLevel(auto/manual)` / `revertLevel` から呼出。 |
| [src/lib/firebase/repositories/tournaments.test.ts](../../../src/lib/firebase/repositories/tournaments.test.ts) | pause 中 advance/revert の invariant 維持 + `lastLevelChangeKind` 書込 assert を追加（6 件）。 |
| [src/lib/firebase/schemas/tournament.ts](../../../src/lib/firebase/schemas/tournament.ts) | `lastLevelChangeKind: z.enum(["auto","manual"]).nullable().optional()` を additive で追加。コメント明確。 |
| [src/lib/hooks/useAudioPlayer.ts](../../../src/lib/hooks/useAudioPlayer.ts) | `useState(unlocked)` を `useSyncExternalStore` に置換。`lastLevelChangeKind === "manual"` 早期 return。**M2 該当**。 |
| [src/lib/hooks/useAudioPlayer.test.tsx](../../../src/lib/hooks/useAudioPlayer.test.tsx) | mock に `subscribeAudioContextState` / `readAudioContextState` 追加。manual / auto 分岐 2 件追加。 |
| [src/lib/services/timer.ts](../../../src/lib/services/timer.ts) | `getRemainingMs` の finished 固定 + `getNextBreakInfo` 新設。**L2 既知 OOS の根因はここの finished case**。 |
| [src/lib/services/timer.test.ts](../../../src/lib/services/timer.test.ts) | finished 固定 2 件 + `getNextBreakInfo` 5 件追加。 |
| [vitest.config.ts](../../../vitest.config.ts) | カバレッジ exclude に `src/lib/audio/audio-context.ts` を追加（jsdom 非対応の妥当な exclusion）。 |

### Added

| File | Notes |
| ---- | ----- |
| [src/components/tournament/StructureSnapshotCard.tsx](../../../src/components/tournament/StructureSnapshotCard.tsx) | dashboard / live 共用。`currentLevel` でハイライト。 |
| [src/components/tournament/StructureSnapshotCard.test.tsx](../../../src/components/tournament/StructureSnapshotCard.test.tsx) | 7 件、currentLevel ハイライト / break 行 colspan 等を網羅。 |
| [src/components/tournament/NextBreakCard.tsx](../../../src/components/tournament/NextBreakCard.tsx) | `mm:ss` / `h:mm:ss` フォーマット切替。`getNextBreakInfo` を呼ぶ。 |
| [src/components/tournament/NextBreakCard.test.tsx](../../../src/components/tournament/NextBreakCard.test.tsx) | 7 件、state filter / break なし / break 中 / mm:ss / h:mm:ss を網羅。 |
| [src/components/tournament/PlayersCard.tsx](../../../src/components/tournament/PlayersCard.tsx) | running / paused のみ表示、空配列 / active=0 の guard あり。 |
| [src/components/tournament/PlayersCard.test.tsx](../../../src/components/tournament/PlayersCard.test.tsx) | 7 件、state filter / 空 / 全バスト / paused 等を網羅。 |
| [src/components/tournament/SoundToggleButton.tsx](../../../src/components/tournament/SoundToggleButton.tsx) | OFF / 要 unlock / ON の 3 状態を色 + アイコン（`VolumeX` / `BellRing` / `Volume2`）で識別。a11y 配慮。 |
| [.claude/PRPs/reports/phase-4.11-timer-layout-control-polish-report.md](../../reports/phase-4.11-timer-layout-control-polish-report.md) | 実装レポート。Tasks / Validation / Issues / Tests / Next Steps が網羅されており品質高い。 |

## Strengths（特に良かった点）

- **`levelTransitionUpdates` ヘルパ抽出**: pause-state invariant 違反バグの本質を「3 箇所（advance manual / advance auto / revert）の重複コード」と特定し、共通化で再発防止策まで仕込めている。回帰テストも 6 件追加で十分。
- **`useSyncExternalStore` 採用**: dashboard ↔ /live の 2 タブ問題を「listener pattern + React 標準 API」で解決した設計は React 18+ のベストプラクティスに沿う。SSR snapshot を `() => null` で明示した点も適切。
- **`lastLevelChangeKind` の `.nullable().optional()` 設計判断**: レポートに記載された「`.default(null)` を諦めて fixture 影響をゼロに留める」判断は合理的。zod の output 型と既存 fixture の整合という地味だが重要なトレードオフを明示できている。
- **テストファイル毎の `makeTournament` ヘルパー**: 構造化されたテストデータで意図が読みやすく、`overrides` パターンは新規 enum 追加時の影響を最小化できている。

## Recommendations / Next Steps

1. **M1（audio-context.ts notify swallow）** を fix（数行追記）。
2. **M2（seating → running の音）** を仕様確認 → option (a) / (b) / (c) のいずれかで決着。テスト 1 件追加。
3. dev server で 3 カラム ↔ 1 カラム切替、unlock 同期、pause 中 advance/revert、手動 vs auto-advance の音差分を実機確認（report の Next Steps と一致）。
4. レポートと PRD は十分に詳細。Phase 5 投入前に L2（pause→finish 二重カウント）の優先度判断を再評価。

---

**Decision**: APPROVE — MEDIUM 2 件は merge ブロッカーではないが、M1 は規約準拠のため次回 push 前に fix を推奨。M2 は仕様確認の上で対応有無を判断。
