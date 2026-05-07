# Local Review: Phase 5.4 — Clone Tournament With Players

**Reviewed**: 2026-05-06
**Author**: Kujo-n（local uncommitted changes）
**Decision**: APPROVE with comments（MEDIUM 3 件 / LOW 3 件、CRITICAL / HIGH なし）

## Summary

Phase 5.4 の実装は plan 通りに完了しており、Firestore Rules の organizer-clone ブランチは
self-create と同じ invariant を完全に維持し、emulator validator（7 ケース）/ unit（19 件追加）/ E2E
（2 ケース）で多層的に検証されている。バリデーションは全 green（typecheck / lint / 789 unit tests /
build / rules-limits）。merge 可能。ただし以下の **MEDIUM 3 件** は次の polish か一緒の commit で
直すと UX / 保守性が改善する。

## Findings

### CRITICAL

None.

### HIGH

None. rule 設計の安全 invariant（`pid==uid` / `isBusted=false` / no seat / no PD / setup 限定 /
isOrganizer 必須）はすべて維持されており、`get()` も `exists()` ガード付きで意図通り。
[group-membership.md](../../rules/group-membership.md) への潜在リスク追記も plan の意図通り。

### MEDIUM

#### M1. `aria-label` で test selector を兼ねたために a11y が劣化

[src/components/tournament/ClonePlayersChecklist.tsx:88](../../src/components/tournament/ClonePlayersChecklist.tsx#L88)

```tsx
<input
  id={inputId}
  type="checkbox"
  checked={selected.has(p.id)}
  onChange={() => toggle(p.id)}
  disabled={disabled}
  aria-label={`clone-${p.displayName}`}  // ← visible label を上書きしている
/>
<label htmlFor={inputId} className="cursor-pointer">
  {p.displayName}
  {p.isBusted ? <span ...>（バスト）</span> : null}
</label>
```

`htmlFor` で正しく `<label>` と関連付けされているため accessible name は自動で
「Alice / Alice（バスト）」になるはず。だが `aria-label="clone-Alice"` が**それを上書き**するため、
スクリーンリーダー利用者には「クローン-Alice」と読み上げられる。E2E spec
（[clone-tournament-with-players.spec.ts:151](../../tests/e2e/clone-tournament-with-players.spec.ts#L151)）が
`page.getByLabel("clone-Alice")` で参照するために付けられた test selector が SR UX を犠牲にしている。

**修正案**: `aria-label` を `data-testid={`clone-${p.id}`}` に置換し、E2E spec 側を `getByTestId` に切替。
または `data-clone-id={p.id}` 等の semantic 属性に。

#### M2. Orchestrator 失敗時に「clone-client の error」と「TournamentForm 内部 error」が二重表示

[src/app/tournaments/[tid]/clone/clone-client.tsx:169-180](../../src/app/tournaments/[tid]/clone/clone-client.tsx#L169-L180)

```tsx
} catch (e) {
  const wrapped = unwrapOrFrom(e, "firestore/write_failed", "クローンに失敗しました");
  setError(`${wrapped.code}: ${wrapped.message}`);   // ← clone-client の error 領域に表示
  throw wrapped;                                      // ← TournamentForm の catch にも伝搬
}
```

[TournamentForm.tsx:127-129](../../src/components/tournament/TournamentForm.tsx#L127-L129) は throw を
受け取って自前の `setError` を呼ぶ。結果、ユーザー画面には **同じ error メッセージが 2 か所** に出る:

1. `<ClonePlayersChecklist>` 直後（clone-client が表示）
2. フォーム内 submit ボタン上（TournamentForm が表示）

**修正案**:

- A. clone-client 側で `setError` だけ呼んで throw しない。代わりに `setSubmitting(false)` も自前で
  call。ただし TournamentForm の `submitting` は戻らないため Form 側にも `submitting` リセット手段が必要
- B. clone-client から `setError` を消して TournamentForm の error 表示に集約。validation/clone-no-players
  だけは clone-client から throw して Form 経由で表示
- C. TournamentForm に `suppressInternalError?: boolean` prop を追加

最も影響が小さいのは **B**（clone-client の `setError(...)` 1 行を消し、`throw wrapped` だけ残す）。

#### M3. 初回 `subscribePlayers` が空リストを返したケースで selected hydration が永久に再実行されない

[src/app/tournaments/[tid]/clone/clone-client.tsx:57-72](../../src/app/tournaments/[tid]/clone/clone-client.tsx#L57-L72)

```tsx
useEffect(() => {
  const unsub = subscribePlayers(tid, (list) => {
    setPlayers(list);
    if (!selectedHydratedRef.current) {
      setSelected(initialSelectedIdsFromPlayers(list));
      selectedHydratedRef.current = true;   // ← list=[] でも true になる
    }
  }, ...);
  return unsub;
}, [tid]);
```

Firestore オフライン永続化や cache miss で **初回 onSnapshot が `[]` を返す** とき、`selectedHydratedRef`
が true になってしまい、続く `[Alice, Bob]` の onSnapshot では再 hydration が走らず `selected` が
空のまま残る。ユーザーは「全選択」を手動でクリックする必要がある（致命ではないが意図と違う UX）。

**修正案**: `list.length > 0` ガードを足す。

```tsx
if (!selectedHydratedRef.current && list.length > 0) {
  setSelected(initialSelectedIdsFromPlayers(list));
  selectedHydratedRef.current = true;
}
```

これでも「全 player が busted（busted のみ N 名 / 非 busted 0 名）」の極端ケースで selected が
空のまま hydration 完了するが、その場合は意図通り（busted は default OFF 規約のため）。

### LOW

#### L1. `tournament-clone.ts` の catch 分岐の `instanceof` ternary が事実上 dead

[src/lib/services/tournament-clone.ts:47-51](../../src/lib/services/tournament-clone.ts#L47-L51)

```ts
} catch (e) {
  throw e instanceof AppError
    ? e
    : AppError.from(e, "firestore/write_failed", "クローンに失敗しました");
}
```

`createTournament` も `clonePlayersFromTournament` も内部で `wrapFirestoreWrite` 経由で必ず AppError を
throw する設計（明示的な `tournament/clone-too-many` / `tournament/clone-empty` も AppError）。
よって ternary の `false` 分岐は到達不能。

**判断**: 防衛的コードとして残してよいが、コメントで「実際は `e` は常に AppError、`instanceof` ガードは
将来の callee 変更に備えた防衛」と書くと意図が伝わる。修正必須ではない。

#### L2. clone 不可時のエラーメッセージに raw state 名が露出

[src/app/tournaments/[tid]/clone/clone-client.tsx:116](../../src/app/tournaments/[tid]/clone/clone-client.tsx#L116)

```tsx
このトーナメントは終了していないため複製できません（state={src.state}）。
```

`state="setup"` / `"seating"` / `"running"` / `"paused"` の英語キーがそのまま出る。
`/tournaments/{tid}` への直リンクから飛んだ場合の防御で UI 主導線では発生しないため LOW。

**修正案**: state を日本語に変換する辞書を `tournament-state.ts` に置くか、メッセージから state 名を消す。
直リンクからの誤遷移防御という用途を考えると state 表示は debug アイデンティティとして意味がある
（dev / レビュー時のヒント）ため、判断は実装者に任せる。

#### L3. `submitting` が clone-client / TournamentForm に二重に存在

[clone-client.tsx:37](../../src/app/tournaments/[tid]/clone/clone-client.tsx#L37) と
[TournamentForm.tsx:69](../../src/components/tournament/TournamentForm.tsx#L69) の両方で `submitting`
state を保持。同 logical condition（"submit 中"）の二箇所管理。

clone-client 側は `<ClonePlayersChecklist disabled={submitting}>` の制御に使うため必要だが、
TournamentForm 内部の `submitting` を取り出せれば 1 つに統一できる。現状でも動作不良はないため LOW。

## Validation Results

| Check | Result |
| --- | --- |
| Type check (`npx tsc --noEmit`) | **Pass** |
| Lint (`npm run lint`) | **Pass**（0 warnings/errors） |
| Tests (`npm run test`) | **Pass**（37 files / 789 tests、新規 19 件追加） |
| Build (`npm run build`) | **Pass**（`/tournaments/[tid]/clone` route 生成確認） |
| Rules limits (`npm run test:rules-limits`) | **Pass**（6/6 green） |
| Rules clone validator (`npm run test:rules-clone-players`) | **Skipped**（emulator 別 process 起動が必要、ローカルレビュー時間内では未実行。CI / 実装者ローカルで要確認） |

## Files Reviewed

| File | Action | 評価 |
| --- | --- | --- |
| `firestore.rules` | Modified | rule 設計は plan / Phase 5.1 PD pattern に completely 準拠。invariant 完全維持 |
| `src/lib/limits.ts` | Modified | `MAX_CLONE_PLAYERS=50` の根拠コメントが明確（writeBatch 500 ops 上限の余裕分） |
| `src/lib/services/tournament-state.ts` | Modified | `canClone` 純関数（1 行）、規約準拠 |
| `src/lib/services/tournament-state.test.ts` | Modified | `it.each(ALL_STATES)` で 5 state 網羅、PASS |
| `src/lib/firebase/repositories/players.ts` | Modified | `clonePlayersFromTournament` の writeBatch + getDocs パターンは `bustPlayer` / `deleteTournament` の mirror。empty batch を `tournament/clone-empty` で防ぐ guard も適切 |
| `src/lib/firebase/repositories/players.test.ts` | Modified | 6 ケース（happy / partial / busted reset / uid===null skip / max超 / empty）で repository contract を網羅 |
| `src/lib/services/tournament-clone.ts` | Created | orchestrator として最小、`logger.info` の出力タイミングも適切（成功時のみ） |
| `src/lib/services/tournament-clone.test.ts` | Created | 3 ケース（happy / clone fail / create fail）で composition 順序を固定 |
| `src/app/tournaments/[tid]/clone/page.tsx` | Created | RequireAuth + CloneClient の standard 形 |
| `src/app/tournaments/[tid]/clone/clone-client.tsx` | Created | M2 / M3 を除けば構造は plan / `tournament-edit-client.tsx` の mirror として綺麗 |
| `src/components/tournament/ClonePlayersChecklist.tsx` | Created | controlled component の API 設計は良好。M1（aria-label）のみ要修正 |
| `src/components/tournament/ClonePlayersChecklist.test.tsx` | Created | 7 ケース（render / uid skip / initial / toggle / 全選択 / 全解除 / badge）で UI contract 充実 |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | Modified | 最小差分（import + Link button 1 件）。既存パターン（`canEdit` / `canDelete` ボタン）と完全整合 |
| `scripts/test-rules-clone-players.mjs` | Created | 7 ケース（self-regression 含む）で rule 経路を網羅、emulator REST 構造は `test-rules-pd.mjs` と完全一致 |
| `package.json` | Modified | `test:rules-clone-players` script 追加 |
| `tests/e2e/clone-tournament-with-players.spec.ts` | Created | 2 ケース（organizer happy path / 一般 member regression 0）で観測可能な振る舞いを E2E で固定 |
| `.claude/rules/firebase-patterns.md` | Modified | 「players の create rule 経路」セクション新設。⚠ DRIFT WARNING で両ブランチ同期更新の責任を明示 |
| `.claude/rules/group-membership.md` | Modified | Phase 5.4 organizer-clone の影響範囲・潜在リスク・緩和を既存方針（信頼ロール限定）に揃えて追記 |
| `.claude/PRPs/plans/completed/phase-5.4-*.plan.md` | Created | plan が completed/ 配下に移動済み |
| `.claude/PRPs/reports/phase-5.4-*-report.md` | Created | 実装レポート追加 |
| `.claude/PRPs/prds/allin-timer.prd.md` | Modified | Phase 5.4 行が `in-progress` で投入済み（実装完了に伴い `complete` への更新は別 commit でも可） |

## Recommendations

### 即時推奨（同 commit 内で修正したい polish）

1. **M1**: `aria-label="clone-${displayName}"` → `data-testid="clone-${id}"` に置換し、E2E spec の
   `getByLabel` を `getByTestId` に切替
2. **M2**: clone-client の `setError(...)` を消して TournamentForm 側の error 表示に集約

### 次の polish 系 commit で対応

3. **M3**: `selectedHydratedRef` の hydration ガードに `list.length > 0` を追加
4. **L1〜L3**: 任意

### PRD の `complete` 化

実装レポートが既に作成されているため、別 commit で Phase 5.4 行の status を `in-progress` →
`complete` に更新し、実装レポートへの link を追加する。

## Next Steps

- M1 / M2 を修正してから commit を推奨（E2E spec 側の selector も併せて変更）
- M3 は次のドライランで実害が観測されたら対応
- emulator validator（`npm run test:rules-clone-players`）を実装者ローカルで 1 度走らせて 7/7 green を
  確認すること（本レビュー環境では emulator 起動を省略）
