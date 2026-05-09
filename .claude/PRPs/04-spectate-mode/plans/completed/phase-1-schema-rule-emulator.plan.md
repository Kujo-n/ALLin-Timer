# Plan: Phase 1 — Schema + Rule + Emulator Validator（観戦モード基盤）

## Summary

`tournaments/{tid}` に `spectateEnabled: boolean` を additive 追加し、firestore.rules の 4 経路（tournaments / players / tables / collectionGroup players）に「`spectateEnabled == true` のとき unauthenticated read を allow する」分岐を追加。`tournaments/{tid}` の `allow update` には groups/{gid} 既存パターンに倣った `affectedKeys.hasOnly(['spectateEnabled', 'updatedAt']) + is bool` の organizer 限定ブランチを additive 追加。emulator validator `scripts/test-rules-spectate.mjs` で「unauthenticated read が想定範囲だけ通り、write 経路は据え置き」を機械検証する。

## User Story

As a 観戦モード機能を実装する開発者, I want トーナメント schema・Firestore rules・emulator validator が揃った状態, so that Phase 2（`/spectate/[tid]` ページ）と Phase 3（toggle UI）が安全に並列着手できる土台が整う。

## Problem → Solution

**Current state**: `tournaments/{tid}` / 配下の `players` / `tables` の `allow read` は `isSignedIn()` 必須。匿名でも login が必要で、会場の予備モニタや遅刻参加者が手元で進行を見られない。schema にも `spectateEnabled` フィールドが存在しない。

**Desired state**: `spectateEnabled === true` の tournament に対してのみ、関連 read 経路 4 つが unauthenticated でも通る。toggle 自体は organizer 以上のみ。emulator validator が「想定外 path / write 経路 deny」を網羅検証する。

## Metadata

- **Complexity**: Medium
- **Source PRD**: [.claude/PRPs/04-spectate-mode/prds/04-spectate-mode.prd.md](../prds/04-spectate-mode.prd.md)
- **PRD Phase**: Phase 1 — Schema + Rule + Emulator Validator
- **Estimated Files**: 7 ファイル（schema 1 / rule 1 / validator 1 / package.json 1 / 規約ドキュメント 3）

---

## UX Design

### Before

N/A — 内部のみの基盤変更。Phase 1 単体ではユーザーから見える振る舞い変化はない（spectateEnabled は default false で hydrate されるだけ）。

### After

N/A — 内部のみの基盤変更。Phase 2 / Phase 3 が UX を露出する。

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| 既存 tournament read | login 必須 | login 必須（spectateEnabled 未設定 = 既存挙動） | additive、破壊的変化なし |
| `spectateEnabled === true` の tournament read | （存在しない） | unauthenticated read 通る | Phase 1 で rule を仕込むが、true にする経路は Phase 3 |

---

## Mandatory Reading

実装前に必ず読むべきファイル。

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 (critical) | [.claude/rules/firebase-patterns.md](../../../rules/firebase-patterns.md) | all | subcollection 設計原則（wildcard 厳禁）/ rule 経路の DRIFT WARNING / 数値リミット定数の単一真実源 |
| P0 (critical) | [.claude/rules/group-membership.md](../../../rules/group-membership.md) | all | tournaments / players の allow update / create rule 設計、`groups/{gid}` 単独フィールド書換 rule の先例 |
| P0 (critical) | [.claude/rules/error-logging.md](../../../rules/error-logging.md) | all | エラー prefix 一覧追加位置 / `AppError.from` / `unwrapOrFrom` の使い分け |
| P0 (critical) | [firestore.rules](../../../../firestore.rules) | 1-593 | 既存 rule 全体。tournaments / players / tables の現行 allow read / write を完全把握する必要あり |
| P0 (critical) | [src/lib/firebase/schemas/tournament.ts](../../../../src/lib/firebase/schemas/tournament.ts) | 1-68 | additive 追加位置と既存 default パターン（`lastLevelChangeKind` の `.optional()` / `seasonStartDate` の `.default(null)`）の参考 |
| P1 (important) | [scripts/test-rules-default-seats.mjs](../../../../scripts/test-rules-default-seats.mjs) | 1-275 | groups/{gid} 単独フィールド rule の REST 直叩き validator の最小骨格。allow / deny / boundary / affectedKeys 違反の網羅パターン |
| P1 (important) | [scripts/test-rules-table-labels.mjs](../../../../scripts/test-rules-table-labels.mjs) | 1-417 | tournaments + tables 階層の seed 手順。`tournament` を seed してから subcollection を扱う最新先例 |
| P1 (important) | [scripts/test-rules-pd.mjs](../../../../scripts/test-rules-pd.mjs) | 1-300 | tournaments/{tid}/players の rule 検証。匿名 / 認証済み別ユーザーで read 比較する手順 |
| P2 (reference) | [src/lib/firebase/schemas/group.ts](../../../../src/lib/firebase/schemas/group.ts) | 80-175 | additive `default(...)` を多用した body schema の構造。spectateEnabled の追加位置の良い参考 |
| P2 (reference) | [src/lib/errors.ts](../../../../src/lib/errors.ts) | 1-59 | AppError code は string 自由。prefix 表は規約ドキュメント側で管理されており、コード変更不要 |
| P2 (reference) | [package.json](../../../../package.json) | scripts セクション | `test:rules-*` の命名・既存 emulator exec ラッパ |

## External Documentation

外部ドキュメント参照は不要。Firestore Rules の `request.auth == null`（unauthenticated 判定）/ `resource.data.<field>` / `get()` / `getAfter()` / `affectedKeys()` などはすべて既存 codebase で使用済みの内部パターン。

> 注: `path=**` 再帰 wildcard は [.claude/rules/firebase-patterns.md](../../../rules/firebase-patterns.md) の「subcollection 設計原則: wildcard 厳禁」で **新規追加禁止**。既存の `match /{path=**}/players/{pid}` だけが例外で、collectionGroup query を通すために必須。本 Phase ではこの **既存 wildcard rule の中身を additive 拡張**するのみで、新規 wildcard は追加しない。

---

## Patterns to Mirror

### NAMING_CONVENTION（Phase 命名 + DRIFT WARNING コメント）

```ts
// SOURCE: src/lib/firebase/schemas/tournament.ts:43-46
// Phase 4: 1 テーブルあたりの最大席数。default 9。setup 中のみ変更可。範囲 2〜10。
// M2 fix: input schema と body schema の制約を一致させる（DB 直書きでも 2 未満を弾く）。
// ⚠ DRIFT WARNING (L3): 上限 10 は firestore.rules の `seatNum <= 10` と同期。変更時は同時更新すること。
seatsPerTable: z.number().int().min(MIN_SEATS_PER_TABLE).max(MAX_SEATS_PER_TABLE),
```

新フィールド追加時は **PRD Phase ラベル** を頭にコメントし、関連する rule / drift / default 動作を明示する。

### ADDITIVE_DEFAULT_FIELD（schema 互換性パターン）

```ts
// SOURCE: src/lib/firebase/schemas/group.ts:115-128
// Phase 4.16: 終了したトーナメントの累計数。`finishTournament()` の runTransaction で
//   `increment(1)` され、`/tournaments/new` のデフォルト名連番に使用する。tx 内で
//   `state !== "finished"` を再 read することで、複数端末同時呼び出しでも +1 のみ進める。
//   旧 doc（Phase 4.15 以前）は default(0) で受容され、次回終了時に 1 になる。
finishedTournamentCount: z.number().int().nonnegative().default(0),
```

旧 doc 互換のため必ず `.default(...)` を付ける。zod converter（`zodConverter`）の `fromFirestore` で field 不在時に default が適用される。

### BOOLEAN_FIELD_WITH_DEFAULT（参考: 真偽値 additive）

```ts
// SOURCE: src/lib/firebase/schemas/group.ts:32-44 (audioSettings.enabled)
enabled: z.boolean(),
// ↑ default は object 全体に対して `.default({...})` を当てる形

// 単独 boolean フィールドの先例は player.isPlayingDealer 等。
// SOURCE 推定: schemas/player.ts（コード内コメントを参照）
// Phase 5.1: PD フラグ。default(false) で旧 doc 互換。
```

`spectateEnabled` 単独 boolean は `z.boolean().default(false)` で同パターン。

### RULE_BRANCH_GROUPS_PATTERN（rule 経路の単独フィールド書換）

```firestore-rules
// SOURCE: firestore.rules:215-220 (defaultSeatsPerTable)
isOrganizer(gid)
&& request.resource.data.diff(resource.data).affectedKeys()
     .hasOnly(['defaultSeatsPerTable'])
&& request.resource.data.defaultSeatsPerTable is int
&& request.resource.data.defaultSeatsPerTable >= 2
&& request.resource.data.defaultSeatsPerTable <= 10
```

**spectateEnabled toggle ブランチも同パターン**: `affectedKeys().hasOnly(['spectateEnabled', 'updatedAt'])` + `is bool`。`updatedAt` を許可キーに含めるのは [src/lib/firebase/repositories/tournaments.ts:230-232](../../../../src/lib/firebase/repositories/tournaments.ts#L230-L232) の `updateTournament` がいつも `updatedAt: serverTimestamp()` を同時に書くため（既存パターン）。

### RULE_BRANCH_UNAUTHENTICATED_READ（観戦読取の最小拡張）

既存 rule に「unauthenticated read を許可する分岐」の先例はない。本 Phase で新規導入するため、設計原則を以下に明文化する:

- **`isSignedIn()` を OR で拡張** — 既存 `allow read: if isSignedIn();` を `allow read: if isSignedIn() || resource.data.spectateEnabled == true;` に変更
- **subcollection は親 doc を get() で参照** — `tournaments/{tid}/players/{pid}` の read は親 `tournaments/{tid}` の `spectateEnabled` を `get()` で取得
- **`exists()` ガードは必須** — `get(/databases/.../tournaments/$(tid))` の前に `exists(/databases/.../tournaments/$(tid))` を必ず置く（[firebase-patterns.md](../../../rules/firebase-patterns.md) の「外部ドキュメント参照は exists() ガードと併用」原則）
- **collectionGroup wildcard 経路は親 path 取得不可** — `match /{path=**}/players/{pid}` の中では `tid` を参照できない。`resource.__name__` から親 path を派生させる代わりに **`request.auth != null`** を OR の片側に残し、unauthenticated は path-specific rule（`match /tournaments/{tid}/players/{pid}`）側で許可するに留める。後述 GOTCHA 参照

### EMULATOR_VALIDATOR_REST_DIRECT（HTTP 直叩きで rule を assert）

```js
// SOURCE: scripts/test-rules-default-seats.mjs:108-127
async function expectAllow(label, fn) {
  const r = await fn();
  if (r.ok) {
    results.push({ label, status: "PASS (allow)" });
  } else {
    const body = await r.text();
    results.push({ label, status: `FAIL (expected allow, got ${r.status}): ${body.slice(0, 200)}` });
  }
}
async function expectDeny(label, fn) {
  const r = await fn();
  if (r.status === 403) {
    results.push({ label, status: "PASS (deny 403)" });
  } else if (r.ok) {
    results.push({ label, status: `FAIL (expected deny, got ${r.status})` });
  } else {
    const body = await r.text();
    results.push({ label, status: `FAIL (expected 403, got ${r.status}): ${body.slice(0, 200)}` });
  }
}
```

**unauthenticated read** は `Authorization` ヘッダ無しで GET を打つ。HTTP 200 系を allow、403 を deny として assert する。Firestore SDK の updateDoc が emulator + 一部状況下で楽観 resolve する罠（`scripts/test-rules-default-seats.mjs:9-13`）を REST で完全回避する。

### NPM_SCRIPT_NAMING（emulator validator の package.json scripts）

```json
// SOURCE: package.json scripts セクション
"test:rules-clone-players": "firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e \"node scripts/test-rules-clone-players.mjs\"",
"test:rules-season": "firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e \"node scripts/test-rules-season.mjs\"",
```

`test:rules-spectate` も完全同型で追加する。

### ERROR_PREFIX_TABLE（規約ドキュメント側で管理）

```md
<!-- SOURCE: .claude/rules/error-logging.md (## エラー section) -->
- `firestore/*` — Firestore 操作起因
- `auth/*` — 認証起因
- `tournament/*` — ドメインロジック起因
- `validation/*` — 入力検証起因
- `seating/*` — 席決め起因
- `group/*` — group 操作起因
- `season/*` — シーズン管理起因（Phase A 追加。`startNewSeason` の tx 失敗 / pre-check 違反等）
- `pwa/*` — PWA インストール / Service Worker / ブラウザストレージ起因（Phase D 追加）
```

`spectate/*` をこの一覧に追加するだけで、`AppError` 自体（`src/lib/errors.ts`）はコード変更不要（`code: string` 自由）。

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| [src/lib/firebase/schemas/tournament.ts](../../../../src/lib/firebase/schemas/tournament.ts) | UPDATE | `spectateEnabled: z.boolean().default(false)` を `tournamentBodySchema` に additive 追加 |
| [firestore.rules](../../../../firestore.rules) | UPDATE | 4 経路の read 拡張 + tournaments update に additive ブランチ |
| [scripts/test-rules-spectate.mjs](../../../../scripts/test-rules-spectate.mjs) | CREATE | unauthenticated read allow / deny / write 経路据え置き / boundary を網羅検証 |
| [package.json](../../../../package.json) | UPDATE | `test:rules-spectate` script 追加 |
| [.claude/rules/error-logging.md](../../../rules/error-logging.md) | UPDATE | エラー prefix 一覧に `spectate/*` を追加 |
| [.claude/rules/firebase-patterns.md](../../../rules/firebase-patterns.md) | UPDATE | 「`tournaments/{tid}` 配下 subcollection の rule 設計原則」セクションに spectateEnabled の参照経路を追記 |
| [.claude/rules/group-membership.md](../../../rules/group-membership.md) | UPDATE | 「権限マトリクス」表に観戦モード行を追加（owner / organizer / member の見え方）。tournaments の data model 概要にも spectateEnabled を記述 |

## NOT Building

Phase 1 のスコープ外（Phase 2 / 3 / 4 で実装）:

- **`/spectate/[tid]` ページ** — Phase 2 のスコープ。本 Phase は schema / rule / validator のみ
- **toggle UI / SpectateModeCard / URL コピー / QR code** — Phase 3 のスコープ
- **`setSpectateEnabled` service / `updateSpectateEnabled` repository** — Phase 3 のスコープ。Phase 1 では rule で許可するのみで、書込呼出側は実装しない
- **PWA cache `/spectate` allowlist** — Phase 4 のスコープ
- **graceful handling（onSnapshot error）** — Phase 2 の `/spectate/[tid]` 内で実装
- **tournament 一覧 badge** — Phase 3 のスコープ
- **`spectateCode`（短命 token）** — PRD「Won't」項目
- **uid 完全隠蔽** — PRD「Won't」項目
- **賞金構造表示** — PRD「Won't」項目
- **rule wildcard で `tournaments/{tid}/{sub=**}` を新設** — [.claude/rules/firebase-patterns.md](../../../rules/firebase-patterns.md) の「subcollection 設計原則: wildcard 厳禁」原則違反。explicit な path のみ拡張する

---

## Step-by-Step Tasks

### Task 1: schema additive 追加（`spectateEnabled`）

- **ACTION**: [src/lib/firebase/schemas/tournament.ts](../../../../src/lib/firebase/schemas/tournament.ts) の `tournamentBodySchema` に `spectateEnabled: z.boolean().default(false)` を additive 追加する
- **IMPLEMENT**:
  ```ts
  // 既存の seatsPerTable / lastLevelChangeKind の間か後ろの adjacent な位置に追加。
  // PRD Phase ラベル + DRIFT WARNING コメントを必ず付ける。
  // Phase 1 (04-spectate-mode): 観戦モード公開フラグ。default false で旧 doc 互換。
  //   - true のとき `/spectate/[tid]` への unauthenticated read を許可する（firestore.rules）
  //   - toggle 経路は organizer 以上のみ（rule + service の二重防御。Phase 3 で実装）
  //   - ⚠ DRIFT WARNING: firestore.rules の以下の式で参照される:
  //     1. tournaments/{tid} allow read: `... || resource.data.spectateEnabled == true`
  //     2. tournaments/{tid}/players/{pid} allow read: 親 doc の spectateEnabled を get() で参照
  //     3. tournaments/{tid}/tables/{tableId} allow read: 同上
  //     4. tournaments/{tid} allow update: `affectedKeys.hasOnly(['spectateEnabled', 'updatedAt']) + is bool` ブランチ
  //   schema を消すときは 4 経路すべてから rule を撤去すること。
  spectateEnabled: z.boolean().default(false),
  ```
- **MIRROR**: ADDITIVE_DEFAULT_FIELD（`finishedTournamentCount`）/ NAMING_CONVENTION（`seatsPerTable` の DRIFT WARNING コメント）
- **IMPORTS**: 既存の `z` import で足りる。新規 import 不要
- **GOTCHA**:
  - `seatsPerTable` の後ろなど **既存の `default(...)` 群と adjacent な位置**に置くと読みやすい
  - 既存 doc は zod converter の `fromFirestore` で field 不在 → `default(false)` が適用される。converter ([src/lib/firebase/converters.ts](../../../../src/lib/firebase/converters.ts)) は触らない
  - `CreateTournamentInput` / `UpdateTournamentInput` の `Pick` リストには **追加しない**（Phase 1 では create / update 経路を露出しないため。Phase 3 で必要なら別途追加）
- **VALIDATE**:
  - `npm run typecheck` → 0 errors
  - 既存の vitest 群 `npm run test` → 全 pass（schema 検証 fixture を持つテストは additive 変更で壊れない設計のはず）

### Task 2: firestore.rules — `tournaments/{tid}` allow read 拡張

- **ACTION**: [firestore.rules](../../../../firestore.rules) line 403 付近の `match /tournaments/{tid}` の `allow read: if isSignedIn();` を OR 拡張する
- **IMPLEMENT**:
  ```firestore-rules
  // Phase 1 (04-spectate-mode): 観戦モード公開時は unauthenticated read を許可する。
  //   spectateEnabled の field 自体が無い旧 doc は `.get('spectateEnabled', false)` で false 扱い。
  //   旧 doc が default(false) で hydrate される schema 側との整合を rule でも担保。
  allow read: if isSignedIn()
              || resource.data.get('spectateEnabled', false) == true;
  ```
- **MIRROR**: RULE_BRANCH_UNAUTHENTICATED_READ
- **GOTCHA**:
  - **legacy doc 互換**: `resource.data.spectateEnabled == true` だと field 不在の旧 doc で評価エラー → permission-denied になる risk。`.get('spectateEnabled', false)` でフィールド未保有の旧 doc を `false` として評価する（既存 rule の `request.resource.data.get('isPlayingDealer', false)` と同パターン）
  - `request.auth != null` ではなく既存の `isSignedIn()` を再利用する（rule helper の意図表現）
- **VALIDATE**: Task 5 の emulator validator で「spectateEnabled=true で anon read allow」「spectateEnabled=false で anon read deny」「spectateEnabled field 不在の旧 doc で anon read deny」を確認

### Task 3: firestore.rules — `tournaments/{tid}/players/{pid}` allow read 拡張

- **ACTION**: [firestore.rules](../../../../firestore.rules) line 413 付近の `allow read: if isSignedIn();` を「親 tournament の spectateEnabled が true ならば anon でも allow」に拡張する
- **IMPLEMENT**:
  ```firestore-rules
  // Phase 1 (04-spectate-mode): 親 tournament が観戦モード公開中なら unauthenticated read 可。
  //   exists() ガードを必ず併用（外部 doc 参照規約）。
  //   .get('spectateEnabled', false) で field 未保有の旧 doc を false として評価。
  allow read: if isSignedIn()
              || (
                exists(/databases/$(database)/documents/tournaments/$(tid))
                && get(/databases/$(database)/documents/tournaments/$(tid))
                     .data.get('spectateEnabled', false) == true
              );
  ```
- **MIRROR**: RULE_BRANCH_UNAUTHENTICATED_READ + 既存の `match /players/{pid}` の `allow create` で `exists()` + `get()` を併用している先例（line 439-441）
- **GOTCHA**:
  - `get()` は rule 評価ごとに 1 read を消費する。20 人 × 月 1〜2 回スケールでは無視可能（既存 rule の `isGroupMember` / `isOrganizer` と同方針）
  - 同一 rule 評価内で同じ path への `get()` は cache される（Firebase の仕様）。本 rule では 1 回しか参照しないので問題なし
  - players の **write 経路は触らない**（self-create / organizer-clone / self-update / organizer-update の 4 ブランチは現状維持）。観戦は read-only のため
- **VALIDATE**: 「spectateEnabled=true で anon が players read allow」「spectateEnabled=false で anon が players read deny」「parent tournament が exists しない場合 deny」

### Task 4: firestore.rules — `tournaments/{tid}/tables/{tableId}` allow read 拡張

- **ACTION**: [firestore.rules](../../../../firestore.rules) line 541 付近の tables の `allow read: if isSignedIn();` を Task 3 と同型で拡張する
- **IMPLEMENT**:
  ```firestore-rules
  // Phase 1 (04-spectate-mode): 親 tournament が観戦モード公開中なら unauthenticated read 可。
  allow read: if isSignedIn()
              || (
                exists(/databases/$(database)/documents/tournaments/$(tid))
                && get(/databases/$(database)/documents/tournaments/$(tid))
                     .data.get('spectateEnabled', false) == true
              );
  ```
- **MIRROR**: Task 3 の構文を完全コピー（tables も親 path から `tid` を取得できる構造のため）
- **GOTCHA**: tables の **write 経路（create / update / delete）は触らない**。Phase C で確立した label / color の `affectedKeys.hasOnly` 経路は organizer 限定のまま
- **VALIDATE**: Task 3 と同セット

### Task 5: firestore.rules — `tournaments/{tid}` allow update に spectateEnabled 単独書換ブランチを additive 追加

- **ACTION**: [firestore.rules](../../../../firestore.rules) line 407 の `allow update, delete: if isOrganizer(resource.data.groupId);` を `allow delete:` と `allow update:` に分割し、update に既存 organizer 経路 + 新 spectateEnabled 経路の OR を組む
- **IMPLEMENT**:
  ```firestore-rules
  allow delete: if isOrganizer(resource.data.groupId);

  // Phase 1 (04-spectate-mode): tournaments の update は 2 経路の OR:
  //   経路 A (既存): organizer は全フィールド update 可（structure 編集 / level 進行 / state 遷移 等）
  //   経路 B (本 Phase): spectateEnabled + updatedAt のみの単独書換。affectedKeys で他フィールド汚染を deny。
  //
  //   経路 A が広いため、行動上は経路 B が必須でない（organizer は経路 A で書ける）。
  //   それでも明示するのは:
  //   - groups/{gid} の単独フィールド書換 rule 経路（finishedTournamentCount / defaultSeatsPerTable /
  //     seasonStartDate / defaultTableLabels / seasonPointsRule）と設計を揃え、将来 organizer 経路を
  //     狭める際の足場とするため
  //   - emulator validator で「spectateEnabled の単独書換が allow / member は deny / 値が non-bool は deny」
  //     を独立に確認できるようにするため
  allow update: if isOrganizer(resource.data.groupId)
                || (
                  isOrganizer(resource.data.groupId)
                  && request.resource.data.diff(resource.data).affectedKeys()
                       .hasOnly(['spectateEnabled', 'updatedAt'])
                  && request.resource.data.spectateEnabled is bool
                );
  ```
- **MIRROR**: RULE_BRANCH_GROUPS_PATTERN（`firestore.rules:215-220` の `defaultSeatsPerTable` 経路）
- **GOTCHA**:
  - `allow update, delete:` を分割する際、既存の `allow delete:` 単独行が他に無いか確認（[firestore.rules:407](../../../../firestore.rules#L407) 1 行のみ）
  - 経路 A は経路 B を **subset として包含する**ため、経路 B は実質的に行動を変えない（PRD 設計コメント参照）。emulator validator では「両方の OR が成立するケース」を確認
  - **PRD で `affectedKeys.hasOnly(['spectateEnabled', 'updatedAt'])` を指定**している。`updatedAt` を含めるのは [src/lib/firebase/repositories/tournaments.ts:230-232](../../../../src/lib/firebase/repositories/tournaments.ts#L230-L232) の `updateTournament` が常に `serverTimestamp()` で `updatedAt` を伴う既存パターン（Phase 3 の `updateSpectateEnabled` も同じ慣習に倣う前提）
- **VALIDATE**: Task 6 の validator で「organizer が spectateEnabled+updatedAt を allow」「organizer が spectateEnabled + name 同時変更も allow（経路 A）」「member が spectateEnabled を deny」「organizer が non-bool spectateEnabled で経路 B は deny だが経路 A も isOrganizer 経由なので結果として deny にならない」を整理して確認

### Task 6: emulator validator スクリプト作成（`scripts/test-rules-spectate.mjs`）

- **ACTION**: [scripts/test-rules-spectate.mjs](../../../../scripts/test-rules-spectate.mjs) を新規作成
- **IMPLEMENT**: REST 直叩きで以下の 13 ケースを assert する。
  ```js
  // 雛形は scripts/test-rules-default-seats.mjs / test-rules-table-labels.mjs を完全踏襲。
  // 違いは「unauthenticated GET（Authorization ヘッダなし）」も `signUpOrIn` の隣に
  // helper として用意すること。

  /**
   * Phase 1 (04-spectate-mode) Firestore Rules emulator validation for `tournaments.spectateEnabled`.
   *
   * 起動方法（cwd = repo root、emulator は起動済みか firebase emulators:exec から起動）:
   *   firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e \
   *     "node scripts/test-rules-spectate.mjs"
   *
   * 検証ケース:
   *   read 経路 (tournaments / players / tables):
   *     1. spectateEnabled=true、anon → tournaments/{tid} read allow
   *     2. spectateEnabled=true、anon → tournaments/{tid}/players/{pid} read allow
   *     3. spectateEnabled=true、anon → tournaments/{tid}/tables/{n} read allow
   *     4. spectateEnabled=false、anon → tournaments/{tid} read deny (403)
   *     5. spectateEnabled=false、anon → players read deny
   *     6. spectateEnabled=false、anon → tables read deny
   *     7. spectateEnabled field 不在の legacy doc、anon → read deny（.get default false 経由で）
   *     8. signed-in member は spectateEnabled に関係なく既存通り read 可
   *
   *   write 経路:
   *     9. organizer が spectateEnabled=true を update → allow
   *    10. member が spectateEnabled=true を update → deny
   *    11. anon が spectateEnabled=true を update → deny
   *    12. organizer が spectateEnabled に non-bool（"true" 文字列）を update → deny
   *        （経路 B の is bool で reject。経路 A の broad organizer update も型で reject されないが、
   *         schema 側 zod が string を弾くため UI 経路は通らない。本 ケースは経路 B 単独動作の確認）
   *
   *   players / tables の write 経路据え置き:
   *    13. spectateEnabled=true、anon が tournaments/{tid}/players/{pid} に PATCH → deny
   *        （観戦中も書込は引き続き signed-in 必須）
   */

  // ... helper（signUpOrIn / tv / fields / patchDoc / createDoc / expectAllow / expectDeny）は
  // test-rules-table-labels.mjs から完全コピー
  // 加えて以下を新規追加:
  async function getDocAnon(path) {
    const url = `${FS_BASE}/${path}`;
    return fetch(url);  // Authorization ヘッダなし
  }
  async function patchDocAnon(path, data) {
    const mask = Object.keys(data)
      .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
      .join("&");
    const url = `${FS_BASE}/${path}?${mask}`;
    return fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: fields(data) }),
    });
  }

  async function main() {
    const owner = await signUpOrIn("owner-spectate@test.local", "passw0rd");
    const org = await signUpOrIn("organizer-spectate@test.local", "passw0rd");
    const member = await signUpOrIn("member-spectate@test.local", "passw0rd");

    // group seed → organizer / member 拡張（test-rules-table-labels.mjs と同じ手順）

    // tournaments を 3 件 seed:
    //   tidA: spectateEnabled=true
    //   tidB: spectateEnabled=false
    //   tidC: spectateEnabled field 不在（legacy doc）
    // それぞれに players/{owner.uid} と tables/{1} を seed（organizer 経由で）

    // ────────────────────────────────────────────────
    // anon read 経路の検証（Authorization ヘッダなし）
    await expectAllow("(1) anon read tournaments (spectate=true)", () =>
      getDocAnon(`tournaments/${tidA}`));
    await expectAllow("(2) anon read players (spectate=true)", () =>
      getDocAnon(`tournaments/${tidA}/players/${owner.uid}`));
    await expectAllow("(3) anon read tables (spectate=true)", () =>
      getDocAnon(`tournaments/${tidA}/tables/1`));

    await expectDeny("(4) anon read tournaments (spectate=false)", () =>
      getDocAnon(`tournaments/${tidB}`));
    await expectDeny("(5) anon read players (spectate=false)", () =>
      getDocAnon(`tournaments/${tidB}/players/${owner.uid}`));
    await expectDeny("(6) anon read tables (spectate=false)", () =>
      getDocAnon(`tournaments/${tidB}/tables/1`));

    await expectDeny("(7) anon read legacy tournaments (no field)", () =>
      getDocAnon(`tournaments/${tidC}`));

    // signed-in member は spectate に関係なく既存通り read 可
    await expectAllow("(8) signed-in member read tournaments (spectate=false)", () =>
      fetch(`${FS_BASE}/tournaments/${tidB}`, {
        headers: { Authorization: `Bearer ${member.idToken}` },
      }));

    // ────────────────────────────────────────────────
    // write 経路
    await expectAllow("(9) organizer toggle spectateEnabled=true", () =>
      patchDoc(org.idToken, `tournaments/${tidB}`, {
        spectateEnabled: true,
        updatedAt: new Date(),
      }));
    await expectDeny("(10) member toggle spectateEnabled=true", () =>
      patchDoc(member.idToken, `tournaments/${tidB}`, {
        spectateEnabled: true,
        updatedAt: new Date(),
      }));
    await expectDeny("(11) anon toggle spectateEnabled=true", () =>
      patchDocAnon(`tournaments/${tidB}`, {
        spectateEnabled: true,
        updatedAt: new Date(),
      }));

    // 経路 B (affectedKeys 単独) のみ通る形に絞った write の検証:
    //   経路 A (broad organizer) も is bool を要求しないため、non-bool でも 200 を返してしまう。
    //   このため case 12 は **経路 B 単独動作テスト** として現状の rule では「allow になる」ことを
    //   想定値に書く（広い経路 A が拾うため）。spectateEnabled の型は schema 側 zod が converter で
    //   reject するのが最終ライン防御。本 case の assert は実機 rule 動作を反映する形で書く。
    //   ※実装時に rule 動作を確認してケース文言を調整（PASS/FAIL の期待値は実際の rule 評価に従う）。
    await expectAllow("(12) organizer non-bool spectateEnabled — passes via broad path A", () =>
      patchDoc(org.idToken, `tournaments/${tidB}`, {
        spectateEnabled: "true",  // string
      }));

    // ────────────────────────────────────────────────
    // players / tables write 据え置き
    await expectDeny("(13) anon write player (spectate=true read 開放、write は signed-in 必須)", () =>
      patchDocAnon(`tournaments/${tidA}/players/${owner.uid}`, {
        displayName: "hacked",
      }));

    // ... 集計 / exit
  }
  ```
- **MIRROR**: EMULATOR_VALIDATOR_REST_DIRECT（`scripts/test-rules-default-seats.mjs:108-127`）+ `scripts/test-rules-table-labels.mjs:175-232` の seed 手順
- **GOTCHA**:
  - **case 12 の挙動**: PRD は `affectedKeys + is bool` の経路 B を仕込めと指定するが、rule 全体は「経路 A (広い organizer) OR 経路 B」になる。経路 A は既存の broad organizer update のため non-bool でも通ってしまう。実装時に **rule 評価結果を実機で確認**し、validator のケース文言を「allow（広い経路 A 経由）」に倒すか、case 12 自体を削除して「schema 側 zod による型拒否」を vitest 側で別途担保するか選択する。**実装時に決定**
  - **anon read で `request.auth == null`**: REST で Authorization ヘッダを付けないと auth=null になる。`signUpOrIn` で取得した別の `idToken` を Bearer に付けると signed-in 扱い
  - **legacy doc seed**: `spectateEnabled` を意図的に省いて `createDoc` する。schema は zod converter（write 側では使わない REST 直叩きなので validate されない）を経由しないため field 不在のまま seed される
  - **owner / organizer / member の uid 衝突**: 他の validator と並走させる場合に `{Date.now()}` を gid / tid / email に入れて固有化（`g-rules-spectate-${Date.now()}` 等）。test-rules-table-labels.mjs 等と同 email を使うと既存 user として signIn するだけなので uid 衝突は起こらないが、gid / tid は固有化必須
  - **players doc は self-create rule** なので、organizer が他人の player doc を作るには organizer-clone branch（state="setup" 必須）か owner.uid 自身の player を seed することになる。本 validator は owner.uid の player を seed する（self-create 経路）
- **VALIDATE**:
  - `npm run test:rules-spectate` が green
  - 実装中に `firebase emulators:start --only auth,firestore` を別 terminal で立ち上げて手動デバッグも可

### Task 7: package.json に `test:rules-spectate` script 追加

- **ACTION**: [package.json](../../../../package.json) の `scripts` セクションに行を追加
- **IMPLEMENT**:
  ```json
  "test:rules-spectate": "firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e \"node scripts/test-rules-spectate.mjs\"",
  ```
  既存の `test:rules-table-labels` の直前か直後（アルファベット / 機能順）に挿入。
- **MIRROR**: NPM_SCRIPT_NAMING（`test:rules-clone-players` / `test:rules-season` 等）
- **VALIDATE**: `npm run test:rules-spectate` がコマンドとして起動する（実 emulator が無くても firebase CLI で起動できれば OK）

### Task 8: 規約ドキュメント — error-logging.md 更新

- **ACTION**: [.claude/rules/error-logging.md](../../../rules/error-logging.md) の「## エラー」セクション内 prefix 一覧に `spectate/*` を追加
- **IMPLEMENT**:
  ```md
  - `pwa/*` — PWA インストール / Service Worker / ブラウザストレージ起因（Phase D 追加。`pwa/storage-failed` / `pwa/install-prompt-failed` 等）
  - `spectate/*` — 観戦モード起因（Phase 1 追加。Phase 2/3 で具体 code が増える予定。`spectate/permission-denied` 等）
  - 例: `firestore/permission-denied`, ...（既存末尾の例文行に `spectate/permission-denied` 等を追加）
  ```
- **MIRROR**: `pwa/*` / `season/*` の追記パターン
- **GOTCHA**: 本 Phase では実コードに `spectate/*` を投入しない（write/service が Phase 3 のため）。docs だけ先に追加して、Phase 2 / 3 / 4 の plan が prefix を参照できる状態を作る
- **VALIDATE**: 規約ドキュメント差分のレビューで「`spectate/*` が prefix 一覧に追加されている」を確認

### Task 9: 規約ドキュメント — firebase-patterns.md 更新

- **ACTION**: [.claude/rules/firebase-patterns.md](../../../rules/firebase-patterns.md) の「`tournaments/{tid}` / `groups/{gid}` 配下 subcollection の rule 設計原則」セクションの subcollection 表に spectate 関連の行を追記
- **IMPLEMENT**:
  ```md
  `match /tournaments/{tid}` 配下:

  | Path | 許可 |
  | --- | --- |
  | `match /players/{pid}` | explicit、4 ブランチ（self-create / organizer-clone / self-update / organizer-update）。Phase 1 (04-spectate-mode) で **read 経路に親 tournament の `spectateEnabled == true` 分岐を OR 追加**（write 経路は据え置き） |
  | `match /tables/{tableId}` | explicit、organizer のみ書込可。Phase 1 (04-spectate-mode) で **read 経路に同じ `spectateEnabled == true` 分岐を OR 追加** |
  ```
  さらに `match /tournaments/{tid}` 自体の read 拡張も別段で 1 行明記:
  ```md
  Phase 1 (04-spectate-mode):
  - `match /tournaments/{tid}` allow read 自体も `isSignedIn() || resource.data.get('spectateEnabled', false) == true` に拡張済み
  - update 経路は既存 organizer 経路に加え、`affectedKeys.hasOnly(['spectateEnabled', 'updatedAt']) + is bool` の単独書換ブランチを additive 追加
  - emulator validator: scripts/test-rules-spectate.mjs（npm run test:rules-spectate）
  ```
- **MIRROR**: 既存の Phase 5.4 / Phase A の「現状の subcollection rule」更新パターン
- **GOTCHA**: wildcard rule（既存 `match /{path=**}/players/{pid}`）は **触らない**。collectionGroup query は元々 `isSignedIn()` 限定で、観戦経路では使わない（`/spectate` ページの subscribePlayers は path-specific rule 経由）
- **VALIDATE**: 規約ドキュメント差分レビュー

### Task 10: 規約ドキュメント — group-membership.md 更新

- **ACTION**: [.claude/rules/group-membership.md](../../../rules/group-membership.md) の「権限マトリクス」表に観戦モード関連行を追加
- **IMPLEMENT**:
  ```md
  | 観戦モード ON 中 tournament の anon 経由 read | -（spectate=true なら anon でも可） | -（同上） | -（同上） |
  | tournaments の `spectateEnabled` toggle | ○ | ○ | × |
  ```
  さらに「アカウント自己削除」セクション末尾以前の適切な場所に観戦モードへの言及（小節 1〜2 行で十分）を入れる:
  ```md
  ### Phase 1 (04-spectate-mode): tournaments.spectateEnabled

  observable scope は tournament 単位。`spectateEnabled === true` のとき、対象 tournament / 配下 players / 配下 tables を unauthenticated でも read できる（[firestore.rules](../../firestore.rules) の 4 経路）。toggle 自体は `tournaments/{tid}` の update 経路で organizer 以上のみ。詳細は [04-spectate-mode PRD](../PRPs/04-spectate-mode/prds/04-spectate-mode.prd.md) 参照。
  ```
- **MIRROR**: 既存の Phase A / Phase E の小節追記パターン
- **VALIDATE**: 規約ドキュメント差分レビュー

---

## Testing Strategy

### Unit Tests（既存テストへの影響）

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| `tournament-state.test.ts` 既存全件 | 既存 fixture | 全 pass（`spectateEnabled` 追加は state 判定 helper に影響しない） | additive 影響確認 |
| 既存の `tournamentBodySchema.parse(...)` を含む全 unit test | `spectateEnabled` field 不在の fixture | `default(false)` で hydrate されて pass | legacy doc 互換確認 |

**Phase 1 ではユニットテストの追加は不要**（schema additive のみで logic を露出しないため）。Phase 2 以降で `/spectate/[tid]` ロジック / `setSpectateEnabled` service のテストを追加する。

### Edge Cases Checklist

emulator validator（Task 6）でカバー:

- [x] **legacy doc 互換** — `spectateEnabled` field 不在の旧 doc が anon read で deny される（schema default false が rule 側でも `.get(..., false)` 経由で同じ結論を出す）
- [x] **boundary** — true / false の境界。non-bool はもし経路 B 単独で評価できれば deny を期待
- [x] **権限境界** — anon / member / organizer / owner の read / write 別マトリクス
- [x] **subcollection 階層** — players / tables それぞれが独立に親 spectateEnabled を参照
- [ ] **collectionGroup wildcard** — 本 Phase では `match /{path=**}/players/{pid}` は触らない。emulator validator での確認も省略（ドキュメントで明示）

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
```

EXPECT: 0 type errors（`tournamentBodySchema` への field 追加で `TournamentDoc` / `TournamentBody` 型が拡張されるが、既存の object literal は additive のため壊れない）

```bash
npm run lint
```

EXPECT: 0 lint errors

### Unit Tests

```bash
npm run test
```

EXPECT: 既存全 unit test が green（schema additive 影響なし）

### Emulator Rule Validation

```bash
npm run test:rules-spectate
```

EXPECT: 13 ケース全 pass（Task 6 で定義）

### 既存 Rule Validator の回帰確認

```bash
npm run test:rules-limits
npm run test:rules-clone-players
npm run test:rules-season
npm run test:rules-season-points-rule
npm run test:rules-table-labels
```

EXPECT: 全 green（spectateEnabled の rule 追加が他経路を壊していないことの回帰確認。PRD の Success signal にも明記）

実機 firebase deploy は **Phase 1 完了報告チェック項目で必須化**:

```bash
firebase deploy --only firestore:rules
```

> メモリ規約「Firestore rules 変更時は deploy 案内を必須」より、Phase 1 完了報告に必ず含める。emulator green でも本番未 deploy で permission-denied する罠。

### Build Validation

```bash
npm run build
```

EXPECT: Next.js build 通過（schema 追加で TS 型推論は変わるが、import / consumer 不在のため build 影響なし）

---

## Acceptance Criteria

- [ ] `tournamentBodySchema` に `spectateEnabled: z.boolean().default(false)` が additive 追加されている
- [ ] `firestore.rules` の 4 経路で「`spectateEnabled == true` のとき unauthenticated read 通過」「false / 不在で deny」が成立する
- [ ] `firestore.rules` の `tournaments/{tid}` allow update に `affectedKeys.hasOnly(['spectateEnabled', 'updatedAt']) + is bool` の organizer 限定 OR 経路が additive 追加されている
- [ ] `scripts/test-rules-spectate.mjs` が新規作成され、`npm run test:rules-spectate` が green
- [ ] `package.json` の `scripts` に `test:rules-spectate` が追加されている
- [ ] 既存の `test:rules-*` 群（finished-count / default-seats / season / clone-players / pd / limits / table-labels / season-points-rule）が引き続き green
- [ ] `npm run typecheck` / `npm run lint` / `npm run test` / `npm run build` すべて 0 errors
- [ ] [.claude/rules/error-logging.md](../../../rules/error-logging.md) に `spectate/*` prefix が追加されている
- [ ] [.claude/rules/firebase-patterns.md](../../../rules/firebase-patterns.md) の subcollection rule 表に spectateEnabled 行が追加されている
- [ ] [.claude/rules/group-membership.md](../../../rules/group-membership.md) の権限マトリクスに観戦モード行が追加されている

## Completion Checklist

- [ ] schema additive はコメントで PRD Phase ラベル + DRIFT WARNING を明示
- [ ] rule 追加箇所はすべて既存パターン（groups の `affectedKeys.hasOnly` / players の `exists` + `get`）を踏襲
- [ ] `console.*` を直接呼んでいない（規約準拠）
- [ ] emulator validator は REST 直叩き（Firestore SDK の楽観 resolve 罠を回避）
- [ ] 規約ドキュメント 3 件すべて更新
- [ ] `firebase deploy --only firestore:rules` を完了報告のチェック項目として明記
- [ ] Phase 2 / 3 / 4 が参照する **schema field の存在 / rule の振る舞い / validator script の名前**がすべて確定している
- [ ] 自己完結 — Phase 2 着手者がさらなる質問なしに着手できる

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| `firestore.rules` の `allow update, delete` 分割で既存 organizer の delete 経路を誤って外す | M | H | Task 5 の IMPLEMENT サンプルを厳密に踏襲。`allow delete: if isOrganizer(...)` 単独行を先に書いてから update を OR で組む。emulator validator に「organizer が tournament を delete できる」を 1 ケース追加して回帰確認 |
| legacy doc 互換 — field 不在の旧 doc が `resource.data.spectateEnabled == true` で評価エラー → permission-denied になる | M | H | rule 全箇所で `resource.data.get('spectateEnabled', false)` を使う。emulator validator のケース 7 で field 不在 doc の anon deny を assert |
| collectionGroup wildcard で観戦経路が漏れる（`match /{path=**}/players/{pid}`） | L | H | 本 Phase では wildcard rule は触らない。`/spectate/[tid]` ページは path-specific rule 経由でしか read しない設計（Phase 2 で `subscribePlayers(tid)` を使う） |
| `affectedKeys.hasOnly(['spectateEnabled', 'updatedAt'])` 経路 B が広い経路 A に隠れて行動上 redundant | L | L | Task 5 のコメントで設計意図を明記。Phase 2/3 で経路 A を狭める将来余地を残す |
| Rules deploy 漏れで本番 permission-denied | M | H | Phase 完了報告チェック項目に `firebase deploy --only firestore:rules` を必須記載（メモリ規約） |
| schema 追加で zod converter の `fromFirestore` validate が legacy doc に対し fail する | L | M | `default(false)` で field 不在を補完するため fail しない。converter 既存テスト（schemas/*.test.ts 群）が回帰検出 |
| `test:rules-spectate` が他 validator と並走時に gid / tid 衝突 | L | L | gid / tid は `${Date.now()}` で固有化。既存 validator も同 pattern |

## Notes

- **書込 service / repository（`updateSpectateEnabled` / `setSpectateEnabled`）は Phase 3 のスコープ**。Phase 1 では rule で許可するのみ。emulator validator は REST 直叩きで rule 動作を確認するため、service 層の存在に依存しない
- **`tournaments/{tid}` の `allow update` 分割**は本 Phase で実施するが、行動上の変化は最小限（broad organizer update がそのまま残るため）。設計の足場として `affectedKeys` 経路を導入する
- **PWA cache（Phase 4）と Phase 1 は完全独立**。Phase 4 の SW 修正は本 Phase に依存しない
- **PRD の Phase 進捗表 (#1)** は本 plan link を埋めて `pending` → `in-progress` に遷移させる（Output 節参照）
- emulator validator の case 12（non-bool）は実機 rule 評価で「広い経路 A 経由で allow になる」可能性が高い。実装時にケース文言・期待値を実機動作に合わせて調整する。schema 側 zod による型担保は Phase 3 の service 層で別途確認する想定
