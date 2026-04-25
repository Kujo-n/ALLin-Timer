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
| Must | **音声通知（デフォルト音源）**（ブラインドレベル変更時／優勝者確定時、運営者ロール（owner/organizer）の端末でのみ再生、group 単位の on/off + 音量設定） | 運営者がブラインドアップに気付かない／優勝確定が会場全体に伝わらないという既存ペインを音で解消。Phase 4.9 で要件漏れ確認後に Must 化 |
| Should | 賞金計算（単純分配） | AI 支援で低コスト実装可能 |
| Could | **音声通知（カスタム音源アップロード）**（Phase 4.10、Firebase Storage 必須） | デフォルト音源でコアペインは解消済み。MIT 公開時の Storage / Blaze プラン要件を避けるためオプション扱い |
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
| dev 依存の esbuild 脆弱性（GHSA-67mh-4wv8-2f99） | L（dev-only） | Phase 4.5 時点で `npm audit` が 6 moderate を検出。すべて `esbuild <= 0.24.2`（vite / vitest 経由の dev dependency）由来で**本番バンドル外**。攻撃成立条件は「ローカル dev サーバ稼働中に悪意のあるサイトを同時に開く」という限定的シナリオ。修正には `vitest@4.1.5` への破壊的アップグレード（API 変更 + 既存 296+ tests の書き直しリスク）が必要なため、**Phase 5 以降の独立タスクとして遅延対応**する。`npm audit fix --force` は絶対に実行しないこと（テストスイートが壊れる）。対応時は `vitest v4 migration` plan を `/prp-plan` で新設する。 |

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
| 3 | Timer & Realtime & Viewer | タイマーコア、Firestore `onSnapshot` 同期、接続切断 UI、参加者閲覧画面 | complete | with 4 | 2.5 | [completed/phase-3-timer-realtime-viewer.plan.md](../plans/completed/phase-3-timer-realtime-viewer.plan.md) — 実装レポート: [phase-3-timer-realtime-viewer-report.md](../reports/phase-3-timer-realtime-viewer-report.md) |
| 4 | Seating Automation | 初回席決め（運営者トリガー）、バストボタン、TDA 準拠テーブルバランシング（6 テーブル以下・BB 同着は席番号昇順）、進行中レイトエントリー自動配席 | complete | with 3 | 2.5 | [completed/phase-4-seating-automation.plan.md](../plans/completed/phase-4-seating-automation.plan.md) — 実装レポート: [phase-4-seating-automation-report.md](../reports/phase-4-seating-automation-report.md) |
| 4.5 | Pre-Phase 5 Improvements | UX 改善（運営者自己参加ボタン・/groups からの遷移・ヘッダー displayName 表示・未ログイン時トップ簡素化）、Winner 演出＋自動終了、匿名アカウント自己削除、Email Link 方式の撤廃 | complete | - | 4 | [completed/phase-4.5-pre-phase5-improvements.plan.md](../plans/completed/phase-4.5-pre-phase5-improvements.plan.md) — 実装レポート: [phase-4.5-pre-phase5-improvements-report.md](../reports/phase-4.5-pre-phase5-improvements-report.md) |
| 4.6 | Member Role Split | `groups/{gid}` を owner / organizer / general member の 3 階層化（`ownerUids` 複数可・`organizerUids` 新設）、一般メンバーは自サークルのトーナメント一覧閲覧＋ワンタップ参加、昇降格 UI は owner 専用、破壊的 migration あり | complete | - | 4.5 | [completed/phase-4.6-member-role-split.plan.md](../plans/completed/phase-4.6-member-role-split.plan.md) — 実装レポート: [phase-4.6-member-role-split-report.md](../reports/phase-4.6-member-role-split-report.md) |
| 4.7 | Onboarding Polish & Structure Enhancements | Google 新規ログイン時の displayName 設定ダイアログ、匿名参加後のヘッダ displayName 即反映（AuthProvider.refreshUser）、リバイ／アドオン スタック量フィールド追加、平均スタックカード表示、ブレイクレベル（`Level.isBreak`）対応、`groups/{gid}.memberDisplayNames` snapshot 追加（サークル一覧で UID ではなく displayName 表示）、`/tournaments` 一覧の状態別カード色分け。schema は additive、Firestore Rules は groups update に self-key 書込条件を 1 つ追加 | complete | - | 4.6 | [completed/phase-4.7-onboarding-polish-structure-enhancements.plan.md](../plans/completed/phase-4.7-onboarding-polish-structure-enhancements.plan.md) — 実装レポート: [phase-4.7-onboarding-polish-structure-enhancements-report.md](../reports/phase-4.7-onboarding-polish-structure-enhancements-report.md) |
| 4.8 | Structure Template Library | サークル横断の Structure Templates。`structureTemplates/{tid}` 公開コレクション + `templateAdmins/{uid}` 管理者機構を新設。`/templates` 一覧・作成・編集ページ、`/structures/new` の Firestore 取得 TemplatePicker。作成者名 snapshot、管理者は他人テンプレを削除可。Firestore Rules 追加 + 最初の管理者は Console で手動 seed | complete | - | 4.7 | [completed/phase-4.8-structure-template-library.plan.md](../plans/completed/phase-4.8-structure-template-library.plan.md) — 実装レポート: [phase-4.8-structure-template-library-report.md](../reports/phase-4.8-structure-template-library-report.md) |
| 4.9 | Audio Notifications (Default Sounds) | ブラインドレベル変更／優勝者確定時の音声再生。`groups/{gid}.audioSettings`（enabled / levelUpSoundId / winnerSoundId / volume）追加、`useAudioPlayer` フック新設、autoplay unlock 明示ボタン、再生はロールベース（owner/organizer のみ）、デフォルト音源 2 種類（blind-up / victory-chime、mp3+ogg）を `public/sounds/` に同梱。Firebase Storage 不使用、schema は additive | complete | - | 4.8 | [completed/phase-4.9-audio-notifications.plan.md](../plans/completed/phase-4.9-audio-notifications.plan.md) — 実装レポート: [phase-4.9-audio-notifications-report.md](../reports/phase-4.9-audio-notifications-report.md) |
| 4.10 | Audio Notifications (Custom Upload) **[Optional]** | Firebase Storage 初期導入、`groups/{gid}/audioAssets/{assetId}` サブコレクション、カスタム音源アップロード UI（1 ファイル ≤1MB / group あたり 3 本 / mp3 or ogg）、organizer 以上が CRUD 可能、Storage Rules 追加。Phase 4.9 の `audioSettings.{levelUp,winner}SoundId` を `default:bell` 以外も受け付けるよう拡張。**Storage 未設定環境でも Phase 4.9 のデフォルト音源で運用継続可能（オプション機能）** | pending | - | 4.9 | - |
| 4.11 | Timer Layout & Control Polish | Phase 4.9 投入後のフォローアップ。Live / Dashboard を 3 カラムレイアウト化（左=QR / 中=タイマー / 右=NextBreak / Avg / Players）、StructureSnapshotCard を共通化し /live にも表示、TimerDisplay の SB/BB/Ante 視認性向上、TimerControls をアイコン化＋順序整理＋SoundToggle 統合、終了時タイマーを `finishedAt` 基準で停止、`useAudioPlayer.unlocked` を `useSyncExternalStore` で全コンポーネント同期、`revertLevel`/`advanceLevel` の paused 状態 invariant 修正（pausedAt 再アーム）、`tournament.lastLevelChangeKind` 追加で手動レベル遷移時のサウンド再生をスキップ。schema は additive（`lastLevelChangeKind: "auto"\|"manual"\|null\|undefined`） | complete | - | 4.9 | 実装レポート: [phase-4.11-timer-layout-control-polish-report.md](../reports/phase-4.11-timer-layout-control-polish-report.md) |
| 5 | Field Test & Polish | 有志ドライラン、バグ修正、UX 磨き込み、初回サークル投入、Should 機能（賞金計算）の余力判断 | pending | - | 3, 4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.11（4.10 はオプション扱いで blocker 外） | - |

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

**Phase 4.5: Pre-Phase 5 Improvements**
- **Goal**: Phase 5 のドライラン前に、Phase 4 完了時点で洗い出された UX / 運用の摩擦を一括整理する
- **背景**: 受付・席管理・バランシングは Phase 4 で完結したが、`/groups` 画面からの導線不足・ヘッダーの email 表示・Winner 演出の欠如・匿名アカウントの蓄積・未使用の Email Link 方式など、実投入前に潰しておきたい 7 件の改善要望が発生
- **Scope**:
  - 運営者ダッシュボード（setup）に「自分も参加する」ワンクリック導線追加
  - `/groups/[gid]` からトーナメント / ストラクチャへの直接遷移ボタン追加
  - ヘッダーのユーザー表示を `displayName` 優先に変更（email はフォールバック）
  - 未ログイン時のトップ画面を「ログイン/新規登録」1 ボタンに簡素化
  - 残り 1 人を検知した時点で Winner バナー表示 → 2 秒後に `finishTournament` を運営者端末から自動呼出
  - トーナメント終了 / ログアウト / 参加取消時、匿名ユーザーの Firebase Auth + `users/{uid}` を client-side best-effort で自己削除
  - Email Link サインイン方式の完全撤廃（ルート・UI タブ・auth-actions・receipt・localStorage・テストすべて削除）
- **Success signal**: 7 件すべての挙動を手動確認し、typecheck / lint / test / build が green、Phase 5 のドライラン準備が整う

**Phase 4.6: Member Role Split**
- **Goal**: サークル所属を「運営（organizer）」と「一般メンバー（general member）」に分離し、一般メンバーがアプリ上から参加サークルのトーナメントを見てワンタップ参加できるようにする
- **背景**: Phase 2.5 のフラットな `memberUids` モデルでは「見るだけ・参加だけ」の権限レベルが存在せず、実サークルで非運営者をそのままメンバーに加えると全員が CRUD 権限を持ってしまう。実運用では「運営 2-3 人 + 参加する側の一般メンバー多数」の構成が必要
- **Scope**:
  - `groups/{gid}` スキーマ拡張: `ownerUid: string` → `ownerUids: string[]`（**オーナー複数可**）、`organizerUids: string[]` 新設（`memberUids ⊇ organizerUids ⊇ ownerUids` の invariant）
  - 既存メンバーは全員 organizer として migration（運営権限は保持、破壊なし）。既存 `ownerUid` は `ownerUids: [ownerUid]` に昇格
  - 招待コード加入のデフォルトを「一般メンバー」に変更（`memberUids` のみ +1、organizerUids / ownerUids には追加しない）
  - ロール昇降格 UI は **オーナー専用**（owner のみ member ↔ organizer ↔ owner を操作可能）
  - 最後のオーナーは降格 / 脱退 / group 削除不可（service + rule の二重ガード）
  - `/tournaments` 一覧は一般メンバーも閲覧可能、カードに「参加する」ボタン追加（`joinAsCurrentUser` ワンタップ）
  - 一般メンバーが `/tournaments/{tid}` （運営ダッシュボード）URL を直打ちした場合、`/tournaments/{tid}/live` にリダイレクト
  - Firestore Security Rules: structures / tournaments / groupJoinCodes の write 条件を `isGroupMember` → `isOrganizer` に強化、groups の rename / delete / roles update は `isOwner` 判定（ownerUids 配列対応）
  - 既存データ移行用 migration スクリプト（admin SDK、dry-run 対応）
- **Success signal**:
  - Owner / Organizer / Member の 3 視点でブラウザ検証がすべて通る（運営 UI の表示/非表示、参加ボタンの挙動、ロール変更の反映）
  - Migration スクリプトが既存 groups を破壊せず新スキーマに揃える
  - 最後のオーナー保護などの invariant が service + rule 両層で enforce されている

**Phase 4.7: Onboarding Polish & Structure Enhancements**
- **Goal**: Phase 5 のドライラン前に、運用で挙がった **7 件の UX / 機能ペイン**（memo-08 の 5 件 + memo-09 の 2 件）を一括解消する。Structure Templates は Phase 4.8 に分離
- **背景**: 運営者側からの改善要望（`tmp/08_Phase4.6_memo.md` + `tmp/09_pahse4.7_memo.md`）で、サークル SNS ニックネーム前提の運用・平均スタック把握要求・ブレイク運用・サークルメンバー識別（UID → displayName）・トーナメント一覧の状態視認性が出揃った
- **Scope**:
  - Google 新規ログイン時の `DisplayNameDialog` 強制表示（`additionalUserInfo.isNewUser` 判定）、既存ユーザーは skip
  - `AuthProvider.refreshUser()` を公開し、`signInAsGuest` / `registerWithEmail` / `updateDisplayName` 直後に呼び出してヘッダ displayName を即反映（useReducer bump で強制再描画）
  - `structures.{rebuyStack, addOnStack}` と `structureSnapshot.{rebuyStack, addOnStack}` を nullable number として追加（schema additive、旧 doc は zod default で null）
  - `AverageStackCard` を dashboard / live の TimerDisplay 枠外に独立カードとして配置（計算式: `totalEntries × initialStack ÷ activePlayers`）
  - `Level.isBreak: boolean` 追加、LevelTable にチェックボックス、TimerDisplay は "☕ BREAK" 表示に切替
  - **`groups/{gid}.memberDisplayNames` snapshot 追加**（`/groups/{gid}` で UID ではなく displayName 表示）。`consumeJoinCode` 時の書込と `updateDisplayName` 時の best-effort 伝播。rule は self-key 書込条件を追加（`diff().affectedKeys().hasOnly([auth.uid])`）
  - **`/tournaments` 一覧カードの状態別色分け**: setup/seating=slate、running/paused=emerald、finished=muted 半透明。日本語ラベル化（進行中 / 未開催 / 終了）
  - 既存 schema は additive、Firestore Rules は groups update に 1 条件追加、破壊的 migration 不要
- **Success signal**: 7 件すべての挙動を手動ブラウザで確認し、typecheck / lint / test / build が green

**Phase 4.8: Structure Template Library**
- **Goal**: サークル横断でストラクチャのひな形を共有できる Structure Templates を提供。memo item 2 の初心者ペイン（SB/BB 設計に悩む）と「出先でスマホから追加できる運用」を両立する
- **背景**: Phase 4.7 で基礎的な UX 改善は完了。初心者運営者が他サークルのベストプラクティスを再利用できる仕組みが未実装のため、テンプレート共有コレクションを新設する
- **Scope**:
  - **`structureTemplates/{tid}` コレクション新設**: サインイン済み全員が read・create 可、edit は本人のみ、delete は本人または管理者
  - **`templateAdmins/{uid}` コレクション新設**: doc 存在 = テンプレート管理者。作成者脱会後のテンプレを削除する権限。bootstrap は Firestore Console で最初の 1 人を手動 seed
  - 作成者名を template doc に `createdByDisplayName` として snapshot 保存（`users/{uid}` の self-only read 制約回避）
  - `/templates` 一覧 / `/templates/new` / `/templates/{tid}/edit` の 3 ページ追加
  - `/structures/new` の `StructureTemplatePicker` は `listStructureTemplates()` 経由で Firestore から取得し、選択でフォームに一括反映（Phase 4.7 時点では未実装）
  - `firestore.rules` に `isTemplateAdmin()` helper と 2 match ブロック追加、本番デプロイ + README への管理者 seed 手順追記
  - Phase 4.7 の `levelSchema.isBreak` / `rebuyStack` / `addOnStack` を re-use（schema drift 防止）
- **Success signal**:
  - Owner / 他人 / 管理者の 3 視点でブラウザ検証がすべて通る（編集・削除ボタンの表示／非表示、実操作の成功）
  - Firestore Rules デプロイ後、最初の管理者が Console で seed 済み
  - `/structures/new` で Firestore から取得したテンプレが適用できる

**Phase 4.9: Audio Notifications (Default Sounds)**
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

**Phase 4.10: Audio Notifications (Custom Upload) [Optional]**
- **位置付け**: **オプション機能（Storage 未設定環境では実装スキップ可能）**。Phase 4.9 のデフォルト音源だけでも MVP 要件は満たせるため、Phase 4.10 を実装しない場合でもアプリは正常動作する
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

**Phase 4.11: Timer Layout & Control Polish**
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

**Phase 5: Field Test & Polish**
- **Goal**: 実運用に投入し、仮説検証を開始する
- **Scope**:
  - 有志 2-3 人でドライラン（バグ洗い出し）
  - UX 磨き込み（エラー文言、警告タイミング、モバイル表示調整）
  - 賞金計算（単純分配）を余力に応じて追加
  - 初回サークル投入 → 運営者フィードバック収集
  - 即時修正と次回投入準備
- **UX 磨き込み候補（Phase 4.5 から繰越）**:
  - `/groups` 一覧カードの「詳細」ボタンを **「開く」** にリネーム（遷移先の意図を強調、Phase 4.5 レビューで判明した「`/groups` と `/groups/[gid]` の役割が一見して分かりづらい」への対応）
- **Success signal**: サークル 1 回目の投入でトーナメントが完走し、運営者から継続利用の意思表明を得る

### Parallelism Notes

- **Phase 2.5（Group Management）は破壊的スキーマ変更**のため、Phase 3 / 4 をブロックする。Phase 2 完了後に単独で進める
- Phase 3（タイマー／同期）と Phase 4（席管理）は、Phase 2.5 完了後は相互独立なので並列可能
- Phase 4.5（UX 整理）は Phase 4 完了後の後付け改善。Phase 5 のドライラン前に完了させる
- Phase 4.6（ロール分離）は Phase 4.5 完了後に単独実施。**破壊的スキーマ変更**のため他 phase とは並行しない
- Phase 4.7（UX / schema additive）は Phase 4.6 完了後に単独実施。**schema は additive**（zod default / nullable / record default({})）で破壊的 migration 不要。Firestore Rules は groups update に self-key 書込条件を 1 つ追加するのみ（他 collection 変更なし）
- Phase 4.8（Template Library）は Phase 4.7 完了後に単独実施。**新規 2 collection + Firestore Rules 追加デプロイ**と **Firestore Console での管理者 bootstrap**（`templateAdmins/{uid}` に空 doc 1 件）が必要。Phase 4.7 の `levelSchema.isBreak` / `rebuyStack` / `addOnStack` に依存するため 4.7 → 4.8 の順で実施
- Phase 4.9（音声通知 段階1）は Phase 4.8 完了後に単独実施。**schema は additive**（`groups/{gid}.audioSettings` フィールド追加 + zod default で既存 doc を補完）、Firestore Rules は groups update に audioSettings 書込条件を 1 つ追加。Storage 不使用で破壊的 migration なし
- Phase 4.10（音声通知 段階2）は **オプション機能**。Phase 4.9 完了後、Firebase Storage が有効化できる環境（既存 Firebase プロジェクトで Spark のまま Storage 有効化可能、または Blaze プランへのアップグレード許容）でのみ実施。**Firebase Storage 初期導入**（プロジェクト設定 + Storage Rules + `firebase/storage` SDK 追加）と `groups/{gid}/audioAssets` サブコレクション新設が必要。Phase 4.9 の `audioSettings` schema を extend する additive 変更
- Phase 4.11（タイマー UI/UX フォローアップ）は Phase 4.9 完了後に単独実施。**schema は additive**（`tournaments/{tid}.lastLevelChangeKind` を optional で追加、既存 doc の missing field を許容）。Firestore Rules 変更なし、破壊的 migration なし。Phase 4.10 とは独立で並行可能（互いに別 collection / 別関数を触る）
- Phase 5（実地テスト）は全機能結合が前提のため、3 / 4 / 4.5 / 4.6 / 4.7 / 4.8 / 4.9 / 4.11 の完了後（**Phase 4.10 はオプションのため blocker から除外**）

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
| 音声通知の MVP 採否（Phase 4.9 追加） | **MVP Must に追加**（要件漏れ） | Could / Should 扱いで v1.1 へ | 運営者の「ブラインドアップ見落とし」「優勝確定が会場で伝わらない」は Phase 4.5 までに解消できていないペイン。フィールド投入前に必須化 |
| 音声通知の Phase 分割（Phase 4.9 / 4.10） | 2 段階（4.9 デフォルト音源で動作確認 → 4.10 カスタム音源） | 1 段階で全実装 | Firebase Storage 初期導入は独立した作業量（プロジェクト設定 + Storage Rules + アップロード validation）があり、Phase 4.9 単独で MVP 動作確認できる方が安全 |
| 音声再生主体 | **ロールベース**（owner / organizer のユーザーが見ている画面でのみ再生） | ページベース（運営ダッシュボードのみ）/ 全ユーザー / 端末オプトイン | 参加者スマホで予期せぬ音を出さない × 運営者が `/live` を会場ディスプレイで投影した場合は鳴る、を両立 |
| 音声 on/off スコープ | **group 単位**（`groups/{gid}.audioSettings.enabled`） | 端末ローカル（localStorage）/ ユーザー横断（`users/{uid}`） | サークル運営方針で全運営者が一致した動作になる方が運用が分かりやすい。設定変更権限は organizer 以上に限定 |
| 音源選択スコープ | group 単位（全運営者で同一音源） | 個人カスタマイズ可能 | 要件「サークルごとに音声を追加・設定できる」に素直に対応。実装シンプル |
| autoplay unlock | **明示的「サウンドを有効化」ボタン** | 任意のクリックで暗黙的 unlock | 運営者の意図的な consent を取り、不意打ち再生を回避 |
| デフォルト音源の調達 | ffmpeg 純音生成（`scripts/generate-default-sounds.sh` 同梱） | フリー素材サイト（Pixabay/Mixkit） | MIT 配布リポジトリのため帰属表記不要・再現可能・ライセンス問題ゼロを最優先 |
| カスタム音源制約（Phase 4.10） | 1 ファイル ≤1MB / group あたり 3 本 / mp3 or ogg / organizer 全員が削除可能 | 容量無制限 / 本数無制限 / 作成者のみ削除 | 無料枠 Storage の保護 + サークル運営の柔軟性（脱会した運営者の音源を残された側が片付けられる） |
| Phase 4.10 の必須／オプション扱い | **オプション機能**（Storage 未設定環境では実装スキップ可能、Phase 5 の blocker から除外） | Must として全環境で必須化 | (1) 2024-10 以降の Firebase 新規プロジェクトは Storage 利用に Blaze プラン必須化。MIT 公開リポジトリのフォークユーザーに CC 登録を強制したくない。(2) Phase 4.9 のデフォルト音源で「ブラインドアップ見落とし」「優勝確定の伝達」のコアペインは解消済み。カスタム音源は付加価値であり MVP の必須要件ではない |

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
