# Architect Refactor Plan — 20260514

## 所属

- PRD: `05-post-launch-polish`（Track D Phase D.1 follow-up）
- 監査結果: [.claude/PRPs/05-post-launch-polish/reviews/architect-refactor-20260514.md](../reviews/architect-refactor-20260514.md)
- ベースラインコミット: `0717eaf`（develop / Track D Phase D.1 完了直後）
- 作業ブランチ: `refactor/architect-refactor-20260514`

## 不変条件

1. 全テスト（typecheck / lint / unit / build）は常に green を維持
2. 公開 API / Firestore schema / 環境変数 / URL は **変更しない**
3. 観測可能な動作変更は **0**（QR の表示色・clipboard 動作・PD トグルの動作はすべて同値）
4. 1 commit = 1 atomic な変更単位
5. プロジェクト規約（`.claude/rules/*`）優先（特に [error-logging.md](../../../rules/error-logging.md) / [testing.md](../../../rules/testing.md)）

## タスク

採用 finding 3 件を atomic な 3 commit に分解する。前段で characterization test を仕込み、後段で集約を実装する。

---

### T1: `useClipboardCopy` hook 抽出（finding-1, MEDIUM）

**目的**: 3 callsite で重複している clipboard copy パターンを `lib/hooks/useClipboardCopy.ts` に集約。`AppError` + `logger.warn` パイプラインに統一する。

**手順**:

1. **新規 hook test を先行投入** — `src/lib/hooks/useClipboardCopy.test.ts`
   - 4 ケース:
     - 成功: `copy()` 呼出後 `copied=true`、`autoResetMs` 後に `copied=false`
     - 失敗: `navigator.clipboard.writeText` が reject すると `logger.warn({ code: "clipboard/unavailable" })` が呼ばれ、`onError` callback に `formatErrorForDisplay` 経由の文字列が渡される
     - `value === null` の `copy()`: 何もしない（`copied` は false のまま）
     - SSR / clipboard 不在: `typeof navigator === "undefined"` または `navigator.clipboard` 不在で no-op
   - vi.useFakeTimers で `setTimeout` を制御
2. **hook 本体を実装** — `src/lib/hooks/useClipboardCopy.ts`
   ```ts
   export function useClipboardCopy(
     value: string | null,
     options?: { autoResetMs?: number; onError?: (message: string) => void },
   ): { copied: boolean; copy: () => Promise<void> }
   ```
   - 失敗時は内部で `AppError.from(e, "clipboard/unavailable", "クリップボードにコピーできませんでした")` → `logger.warn(wrapped.message, { code: wrapped.code })` → `options?.onError?.(formatErrorForDisplay(wrapped))`
   - autoResetMs default = 2000
3. **3 callsite を hook 経由化**（同 commit 内）:
   - `src/components/qr/QrPanel.tsx` — `useState<copied>` / `onCopy` を削除、`useClipboardCopy(url)` で置換
   - `src/app/groups/[gid]/_components/InviteCodeCard.tsx` — `useState<copied>` / `onCopy` / `useEffect(reset copied)` を削除、`useClipboardCopy(inviteUrl, { onError: onCopyError })` で置換
   - `src/components/tournament/SpectateModeCard.tsx` — `useState<copied>` / `onCopy` を削除、`useClipboardCopy(url, { onError })` で置換
4. **テスト全件 green 確認** — typecheck / lint / unit / build

**テスト保護**: 新規 `useClipboardCopy.test.ts` 4 ケースに加えて、既存の `QrPanel.test.tsx` / `InviteCodeCard.test.tsx` / `SpectateModeCard.test.tsx`（あれば）が引き続き green であること。

**観測可能変更なしの根拠**:
- 成功時の `copied` flash 表示と auto-reset 時間（2000ms）は同値
- 失敗時の logger.warn の code/message は同値（`code: "clipboard/unavailable"`）
- `SpectateModeCard` の onError 文字列は `formatErrorForDisplay(AppError("clipboard/unavailable", ...))` = `"clipboard/unavailable: クリップボードにコピーできませんでした"` と既存ハードコードが同形

**コミットメッセージ案**: `refactor(hooks): clipboard copy + flash パターンを useClipboardCopy hook に集約`

---

### T2: `ThemedQRCode` の `framed` prop（finding-2, LOW）

**目的**: QR 描画 wrapper `<div className="flex justify-center rounded-md border bg-card p-4">` の 3 callsite 重複を `ThemedQRCode` 内部に取り込む。

**手順**:

1. **既存 `ThemedQRCode.test.tsx` に framed の characterization を追加**:
   - `framed` default `true` のときに wrapper class（`flex justify-center rounded-md border bg-card p-4`）が描画されること
   - `framed={false}` のとき wrapper class が描画されない（`QRCodeSVG` のみ）こと
2. **`ThemedQRCode.tsx` に `framed?: boolean`（default `true`）prop を追加** — wrapper を内部 JSX に取り込む
3. **3 callsite で wrapper div を削除**:
   - `src/components/qr/QrPanel.tsx:58` の `<div className="flex justify-center rounded-md border bg-card p-4">` 削除（直接 `<ThemedQRCode>` を返す）
   - `src/app/groups/[gid]/_components/InviteCodeCard.tsx:82` 同上
   - `src/components/tournament/SpectateModeCard.tsx:161` 同上
4. **テスト全件 green 確認**

**テスト保護**: `ThemedQRCode.test.tsx` 拡張 + 既存 callsite の動作 test。

**観測可能変更なしの根拠**:
- DOM 構造（`<div>` の親子関係 / class 文字列）は完全同値（wrapper class を ThemedQRCode 内部に移動するだけ）
- QR の表示色・サイズ・aria-label は不変

**コミットメッセージ案**: `refactor(qr): ThemedQRCode に framed prop を追加し 3 callsite の wrapper を集約`

---

### T3: `dashboard-client.tsx` `onTogglePd` 集約（finding-3, LOW）

**目的**: 2 箇所のインライン `onTogglePd` を `useCallback` で 1 つに集約。

**手順**:

1. **`dashboard-client.tsx` の早期 return 後の領域に `handleTogglePd` を 1 つ宣言**:
   ```ts
   const handleTogglePd = useCallback(
     async (player: PlayerDoc, value: boolean) => {
       const tableMates = getSameTableActiveOtherIds(player, players);
       await setIsPlayingDealer(tid, user.uid, groupIds, player.id, value, tableMates);
     },
     [tid, user.uid, groupIds, players],
   );
   ```
   - 早期 return 後でないと `user.uid` 直アクセスができないため、`useCallback` の依存配列に `user` を含めるか、callsite の前で確定させる。
   - 既存の使い方（`SeatingBoard` props と `PlayerList` props の inline arrow）は `useCallback` 戻り値の参照を渡せば等価。
2. **2 callsite を `onTogglePd={handleTogglePd}` で置換**
3. **テスト全件 green 確認**

**テスト保護**: 既存 dashboard E2E / PD 関連 e2e（`pd-rotation.spec.ts` 等）。動作同値性は build / typecheck で担保。

**観測可能変更なしの根拠**: `useCallback` で参照が安定する以外、関数 body は完全同形。

**コミットメッセージ案**: `refactor(dashboard): onTogglePd インライン 2 箇所を useCallback 1 つに集約`

---

## 検証順序

各タスクごとに以下を実施:

1. `npm run typecheck`
2. `npm run lint`
3. `npm test`（vitest）
4. （T1 のみ）vitest が新規 hook test を含めて green であること
5. `git add -p` で意図したファイルだけステージし atomic commit

Phase 5（最終検証）で:

1. dev server / emulator が停止していることを確認
2. `npm run typecheck` / `npm run lint` / `npm test`
3. `npm run build`
4. `npm run test:e2e`（Track D の `theme-toggle.spec.ts` / `card-background.spec.ts` / `spectate-mode.spec.ts` 等を含む全件）

## 見送りタスク

- **finding-4 (group-detail-client.tsx の 7 handler 集約)** — 各 handler の semantic 差分が大きいため、汎用化設計に時間がかかる。次回 architect-refactor で再評価
- **finding-5 (前回 20260512 deferred 群)** — 前回判断を維持

## ユーザー承認方針

ユーザーは本セッションで「stop without clarifying questions」を要求しているため、本計画は **承認待ちなしで Phase 4 実装に進む**。途中で計画違いが判明したら停止して redirect を求める。

## 期待される成果

- 新規 hook: `useClipboardCopy` 1 件
- 集約: 3 件（clipboard copy / QR wrapper / onTogglePd）
- 削除行数: ~50〜80 行（3 callsite の重複削除）
- 追加 test 件数: +4〜6 件（useClipboardCopy 4 + ThemedQRCode 2）
- 観測可能変更: 0
