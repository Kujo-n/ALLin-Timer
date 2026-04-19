# ALLin-PokerTimer

ノーリミットテキサスホールデム（NLH）の小規模サークル向けトーナメント進行支援 Web アプリケーション。

## Problem Statement

ポーカー初心者中心のサークルでは、運営者自身もプレイヤーを兼任しており、**トーナメントディレクター（TDA）ルールを熟知した有識者が常駐しない**。結果として、テーブルバランス調整や席決めで進行が滞り、ブラインドレベルの変化に気付くのが遅れ、トーナメントの公平性・進行速度・参加者体験の全てが損なわれている。既存の物理 PC タイマーは視認性が悪く、進行補助機能を持つ商用ツール（Poker Club 等）は店舗向けで無料サークルには過剰・高コスト。

## Evidence

- 運営者の実体験: 「プレイングディーラーがブラインドレベルの変更に気付かないことがある（画面が見える位置になくて気づくのに遅れる）」
- 運営者の実体験: 「テーブルのリバランスで移動する人を決める際に移動ルールの確認が発生し、トーナメント進行が滞る」
- 運営者のプロフィール: ポーカー歴 5 年・運営歴 1 年。「無料の個人サークルであることからトーナメントルールの細部までを記憶しておらず、都度確認していた」
- 既存ツール [Poker Blind Timer](https://www.pokerblindtimer.com/) 使用歴あり、「単一画面では機能に不満は無い」。つまり**痛みの本質は「単一画面」という形態自体**にある
- 市場調査: 日本語で同要件を満たす [Poker Club](https://pokerfans.jp/poker-club?_lang=ja_JP) は存在するが「**ポーカー店舗運営向け**」であり、無料サークルの予算・環境（PC + スマホのみ、AppleTV/FireTV なし）と合致しない

## Proposed Solution

**Next.js + Firebase（Firestore + Authentication）** による Web アプリケーションとして実装する。

- 運営 PC のタイマー画面と、参加者個人のスマートフォンで**同一のトーナメント状態を Firestore `onSnapshot` リスナーで同期**して表示
- バスト申告・席決め・テーブルバランス指示を**アプリ側が TDA ルールに準拠して自動算出**し、運営者はアプリの指示に従うだけでよい
- 受付は URL/QR 経由で **3 択フロー（ログイン／ゲスト／アカウント登録）** から選択して完了
- 初回の席割り当ては運営者操作で確定させ、**進行中の新規参加は登録完了と同時に TDA ルールに基づき自動配席**
- 完全無料運用可能なスタック（Vercel Hobby + Firebase Spark）を採用。**Firebase は休眠なし**のためサークルの月 1〜2 回開催に追加対策不要で対応可
- **MIT ライセンス**で GitHub 公開。サークル固有情報は Firestore にのみ保存しリポジトリには含めない

この方針を選ぶ理由: 既存ツールは「熟練オペレーターを効率化する」設計だが、本アプリは「**熟練者不在でも規則通りに回る**」を核心に据える点で差別化される。

## Key Hypothesis

**初心者サークルの兼任運営者**は、**アプリが席移動・進行を自動指示する仕組み**があれば、**有識者不在でも規則通りのトーナメント進行**ができる。
**サークルで 3 回連続使用されれば**仮説は正しいと判定する。

## What We're NOT Building

- **リバイ／アドオン管理** — v1 ではコア機能の安定を優先。実地フィードバック後に v1.1 以降で検討
- **ハンド・フォー・ハンド機能** — バブル管理が必要な規模（50人超）は Non-User
- **リーダーボード・シーズンランキング蓄積** — 複数セッション横断のデータモデルは別スコープ
- **ICM 等の複雑な賞金計算** — 単純分配すら v1 は含めない（Could 扱い、時間があれば）
- **7 テーブル以上の大規模トーナメント対応** — TDA のバランシング許容差が変わる（1→2）ため別ロジック。MVP は「**6 テーブル以下前提**」
- **カジノ／アミューズメント店舗向け機能** — 有料競合と市場が異なる
- **オンライン対戦・キャッシュゲーム** — 対面進行補助が本アプリの価値

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| 使用継続（主要指標） | サークルで 3 回連続使用 | 運営者による利用記録 |
| ブラインド確認クエリの消失 | 「今のブラインドは？」と参加者が運営者に聞く回数がセッションあたり 0 回 | 運営者の主観観察 |
| 席移動ルール確認による遅延 | テーブルバランス発生時、運営者が「誰を移動？」を判断する時間が 5 秒以内 | 運営者の主観観察 |
| タイマー視認性 | 全テーブルの全参加者が任意のタイミングで現在のブラインドを確認できる | 参加者アンケート（Yes/No） |

## Open Questions

- [ ] 初回実地テストでの計測方法（ログ取得 vs 運営者ヒアリング）

### Resolved Questions

- ~~Supabase 無料枠の休眠問題~~ → **スタックを Firebase に変更して根本回避**
- ~~メール登録参加者の QR/URL 受付フロー~~ → **3択フロー（ログイン／ゲスト／アカウント登録）で確定**（Solution Detail / User Flow に反映）
- ~~広告による運用費カバー~~ → **MVP 達成後の次期機能追加で対応**（v1.1 以降）
- ~~BB 次の人選定の同着処理~~ → **席番号昇順**で決定
- ~~GitHub 公開時のライセンス／固有情報分離~~ → **MIT ライセンス**、サークル固有情報は DB にのみ保存しリポジトリに含めない

---

## Users & Context

**Primary User: 運営経験の浅い兼任プレイヤー運営者**

- **Who**: ポーカー歴 5 年前後・運営歴 1 年前後のサークル運営メンバー（典型サークルに 3 人）。プレイヤーを兼任する
- **Current behavior**: PC 画面に Poker Blind Timer を表示、紙と個人の記憶でテーブルバランスと席移動を管理
- **Trigger**: トーナメント開始前の設定／開始操作／バスト申告時（受付は参加者側で完結したい）
- **Success state**: 自分がハンド中でも、アプリに指示を出すだけでトーナメントがルール通りに進行し、ブラインド確認の質問も席移動の議論も発生しない

**Secondary User: サークル参加者**

- **Who**: 20 人前後のサークルメンバー（全員スマホ保持前提）。初心者が多い
- **Current behavior**: PC 画面を覗き込んでブラインドを確認、席移動は運営の口頭指示を待つ
- **Trigger**: 受付時（URL/QR 読み取り）、ブラインド確認したいとき、席移動指示を受け取るとき
- **Success state**: 自分のスマホで常にブラインドと自席を確認でき、運営者の口頭説明に依存しない

**Job to Be Done**

- **Case 1（バランシング中）**: 兼任プレイヤーとして自分のハンド中にテーブルバランス調整が必要になったとき、誰を移動させるか即座に知りたい。そうすれば自分のハンドを中断せずルール通りに進行できる
- **Case 2（ブラインド確認）**: 複数テーブル進行時に PC 画面が見えない席にいるとき、ブラインドレベルの変化に即座に気付きたい。そうすれば誰がどこにいてもブラインドを確認でき、レートが全テーブルで統一される

**Non-Users**

- カジノ・アミューズメント店舗の運営者（商用・有料 UI 競合と市場が異なる）
- オンラインポーカー参加者（対面進行補助が価値）
- 50 人超・複数日・複雑な賞金構造の大規模トーナメント（バランシングロジックが別）
- キャッシュゲーム運営者（トーナメント進行機能が無関係）

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | タイマー＋全端末リアルタイム同期 | 核心課題の半分。これ無くしてアプリの存在意義なし |
| Must | バストボタン（運営者が申告） | 席数・残存人数の管理起点 |
| Must | テーブルバランス自動指示（TDA 準拠・6 テーブル以下） | 核心差別化。有識者代替の中枢 |
| Must | 初回席決め（ランダムシード） | TDA 準拠。議論の発生を防ぐ |
| Must | 参加者 URL/QR 受付（3 択フロー：ログイン／ゲスト／アカウント登録） | 受付工数削減・初参加とリピーター双方をカバー |
| Must | 参加者スマホでタイマー閲覧 | Case 2 の直接解決 |
| Must | ストラクチャ編集 UI（ブラインド構造・初期スタック・レイトエントリー締切） | サークル固有ルール対応の最小単位 |
| Must | 運営者スマホからの全操作 | 運営者 3 人中誰でも即応できる |
| Must | **サークル（Group）単位での共有**（複数運営者で structures / tournaments を共有） | 運営者 3 人前提。個人所有モデルでは実運用にならない（Phase 2.5 で追加） |
| Must | 接続切断時の UI 表示（最終時刻＋「接続切れ」） | 混乱を防ぐ最低ライン |
| Must | 初回席決めは運営者トリガー、進行中レイトエントリーは自動配席 | 参加登録順の偏り防止と、運営者負担最小化の両立 |
| Should | 賞金計算（単純分配） | AI 支援で低コスト実装可能 |
| Could | リバイ／アドオン管理 | 実地フィードバック後に判断 |
| Won't (v1) | ハンド・フォー・ハンド | 50 人超 Non-User のため |
| Won't (v1) | リーダーボード・シーズンランキング | データモデル影響大・別スコープ |
| Won't (v1) | ブレイク中広告 | 収益化は v1 検証後 |
| Won't (v1) | 7 テーブル以上対応 | バランシングロジックが別 |

### MVP Scope

上記 **Must 項目のみ** で v1 をリリースする。Should（賞金計算）は工数に余裕があれば同梱、無ければ v1.1 送り。

### User Flow（クリティカルパス）

**運営者**:
1. ブラウザでアプリを開く → ログイン
2. トーナメント作成（ストラクチャ選択 or 新規作成）
3. 受付 URL/QR を参加者に共有
4. 参加者の登録が揃ったら運営者が「席を決定」操作 → アプリが初回席をランダムに割り振る（**参加登録順による偏りを防ぐため初回のみ運営者トリガー**）
5. 「トーナメント開始」 → タイマー起動
6. バスト発生時: バストボタン → 必要ならアプリが「◯番さんを△卓へ」と指示 → 運営者が口頭伝達
7. **トーナメント進行中に新規参加者が登録した場合、TDA ルールに基づき登録完了と同時に自動で席が割り当てられる**（レイトエントリー締切レベル内であれば）
8. トーナメント終了

**参加者（共通フロー）**:
1. QR 読み取り or URL 開く
2. 以下 3 択のいずれかを選択:
   - **ログイン**: 既存アカウントでログイン → 保存済み情報で参加完了
   - **ゲスト参加**: 表示名のみ入力 → 参加完了
   - **アカウント登録**: メール等で新規登録 → そのまま参加完了（次回以降リピーター扱い）
3. 参加者画面に自席（決定後）・現在のブラインド・残り時間が表示される
4. 席移動指示はスマホ画面に通知／表示される

---

## Technical Approach

**Feasibility**: HIGH（全コンポーネントが枯れたパス、公式スターター有）

**Stack 構成**

| 層 | 採用技術 | 採用理由 |
|---|---|---|
| フロントエンド | Next.js 15（App Router） | Vercel との親和性・SSR/CSR 両対応・学習資料豊富 |
| UI | Tailwind CSS + shadcn/ui | AI 支援での実装速度最大化 |
| DB | **Firebase Firestore** | **休眠なし**（従量制・Google インフラ常時稼働）・Realtime リスナー標準・無料枠（1GB / 50K読/20K書 per day）はサークル規模で十分 |
| リアルタイム同期 | Firestore `onSnapshot` リスナー | DB 変更を全クライアントに自動伝播・追加インフラ不要 |
| 認証 | **Firebase Authentication** | メール認証・匿名認証・Google ログイン対応。参加者の 3 択フロー（ログイン／ゲスト／アカウント登録）を公式 SDK で実装可 |
| デプロイ | Vercel Hobby | 完全無料・GitHub 連携・運用ゼロ |
| QR 生成 | クライアント JS ライブラリ（qrcode.js 等） | 運用負荷ゼロ |
| ライセンス | MIT | GitHub 公開前提。サークル固有情報は Firestore に保存、リポジトリには含めない（`.env.local` で分離） |

**主要データモデル（Firestore ドキュメント設計・暫定）**

- `users/{uid}`: displayName, email, createdAt（アカウント登録済みリピーター用）
- `tournaments/{tid}`: name, structureSnapshot, state（setup/seating/running/paused/finished）, startedAt, currentLevel, lateEntryDeadlineLevel
- `tournaments/{tid}/players/{pid}`: displayName, uid(nullable, ゲスト時は null), entryAt, isBusted, bustedAt
- `tournaments/{tid}/tables/{table_number}`: isBroken
- `tournaments/{tid}/tables/{table_number}/seats/{seat_number}`: playerId(nullable)
- `tournaments/{tid}/events/{eid}`: type（bust/move/level_up/late_entry 等）, payload, occurredAt
- `structures/{sid}`: name, initialStack, lateEntryDeadlineLevel, levels（配列: [{level, sb, bb, ante, durationSec}]）
- セキュリティルール: トーナメント所有者（運営者 uid）のみ書込可、参加者は対象トーナメントのみ読取可

**技術的決定**

- タイマーの時刻同期: サーバ（Firestore）に絶対開始時刻とレベル遷移スケジュールを保存、クライアントは `serverTimestamp` との差分計算で表示。Firebase Cloud Function で定期再計算しドリフト補正
- バランシングロジック: サーバサイド（Firebase Cloud Functions）で実行 → Firestore 更新 → `onSnapshot` で全員に自動伝播
- 参加者の 3 択認証: Firebase Auth の Anonymous Sign-in（ゲスト）／ Email Link（アカウント登録）／通常ログインを切替
- 初回席決定と進行中席決定の分離: ステート機械（`state` フィールド）で `seating` と `running` を分離し、ロジック分岐を明示

### Technical Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| 1 ヶ月 × 1 人でのスコープ超過 | H | MVP から Should（賞金計算）すら切れる構えで着手。毎週スコープ見直し |
| テーブルバランシング実装の複雑性（エッジケース: 最終卓集約、BB 優先同着 → 席番号昇順、テーブル閉鎖判定、進行中レイトエントリー自動配席） | H | TDA 公式ルールを仕様書レベルで書き起こしてから実装。ユニットテスト必須 |
| Firestore 日次読書上限（50K/20K）超過 | L | 20 人 × 月 1-2 回規模では到達しない見込み。リスナー乱立を避け、トーナメント単位で購読を絞る |
| リアルタイム同期のネット断耐性 | M | Firestore SDK のオフライン永続化機能を活用 + 接続切断検知 UI（最終時刻＋「接続切れ」表示） |
| 実地テストのフィードバック周期（月 1-2 回開催） | M | 初回投入前にサークル外の有志 2-3 人でドライランを実施 |
| 生成 AI による実装で仕様理解が甘くなる | M | 特にバランシングロジックは AI 出力を鵜呑みにせず、自分で TDA ルールを読み込んで検証 |
| GitHub 公開時の秘密情報漏洩 | M | `.env.local` で Firebase 認証情報を管理、`.gitignore` 徹底。サークル固有データは Firestore にのみ保存 |
| 招待コード `usesCount` の悪意ある第三者による空消費（DoS） | L（現行） / M（`maxUses` UI 追加時） | Phase 2.5 の rule は `usesCount + 1` 更新を全認証ユーザーに許可しており、コードが流出すると加入意図のない第三者が `maxUses` まで空消費して無効化できる。**現行は default `maxUses: null`（無制限）のため顕在化しない**。Phase 3+ で `maxUses` を運営者 UI から設定可能にする際は、`usesCount` 更新と `groups/{gid}.memberUids` への自分追加を atomic に検証する仕組みが必須（Cloud Functions 化が現実解）。詳細は [.claude/rules/group-membership.md](../../rules/group-membership.md) |

---

## Implementation Phases

<!--
  STATUS: pending | in-progress | complete
  PARALLEL: phases that can run concurrently (e.g., "with 3" or "-")
  DEPENDS: phases that must complete first (e.g., "1, 2" or "-")
  PRP: link to generated plan file once created
-->

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
|---|-------|-------------|--------|----------|---------|----------|
| 1 | Foundation | Next.js + Firebase + Vercel 初期構築、認証（3択対応）、Firestore データモデル定義、MIT ライセンス、セキュリティルール | complete | - | - | [completed/phase-1-foundation.plan.md](../plans/completed/phase-1-foundation.plan.md) — 実装レポート: [phase-1-foundation-report.md](../reports/phase-1-foundation-report.md) |
| 2 | Tournament Setup & Receipt | ストラクチャ編集 UI、トーナメント CRUD、参加者受付（URL/QR・3択フロー：ログイン／ゲスト／アカウント登録） | complete | - | 1 | [completed/phase-2-tournament-setup-receipt.plan.md](../plans/completed/phase-2-tournament-setup-receipt.plan.md) — 実装レポート: [phase-2-tournament-setup-receipt-report.md](../reports/phase-2-tournament-setup-receipt-report.md) |
| 2.5 | Group (サークル) Management | `groups/{gid}` コレクション新設、複数運営者共有、招待コードでメンバー加入、structures/tournaments を group 配下に破壊的移行 | complete | - | 2 | [completed/phase-2.5-group-management.plan.md](../plans/completed/phase-2.5-group-management.plan.md) — 実装レポート: [phase-2.5-group-management-report.md](../reports/phase-2.5-group-management-report.md) |
| 3 | Timer & Realtime & Viewer | タイマーコア、Firestore `onSnapshot` 同期、接続切断 UI、参加者閲覧画面 | in-progress | with 4 | 2.5 | [phase-3-timer-realtime-viewer.plan.md](../plans/phase-3-timer-realtime-viewer.plan.md) |
| 4 | Seating Automation | 初回席決め（運営者トリガー）、バストボタン、TDA 準拠テーブルバランシング（6 テーブル以下・BB 同着は席番号昇順）、進行中レイトエントリー自動配席 | pending | with 3 | 2.5 | - |
| 5 | Field Test & Polish | 有志ドライラン、バグ修正、UX 磨き込み、初回サークル投入、Should 機能（賞金計算）の余力判断 | pending | - | 3, 4 | - |

### Phase Details

**Phase 1: Foundation**
- **Goal**: アプリの土台を作り、以降の並列開発を可能にする
- **Scope**:
  - Next.js 15 プロジェクト初期化、Tailwind + shadcn/ui セットアップ
  - Firebase プロジェクト作成、Firestore 初期データモデル定義、セキュリティルール雛形
  - Firebase Authentication 有効化（メール・匿名・Email Link の 3 方式）
  - Vercel デプロイパイプライン（GitHub 連携）
  - MIT ライセンスファイル追加、`.gitignore` で `.env.local` 除外
- **Success signal**: ローカルと Vercel 上で空のトーナメント作成→Firestore 反映が確認できる

**Phase 2: Tournament Setup & Receipt**
- **Goal**: トーナメントを設定し、参加者を集められる状態を作る
- **Scope**:
  - ストラクチャ編集 UI（ブラインド構造・初期スタック・レイトエントリー締切レベル）
  - ストラクチャのプリセット保存
  - トーナメント作成／編集／削除
  - 参加者受付画面（URL/QR 発行）
  - 参加者 3 択フロー実装:
    - (a) ログイン（既存 Firebase Auth ユーザー）
    - (b) ゲスト参加（匿名 Auth + 表示名入力）
    - (c) アカウント登録（Email Link でマジックリンク認証・そのまま参加完了）
- **Success signal**: 運営者がサンプルトーナメントを作成し、参加者役の端末から 3 ルート全てで受付完了できる

**Phase 2.5: Group (サークル) Management**
- **Goal**: サークルを第一級エンティティ化し、2〜3 人の運営者で structures / tournaments を共有できるようにする
- **背景**: 実サークルは運営者が複数人いるため、Phase 2 の個人所有モデル（`ownerUid`）では共有できず実運用にならない
- **Scope**:
  - `groups/{gid}` コレクション（name / ownerUid / memberUids / createdAt）
  - `groupJoinCodes/{code}` 招待コード（有効期限付き、1 回 or 複数回使用可）
  - `users/{uid}.groupIds` 逆引きフィールド
  - `structures/{sid}`・`tournaments/{tid}` を **`ownerUid` → `groupId` + `createdByUid` に破壊的変更**
  - `/groups` 一覧 / `/groups/new` 作成 / `/groups/[gid]` 詳細（メンバー一覧・招待コード発行・脱退）
  - `/groups/join/[code]` 加入ページ
  - Phase 2 既存 UI（`/structures` / `/tournaments` など）を「現在選択中の group」をコンテキストとして扱うよう修正
  - Firestore Security Rules: group メンバーシップ（`request.auth.uid in get(...).data.memberUids`）に基づく read/write
  - **既存データは手動削除／マイグレーション前提**（破壊的変更）
- **Success signal**: 運営者 2 人が同じ group に所属した状態で、片方が作った structure / tournament をもう片方が編集・使用できる

**Phase 3: Timer & Realtime & Viewer**
- **Goal**: 全端末で同期されたタイマー表示を実現する
- **Scope**:
  - サーバ時刻基準のタイマーロジック、レベル自動繰り上げ
  - Firestore `onSnapshot` によるトーナメント状態購読
  - 運営者用コントロール（開始／一時停止／再開／手動レベル変更）
  - 参加者閲覧画面（モバイル最適化、ブラインド・残り時間・自席表示）
  - 接続切断検知 UI（最終時刻＋「接続切れ」表示、Firestore オフライン永続化＋再接続時の状態再取得）
- **Success signal**: 3 台以上の異なる端末でタイマーが 1 秒以内のズレで同期表示される

**Phase 4: Seating Automation**
- **Goal**: 席決め・バスト・バランシングを自動指示する
- **Scope**:
  - **初回席決めアルゴリズム**（ランダムシード、全員分）— 運営者トリガー操作で実行
  - **進行中レイトエントリーの自動席決定**（参加登録完了と同時・TDA ルール準拠・レイトエントリー締切レベル判定）
  - バストボタン UI と状態遷移
  - テーブルバランシングロジック（TDA 2015 ルール準拠、6 テーブル以下前提）
    - 人数差 2 以上でバランス発動
    - BB 次のプレイヤーを移動対象に選定、**同着は席番号昇順で決定**
    - 最終卓集約時のテーブルブレイク処理
  - 席移動指示の参加者スマホへの表示
  - バランシングロジックの単体テスト
- **Success signal**: 架空の 20 人・3 テーブルトーナメントで、バスト発生 → バランス指示が TDA ルール通りに算出され、進行中の新規参加も自動配席される

**Phase 5: Field Test & Polish**
- **Goal**: 実運用に投入し、仮説検証を開始する
- **Scope**:
  - 有志 2-3 人でドライラン（バグ洗い出し）
  - UX 磨き込み（エラー文言、警告タイミング、モバイル表示調整）
  - 賞金計算（単純分配）を余力に応じて追加
  - 初回サークル投入 → 運営者フィードバック収集
  - 即時修正と次回投入準備
- **Success signal**: サークル 1 回目の投入でトーナメントが完走し、運営者から継続利用の意思表明を得る

### Parallelism Notes

- **Phase 2.5（Group Management）は破壊的スキーマ変更**のため、Phase 3 / 4 をブロックする。Phase 2 完了後に単独で進める
- Phase 3（タイマー／同期）と Phase 4（席管理）は、Phase 2.5 完了後は相互独立なので並列可能
- Phase 5（実地テスト）は全機能結合が前提のため、3 と 4 の双方完了後

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| 自作 vs 既存ツール採用 | 自作 | Poker Club 採用 | 無料ストラクチャ上限制約・AppleTV 環境不一致・サークル固有ルール組込可否 |
| スタック | **Next.js + Firebase + Vercel** | Supabase / Convex / Cloudflare Workers | **休眠なし（Google インフラ常時稼働）**・Realtime 標準・AI 学習コーパス最大で AI 支援開発との相性最良・認証 3 択（ログイン／ゲスト／アカウント登録）を公式 SDK でカバー |
| 大規模対応 | 6 テーブル以下のみ対応 | 7+ テーブル対応 | TDA のバランシング許容差が変わる・MVP スコープ優先 |
| 参加者認証 | 3 択フロー（ログイン／ゲスト／アカウント登録） | 匿名のみ / メール必須 | 初参加の摩擦最小化とリピーター利便性を両立、ユーザー要望に沿う |
| 初回席決めトリガー | 運営者操作によって確定 | 登録完了時に逐次自動確定 | 参加登録順による偏り・意図的操作を防ぐ |
| 進行中の追加参加者の席決め | 登録完了と同時に TDA 準拠で自動配席 | 運営者手動 | レイトエントリーの即応性、運営者負担削減 |
| BB 同着時の移動対象選定 | 席番号昇順 | ランダム | 決定論的で再現性があり、運営者が説明しやすい |
| リバイ／アドオン | v1 対象外 | v1 同梱 | データモデル影響大・実地フィードバック後に判断 |
| 運営者デバイス | PC・スマホ両対応 | PC のみ | 運営者 3 人の誰でも即応できる必要性 |
| サークル運営者の共有モデル（Phase 2.5 追加） | **Group を第一級エンティティ化**（`groups/{gid}` + `memberUids`）| (A) `sharedWithUids` の ACL 追加のみ / (B) 個人所有のまま | サークル単位で structures / tournaments を一括共有。メンバー追加 1 回で全 doc 共有が自動化され、運営コスト低。将来のロール／統計拡張にも備えられる |
| Phase 2.5 の既存データ互換 | **破壊的変更**（`ownerUid` → `groupId` + `createdByUid`）| 両方式併存（`groupId` を optional） | Phase 2 は内部検証段階で本番データなし、互換レイヤを残すとコード／ルールが複雑化するため破壊的を選択 |
| Phase 2.5 group とデータの関係（フラット vs サブコレ） | **フラット + `groupId` フィールド**（`structures/{sid}` / `tournaments/{tid}` に `groupId` を持つ） | `groups/{gid}/structures/{sid}` / `groups/{gid}/tournaments/{tid}` のサブコレクション化 | 参加者向け公開 URL `/join/{tid}` が `tid` 単独でアクセスできる必要があり、サブコレ化すると `tid → gid` の公開ルックアップ index を別途持つ羽目になり実質的な複雑さが移動するだけ。`tournaments/{tid}/players/{pid}` パスを浅く保てる利点もある。レビュアーから「サブコレが Firestore の標準パターン」との指摘ありだが、tournament が「内部管理 + 公開受付」の二面性を持つ本アプリでは例外側に該当するため現行を維持 |
| 接続切断時 UI | 最終時刻＋「接続切れ」 | 完全ブラックアウト / 警告音 | 混乱最小・誤情報表示を防ぎつつ画面遷移させない |
| 広告収益化 | v1 対象外、v1.1 以降で検討 | v1 同梱 | まず仮説検証優先、収益化は継続使用確認後 |
| ライセンス | MIT | プロプライエタリ / GPL 系 | GitHub 公開前提・サークル外への再利用促進。サークル固有情報は DB に隔離しリポジトリに含めない |

---

## Research Summary

**Market Context**

- 英語圏に多数の競合が存在（[Blind Valet](https://blindvalet.com/), [Travis Poker Timer](https://www.travispokertimer.com/), [Blinds Are Up!](https://blindsareup.com/)）。いずれも「参加者スマホでブラインド閲覧」は標準機能化している
- 日本語対応の [Poker Club](https://pokerfans.jp/poker-club?_lang=ja_JP) は QR 受付・マルチデバイス同期・席管理・ランキング集計まで網羅。ただしポーカー**店舗**運営向けであり、無料サークル環境と価格・機能粒度が合わない
- フォーラム（[Poker Chip Forum](https://www.pokerchipforum.com/)）でも「複数テーブルでの視認性」は恒常的な痛みとして議論されている
- 差別化ポイント: 既存は「熟練オペレーター効率化」、本アプリは「**熟練者不在でも回せる**」（初心者サークル特化の進行自動化）

**Technical Context**

- **スタック最終決定: Firebase（Firestore + Authentication）**。当初 Supabase を候補としたが「1 週間無操作でプロジェクト停止」の制約がサークル月 1-2 回運用と不整合。対策実装の工数を避けるためスタック変更
- [Firebase Spark プラン（無料枠）](https://firebase.google.com/pricing): Firestore 1GB ストレージ・50K 読込/20K 書込/日・50K 認証 MAU・10GB ホスティング帯域。20 人×月 1-2 回規模では余裕
- **休眠なし** — Google インフラ常時稼働、無操作期間による停止や遅延起動はなし
- Firestore `onSnapshot` リアルタイムリスナーは成熟しており、SDK がオフライン永続化・再接続・差分購読を自動処理
- [Vercel Hobby](https://vercel.com/pricing) 無料枠でソロ開発・低トラフィック Web アプリに十分
- [Next.js + Firebase 公式ガイド](https://firebase.google.com/docs/hosting/nextjs) と豊富な AI 学習コーパスにより実装速度最大化
- [TDA 2015 Rules v1.0](https://www.pokertda.com/wp-content/uploads/2011/01/Poker-TDA-Rules-2015-Version-1.0-handout-size-redlines-PDF-4.pdf): 6 テーブル以下は人数差 1 以内、7 テーブル以上は 2 以内でバランス。MVP は前者に限定
- 既存コードベース: `d:\dev\ALLin-Timer` は CLAUDE.md と `.claude/` 配下のみ。完全新規プロジェクト

---

*Generated: 2026-04-19*
*Status: DRAFT - needs validation*
