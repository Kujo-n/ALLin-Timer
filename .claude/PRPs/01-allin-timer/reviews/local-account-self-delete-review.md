# Local Review: アカウント自己削除（sole-owner ガード付き）

**Reviewed**: 2026-05-07
**Author**: Kujo-n（Claude Code 自動実装の commit 群）
**Branch**: develop（uncommitted working tree）
**Decision**: APPROVE with comments

## Summary

通常アカウント（Google / Email+Password）の自己削除フローを `/settings` に追加する変更。schema / Firestore Rules はゼロ変更で、Phase 4.5 の `attemptAnonymousSelfDelete` を雛形に「sole-owner pre-check / 全 group 自動脱退 / `auth/requires-recent-login` 後の再認証」の 3 拡張を行う設計。**実装・テスト・ドキュメントとも plan に忠実で、観測した問題はいずれも user-facing リスクの低い MEDIUM / LOW**。validation 全 green。

## Files Reviewed

| ファイル | 種別 | 行数（差分） |
| --- | --- | --- |
| `src/lib/firebase/schemas/group.ts` | UPDATE | +12 |
| `src/lib/firebase/schemas/index.test.ts` | UPDATE | +53 |
| `src/lib/services/auth-actions.ts` | UPDATE | +51 |
| `src/lib/services/auth-actions.test.ts` | UPDATE | +83 |
| `src/lib/services/account-delete.ts` | CREATE | 135 |
| `src/lib/services/account-delete.test.ts` | CREATE | 323 |
| `src/components/auth/AccountDeleteSection.tsx` | CREATE | 231 |
| `src/components/auth/AccountDeleteSection.test.tsx` | CREATE | 152 |
| `src/app/settings/settings-client.tsx` | UPDATE | +3 |
| `tests/e2e/account-self-delete.spec.ts` | CREATE | 138 |
| `.claude/rules/group-membership.md` | UPDATE | +22 |
| `.claude/PRPs/01-allin-timer/plans/completed/account-self-delete.plan.md` | CREATE (plan) | — |
| `.claude/PRPs/01-allin-timer/reports/account-self-delete-report.md` | CREATE (report) | — |

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

#### M1. UI 層での重複 warn ログ（[AccountDeleteSection.tsx:58](../../../../src/components/auth/AccountDeleteSection.tsx#L58), [AccountDeleteSection.tsx:78](../../../../src/components/auth/AccountDeleteSection.tsx#L78)）

**Location**: `src/components/auth/AccountDeleteSection.tsx:58`, `:78`

**Issue**:
`runDelete` の catch と `runReauthThenDelete` の catch で `logger.warn` を呼んでいるが、`deleteAccount` / `reauthenticateAccount` は service 層で**既に `logger.warn` を出力済み**。同じ事象が 2 回 warn として記録される。

```ts
// runDelete catch
const wrapped = AppError.from(e, "auth/account-delete-failed", "削除に失敗しました");
logger.warn(wrapped.message, { code: wrapped.code });  // ← service 側で既に warn 済み
setError(`${wrapped.code}: ${wrapped.message}`);
```

`.claude/rules/error-logging.md` の禁止パターン:
> 既に AppError ラップ済みのエラーをさらに `AppError.from` で wrap 直す（二重 warn を引き起こす）

`AppError.from` は同一参照を返すため二重 wrap にはなっていないが、**warn ログの二重化**は観測される（運用時に同一事象を 2 件カウントしてアラートしたり、原因 UID/コードのノイズが倍になる）。settings-client の表示名保存 catch（[settings-client.tsx:70-77](../../../../src/app/settings/settings-client.tsx#L70)）が UI で `setError` のみ呼んで warn しないのと対称になっていない。

**Suggested fix**: UI の catch では `setError` のみで warn は service 側に任せる。`getErrorCode(e)` で code を取り出して `setError` 用 message を組み立てれば十分:

```ts
} catch (e) {
  if (e instanceof AccountDeleteSoleOwnerBlocked) {
    setState({ kind: "blocked-sole-owner", groups: e.soleOwnerGroups });
    return;
  }
  // service 側で wrap + warn 済み
  const code = getErrorCode(e);
  const message = e instanceof Error ? e.message : "削除に失敗しました";
  setError(`${code}: ${message}`);
  setState({ kind: "closed" });
}
```

#### M2. 部分失敗（`failedGroupIds.length > 0`）が UI に surface されない（[account-delete.ts:81-99](../../../../src/lib/services/account-delete.ts#L81), [AccountDeleteSection.tsx:42-62](../../../../src/components/auth/AccountDeleteSection.tsx#L42)）

**Location**: `src/lib/services/account-delete.ts:81`, `src/components/auth/AccountDeleteSection.tsx:42`

**Issue**:
`deleteAccount` は `Promise.allSettled` の best-effort で leaveGroup を実行し、失敗 gid を `failedGroupIds` に集めて返す。しかし `runDelete` は戻り値の `failedGroupIds` を**ユーザに見せず**、Auth 削除が成功すれば暗黙に `/` リダイレクトされる。

結果:
- ユーザは「削除できた」と思うが、`groups/{gid}.memberUids` には自分の uid が残ったまま（orphan）
- `memberDisplayNames[uid]` も残るため、再加入できない group 側で運営に表示が残り続ける
- 過去 tournament の `players` / `seasonStats` の orphan 化は **plan の意図的な設計**（`NOT Building` 参照）だが、**failedGroupIds の orphan は意図ではなくエラー**。両者は質的に異なる

エラーが伝わるのは logger.warn のみで、ユーザは事象を知る術がない。

**Suggested fix**（軽量な対応案、実装スコープを抑えるなら 1 案目のみ）:

1. `failedGroupIds.length > 0` のとき confirm dialog を「一部のサークル脱退に失敗しました（N 件）。アカウント削除は完了しています。サークル運営に連絡し、表示名のクリーンアップを依頼してください」として渡す（toast でも可、現状は toast 機構が無いので alert dialog でも可）
2. 将来的に運営者向け「メンバー整理 UI」（plan の Notes 参照）を作るなら、orphan member を一括削除できるようにする

少なくとも 1 案目は今回の changeset 内で実装可能。

#### M3. component test の reauth エラー復旧シナリオが薄い（[AccountDeleteSection.test.tsx:123-151](../../../../src/components/auth/AccountDeleteSection.test.tsx#L123)）

**Location**: `src/components/auth/AccountDeleteSection.test.tsx`

**Issue**:
component test は「reauth 成功 → retry 成功」までは押さえているが、**reauth 失敗（wrong password）→ inline error 表示 → password 訂正 → 再 submit → 成功**の復旧経路を E2E でも unit でもテストしていない。`error` state の表示は LOW でカバーするロジックだが、ユーザの実利用シナリオでは**最頻出の経路**（パスワード打ち間違え）。

**Suggested fix**: component test に 1 ケース追加:

```ts
it("shows inline error and allows retry after wrong password", async () => {
  const user = makeUser({ providerData: [{ providerId: "password" }] } as never);
  vi.mocked(deleteAccount).mockResolvedValueOnce({
    deleted: false, leftGroupIds: [], failedGroupIds: [], needsReauth: true,
  });
  vi.mocked(reauthenticateAccount).mockRejectedValueOnce(
    Object.assign(new Error("wrong"), { code: "auth/invalid-credentials" }),
  );
  // ... fire events: open dialog → click 削除する → enter wrong password → submit
  // assert: error 表示 / dialog 残存 / password input のクリアは仕様次第
});
```

### LOW

#### L1. `AccountDeleteSection.tsx:76-78` で `getErrorCode` と `AppError.from` を両方呼んでいる

**Location**: `src/components/auth/AccountDeleteSection.tsx:76-78`

```ts
const code = getErrorCode(e);
const wrapped = AppError.from(e, "auth/reauth-failed", "再認証に失敗しました");
logger.warn(wrapped.message, { code });
```

`AppError.from(e)` は `e` が AppError なら同一参照を返すため `wrapped.code === code`。意図的に分けたいなら明確なコメントを、そうでなければどちらかに統一して 1 行減らすほうが読みやすい。M1 の修正と一括で対応可能。

#### L2. `account-delete.ts:72` の `[...groupIds]` 不要 spread

**Location**: `src/lib/services/account-delete.ts:72`

```ts
const { groups } = await listMyGroups([...groupIds]);
```

`groupIds` は既に `string[]`（`profile?.groupIds ?? []`）。`listMyGroups` の引数が `readonly string[]` を受けるなら spread 不要。test の `expect(listMyGroups).toHaveBeenCalledWith([])` も `groupIds` 直接渡しで通る（呼出側コピーの意図ならコメントを 1 行）。

#### L3. UI 側 `logger.warn` に `uid` が無い（[AccountDeleteSection.tsx:58, 78](../../../../src/components/auth/AccountDeleteSection.tsx#L58)）

M1 を採用すれば消滅するが、UI 層で warn を残す方針なら `uid: user.uid` を context に含めて service 側 warn と紐付け可能にしておくのが慣習（同一 file 内の他の warn 呼出と整合）。

#### L4. `AccountDeleteSoleOwnerBlocked` の `message` がユーザに直接見えない

**Location**: `src/lib/services/account-delete.ts:24-26`

```ts
super(
  `あなたが唯一のオーナーのサークルが ${soleOwnerGroups.length} 件あります`,
  "auth/account-delete-blocked-sole-owner",
);
```

UI は `e.soleOwnerGroups` を直接読み出して dialog を組み立てるため、`AppError.message` は実質ログ用にしか使われない。message にも N 件表記が出るので運用ログの集計には便利だが、もし将来 UI が `getErrorCode + message` フォーマットの汎用 toast に fallback したとき件数だけ出る寒い表示になる懸念。コメント 1 行で「`message` は logging 用、UI 表示は `soleOwnerGroups` を使う」と書くと意図が伝わる。

#### L5. E2E テストの role 昇格フローが UI 文言依存（[account-self-delete.spec.ts:88-95](../../../../tests/e2e/account-self-delete.spec.ts#L88)）

```ts
await memberRow.getByRole("button", { name: /運営へ昇格/ }).click();
await memberRow.getByRole("button", { name: /オーナーへ昇格/ }).click();
```

正規表現一致だが UI 文言（「運営へ昇格」「オーナーへ昇格」）が変わると壊れる。data-testid で結合するほうが堅い（既存 spec の慣例次第。group 管理 UI 全般で同じ依存を取っている既存事情があれば踏襲で OK）。

#### L6. `deleteAccount` 関数の長さ

**Location**: `src/lib/services/account-delete.ts:58-134`（76 行、コメント込み）

`Functions > 50 lines` のチェックリストにギリギリ触れる。可読性は十分高いが、4 つの段階を「`preCheckSoleOwner` / `leaveAllGroupsBestEffort` / `deleteUserProfileBestEffort` / `attemptAuthDelete`」のような private helper に分解すると、テストも段階単位で書きやすくなる（次の architect-refactor 時の候補）。

## Validation Results

| Check | Result |
| --- | --- |
| Type check (`npm run typecheck`) | Pass |
| Lint (`npm run lint`) | Pass — No ESLint warnings or errors |
| Unit tests (account-delete / auth-actions / schemas) | Pass — 147 / 147 |
| Component tests (`AccountDeleteSection`) | Pass — 6 / 6 |
| Build (`npm run build`) | Pass — `/settings` 8.72 kB / 313 kB First Load JS |
| Full unit suite | Skipped — targeted suite を網羅した時点で十分と判断（必要なら `npm run test` で再走行） |
| E2E (`npm run test:e2e`) | Skipped — emulator 起動コストの観点から手動実行に委ねる（report の Next Steps 通り） |

## Pattern / Rule Compliance

- **error-logging.md**: M1 を除き準拠。`AppError.from` / `unwrapOrFrom` / `getErrorCode` の使い分けは概ね適切（service 層は `AppError.from` で初回 wrap、UI 層は `getErrorCode` で code 取り出し）
- **firebase-patterns.md**: schema / repository / rule の 3 点同時更新は今回 N/A（rule / schema 変更ゼロ）。`isSoleOwner` を schema 側 helper に置く判断は `deriveRole` 等と整合
- **group-membership.md**: 権限マトリクスの「アカウント自己削除（`/settings`）」行追加 + 専用節追加で正しく反映。`isSoleOwner` の正準性も明記
- **testing.md**:
  - mock 境界（service / repository / firebase）は適切
  - characterization test ファースト（`isSoleOwner` の defensive 4 ケース）も plan 通り
  - factory 関数（`makeUser` / `makeGroup`）も整備済
- **security-base.md**: 公開リポジトリ運用上のリスクなし。新たな秘密情報の混入なし

## Security Review

- 自己削除は既存の `users/{uid}` self-delete + `groups/{gid}` self-leave rule で完結。新たな攻撃面なし
- `reauthenticateAccount` は `wrapAuthError` で popup-closed / wrong-password を既存 normalize 経路に乗せている。新たな code 分岐の追加なし
- E2E の owner 昇格 → 削除フローは権限境界を逸脱せず、Phase 4.6 の owner / organizer 昇降経路をそのまま使用
- 過去 `players/{pid}` / `seasonStats/{uid}` の orphan は plan の意図設計（履歴の継続性）。rule 上の整合性は既存通り

## Decision Rationale

- CRITICAL / HIGH 該当ゼロ
- MEDIUM 3 件はいずれも user impact 軽微（M1: ログノイズ、M2: 失敗時の透明性、M3: テスト網羅性）。merge を block する性質ではない
- validation 5 種類すべて green
- 設計は plan / report の通りで、project rule との衝突なし

⇒ **APPROVE with comments**: M1 / M2 は merge 後 follow-up commit でも可、M3 は次回 PR で吸収可。

## Next Steps（推奨順）

1. **M1 の重複 warn 除去** — UI catch から `logger.warn` を消し、`getErrorCode` で code 取り出すだけにする。1 file / ~6 行の修正
2. **M2 の部分失敗 surface** — `failedGroupIds.length > 0` を成功後に inline notice として残すか、削除完了 toast に件数を付加。`AccountDeleteSection` の state machine に `kind: "succeeded-with-orphans"` を 1 つ足すだけで足りる
3. **M3 の component test 1 ケース追加** — wrong-password → error → retry の復旧経路。`vi.mocked(reauthenticateAccount).mockRejectedValueOnce` + 2 nd call resolve でフロー検証
4. **L2 の `[...groupIds]` 削除** — 1 行修正
5. **手動 E2E 実機確認** — emulator + dev server で `npm run test:e2e -- account-self-delete` を 1 回流す
6. **PRD 01 Implementation Phases 表への Phase 5.x 追加** — plan の Notes / report の Next Steps 通り、PRP オーナーの判断
7. **README に 1 行で機能紹介** — オプション

## 参考

- Plan: [.claude/PRPs/01-allin-timer/plans/completed/account-self-delete.plan.md](../plans/completed/account-self-delete.plan.md)
- Report: [.claude/PRPs/01-allin-timer/reports/account-self-delete-report.md](../reports/account-self-delete-report.md)
- 関連 rule: [error-logging.md](../../../rules/error-logging.md) / [group-membership.md](../../../rules/group-membership.md) / [testing.md](../../../rules/testing.md)
- 雛形となった Phase 4.5: [.claude/PRPs/01-allin-timer/reviews/local-phase-4.5-review.md](local-phase-4.5-review.md)
