# Phase 5: Field Test & Polish

> [allin-timer.prd.md](../../allin-timer.prd.md) の Phase Details から分離。状態 / 依存関係 / PRP Plan link は主 PRD の Implementation Phases 表が真実源。

- **Goal**: 実運用に投入し、仮説検証を開始する
- **Scope**:
  - 有志 2-3 人でドライラン（バグ洗い出し）
  - UX 磨き込み（エラー文言、警告タイミング、モバイル表示調整）
  - 賞金計算（単純分配）を余力に応じて追加
  - 初回サークル投入 → 運営者フィードバック収集
  - 即時修正と次回投入準備
- **UX 磨き込み候補（Phase 4.5 から繰越）**:
  - `/groups` 一覧カードの「詳細」ボタンを **「開く」** にリネーム（遷移先の意図を強調、Phase 4.5 レビューで判明した「`/groups` と `/groups/[gid]` の役割が一見して分かりづらい」への対応）
- **機能候補（運営者ヒアリング後に Phase 5.x として実施判断）**:
  - **カスタム音源アップロード（旧 Phase 4.10 から持ち越し）**
    - **背景**: Phase 4.9 のデフォルト音源（`level-up.{mp3,ogg}` / `winner.{mp3,ogg}`）で MVP 要件は満たせるが、サークル独自の音源（自作・選曲）への要望は付加価値として残存
    - **想定 Scope**: Firebase Storage 初期導入、`groups/{gid}/audioAssets/{assetId}` サブコレクション、アップロード UI（1 ファイル ≤1MB / group あたり 3 本 / mp3 or ogg）、organizer 以上が CRUD 可能。詳細は Phase 4.10 セクションを参照
    - **判断時期**: Phase 5 のドライラン後の運営者ヒアリングで、デフォルト音源では不足する具体的なシーンを確認してから着手判断。Firebase Storage の有効化（Spark プランで可否要確認 / Blaze プラン許容可否）も合わせて判断する
  - **マスター機 1 台モード（ネットワーク非依存運用）**
    - **背景 / 想定シナリオ**: サークルが借りるレンタルスペースに Wi-Fi が無く、運営者がスマートフォンのテザリングも避けたいケースで「PC 1 台だけでトーナメントを完走させたい」という要望
    - **目的（解釈 A 限定）**: **マスター機自身の画面でブラインド進行と表示が止まらないこと**で十分。参加者の `/live` をオフライン中も同期する要件は範囲外（Firestore はクラウドブローカ型で両端のオンライン必須のため、原理的に Firestore のみでは満たせない）
    - **現状の素地**:
      - Firestore SDK の `persistentLocalCache` は既に有効（[src/lib/firebase/client.ts](../../../../../src/lib/firebase/client.ts) L86-87）
      - `useTournamentTimer` の `setInterval` はネット切断でも継続動作（[src/lib/hooks/useTournamentTimer.ts](../../../../../src/lib/hooks/useTournamentTimer.ts) L65-96）
      - 不足: 「進行担当を 1 台に固定する」仕組みが未実装。現状は組織者ダッシュボードを開いた全員が `advanceLevel` を試みる構造（[src/app/tournaments/[tid]/dashboard-client.tsx](../../../../../src/app/tournaments/[tid]/dashboard-client.tsx) L64-65）
    - **Phase 5 で運営者に確認したい論点**:
      1. 「マスター機」を tournament 単位で 1 台に固定する UX で十分か（dashboard に「このPCをマスターに設定」ボタン）
      2. オフライン中に蓄積された write を再接続時に flush する挙動を許容するか（複数レベル分の `advanceLevel` 暴発リスク・`serverTimestamp` がオフライン中確定しない問題への対処要否）
      3. オフライン中、参加者の `/live` 表示が固まることを「明示エラー表示」で許容するか、それとも「Wi-Fi 無し会場では `/live` を提供しない」運用ガイドで割り切るか
      4. PC 1 台モードと既存の「複数 organizer 端末で冗長化される」現挙動を共存させるか、片方に倒すか
    - **判断時期**: Phase 5 ドライラン後の運営者ヒアリングで、Wi-Fi 無し会場の発生頻度と回避策（テザリング受容度）を確認してから Phase 5.x として正式着手するか決定
- **Success signal**: サークル 1 回目の投入でトーナメントが完走し、運営者から継続利用の意思表明を得る
