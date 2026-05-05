# Phase 4.9: Audio Notifications (Default Sounds)

> [allin-timer.prd.md](../../allin-timer.prd.md) の Phase Details から分離。状態 / 依存関係 / PRP Plan link は主 PRD の Implementation Phases 表が真実源。

- **Goal**: ブラインドレベルが上がるタイミング／優勝者が確定したタイミングで音を鳴らし、運営者が見落とさないようにする。Phase 4.10 のカスタム音源アップロードに先立ち、デフォルト音源 1 種類で MVP として動かす
- **背景**: PRD 当初の MVP scope に音声通知が含まれていなかったが、フィールド投入前の要件確認で「運営者がブラインドアップに気付かない」「会場で優勝確定が伝わりにくい」というペインが残っていることが判明し Must 化（要件漏れの追加）
- **Scope**:
  - **データモデル**: `groups/{gid}.audioSettings` フィールド追加（schema は additive）
    - `{ enabled: boolean (default true), levelUpSoundId: string (default "default:bell"), winnerSoundId: string (default "default:bell"), volume: number (0.0–1.0, default 0.7) }`
    - 既存 group docs は zod default で補完（破壊的 migration なし）
  - **再生主体**: ロールベース。`useCurrentGroup()` の `currentGroupRole` が `"owner" | "organizer"` の端末でのみ再生。`member` および `/live` を見ている参加者では鳴らない
    - `/live` を運営者が会場ディスプレイで全画面投影しているケースでは、運営者ロールで鳴る
  - **検知ポイント**:
    - レベル変更: `useTournamentTimer` 経由の `tournament.currentLevel` 変化を `useEffect` で観測
    - 優勝確定: `resolveWinner(tournament, players)` の戻り値が `null → PlayerDoc` に遷移した瞬間
    - debounce / 重複再生防止（手動 advance や reconnect 時の re-fire を抑止）
  - **autoplay unlock**: `<SoundUnlockBanner>` を `/tournaments/[tid]` および `/tournaments/[tid]/live` で運営者ロール時のみ表示。「サウンドを有効化」ボタンクリックで `AudioContext.resume()`
  - **設定 UI**: `/groups/[gid]/audio-settings`（organizer 以上のみアクセス可）。on/off トグル + 音源プルダウン（Phase 4.9 では `default:bell` 1 択） + 音量スライダー
  - **デフォルト音源**: `public/sounds/level-up.{mp3,ogg}` / `public/sounds/winner.{mp3,ogg}` を bundled。ライセンス安全策として **ffmpeg の純音生成スクリプト**を `scripts/generate-default-sounds.sh` に同梱し、ファイル自体は生成物としてコミット
  - **Firestore Rules**: `groups/{gid}` の update に「`audioSettings` だけを書き換える操作は organizer 以上」の条件を追加（既存 rule を壊さない additive 拡張）
  - **テスト**: レベル切替検知 / `resolveWinner` 遷移検知 / ロールフィルタ / debounce のユニットテスト。実際の Audio 再生はモック
- **Success signal**:
  - Owner / Organizer / Member / 匿名参加者の 4 視点でブラウザ検証: 運営者ロールでは音が鳴る、参加者では鳴らない
  - on/off 設定が group 全運営者に同期される
  - autoplay unlock ボタンを押さないと音が鳴らない（ブラウザ仕様準拠）
  - typecheck / lint / test / build が green
