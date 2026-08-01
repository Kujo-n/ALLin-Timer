# ローカルレビュー: Phase 3 — 受付画面の新規登録タブ

**Reviewed**: 2026-08-01
**Branch**: feture/auto-group-join（未コミット差分）
**PRD**: [08-auto-group-join-on-entry](../prds/08-auto-group-join-on-entry.prd.md)
**Decision**: APPROVE with comments（CRITICAL / HIGH なし。MEDIUM 4 / LOW 3）
**対応状況**: MEDIUM 4 件すべて対応済み（2026-08-01・同ブランチ内）。LOW 3 件は記録のみ

## MEDIUM 対応サマリ

| # | 指摘 | 対応 | 主な変更 |
| --- | --- | --- | --- |
| M-1 | 匿名ゲストからの新規登録で player doc が二重に作られる | 匿名時はタブを残しつつ「別の参加者として受付されます」と警告 | [join-client.tsx](../../../../src/app/join/[tid]/join-client.tsx) |
| M-2 | `DisplayNameField.autoFocus` が dead / `DisplayNameDialog` 未移行 | `DisplayNameDialog` を `DisplayNameField` へ移行して prop を生かした | [DisplayNameDialog.tsx](../../../../src/components/auth/DisplayNameDialog.tsx) |
| M-3 | アカウント作成成功 → 受付失敗で案内がない | `EntryFailedAfterRegister` を新設し、UI で復旧手順を案内 | [receipt.ts](../../../../src/lib/services/receipt.ts) / join-client.tsx |
| M-4 | サインイン済みでもログイン / 新規登録タブが押せる | 通常アカウントでサインイン済みなら両タブを畳み、ログアウト導線を案内 | join-client.tsx |

規約反映: [group-membership.md](../../../rules/group-membership.md) に
「受付画面（`/join/[tid]`）の認証タブ表示条件」を DRIFT WARNING 付きで追加。

対応後の検証: typecheck / lint / build Pass、unit **1647 passed / 105 files**（+9）。

## Summary

`/join/[tid]` に「新規登録」タブを追加し、`joinAsNewUser`（`registerWithEmail` → `receiveEntry`）として
Phase 2 の共通経路に正しく合流させている。**規約上もっとも重要な 2 点 —
「受付経路は必ず `receiveEntry` を通す」（group-membership.md の DRIFT WARNING）と
「player 作成 → 自動所属 の順序厳守」— は実装・テスト双方で担保されており**、
`invocationCallOrder` による順序 assert まで入っている点は良い。
共有コンポーネント抽出も「入力欄のみ・外側レイアウトは据え置き」という PRD 決定どおりで、
`/login` の見た目は等価（`Label` は既定で `font-medium` を持つため、削除された
`className="font-medium"` は no-op）。

指摘は主に **導線の抜け（匿名ゲストからの新規登録）** と **抽出の中途半端さ** の 2 系統で、
いずれもマージをブロックする性質ではない。

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

#### M-1. 匿名ゲスト受付済みの端末から「新規登録」タブが押せ、同一人物の player doc が二重に作られる

**該当**: [src/app/join/[tid]/join-client.tsx:321-347](../../../../src/app/join/[tid]/join-client.tsx#L321-L347) / [:404-423](../../../../src/app/join/[tid]/join-client.tsx#L404-L423)

タブ一覧はサインイン状態に関わらず常に描画される。ゲスト受付を済ませた匿名ユーザーが
`/join/[tid]` を再度開くと（QR を撮り直す・ブラウザバック等）、`status` は `null` に戻るため
「新規登録」タブが再び押せる。ここで `createUserWithEmailAndPassword` は
**匿名アカウントを link せず新規 uid を発行してセッションを差し替える**ため、

- `players/{anonUid}`（ゲスト受付分）が残ったまま
- `players/{newUid}` が追加で作られる

→ 参加者一覧に同一人物が 2 行並び、運営者が手動で片方を取り消す必要がある。
匿名 Auth ユーザーも orphan として残る（`cleanup:old-anonymous-users` 待ち）。

**既存との関係**: 「ログイン」タブでも同型の経路は成立していた（`joinAsExistingUser` も
セッションを差し替える）ため本 Phase が新規に作った欠陥ではないが、
「既存アカウントを持っている」という前提が不要になった分、**踏みやすさは上がっている**。

**提案**: `user?.isAnonymous` のときは「ログイン」「新規登録」タブに
「ゲストとして受付済みです。アカウントを作ると別の参加者として登録されます」旨の警告を出すか、
匿名セッション中は `linkWithCredential` 経路（`LinkAccountDialog` と同型）に倒す。
後者は Phase 4（除名 UI）と独立なので、別 Phase 化が妥当。

**対応済み（2026-08-01）**: 警告方式を採用。匿名ユーザーが「ログイン」「新規登録」タブを
選ぶと `role="status"` の警告ボックスを出す（「別の参加者として受付されます。ゲストで
受付済みの場合は、先に参加を取り消してください」）。タブ自体は残した — ゲスト受付者が
後からアカウントへ移行する導線を潰さないため。`linkWithCredential` への移行は別 PRD 課題として据え置き。

#### M-2. `DisplayNameField` の `autoFocus` prop が dead — 抽出が `DisplayNameDialog` まで届いていない

**該当**: [src/components/auth/DisplayNameField.tsx:20](../../../../src/components/auth/DisplayNameField.tsx#L20) / [:57](../../../../src/components/auth/DisplayNameField.tsx#L57)

`autoFocus` は `/login` からも `/join/[tid]` からも渡されておらず、現時点で到達不能な API。
一方 [DisplayNameDialog.tsx:71-81](../../../../src/components/auth/DisplayNameDialog.tsx#L71-L81) は
`Label "表示名"` + `Input required maxLength={DISPLAY_NAME_MAX_LENGTH} autoFocus` +
hint `"{15} 文字以内で入力してください。"` という **`DisplayNameField` の既定値と完全一致する**
マークアップのまま残っている。`autoFocus` prop の存在は、そこまで移行する意図があったが
やり切られていないことを示している。

同形の未移行 callsite は他に 2 箇所:

| callsite | 差分 |
| --- | --- |
| [DisplayNameDialog.tsx:71-81](../../../../src/components/auth/DisplayNameDialog.tsx#L71-L81) | 完全一致（`autoFocus` のみ追加） |
| [AddParticipantDialog.tsx:198-210](../../../../src/components/tournament/AddParticipantDialog.tsx#L198-L210) | hint 一致。`required={tab === "name"}` と `aria-label` が追加 |
| [settings-client.tsx:102-113](../../../../src/app/settings/settings-client.tsx#L102-L113) | hint のみ別文言（`hint` prop で吸収可能） |

**リスク**: `DISPLAY_NAME_MAX_LENGTH` は `firestore.rules` の `memberDisplayNames[uid].size() <= 15` と
連動する drift 対象。「`maxLength` は呼出側から変更させない」という `DisplayNameField` の
doc コメントの意図が、未移行の 3 callsite には効いていない。

**提案**: (a) 少なくとも `autoFocus` を使う予定がないなら prop ごと削除して dead API を残さない、
または (b) `DisplayNameDialog` を移行して prop を生かす。(b) が本来の意図と思われる。
`AddParticipantDialog` / `settings-client` は別 PRD 由来なので次回 architect-refactor 送りで可。

**対応済み（2026-08-01）**: (b) を採用。`DisplayNameDialog` の Label + Input + hint を
`<DisplayNameField id="dn" autoFocus />` に置換し、`Input` / `Label` / `DISPLAY_NAME_MAX_LENGTH`
の import を削除（14 行 → 1 行）。`autoFocus` は実 callsite を得たので
`DisplayNameField.test.tsx` に focus 有無 2 ケースを追加した。
`AddParticipantDialog` / `settings-client` は予定どおり次回 architect-refactor 送り。

#### M-3. アカウント作成成功 → 受付失敗のとき、Auth アカウントと `users/{uid}` だけが残る

**該当**: [src/lib/services/receipt.ts:162-183](../../../../src/lib/services/receipt.ts#L162-L183)

`joinAsNewUser` は `registerWithEmail` → `receiveEntry` の順で、`assertAcceptingEntries` は
**アカウント作成の後**に走る。レイトエントリー締切超過・`getTournament` のネットワーク失敗などで
`receiveEntry` が throw すると、

- Firebase Auth アカウント: 作成済み
- `users/{uid}`: 作成済み（`registerWithEmail` 内）
- `players/{uid}` / サークル所属: なし

という中途半端な状態でユーザーには `tournament/late-entry-closed: …` のような技術的コードが出る。

**制約**: rules が tournament read に auth を要求するため、**認証前の事前チェックは原理的に不可能**。
ゲストタブ（`signInAsGuest` → `assertAcceptingEntries`）も同じ順序なので設計上一貫している。
ただしゲストは使い捨ての匿名アカウントなのに対し、こちらは**ユーザーの実メールを消費する**点が違う。

**緩和は効いている**: 同じメールで再試行すると `auth/already-exists` 分岐が
「ログイン」タブへ誘導するため自己回復はする（[join-client.tsx:139-145](../../../../src/app/join/[tid]/join-client.tsx#L139-L145)）。

**提案**: 修正必須ではない。受付失敗時のみ「アカウントは作成されました。受付は
『ログイン』タブから再試行してください」を添える案内文を足すと迷子が減る。

**対応済み（2026-08-01）**: `receipt.ts` に `EntryFailedAfterRegister extends AppError` を新設し、
`joinAsNewUser` が `registerWithEmail` 成功後の失敗だけをこれで包むようにした
（`code` / `message` は原因エラーのものを引き継ぎ、内側で warn 済みのため再ログしない）。
UI は `instanceof` で判定して復旧案内を出す。
なお register 成功で `user` が確定すると M-4 の対応でタブが「ゲスト」だけに畳まれるため、
案内文はフォーム内ではなくカード直下に置き、文言もサインイン状態で分岐させている
（サインイン済み → 「上の『このアカウントで受付』からやり直してください」）。

#### M-4. 新規登録タブは常時表示のため、サインイン済み運営者が誤タップするとセッションが差し替わる

**該当**: [src/app/join/[tid]/join-client.tsx:321-374](../../../../src/app/join/[tid]/join-client.tsx#L321-L374)

`user && !user.isAnonymous` のとき「このアカウントで受付」ボックスが出るが、その下の
タブ一覧もそのまま表示される。`/login` はサインイン済みなら auto-redirect で退避させているのに対し、
`/join/[tid]` にはその防御がない。運営者が受付画面を開いたまま新規登録タブで登録すると、
自分のアカウントからサインアウトされる。

M-1 と同根（タブの表示条件がサインイン状態と無関係）なので、対処するなら
「サインイン済みならログイン / 新規登録タブを畳む」で 2 件同時に解消できる。

**対応済み（2026-08-01）**: 通常アカウントでサインイン済みのときは `visibleTabs` を
`["guest"]` に絞り、「ログイン」「新規登録」タブを描画しない。
「このアカウントで受付」ボックスに
「別のアカウントで受付する場合は、先にログアウトしてください。」を添えた。
`authLoading` 中は `user` が null で 3 タブが出るため、認証確定でタブが消えたときに
選択中タブを `"guest"` へ戻す `useEffect` を併せて入れている（空白パネル防止）。
ゲストタブは M-4 の指摘範囲外なので据え置き（サインイン済みユーザーのゲスト受付も
セッションを差し替えるが、既存挙動として維持）。

### LOW

#### L-1. `upsertUserProfile` が新規登録経路で 2 回走る

`registerWithEmail`（[auth-actions.ts:113-117](../../../../src/lib/services/auth-actions.ts#L113-L117)）と
`ensurePlayerCreated`（[receipt.ts:73-77](../../../../src/lib/services/receipt.ts#L73-L77)）が
同一内容で `users/{uid}` に書く。受付のクリティカルパスに 1 write 増えるだけで実害はないが、
`joinAsNewUser` の doc コメントに触れておくと次の読者が迷わない。

#### L-2. `PASSWORD_MIN_LENGTH` の置き場

[EmailPasswordFields.tsx:13](../../../../src/components/auth/EmailPasswordFields.tsx#L13) で
component module から定数を export している。「rules と連動しないので `limits.ts` に置かない」という
コメントの理由付けは妥当だが、component から定数を export する形は本リポジトリでは他に例がない。
`src/lib/limits.ts` に「rule drift check 対象外」と注記して置くほうが探しやすい（好みの範囲）。

#### L-3. タブ widget の a11y（pre-existing）

`role="tablist"` / `role="tab"` を使いながら `aria-controls` / `role="tabpanel"` がなく、
矢印キーによるタブ移動も未実装（WAI-ARIA Tabs パターン非準拠）。`/login` から続く既存実装で
本 Phase の新規欠陥ではないが、タブが 2 → 3 に増えてキーボード操作の負担がわずかに増えた。
タブボタンは `<form>` の外側に置かれているため `type="button"` 欠落による暗黙 submit は起きない（問題なし）。

## 良かった点

- **規約準拠が正確**: `receiveEntry` 経由の徹底、`ensurePlayerCreated` 直呼びの回避、
  `group-membership.md` の DRIFT WARNING を「3 経路 → 4 経路」へ同時更新している
- **順序契約をテストで固定**: `invocationCallOrder` で `registerWithEmail < upsertPlayer <
  joinGroupViaTournament` を assert（[receipt.test.ts:539-554](../../../../src/lib/services/receipt.test.ts#L539-L554)）。
  rule の `hasTournamentEntryProof` 前提が将来のリファクタで壊れたら即検知できる
- **characterization test の意図が明示的**: `DisplayNameField.test.tsx` が
  「`DISPLAY_NAME_MAX_LENGTH` を import せず `15` を literal で書く」理由（rule 側との drift 検出）を
  コメントで残しており、testing.md の思想どおり
- **E2E の待ち条件が堅い**: 新 spec が「`${GROUP_NAME} のメンバーになりました。`」を待つことで、
  `refreshGroups()` 完了＝Firestore 永続化を暗黙に同期している。その後の `/groups` フルリロード
  検証と合わせて、UI 即時反映と永続化を分けて検証できている
- **`emailTab` → `registerTab` の POM 置換**と、`email-link-removed.spec.ts` に
  「『メールリンク』タブが復活していない」assert を追加した点（新タブが旧方式の復活と誤読されない）
- `id` prefix 設計（`l-` / `r-` / `login-` / `g-` / `reg-`）により、`getByLabel` の
  strict mode 違反が起きないことを unit test で契約化している

## Validation Results

| Check      | Result | Notes |
| ---------- | ------ | ----- |
| Type check | Pass   | `npm run typecheck` — 0 error |
| Lint       | Pass   | `npm run lint` — 0 warning |
| Tests      | Pass   | `npm test` — **1638 passed / 105 files** |
| Build      | Pass   | `npm run build` 成功 |
| Rules 非回帰 | N/A  | `firestore.rules` 変更なし（本 Phase は rule に触れない）→ deploy 不要 |
| E2E        | Skipped | 本レビューでは未実行（実装レポートは 112 passed / 3 skipped を記録） |

## Files Reviewed

| File | Action |
| --- | --- |
| `src/components/auth/DisplayNameField.tsx` | Added |
| `src/components/auth/DisplayNameField.test.tsx` | Added |
| `src/components/auth/EmailPasswordFields.tsx` | Added |
| `src/components/auth/EmailPasswordFields.test.tsx` | Added |
| `src/lib/services/receipt.ts` | Modified |
| `src/lib/services/receipt.test.ts` | Modified |
| `src/app/join/[tid]/join-client.tsx` | Modified |
| `src/app/join/[tid]/join-client.test.tsx` | Modified |
| `src/app/login/login-client.tsx` | Modified |
| `tests/e2e/auto-group-join.spec.ts` | Modified |
| `tests/e2e/email-link-removed.spec.ts` | Modified |
| `tests/e2e/pages/JoinPage.ts` | Modified |
| `.claude/rules/group-membership.md` | Modified |
| `.claude/PRPs/08-auto-group-join-on-entry/prds/08-auto-group-join-on-entry.prd.md` | Modified |
| `.claude/PRPs/08-auto-group-join-on-entry/plans/completed/phase-3-join-register-tab.plan.md` | Added |
| `.claude/PRPs/08-auto-group-join-on-entry/reports/phase-3-join-register-tab-report.md` | Added |

## Next Steps

1. ~~**M-2 の `autoFocus`**~~ — 対応済み（`DisplayNameDialog` を移行）
2. ~~**M-1 / M-4**~~ — 対応済み（タブ表示条件を認証状態で分岐。規約を group-membership.md に追記）
3. ~~**M-3**~~ — 対応済み（`EntryFailedAfterRegister` + 復旧案内）
4. **L-1 / L-2 / L-3** — 記録のみ。次回 architect-refactor の候補
5. **匿名セッションの `linkWithCredential` 移行** — M-1 の根本解決。別 PRD 課題として起票する
6. **E2E 全件** — タブ表示条件に関わる 4 spec は実行して green（下表）。マージ前に全件を 1 回走らせる

## 対応後の Validation

| Check | Result |
| --- | --- |
| Type check | Pass（0 error） |
| Lint | Pass（0 warning） |
| Tests | Pass（**1647 passed / 105 files**、対応前 1638 から +9） |
| Build | Pass |
| Format | Pass（Prettier 準拠） |
| E2E（対象 4 spec） | Pass — **13 passed / 1 skipped（1.5m）**。`auto-group-join` 4/4 ／ `email-link-removed` 6/6 ／ `anonymous-flow-completion` 2/2 ／ `anonymous-self-delete` 1/1 + skip 1。skip は Phase 5.1 で受け入れ済みの pre-existing な `test.skip` |
| E2E（全件） | 未実行 — マージ前に 1 回走らせること |

### 対応で変更したファイル

| File | Action |
| --- | --- |
| `src/components/auth/DisplayNameDialog.tsx` | Modified（M-2） |
| `src/components/auth/DisplayNameField.test.tsx` | Modified（M-2・focus 2 ケース追加） |
| `src/lib/services/receipt.ts` | Modified（M-3・`EntryFailedAfterRegister` 新設） |
| `src/lib/services/receipt.test.ts` | Modified（M-3・3 ケース追加/更新） |
| `src/app/join/[tid]/join-client.tsx` | Modified（M-1 / M-3 / M-4） |
| `src/app/join/[tid]/join-client.test.tsx` | Modified（M-1 / M-3 / M-4・5 ケース追加） |
| `.claude/rules/group-membership.md` | Modified（タブ表示条件の規約化） |
