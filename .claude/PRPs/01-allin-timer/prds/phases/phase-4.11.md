# Phase 4.11: Timer Layout & Control Polish

> [allin-timer.prd.md](../../allin-timer.prd.md) の Phase Details から分離。状態 / 依存関係 / PRP Plan link は主 PRD の Implementation Phases 表が真実源。

- **Goal**: Phase 4.9 のフィールド投入準備中に上がった「タイマー画面の見やすさ」「終了時の挙動」「サウンド UX」「pause 中レベル遷移バグ」を一括解消し、運営者が会場ディスプレイ投影でも片手スマホ操作でも違和感なく扱える状態に仕上げる
- **背景**: Phase 4.9 のサウンド通知投入後に運営者から `tmp/10_Phase4.9_memo.md` で 5 件 + 追加 4 件のフィードバック・自主検証で発覚した 2 件のバグが発生。schema additive な範囲で UX を整理しつつ、pause/finish/手動 advance 周りの状態機械バグも合わせて潰す
- **Scope**:
  - **Live / Dashboard レイアウト 3 カラム化**（lg+）
    - 左: `QrPanel`（途中参加用 QR、`lg:sticky lg:top-4` で常時可視）
    - 中: `TimerDisplay` + `WinnerBanner` + 自分の席 + Structure（live のみ）
    - 右: `NextBreakCard` / `AverageStackCard` / `PlayersCard`（`lg:sticky`）
    - モバイル（lg 未満）はタイマー → 情報 → QR → その他の順で 1 カラム積み上げ
  - **新規共通カード**:
    - `StructureSnapshotCard`: dashboard と /live 双方で利用、現在 level をハイライト
    - `NextBreakCard`: 次 break までの ETA を `mm:ss` / `h:mm:ss` 形式で表示（タイマーと書式統一）
    - `PlayersCard`: 残人数 / 母数を `M / N` で表示
    - `SoundToggleButton`: 3 状態識別（OFF=`VolumeX` 赤系 / 要有効化=`BellRing` amber / ON=`Volume2` 緑系）
  - **TimerDisplay の SB/BB/Ante**: `text-3xl/4xl` 太字 + sky 系カラー、ラベルを uppercase tracking で小さく
  - **TimerControls 再構成**: running/paused のボタンを **サウンド → 前レベル → 再生/一時停止 → 次レベル → 終了** の順にアイコン化（`SkipBack`/`Pause`/`Play`/`SkipForward`/`Square`）。`gap-x-10`（アイコン 1 個分）で誤タップ防止。dashboard ではタイマー直下に中央揃えで配置
  - **AverageStackCard 整理**: 人数表示は `PlayersCard` に移管し、平均値と初期値のみ表示
  - **タイマー停止仕様**: `getRemainingMs` を `state === "finished"` のとき `finishedAt` 基準で残時間固定（pause と同様の挙動）。終了時に `00:00` ではなく終了時点の残時間で表示が止まる
  - **AudioContext 共有 unlocked**: `useAudioPlayer` の `unlocked` を `useState` から `useSyncExternalStore` に移行。`audio-context.ts` に `subscribeAudioContextState` / `readAudioContextState` を追加し、AudioContext singleton の `statechange` を全 hook に通知。dashboard と /live の両方で unlock 状態が即時同期される（再読み込み不要）
  - **pause 中レベル遷移 invariant 修正**: `revertLevel` / `advanceLevel`（手動 + auto）が pause 状態のときに `pausedAt: null` を書き込み、`state="paused" && pausedAt=null` の不変条件違反 → 再開時 `tournament/invalid-state` エラーを誘発していた。`levelTransitionUpdates(prevState, newCurrentLevel, kind)` ヘルパに集約し、pause 中なら `pausedAt: serverTimestamp()` で新 level の先頭で再アーム
  - **手動 advance/revert はサウンド非再生**: `tournamentBodySchema` に `lastLevelChangeKind: "auto" | "manual" | null | undefined` を additive で追加（既存 doc は missing field を許容）。advance(auto)→`"auto"`、advance(manual)/revert→`"manual"` を記録。`useAudioPlayer` の levelUp 検知で `lastLevelChangeKind === "manual"` なら早期 return → 運営者の意図的なレベル送り戻しでブラインドアップ音が誤発火しない
  - **テスト追加**: 新規 3 カードの単体テスト（21 件）+ getRemainingMs finished 系（2 件）+ NextBreakInfo（5 件）+ pause 中 advance/revert invariant + lastLevelChangeKind 検証（6 件）+ useAudioPlayer の auto/manual 分岐（2 件）。453 → 478 件に増加
- **Success signal**:
  - 運営者が pause 中に「前/次レベル」を押しても再開時にエラーが出ない
  - dashboard で unlock したサウンドが /live 側でも再読み込みなしで反映される
  - 手動レベル送り戻しで音が鳴らず、auto-advance のみブラインドアップ音が鳴る
  - 終了時、タイマーが `00:00` ではなく終了時点の残時間で停止する
  - PC / モバイル両幅でレイアウトが崩れず、`SoundToggleButton` の 3 状態が色 + アイコンの両方で識別可能
  - typecheck / lint / test / build が green
