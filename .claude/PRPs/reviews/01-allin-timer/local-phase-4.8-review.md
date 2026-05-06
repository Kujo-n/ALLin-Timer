# Local Review: Phase 4.8 — Structure Template Library + E2E

**Reviewed**: 2026-04-23
**Scope**: uncommitted changes on `develop`（Phase 4.8 実装一式 + 追加した E2E）
**Decision**: **APPROVE with comments**（MEDIUM × 2 / LOW × 5、CRITICAL / HIGH なし）

## Summary

Phase 4.8 の「ストラクチャテンプレート図書館」実装は Firestore rules / zod schema / repositories / UI / hook / tests すべてで既存規約（firebase-patterns / error-logging / security）を踏襲しており、型安全・エラー伝播・rule の deny-by-default も守られている。追加した E2E 5 シナリオ（[structure-templates.spec.ts](../../../tests/e2e/structure-templates.spec.ts)）も 33s で全 pass。merge を止める CRITICAL / HIGH は見当たらず。以下の MEDIUM / LOW は follow-up として拾えると望ましい。

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

#### M1. `isTemplateAdmin` の catch ログが error message を捨てている — **RESOLVED**

[src/lib/firebase/repositories/templateAdmins.ts:22-26](../../../src/lib/firebase/repositories/templateAdmins.ts#L22-L26)

```ts
} catch (e) {
  void e;
  logger.warn("isTemplateAdmin check failed", { code: "firestore/read_failed", uid });
  return false;
}
```

rule deny（非管理者の想定挙動）と実エラー（network / offline / 未知の permission エラー）が区別できない。本番でトラブルが起きたとき「管理者だったのに admin UI が出ない」という問い合わせに対して切り分け困難。`message: e instanceof Error ? e.message : String(e)` を log に含める推奨。

**対応**: catch 節で `message` を抽出し logger.warn 引数に追加。`void e` を廃止。ユニットテスト 7/7 pass。log 出力例: `{ code: 'firestore/read_failed', uid: '...', message: 'permission-denied' }` — rule deny と実エラーが message 値で切り分け可能に。

#### M2. `structureTemplates` の `allow read: if isSignedIn()` が匿名ユーザーも許容 — **RESOLVED**

[firestore.rules:209](../../../firestore.rules#L209)

UI は `RequireAuth`（`allowAnonymous=false` default）で匿名を拒否するが、SDK 直叩きなら匿名でも全テンプレ一覧を取得できる。security.md の「テンプレ作成は匿名不可（`createdByDisplayName` 信頼性）」とは非対称。現状テンプレ本文に機密は載らない想定なので即時 HIGH ではないが、テンプレ `description` にサークル固有事情が書かれる運用が発生した場合リスク化する。

**対応**: `isSignedInNotAnon()` helper（`token.firebase.sign_in_provider != 'anonymous'`）を追加し、`structureTemplates` の `read` / `create` に適用。security.md のテンプレート管理者 section を「テンプレート図書館」にリネームし、匿名除外の根拠とセットで明記。E2E 5 シナリオ再走で通常アカウント経路の regression なしを確認済み（31.5s / all pass）。

### LOW

#### L1. `useIsTemplateAdmin` の loading 中は管理者の削除ボタンが非表示

[src/app/templates/templates-client.tsx:110](../../../src/app/templates/templates-client.tsx#L110)

`canDelete={isOwner || isAdmin}` は `useIsTemplateAdmin` の初期値 `{isAdmin:false, loading:true}` を反映して、admin が他人テンプレを開いた瞬間は 削除 ボタンが出ず、取得完了でフラッシュして表示される。UX としては許容範囲。気になる場合は loading 中を skeleton / `disabled` で表現する。

#### L2. `createStructureTemplate` で `description` の null 正規化が 2 重

[src/lib/firebase/repositories/structureTemplates.ts:33](../../../src/lib/firebase/repositories/structureTemplates.ts#L33) と [src/lib/firebase/schemas/structureTemplate.ts:17](../../../src/lib/firebase/schemas/structureTemplate.ts#L17) の `.default("")` で二重に default 処理している。どちらも null-safe に効くので害はないが、repository 側 or schema 側のどちらかに寄せると意図が明確。

#### L3. `StructureTemplateCard` の `createdByDisplayName` は XSS 安全だが長さ未制限

[src/lib/firebase/schemas/structureTemplate.ts:24](../../../src/lib/firebase/schemas/structureTemplate.ts#L24) は `min(1)` のみで max 未設定。Phase 4.7 の `users/{uid}` 側で 15 文字制限されているが、テンプレ rule は `createdByDisplayName is string && size() > 0` だけで length 上限なし。悪意ある API 直叩きで 10KB の displayName を書き込める。レイアウト崩れ / Firestore cost 増の blast radius は低い。rule で `size() <= 15` を追加すると堅牢。

#### L4. E2E test 4 は UI-level のみで rule 拒否は検証していない

[tests/e2e/structure-templates.spec.ts:97-127](../../../tests/e2e/structure-templates.spec.ts#L97-L127)

userB が他人テンプレの 編集 / 削除 ボタンが見えないことを確認するが、rule で updateDoc / deleteDoc が拒否される経路は E2E 対象外。rule 側の検証は emulator rule test（将来導入）か 手動の Security Rules playground で補完する前提。コメントに「UI-level gate の検証」と明記すると意図が伝わる（今回は付けていないので follow-up）。

#### L5. `structureTemplates` rule `allow update` の immutable チェックが fields 列挙型

[firestore.rules:214-219](../../../firestore.rules#L214-L219)

`createdByUid` / `createdByDisplayName` / `createdAt` 以外は任意に追加 / 変更可能。zod converter の `structureTemplateBodySchema` を通れば拒否されるが、rule 単体では open。`structures/{sid}` も同等の設計で一貫しているため、本 Phase で追加対策は不要。将来「rule で完結する strict invariants」が必要になった場合に見直す対象。

## Validation Results

| Check             | Result                                                                 |
| ----------------- | ---------------------------------------------------------------------- |
| Type check        | [done] Pass — `tsc --noEmit` 0 errors                                  |
| Lint              | [done] Pass — `next lint` 0 warnings / errors                          |
| Unit Tests        | [done] Pass — 400 tests / 23 files                                     |
| E2E (Phase 4.8)   | [done] Pass — 5/5 (`structure-templates.spec.ts` 33s / chromium, 1 worker) |
| Build             | [skip] not re-run（本実装レポートで 21 route 生成成功を確認済）        |

## Files Reviewed

**Created (Phase 4.8)**
- `src/lib/firebase/schemas/structureTemplate.ts`
- `src/lib/firebase/schemas/templateAdmin.ts`
- `src/lib/firebase/repositories/structureTemplates.ts` + test
- `src/lib/firebase/repositories/templateAdmins.ts` + test
- `src/lib/hooks/useIsTemplateAdmin.ts` + test
- `src/components/structure/StructureTemplateCard.tsx` + test
- `src/components/structure/StructureTemplatePicker.tsx`
- `src/app/templates/page.tsx` / `templates-client.tsx`
- `src/app/templates/new/page.tsx` / `template-new-client.tsx`
- `src/app/templates/[tid]/edit/page.tsx` / `template-edit-client.tsx`

**Modified**
- `firestore.rules` — `isTemplateAdmin()` helper + `structureTemplates` / `templateAdmins` match blocks
- `src/components/structure/StructureForm.tsx` — `mode` discriminated union, `StructureFormSubmitInput` export
- `src/app/structures/new/structure-new-client.tsx` — picker 差込 + form `key` bump
- `src/app/structures/[sid]/edit/structure-edit-client.tsx` — 新 submit 型 + rebuy/addOn の update patch 含意
- `src/lib/firebase/schemas/index.test.ts` — new schema tests (+12)
- `README.md` / `.claude/rules/security.md` — bootstrap 手順と規約
- `.claude/PRPs/prds/allin-timer.prd.md` — Phase 4.8 status 更新

**Created (E2E, 本レビュー対象)**
- `tests/e2e/structure-templates.spec.ts`
- `tests/e2e/fixtures/flows.ts` — `createTemplateViaUI` 追加

## Next Steps

1. M1 の log 詳細化（1 行 diff、debug 容易化）
2. M2 / L3 は Phase 4.8 に含めず、security.md / README に「rule 上の緩さ」として明記を検討
3. L4 に沿って spec の該当テストにコメントを追記（任意）
