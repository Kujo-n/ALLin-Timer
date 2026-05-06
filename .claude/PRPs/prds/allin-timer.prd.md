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
- **Trigger**: トーナメント開始前の設定／開始操作／バスト申告時(受付は参加者側で完結したい)
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
| DB | **Firebase Firestore** | **休眠なし**(従量制・Google インフラ常時稼働)・Realtime リスナー標準・無料枠（1GB / 50K読/20K書 per day）はサークル規模で十分 |
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
| 4.10 | Audio Notifications (Custom Upload) **[Deferred to Post-Phase 5 改善候補]** | Firebase Storage 初期導入、`groups/{gid}/audioAssets/{assetId}` サブコレクション、カスタム音源アップロード UI（1 ファイル ≤1MB / group あたり 3 本 / mp3 or ogg）、organizer 以上が CRUD 可能、Storage Rules 追加。Phase 4.9 の `audioSettings.{levelUp,winner}SoundId` を `default:bell` 以外も受け付けるよう拡張。**Phase 5 のドライラン後にカスタム音源需要が確認できた場合のみ Phase 5.x として正式着手判断**（Phase 5 ブロッカーから除外） | deferred | - | 4.9 | - |
| 4.11 | Timer Layout & Control Polish | Phase 4.9 投入後のフォローアップ。Live / Dashboard を 3 カラムレイアウト化（左=QR / 中=タイマー / 右=NextBreak / Avg / Players）、StructureSnapshotCard を共通化し /live にも表示、TimerDisplay の SB/BB/Ante 視認性向上、TimerControls をアイコン化＋順序整理＋SoundToggle 統合、終了時タイマーを `finishedAt` 基準で停止、`useAudioPlayer.unlocked` を `useSyncExternalStore` で全コンポーネント同期、`revertLevel`/`advanceLevel` の paused 状態 invariant 修正（pausedAt 再アーム）、`tournament.lastLevelChangeKind` 追加で手動レベル遷移時のサウンド再生をスキップ。schema は additive（`lastLevelChangeKind: "auto"\|"manual"\|null\|undefined`） | complete | - | 4.9 | 実装レポート: [phase-4.11-timer-layout-control-polish-report.md](../reports/phase-4.11-timer-layout-control-polish-report.md) |
| 4.12 | Dashboard Top-Row Equal-Height & "卓 → Table" Rename | Phase 4.11 後の追加フォローアップ。Dashboard 上段 3 セット（QR / Timer+Controls / 統計 3 カード）を `lg:items-stretch` で QR 高さに揃え、左右 aside の sticky を廃止、TimerDisplay フォント拡大（残時間 `lg:text-[10rem]` / SB/BB/Ante `lg:text-5xl`）、統計 3 カードのタイトルを `text-base/lg font-semibold text-foreground` 化、user-facing 文言「卓 → Table」を一括リネーム（schema フィールド名・AppError ドメインコードは不変）。Winner / SeatingBoard 等を上段 grid から下段に分離。`/live` は無変更 | complete | with 4.10 | 4.11 | [completed/phase-4.12-dashboard-polish-and-table-rename.plan.md](../plans/completed/phase-4.12-dashboard-polish-and-table-rename.plan.md) — 実装レポート: [phase-4.12-dashboard-polish-and-table-rename-report.md](../reports/phase-4.12-dashboard-polish-and-table-rename-report.md) |
| 4.13 | Nav Shell 刷新 + サウンド設定導線整理 | グローバルレイアウトに `AppShell` + サイドバー（desktop md+）+ モバイル用 `Sheet` ナビを導入し、各画面のページ内 nav ボタン（「サークル」「トーナメント」「ストラクチャ」）を撤去。`SoundUnlockBanner` / `SoundToggleButton` から `settingsHref` を廃止し詳細設定はサイドバー「サウンド設定」に集約。`/groups/[gid]` のサークル名変更を Dialog からインライン編集（`requestAnimationFrame` focus + select / Esc / 同名 / 空でキャンセル）に置換、`AuthBadge` をゲストのみ表示に整理しサークル切替を撤去。`/live` は fullscreen pattern でサイドバー非表示。schema / Firestore Rules 変更なし、純 UI / a11y 改善 | complete | - | 4.12 | local review: [local-phase-4.13-nav-sound-review.md](../reviews/local-phase-4.13-nav-sound-review.md)（plan は ad-hoc 改善のため未作成） |
| 4.14 | Dashboard 受付画面 + サイドバー UX Polish | Phase 4.13 ナビ刷新後のフォローアップ。Dashboard 受付画面の (1) 右列 3 カード（NextBreak / AverageStack / Players）を `setup` でも描画して state 遷移時の grid 跳ねを排除、(2) サウンドトグルクリック後 `refreshGroups()` で UI 即時反映、(3) `deleteTournamentIfSetup` を `deleteTournament` にリネームし `setup` または `finished` で削除可能化（players / tables sub-collection を `writeBatch` で cascade 削除）、(4) ヘッダの「一覧へ戻る」ボタンと raw state バッジを廃止、(5) 「全画面表示」を `/live` 遷移から **Fullscreen API トグル** に置換。サイドバーは「サークル一覧」「トーナメント一覧」に rename し、「トーナメント一覧」配下に開催中（`seating`/`running`/`paused`）トーナメントを `subscribeTournamentsByGroup` で realtime 表示。Firestore schema / rules 変更なし | complete | - | 4.13 | [completed/phase-4.14-dashboard-and-nav-polish.plan.md](../plans/completed/phase-4.14-dashboard-and-nav-polish.plan.md) — 実装レポート: [phase-4.14-dashboard-and-nav-polish-report.md](../reports/phase-4.14-dashboard-and-nav-polish-report.md) |
| 4.15 | Header Slot 機構 + Timer Controls 統合 (Post-4.14 Polish) | Phase 4.14 後のフォローアップ。グローバルヘッダの中央 title slot 機構（`PageTitleProvider` / `usePageTitle` / `PageTitleSlot`）を新設し dashboard でトーナメント名をヘッダ中央に表示、Phase 4.14 で dashboard ヘッダに置いた Fullscreen トグル・`ConnectionBadge`（同期中バッジ）を `TimerControls` 右側に統合してコントロール 1 列化、`ConnectionBadge` に縦組み variant、`QrPanel` にレイトレジスト Lv 補助情報、E2E Page Object を新位置へ追従。**schema / Firestore Rules / repository / hook / AppError ドメインコード完全不変**。plan は ad-hoc 改善のため未作成、local review で品質ゲート（Phase 4.13 と同方針） | complete | with 4.10 | 4.14 | local review: TBD（plan は ad-hoc 改善のため未作成） |
| 4.16 | Tournament Default Name (Finished Counter) | 新規作成画面でトーナメント名を `[サークル名]トーナメント-X`（X = 終了済み件数+1）でプリセット。`groups/{gid}.finishedTournamentCount` を additive 追加し、`finishTournament()` を `runTransaction` 化して group counter を `increment(1)`（tx 内で `state !== "finished"` を再 read し二重 increment race を防止）。サークル詳細（`/groups/[gid]`）に開催数の確認・修正 UI を追加（owner / organizer のみ手動編集可）。Firestore Rules に organizer-only counter update branch を 1 件追加（任意の非負整数値を許可）。schema は default(0) で legacy doc 受容、破壊的 migration なし | complete | with 4.10 | 4.15 | [completed/phase-4.16-tournament-default-name-from-finished-counter.plan.md](../plans/completed/phase-4.16-tournament-default-name-from-finished-counter.plan.md) — 実装レポート: [phase-4.16-tournament-default-name-from-finished-counter-report.md](../reports/phase-4.16-tournament-default-name-from-finished-counter-report.md) |
| 4.17 | Group Default Seats Per Table | サークル単位で「1 Table あたりの席数」初期値を保存。`groups/{gid}.defaultSeatsPerTable` を `z.number().int().min(2).max(10).default(9)` で additive 追加し、`/tournaments/new` の `<TournamentForm initialSeatsPerTable=...>` に流し込む。サークル詳細（`/groups/[gid]`）に Phase 4.16「開催数」と同型の inline edit カードを追加（owner / organizer のみ編集可、参照は全メンバー）。Firestore Rules に organizer-only `defaultSeatsPerTable` 単独書換 branch を追加（`affectedKeys().hasOnly(['defaultSeatsPerTable'])` + `is int` + `>= 2` + `<= 10`）。schema は default(9) で legacy doc 受容、破壊的 migration なし | complete | with 4.10 | 4.16 | [completed/phase-4.17-group-default-seats-per-table.plan.md](../plans/completed/phase-4.17-group-default-seats-per-table.plan.md) — 実装レポート: [phase-4.17-group-default-seats-per-table-report.md](../reports/phase-4.17-group-default-seats-per-table-report.md) |
| 5 | Field Test & Polish | 有志ドライラン、バグ修正、UX 磨き込み、初回サークル投入、Should 機能（賞金計算）の余力判断 | in-progress | - | 3, 4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.11, 4.12, 4.13, 4.14, 4.15（4.10 / 4.16 / 4.17 は blocker 外） | - |
| 5.1 | ドライラン #1 で判明した UX / バグ Polish 一括対応 | **Phase 5 の 1 回目のドライランで実際に発生した** UX 摩擦・バグ 9 件（[tmp/13_Phase5_memo.md](../../tmp/13_Phase5_memo.md)）+ 追加ヒアリング 2 件（初回 Google ログインの DisplayName Dialog 発火条件拡張・ゲスト匿名でのハンバーガー / サイドバー非表示・`/live` での hamburger 死の解消・一般メンバー向け「参加中のトーナメント」サイドバー section 追加・**PD（プレイングディーラー）= `players/{pid}.isPlayingDealer: boolean` フラグ方式**で席 1 固定 + 1 卓 1 PD 制約（席決め後は service tx + UI disabled で防御、setup 中は無制限 ON 可で `commitInitialSeating` 時に PD 数 ≤ 卓数を検証し超過時は `seating/pd-too-many` エラー）+ 初回席決め時に PD player を各卓 1 名ずつ seed-driven 分散配置 + ON 時 rotation + バランシング除外 + bust/table break 時 auto-OFF（**卓内 PD 全 OFF = 専任ディーラー（アプリ外の誰かが担当）の表現**として運用、busted player を専任ディーラーに据える運用も全 OFF 状態で成立）+ setup 中の PD 指定 UI は PlayerList の checkbox・初回席のランダム抽選化（連番 → 間欠）・**座席確定後 (state=seating) のレイトエントリー即時自動配席**・autoplay の暗黙 unlock（document `pointerdown` 1 回で resume）・**ゲスト匿名は受付完了画面のみで `/live` には進ませず、`/live` 直接アクセスは / に redirect**）。`players/{pid}.isPlayingDealer` を additive 追加（map 方式は不採用）、Firestore Rules に `players/{pid}` update branch の `isPlayingDealer` 型 check 追加、collectionGroup `players where uid == auth.uid` を新設、AppShell の fullscreen pattern を撤廃、`useImplicitAudioUnlock` hook を新設、`useSeatingAutoOrchestrator` の発火条件に `seating` を追加、`autoSeatLateEntry` の tx 内 state guard を緩和、`isAcceptingLateSeats` 純関数を `tournament-state.ts` に追加。schema は additive で破壊的 migration なし。**Phase 5.1 完了 → 2 回目のドライラン**で「3 回連続使用」の積み上げを継続 | complete | - | 5（および 4.6 / 4.9 / 4.13 / 4.14 の UI 規約） | [completed/phase-5.1-fieldtest-polish.plan.md](../plans/completed/phase-5.1-fieldtest-polish.plan.md) — 実装レポート: [phase-5.1-fieldtest-polish-report.md](../reports/phase-5.1-fieldtest-polish-report.md) |
| 5.2 | Dynamic Blind Adjustment（レベル時間の進行中変更） | 進行中（または setup 中）のトーナメントの `tournaments/{tid}.structureSnapshot.levels[i].durationSec` を運営者（owner / organizer）が任意レベル単位で書き換えられるようにする。`StructureSnapshotCard` の各レベル行に inline edit（`Pencil` → `Input(min=1, unit=分)` → 保存/キャンセル）を追加し、Phase 4.17 の `useInlineNumberEdit` パターンを mirror した `EditableLevelDurationCell` を新規作成。repository は `runTransaction` 内で旧 levels 配列を read → 該当 index だけ置換した新配列を `structureSnapshot.levels` に dot-path で書き戻す（Firestore は配列要素 dot-path 非対応のため）。schema 変更なし、Firestore Rules 変更なし（`tournaments/{tid}` update は既に `isOrganizer` で gate 済み）、`MAX_LEVEL_DURATION_SEC=86400` を `limits.ts` に追加。進行中レベルの編集は `getRemainingMs` の `duration - elapsed` 数式が pure function であるため自動的に新値に追従（`onSnapshot` 経由で約 1 秒以内に全端末反映）。過去レベル / finished では UI 側で編集ボタン非表示 + repository tx 内で `tournament/level-edit-not-allowed` deny。`/live` は read-only 維持（regression 0） | complete | with 4.10 | 5.1（および 4.16 / 4.17 の inline-edit パターン） | [completed/phase-5.2-dynamic-blind-adjustment.plan.md](../plans/completed/phase-5.2-dynamic-blind-adjustment.plan.md) — 実装レポート: [phase-5.2-dynamic-blind-adjustment-report.md](../reports/phase-5.2-dynamic-blind-adjustment-report.md) |
| 5.3 | Append Blind Level（進行中のレベル追加） | 事前作成したストラクチャの最終レベルに到達しても優勝者が決定しない場合に備え、運営者（owner / organizer）が**進行中のトーナメントに新規ブラインドレベルを末尾追加**できるようにする。現状は `advanceLevel` が `currentLevel >= levels.length` で no-op するため最終レベルに張り付き、SB/BB/Ante が固定されたままチップ集約が遅延する。`StructureSnapshotCard` の表末尾に「+ レベル追加」ボタン（organizer かつ `state !== "finished"` のみ表示）を配置し、Dialog で SB / BB / Ante / durationSec / `isBreak` を入力（既定値は直前レベルの BB を 1.5〜2 倍に量子化した quick-fill）。repository は `appendLevel(tid, uid, gids, levelInput)` を `runTransaction` で追加し、tx 内で `structureSnapshot.levels: [...old, newLevel]` を書き戻す（Phase 5.2 と同じ array-rewrite パターン）。schema 変更なし（既存 `levelSchema` を流用、`structureSnapshot.levels.max(...)` の上限が無いことを再確認）、Firestore Rules 変更なし（`tournaments/{tid}` update は既に organizer gate）、`MAX_LEVELS_PER_TOURNAMENT`（仮 50）を `limits.ts` に追加して暴走防止。最終レベルに到達した状態でも auto-advance を発火させない既存挙動は維持し、運営者が新レベルを append すると次 tick で `getNextBreakInfo` の ETA / `shouldAutoAdvance` が新値ベースに自然追従する。`/live` は read-only 維持（regression 0）。Phase 5.2 で `EditableLevelDurationCell` が完成しているため、append 後のレベルも引き続き duration の inline edit 可 | complete | with 4.10 | 5.2 | [completed/phase-5.3-append-blind-level.plan.md](../plans/completed/phase-5.3-append-blind-level.plan.md) — 実装レポート: [phase-5.3-append-blind-level-report.md](../reports/phase-5.3-append-blind-level-report.md) |
| 5.4 | Clone Tournament With Players（同メンバーで次のトーナメントを Clone） | 終了済みトーナメントの dashboard リンクから専用ページ `/tournaments/[tid]/clone` に遷移し、`TournamentForm` を再利用して **コピー元のストラクチャを初期選択**しつつ別ストラクチャへ swap 可能（利用施設の時間制限で 2 回目を短縮ストラクチャに切替えるユースケース）にする。`players[]` のうち organizer がチェックボックスで選択した人だけ（busted は default OFF）を `setup` 状態の新 tournament の `players` サブコレクションへ `writeBatch` でコピー。Firestore Rules の `players/{pid}` `create` に **organizer-clone（setup 限定）ブランチ**を additive で追加し、`pid == uid` invariant・`isBusted=false`・`tableNum/seatNum=null`・`isPlayingDealer=false` の安全 invariant は self ブランチと完全一致で維持。schema 変更なし、Cloud Functions 不使用（Spark プラン維持）。新規: repository `clonePlayersFromTournament`（writeBatch）+ orchestrator `cloneTournamentWithPlayers`（createTournament → clone）+ `/tournaments/[tid]/clone` ページ（page.tsx + clone-client.tsx） + `ClonePlayersChecklist` UI + `tournament-state.canClone` 純関数 + `MAX_CLONE_PLAYERS=50`（writeBatch 500 ops 上限の余裕分）+ `scripts/test-rules-clone-players.mjs` emulator validator。`/live` regression 0 | complete | with 4.10 | 5.3 | [completed/phase-5.4-clone-tournament-with-players.plan.md](../plans/completed/phase-5.4-clone-tournament-with-players.plan.md) — 実装レポート: [phase-5.4-clone-tournament-with-players-report.md](../reports/phase-5.4-clone-tournament-with-players-report.md) |

### Phase Details

各 Phase の詳細（Goal / 背景 / Scope / Success signal）は [allin-timer/phases/](allin-timer/phases/) 配下に per-file 化した。`/prp-plan` は **Implementation Phases 表**で次の pending phase を見つけたら、本セクションの link を辿って該当ファイルから Goal / Scope / Success signal を読み込む（[`prp-plan.md`](../../commands/prp-plan.md) Phase 0 — DETECT 参照）。

- **Phase 1: Foundation** — アプリの土台 → [phase-1.md](allin-timer/phases/phase-1.md)
- **Phase 2: Tournament Setup & Receipt** — トーナメント設定 + 参加者受付 → [phase-2.md](allin-timer/phases/phase-2.md)
- **Phase 2.5: Group (サークル) Management** — サークル単位の共有モデル → [phase-2.5.md](allin-timer/phases/phase-2.5.md)
- **Phase 3: Timer & Realtime & Viewer** — 全端末同期タイマー → [phase-3.md](allin-timer/phases/phase-3.md)
- **Phase 4: Seating Automation** — 席決め + バランシング自動化 → [phase-4.md](allin-timer/phases/phase-4.md)
- **Phase 4.5: Pre-Phase 5 Improvements** — Phase 5 前 UX / 運用 polish 7 件 → [phase-4.5.md](allin-timer/phases/phase-4.5.md)
- **Phase 4.6: Member Role Split** — owner / organizer / member の 3 階層化 → [phase-4.6.md](allin-timer/phases/phase-4.6.md)
- **Phase 4.7: Onboarding Polish & Structure Enhancements** — 7 件の UX / 機能ペイン解消 → [phase-4.7.md](allin-timer/phases/phase-4.7.md)
- **Phase 4.8: Structure Template Library** — サークル横断テンプレート + templateAdmins → [phase-4.8.md](allin-timer/phases/phase-4.8.md)
- **Phase 4.9: Audio Notifications (Default Sounds)** — bundled デフォルト音源で MVP → [phase-4.9.md](allin-timer/phases/phase-4.9.md)
- **Phase 4.10: Audio Notifications (Custom Upload) [Deferred]** — Storage 必須のためオプション扱い → [phase-4.10.md](allin-timer/phases/phase-4.10.md)
- **Phase 4.11: Timer Layout & Control Polish** — 3 カラム化 + pause invariant 修正 → [phase-4.11.md](allin-timer/phases/phase-4.11.md)
- **Phase 4.12: Dashboard Top-Row Equal-Height & "卓 → Table" Rename** — 等高 grid + 用語統一 → [phase-4.12.md](allin-timer/phases/phase-4.12.md)
- **Phase 4.13: Nav Shell 刷新 + サウンド設定導線整理** — AppShell + サイドバー + Sheet → [phase-4.13.md](allin-timer/phases/phase-4.13.md)
- **Phase 4.14: Dashboard 受付画面 + サイドバー UX Polish** — Fullscreen API + 削除 cascade → [phase-4.14.md](allin-timer/phases/phase-4.14.md)
- **Phase 4.15: Header Slot 機構 + Timer Controls 統合** — PageTitleSlot + コントロール集約 → [phase-4.15.md](allin-timer/phases/phase-4.15.md)
- **Phase 4.16: Tournament Default Name (Finished Counter)** — `groups.finishedTournamentCount` + デフォルト名 → [phase-4.16.md](allin-timer/phases/phase-4.16.md)
- **Phase 4.17: Group Default Seats Per Table** — `groups.defaultSeatsPerTable` 永続化 → [phase-4.17.md](allin-timer/phases/phase-4.17.md)
- **Phase 5: Field Test & Polish** — 実運用ドライラン + 仮説検証 → [phase-5.md](allin-timer/phases/phase-5.md)

> Phase 5.1 以降は per-file の Phase Details を未作成。詳細は Implementation Phases 表行の description / PRP Plan link を直接参照する（plan が `pending` で投入されている phase は plan ファイルが Goal / Scope を兼ねる）。

> Phase 5.3（Append Blind Level）の起源: ストラクチャ事前作成時に想定していなかった長期化シナリオ — 最終ブラインドレベルに到達しても優勝者が決まらず、SB/BB/Ante が固定されたまま auto-advance も発火しないという挙動が Phase 5.2 完了レビュー（2026-05-06）で確認された。Phase 5.2 の `setLevelDurationSec` は既存 index の duration 置換のみで `levels.length` を伸ばす経路は持たず、`/tournaments/[tid]/edit` は `state === "setup"` 限定のため進行中の append 経路は皆無だった。Phase 5.3 でこのギャップを埋め、運営者が 1 操作で末尾レベルを追加できるようにする。

### Parallelism Notes

- **Phase 2.5（Group Management）は破壊的スキーマ変更**のため、Phase 3 / 4 をブロックする。Phase 2 完了後に単独で進める
- Phase 3（タイマー／同期）と Phase 4（席管理）は、Phase 2.5 完了後は相互独立なので並列可能
- Phase 4.5（UX 整理）は Phase 4 完了後の後付け改善。Phase 5 のドライラン前に完了させる
- Phase 4.6（ロール分離）は Phase 4.5 完了後に単独実施。**破壊的スキーマ変更**のため他 phase とは並行しない
- Phase 4.7（UX / schema additive）は Phase 4.6 完了後に単独実施。**schema は additive**（zod default / nullable / record default({})）で破壊的 migration 不要。Firestore Rules は groups update に self-key 書込条件を 1 つ追加するのみ（他 collection 変更なし）
- Phase 4.8（Template Library）は Phase 4.7 完了後に単独実施。**新規 2 collection + Firestore Rules 追加デプロイ**と **Firestore Console での管理者 bootstrap**（`templateAdmins/{uid}` に空 doc 1 件）が必要。Phase 4.7 の `levelSchema.isBreak` / `rebuyStack` / `addOnStack` に依存するため 4.7 → 4.8 の順で実施
- Phase 4.9（音声通知 段階1）は Phase 4.8 完了後に単独実施。**schema は additive**（`groups/{gid}.audioSettings` フィールド追加 + zod default で既存 doc を補完）、Firestore Rules は groups update に audioSettings 書込条件を 1 つ追加。Storage 不使用で破壊的 migration なし
- Phase 4.10（音声通知 段階2）は **Phase 5 以降の改善候補に持ち越し**。Phase 5 のフィールドテスト後に運営者ヒアリングを経て着手判断する。実装時は Firebase Storage が有効化できる環境（既存 Firebase プロジェクトで Spark のまま Storage 有効化可能、または Blaze プランへのアップグレード許容）でのみ実施。**Firebase Storage 初期導入**（プロジェクト設定 + Storage Rules + `firebase/storage` SDK 追加）と `groups/{gid}/audioAssets` サブコレクション新設が必要。Phase 4.9 の `audioSettings` schema を extend する additive 変更
- Phase 4.11（タイマー UI/UX フォローアップ）は Phase 4.9 完了後に単独実施。**schema は additive**（`tournaments/{tid}.lastLevelChangeKind` を optional で追加、既存 doc の missing field を許容）。Firestore Rules 変更なし、破壊的 migration なし。Phase 4.10 とは独立で並行可能（互いに別 collection / 別関数を触る）
- Phase 4.12（Dashboard 等高化 & "卓 → Table" rename）は Phase 4.11 完了後に単独実施。**schema / Firestore Rules / hook / repository は完全不変**で純 UI とラベル文字列のみ。Phase 4.10 とは独立で並行可能。AppError ドメインコードと collection / フィールド名は全て維持
- Phase 4.13（Nav Shell 刷新）は Phase 4.12 完了後に単独実施。**schema / Firestore Rules / repository は完全不変**で AppShell + サイドバー / Sheet 導入と各ページ内 nav ボタン撤去のみ。plan は ad-hoc 改善のため未作成、local review で品質ゲート。Phase 4.10 とは独立で並行可能
- Phase 4.14（Dashboard 受付画面 + サイドバー UX Polish）は Phase 4.13 のナビ刷新後に単独実施。**schema / Firestore Rules は完全不変**。`deleteTournamentIfSetup` → `deleteTournament` の API 名 rename のみ破壊的（callsite 1 箇所、互換 alias 作らず）。`tournaments.ts` に `subscribeTournamentsByGroup` を additive で新設。`/live` ページは無変更で参加者用フロー / 既存 E2E に影響なし。Phase 4.10 とは独立で並行可能
- Phase 4.15（Post-4.14 Polish）は Phase 4.14 完了後に単独実施。**schema / Firestore Rules / repository / hook 完全不変**で純 UI / レイアウト改善のみ（`PageTitleProvider` / `PageTitleSlot` 新設、`TimerControls` への Fullscreen トグル / `ConnectionBadge` 統合、`QrPanel` レイトレジスト Lv 表示、E2E Page Object 追従）。plan は ad-hoc 改善のため未作成、local review で品質ゲート（Phase 4.13 と同方針）。Phase 4.10 とは独立で並行可能
- Phase 4.16（Tournament Default Name）は Phase 4.15 完了後に単独実施。**schema は additive**（`groups/{gid}.finishedTournamentCount` を `default(0)` で追加）、Firestore Rules に organizer-only counter update branch 1 件追加（`isOrganizer(gid)` + `affectedKeys().hasOnly(['finishedTournamentCount'])` + 任意の非負整数値を許可。自動 +1 と手動修正の両方を 1 branch でカバー）、`finishTournament()` を `runTransaction` 化して group counter を `increment(1)`（tx 内で `state !== "finished"` を再 read することで複数端末同時呼び出し時の二重 increment race を防止）、サークル詳細ページ（`/groups/[gid]`）に開催数の確認・修正 UI を追加（owner / organizer のみ編集可、参照は全メンバー）。Phase 4.10 とは独立で並行可能。**Phase 5 のブロッカーには加えない**（Phase 5 のドライラン中・後でも投入可能な小規模 polish のため）
- Phase 4.17（Group Default Seats Per Table）は Phase 4.16 完了後に単独実施。**schema は additive**（`groups/{gid}.defaultSeatsPerTable` を `default(9)` で追加、値域 2..10 は `tournament.seatsPerTable` と完全一致）、Firestore Rules に organizer-only `defaultSeatsPerTable` 単独書換 branch 1 件追加（`isOrganizer(gid)` + `affectedKeys().hasOnly(['defaultSeatsPerTable'])` + `is int` + 2..10）、新規作成画面と group 詳細画面の UI 追加のみで repository / hook 構造は不変。Phase 4.10 とは独立で並行可能。**Phase 5 のブロッカーには加えない**（Phase 4.16 と同方針）
- Phase 5（実地テスト）は全機能結合が前提のため、3 / 4 / 4.5 / 4.6 / 4.7 / 4.8 / 4.9 / 4.11 / 4.12 / 4.13 / 4.14 / 4.15 の完了後（**Phase 4.10 / 4.16 / 4.17 は Phase 5 以降に投入可能なため blocker から除外**）
- Phase 5.3（Append Blind Level）は Phase 5.2 完了後に単独実施。**schema 変更なし**（`levelSchema` を流用して `structureSnapshot.levels` 末尾に push）、Firestore Rules 変更なし（`tournaments/{tid}` update は既に organizer gate）、`MAX_LEVELS_PER_TOURNAMENT` を `limits.ts` に追加するのみ。Phase 5.2 と同じ array-rewrite + `runTransaction` パターンで race-safe。Phase 4.10 とは独立で並行可能
- Phase 5.4（Clone Tournament With Players）は Phase 5.3 完了後に単独実施。**schema 変更なし**（`players/{pid}` の既存 schema をそのまま流用）、Firestore Rules に `players/{pid}` `create` の organizer-clone（setup 限定）ブランチを 1 つ additive 追加するのみ。新規 repository（`clonePlayersFromTournament`）+ orchestrator（`cloneTournamentWithPlayers`）+ Dialog UI + `canClone` 純関数 + `MAX_CLONE_PLAYERS` 定数 + emulator validator のみで完結。Cloud Functions 不使用で Spark プラン維持。Phase 4.10 とは独立で並行可能

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
