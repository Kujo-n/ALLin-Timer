# 実装レポート: Phase 3 — 受付画面の新規登録タブ

## Summary

`/join/[tid]` に 3 つめのタブ「新規登録」を追加し、Google アカウントを持たない参加者が
**受付画面だけでアカウント作成 → 参加登録 → サークル自動所属**まで完結できるようにした。

新経路は Phase 2 の共通 helper `receiveEntry` を必ず通る service `joinAsNewUser`
（`registerWithEmail` → `receiveEntry`）として実装したため、自動所属と完了画面の
フィードバック（`applyReceiptOutcome`）を自動的に引き継ぐ。

併せて `/login` と受付画面で重複していた入力欄を共有コンポーネント 2 種
（`DisplayNameField` / `EmailPasswordFields`）に抽出した（PRD Open Questions で
Phase 3 判断とされていた論点の決着）。抽出の粒度は「入力欄（Label + Input + hint）」に
留め、`/login` 固有の外側レイアウト（枠囲みボックス・区切り線・Google ボタン配置）は
一切動かしていない。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual |
| ------------- | ---------------- | ------ |
| Complexity    | Medium           | Medium（計画どおり。想定外の障害なし） |
| Confidence    | —                | High（全 validation green） |
| Files Changed | 14（新規 4 / 更新 10） | 14（新規 4 / 更新 10）— 計画と完全一致 |

## Tasks Completed

| #   | Task | Status | Notes |
| --- | --- | --- | --- |
| 1 | 共有コンポーネント `DisplayNameField` を作成 | 完了 | 計画のコードそのまま |
| 2 | 共有コンポーネント `EmailPasswordFields` を作成 | 完了 | `PASSWORD_MIN_LENGTH = 6` を同居 export |
| 3 | `login-client.tsx` を共有コンポーネントへ差し替え | 完了 | `Input` / `Label` import を削除、`DISPLAY_NAME_MAX_LENGTH` は hint 内で使うため残置 |
| 4 | `receipt.ts` に `joinAsNewUser` を追加 | 完了 | `joinAsExistingUser` の直後に配置（4 経路が並ぶ） |
| 5 | `join-client.tsx` に「新規登録」タブを追加 | 完了 | 既定タブは `"guest"` のまま。ゲスト / ログインタブも共有コンポーネントへ差替 |
| 6 | 共有コンポーネントの unit test を新規作成 | 完了 | 計画の 4 + 4 に対し 4 + 6 ケース（メール欄の属性契約 2 件を追加） |
| 7 | `receipt.test.ts` / `join-client.test.tsx` を更新 | 完了 | 計画どおり 5 + 4 ケース |
| 8 | E2E と POM を更新 | 完了 | `emailTab` → `registerTab` 置換、spec 2 本更新 + 新規 1 件 |
| 9 | ドキュメント更新 | 完了 | `group-membership.md` の呼出経路を 3 → 4 に更新。PRD は `/prp-plan` 時点で更新済みだったため Phase 3 の status のみ本レポートで `complete` へ |

## Validation Results

| Level | Status | Notes |
| --- | --- | --- |
| Static Analysis | Pass | `npm run typecheck` 0 error ／ `npm run lint` 0 warning |
| Unit Tests | Pass | **1638 passed / 105 files**（Phase 2 完了時 1615 / 103 から +23 / +2 files） |
| Build | Pass | `npm run build` 成功 |
| Rules 非回帰 | Pass | `git diff --stat firestore.rules` が**空**（本 Phase は rule に触れない）／ `npm run test:rules-limits` 14/14 ALL GREEN |
| E2E（対象 2 spec） | Pass | `auto-group-join.spec.ts` **4/4** ／ `email-link-removed.spec.ts` **6/6**（計 10 passed / 59.2s） |
| E2E（全件） | Pass | **112 passed / 3 skipped（9.6m）**。skip 3 件は `note-screenshots.spec.ts` の `test.skip(!process.env.CAPTURE_SCREENSHOTS)` による pre-existing な条件 skip で、本 Phase とは無関係 |
| Format | Pass | 変更ファイルはすべて Prettier 準拠（詳細は Issues 参照） |

## Files Changed

| File | Action | Lines |
| --- | --- | --- |
| `src/components/auth/DisplayNameField.tsx` | CREATED | 65 |
| `src/components/auth/EmailPasswordFields.tsx` | CREATED | 72 |
| `src/components/auth/DisplayNameField.test.tsx` | CREATED | 54 |
| `src/components/auth/EmailPasswordFields.test.tsx` | CREATED | 67 |
| `src/lib/services/receipt.ts` | UPDATED | +33 / -0 |
| `src/lib/services/receipt.test.ts` | UPDATED | +119 / -8 |
| `src/app/join/[tid]/join-client.tsx` | UPDATED | +70 / -39 |
| `src/app/join/[tid]/join-client.test.tsx` | UPDATED | +97 / -1 |
| `src/app/login/login-client.tsx` | UPDATED | +28 / -45 |
| `tests/e2e/pages/JoinPage.ts` | UPDATED | +2 / -1 |
| `tests/e2e/email-link-removed.spec.ts` | UPDATED | +7 / -2 |
| `tests/e2e/auto-group-join.spec.ts` | UPDATED | +46 / -0 |
| `.claude/rules/group-membership.md` | UPDATED | +7 / -4 |
| `.claude/PRPs/08-auto-group-join-on-entry/prds/08-auto-group-join-on-entry.prd.md` | UPDATED | +4 / -2（Phase 3 status ／ Open Questions ／ Decisions Log は plan 時に反映済み） |

## Deviations from Plan

1. **`EmailPasswordFields.test.tsx` のケース数を 4 → 6 に増やした**
   （WHAT）計画表の 4 ケースに加えて「`passwordMinLength` 未指定 / 指定」を独立 2 ケースに分割し、
   メール欄の `type=email` / `autoComplete=email` / `required` を固定するケースを追加した。
   （WHY）`minLength` の有無は `/join` ログインタブの非回帰そのものなので、
   1 ケースに 2 つの assert を同居させるより失敗時の切り分けが速い。

2. **`email-link-removed.spec.ts` の pre-existing な Prettier 違反は修正しなかった**
   （WHAT）計画の Format 検証は `tests/e2e/**` 全体を対象にしていたが、同ディレクトリには
   本 Phase と無関係な違反が 40 ファイル分ある。本 Phase で編集した行はすべて Prettier 準拠で、
   違反箇所は自分が触っていない既存行（`async ({ page, loginPage })` の折返し）のみであることを
   diff で確認した上で据え置いた。
   （WHY）無関係ファイルの一括整形は本 Phase のスコープ外で、レビュー時のノイズになる。

3. **PRD の Open Questions / Decisions Log は `/prp-plan` 時点で更新済みだった**
   （WHAT）計画の Task 9(b) 1〜3 のうち、Open Question の `[x]` 化と Decisions Log の 2 行追加、
   Phase 3 の `in-progress` 化 + plan link は既に反映されていたため、本 Phase では
   status を `complete` に進めるのみとした。

## Issues Encountered

- **なし**（全タスクが計画どおり通り、修正が必要な失敗は発生しなかった）
- Prettier について: 新規/編集した 3 ファイル
  （`EmailPasswordFields.test.tsx` / `join-client.test.tsx` / `receipt.test.ts`）に
  整形差分が出たため `prettier --write` を適用済み。適用後に typecheck / lint / 全 unit test を
  再走行して green を確認している。

## Tests Written

| Test File | Tests | Coverage |
| --- | --- | --- |
| `src/components/auth/DisplayNameField.test.tsx` | 4 | 既定 props の label / `maxlength=15` / `required` / 既定 hint ／ label・hint の上書き ／ `onChange` が**文字列**を渡す API 契約 ／ `id` が label と input を結ぶ（`/login` の focus 制御前提） |
| `src/components/auth/EmailPasswordFields.test.tsx` | 6 | `idPrefix` からの id 生成（衝突回避）／ `autoComplete` の mode 別切替 ／ `minLength` の有無（`/join` ログインタブ非回帰）／ メール欄の属性契約 |
| `src/lib/services/receipt.test.ts`（追加分） | 5 | `joinAsNewUser` の正常系 ／ displayName の受渡 ／ **`registerWithEmail` → `upsertPlayer` → `joinGroupViaTournament` の呼出順序** ／ 登録失敗時は受付も自動所属も行わない ／ 自動所属失敗でも受付は成功（warn 1 本） |
| `src/app/join/[tid]/join-client.test.tsx`（追加分） | 4 | タブが 3 つ・既定は「ゲスト」／ 新規登録タブ送信で `joinAsNewUser` が正しい引数で 1 回 + 所属メッセージ ／ 表示名 15 字超はアカウント作成前に弾く ／ `auth/already-exists` のログインタブ誘導文言 |
| `tests/e2e/auto-group-join.spec.ts`（追加分） | 1 | 「受付画面の新規登録タブでアカウントを作ってメンバーになる」（`/login` 未経由・招待コード未使用でメンバー化 → `/groups` に出る → owner 側メンバー一覧に出る） |

**合計: 新規 20 ケース（unit 19 + E2E 1）**

## Acceptance Criteria の確認

- [x] 全タスク完了
- [x] 全 validation コマンドが pass
- [x] テストが実装と同一 commit に入る構成（コミットは `/prp-commit` で実施）
- [x] 型エラー / lint エラーなし
- [x] UX デザイン（Before/After）どおりの表示
- [x] 新規登録経路が `receiveEntry` を通ることが unit test（呼出順序）で固定されている
- [x] `/login` の DOM ラベル・`reg-name` id・見た目が等価（`email-link-removed.spec.ts` の
      `/login` 系 4 テスト ＋ `registerOrganizer` 依存の全 spec が green）
- [x] `firestore.rules` に一切変更がない
- [x] 既存テストの skip / 削除がゼロ

## レビュー指摘対応（2026-08-01）

[local-phase-3-join-register-tab-review.md](../reviews/local-phase-3-join-register-tab-review.md) の
MEDIUM 4 件を同ブランチ内で対応済み（CRITICAL / HIGH は 0 件）。

| # | 指摘 | 対応 |
| --- | --- | --- |
| M-1 | 匿名ゲスト受付済みの端末から新規登録でき、player doc が二重化する | 匿名時は「ログイン」「新規登録」タブに二重登録の警告を表示（タブ自体は残す） |
| M-2 | `DisplayNameField.autoFocus` が dead ＋ `DisplayNameDialog` が同形マークアップのまま | `DisplayNameDialog` を `DisplayNameField` へ移行（14 行 → 1 行）。`autoFocus` に実 callsite ができた |
| M-3 | アカウント作成成功 → 受付失敗で「アカウントだけ残る」案内がない | `EntryFailedAfterRegister extends AppError` を新設し、UI で復旧手順を案内 |
| M-4 | サインイン済みでもログイン / 新規登録タブが押せ、誤操作でサインアウトされる | 通常アカウントでサインイン済みならタブを畳み、ログアウト導線を案内 |

副次的な変更:

- タブ表示条件を認証状態（未サインイン / 匿名 / 通常アカウント）で分岐する設計に変更したため、
  [group-membership.md](../../../rules/group-membership.md) に
  「受付画面（`/join/[tid]`）の認証タブ表示条件」を DRIFT WARNING 付きで規約化した
- unit test を +9 追加（**1638 → 1647**）。typecheck / lint / build はいずれも Pass
- E2E はタブ表示条件に関わる 4 spec（`auto-group-join` / `email-link-removed` /
  `anonymous-flow-completion` / `anonymous-self-delete`）を実行し **13 passed / 1 skipped**。
  skip は Phase 5.1 で受け入れ済みの pre-existing な `test.skip`。全件再走行はマージ前に実施する

LOW 3 件（`upsertUserProfile` の二重書込 / `PASSWORD_MIN_LENGTH` の置き場 /
タブ widget の a11y）は記録のみで、次回 architect-refactor の候補とした。

## Next Steps

- [x] `/code-review` でレビュー — 完了（MEDIUM 4 件対応済み）
- [x] 対象 4 spec の E2E 再走行 — 13 passed / 1 skipped
- [ ] E2E 全件再走行（マージ前）
- [ ] `/prp-commit` でコミット
- [ ] Phase 4（メンバー除名 UI）は並行実装中 — 触るファイルは重複しない
- [x] Manual Validation（実機 375px 幅でのタブ 3 つの折返し確認）— **確認済み**。
      `max-w-md` × `px-3 py-2` × 3 で折り返さないことを実機幅で目視確認した
      （PRD Technical Risks「タブ数が増え受付画面が煩雑化」の解消を確認）
