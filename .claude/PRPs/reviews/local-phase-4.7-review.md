---
title: Phase 4.7 Local Code Review
date: 2026-04-23
scope: uncommitted changes on `develop` (Phase 4.7 Onboarding Polish & Structure Enhancements)
decision: APPROVE with comments (no CRITICAL/HIGH blockers, validation clean)
---

# 概要

Phase 4.7 の onboarding polish / structure 拡張（break 対応・rebuy/addOn スタック・平均スタック
カード・group.memberDisplayNames snapshot・Google 新規ユーザー displayName ダイアログ・
`/tournaments` 一覧の状態別視認性）に関するレビュー。

- 変更ファイル: 34 files（+681 / −1745）。実コード差分はコンパクトで、削除の多くは計画
  ドキュメントの completed/ への移動分。
- 実装は PRD / plan / rules（firebase-patterns / group-membership / error-logging）に沿っており、
  schema × repository × Firestore Rules を同一 PR 内で同時更新している。
- 新規ファイル: `DisplayNameDialog.tsx`、`AverageStackCard.tsx`（+ `.test.tsx`）、Phase 4.7
  report、completed plan。

## 検証結果

| Check      | Result |
| ---------- | ------ |
| Type check | Pass (`tsc --noEmit`) |
| Lint       | Pass (`next lint`: no warnings) |
| Tests      | Pass (`vitest`: 338/338, 19 files) |
| Build      | Pass (`next build`) |

## 決定

**APPROVE with comments** — マージ前に必須の修正はないが、MEDIUM 3 件は実運用前に
対応推奨（特に M1 は legacy doc を持つステージング / 本番の挙動確認が必要）。

---

# Findings

## CRITICAL

なし。

## HIGH

なし。

## MEDIUM

### M1 — legacy group doc（Phase 4.6.0 以前）で self-leave / self-update rule が落ちる可能性

**場所**: [firestore.rules:93-96](firestore.rules#L93-L96), [firestore.rules:125-128](firestore.rules#L125-L128), [firestore.rules:140-143](firestore.rules#L140-L143)

self-add / self-leave / 新規 self-update の 3 ブランチでいずれも:

```
request.resource.data.memberDisplayNames
     .diff(resource.data.get('memberDisplayNames', {}))
     .affectedKeys()
     .hasOnly([request.auth.uid])
```

と書かれている。`resource.data.get(..., {})` 側は default を持つが、
`request.resource.data.memberDisplayNames` は直接アクセスで、書込ペイロードに
`memberDisplayNames` を含まない場合は null 扱いとなり `.diff()` が error で
当該ブランチが false に落ちる。

[groups.ts:144-158](src/lib/firebase/repositories/groups.ts#L144-L158) の `removeMemberSelf` は
`[\`memberDisplayNames.${uid}\`]: deleteField()` で dotted-path 書込しているが、
親 map が元 doc に存在しない場合 Firestore は親を作らず no-op とする挙動があり、
legacy doc（`memberDisplayNames` フィールド無し）では request.resource 側にも
field が無いままとなる可能性がある。

**影響範囲**:
- Phase 4.6 時代に作られた group から Phase 4.7 以降に脱退（self-leave）しようと
  すると permission-denied になる可能性。
- 同様に Phase 4.7 の self-update displayName も legacy group では rule 通過しない。

**推奨修正**（いずれか）:
1. rule 側も `.get()` で guard:
   ```
   request.resource.data.get('memberDisplayNames', {})
       .diff(resource.data.get('memberDisplayNames', {}))
       .affectedKeys()
       .hasOnly([request.auth.uid])
   ```
2. `removeMemberSelf` / `setMemberDisplayName` で明示的に `memberDisplayNames: {}`
   を先行書込する backfill migration を実装する。
3. 既存 doc に `memberDisplayNames: {}` を一括セットする migration スクリプトを
   deploy 前に走らせる。

Phase 2.5 先例（互換レイヤは作らない）に従うなら案 3 推奨。いずれにせよ
**rules emulator + legacy shape fixture でテストを追加**してから deploy する
ことを強く推奨。

### M2 — `memberDisplayNames` への email フォールバックによる PII 暴露

**場所**:
- [group.ts:44-47](src/lib/services/group.ts#L44-L47) (`createGroupWithOwner`)
- [group.ts:97-99](src/lib/services/group.ts#L97-L99) (`consumeJoinCode`)

```typescript
const ownerDisplayName =
  authUser?.displayName?.trim() || authUser?.email || ownerUid;
// ...
const selfDisplayName =
  authUser?.displayName?.trim() || profile?.displayName?.trim() || authUser?.email || uid;
```

displayName 未設定ユーザーの email（実メールアドレス）が `memberDisplayNames` に
書き込まれ、group のメンバー全員に読み取られる（`groups/{gid}` read rule は
memberUids 全員許可）。ユーザーが仕事用メールで登録していた場合などに意図しない
暴露となる。

**推奨修正**: email へのフォールバックをやめ、`uid` もしくは `"ゲスト-<uid短縮>"`
のような非 PII 文字列に置換する。Google 新規ユーザー向け DisplayNameDialog が
追加されたため、通常フローでは displayName が確実に埋まる前提が成立しており
email フォールバックは不要。

### M3 — `memberDisplayNames` 値の型・長さ・空文字制約が rule / schema で不十分

**場所**:
- [firestore.rules:93-96 / 125-128 / 140-143](firestore.rules) — rule は affectedKeys のみ検証
- [group.ts:26](src/lib/firebase/schemas/group.ts#L26) — `z.record(z.string().min(1), z.string())`
  値に `.min(1)` / `.max(N)` なし

結果として既メンバーは自分の entry に任意長の文字列（1MB 近く）を書き込める。

- **DoS**: 2 人が 500KB ずつ書けば doc が 1MB limit を超え、他メンバーの書込も
  失敗させられる。
- **空文字表示抜け**: 後述 L1 と連動。

**推奨修正**: rule 側で以下のいずれかを追加:
```
&& request.resource.data.memberDisplayNames[request.auth.uid] is string
&& request.resource.data.memberDisplayNames[request.auth.uid].size() >= 1
&& request.resource.data.memberDisplayNames[request.auth.uid].size() <= 60
```
併せて schema も `z.string().min(1).max(60)` に揃える（name と同じ制約）。

## LOW

### L1 — `nameMap[uid] ?? uid` は空文字を弾かない

**場所**: [group-detail-client.tsx:78-81](src/app/groups/[gid]/group-detail-client.tsx#L78-L81)

```typescript
const lines: MemberLine[] = g.memberUids.map((uid) => ({
  uid,
  displayName: nameMap[uid] ?? uid,
}));
```

`??` は null / undefined のみ fallback で、`""` は通る。M3 の対策で値が
non-empty 保証されれば不要だが、現状では `nameMap[uid] || uid` にする方が安全。

### L2 — `propagateDisplayNameToGroups` の失敗粒度が粗い

**場所**: [group.ts:139-158](src/lib/services/group.ts#L139-L158)

partial fail 時は total / failed カウントのみログ。どの gid で失敗したか・
どの error code で失敗したかが分からず debug しづらい。

```typescript
results.forEach((r, i) => {
  if (r.status === "rejected") {
    logger.warn("propagate displayName per-group fail", {
      gid: groupIds[i], uid,
      code: (r.reason as { code?: string })?.code ?? "unknown",
    });
  }
});
```

のように展開しておく方が M1 のようなトラブルシュートに効く。

### L3 — `createStructure` は undefined → null 正規化するが `updateStructure` はそのまま

**場所**: [structures.ts:29-45](src/lib/firebase/repositories/structures.ts#L29-L45) vs
[structures.ts:92-101](src/lib/firebase/repositories/structures.ts#L92-L101)

```typescript
// createStructure: 正規化あり
rebuyStack: input.rebuyStack ?? null,
addOnStack: input.addOnStack ?? null,
// updateStructure:
await updateDoc(doc(structuresRef, sid), patch);  // そのまま
```

StructureForm は `rebuyStack: null` を明示的に送るため現行動線ではバグにはならないが、
非対称な処理は将来の呼び出し時にハマりどころ。`updateStructure` 側でも ?? null を
入れるか、呼び出し時正規化を repository で統一するのが望ましい。

### L4 — AuthProvider の useMemo が `state` オブジェクト参照に依存

**場所**: [AuthProvider.tsx:57-65](src/lib/firebase/AuthProvider.tsx#L57-L65)

```typescript
const value = useMemo<AuthState>(
  () => ({
    user: firebaseAuth.currentUser ?? state.user,
    loading: state.loading,
    refreshUser,
  }),
  [state, bump, refreshUser],
);
```

`[state, ...]` の deps は `state` オブジェクト参照比較。onAuthStateChanged が毎回新しい
`{user, loading}` オブジェクトを setState する実装なので動作はするが、
`[state.user, state.loading, bump, refreshUser]` と書く方が意図が明確。
eslint-disable も不要になる可能性あり。

### L5 — `/tournaments` 一覧の状態別視認性は色依存を避けているが、スクリーンリーダー配慮もう一歩

**場所**: [tournaments-client.tsx:11-60](src/app/tournaments/tournaments-client.tsx#L11-L60)

日本語ラベル（進行中 / 一時停止 / 終了 / 席決め中 / 未開催）で色覚依存を避けている
のは good。一方、card 全体に `aria-label` や `role="group"` が付いていないため SR で
「トーナメント名 進行中 … ボタン」と並列で読まれる。card に `aria-label={\`${t.name}\（${tone.label}）\`}`
を足すとアクセシビリティがさらに向上する（accessibility skill との整合）。

## INFO（参考）

- `TimerDisplay` の break 表示は `aria-hidden` を emoji span に付けていて SR への影響を
  正しく処理している（good）。
- `levelSchema` の refine で `!isBreak || bb > 0` を逆向き（`isBreak || bb > 0`）に
  書いているが等価。テストも両方カバーしている。
- `AverageStackCard` は state guard（running / paused のみ表示）と active players 0 ガードを
  両方持っており safe。テスト 7 ケースで全パスカバー済み。
- `getAdditionalUserInfo(cred)?.isNewUser ?? false` は SDK の型が `boolean | undefined`
  を返しうる箇所で nullish 扱い。妥当。
- 旧 `signInWithGoogle` の `users/{uid}` 上書き廃止は **意図的な動作変更**であり、
  既存ユーザーがサークル用に変更した displayName が Google ログイン時に戻される
  既知バグの修正として妥当。PR 説明 / コミットメッセージに「既存ユーザーは
  Google プロフィール同期をやめた」旨を明示しておくと運用時の誤解が減る。

---

# 次アクション

優先度順:

1. **M1**: legacy group doc のマイグレーション方針を決定（rule 書き換え or backfill migration）。
   deploy 前に emulator で self-leave / self-update の両ケースを fixture（memberDisplayNames
   なし）で再現テスト。
2. **M2**: email フォールバックを uid ベースに置換（1-line 修正）。
3. **M3**: rule + schema に長さ制約（max 60）を追加（name と同じ扱い）。
4. **L1-L5**: 合わせて対応するか、別 PR で cleanup。

CRITICAL / HIGH 無しのためブロックなし。APPROVE with required follow-ups を推奨。
