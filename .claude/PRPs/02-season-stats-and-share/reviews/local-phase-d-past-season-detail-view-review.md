# Local Review: Phase D improvement — Past Season Detail View

**Reviewed**: 2026-05-07
**Author**: ローカル未コミット差分（develop ブランチ）
**Scope**: 過去シーズン詳細ページ（`/groups/[gid]/season/history/[seasonId]`）の追加 + `SeasonHistoryList` の Link 化
**Decision**: **REQUEST CHANGES**（HIGH 1 件 / MEDIUM 1 件）

## Summary

Phase D improvement の実装は機能的には完成しており typecheck / lint / 関連 unit test
はすべて green。schema / rule / `finishTournament` / `startNewSeason` には触れず、
read 経路 `getSeasonHistory` を additive に追加し、詳細 page を新設する設計は
[firebase-patterns.md](../../../rules/firebase-patterns.md) / [error-logging.md](../../../rules/error-logging.md)
の規約に沿っている。

ただし **「permission-denied 時に NotFound UI に倒して認可情報を leak しない」**
という JSDoc / 業務仕様書 / Acceptance Criteria の主張と、実装・テストが行う実際の
動作（permission-denied は role=alert で **`firestore/permission-denied: シーズン履歴の取得に失敗しました`**
を露出）が**ドキュメントレベルで逆**になっている。これは security-relevant な claim と
実装の drift で、Codex レビュー前に方針を確定する必要がある。あわせて `seasonHistory.ts`
の JSDoc が新関数の挿入により誤った関数を説明する形でずれている。

## Findings

### CRITICAL

なし。

### HIGH

#### H-1. 「permission-denied → NotFound UI に倒す」claim と実装が逆

仕様書 / JSDoc / コメントでは「非メンバー（permission-denied）の直リンクは
"見つかりません" UI に倒し、認可情報を leak しない」と明示しているが、
実装は `firestore/not-found` のみを NotFound UI にマップし、permission-denied は
他の失敗と同じく role=alert に raw error code を表示する経路に倒れる。test もその
挙動を **enforce** している。

**論拠 1 — JSDoc 内で矛盾している**
[season-history-detail-client.tsx:24-26](../../../../src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.tsx#L24-L26)

```ts
*  - getGroup + getSeasonHistory を 1 度ずつ並列 fetch
*  - `firestore/not-found` は専用 UI、それ以外の失敗は role=alert + 戻りリンク
*  - 認可エラー（permission-denied）は not-found UI に倒し、認可情報を leak しない
```

第 2 行（"それ以外の失敗は role=alert"）と第 3 行（"permission-denied は not-found UI に倒し"）
が直接矛盾している。

**論拠 2 — 実装は第 2 行の挙動**
[season-history-detail-client.tsx:83-97](../../../../src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.tsx#L83-L97)

```tsx
if (errorCode === "firestore/not-found") {
  return <NotFound gid={gid} />;
}
if (errorCode || !group || !history) {
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-8">
      <p className="text-sm text-destructive" role="alert">
        {errorCode ?? "firestore/read_failed"}: シーズン履歴の取得に失敗しました
      </p>
```

`firestore/permission-denied` は第 2 分岐に落ち、生の error code が alert に表示される。

**論拠 3 — test が alert 挙動を codify している**
[season-history-detail-client.test.tsx:180-191](../../../../src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.test.tsx#L180-L191)

```tsx
it("getGroup が失敗したとき role=alert でエラーコードを表示する", async () => {
  vi.mocked(getGroup).mockRejectedValue(
    new AppError("perm", "firestore/permission-denied"),
  );
  ...
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("firestore/permission-denied");
```

**論拠 4 — 業務仕様書 / Acceptance Criteria は NotFound 倒しを宣言**

[08-season-stats.spec.md:213](../../../../docs/specification/08-season-stats.spec.md#L213)
> 詳細ページに直リンクで非メンバーがアクセスした場合は「見つかりません」UI に倒れる（認可情報を leak しない）

[Implementation report の Acceptance Criteria](../reports/phase-d-past-season-detail-view-report.md)
> [x] `/groups/[gid]/season/history/[seasonId]` ページが新設され、group メンバーは閲覧可能、**非メンバーは「見つかりません」UI に倒れる**

**影響**

- 認可情報の leak は厳密には「season ID が valid な形式である」だけだが、permission-denied の生表示
  は仕様書の宣言と矛盾しており、Codex レビューで確実に指摘される
- 同じ URL に対する応答が「`not-found`」と「`permission-denied`」で違うため、攻撃者は seasonId
  の存在有無を error string の差から推定可能（rule で塞いでいる security boundary を実装側で薄くしている）

**Suggested fix（推奨は A）**

A. **実装 + test を修正**して permission-denied を NotFound UI に倒す（仕様書 / JSDoc / report の文言が真実源）

```tsx
const NOT_FOUND_LIKE = new Set(["firestore/not-found", "firestore/permission-denied"]);
if (errorCode && NOT_FOUND_LIKE.has(errorCode)) {
  return <NotFound gid={gid} />;
}
```

test 側は `firestore/permission-denied` ケースを「NotFound UI に倒れる」 assert に書き換える。
JSDoc 第 2 行も `permission-denied と not-found を専用 UI、その他は alert` のように修正。

B. **仕様書 / JSDoc / report を実装側に合わせる**（permission-denied を生表示する設計だと宣言する）。
ただしこれは [security-base.md](../../../rules/security-base.md) / 「認可情報を leak しない」
ポリシーから後退する選択であり、Codex 指摘リスクが高い。原則 A を推奨。

---

### MEDIUM

#### M-1. `seasonHistory.ts` の JSDoc が誤った関数を説明している

[seasonHistory.ts:23-48](../../../../src/lib/firebase/repositories/seasonHistory.ts#L23-L48)

```ts
/**
 * Phase A: 過去シーズンの履歴一覧を取得する。
 *
 *  - `endedAt desc` は client 側で sort（小規模サークル想定で 1 シーズン = 1 doc）
 *  - 個別 doc が schema validate に失敗しても全体を落とさず該当 doc のみ skip
 */
export async function getSeasonHistory(
  gid: string,
  seasonId: string,
): Promise<SeasonHistoryDoc> {
```

このコメントブロックは Phase A で `listSeasonHistory` のために書かれた説明（"client 側で sort" /
"該当 doc のみ skip"）。今回 `getSeasonHistory`（単一 doc fetch、sort も skip もしない）が
`listSeasonHistory` の上に挿入されたため、JSDoc が誤った関数の説明に変わった。`listSeasonHistory`
側にはコメントが付かなくなっている。

**Suggested fix**

JSDoc を `listSeasonHistory` の直前に戻し、`getSeasonHistory` には新しい 2-3 行の comment（または
未付与）にする。例:

```ts
/**
 * Phase D improvement: 単一シーズンの履歴 doc を取得する。not-found は AppError("firestore/not-found")。
 */
export async function getSeasonHistory(...) { ... }

/**
 * Phase A: 過去シーズンの履歴一覧を取得する。
 *  - `endedAt desc` は client 側で sort（小規模サークル想定で 1 シーズン = 1 doc）
 *  - 個別 doc が schema validate に失敗しても全体を落とさず該当 doc のみ skip
 */
export async function listSeasonHistory(...) { ... }
```

---

### LOW

#### L-1. not-found 経路が毎回 `logger.warn` を出す

`getSeasonHistory` 内で `throw new AppError(..., "firestore/not-found")` を `wrapFirestoreRead` の
内側で行うため、[wrap.ts:42-46](../../../../src/lib/firebase/wrap.ts#L42-L46) の catch で
`AppError.from`（既存 AppError は素通し）→ `logger.warn(..., { code: "firestore/not-found", gid, seasonId })`
が必ず走る。ローカル test 実行ログでも次の行が観測できる:

```
[warn] seasonHistory not found: g1/missing { code: 'firestore/not-found', gid: 'g1', seasonId: 'missing' }
```

deeplink 共有後の URL 失効・typo・hostile crawler などで日常的に warn が積まれる。
本番ログのノイズは小〜中程度（Vercel ログは info 以上）。

**Suggested fix（任意）**

存在チェックを wrap の外に出して、not-found は warn を伴わない明示 throw にする:

```ts
export async function getSeasonHistory(gid, seasonId): Promise<SeasonHistoryDoc> {
  const snap = await wrapFirestoreRead(
    "firestore/read_failed",
    "シーズン履歴の取得に失敗しました",
    async () => getDoc(seasonHistoryDocRef(gid, seasonId)),
    { gid, seasonId },
  );
  if (!snap.exists()) {
    throw new AppError(`seasonHistory not found: ${gid}/${seasonId}`, "firestore/not-found");
  }
  return { id: snap.id, ...snap.data() };
}
```

H-1 を fix A で解決する場合、permission-denied も NotFound に倒れるので「日常的な not-found に
warn を出さない」運用は H-1 と並行検討する価値あり。優先度は低い。

#### L-2. `Promise.all` 失敗時のメッセージが getGroup と getSeasonHistory のどちらかを区別しない

[season-history-detail-client.tsx:45-58](../../../../src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.tsx#L45-L58)

`Promise.all([getGroup(gid), getSeasonHistory(gid, seasonId)])` のどちらが reject しても
メッセージは「シーズン履歴の取得に失敗しました」になる。group fetch の失敗（一時的 perm
変動 / network）でも上記メッセージが出る。UX 微差で、修正必須ではない。

H-1 を fix A で permission-denied を NotFound に倒すなら、本件はほぼ顕在化しなくなる。

#### L-3. `audioSettings` 等の fixture 全フィールド列挙

[season-history-detail-client.test.tsx:29-52](../../../../src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.test.tsx#L29-L52)

`makeGroup` factory は `GroupDoc` 全フィールドを列挙している
（`audioSettings.levelUpSoundId` / `defaultTableLabels` / `defaultTableColors` 等）。
[testing.md](../../../rules/testing.md) の fixture factory 規約は守っているが、
schema additive 拡張のたびにここを更新する必要がある。

将来的には `_components/__fixtures__/group.ts` のような共有 factory に集約すると
DRY だが、今回新規 1 ファイルのため許容範囲。**修正不要**、メモ程度。

---

## Validation Results

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | **PASS** | tsc --noEmit エラー 0 件 |
| `npm run lint` | **PASS** | ESLint warnings/errors 0 件 |
| 関連 unit test（`vitest run`） | **PASS** | seasonHistory.test.ts (8) / SeasonHistoryList.test.tsx (5) / season-history-detail-client.test.tsx (4) — 17/17 green |
| `npm test`（全件） | SKIPPED | 実装 report で 1046/1046 PASS と記録あり |
| `npm run build` | SKIPPED | 実装 report で PASS と記録あり |
| `npm run test:rules-season` | SKIPPED | rule 変更なし。実装 report で 12/12 PASS |

## Files Reviewed

| File | Action | Notes |
| --- | --- | --- |
| `src/lib/firebase/repositories/seasonHistory.ts` | Modified | M-1 — JSDoc 移動先ずれ |
| `src/lib/firebase/repositories/seasonHistory.test.ts` | Modified | OK |
| `src/app/groups/[gid]/season/history/[seasonId]/page.tsx` | Added | OK（`await params` 形式は Next.js 15 規約準拠） |
| `src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.tsx` | Added | H-1 — JSDoc / 仕様書 と permission-denied 経路の drift |
| `src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.test.tsx` | Added | H-1 — alert 挙動を test が codify |
| `src/app/groups/[gid]/season/_components/SeasonHistoryList.tsx` | Modified | OK — accordion 廃止 + `encodeURIComponent` 防御 OK |
| `src/app/groups/[gid]/season/_components/SeasonHistoryList.test.tsx` | Modified | OK — `Button asChild` Slot の testid 転送を活用 |
| `README.md` | Modified | OK |
| `docs/specification/08-season-stats.spec.md` | Modified | H-1 — 3.5.5 と実装 drift |
| `.claude/PRPs/02-season-stats-and-share/prds/02-season-stats-and-share.prd.md` | Modified | OK |
| `.claude/PRPs/.../plans/phase-d-past-season-detail-view.plan.md` | Deleted (moved to completed/) | OK |
| `.claude/PRPs/.../plans/completed/phase-d-past-season-detail-view.plan.md` | Added | OK |
| `.claude/PRPs/.../reports/phase-d-past-season-detail-view-report.md` | Added | OK — H-1 を含む Acceptance Criteria は要再評価 |

## Security Notes

- 招待コード / 認証 / 環境変数の追加 / SDK 初期化変更: なし
- Firestore rule / index 変更: なし（Phase A の `seasonHistory` rule をそのまま流用）
- `encodeURIComponent(h.id)` で seasonId を URL に出す前にエンコード（XSS / path traversal 防御は適切）
- React は default で innerHTML escape、`dangerouslySetInnerHTML` 使用なし
- Hardcoded credentials: なし
- ユーザー入力の Firestore 書込: なし（read 経路のみの追加）

## Next Steps

1. **H-1 を A 案で修正**（実装 + test + JSDoc を「permission-denied は NotFound に倒す」に揃える）
2. M-1 の JSDoc 移動を fix
3. L-1（not-found warn 抑制）は任意。H-1 と一緒に検討すると差分集約しやすい
4. 全件再 typecheck / lint / vitest run で green 確認
5. Codex レビューに供出

---

## Resolution（2026-05-07・同セッション内修正）

| Finding | Status | 修正内容 |
| --- | --- | --- |
| **H-1** | RESOLVED | A 案で実装 / test / JSDoc を統一。`NOT_FOUND_LIKE_CODES = {"firestore/not-found", "firestore/permission-denied"}` を導入し、両 code を NotFound UI に倒す。test は permission-denied → NotFound 検証に書き換え、generic `firestore/read_failed` の alert 経路を新規 case で担保（detail-client test 4 → 5 件）。仕様書 [08-season-stats.spec.md:213](../../../../docs/specification/08-season-stats.spec.md#L213) と JSDoc / 実装 / test がすべて整合 |
| **M-1** | RESOLVED | `seasonHistory.ts` の JSDoc を再配置。`getSeasonHistory` には Phase D improvement / not-found / read_failed 経路を説明する JSDoc を新規付与、`listSeasonHistory` には Phase A 当時の "client 側 sort" / "skip invalid docs" コメントを復元 |
| **L-1** | DEFERRED | not-found 経路の `logger.warn` ノイズは未対応。優先度低、将来の repository リファクタで `wrapFirestoreRead` 構造を見直すタイミングで一括対応する |
| **L-2** | NOT FIXED | H-1 修正により permission-denied は NotFound に倒れるため顕在化リスクが減少。一般 fetch failure の alert 文言は据え置き |
| **L-3** | NOT FIXED | メモのみ |

### Re-validation（修正後）

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | **PASS** | エラー 0 件 |
| `npm run lint` | **PASS** | warnings/errors 0 件 |
| 関連 vitest（3 ファイル） | **PASS** | seasonHistory.test.ts (8) / SeasonHistoryList.test.tsx (5) / season-history-detail-client.test.tsx (4 → **5**) — 18/18 green |

修正後の **Decision: APPROVE**（HIGH / MEDIUM 解消、LOW のみ残存）。Codex 供出 OK。
