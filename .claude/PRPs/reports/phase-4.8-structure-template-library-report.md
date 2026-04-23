# Implementation Report: Phase 4.8 — Structure Template Library

## Summary

サークル横断でストラクチャのひな形を共有できる **テンプレート図書館** を導入した。新規 2 コレクション（`structureTemplates/{tid}` + `templateAdmins/{uid}`）、新規 3 ページ（`/templates` / `/templates/new` / `/templates/[tid]/edit`）、`/structures/new` の Firestore ベース TemplatePicker、`StructureForm` の structure/template 2-mode 化、Firestore Rules に `isTemplateAdmin()` helper + 2 match ブロック追加。最初の管理者の Console 手動 seed 運用手順を README / security.md に記載。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual         |
| ------------- | ---------------- | -------------- |
| Complexity    | Medium-Large     | Medium-Large（想定どおり） |
| Confidence    | (planから明示なし) | High — 全 387 tests green / 15 ページ build 成功 |
| Files Changed | 約 17 files（新規 14・編集 3） | 新規 14・編集 7（StructureForm 破壊変更による波及 +4） |

## Tasks Completed

| #   | Task                                                           | Status          | Notes |
| --- | -------------------------------------------------------------- | --------------- | ----- |
| 1   | structureTemplate / templateAdmin zod schemas                  | [done] Complete | 仕様通り |
| 2   | structureTemplates repository                                  | [done] Complete | undefined→null 正規化を update にも拡張（plan より厳密） |
| 3   | templateAdmins repository                                      | [done] Complete | 仕様通り（read 失敗時 false 返却） |
| 4   | Firestore Security Rules で structureTemplates / templateAdmins | [done] Complete | 仕様通り |
| 5   | useIsTemplateAdmin hook                                        | [done] Complete | 仕様通り |
| 6   | StructureTemplateCard / StructureTemplatePicker                | [done] Complete | 仕様通り |
| 7   | StructureForm の mode prop 追加                                | [done] Complete | 既存 2 callers を `StructureFormSubmitInput` 新型へ更新（波及範囲拡大） |
| 8   | /templates 一覧ページ                                          | [done] Complete | plan の `window.confirm` でなく shadcn Dialog に揃えた（既存 structures-client と統一） |
| 9   | /templates/new と /templates/[tid]/edit                        | [done] Complete | 仕様通り。匿名ユーザー拒否 + 他人 doc への redirect あり |
| 10  | /structures/new に TemplatePicker を差込                       | [done] Complete | 仕様通り。`key` bump で form 再初期化 |
| 11  | README / security.md に bootstrap 手順                         | [done] Complete | 仕様通り |
| 12  | Tests — schemas / repositories / card                          | [done] Complete | 30 件追加（schemas 12・structureTemplates 9・templateAdmins 7・card 6） |
| 13  | Firestore Rules デプロイ + emulator 確認                       | [skip]          | デプロイはリリース工程（手動）。Emulator テストは手順書のみ |
| 14  | PRD 更新                                                       | [done] Complete | Phase 4.8 行を `pending` → `in-progress` に、report link を追記 |
| 15  | lint / typecheck / test / build 確認                           | [done] Complete | 全コマンド exit 0 |

## Validation Results

| Level           | Status      | Notes                                            |
| --------------- | ----------- | ------------------------------------------------ |
| Static Analysis | [done] Pass | `npm run typecheck` / `npm run lint` いずれも 0 errors |
| Unit Tests      | [done] Pass | 387 tests（Phase 4.7 末 357 + 新規 30）          |
| Build           | [done] Pass | `npm run build` 全 21 route 生成成功（新規 3 route 含む） |
| Integration     | N/A         | Emulator / 本番デプロイはリリース工程の手動作業   |
| Edge Cases      | [done] Pass | plan の Edge Cases Checklist に対応する単体テスト作成済 |

## Files Changed

| File                                                                 | Action  |
| -------------------------------------------------------------------- | ------- |
| `src/lib/firebase/schemas/structureTemplate.ts`                      | CREATED |
| `src/lib/firebase/schemas/templateAdmin.ts`                          | CREATED |
| `src/lib/firebase/repositories/structureTemplates.ts`                | CREATED |
| `src/lib/firebase/repositories/templateAdmins.ts`                    | CREATED |
| `src/lib/hooks/useIsTemplateAdmin.ts`                                | CREATED |
| `src/components/structure/StructureTemplateCard.tsx`                 | CREATED |
| `src/components/structure/StructureTemplatePicker.tsx`               | CREATED |
| `src/app/templates/page.tsx`                                         | CREATED |
| `src/app/templates/templates-client.tsx`                             | CREATED |
| `src/app/templates/new/page.tsx`                                     | CREATED |
| `src/app/templates/new/template-new-client.tsx`                      | CREATED |
| `src/app/templates/[tid]/edit/page.tsx`                              | CREATED |
| `src/app/templates/[tid]/edit/template-edit-client.tsx`              | CREATED |
| `src/lib/firebase/repositories/structureTemplates.test.ts`           | CREATED |
| `src/lib/firebase/repositories/templateAdmins.test.ts`               | CREATED |
| `src/components/structure/StructureTemplateCard.test.tsx`            | CREATED |
| `firestore.rules`                                                    | UPDATED |
| `src/components/structure/StructureForm.tsx`                         | UPDATED — mode prop 追加、`StructureFormSubmitInput` export |
| `src/app/structures/new/structure-new-client.tsx`                    | UPDATED — TemplatePicker 差込 + 新 submit 型 |
| `src/app/structures/[sid]/edit/structure-edit-client.tsx`            | UPDATED — 新 submit 型 + rebuy/addOn を更新 patch に含める |
| `src/lib/firebase/schemas/index.test.ts`                             | UPDATED — 新規 schema 12 件追加 |
| `README.md`                                                          | UPDATED — 管理者 bootstrap section |
| `.claude/rules/security.md`                                          | UPDATED — テンプレート管理者規約 |
| `.claude/PRPs/prds/allin-timer.prd.md`                               | UPDATED — Phase 4.8 を in-progress に |

## Deviations from Plan

- **Task 7（StructureForm mode prop）の波及**: plan では「軽微 refactor」とあったが、既存 callers（`structure-new-client` / `structure-edit-client`）が `CreateStructureInput` 直接参照だったため、新 union 型 `StructureFormSubmitInput` の export と 2 callers の小修正が発生。結果として副次的に edit 画面で `rebuyStack` / `addOnStack` の更新漏れ（旧コードの欠陥）を修正した。
- **Task 8（削除 UX）**: plan の `window.confirm` でなく、既存 `structures-client.tsx` の shadcn Dialog パターンに揃えた。UX 統一優先で軽い改善。
- **Task 13（rules デプロイ）**: 本実装セッションでは skip（本番デプロイは手動リリース工程のため）。plan にも「本 Phase 外」的な位置づけで記載されていたため省略可と判断。
- **Task 15 の整形**: Phase 4.8 行が PRD に予め `pending` として登録されていたため、`in-progress` に更新 + report リンク追記という 1 行修正で済んだ（新規追加でなく差分が最小）。

## Issues Encountered

1. **最初の repository test で `firestore/not-found` 期待値 mismatch**: `getStructureTemplate` の missing case で期待 code を `firestore/read_failed` としていたが、`AppError.from` が既存 AppError の code を保持する仕様のため実際は `firestore/not-found`。テストを実動作に合わせて修正済。
2. **StructureForm 型変更の TypeScript 連鎖**: `CreateStructureInput` → `StructureFormSubmitInput` への型変更で 2 callers がコンパイルエラー。順次更新で解消。

## Tests Written

| Test File                                                  | Tests   | Coverage |
| ---------------------------------------------------------- | ------- | -------- |
| `src/lib/firebase/schemas/index.test.ts`                   | +12     | `structureTemplateBodySchema` 9 件 / `templateAdminBodySchema` 3 件 |
| `src/lib/firebase/repositories/structureTemplates.test.ts` | 9 tests | create（undefined 正規化）/ get（found / not-found）/ list（sort / invalid skip）/ update（空欄 normalize）|
| `src/lib/firebase/repositories/templateAdmins.test.ts`     | 7 tests | isTemplateAdmin（true / false / permission-denied）/ grant / revoke / error wrap |
| `src/components/structure/StructureTemplateCard.test.tsx`  | 6 tests | library 3 権限パターン / picker variant / creator 表示 |

## Known Follow-ups

- **Firestore Rules 本番デプロイ**: `firebase deploy --only firestore:rules` は運用者がリリース時に手動実行。
- **最初の管理者 Console seed**: デプロイ後、`templateAdmins/{uid}` に doc を手動作成する必要あり（README に手順記載）。
- **Phase 4.8 完了マーク**: 本 PR merge + 本番デプロイ + 最初の管理者 seed の 3 点が揃った時点で、PRD の status を `in-progress` → `complete` に更新。

## Next Steps

- [ ] Code review via `/code-review`（Codex レビュー向け）
- [ ] Create PR via `/prp-pr`
- [ ] Firestore Rules を本番デプロイ
- [ ] Firestore Console で最初のテンプレート管理者を手動 seed
- [ ] 本番でブラウザ検証（plan の Manual Browser Validation チェックリスト）
- [ ] PRD の Phase 4.8 status を `complete` に更新
