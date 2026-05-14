# Architect Refactor Audit — 20260514

## Scope

PRD `05-post-launch-polish` 完了直後（Track D Phase D.1 = テーマ切替まで反映済み、ベースラインコミット `0717eaf`）の `src/` 全域を、Senior Web Architect + Security Specialist の 2 レンズで再監査する。

- ベースブランチ: `develop`（baseline `0717eaf`）
- 作業ブランチ: `refactor/architect-refactor-20260514`
- 所属 PRD: `05-post-launch-polish`（Track D Phase D.1 follow-up）
- 前回 architect-refactor: `20260512`（PRD 05 Phase A.1〜A.3 follow-up）

## ベースライン

| 項目 | Baseline |
| --- | --- |
| typecheck | ✅ pass |
| lint | ✅ pass |
| unit test | ✅ 87 files / 1412 tests |
| build | ✅ pass |
| e2e | ⏸ 最終 Phase 5 で実走行（直近 20260512 で全 green を確認済み、Track D は spec を追加済み） |

## 監査観察

### Track D Phase D.1（テーマ切替）固有の確認

| ファイル | 観察 | 判断 |
| --- | --- | --- |
| `src/lib/services/theme-storage.ts` | `AppError.from` + `logger.warn` + SSR-safe `typeof window === "undefined"`。`code: "theme/storage-failed"` / `theme/invalid-value` は error-logging.md に登録済み | ✅ クリーン |
| `src/lib/services/theme.tsx` | `system` のみ `matchMedia` listen、明示選択時に listener attach しない設計で意思上書き予防。`applyHtmlClass` idempotent | ✅ クリーン |
| `src/components/theme/ThemeToggle.tsx` | WAI-ARIA radiogroup、各 button に `role="radio"` / `aria-checked` / `aria-label` | ✅ クリーン |
| `src/components/qr/ThemedQRCode.tsx` | dark の `hsl(...)` を globals.css と連動、DRIFT WARNING コメント付き | ✅ クリーン |
| `src/app/layout.tsx` の `themeBootstrap` inline script | user-controlled data 無し、try/catch でストレージ例外を握る、`<html suppressHydrationWarning>` 併用 | ✅ クリーン |

Track D 由来の新規 finding は無い。

### 横断的観察

| 観察 | 評価 |
| --- | --- |
| `console.*` 直呼び（logger 経由以外） | 0 件（test 内の `console.error` 抑制スパイ 1 件を除く） |
| `tournament.state === "..."` 直接比較 | `tournament-state.ts` 内部のみ（前回 20260512 finding-4 の継続維持） |
| `memberDisplayNames[uid]` 直接書込 | repository / schema / service 経由のみ |
| 数値リミット定数 | `limits.ts` / `schemas/group.ts` の DISPLAY_NAME_MAX_LENGTH 連動を維持 |

### 新規 / 継承 findings

---

### finding-1: clipboard copy + copied flash の 3 箇所重複（MEDIUM）

- Lens: architect (DRY / KISS)
- Severity: medium
- 場所:
  - [src/components/qr/QrPanel.tsx:23-42](../../../../src/components/qr/QrPanel.tsx#L23-L42)
  - [src/app/groups/[gid]/_components/InviteCodeCard.tsx:38-57](../../../../src/app/groups/[gid]/_components/InviteCodeCard.tsx#L38-L57)
  - [src/components/tournament/SpectateModeCard.tsx:58-110](../../../../src/components/tournament/SpectateModeCard.tsx#L58-L110)（`copied` / `onCopy` 部分）
- 観察事実: `const [copied, setCopied] = useState(false);` + `try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(..., 2000); } catch (e) { logger.warn("clipboard copy failed", { code: "clipboard/unavailable", message: ... }); }` の 14〜20 行ブロックが完全同形で 3 callsite。
- 影響: clipboard 失敗時の UX / log code を変更したい場合 3 箇所同時更新。code 文字列 `"clipboard/unavailable"` の drift リスク。
- 案: `lib/hooks/useClipboardCopy.ts` に `useClipboardCopy(value: string | null, options?: { autoResetMs?: number; onError?: (message: string) => void })` を新設。`{ copied: boolean; copy: () => Promise<void> }` を返す。失敗時は内部で `AppError.from(e, "clipboard/unavailable", "クリップボードにコピーできませんでした")` を作って `logger.warn` し、`onError` には `formatErrorForDisplay(wrapped)` を渡す。
- テスト保護: `useClipboardCopy.test.ts` を `renderHook` で先行投入（success / fail / auto-reset / SSR 不在の 4 ケース）→ 各 callsite を hook 経由化。
- リスク: 既存 `SpectateModeCard` の onError 文字列 `"clipboard/unavailable: クリップボードにコピーできませんでした"` は `formatErrorForDisplay` 経由でも同等の表示（`<code>: <msg>` 形式）になることを test で固定。

### finding-2: QR 描画 wrapper の 3 箇所重複（LOW）

- Lens: architect (DRY)
- Severity: low
- 場所:
  - [src/components/qr/QrPanel.tsx:58](../../../../src/components/qr/QrPanel.tsx#L58)
  - [src/app/groups/[gid]/_components/InviteCodeCard.tsx:82](../../../../src/app/groups/[gid]/_components/InviteCodeCard.tsx#L82)
  - [src/components/tournament/SpectateModeCard.tsx:161](../../../../src/components/tournament/SpectateModeCard.tsx#L161)
- 観察事実: `<div className="flex justify-center rounded-md border bg-card p-4">` で `<ThemedQRCode>` を囲む形が 3 callsite。`bg-card` は globals.css の `--card` トークン、`p-4` は QR 内部の `marginSize={4}` と二重防御として説明済み。
- 影響: 統一感のあるテーマ追従 QR 表現を後から変える場合 3 箇所変更。
- 案: `ThemedQRCode` に `framed?: boolean`（default `true`）prop を追加し、`true` のとき同 wrapper を内部で描画。3 callsite で wrapper を削除して `<ThemedQRCode value={url} size={...} aria-label={...} />` のみに。
- テスト保護: `ThemedQRCode.test.tsx` で `framed=true` のときの wrapper class、`framed=false` のときの素描画を assert。
- リスク: ThemedQRCode を消費する箇所が 3 callsite のみで影響面が確定済み。build と既存 E2E（card-background / spectate-mode / theme-toggle）が green であれば動作同値性は担保。

### finding-3: `dashboard-client.tsx` の `onTogglePd` 重複（LOW）

- Lens: architect (DRY)
- Severity: low
- 場所: [src/app/tournaments/[tid]/dashboard-client.tsx:492-502](../../../../src/app/tournaments/[tid]/dashboard-client.tsx#L492-L502) と [:514-528](../../../../src/app/tournaments/[tid]/dashboard-client.tsx#L514-L528)
- 観察事実: 同一の `const tableMates = getSameTableActiveOtherIds(player, players); await setIsPlayingDealer(tid, user.uid, groupIds, player.id, value, tableMates);` を 2 箇所（SeatingBoard / PlayerList）の inline arrow handler でリピート。
- 影響: setIsPlayingDealer の引数が変わったら 2 箇所同期。
- 案: 早期 return より後の orchestrator 領域で `const handleTogglePd = useCallback(async (player, value) => { ... }, [tid, user.uid, groupIds, players])` を 1 つ宣言し、両 callsite に渡す。
- テスト保護: 既存 unit / E2E。動作同値性は build と PD 関連 e2e で担保。
- リスク: なし（純粋な inline 関数の引き上げ）。

### finding-4: `group-detail-client.tsx` の 7 つの async handler 重複（INFO・スコープ外）

- Lens: architect (DRY)
- Severity: info（観察のみ・本サイクルでは対応見送り）
- 場所: [src/app/groups/[gid]/group-detail-client.tsx:219-334](../../../../src/app/groups/[gid]/group-detail-client.tsx#L219-L334)
- 観察事実: `onIssueCode` / `onRename` / `onLeave` / `onDelete` / `onStartSeason` / `onSaveSeasonPointsRule` / `onResetSeasonPointsRule` の 7 つの async handler が、`setWorking(true)` → `try { await fn(); await reload(); await refreshGroups(); }` → `catch { unwrapOrFrom + setError }` → `finally { setWorking(false); }` パターンを 7 回反復。`runRoleAction(fn, errorLabel)` helper が既存だが role 操作 4 箇所しか経由していない。
- 影響: working / error の state 管理 contract を変更すると 7 箇所同期。
- 見送り理由: handler ごとに微妙な差分（`onIssueCode` は reload しない、`onRename` は再 throw する、`onSaveSeasonPointsRule` は先頭で `setError(null)` を呼ぶ、`onLeave` / `onDelete` は finally で dialog を閉じる）があり、汎用化のためのバリエーション設計に時間がかかる。次回サイクルで再評価。
- 案（次回向け）: `runAction(fn, opts: { errorCode: string; errorMessage: string; reload?: boolean; refresh?: boolean; rethrow?: boolean; postFinally?: () => void })` を 1 つ作って 7 箇所すべてを経由させる。
- リスク（採用時）: 各 handler の semantic を 1 つの helper に集約することで意味論が変わる可能性。pre-condition の確認に時間がかかる。

### finding-5: 前回 architect-refactor 20260512 の Deferred 継承（INFO・据え置き）

| Source finding | 引継ぎ理由 | 本サイクル判断 |
| --- | --- | --- |
| 20260512 finding-5（`CardBackgroundCard.tsx` 447 行 hook 抽出） | 既存 `CardBackgroundCard.test.tsx` の mock 境界が service + UI flow に張られていて hook 抽出は test 書換が必要 | 据え置き |
| 20260512 finding-6（Storage rule の 2 read 消費） | owner 操作のみ・低頻度の運用上無視可 | 据え置き |
| 20260512 finding-7（`retry.ts` signal の sleep 中無反応） | `deleteWithRetry` 単独 callsite で実用上問題なし | 据え置き |

## 採用 findings の優先順位

1. **finding-1（MEDIUM）** — `useClipboardCopy` hook 抽出 + 3 callsite 経由化
2. **finding-2（LOW）** — `ThemedQRCode` framed prop + 3 callsite wrapper 削除
3. **finding-3（LOW）** — `dashboard-client.tsx` `onTogglePd` 集約

## 関連リンク

- 計画: [.claude/PRPs/05-post-launch-polish/plans/architect-refactor-20260514.plan.md](../plans/architect-refactor-20260514.plan.md)
- 前回 review: [.claude/PRPs/05-post-launch-polish/reviews/architect-refactor-20260512.md](architect-refactor-20260512.md)
- 前回 report: [.claude/PRPs/05-post-launch-polish/reports/architect-refactor-20260512.md](../reports/architect-refactor-20260512.md)
- レンズ: [`web_architect.md`](../../../skills/architect-refactor/references/web_architect.md) / [`security_specialist.md`](../../../skills/architect-refactor/references/security_specialist.md)
- 集約先: [`refactor-conventions.md`](../../../skills/architect-refactor/references/refactor-conventions.md)
