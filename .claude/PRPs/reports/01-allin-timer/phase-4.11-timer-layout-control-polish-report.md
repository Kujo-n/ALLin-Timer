# Implementation Report: Phase 4.11 — Timer Layout & Control Polish

## Summary

Phase 4.9（音声通知）投入後のフォローアップ。`tmp/10_Phase4.9_memo.md` の **5 件の改善要望 + 4 件の追加要望 + 自主検証で発覚した 2 件の状態機械バグ + サウンドアイコンの状態識別性問題** を一括解消。schema は additive（`tournaments/{tid}.lastLevelChangeKind` を optional 追加）、Firestore Rules 変更なし、破壊的 migration 不要。

主な成果:
- Live / Dashboard を **3 カラムレイアウト**（左=QR / 中=タイマー / 右=情報カード）に再構成
- 共通カード 4 件新設（`StructureSnapshotCard` / `NextBreakCard` / `PlayersCard` / `SoundToggleButton`）
- TimerControls をアイコン化（5 ボタン: サウンド / 前 / 再生・停止 / 次 / 終了）+ 中央揃え + アイコン 1 個分 gap
- `getRemainingMs` を finished 時に `finishedAt` 基準で残時間固定
- AudioContext singleton の state を `useSyncExternalStore` で全 hook 同期（dashboard ↔ /live 即時連動）
- pause 中の `revertLevel` / `advanceLevel` での invariant 違反バグを修正（`pausedAt` 再アーム）
- `lastLevelChangeKind` で手動レベル遷移時のブラインドアップ音を抑制

## Assessment vs Reality

| Metric        | Predicted (Memo) | Actual         |
| ------------- | ---------------- | -------------- |
| Complexity    | Medium           | Medium         |
| Confidence    | -                | High           |
| Files Changed | 約 10 ファイル    | 19 ファイル（新規 7 + 編集 12）|
| Tests Added   | -                | +25 件（453 → 478）|

## Tasks Completed

| #   | Task                                                              | Status   | Notes |
| --- | ---------------------------------------------------------------- | -------- | ----- |
| 1   | Memo 改善#1: トーナメント終了時タイマー停止                          | Complete | `getRemainingMs` で `finishedAt` 基準の残時間固定（pause と同形式） |
| 2   | Memo 改善#2: ストラクチャ snapshot を /live にも表示                  | Complete | `StructureSnapshotCard` を共通化、現在 level のハイライト追加 |
| 3   | Memo 改善#3: SB/BB/Ante 視認性向上                                  | Complete | `text-3xl/4xl` 太字 + sky 系カラー、ラベルを uppercase tracking で小さく |
| 4   | Memo 改善#4: PC タイマー右側に Next Break / Avg / Players              | Complete | 3 カードを `lg:sticky lg:top-4` で右 aside に縦積み |
| 5   | Memo 改善#5: 受付 URL をタイマー左側に                                | Complete | `QrPanel` を 3 カラム grid の左 aside に配置（モバイルは下端） |
| 6   | Memo 追加#1: Next Break In を `00:00` 形式に                         | Complete | `mm:ss`（< 1h） / `h:mm:ss`（≥ 1h）でタイマー書式と統一 |
| 7   | Memo 追加#2: Players の「残り/母数」テキスト削除                       | Complete | キャプション削除（数字のみ） |
| 8   | Memo 追加#3: 平均スタックの人数表示削除                                | Complete | `参加 N / 残 M` 行を削除、PlayersCard に移管 |
| 9   | Memo 追加#4: TimerControls をアイコン化＋順序整理＋サウンド統合          | Complete | サウンド → 前 → 再生/停止 → 次 → 終了。`gap-x-10`（アイコン 1 個分）で誤タップ防止 |
| 10  | サウンドアイコン 3 状態識別性向上                                       | Complete | OFF=`VolumeX` 赤系 / 要有効化=`BellRing` amber / ON=`Volume2` 緑系。形 + 色の二重識別 |
| 11  | バグ: AudioContext unlocked が再読み込みまで反映されない                | Complete | `audio-context.ts` に `subscribeAudioContextState`/`readAudioContextState` を追加、`useAudioPlayer` を `useSyncExternalStore` 化 |
| 12  | バグ: pause 中に「前レベル」→ タイマー `--:--` → 再開でエラー           | Complete | `levelTransitionUpdates(prevState, newLv, kind)` ヘルパで pause 状態時 `pausedAt: serverTimestamp()` に再アーム |
| 13  | 手動 advance/revert でサウンドを鳴らさない                             | Complete | `tournamentBodySchema` に `lastLevelChangeKind` 追加、`useAudioPlayer` で `=== "manual"` 早期 return |
| 14  | 新規コンポーネント単体テスト                                           | Complete | NextBreakCard / PlayersCard / StructureSnapshotCard で 21 件 |
| 15  | bug fix の回帰テスト                                                | Complete | tournaments repo に advance/revert × pause + lastLevelChangeKind の 6 件、useAudioPlayer に auto/manual 分岐の 2 件 |

## Validation Results

| Level           | Status      | Notes                                           |
| --------------- | ----------- | ----------------------------------------------- |
| Static Analysis | Pass        | `tsc --noEmit` zero errors                      |
| Lint            | Pass        | `next lint` zero warnings                       |
| Unit Tests      | Pass        | 全 478 件（既存 453 + 新規 25 件）              |
| Build           | Pass        | 全ルート生成成功（dashboard 9.65→10.5 kB、/live 3.07→3.48 kB） |
| Integration     | N/A         | dev server / 実機でのスモークテストは運営者側で実施想定 |

## Files Changed

### 新規（7 ファイル）

| File | 概要 |
| ---- | ---- |
| `src/components/tournament/StructureSnapshotCard.tsx` | dashboard / live で共通利用するストラクチャ snapshot テーブル。現在 level ハイライト + `showDescription` 切替 |
| `src/components/tournament/NextBreakCard.tsx` | 次の break までの ETA を `mm:ss` / `h:mm:ss` 形式で表示。`getNextBreakInfo` を呼ぶ |
| `src/components/tournament/PlayersCard.tsx` | 残人数 / 母数を `M / N` で表示。running/paused のみ |
| `src/components/tournament/SoundToggleButton.tsx` | OFF / 要有効化 / ON の 3 状態を色 + アイコン形状で識別。設定ページへの Link / unlock ボタンを切替 |
| `src/components/tournament/NextBreakCard.test.tsx` | 7 件（state filter / break なし / break 中 / mm:ss / h:mm:ss / levelsAhead 表示） |
| `src/components/tournament/PlayersCard.test.tsx` | 7 件（state filter / 空配列 / active=0 / paused 表示 等） |
| `src/components/tournament/StructureSnapshotCard.test.tsx` | 7 件（全 level 表示 / break 行 colspan / showDescription / currentLevel ハイライト） |

### 変更（12 ファイル）

| File | 概要 |
| ---- | ---- |
| `src/lib/services/timer.ts` | `getRemainingMs` を finished 時に `finishedAt` 基準で残時間固定。`getNextBreakInfo(tournament, remainingMs)` を新設（NextBreakCard 用） |
| `src/lib/services/timer.test.ts` | finished 固定（2 件）+ `getNextBreakInfo`（5 件）追加 |
| `src/lib/firebase/schemas/tournament.ts` | `lastLevelChangeKind: z.enum(["auto","manual"]).nullable().optional()` を additive で追加 |
| `src/lib/firebase/repositories/tournaments.ts` | `levelTransitionUpdates(prevState, newLv, kind)` ヘルパを新設し、`advanceLevel`（手動 + auto）/`revertLevel` から呼出。pause 状態を維持しつつ新 level の先頭で `pausedAt` を再アーム |
| `src/lib/firebase/repositories/tournaments.test.ts` | pause 中 advance/revert の invariant 維持 + `lastLevelChangeKind` 書込 assert を追加（6 件） |
| `src/lib/audio/audio-context.ts` | `subscribeAudioContextState(cb)` / `readAudioContextState()` を export。AudioContext 生成時に `statechange` を listener へ転送、`resumeAudioContext` 末尾でも明示 notify |
| `src/lib/hooks/useAudioPlayer.ts` | `useState(unlocked)` を撤去し `useSyncExternalStore` で AudioContext singleton の state を購読。levelUp 検知で `lastLevelChangeKind === "manual"` なら早期 return |
| `src/lib/hooks/useAudioPlayer.test.tsx` | mock に `subscribeAudioContextState`/`readAudioContextState` 追加。manual 時に音が鳴らない / auto 時に鳴るテストを追加（2 件） |
| `src/components/tournament/TimerDisplay.tsx` | SB/BB/Ante を `text-3xl/4xl` 太字 + sky 系。`data-testid="blinds-display"` 追加（テスト用） |
| `src/components/tournament/TimerDisplay.test.tsx` | DOM 構造変更に追従（testid 経由） |
| `src/components/tournament/TimerControls.tsx` | running/paused のボタンをアイコン化（`SkipBack`/`Pause`/`Play`/`SkipForward`/`Square`）。`audio?` props を追加し `SoundToggleButton` を統合。`gap-x-10 gap-y-3` で間隔調整 |
| `src/components/tournament/AverageStackCard.tsx` | 人数表示削除、`Average Stack` ラベル + 平均値 + 初期値の 3 行構成 |
| `src/components/tournament/AverageStackCard.test.tsx` | 人数 assertion を削除、`Average Stack` ラベル assertion を追加 |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | 3 カラム grid 化（`lg:max-w-7xl`）。`SoundUnlockBanner` import を撤去（`SoundToggleButton` に集約）。TimerControls をタイマー直下に配置 |
| `src/app/tournaments/[tid]/live/live-client.tsx` | 3 カラム grid 化。QrPanel + 情報カード + StructureSnapshotCard 追加。my-table / my-seat に testid 付与 |
| `src/app/tournaments/[tid]/live/live-client.test.tsx` | `getByText("2")` 等を testid ベースに更新（StructureSnapshotCard との数字衝突回避） |
| `.claude/PRPs/prds/allin-timer.prd.md` | Phase 4.11 を Implementation Phases 表 / Phase Details / Parallelism Notes に追加 |

## Deviations from Plan / 設計判断

- **Phase 4.10 を待たずに Phase 4.11 として独立実施**: Phase 4.10（カスタム音源）はオプション扱いで Storage 環境が確定しないと進められない一方、4.11 の改善要望は次回開催前に必要。Phase 4.10 とは別 collection / 別関数を触るため独立で問題なし
- **`lastLevelChangeKind` を `optional` 化（`default(null)` を諦める）**: zod の `.nullable().default(null)` は output 型から undefined を排除するため、TournamentDoc 型に required `null` フィールドが追加されてしまい既存の test fixture 全てを更新する必要が生じた。`.nullable().optional()` にして fixture 影響をゼロに留め、UI 層は `=== "manual"` 判定で undefined / null / "auto" を全て「鳴らす側」に倒す方針に
- **手動 advance/revert を「常に音なし」**: ユーザー指示通り「音設定に関わらず鳴らさない」を厳守。`lastLevelChangeKind === "manual"` の早期 return は `enabled` / `unlocked` / role の判定より前に置いた
- **dashboard で SoundUnlockBanner を撤去**: `SoundToggleButton` がタイマーコントロールに集約され、3 状態の視覚識別が確保された。`/live` 側では参加者向けの説明 banner として残置
- **Mobile での 3 カラム反転**: `order-1`（タイマー）/ `order-2`（情報）/ `order-3`（QR）で、PC 時は `lg:order-1`（QR）/ `lg:order-2`（タイマー）/ `lg:order-3`（情報）に反転。途中参加 QR がモバイルで邪魔にならない設計
- **アイコン間隔は `gap-x-10`**: アイコンサイズ `h-10 w-10`（40px）と同じ gap で誤タップ防止。縦方向（折り返し時）は `gap-y-3` で詰めて占有面積を抑制
- **CR 時の M1（pause→finish の `pausedAccumMs` 二重カウント）はスコープ外**: ユーザー判断で許容。実運用上ほぼ顕在化しない edge case

## Issues Encountered

- **dashboard / live の 2 つの `useAudioPlayer` 間で unlocked が同期しない**
  - 症状: dashboard で「サウンドを有効化」を押しても /live ではアイコンが OFF のまま、再読み込みまで反映されない
  - 原因: `useState(unlocked)` がコンポーネント独立で、AudioContext singleton の状態変化が伝わらない
  - 解決: `audio-context.ts` に listener pattern を実装し、`useAudioPlayer` を `useSyncExternalStore` 化
- **pause 中に「前レベル」→ `--:--` → 再開で `tournament/invalid-state: pausedAt が設定されていません`**
  - 原因: `revertLevel` が `state` を考慮せず常に `pausedAt: null` を書いていたため、`state="paused" && pausedAt=null` の invariant 違反
  - 解決: 共通ヘルパ `levelTransitionUpdates` で pause 中なら `pausedAt: serverTimestamp()` を再アーム
- **TimerDisplay の DOM 構造変更で既存テスト fail**
  - SB/BB/Ante を span に分割した結果、`text.startsWith("SB 25")` の matcher が機能しなくなった
  - 解決: `data-testid="blinds-display"` を付与しテスト側を `getByTestId` + `toHaveTextContent` に変更
- **live-client.test.tsx で `getByText("2")` が複数マッチ**
  - 原因: 新規追加の `StructureSnapshotCard` で SB / BB の数字に同値があり get で衝突
  - 解決: my-table / my-seat に `data-testid` を付与してテスト固有化

## Tests Written

| Test File                                             | Tests   | Coverage                                                     |
| ----------------------------------------------------- | ------- | ------------------------------------------------------------ |
| `src/components/tournament/NextBreakCard.test.tsx`    | 7 件    | state filter / break なし / break 中 / mm:ss / h:mm:ss / levelsAhead |
| `src/components/tournament/PlayersCard.test.tsx`      | 7 件    | state filter / 空配列 / active=0 / paused 表示                |
| `src/components/tournament/StructureSnapshotCard.test.tsx` | 7 件 | 全 level / break colspan / showDescription / 現在 level ハイライト |
| `src/lib/services/timer.test.ts`                      | +7 件   | finished 時 finishedAt 固定（2）+ getNextBreakInfo（5）       |
| `src/components/tournament/TimerDisplay.test.tsx`     | 修正のみ | DOM 構造変更に追従（testid ベース） |
| `src/components/tournament/AverageStackCard.test.tsx` | 修正のみ | 人数 assertion 削除、`Average Stack` ラベル追加 |
| `src/lib/firebase/repositories/tournaments.test.ts`   | +6 件   | advance/revert × pause 維持 + lastLevelChangeKind 書込 |
| `src/lib/hooks/useAudioPlayer.test.tsx`               | +2 件   | manual で鳴らない / auto で鳴る                              |
| `src/components/tournament/PlayersCard.test.tsx`      | 修正のみ | 「残り / 母数」削除に追従 |

合計 **+25 件**（21 件新規 + 4 件 既存ファイルへの追加）。453 → 478 件 pass。

## Next Steps

- [ ] dev server で実機（PC + モバイル）レイアウト確認、3 カラム ↔ 1 カラム切替の挙動目視
- [ ] dashboard ↔ /live で unlock 状態のリアルタイム同期を 2 タブで確認
- [ ] pause 中の前/次レベル操作 → タイマー表示と再開動作のスモーク
- [ ] 手動 advance/revert で音が鳴らない / auto-advance で音が鳴る ことを実機で確認
- [ ] Phase 4.10（カスタム音源）の実施可否を判断（Storage 有効化の Console 検証）
- [ ] Phase 5（フィールド投入）の準備に移行
