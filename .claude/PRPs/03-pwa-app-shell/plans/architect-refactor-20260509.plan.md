# Architect Refactor Plan — 20260509

監査結果（[reviews/architect-refactor-20260509.md](../reviews/architect-refactor-20260509.md)）に
基づく atomic タスク分解。各タスクは 1 commit に収まり、観測可能な振る舞いを変えず、
既存テストで安全網を持つ。

## 不変条件（Phase 4 ループ全体）

- 各タスク完了時: `typecheck` / `lint` / `npm test` / `npm run build` 全 green
- E2E は最終 Phase 5 で 1 度走らせる（中間 commit では走らせない — `testing.md` 規約準拠）
- 1 commit = 1 task の atomic 性
- 観測可能な動作変更 0（log 行数の差は許容）
- AppError code / setError 文字列 / aria-label は維持

## タスク順序

依存関係は無いが、リスクの低い順 → 高い順で実行する:

1. **T1**: PWA install dismiss helper 集約（finding-1）— 自閉型・依存無し
2. **T2**: TableColorPresetRadioGroup 共通化（finding-2）— characterization test 先行
3. **T3**: 残存 client 二重 warn の `unwrapOrFrom` 化（finding-3）— 5 ファイル

---

## T1: PWA install dismiss helper を `install-dismiss-storage.ts` に集約

### 目的
PwaInstallPromotion / IOsInstallHint で重複している storage 5 シンボル
（`STORAGE_KEY` / `THIRTY_DAYS_MS` / `readDismissedAt` / `persistDismissedAt` /
`isWithinDismissTtl`）を共通 module に集約。storage key drift で「片方だけ書く / 読まない」
事故を構造的に防ぐ。

### 対象ファイル
- 新設: `src/components/pwa/install-dismiss-storage.ts`
- 修正: `src/components/pwa/PwaInstallPromotion.tsx`
- 修正: `src/components/pwa/IOsInstallHint.tsx`

### 実装手順

1. `src/components/pwa/install-dismiss-storage.ts` を新設し、5 シンボルを export:
   ```ts
   export const PWA_INSTALL_DISMISS_STORAGE_KEY = "allinpt.pwaInstallDismissedAt";
   export const PWA_INSTALL_DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
   export function readPwaInstallDismissedAt(): number | null { /* SSR-safe */ }
   export function persistPwaInstallDismissedAt(ts: number): void { /* SSR-safe */ }
   export function isWithinPwaInstallDismissTtl(at: number | null): boolean { /* pure */ }
   ```
   - SSR ガード（`typeof window === "undefined"` で early return）を維持
   - `AppError.from(e, "pwa/storage-failed", ...)` + `logger.warn` のエラー文言 / code を
     既存と完全一致させる（unit test の挙動を維持）

2. `PwaInstallPromotion.tsx` から 5 シンボルを削除し、新 module から import:
   - 既存呼出箇所: `readDismissedAt()` (line 76) / `persistDismissedAt(...)` (line 88, 112,
     124, 130) / `isWithinDismissTtl(...)` (line 76)
   - import 名は `readPwaInstallDismissedAt` 等に renames（衝突回避と意味明示）

3. `IOsInstallHint.tsx` から 4 シンボルを削除し、新 module から import:
   - 既存呼出箇所: `readDismissedAt()` (line 75) / `persistDismissedAt(...)` (line 84)
   - inline `Date.now() - at < THIRTY_DAYS_MS` (line 76) は `isWithinPwaInstallDismissTtl(at)`
     に置換し、PwaInstallPromotion と TTL 判定式を統一

### 検証
- `npm run typecheck` — green
- `npm run lint` — green
- `npm test` — green（PwaInstallPromotion.test.tsx の 9 ケース、IOsInstallHint.test.tsx の
  7 ケースが import path 変更の影響なく pass）
- `npm run build` — green

### Commit message
```
refactor(pwa): install dismiss state helper を install-dismiss-storage.ts に集約

PwaInstallPromotion / IOsInstallHint で重複していた 5 シンボル
(STORAGE_KEY / TTL / read / persist / isWithinTtl) を 1 module に統合。
storage key drift で連動が破綻する構造リスクを除去。
```

### リスク
極低。symbol 名・I/O 順序・error code・SSR ガードを完全維持。import path のみ変更。

---

## T2: Table 色プリセット radiogroup を `TableColorPresetRadioGroup` に共通化

### 目的
GroupDefaultTableLabelsCard / TableLabelEditPopover で重複している
「色なし button + TABLE_COLOR_PRESETS map の radiogroup」を共通 component に抽出。
プリセット追加 / aria 仕様 / cosmetic（ring-offset）の drift を解消。

### 対象ファイル
- 新設: `src/components/tournament/_table-label-edit/TableColorPresetRadioGroup.tsx`
- 新設（characterization test）: `src/app/groups/[gid]/_components/GroupDefaultTableLabelsCard.test.tsx`
- 修正: `src/app/groups/[gid]/_components/GroupDefaultTableLabelsCard.tsx`
- 修正: `src/components/tournament/_table-label-edit/TableLabelEditPopover.tsx`

### 実装手順（2 step に分割し、いずれも別 commit）

#### T2-a: characterization test を先行投入

`GroupDefaultTableLabelsCard.tsx` の test が無いため、抽出前に
「色 preset click → onSave に正しい color を渡す」を 1 ケース固定する:

- `editing` 開始 → label `"赤卓"` 入力 + preset 1 個目選択 → 保存ボタン → `onSave(["赤卓"], [プリセット 1 の hex])` で呼ばれる
- 既存の `TABLE_COLOR_PRESETS[0].value` を expect 値として使う
- aria-label 規約（`default-table-1-color-${preset.name}` / `default-table-1-color-none`）を
  test 内に書き、抽出後に drift したら fail させる

```
Commit: test(group): GroupDefaultTableLabelsCard の preset 選択 → onSave に渡る color を characterize
```

#### T2-b: 共通 component 抽出 + 2 callsite 置換

`TableColorPresetRadioGroup.tsx` を新設:
```ts
export interface TableColorPresetRadioGroupProps {
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
  /** aria-label 接頭辞。"default-table-1" / "table-color-presets-2" 等。 */
  ariaLabelPrefix: string;
  /**
   * aria-label 規約。
   * - "compact": `${ariaLabelPrefix}-color-${preset.name}` / `${ariaLabelPrefix}-color-none`
   * - "verbose": `色：${preset.name}` / `色：なし`
   * 既存 callsite は Card="compact" / Popover="verbose" を維持する。
   */
  ariaLabelStyle: "compact" | "verbose";
  /** ring offset の大きさ。Card=1（小）/ Popover=2（大）。 */
  size: "sm" | "md";
  /** "色なし" button に上書きする radiogroup の aria-label（必須）。 */
  groupAriaLabel: string;
}
```

- 内部実装は既存 Card 側 (line 193-232) のロジックと Popover 側 (line 144-185) のロジックを
  両方カバーする 1 つの DOM 構造を使う。`size` で button h/w と ring-offset を切り替え:
  - `size="sm"`: `h-7 w-7 ring-offset-1` / 「なし」 button text-[9px]
  - `size="md"`: `h-9 w-9 ring-offset-2` / 「なし」 button text-[10px]
- `ariaLabelStyle` で aria-label 文字列を切り替え

GroupDefaultTableLabelsCard.tsx の line 193-232 を以下に置換:
```tsx
<TableColorPresetRadioGroup
  value={colorDraft[idx]}
  onChange={(next) => setColorAt(idx, next)}
  disabled={saving}
  ariaLabelPrefix={`default-table-${idx + 1}`}
  ariaLabelStyle="compact"
  size="sm"
  groupAriaLabel={`default-table-color-presets-${idx + 1}`}
/>
```

TableLabelEditPopover.tsx の line 144-185 を以下に置換:
```tsx
<TableColorPresetRadioGroup
  value={color}
  onChange={setColor}
  disabled={saving}
  ariaLabelPrefix=""
  ariaLabelStyle="verbose"
  size="md"
  groupAriaLabel={`table-color-presets-${table.tableNum}`}
/>
```

```
Commit: refactor(tables): 卓色プリセット radiogroup を TableColorPresetRadioGroup に共通化
```

### 検証
- T2-a: `npm test` で新 test が green を確認 → commit
- T2-b: `npm test` 全件 + `npm run build` → commit
- E2E は Phase 5 で全 spec 走行する。`table-label-and-color.spec.ts`（4 ケース）が aria-label
  drift を検出する仕組みが安全網

### リスク
中程度。aria-label 規約 2 系統（compact / verbose）を 1 component で扱う設計が必要。
characterization test を T2-a で先行投入することで、抽出後の drift を即発覚させる。

---

## T3: 残存 client 二重 warn を `unwrapOrFrom` に移行（5 ファイル）

### 目的
前回 architect-refactor T4 で集約しきれなかった、repository / service が wrap 済み関数を
呼ぶ UI 側 catch の二重 warn 5 件を `unwrapOrFrom` に移行。本番ログ重複を排除。

### 対象ファイル
1. `src/components/tournament/BustButton.tsx` (line 51-54)
2. `src/components/tournament/PlayerList.tsx` (line 63-66 と 113-125 の 2 箇所)
3. `src/app/groups/[gid]/_components/GroupDefaultTableLabelsCard.tsx` (line 131-138)
4. `src/components/tournament/_table-label-edit/TableLabelEditPopover.tsx` (line 80-90)

### 実装手順

各箇所を以下のパターンで置換:

```diff
- } catch (e) {
-   const wrapped = AppError.from(e, "firestore/write_failed", "失敗メッセージ");
-   logger.warn(wrapped.message, { code: wrapped.code, ... });
-   setError(`${wrapped.code}: ${wrapped.message}`);
- }
+ } catch (e) {
+   // repository / service 側で warn 済みのため二重出力を避ける
+   const wrapped = unwrapOrFrom(e, "firestore/write_failed", "失敗メッセージ");
+   setError(`${wrapped.code}: ${wrapped.message}`);
+ }
```

注意:
- `setError` の文字列 format（`${code}: ${message}`）を維持
- 既存の `mounted.current` ガード（BustButton 等）は維持
- 不要になった `logger` import は削除（ESLint が unused import を検出）
- `AppError.from` import を `unwrapOrFrom` に切替え

### 検証
- `npm run typecheck` — green
- `npm run lint` — green（unused import の lint warning 出ないこと確認）
- `npm test` — green（warn count を assert している test は無い想定）
- `npm run build` — green

### Commit message
```
refactor(errors): 残存する client 二重 warn 5 件を unwrapOrFrom に集約

repository / service 側で wrapFirestoreWrite 済みの関数を呼ぶ UI catch から
AppError.from + logger.warn を削除し unwrapOrFrom に置換。
本番ログから重複 warn 行を除去（前回 T4 の取りこぼし分）。
```

### リスク
極低。前回 T4 と同形パターン。差分は本番ログから warn 行が消える点のみ。

---

## Phase 5 最終検証順序

`testing.md` および skill の運用学習ノート準拠:

1. dev server / emulator が常駐していないか `netstat` で確認（port 3001 / 4000 / 8080 / 9099）
2. `typecheck` / `lint` / `npm test` / `npm run build` を順次実行
3. 全 green 確認後に `npm run test:e2e` を実行（playwright が fresh dev server + emulator 起動）
4. `git log --oneline <baseline>..HEAD` で commit が atomic に並んでいるか確認
5. レポートを `.claude/PRPs/03-pwa-app-shell/reports/architect-refactor-20260509.md` に書き出し
