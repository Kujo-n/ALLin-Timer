# Phase 4.10: Audio Notifications (Custom Upload) [Deferred to Post-Phase 5]

> [allin-timer.prd.md](../../allin-timer.prd.md) の Phase Details から分離。状態 / 依存関係 / PRP Plan link は主 PRD の Implementation Phases 表が真実源。

- **位置付け**: **Phase 5 以降の改善候補に持ち越し**。Phase 4.9 のデフォルト音源で MVP 要件は満たせており、カスタム音源は付加価値であるため Phase 5 のドライラン前に実装しない。Phase 5 のフィールドテストで運営者ヒアリングを行い、カスタム音源の実需要が確認できた場合のみ Phase 5.x として着手判断する。Storage 未設定環境では引き続き Phase 4.9 のデフォルト音源で運用継続可能
- **Goal**: サークルが独自の音源（自作・選曲）をアップロードして level-up / winner 通知に使えるようにする。Phase 4.9 の MVP からの自然拡張
- **背景**: Phase 4.9 は実装シンプル化のためデフォルト音源 1 種固定。フィールドテスト前に「サークルらしさを出したい」「優勝の歓声音を別のものにしたい」要望に応えるためカスタム音源を追加
- **オプション化の理由**:
  - 2024-10 以降、Firebase の新規プロジェクトでは Cloud Storage 利用に Blaze プラン（従量課金 + クレジットカード登録）が必須化。MIT 公開リポジトリとしてフォークユーザーの導入ハードルを上げないため、Storage 必須化を避ける
  - Phase 4.9 のデフォルト音源で「ブラインドアップ見落とし」「優勝確定の伝達」のコアペインは解消済み。カスタム音源は付加価値であり MVP の必須要件ではない
  - 本家サークル（運営者の所属サークル）で Storage を有効化できる場合のみ実装する想定。Spark プランのまま Storage 有効化が可能か Console で要判定
- **フォークユーザー向け運用**:
  - Phase 4.10 を実装しない場合、`audioSettings.{levelUp,winner}SoundId` は `"default:bell"` 固定運用
  - `/groups/[gid]/audio-settings` の音源プルダウンは Phase 4.9 と同じく `default:bell` 1 択のまま
  - Storage SDK / Storage Rules / `audioAssets` サブコレクションは未追加
  - README で「Phase 4.10 はオプション機能」「Storage 未設定でも Phase 4.9 まで運用可能」を明記
- **Scope**（実装する場合）:
  - **Firebase Storage 初期導入**:
    - プロジェクトレベルで Storage を有効化（既存 env `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` を活用）
    - SDK インポート (`firebase/storage`) を `src/lib/firebase/client.ts` の singleton に追加
    - `storage.rules` 新規作成、deny-by-default から開始
  - **データモデル**: `groups/{gid}/audioAssets/{assetId}` サブコレクション新設
    - `{ name: string, storagePath: string, contentType: "audio/mpeg" | "audio/ogg", sizeBytes: number, createdAt: Timestamp, createdByUid: string, createdByDisplayName: string }`
    - Phase 4.9 の `audioSettings.{levelUp,winner}SoundId` を `"default:bell"` または `"custom:<assetId>"` に拡張
  - **アップロード UI**: `/groups/[gid]/audio-settings` に「音源を追加」ボタン。ファイル選択 → クライアント側で MIME / サイズ検証 → Storage に upload → Firestore に `audioAssets` doc 作成
  - **制約**:
    - 1 ファイル最大 1MB（クライアント + Storage Rules で二重チェック）
    - group あたり最大 3 本（client + Firestore Rules で `getAfter()` カウント）
    - mp3 (`audio/mpeg`) または ogg (`audio/ogg`) のみ
  - **権限**: organizer 以上のみ create / delete 可能。**作成者本人でなくても organizer なら他者の音源を削除可**（要件 Q5 準拠）
  - **Storage Rules**: `groups/{gid}/audioAssets/{assetId}` の path に対し、`isOrganizer(gid)` + サイズ / MIME 検証
  - **設定 UI 拡張**: 音源プルダウンに `default:bell` + group 内のカスタム音源リストを表示
  - **既存音源削除時の参照整合**: 削除しようとした音源が `audioSettings.{levelUp,winner}SoundId` に使われている場合は `default:bell` にフォールバック（service 層で atomic に処理）
  - **テスト**: アップロード validation / 上限本数 / 権限 / 参照整合のユニット + 統合テスト
- **Success signal**:
  - 1MB 超や非 mp3/ogg のアップロードが client / Storage Rules 双方で拒否される
  - group 内 3 本上限で 4 本目アップロードが拒否される
  - organizer が他人の音源を削除可能、member は不可
  - 使用中の音源を削除すると `audioSettings` が default にフォールバック
  - typecheck / lint / test / build が green
