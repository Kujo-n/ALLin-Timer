# Local Review: Phase 2 — `/spectate/[tid]` Read-only Page

**Reviewed**: 2026-05-09
**Author**: Kujo-n（self-review、Codex 自動レビュー前のローカル走査）
**Branch**: develop（uncommitted）
**Decision**: APPROVE with comments

## Summary

Phase 2 plan と完全に整合した実装で、CRITICAL / HIGH 指摘なし。`useAuthUser` / `useCurrentGroup` / `RequireAuth` を一切読まない設計が機械的に守られており、既存 `/live` への副作用もない（diff stat で `src/app/spectate/` 配下と docs 追記のみ）。validation 全面 green、emulator 6 種すべて回帰なし。MEDIUM 1 件 / LOW 2 件は将来 polish の候補で、merge ブロッカーではない。

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

#### M1. 3 つの useEffect で同型 `handleSubscribeError` ロジックが重複している

- **File**: [src/app/spectate/[tid]/spectate-client.tsx:50-104](../../../../src/app/spectate/%5Btid%5D/spectate-client.tsx#L50-L104)
- **Issue**: `getErrorCode(...) → logger.warn → setSpectateEnded` の 3 行ロジックが timer / players / tables の 3 個別 effect にインライン展開されており、scope 文字列以外は同一。helper 化していないため、permission-denied の判定基準を将来変えるときに 3 箇所同時修正が必要となる drift リスクがある。
- **Suggested fix（任意・現 phase merge は不要）**: コンポーネント外の純関数 `handleSpectateSubscribeError(err: AppError, scope: "tournament" | "players" | "tables", tid: string): { ended: boolean }` を切り出し、各 effect で `if (handleSpectateSubscribeError(...).ended) setSpectateEnded(true)` 形にすると DRY になる。Phase 3 / 4 に着手する際 spectate オブザーバ拡張で重複が増えそうなら同 phase で対応してもよい。
- **判断**: 現時点では plan が「3 effect 同型コピー」の形を許容しており、unit test も全 経路で green。**今回は据え置き** とし、Phase 3 で触るときに合わせて refactor する選択肢を残す。

### LOW

#### L1. `tournament.spectateEnabled !== true` guard は実用上 dead path（意図的だが明示コメント保持）

- **File**: [src/app/spectate/[tid]/spectate-client.tsx:125-135](../../../../src/app/spectate/%5Btid%5D/spectate-client.tsx#L125-L135)
- **Issue**: Phase 1 の rule で `spectateEnabled !== true` の doc は read 自体が deny されるため、UI 側の `if (tournament.spectateEnabled !== true)` 分岐に到達するケースは現在の rule 下では起きない。
- **判断**: コード内に「rule で spectateEnabled !== true の doc は read 拒否されるが、念のため UI 側も guard。」と defense-in-depth 意図を明記済みで、unit test も「false → 観戦が公開されていません」の分岐を検証している。**意図通り** で保持。Phase 3 で rule 経路を狭めた場合（review LOW-1 対応時）も、この UI guard が緩衝材として残ることで安全側に倒せる。

#### L2. UI 文言中の絵文字（⛔ / 📢）

- **File**: [src/app/spectate/[tid]/spectate-client.tsx:229, 240](../../../../src/app/spectate/%5Btid%5D/spectate-client.tsx#L229)
- **Issue**: グローバル指針「Avoid using emojis in all communication unless asked.」に対する原則的な抵触。
- **判断**: 本指針は **コードコメント / 説明文** に対する制限であり、PRD plan で明示的に要求された UI banner 文言（"📢 レイトレジ Lv N まで受付中"）は適用外と解釈する。観戦者が「急ぐべきか判断する」核となる視認性向上の意図があり、unit test の `data-testid` で identity も別経路で取れる。**意図通り** で保持。

## Validation Results

| Check                                | Result        | Notes                                                                |
| ------------------------------------ | ------------- | -------------------------------------------------------------------- |
| Type check (`tsc --noEmit`)          | Pass          | 0 errors                                                             |
| Lint (`next lint`)                   | Pass          | No ESLint warnings or errors                                         |
| Unit Tests (`vitest run`)            | Pass          | 1221/1221（new: 8 ケース for spectate-client）                       |
| Build (`next build`)                 | Pass          | `/spectate/[tid]` が dynamic route として登録（4.24 kB）             |
| Emulator: rules-spectate             | Pass          | 16/16（Phase 1 ベースライン回帰）                                    |
| Emulator: rules-limits               | Pass          | 14/14                                                                |
| Emulator: rules-clone-players        | Pass          | 7/7                                                                  |
| Emulator: rules-season               | Pass          | 12/12                                                                |
| Emulator: rules-season-points-rule   | Pass          | 11/11                                                                |
| Emulator: rules-table-labels         | Pass          | 16/16                                                                |

## Files Reviewed

| File                                                                                          | Change Type | Notes                                                              |
| --------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------ |
| `src/app/spectate/[tid]/page.tsx`                                                             | Added       | Server Component。`RequireAuth` 不使用、25 行                      |
| `src/app/spectate/[tid]/spectate-client.tsx`                                                  | Added       | Client Component。218 行 / 4 段 guard ladder / 9 要素 render       |
| `src/app/spectate/[tid]/spectate-client.test.tsx`                                             | Added       | 8 unit cases、auth 系 mock を意図的に削除（negative test）         |
| `.claude/rules/firebase-patterns.md`                                                          | Modified    | Phase 1 review LOW-3 消化（観戦経路の rule read 消費 +10 行）       |
| `.claude/PRPs/04-spectate-mode/prds/04-spectate-mode.prd.md`                                  | Modified    | Phase 2 status `in-progress` → `complete`、plan link を completed/ |
| `.claude/PRPs/04-spectate-mode/plans/completed/phase-2-spectate-readonly-page.plan.md`        | Moved       | plans/ から completed/ へ archive                                  |
| `.claude/PRPs/04-spectate-mode/reports/phase-2-spectate-readonly-page-report.md`              | Added       | implementation report                                              |

## Cross-cutting Confirmations

- **`/live` 不変原則**: `git diff --name-only HEAD` 結果に `src/app/tournaments/[tid]/live/**` が含まれていない → DOM / ロジック / test に一切触れていない（plan の Acceptance Criteria 通り）
- **PRD won't 項目**: uid 露出 / 賞金構造 / chip 量 / WinnerBanner / 「参加する」導線 を **追加していない**（仕様通り）
- **secrets / dependencies**: 新規依存追加なし、API キー等の混入なし、`.env*` 触れず
- **a11y**: 各 banner / OfflineBanner に `role="status"` / `aria-live="polite"` 配置済、TimerDisplay の `aria-label="タイマー"` を test scope に活用

## Next Steps

- [ ] Codex 自動レビューに送り、独立した第三者視点を得る
- [ ] Manual Validation（ローカル emulator + Vercel preview）で完全 unauthenticated 経路を実機確認
- [ ] `/prp-pr` で PR 作成（Codex レビューは PR 作成後に走るパイプラインの場合、ここで初めて反映される）
- [ ] M1（handleSubscribeError 重複）は Phase 3 / 4 で spectate オブザーバ拡張があれば合わせて helper 化を検討。単独 refactor はしない（YAGNI）
