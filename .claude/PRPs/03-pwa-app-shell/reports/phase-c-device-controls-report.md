# Implementation Report: Phase C — Device Controls

## Summary

会場プロジェクタ投影中の体感品質を向上させる 3 種のデバイス制御を導入した:

- **Wake Lock API** — `state="running"` の間だけ画面消灯を防止。`visibilitychange` で再取得、外部 release を sentinel の `release` event で検出。
- **Screen Orientation Lock** — PWA standalone のときだけ `landscape` で固定。ブラウザタブ / iOS Safari は feature detection で no-op。
- **AudioContext unlock 強化** — 「トーナメント開始」「再開」ボタンの onClick 同 user gesture 内で `await resumeAudioContext()` を呼ぶ。

未対応 UA（iOS Safari < 16.4 等）向けに `<DeviceFallbackHints>` で「OS の省電力設定で画面が消えないよう調整してください」とテキスト案内を表示。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual          |
| ------------- | ---------------- | --------------- |
| Complexity    | Medium           | Medium          |
| Confidence    | Medium-High      | High            |
| Files Changed | 7 (new + update) | 8 (5 new + 3 update) |

## Tasks Completed

| #   | Task                                                                            | Status   | Notes                                                                                  |
| --- | ------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| 1   | `useWakeLock` hook 作成                                                         | Complete | sentinel の `release` event 購読、visibilitychange 再取得、effect cleanup で release    |
| 2   | `useWakeLock` unit test（6 件）                                                 | Complete | 未対応 / 取得 / active toggle / 暗黙 release & 再取得 / reject warn / unmount release |
| 3   | `useOrientationLock` hook 作成                                                  | Complete | matchMedia + screen.orientation.lock の 3 重 feature detection                        |
| 4   | `useOrientationLock` unit test（4 件）                                          | Complete | non-standalone / lock 関数なし / 成功 / reject warn                                    |
| 5   | `DeviceFallbackHints` コンポーネント作成                                         | Complete | amber 系 banner、ユーザー向け文言に技術スタック名を出さない                            |
| 6   | `dashboard-client.tsx` に hook 統合                                             | Complete | `useFullscreen()` の直後、`isRunning` を引数に Wake Lock を取得                        |
| 7   | `TimerControlsSeating` の `confirmSeating` onClick で `resumeAudioContext` await | Complete | `void run("confirm-seating", async () => { await resume; await confirmSeating; })`     |
| 8   | `TimerControlsRunningPaused` の `resumeTournament` onClick で同じく await       | Complete | 「再開」ボタンのみに適用（pause/revert/advance/finish には不要）                       |
| 9   | 既存 test の green 確認                                                         | Complete | 1149 件全 pass                                                                         |
| 10  | 全体検証                                                                        | Complete | typecheck / lint / test / build 全 green                                               |

## Validation Results

| Level           | Status | Notes                                                                       |
| --------------- | ------ | --------------------------------------------------------------------------- |
| Static Analysis | Pass   | `tsc --noEmit` 0 errors                                                     |
| Lint            | Pass   | `next lint` 0 warnings / 0 errors                                           |
| Unit Tests      | Pass   | 1149 件全 pass（新規 10 件含む）                                            |
| Build           | Pass   | `next build` Compiled successfully、SSR build error なし                    |
| Edge Cases      | Pass   | SSR / Wake Lock 未対応 / 暗黙 release / visibility 復帰 / unmount race 全て test 化 |

## Files Changed

| File                                                                          | Action  | Lines  |
| ----------------------------------------------------------------------------- | ------- | ------ |
| `src/lib/hooks/useWakeLock.ts`                                                | CREATE  | +120   |
| `src/lib/hooks/useWakeLock.test.tsx`                                          | CREATE  | +186   |
| `src/lib/hooks/useOrientationLock.ts`                                         | CREATE  | +69    |
| `src/lib/hooks/useOrientationLock.test.tsx`                                   | CREATE  | +96    |
| `src/components/tournament/DeviceFallbackHints.tsx`                           | CREATE  | +28    |
| `src/app/tournaments/[tid]/dashboard-client.tsx`                              | UPDATE  | +16    |
| `src/components/tournament/_timer-controls/TimerControlsRunningPaused.tsx`    | UPDATE  | +13/-1 |
| `src/components/tournament/_timer-controls/TimerControlsSeating.tsx`          | UPDATE  | +10/-1 |

## Deviations from Plan

| What                                                                  | Why                                                                                                                                                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `useOrientationLock` 内で `lockFn.call(orientation, target)` を使用    | TS の型ナローイングが async IIFE 内に carry されないため、ローカル const に lock 関数を取り出して呼ぶ形に変更。動作は同等だが TS 2722 を解消                                                                  |
| `useWakeLock` の `releaseSentinel` で `setHeld(false)` の `cancelled` ガードを撤去 | `active=true → false` rerender 時、cleanup が `cancelled=true` をセットしてから `releaseSentinel` を呼ぶため、ガード付きだと held 状態が更新されない。React 18+ では unmount 後 setState は silent no-op なので安全 |

## Issues Encountered

1. **TS2722: orientation.lock 型 narrowing 喪失** — async IIFE 内で optional プロパティの narrowing が失われる。ローカル const に取り出して `lockFn.call` で解消。
2. **`active=true → false` 切替時に held=false にならない初期 bug** — characterization test (test 3) で検出。`cancelled` ガードを `setHeld(false)` から外して修正。

両方とも characterization test ファースト（テスト先行投入）の効果で実装段階で発見できた。

## Tests Written

| Test File                                       | Tests | Coverage                                                                            |
| ----------------------------------------------- | ----- | ----------------------------------------------------------------------------------- |
| `src/lib/hooks/useWakeLock.test.tsx`            | 6     | API 未対応 / acquire / active toggle / 暗黙 release & 再取得 / reject warn / unmount |
| `src/lib/hooks/useOrientationLock.test.tsx`     | 4     | non-standalone / lock 関数なし / 成功 / reject warn                                |

## Parallel Execution Notes

Phase A（PWA Foundation）と並列で実行された:

- Phase A 編集ファイル: `manifest.ts` / `next.config.ts` / `layout.tsx` / `public/sw.js` / `public/icons/*` / `src/components/pwa/*` / `README.md`
- Phase C 編集ファイル: `src/lib/hooks/useWakeLock*.ts` / `src/lib/hooks/useOrientationLock*.ts` / `src/components/tournament/DeviceFallbackHints.tsx` / `dashboard-client.tsx` / TimerControls 配下 2 件

ファイル重複なく、最終全体テスト（1149 件）も両 Phase の成果物を含めて green。Phase A の `IOsInstallHint.test.tsx` も併せて pass している。

## Next Steps

- [ ] Code review via `/code-review`
- [ ] PRD の「Open Question 5: iOS Safari Wake Lock 対応状況」を実機 DevTools で確定
- [ ] PWA standalone での `landscape` 固定動作確認（Phase A 完了状態でデバイス検証）
- [ ] Create PR via `/prp-pr`
