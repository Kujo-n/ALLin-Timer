# Local Review: Phase 4.9 (音声通知)

**Reviewed**: 2026-04-25
**Branch**: feat/phase-4.9-audio-notifications
**Decision**: APPROVE（初回 review の MEDIUM 4 件は本コミットで全件解消、LOW 3 件は残置）

## 概要

Phase 4.9 の audio notifications 実装。`groups.audioSettings`（zod default 互換 additive 追加）、`useAudioPlayer` hook、`SoundUnlockBanner`、`/groups/[gid]/audio-settings` ページ、Firestore rules の organizer 限定 audioSettings 単独書換ブランチ、26 ファイル / 445 テスト全 pass / typecheck・lint・build clean。所有権モデル・3 階層ロール・error/logger 規約には全て従っている。要修正の致命的問題は見つからなかった。

## 対応サマリ（2026-04-25 追記）

| ID | 内容 | 状態 |
| -- | ---- | ---- |
| M1 | dashboard-client.tsx の `currentGroup` / `tournamentGroup` 重複 | 対応済 — `tournamentGroup` に統一 |
| M2 | `useAudioPlayer` の `play` / `preview` 重複 | 対応済 — `playInternal` に集約 |
| M3 | firestore rules の audio settings ブランチが他フィールド差分を許容 | 対応済 — `affectedKeys().hasOnly(['audioSettings'])` + `is map` 追加 |
| M4 | `SoundUnlockBanner` の絵文字使用 | 対応済 — Lucide `Bell` / `Check` に置換 |
| L1 | unlock の "suspended" / "closed" silent fail | 残置 |
| L2 | audio-settings-client.tsx の unmount 後 setState | 残置 |
| L3 | `audio-context.ts` の coverage 除外 | 残置 |

修正後の検証: typecheck pass / lint clean / 26 files 445 tests pass / build pass。

## 検証結果

| Check      | Result                       |
| ---------- | ---------------------------- |
| Type check | Pass                         |
| Lint       | Pass（warnings 0 件）        |
| Tests      | Pass（26 files / 445 tests） |
| Build      | Pass                         |

## 指摘事項

### CRITICAL

None.

### HIGH

None.

### MEDIUM

#### M1. dashboard-client.tsx で `tournamentGroup` と `currentGroup` が同一計算の重複

[src/app/tournaments/[tid]/dashboard-client.tsx:162](src/app/tournaments/[tid]/dashboard-client.tsx#L162) と [src/app/tournaments/[tid]/dashboard-client.tsx:199](src/app/tournaments/[tid]/dashboard-client.tsx#L199) は両方 `groups.find((x) => x.id === data.groupId)` を実行しており、結果は常に同一。早期 return（行 194 / 202）の hooks 規約のために分割しているのは理解できるが、命名差（`tournamentGroup` / `currentGroup`）が読み手の混乱を招く。

`useCurrentGroup()` の戻り値にも `currentGroup` という同名フィールドがあり、ローカル変数の `currentGroup`（行 199）はそれとは別物（user-selected ではなく tournament の group）。3 つ目の `currentGroup` 概念が紛れている。

**推奨**: 早期 return より前で 1 度計算 → `tournamentGroup` に統一し、行 199 の `currentGroup` 定義を削除。または UI 側の banner も `tournamentGroup` を直接参照する。

```tsx
// 行 162 を残し、行 199 / 261 を以下に置換
{tournamentGroup ? (
  <SoundUnlockBanner ... />
) : null}
```

#### M2. `useAudioPlayer.ts` の `play` と `preview` でロジックが二重化

[src/lib/hooks/useAudioPlayer.ts:62-89](src/lib/hooks/useAudioPlayer.ts#L62-L89) の `play()` と [src/lib/hooks/useAudioPlayer.ts:98-129](src/lib/hooks/useAudioPlayer.ts#L98-L129) の `preview()` の audio 再生ブロック（resolveSound → audioElRef 初期化 → canPlayType find → pause/currentTime=0/src/volume → play → catch warn）がほぼ完全に重複している。

差分は `unlocked` チェックの有無のみ。preview コメント（103-105 行）にある通り unlock 直後の sync block 維持が目的だが、内部関数 `playInternal(soundId, requireUnlocked)` で 1 本化できる。重複が残ると将来の音量 / fade / mute 制御追加時にバグの温床になる。

**推奨**: 共通の `playInternal` 関数に集約し、`play` / `preview` は gate 条件のみ持つ薄いラッパにする。

#### M3. Firestore rules の audioSettings ブランチが `audioSettings` フィールド存在を要求していない

[firestore.rules:172-189](firestore.rules#L172-L189) の Phase 4.9 ブランチは「他フィールドが不変」のみを検証し、`request.resource.data.audioSettings is map` 等の存在/型チェックをしていない。

結果として organizer が `updateDoc(groups/{gid}, { audioSettings: deleteField() })` を発行すると rule は許可してしまう（他フィールド全て不変なので）。schema の `.default()` で read 時に補完されるため実害は小さいが、書込時の意図が不明瞭。

加えて、`audioSettings` を全く触らない update（例: `updateDoc(g, { someField: x })`）も「audioSettings 単独書換」ブランチを通過してしまう（他ブランチが拒否しても本ブランチで通る）。これは organizer に「audioSettings 以外の任意の新フィールドを top-level に追加する」抜け道を与える（owner update 経路と同じ抜け道はあるが、organizer 経路にも開いている）。

ルール内コメントは「field-level validation は application 層に委譲」としているが、これは値検証の話であって、フィールド存在 / 不要フィールド禁止とは別レイヤ。最低限以下を追加するのを推奨:

```
&& request.resource.data.audioSettings is map
&& request.resource.data.diff(resource.data).affectedKeys().hasOnly(['audioSettings'])
```

これで「audioSettings の差分のみ」を atomic に強制できる。

#### M4. `SoundUnlockBanner.tsx` での絵文字使用

[src/components/audio/SoundUnlockBanner.tsx:37](src/components/audio/SoundUnlockBanner.tsx#L37) の `🔔` および [src/components/audio/SoundUnlockBanner.tsx:59](src/components/audio/SoundUnlockBanner.tsx#L59) の `✓`。

`CLAUDE.md` 直下の指針として "Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked." とあり、本フェーズの指示に絵文字明示要求は無い。`aria-hidden` を付与して a11y 影響は抑えてあるが、規約上は避けるのが望ましい。

代替: Lucide React アイコン（`Bell` / `Check`）か、テキストラベル（"通知" / "有効"）。

### LOW

#### L1. `useAudioPlayer.ts` unlock 関数が "suspended" / "closed" を silent にする

[src/lib/hooks/useAudioPlayer.ts:91-96](src/lib/hooks/useAudioPlayer.ts#L91-L96):

```ts
const unlock = useCallback(async () => {
  const state = await resumeAudioContext();
  if (state === null || state === "running") setUnlocked(true);
}, []);
```

`state === "suspended"` / `"closed"` の場合は `unlocked` が false のまま、UI 側ではボタン押下の反応も無く、ユーザーには何も伝わらない。実際には iOS Safari の autoplay policy で起こりうる。`logger.warn("audio context not running", { state })` で記録するか、UI に「ブラウザが再生をブロックしました」を表示する。

#### L2. `audio-settings-client.tsx` で unmount 後の setState 競合

[src/app/groups/[gid]/audio-settings/audio-settings-client.tsx:38-56](src/app/groups/[gid]/audio-settings/audio-settings-client.tsx#L38-L56) の `useEffect` は `await getGroup(gid)` の途中で unmount すると、`setGroup(g)` / `setSettings(g.audioSettings)` / `setError(...)` が unmounted コンポーネントに対して発火する。React の警告は出るが crash はしない。`mountedRef` で guard すれば抑制可能。Phase 4.7 等の既存ページも同パターンを踏襲しているなら統一前提で OK。

#### L3. `vitest.config.ts` の coverage exclude に `audio-context.ts` を追加した理由がコメントのみ

[vitest.config.ts](vitest.config.ts) の `src/lib/audio/audio-context.ts` exclude は妥当（jsdom が `AudioContext` を持たない）だが、unit test の代替（mock 経由の薄い integration test 等）が無い。SSR ガードと cache 動作の検証は `useAudioPlayer.test.tsx` 側のモックに依存している形。Phase 4.10 で custom audio が増える際は、context wrapper にも 1 ファイルでテストを足す検討余地あり。

## ファイル別所感（review 済み）

| ファイル | 結果 |
| -------- | ---- |
| `firestore.rules`（audio settings branch 追加） | M3 指摘 |
| `src/lib/firebase/schemas/group.ts`（`audioSettingsSchema` / `DEFAULT_AUDIO_SETTINGS`） | OK — additive、`.default()` で legacy doc 互換 |
| `src/lib/firebase/schemas/index.test.ts` | OK — 4 ケース（default 補完 / 明示値 / volume out-of-range / empty soundId）追加 |
| `src/lib/firebase/repositories/groups.ts`（`updateAudioSettings`） | OK — pre-validation + AppError wrap + logger.info で write 記録 |
| `src/lib/firebase/repositories/groups.test.ts` | OK — 3 ケース（成功 / 範囲外 / Firestore reject）追加 |
| `src/lib/services/group.test.ts` | OK — `makeGroup` に `audioSettings` 追加 |
| `src/lib/audio/audio-context.ts` | OK — 薄い wrapper、SSR ガード、singleton |
| `src/lib/audio/sound-catalog.ts` + test | OK — Phase 4.10 拡張ポイントを意識した interface |
| `src/lib/hooks/useAudioPlayer.ts` + test | M2 / L1 指摘。テストは role / level 変化 / winner / unlock / preview / play 失敗を包括 |
| `src/components/audio/SoundUnlockBanner.tsx` | M4 指摘 |
| `src/app/groups/[gid]/audio-settings/page.tsx` | OK — `RequireAuth(allowAnonymous=false)` |
| `src/app/groups/[gid]/audio-settings/audio-settings-client.tsx` | L2 指摘。member redirect / preview unlock fast-path / volume slider が良 |
| `src/app/groups/[gid]/group-detail-client.tsx`（organizer ボタン追加） | OK |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | M1 指摘 |
| `src/app/tournaments/[tid]/live/live-client.tsx` + test mock | OK — `useCurrentGroup` mock 追加で副作用を局所化、operator check で member 端末は no-op |
| `vitest.config.ts` | L3 指摘 |
| `.claude/PRPs/plans/completed/phase-4.9-audio-notifications.plan.md`（移動） | OK — CLAUDE.md の慣行通り |
| `.claude/PRPs/reports/phase-4.9-audio-notifications-report.md`（新規） | OK — 通常フロー |
| `.claude/PRPs/prds/allin-timer.prd.md` | OK — Phase 4.9 を `complete` 化 |

## 推奨対応

- **M3 を merge 前に対応**（rule の `affectedKeys().hasOnly([...])` 化）。security 影響領域。
- **M1 / M2 / M4 / L1〜L3** はフォローアップ PR で対応可。優先度高は M2（コード重複）。

## 次フェーズへの送り

- Phase 4.10（custom 音源 upload）で `sound-catalog.ts` の `resolveSound` フォールバックが「削除済み custom ID → default」のパスを担う設計が見える。catalog のテスト「unknown id でフォールバック」（[src/lib/audio/sound-catalog.test.ts:52](src/lib/audio/sound-catalog.test.ts#L52)）はその予兆として有用。
- `firestore.rules` の audioSettings ブランチに将来 `customSoundAssets` フィールドが乗る場合、M3 の `affectedKeys().hasOnly([...])` を入れておけば自然に拡張可能。