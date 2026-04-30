---
applyAlways: false
applyOnPaths:
  - "**/*.test.{ts,tsx}"
  - "tests/e2e/**/*.spec.ts"
  - "tests/e2e/fixtures/**"
  - "vitest.config.ts"
  - "playwright.config.ts"
---

# テスト規約

開発思想の **ステップ 2「要件を満たすテストケースを充実させる」**を成立させ、**ステップ 3「厳密なリファクタリング」**を安全に行うための規約。テストは要件の真実源であり、リファクタの安全網であり、回帰の防壁。

## 適用範囲

- **対象**: `**/*.test.{ts,tsx}`, `tests/e2e/**/*.spec.ts`, `tests/e2e/fixtures/**`, `vitest.config.ts`, `playwright.config.ts`
- **対象外（include に含まれない）**:
  - 実装コード本体 — テストと**同じ commit にペアで含める**規約は本ファイルだが、実装側を編集するときに本ファイルを毎回 Read する必要はない（テスト追加・編集・skip 復旧の局面でのみ参照する）
  - `scripts/test-rules-*.mjs` — Firestore Rules emulator validator は本規約の対象外（手動で `firebase emulators:exec` から起動する Node.js script。Playwright / vitest のフレームワーク規約は適用されない）

## 開発思想との対応

```
ステップ 1: 動くアプリを作る（設計ルールはゆるめでよい）
ステップ 2: 要件を満たすテスト（UT/E2E）を書く ← 本ルールが効く
ステップ 3: 厳密なルールでリファクタする
ステップ 4: ステップ 2 のテスト全 pass で要件担保
```

ステップ 4 が成立するためには、ステップ 2 のテストが以下を満たす必要がある:

- **観測可能な振る舞い（user-observable behavior）**を検証していること
- 実装の内部詳細（深い call chain / 内部関数の呼出順序）に依存していないこと
- リファクタで内部構造が変わってもテストは（原則）変更不要であること

## レイヤごとの責務

| 層                     | 何をテストするか                                              | 例                                                                          |
| ---------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **E2E**                | URL / DOM / aria-label / Firestore 反映等のユーザー観測点     | 「終了ボタンを押すと一覧から消える」                                        |
| **unit (pure)**        | 純関数の入力 → 出力 契約                                      | `canPause(t)` / `resolveWinner(t, players)`                                 |
| **unit (repository)**  | Firestore SDK 呼出形 + AppError ラップ + `wrap` helper 経由   | mock した updateDoc に正しい引数で呼ばれるか / 失敗時に正しい code を throw |
| **unit (hook)**        | state / 副作用の振る舞い（`renderHook`）                      | `useInlineNumberEdit` の編集 → 保存 → cancel フロー                         |
| **unit (component)**   | render 判定 / 条件分岐 / aria 属性                            | `<TimerDisplay>` の各 state 別表示                                          |

## mock の境界

mock は **helper / service / repository の API 境界**で割る。深い call chain
（例: `helper → repository → SDK`）の末端を mock する形は避ける。

```ts
// good — helper 境界で mock
vi.mock("@/lib/services/auth-actions", () => ({
  attemptAnonymousSelfDelete: vi.fn().mockResolvedValue({ deleted: true }),
}));
expect(attemptAnonymousSelfDelete).toHaveBeenCalledWith(user, "cancel");

// bad — 内部実装の deleteUserProfile + user.delete を直接 assert
expect(deleteUserProfile).toHaveBeenCalled();
expect(userDelete).toHaveBeenCalled();
```

理由: helper の内部実装（`deleteUserProfile` + `user.delete()` の順序など）が変わっても、helper の契約（`isAnonymous` のときに best-effort で削除し `{ deleted }` を返す）が保たれていればテストは pass する。Phase 4 architect-refactor の P6-2 で `attemptAnonymousSelfDelete` を集約した際、内部実装依存だった receipt.test の 3 件を helper 境界の assert に書き換えた経緯がある。

## characterization test ファースト

**抽出 / 集約系のリファクタリング前**に、現在の振る舞いを固定化する characterization test を先行追加する。

先例: Phase 4 architect-refactor P1-1 で
[tournament-state.test.ts](../../src/lib/services/tournament-state.test.ts) に
80 件の純関数仕様を先行投入してから、`dashboard-client.tsx` /
`TimerControls.tsx` / `repositories/tournaments.ts` の state 条件式を集約した。

手順:

1. 既存コードの分散している条件式を読み、振る舞いの仕様を抽出
2. 仕様を pure function として `tournament-state.ts` に**仮実装**で先に置く（`return t.state === "setup"` のような直接実装で十分）
3. 仕様に対するテストを先に投入し、green を確認
4. 続く commit で実装を本物に置換し、呼出側を helper 経由に切替

## fixture factory

テスト fixture は factory 関数で生成する。schema の additive 変更（新フィールド追加）でも factory 1 か所更新で済むよう、各テストの object literal に schema 全フィールドを並べない。

```ts
// good
function fakeTournament(overrides: Partial<TournamentDoc> = {}): TournamentDoc {
  return {
    id: "t-1",
    groupId: "g-1",
    state: "setup",
    // ...全フィールドのデフォルト
    ...overrides,
  };
}

// 各テストでは overrides だけを渡す
expect(canPause(fakeTournament({ state: "running" }))).toBe(true);
```

先例: [tournament-state.test.ts](../../src/lib/services/tournament-state.test.ts) の
`tournament(overrides)` / [orchestrator.test.ts](../../src/lib/services/seating/orchestrator.test.ts) の `makePlayer` 等。

## 禁止事項

- **テストの skip / disable / 削除**は禁止。実装詳細依存で壊れたテストは「振る舞いを検証する形に書き換える」 — commit message に「内部実装依存テストの helper 境界化」等と明記すること
- **`console.*` を直接 assert** することはしない（logger 経由のため `vi.spyOn(logger, "warn")` を使う）
- **`Date.now()` / `setInterval` のような時間依存**はテスト中に固定化（vi.useFakeTimers / 引数注入）

## E2E と unit の分担

- **emulator + Playwright が必要な検証は E2E**（rule の allow/deny / 複数端末同期 / fullscreen / cascade delete 等）
- **SDK 呼出形 / 純関数の境界は unit**（`updateDoc` が正しい引数で呼ばれる / `canPause` の真偽値）
- 同じ振る舞いを E2E と unit の両方で重複検証はしない（E2E は遅い / unit は内部詳細に近い、責務が違う）

## 新規機能と test の commit セット

新規機能の実装と test は**同じ commit に含める**（PR 単位ではなく commit 単位）。実装と test がペアで commit history に並ぶことで:

- `git bisect` で回帰の原因 commit を特定しやすい
- 各 commit が「機能 + 検証」の atomic 単位になり revert しても整合
- レビュー時に「この変更で何が担保されているか」が一目で分かる

## E2E 走行のタイミング

- **新機能 PR**: 実装直後と最終マージ前に最低 1 回ずつ
- **architect-refactor**: ベースライン（着手前）と最終検証の 2 回必須。中間 commit は unit + typecheck + lint + build で代替（emulator 起動コストを抑制）
- **bug fix**: 該当 spec が緑になることを確認 + 全件再走行

## 関連 skill

- [tdd-workflow](../skills/tdd-workflow/) — 80%+ coverage を維持しつつ test-first で機能追加する手順
- [e2e-testing](../skills/e2e-testing/) — Playwright + Page Object Model の E2E 設計
- [architect-refactor](../skills/architect-refactor/) — characterization test ファーストでの大規模リファクタリング

## 参照

- ベースライン規約: [error-logging.md](error-logging.md) / [firebase-patterns.md](firebase-patterns.md)
- E2E 設定: [playwright.config.ts](../../playwright.config.ts)
- vitest 設定: [vitest.config.ts](../../vitest.config.ts)
