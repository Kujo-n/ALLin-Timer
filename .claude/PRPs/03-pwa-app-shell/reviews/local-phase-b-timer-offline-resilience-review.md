# Local Code Review: PWA Phase B（Timer Offline Resilience, uncommitted changes）

**Reviewed**: 2026-05-08
**Branch**: develop
**Scope**: 03-pwa-app-shell Phase B — `advanceLevel(auto)` の updateDoc fallback と `<OfflineBanner />`
**Decision**: APPROVE（CRITICAL / HIGH なし、MEDIUM 1 件 / LOW 4 件 → **再対応で M1 / L1 / L2 を解消、残 L3 / L4 のみ**）

## Summary

`runTransaction` 失敗時の **オフライン由来 code に限定した `updateDoc` fallback** と、`fromCache` / `hasPendingWrites` を 1 帯で可視化する `<OfflineBanner />` の追加。設計はプロジェクト規約（error-logging / firebase-patterns / testing）に整合し、AppError の素通し再 throw・rule 違反を queue に隠さない fallback ガード・characterization テストの 5 ケース追加が揃っている。validation（typecheck / lint / 1182 unit tests / build）はすべて green。CRITICAL / HIGH 級のセキュリティ・データ損失リスクは検出されなかった。

**初回レビュー後の対応**:

- **M1 解消** — fallback の `updateDoc` payload から `pausedAt` を除外（オフライン中の他端末 pause race による invariant 違反を予防）。`pausedAccumMs` / `levelStartedAt` / `lastLevelChangeKind` / `updatedAt` のみを書く形に変更し、`tournaments.test.ts` の期待を「`payload` に `pausedAt` キーを含まない」に固定化
- **L1 解消** — `OFFLINE_FIRESTORE_ERROR_CODES` から `aborted` を除外。SDK 内部 retry 後の surface（local cached view が古い可能性）に対し stale view ベースの fallback を行わない設計に整理
- **L2 解消** — plan ドキュメント（completed/）に `failed-precondition` / `aborted` を offline 扱いから除外した経緯を NOTE 注記として追記

## Findings

### CRITICAL

None

### HIGH

None

### MEDIUM

#### M1. オフライン中の外部 state 変更で `state="paused" + pausedAt=null` invariant 違反が発生し得る — **解消済**

[src/lib/firebase/repositories/tournaments.ts:441-471](src/lib/firebase/repositories/tournaments.ts#L441-L471)

**初回所見**: fallback 経路は `levelTransitionUpdates("running", expected + 1, "auto")` で固定的に `pausedAt: null` / `pausedAccumMs: 0` を書き込んでいた。以下シーケンスで invariant 違反 doc が確定するリスク:

1. 端末 A はオフライン、cached `state="running"` / `currentLevel=N` を保持
2. A の `shouldAutoAdvance` が true になり tx 試行 → `unavailable` で reject → fallback `updateDoc` を queue（IndexedDB）
3. その間に別の運営者 B（オンライン）が pause（`state="paused"` / `pausedAt=T_B` を server へ commit）
4. A が回線復帰 → queue が flush され、最終 doc は `state="paused"`（B 由来）/ `pausedAt=null`（A の fallback で上書き）
5. resume 時 [`resumeTournament`](src/lib/firebase/repositories/tournaments.ts#L345-L347) の `if (!t.pausedAt) throw` で `tournament/invalid-state` が発火し再開不可

**対応（解消済）**: fallback 経路を `levelTransitionUpdates` 共通 helper から切り離し、**「level だけ進める」最小限の payload** に絞った:

```ts
await updateDoc(ref, {
  currentLevel: expected + 1,
  levelStartedAt: serverTimestamp(),
  pausedAccumMs: 0,
  lastLevelChangeKind: "auto",
  updatedAt: serverTimestamp(),
});
```

`pausedAt` を touch しないため、オフライン中に他運営者が pause した場合でも `state="paused" / pausedAt=T_B / currentLevel=expected+1` の整合状態に着地する。resume 時は新 level の最初から始まる挙動（`getRemainingMs` の `Math.max(0, T_B - newLevelStartedAt)` が 0 にクランプ）。

`tournaments.test.ts` の期待も「`payload` に `pausedAt` キーを含まない」に更新し、固定化した。意図はコード内コメントで詳述。

### LOW

#### L1. `aborted` を offline 扱いするのは保守的すぎる可能性 — **解消済**

[src/lib/services/firestore-offline.ts:17-23](src/lib/services/firestore-offline.ts#L17-L23)

**初回所見**: `OFFLINE_FIRESTORE_ERROR_CODES` に `aborted` が含まれていたが、Firestore SDK は `runTransaction` 内部で `aborted` に対し最大 5 回の自動 retry を既に行うため、user code に surface する `aborted` は「contention で 5 回連続で失敗した」状態であり、stale な local cached view を信じた fallback は二重 advance race を生む懸念があった。

**対応（解消済）**: `OFFLINE_FIRESTORE_ERROR_CODES` から `aborted` を除外（最終 allowlist は `unavailable` / `cancelled` / `deadline-exceeded` / `internal` の 4 件）。`firestore-offline.test.ts` の non-offline ケースに `aborted` を追加し「fallback 対象外」を明示的に固定化。

#### L2. plan と実装で `failed-precondition` の扱いが食い違う（実装の方が正しい） — **解消済**

[.claude/PRPs/03-pwa-app-shell/plans/completed/phase-b-timer-offline-resilience.plan.md:29-35](../plans/completed/phase-b-timer-offline-resilience.plan.md#L29-L35)

**初回所見**: plan の "Desired state" 節が `failed-precondition` をオフライン由来 code として例示していたが、実装は除外しており、test で「再 throw される」ことを固定化していた（実装の判断が正しい）。

**対応（解消済）**: plan ドキュメントに NOTE 注記を追加し、`failed-precondition` / `aborted` を offline 扱いから除外した経緯と最終 allowlist を明文化（plan は completed/ 配下にあるため追記注記で対応）。

#### L3. fallback 成功時のログが「queue 投入された」ことを明示しない

[src/lib/firebase/repositories/tournaments.ts:451](src/lib/firebase/repositories/tournaments.ts#L451)

tx 成功でも fallback 経由（IndexedDB queue 投入）でも、最終的に `logger.info("advance level ok (auto)", { tid, uid, expected })` が単一形式で出力される。運用デバッグ時に「サーバ commit 済み」と「queue 投入済み（未 flush）」を区別するため、fallback 経路では別 message（例: `"advance level queued (auto offline)"`）を吐くか、`viaFallback: true` を meta に付ける方が後の post-mortem 時に役立つ。`logger.warn("...falling back to updateDoc"...)` は出ているのである程度区別可能だが、warn だけ拾うグレッパーから漏れやすい。

#### L4. `OfflineBanner` の `aria-live` 切替時の screen reader 体験

[src/components/tournament/OfflineBanner.tsx:25-49](src/components/tournament/OfflineBanner.tsx#L25-L49)

`disconnected`（`role="note"` + `aria-live="polite"`）→ `syncing`（`role="status"` + `aria-live="polite"`）→ `null` へ遷移する設計。bool-switch でコンポーネントが unmount/mount されるため、screen reader によっては短時間に「通信が一時切れています…同期中…」が連続読みされ、ユーザーがフレーズを取り違える可能性。実害は低いが、`<section>` を 1 つだけ描画して中身（icon + text）を切り替える形にすれば aria-live region の update として聞こえ方が安定する。WCAG AA 必須項目ではないので Phase B での fix 必須ではない。

## Validation Results

| Check      | Result                  |
| ---------- | ----------------------- |
| Type check | ✅ Pass（tsc --noEmit zero error） |
| Lint       | ✅ Pass（next lint zero warnings/errors） |
| Tests      | ✅ Pass（1182 / 1182、新規 22 件 green） |
| Build      | ✅ Pass（Next.js production build clean） |

## Files Reviewed

| File | Change | 評価 |
| ---- | ------ | ---- |
| `src/lib/services/firestore-offline.ts` | Added | OFFLINE_FIRESTORE_ERROR_CODES allowlist + `firestore/` prefix 形両対応、`readonly string[]` で immutable。L1 対応で `aborted` を除外し最終 4 件に |
| `src/lib/services/firestore-offline.test.ts` | Added | offline / non-offline / prefix / unknown を 13 件で固定化。`it.each` 活用が適切。L1 対応で `aborted` を non-offline ケースに移動 |
| `src/components/tournament/OfflineBanner.tsx` | Added | 3 状態（disconnected / syncing / null）を一帯で出し分け、`role` / `aria-live` / `aria-hidden` 適切。L4 のみ |
| `src/components/tournament/OfflineBanner.test.tsx` | Added | online / offline / 同期中 / 両 true 時の disconnected 優先を 4 件で固定化 |
| `src/lib/firebase/repositories/tournaments.ts` | Modified | tx → updateDoc fallback を `try/catch` + AppError 素通し + offline code 限定で実装。M1 対応で fallback payload から `pausedAt` を除外（pause race 予防） |
| `src/lib/firebase/repositories/tournaments.test.ts` | Modified | Phase B 用 5 ケース（offline fallback 成功 / deadline-exceeded / AppError 素通し / non-offline 再 throw / 二重失敗）。mock 境界が SDK 直叩きで既存パターンと整合。M1 対応で payload 期待を「`pausedAt` キーを含まない」に更新 |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | Modified | `<main>` 直下に `<OfflineBanner />` mount、`hasPendingWrites` を hook から destructure |
| `src/app/tournaments/[tid]/live/live-client.tsx` | Modified | dashboard と同方針。`<header>` の前ではなく `<main>` 直下に置くことで参加者ビューでも自然な層構造 |
| `.claude/PRPs/03-pwa-app-shell/prds/03-pwa-app-shell.prd.md` | Modified | Phase B 進捗表更新のみ |
| `.claude/PRPs/03-pwa-app-shell/plans/completed/phase-b-timer-offline-resilience.plan.md` | Added | 完了 plan（参照ドキュメント） |
| `.claude/PRPs/03-pwa-app-shell/reports/phase-b-timer-offline-resilience-report.md` | Added | 実装レポート（参照ドキュメント） |

## Strengths（参考までに）

- **AppError の素通し再 throw**（[tournaments.ts:431](src/lib/firebase/repositories/tournaments.ts#L431)）が明示的に書かれており、rule 違反 / not-found を queue に隠す事故を仕組みで予防している
- **`isOfflineFirestoreErrorCode` を pure function に切り出し**、`firestore/` prefix の有無両対応で test しやすい設計
- **fallback の `updateDoc` を `wrapFirestoreWrite` の op 内に配置**することで、二重失敗時の `firestore/write_failed` ラップが自動的に効く
- **plan の Mandatory Reading / KEY_INSIGHT が実装に正確に反映**されており、特に `permission-denied` を queue に流さない設計判断は plan の意図を正しく実装している
- **新規テストの mock 境界が SDK 直叩き**（`vi.mocked(runTransaction).mockRejectedValueOnce(...)` / `vi.mocked(updateDoc).mockResolvedValueOnce(...)`）で既存テストと整合
- **OfflineBanner の文言**が技術スタック名（Firebase / Firestore）を露出させない方針に従っている

## Next Steps

- ~~M1（pause race window）の `pausedAt` を fallback で touch しない改修~~ → **解消済**（fallback 専用 payload を inline で構築、`tournaments.test.ts` の期待を更新）
- ~~L1 `aborted` の allowlist 除外~~ → **解消済**（最終 allowlist は 4 件: `unavailable` / `cancelled` / `deadline-exceeded` / `internal`）
- ~~L2 plan の `failed-precondition` 注記~~ → **解消済**（plan に NOTE 追記）
- L3（fallback 経路ログの区別）/ L4（aria-live 切替体験）は immediate fix なし、PR description に "Known follow-ups" として列挙
- DevTools Network → Offline で「ブラインドが進む / amber バナー / 復帰時の blue → 消える」を実機で目視確認（report の Next Steps 通り）
- Vercel preview で同上を実機検証 → `/prp-pr` で PR 作成
