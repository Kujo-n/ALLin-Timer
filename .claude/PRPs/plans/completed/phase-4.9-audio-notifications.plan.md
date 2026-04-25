# Plan: Phase 4.9 — Audio Notifications (Default Sounds)

## Summary

ブラインドレベル変更／優勝者確定の 2 イベントで音声通知を行う段階1（カスタム音源は Phase 4.10）。**デフォルト音源 2 種類（mp3 + ogg/vorbis、levelUp / winner で別ファイル）+ group 単位の on/off と音量 + ロールベース再生（owner/organizer のみ）+ autoplay unlock 明示ボタン**まで。音源は運営者が調達した mp3 を ffmpeg で ogg/vorbis 変換した 4 ファイルを bundle し、`<audio>` element + Web Audio API で再生する。Firebase Storage は導入しない。スキーマは additive（`groups/{gid}.audioSettings` を `default()` で旧 doc 受容）、Firestore Rules は owner-update 既存ブランチが既に audioSettings 書換を内包するため **organizer-only audioSettings update branch を 1 つ追加**するのみ。破壊的 migration なし。Phase 4.10（カスタム音源 + Storage）への足場を作る。

**ブラウザ互換**: mp3 は Chrome / Firefox / Safari / iOS Safari / Edge すべて対応。ogg/vorbis は Firefox / Chrome で軽量 fallback として優先採用される（要件 Q4「mp3/ogg 両対応」準拠）。

## User Story

As a サークル運営者（owner / organizer）,
I want ブラインドレベルが上がる瞬間と、優勝者が決まった瞬間に、自分が見ている画面（運営ダッシュボード or `/live` 全画面投影）で確認音が鳴り、サークル単位で on/off と音量を設定できる状態,
So that 自分のハンドに集中しているときもブラインド進行を耳で気付け、優勝確定を会場全体に音で告知でき、不要なときは設定で消せる。

And as a サークル参加者（member or anonymous）,
I want 自分のスマホでは音が鳴らない,
So that 予期せぬ音でバッテリーや周囲を消費せず、運営者の意図しない場面で会場のスマホ全部から音が出るような事故を避けられる。

## Problem → Solution

**Current state（Phase 4.8 完了時点）**:

1. ブラインドレベル繰り上げ（auto-advance）は [useTournamentTimer.ts:100-121](src/lib/hooks/useTournamentTimer.ts#L100-L121) で transaction による書込が走るのみで、視覚的には [TimerDisplay](src/components/tournament/TimerDisplay.tsx) が `currentLevel` 変化で再描画するだけ。**運営者が自分のハンドに集中しているとレベルアップを見逃す**（PRD Evidence の運営者実体験）。
2. 優勝確定は [resolveWinner](src/lib/services/timer.ts#L71-L82) → [WinnerBanner](src/components/tournament/WinnerBanner.tsx) で視覚通知のみ。**会場全体への告知音がない**ため、運営者がアプリ画面を見ていない場合に伝達が遅れる。
3. PRD MVP scope に音声通知が含まれておらず、Phase 4 までで未実装。

**Desired state（Phase 4.9 完了時点）**:

1. 運営者ロール（owner/organizer）の端末で、`tournament.currentLevel` が変化した瞬間 / `resolveWinner` の戻り値が `null → PlayerDoc` に遷移した瞬間にデフォルト音源が鳴る。参加者ロール（member）／匿名ユーザーでは鳴らない。
2. `groups/{gid}.audioSettings` で **enabled / levelUpSoundId / winnerSoundId / volume** を group 単位に永続化。設定変更は organizer 以上のみ。
3. `/groups/{gid}/audio-settings` ページを新設し、設定 UI を提供。
4. 初回ページ表示時に「サウンドを有効化」明示ボタンを出し、クリックで `AudioContext.resume()` → 以降のセッションで自動再生可能にする（Chrome / Safari / Firefox の autoplay policy 準拠）。
5. ブラインド進行の見落とし／優勝確定の遅延伝達ペインが解消され、Phase 5 のフィールドテストで「ブラインド確認クエリゼロ」「席移動指示 5 秒以内」と並ぶ実用性向上を検証可能にする。

## Metadata

- **Complexity**: Medium-Large
- **Source PRD**: [.claude/PRPs/prds/allin-timer.prd.md](../prds/allin-timer.prd.md)
- **Source memo**: [tmp/09_pahse4.7_memo.md](../../../tmp/09_pahse4.7_memo.md)（末尾の Q1〜Q7 回答が Phase 4.9 の制約条件）
- **PRD Phase**: Phase 4.9 — Audio Notifications (Default Sounds)（Phase 4.8 完了後・Phase 4.10 前）
- **Stage scope**: 段階1（デフォルト音源のみ）。カスタム音源アップロードは Phase 4.10 に分離（Firebase Storage 初期導入を伴う独立作業量のため）
- **Estimated Files**: 約 16 files（新規 7・編集 9）

---

## UX Design

### Sound Unlock Banner（初回アクセス）

```
/tournaments/{tid}（運営ダッシュボード・初回・運営者ロール）

┌──────────────────────────────────────────────┐
│ 🔔 サウンドを有効化                          │
│ ブラインド変更／優勝確定で音を鳴らします。     │
│ [サウンドを有効化]   [設定]                   │
└──────────────────────────────────────────────┘
                 ▼ クリック
┌──────────────────────────────────────────────┐
│ ✓ サウンド有効  音量: ●─────○                │
│             [設定]                           │
└──────────────────────────────────────────────┘
                 ▼ 次回以降は AudioContext が
                    user gesture で resume できる
                    ことが分かっているため、UI は
                    「✓ サウンド有効」のみ表示
```

- 運営者ロールでない端末（member / anonymous / 未ログイン）には **banner 自体を表示しない**
- group 設定で `enabled: false` の場合も banner を表示しない（混乱回避）

### Audio Settings Page（新規ページ）

```
/groups/{gid}/audio-settings（organizer 以上のみアクセス可・member は redirect）

┌──────────────────────────────────────────────┐
│ ← サークルへ戻る                             │
│                                              │
│ サウンド設定                                 │
│                                              │
│ ☑ 通知音を有効にする                         │
│                                              │
│ ブラインド変更時:  [▼ ブラインドアップ]      │
│ 優勝確定時:        [▼ 優勝チャイム]          │
│                                              │
│ 音量:  ●────────○  70%                       │
│                                              │
│ [試聴] [試聴]                                │
│                                              │
│ [保存]                                       │
└──────────────────────────────────────────────┘
```

- Phase 4.9 では音源プルダウンの選択肢は 2 件（`default:blind-up` / `default:victory-chime`）。levelUp / winner それぞれデフォルト値に該当を割り当てるが、ユーザーが入れ替えることも可能（例: 両方 `default:victory-chime` にすれば優勝音だけが鳴る運用も可）
- Phase 4.10 で カスタム音源を追加できる構造にしておく（Select の options を `[...defaults, ...customs]` で組む準備）
- 「試聴」ボタンは現在選択中の音源を再生（unlock 後でないと音が鳴らない旨をボタン下に注記）

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| `/tournaments/{tid}` ダッシュボード（運営者） | レベル進行は視覚のみ | + ヘッダ下に SoundUnlockBanner 表示、unlock 後は監視のみ | banner はロール filter 後に表示 |
| `/tournaments/{tid}/live`（運営者がアクセス） | 視覚のみ | 同上（運営者ロールで /live を見るケース：会場ディスプレイ投影） | currentGroupRole で判定 |
| `/tournaments/{tid}/live`（参加者がアクセス） | 視覚のみ | **変化なし**（音は鳴らない） | role !== owner/organizer のため銀色 |
| ブラインドレベル切替 | 視覚のみ（TimerDisplay 再描画） | + 音再生（運営者かつ enabled） | useEffect で `currentLevel` 前回値 ref 比較 |
| 優勝確定 | WinnerBanner 表示 | + 音再生（運営者かつ enabled） | useEffect で resolveWinner の null → PlayerDoc 遷移検知 |
| `/groups/{gid}` 詳細ページ | 招待コード等のみ | + 「サウンド設定」ボタン（organizer 以上） | `/groups/{gid}/audio-settings` へ遷移 |
| 新規 `/groups/{gid}/audio-settings` | 存在しない | 設定フォーム + 試聴 | organizer 以上のみ。member は `/groups/{gid}` に redirect |

---

## Mandatory Reading

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 | [.claude/rules/firebase-patterns.md](../../rules/firebase-patterns.md) | all | スキーマ拡張・zod 三点同期・repository 規約 |
| P0 | [.claude/rules/error-logging.md](../../rules/error-logging.md) | all | AppError ラップ / logger 経由出力 |
| P0 | [.claude/rules/group-membership.md](../../rules/group-membership.md) | all | 3 階層ロール、organizer 権限拡張時の rule 設計 |
| P0 | [src/lib/firebase/schemas/group.ts](../../../src/lib/firebase/schemas/group.ts) | all | `audioSettings` を additive に追加するベース schema |
| P0 | [src/lib/firebase/repositories/groups.ts](../../../src/lib/firebase/repositories/groups.ts) | 108-136, 162-195 | `updateAudioSettings` を `setMemberDisplayName` / `updateGroupRoles` と同形で実装 |
| P0 | [firestore.rules](../../../firestore.rules) | 85-172 | `groups/{gid}` の update branches。新しい organizer-only branch を追加する位置 |
| P0 | [src/lib/hooks/useTournamentTimer.ts](../../../src/lib/hooks/useTournamentTimer.ts) | all | `currentLevel` 変化観測ポイント。`useAudioPlayer` がここから派生 |
| P0 | [src/lib/services/timer.ts](../../../src/lib/services/timer.ts) | 71-82 | `resolveWinner` — null → PlayerDoc 遷移検知に使用 |
| P0 | [src/app/tournaments/[tid]/dashboard-client.tsx](../../../src/app/tournaments/[tid]/dashboard-client.tsx) | 96-156 | autoFinishInflightRef パターンを mirror（重複再生防止） |
| P0 | [src/app/tournaments/[tid]/live/live-client.tsx](../../../src/app/tournaments/[tid]/live/live-client.tsx) | all | useTournamentTimer 利用箇所。useAudioPlayer を同位置に追加 |
| P0 | [src/lib/services/current-group.tsx](../../../src/lib/services/current-group.tsx) | 150-170 | `currentGroupRole` / `isOrganizer` の利用パターン |
| P1 | [src/app/groups/[gid]/group-detail-client.tsx](../../../src/app/groups/[gid]/group-detail-client.tsx) | 252-305 | サークル詳細ページのヘッダ Button 群（音声設定リンクの追加先） |
| P1 | [src/lib/services/timer.test.ts](../../../src/lib/services/timer.test.ts) | all | `makeTournament` factory + describe / it 規約。useAudioPlayer のテストで mirror |
| P1 | [src/lib/firebase/repositories/groups.test.ts](../../../src/lib/firebase/repositories/groups.test.ts) | all | repository テストの SDK モックパターン |
| P1 | [src/lib/firebase/AuthProvider.tsx](../../../src/lib/firebase/AuthProvider.tsx) | all | useReducer + bump で再描画する hook 設計（unlock state の force-render に応用可） |
| P2 | [src/lib/firebase/converters.ts](../../../src/lib/firebase/converters.ts) | all | `serverTimestamps: "estimate"` パターン理解（pending-write 時の audioSettings は default 値で受容される） |

## External Documentation

| Topic | Source | Key Takeaway |
| ----- | ------ | ------------ |
| Web Audio API autoplay policy | https://developer.chrome.com/blog/autoplay/ | `AudioContext` は user gesture（click/tap/keydown 等）で初めて `running` 状態になる。明示ボタンを 1 度クリックさせれば以降は同一タブで `resume()` が無条件に通る |
| HTMLAudioElement vs Web Audio API | MDN: HTMLAudioElement / AudioContext.decodeAudioData | 単発再生（< 1MB のローカル mp3/ogg）なら `<audio>` element でも十分。AudioContext は volume / fade 等の細かい制御が必要なときのみ。**本 Phase は単発・短時間再生のため `<audio>` を選択**し、autoplay unlock のためだけに AudioContext を併用 |
| Browser audio format support matrix | https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Audio_codecs | **mp3 (audio/mpeg)** は Safari/iOS を含む全モダンブラウザで対応。**ogg/vorbis (audio/ogg)** は Firefox / Chrome / Edge で対応、Safari/iOS は非対応。両方 `<source>` 多重化することで、各ブラウザが優先 codec を自動選択する。要件 Q4「mp3/ogg 両対応」を満たす最小構成 |
| ffmpeg mp3→ogg conversion | https://trac.ffmpeg.org/wiki/Encode/Vorbis | `ffmpeg -i in.mp3 -c:a libvorbis -q:a 4 out.ogg` で品質スコア 4（128kbps 相当）の vorbis ファイルが得られる。元の mp3 より大幅に圧縮される |

GOTCHA:

- iOS Safari は `AudioContext.resume()` を呼んでも、**最初の user gesture と同じ event loop の sync block 内**で呼ばないと state が `running` にならない。`onClick={async () => { await ctx.resume(); ...}` の sync prefix で resume を起動する。
- Chrome は backgrounded tab で `AudioContext` が `interrupted` になることがある。タブ復帰時の `visibilitychange` で `state !== "running"` なら再 resume を試みる。
- `<audio>` element は同一インスタンスを連続 play すると `play()` が pending Promise の reject を返す（`AbortError`）。再生前に `pause(); currentTime = 0;` でリセットする。

---

## Patterns to Mirror

### NAMING_CONVENTION

```typescript
// SOURCE: src/lib/firebase/schemas/group.ts:22-50
export const groupBodySchema = z
  .object({
    name: z.string().min(1).max(60),
    ownerUids: z.array(z.string().min(1)).min(1),
    // ...
    memberDisplayNames: z
      .record(z.string().min(1), z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH))
      .default({}),
  })
  .refine(/* invariants */);
export type GroupBody = z.infer<typeof groupBodySchema>;
export type GroupDoc = GroupBody & { id: string };
```

新フィールド `audioSettings` は同じ pattern で additive に追加。`default()` で旧 doc を受容する。

### ERROR_HANDLING

```typescript
// SOURCE: src/lib/firebase/repositories/groups.ts:108-117
export async function updateGroupName(gid: string, name: string): Promise<void> {
  try {
    await updateDoc(groupDocRef(gid), { name });
    logger.info("group rename ok", { gid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "サークル名の更新に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, gid });
    throw wrapped;
  }
}
```

`updateAudioSettings` も同 pattern。code は `firestore/write_failed`、日本語メッセージは「サウンド設定の更新に失敗しました」。

### LOGGING_PATTERN

```typescript
// SOURCE: src/lib/firebase/repositories/groups.ts:51, 111, 130
logger.info("group create ok", { gid: ref.id });
logger.info("group rename ok", { gid });
logger.info("group roles updated", { gid, patchKeys: Object.keys(patch) });
```

`logger.info("group audio settings updated", { gid, enabled, level: ..., winner: ... })`。失敗時は `logger.warn(wrapped.message, { code: wrapped.code, gid })`。

### REPOSITORY_PATTERN

```typescript
// SOURCE: src/lib/firebase/repositories/groups.ts:166-195
export async function setMemberDisplayName(
  gid: string,
  uid: string,
  displayName: string,
): Promise<void> {
  const trimmed = displayName.trim();
  if (!trimmed) {
    throw new AppError("表示名が空です", "validation/display-name-required");
  }
  if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
    throw new AppError(/* ... */);
  }
  try {
    await updateDoc(groupDocRef(gid), {
      [`memberDisplayNames.${uid}`]: trimmed,
    });
    logger.info("group member displayName set ok", { gid, uid });
  } catch (e) {
    /* AppError.from で wrap */
  }
}
```

`updateAudioSettings` は **dot-path 書込**（`audioSettings.enabled` 等）ではなく、**object 一括上書き**（`audioSettings: { enabled, levelUpSoundId, winnerSoundId, volume }`）にする。理由: Phase 4.10 で SoundId 切替時に「未参照のキーが残る」と参照整合チェックが面倒になるため、設定は常に object 単位で書き直す。

### FIRESTORE_RULE_PATTERN（既存 owner update branch）

```firestore-rules
// SOURCE: firestore.rules:85-91
allow update: if (
  // owner update（name / ロール配列 / memberUids / memberDisplayNames 自由、
  //   ただし ownerUids 空不可・createdAt 不変）
  isSignedIn()
  && request.auth.uid in resource.data.ownerUids
  && request.resource.data.ownerUids.size() >= 1
  && request.resource.data.createdAt == resource.data.createdAt
) || (
  /* self-add / self-leave / self-key-displayName ... */
);
```

新 branch（organizer-only audioSettings update）を **既存の 4 branch のあとに OR で追加**:

```firestore-rules
|| (
  // Phase 4.9: organizer による audioSettings 単独書換。
  //   memberUids / organizerUids / ownerUids / name / createdAt / joinCodeId /
  //   memberDisplayNames は不変。audioSettings のみ変更可（map / object）。
  //   isOrganizer は既存 helper を再利用（owner も organizer に含まれる）。
  isOrganizer(gid)
  && request.resource.data.memberUids == resource.data.memberUids
  && request.resource.data.organizerUids == resource.data.organizerUids
  && request.resource.data.ownerUids == resource.data.ownerUids
  && request.resource.data.name == resource.data.name
  && request.resource.data.createdAt == resource.data.createdAt
  && request.resource.data.get('joinCodeId', null) == resource.data.get('joinCodeId', null)
  && request.resource.data.get('memberDisplayNames', {}) == resource.data.get('memberDisplayNames', {})
)
```

owner branch は包括的なため audioSettings も自由に書ける（既に通る）。owner branch を変更しないことで diff を最小化。

### HOOK_PATTERN（前回値 ref + 重複再生防止）

```typescript
// SOURCE: src/app/tournaments/[tid]/dashboard-client.tsx:121-142
const autoFinishInflightRef = useRef(false);
useEffect(() => {
  if (!userUid || !dataId || !dataGroupId) return;
  if (!groupIds.includes(dataGroupId)) return;
  if (dataState !== "running" && dataState !== "paused") return;
  if (!winnerId) return;
  if (autoFinishInflightRef.current) return;

  autoFinishInflightRef.current = true;
  // ... do work
  return () => {
    /* cleanup; reset ref on dependency change */
  };
}, [winnerId, dataId, dataState, dataGroupId, userUid, groupIds]);
```

`useAudioPlayer` の levelUp / winner 検知も **prevRef（前回値）パターン + early return** で重複再生を抑止。

### TEST_STRUCTURE

```typescript
// SOURCE: src/lib/services/timer.test.ts:1-43
import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";

import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { getLevelInfo, getRemainingMs, shouldAutoAdvance } from "./timer";

const t0 = Timestamp.fromDate(new Date("2026-04-20T10:00:00Z"));
const t0Ms = t0.toMillis();

function makeTournament(overrides: Partial<TournamentDoc> = {}): TournamentDoc {
  return {
    /* ... */
    ...overrides,
  };
}

describe("getLevelInfo", () => {
  it("returns current and next when in middle level", () => {
    /* ... */
  });
});
```

`useAudioPlayer.test.tsx` は React hook を testing-library/react の `renderHook` で wrap。Audio API は `vi.stubGlobal("HTMLMediaElement", ...)` でモック。

### REPOSITORY_TEST_MOCK_PATTERN

```typescript
// SOURCE: src/lib/firebase/repositories/groups.test.ts:1-46
vi.mock("@/lib/firebase/client", () => ({
  firestore: {},
  firebaseAuth: { currentUser: null },
}));

vi.mock("firebase/firestore", async () => {
  const actual = await vi.importActual<typeof import("firebase/firestore")>("firebase/firestore");
  return {
    ...actual,
    collection: vi.fn(/* ... */),
    doc: vi.fn(/* ... */),
    updateDoc: vi.fn(),
    /* ... */
  };
});

vi.mock("@/lib/firebase/converters", () => ({
  zodConverter: vi.fn(() => ({})),
}));
```

`updateAudioSettings` のテストもこのモックスタイルで `updateDoc` の引数を assert。

---

## Files to Change

| # | File | Action | Justification |
| - | ---- | ------ | ------------- |
| 1 | `public/sounds/blind-up.mp3` | EXIST | デフォルト音源（ブラインドアップ・mp3）。**運営者が事前調達済み**（62KB） |
| 2 | `public/sounds/blind-up.ogg` | EXIST | 同 ogg/vorbis 変換版（25KB）。ffmpeg `libvorbis -q:a 4` で生成済み |
| 3 | `public/sounds/victory-chime.mp3` | EXIST | デフォルト音源（優勝確定・mp3）。**運営者が事前調達済み**（23KB） |
| 4 | `public/sounds/victory-chime.ogg` | EXIST | 同 ogg/vorbis 変換版（13KB）。ffmpeg `libvorbis -q:a 4` で生成済み |
| 5 | `src/lib/firebase/schemas/group.ts` | UPDATE | `audioSettingsSchema` を新設、`groupBodySchema` に additive 追加。`DEFAULT_AUDIO_SETTINGS` const を export |
| 6 | `src/lib/firebase/repositories/groups.ts` | UPDATE | `updateAudioSettings(gid, settings)` 関数追加 |
| 7 | `firestore.rules` | UPDATE | `groups/{gid}` の `allow update` に organizer-only audioSettings branch を追加 |
| 8 | `src/lib/audio/sound-catalog.ts` | CREATE | `default:blind-up` / `default:victory-chime` ↔ `/sounds/*.{mp3,ogg}` のマッピング table。Phase 4.10 で `custom:<id>` 拡張時に同 module で resolve |
| 9 | `src/lib/audio/audio-context.ts` | CREATE | `getOrCreateAudioContext()` + `resumeAudioContext()` の薄いラッパー。SSR ガード（`typeof window === "undefined"`） |
| 10 | `src/lib/hooks/useAudioPlayer.ts` | CREATE | tournament + group + role を引数に取り、levelUp / winner 検知 + role filter + debounce + unlock state 公開 |
| 11 | `src/components/audio/SoundUnlockBanner.tsx` | CREATE | 「サウンドを有効化」明示 UI。useAudioPlayer の unlock state を表示 |
| 12 | `src/app/groups/[gid]/audio-settings/page.tsx` | CREATE | RequireAuth + organizer 判定 + AudioSettingsClient mount |
| 13 | `src/app/groups/[gid]/audio-settings/audio-settings-client.tsx` | CREATE | フォーム本体（enabled / levelUpSoundId / winnerSoundId / volume + 試聴 + 保存） |
| 14 | `src/app/tournaments/[tid]/dashboard-client.tsx` | UPDATE | `useAudioPlayer` フック追加 + SoundUnlockBanner 配置（運営者ロール時のみ） |
| 15 | `src/app/tournaments/[tid]/live/live-client.tsx` | UPDATE | 同上（運営者が `/live` を会場投影しているケース対応） |
| 16 | `src/app/groups/[gid]/group-detail-client.tsx` | UPDATE | ヘッダ Button 群に「サウンド設定」リンク追加（organizer 以上） |
| 17 | `src/lib/firebase/schemas/index.test.ts` | UPDATE | audioSettings の zod default / 旧 doc 受容のテスト |
| 18 | `src/lib/firebase/repositories/groups.test.ts` | UPDATE | `updateAudioSettings` のテスト追加 |
| 19 | `src/lib/hooks/useAudioPlayer.test.tsx` | CREATE | role filter / debounce / unlock state のテスト |

総計: **新規 7 / 編集 8 / 既存 4**。テストファイルは Phase 4.7 の plan に倣い「実装と同時」に書く。

> **Note**: 当初の plan では ffmpeg で純音生成スクリプトを同梱する想定だったが、運営者が mp3 を調達済み（[blind-up.mp3](public/sounds/blind-up.mp3) / [victory-chime.mp3](public/sounds/victory-chime.mp3)）。要件 Q4「mp3/ogg 両対応」を満たすため ffmpeg で ogg/vorbis 変換版（[blind-up.ogg](public/sounds/blind-up.ogg) / [victory-chime.ogg](public/sounds/victory-chime.ogg)）を生成済み。**ライセンス確認は運営者の責務**（Phase 5 のフィールドテスト前にユーザー側で license 表記の要否を確認）。

## NOT Building（Phase 4.10 へ）

- **カスタム音源アップロード UI** — Phase 4.10 で `groups/{gid}/audioAssets/{assetId}` サブコレと Storage 経由で実装
- **Firebase Storage 初期化** — Phase 4.9 では `src/lib/firebase/client.ts` に Storage SDK の import を追加しない
- **音源 metadata の Firestore 化** — `default:bell` 1 種類のみのため、ID → URL マッピングはコード（`sound-catalog.ts`）で十分
- **複数イベント拡張** — バスト時の音、席移動通知音等は将来候補。Phase 4.9 は **levelUp / winner の 2 イベントのみ**
- **個人設定（user-level audioSettings）** — group 単位の設定で全運営者が共通動作。要件 Q3 / Decisions Log 準拠
- **localStorage への on/off 保存** — group 設定が真実源。端末ローカルでの override は持たない（一貫性優先）
- **音量フェードイン / フェードアウト演出** — `<audio>` element の単純再生のみ。fade は音源ファイル自体に焼き込む（生成スクリプトで afade 適用済み）
- **複数音同時再生** — levelUp と winner はロジック上同タイミングで起きないため考慮不要
- **テスト用エミュレータでの rule 検証** — Phase 4.7 / 4.8 の plan 同様、rule 変更はローカル emulator で検証 → 本番 deploy。Phase 4.9 では emulator 専用テストファイルは作らない（既存 firestore.rules の手動検証で十分）

---

## Step-by-Step Tasks

### Task 1: デフォルト音源ファイルの配置確認

- **ACTION**: 運営者が事前調達した mp3 とその ogg/vorbis 変換版が `public/sounds/` に 4 ファイル配置されていることを確認し、git に追加する
- **状態**（plan 生成時に配置・変換済み）:
  - [public/sounds/blind-up.mp3](public/sounds/blind-up.mp3) — ブラインドアップ通知音 mp3（62KB）
  - [public/sounds/blind-up.ogg](public/sounds/blind-up.ogg) — 同 ogg/vorbis（25KB、ffmpeg `libvorbis -q:a 4` で変換）
  - [public/sounds/victory-chime.mp3](public/sounds/victory-chime.mp3) — 優勝確定通知音 mp3（23KB）
  - [public/sounds/victory-chime.ogg](public/sounds/victory-chime.ogg) — 同 ogg/vorbis（13KB）
- **IMPLEMENT**: ファイルは既に配置済み。実装作業として必要なのは `git add public/sounds/` のみ。**ogg 再生成手順**は次のとおり（後続フェーズで音源差替時に再現可能にしておく）:
  ```bash
  # winget install Gyan.FFmpeg --accept-source-agreements --accept-package-agreements
  ffmpeg -y -i public/sounds/blind-up.mp3 -c:a libvorbis -q:a 4 public/sounds/blind-up.ogg
  ffmpeg -y -i public/sounds/victory-chime.mp3 -c:a libvorbis -q:a 4 public/sounds/victory-chime.ogg
  ```
- **MIRROR**: なし
- **IMPORTS**: なし
- **GOTCHA**:
  - Next.js は `public/` 配下を **絶対パス `/sounds/...`** で配信する。コードからは `<audio src="/sounds/blind-up.mp3" />` で参照する
  - **ライセンス**: 運営者が調達した音源のため、配布元のライセンス条件（帰属表示要否、商用利用可否）を Phase 5 投入前に確認すること。MIT 配布リポジトリで再配布する以上、CC0 / Public Domain / 帰属表示込みの fair use のいずれかを満たす必要あり。**plan 実装中の作業者は確認しない**（運営者側で済ませる前提）
  - mp3 を差し替えた場合、上記 ffmpeg コマンドで ogg も同時に再生成すること（ファイル間の音内容が drift しないように）
  - 将来的に音源を差し替える場合は、ファイル名を変えずに同名で上書きすれば catalog の修正は不要
- **VALIDATE**:
  - `ls -la public/sounds/` で 4 ファイル存在（mp3 2 + ogg 2）
  - `npm run dev` 起動後、ブラウザで `http://localhost:3000/sounds/blind-up.mp3` および `.ogg` を直接開いて再生確認
  - `git status` で 4 ファイルが新規追加として表示

### Task 2: zod schema 拡張（`audioSettings` additive 追加）

- **ACTION**: `src/lib/firebase/schemas/group.ts` に `audioSettingsSchema` / `DEFAULT_AUDIO_SETTINGS` を追加し、`groupBodySchema` に追加
- **IMPLEMENT**:
  ```typescript
  // src/lib/firebase/schemas/group.ts に追加

  /**
   * Phase 4.9: サークル単位の音声通知設定。
   *   - on/off / 音源ID / 音量 を group 単位で永続化
   *   - 旧 doc は default() で受容（破壊的 migration なし）
   *   - levelUpSoundId / winnerSoundId は string で受容
   *     （Phase 4.9 は "default:blind-up" / "default:victory-chime"、
   *      Phase 4.10 で "custom:<assetId>" 形式に拡張される）
   */
  export const audioSettingsSchema = z
    .object({
      enabled: z.boolean(),
      levelUpSoundId: z.string().min(1),
      winnerSoundId: z.string().min(1),
      volume: z.number().min(0).max(1),
    })
    .default({
      enabled: true,
      levelUpSoundId: "default:blind-up",
      winnerSoundId: "default:victory-chime",
      volume: 0.7,
    });
  export type AudioSettings = z.infer<typeof audioSettingsSchema>;

  export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
    enabled: true,
    levelUpSoundId: "default:blind-up",
    winnerSoundId: "default:victory-chime",
    volume: 0.7,
  };
  ```

  そして `groupBodySchema` の object に `audioSettings: audioSettingsSchema,` を追加。
- **MIRROR**:
  - NAMING_CONVENTION（`audioSettingsSchema` / `AudioSettings` / `DEFAULT_AUDIO_SETTINGS`）
  - `memberDisplayNames` の `default({})` パターン（schemas/group.ts:38-40）
- **IMPORTS**: 既存の `import { z } from "zod"` で十分
- **GOTCHA**:
  - `default()` の引数が **同一 object 参照**だと将来 schema 変更時にハマる。`DEFAULT_AUDIO_SETTINGS` を別 const として export し、UI 側でも参照できるようにする
  - `volume: z.number().min(0).max(1)` の range は **小数 0.0〜1.0**（HTMLAudioElement.volume と同じ）
  - `.refine()` の invariants は不要（フィールド独立）
- **VALIDATE**:
  - `npm run typecheck` で型エラー無し
  - 既存 group docs（`audioSettings` フィールドが無い）に対し `groupBodySchema.safeParse(legacy)` が success を返し、`data.audioSettings === DEFAULT_AUDIO_SETTINGS` 相当の値を含むこと

### Task 3: repository 関数追加（`updateAudioSettings`）

- **ACTION**: `src/lib/firebase/repositories/groups.ts` に `updateAudioSettings(gid, settings)` を追加
- **IMPLEMENT**:
  ```typescript
  import {
    type AudioSettings,
    audioSettingsSchema,
    /* 既存 imports */
  } from "@/lib/firebase/schemas/group";

  export async function updateAudioSettings(
    gid: string,
    settings: AudioSettings,
  ): Promise<void> {
    // schema 経由で最終 validation。UI で組み上げた値の防御線。
    const parsed = audioSettingsSchema.safeParse(settings);
    if (!parsed.success) {
      throw new AppError(
        "サウンド設定の値が不正です",
        "validation/audio-settings-invalid",
        parsed.error,
      );
    }
    try {
      await updateDoc(groupDocRef(gid), { audioSettings: parsed.data });
      logger.info("group audio settings updated", {
        gid,
        enabled: parsed.data.enabled,
        volume: parsed.data.volume,
      });
    } catch (e) {
      const wrapped = AppError.from(
        e,
        "firestore/write_failed",
        "サウンド設定の更新に失敗しました",
      );
      logger.warn(wrapped.message, { code: wrapped.code, gid });
      throw wrapped;
    }
  }
  ```
- **MIRROR**:
  - ERROR_HANDLING（`updateGroupName`）
  - REPOSITORY_PATTERN（`setMemberDisplayName` の前段 validation 部分）
  - LOGGING_PATTERN（`logger.info("group ... ok", { gid, ...meta })`）
- **IMPORTS**: `updateDoc`（既存）、`audioSettingsSchema` / `AudioSettings`
- **GOTCHA**:
  - `audioSettings` を **object 一括上書き**で書く（dot-path にしない）。これにより Phase 4.10 で SoundId 切替時に「未参照の field が残る」事故を回避
  - schema 経由の validation を repository 層に置く（UI 側でも validation するが、SDK 直叩き対策）
  - rule 側でも値の型は強制されないため（owner / organizer は audioSettings 自由書込可能）、application 層での validation が最終ラインになる
- **VALIDATE**:
  - `vitest run src/lib/firebase/repositories/groups.test.ts`（Task 9 で追加するテスト）が pass
  - emulator で organizer 権限の uid から `updateAudioSettings("g1", { enabled: false, ... })` を呼び permission-denied にならない

### Task 4: Firestore Rules 拡張（organizer-only audioSettings branch）

- **ACTION**: `firestore.rules` の `match /groups/{gid}` の `allow update` に organizer 用 branch を追加
- **IMPLEMENT**:
  既存の self-key displayName branch（L153-172）の **直後に OR で追加**:
  ```firestore-rules
  || (
    // Phase 4.9: organizer による audioSettings 単独書換。
    //   memberUids / organizerUids / ownerUids / name / createdAt / joinCodeId /
    //   memberDisplayNames は不変。audioSettings のみ変更可。
    //   isOrganizer は既存 helper を再利用（owner も含まれる）。
    //   audioSettings の中身（enabled bool / volume number range / soundId string）の
    //   field-level validation は application 層 (zod) に委譲する。rule で network round-trip
    //   ごとに deep validate するとレイテンシが増えるため。
    isOrganizer(gid)
    && request.resource.data.memberUids == resource.data.memberUids
    && request.resource.data.organizerUids == resource.data.organizerUids
    && request.resource.data.ownerUids == resource.data.ownerUids
    && request.resource.data.name == resource.data.name
    && request.resource.data.createdAt == resource.data.createdAt
    && request.resource.data.get('joinCodeId', null) == resource.data.get('joinCodeId', null)
    && request.resource.data.get('memberDisplayNames', {}) == resource.data.get('memberDisplayNames', {})
  );
  ```
- **MIRROR**: FIRESTORE_RULE_PATTERN（既存 self-leave / self-key displayName branch の immutable フィールド列挙パターン）
- **IMPORTS**: なし（rule 内 helper のみ）
- **GOTCHA**:
  - **`audioSettings` フィールド自体の比較は書かない**（owner branch との競合回避 + zod 化での lawful な default 補完を許容）
  - `isOrganizer(gid)` は既存 helper（rule L28-32）を再利用。owner も含まれるため owner 経由 update も通る（owner branch とは独立に通る・OR なので問題なし）
  - **owner branch を変更しない**ことで diff 最小化。owner は包括的 update ができ、audioSettings も自由に書ける
  - rule に `audioSettings` のフィールド型 / range の validation は入れない理由: zod 側で完結させ、rule をシンプルに保つ。攻撃者が SDK 直叩きで不正な値を書く攻撃ベクトルは organizer 権限を持つ前提のため、組織内のリスクとして application 層で十分
- **VALIDATE**:
  - emulator で以下を検証:
    - organizer uid: `updateDoc(groups/g1, { audioSettings: { enabled: false, ... } })` → 成功
    - member uid（非 organizer）: 同上 → permission-denied
    - 非メンバー: 同上 → permission-denied
    - organizer uid: `updateDoc(groups/g1, { audioSettings: ..., name: "hijack" })` → permission-denied（name が変化するため新 branch を満たさず、owner branch も満たさない）
    - organizer uid: `updateDoc(groups/g1, { audioSettings: ..., memberUids: [...新リスト] })` → permission-denied
  - `firebase deploy --only firestore:rules` でデプロイ前にローカル emulator で確認

### Task 5: Sound catalog（音源 ID → URL マッピング）

- **ACTION**: `src/lib/audio/sound-catalog.ts` を新設
- **IMPLEMENT**:
  ```typescript
  /**
   * Phase 4.9: 音源 ID と実 URL のマッピング。
   *   - "default:<key>" 形式: bundle 済み音源（public/sounds/）
   *   - Phase 4.10 で "custom:<assetId>" 形式が追加される（Firebase Storage URL）
   *
   * UI のプルダウンに表示する選択肢もここで定義。
   */

  export interface SoundOption {
    id: string;
    label: string;
    /** ブラウザが優先的に試行する順序で URL を返す（複数 codec 同梱時に使用）。 */
    sources: { src: string; type: "audio/mpeg" | "audio/ogg" }[];
  }

  const DEFAULT_SOUNDS: SoundOption[] = [
    {
      id: "default:blind-up",
      label: "ブラインドアップ",
      // ogg を先に置くと Firefox / Chrome は ogg を選び、Safari/iOS は次の mp3 にフォールバック。
      // 軽量な codec を優先することで初回ダウンロード時間を最小化。
      sources: [
        { src: "/sounds/blind-up.ogg", type: "audio/ogg" },
        { src: "/sounds/blind-up.mp3", type: "audio/mpeg" },
      ],
    },
    {
      id: "default:victory-chime",
      label: "優勝チャイム",
      sources: [
        { src: "/sounds/victory-chime.ogg", type: "audio/ogg" },
        { src: "/sounds/victory-chime.mp3", type: "audio/mpeg" },
      ],
    },
  ];

  /** Phase 4.9 のデフォルト割り当て。schema の DEFAULT_AUDIO_SETTINGS と同期する。 */
  export const DEFAULT_LEVEL_UP_SOUND_ID = "default:blind-up";
  export const DEFAULT_WINNER_SOUND_ID = "default:victory-chime";

  export function listAvailableSounds(): SoundOption[] {
    // Phase 4.10 で custom 音源も merge する。
    return DEFAULT_SOUNDS;
  }

  export function resolveSound(soundId: string): SoundOption {
    const found = DEFAULT_SOUNDS.find((s) => s.id === soundId);
    if (found) return found;
    // 未知 ID は levelUp 側のデフォルトにフォールバック（Phase 4.10 で削除された custom 音源 ID 対応）。
    return DEFAULT_SOUNDS[0];
  }
  ```
- **MIRROR**: NAMING_CONVENTION（camelCase 関数 / PascalCase interface）
- **IMPORTS**: なし
- **GOTCHA**:
  - **ogg を先頭**に置く: `<audio>` element / `canPlayType` は配列順で codec を選ぶため、軽量な ogg を Firefox / Chrome / Edge に優先選択させ、Safari/iOS は ogg を skip して次の mp3 にフォールバックする
  - URL は **絶対パス `/sounds/blind-up.{mp3,ogg}`**。Next.js の `public/` 直下は static で配信される
  - `DEFAULT_LEVEL_UP_SOUND_ID` / `DEFAULT_WINNER_SOUND_ID` は schema (`DEFAULT_AUDIO_SETTINGS`) と **同期する**ため、ここから schema が import する形にする（または逆方向）。Task 2 の schema で参照する
  - Phase 4.10 で `resolveSound` が non-throwing fallback を持つ設計が、削除済みカスタム音源 ID に対する自然な救済になる
- **VALIDATE**: `npm run typecheck` で型エラー無し / `listAvailableSounds().length === 2` / `resolveSound("default:blind-up").sources[0].type === "audio/ogg"`

### Task 6: AudioContext ラッパー

- **ACTION**: `src/lib/audio/audio-context.ts` を新設
- **IMPLEMENT**:
  ```typescript
  /**
   * Phase 4.9: ブラウザ autoplay policy 対策の薄い wrapper。
   *   - SSR で AudioContext を触らない（build error 回避）
   *   - 1 タブ内で 1 つの AudioContext を使い回す（vendor 制限）
   *   - resume は user gesture と同 event loop で sync 実行できる callable を返す
   */

  let cachedContext: AudioContext | null = null;

  export function getOrCreateAudioContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (cachedContext) return cachedContext;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    cachedContext = new Ctor();
    return cachedContext;
  }

  /**
   * AudioContext を resume する。user gesture 内で同期的に呼ぶこと。
   * 戻り値: resume 後の state（"running" / "suspended" / "closed" / null=作れず）
   */
  export async function resumeAudioContext(): Promise<AudioContextState | null> {
    const ctx = getOrCreateAudioContext();
    if (!ctx) return null;
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    return ctx.state;
  }
  ```
- **MIRROR**: NAMING_CONVENTION（singleton パターン: schemas/group.ts の DEFAULT_AUDIO_SETTINGS と同質）
- **IMPORTS**: 標準 Web API のみ（Web Audio API types は TS 標準）
- **GOTCHA**:
  - Safari は `webkitAudioContext` フォールバック必須（cast 経由）
  - SSR で `new AudioContext()` を呼ぶと crash。`typeof window === "undefined"` ガード必須
  - context は `close()` しない（タブ閉じで GC）。再利用前提
  - **`<audio>` element 自体は AudioContext と独立**だが、Chrome は両者の policy を共有する（一方を unlock すれば他方も鳴る）
- **VALIDATE**:
  - `npm run typecheck` 通過
  - 手動: `/tournaments/{tid}` を運営者で開いて Console から `await window.__test_resume?.()` のような hooks で state が "running" になることを確認（実装は test 用 hook ではなく E2E でカバー）

### Task 7: useAudioPlayer フック新設

- **ACTION**: `src/lib/hooks/useAudioPlayer.ts` を新設
- **IMPLEMENT**:
  ```typescript
  "use client";

  import { useCallback, useEffect, useRef, useState } from "react";

  import { resumeAudioContext } from "@/lib/audio/audio-context";
  import { resolveSound } from "@/lib/audio/sound-catalog";
  import { AppError } from "@/lib/errors";
  import type { GroupDoc } from "@/lib/firebase/schemas/group";
  import type { PlayerDoc } from "@/lib/firebase/schemas/player";
  import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
  import { logger } from "@/lib/logger";
  import { resolveWinner } from "@/lib/services/timer";

  export type AudioRole = "owner" | "organizer" | "member" | null;

  interface UseAudioPlayerArgs {
    /** 現在 view している tournament（null 可：tournament ロード前） */
    tournament: TournamentDoc | null;
    /** 現在 view している tournament の group（null 可：group 未確定） */
    group: GroupDoc | null;
    /** 現在 view している tournament の players（winner 判定用） */
    players: readonly PlayerDoc[];
    /** view している user の current role */
    role: AudioRole;
  }

  interface UseAudioPlayerState {
    /** AudioContext の state（"running" になっていれば自動再生可能） */
    unlocked: boolean;
    /** ユーザー操作で unlock を試みる callable */
    unlock: () => Promise<void>;
    /** 試聴用に手動再生（settings ページの「試聴」ボタン用） */
    preview: (soundId: string) => Promise<void>;
  }

  /**
   * Phase 4.9 — Audio Notifications.
   *
   * tournament の `currentLevel` 変化と resolveWinner の null → PlayerDoc 遷移を
   * 観測し、運営者ロール（owner / organizer）かつ group.audioSettings.enabled の場合
   * のみ音を鳴らす。前回値 ref + early return で重複再生を抑止。
   */
  export function useAudioPlayer({
    tournament,
    group,
    players,
    role,
  }: UseAudioPlayerArgs): UseAudioPlayerState {
    const [unlocked, setUnlocked] = useState(false);

    // 前回値を保持して transition を検知する。
    const prevLevelRef = useRef<number | null>(null);
    const prevWinnerIdRef = useRef<string | null>(null);

    // 共有 <audio> インスタンス（unmount 時に破棄）。
    const audioElRef = useRef<HTMLAudioElement | null>(null);

    const isOrganizer = role === "owner" || role === "organizer";
    const enabled = group?.audioSettings.enabled ?? false;
    const volume = group?.audioSettings.volume ?? 0.7;

    // 共通の play 関数。前提: unlocked === true.
    const play = useCallback(
      async (soundId: string) => {
        if (!isOrganizer || !enabled || !unlocked) return;
        const sound = resolveSound(soundId);
        const audio =
          audioElRef.current ?? (audioElRef.current = new Audio());
        // mp3 → ogg fallback。canPlayType で先頭 supported を選択。
        const supported = sound.sources.find(
          (s) => audio.canPlayType(s.type) !== "",
        );
        if (!supported) return;
        try {
          audio.pause();
          audio.currentTime = 0;
          audio.src = supported.src;
          audio.volume = Math.max(0, Math.min(1, volume));
          await audio.play();
        } catch (e) {
          const wrapped = AppError.from(e, "audio/play-failed", "音声再生に失敗しました");
          logger.warn(wrapped.message, { code: wrapped.code, soundId });
        }
      },
      [isOrganizer, enabled, unlocked, volume],
    );

    const unlock = useCallback(async () => {
      const state = await resumeAudioContext();
      if (state === "running") setUnlocked(true);
    }, []);

    const preview = useCallback(
      async (soundId: string) => {
        if (!unlocked) await unlock();
        await play(soundId);
      },
      [unlock, play, unlocked],
    );

    // levelUp 検知: currentLevel の変化 + 初期化時は ref のみセットして音は出さない
    useEffect(() => {
      const lv = tournament?.currentLevel ?? null;
      if (lv === null) return;
      const prev = prevLevelRef.current;
      prevLevelRef.current = lv;
      if (prev === null) return; // 初回は鳴らさない
      if (prev === lv) return;
      // 状態が "running" / "paused" のみ。setup や finished は除外。
      const st = tournament?.state;
      if (st !== "running" && st !== "paused") return;
      void play(group?.audioSettings.levelUpSoundId ?? "default:blind-up");
    }, [tournament?.currentLevel, tournament?.state, group?.audioSettings.levelUpSoundId, play]);

    // winner 検知: null → PlayerDoc 遷移
    useEffect(() => {
      if (!tournament) return;
      const w = resolveWinner(tournament, players);
      const wid = w?.id ?? null;
      const prev = prevWinnerIdRef.current;
      prevWinnerIdRef.current = wid;
      if (prev === null && wid !== null) {
        void play(group?.audioSettings.winnerSoundId ?? "default:victory-chime");
      }
    }, [tournament, players, group?.audioSettings.winnerSoundId, play]);

    // unmount 時に audio を破棄
    useEffect(() => {
      return () => {
        audioElRef.current?.pause();
        audioElRef.current = null;
      };
    }, []);

    return { unlocked, unlock, preview };
  }
  ```
- **MIRROR**:
  - HOOK_PATTERN（`autoFinishInflightRef` の useRef + early return + 依存最小化）
  - dashboard-client.tsx:108-142 の primitive 依存パターン
- **IMPORTS**: 上記コードに記載
- **GOTCHA**:
  - **初回 mount 時に level=1 が入ると鳴ってしまう**問題への対策: `prev === null` の場合は ref セットのみで return
  - `setup` / `seating` / `finished` 状態は audio 対象外（auto-advance が起きない / 既に終わっているため）
  - `prevWinnerIdRef === null && wid !== null` を条件にすることで「同じ winner で何度も鳴らない」「winner 取消し→再確定で鳴らす」を両立
  - `audio.canPlayType` は **空文字 ""** を返すこともある（空 = 不支持）。`!== ""` で判定
  - `play()` は async だが、useEffect 内では `void play(...)` で起動して await しない（unmount 時の Promise leak は AbortController を導入するほどでもない短時間処理）
  - Reconnect / auto-advance race のときに同 currentLevel が複数 snapshot で再 emit される可能性あるが、`prev === lv` の早期 return で吸収される
- **VALIDATE**:
  - Task 11 のテストが pass
  - 手動: 運営者で `/tournaments/{tid}` 開く → unlock → `currentLevel` を手動 advance → 音が鳴る
  - 手動: 参加者（member）で同 tournament の `/live` を開く → unlock UI が出ない → 音が鳴らない

### Task 8: SoundUnlockBanner コンポーネント

- **ACTION**: `src/components/audio/SoundUnlockBanner.tsx` を新設
- **IMPLEMENT**:
  ```typescript
  "use client";

  import Link from "next/link";

  import { Button } from "@/components/ui/button";

  interface SoundUnlockBannerProps {
    unlocked: boolean;
    enabled: boolean;
    onUnlock: () => Promise<void>;
    /** "/groups/{gid}/audio-settings" — 設定ページへのリンク */
    settingsHref: string;
  }

  /**
   * Phase 4.9: 「サウンドを有効化」明示 UI。
   *   - enabled=false なら何も描画しない（混乱回避）
   *   - unlocked=true 後は確認バーのみ表示
   *   - 親は role 判定済みで mount を制御する想定（このコンポーネント自身は role を見ない）
   */
  export function SoundUnlockBanner({
    unlocked,
    enabled,
    onUnlock,
    settingsHref,
  }: SoundUnlockBannerProps) {
    if (!enabled) return null;

    if (!unlocked) {
      return (
        <section
          role="status"
          aria-live="polite"
          className="flex w-full items-center justify-between rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-900/20"
        >
          <div className="flex items-center gap-2">
            <span aria-hidden>🔔</span>
            <span>
              ブラインド変更／優勝確定で音を鳴らせます。最初に有効化してください。
            </span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void onUnlock()}>
              サウンドを有効化
            </Button>
            <Link href={settingsHref}>
              <Button size="sm" variant="outline">
                設定
              </Button>
            </Link>
          </div>
        </section>
      );
    }

    return (
      <section className="flex w-full items-center justify-between rounded-lg border bg-muted/40 p-2 text-xs text-muted-foreground">
        <span>
          <span aria-hidden>✓</span> サウンド有効
        </span>
        <Link href={settingsHref}>
          <Button size="sm" variant="ghost">
            設定
          </Button>
        </Link>
      </section>
    );
  }
  ```
- **MIRROR**: dashboard-client.tsx の Card/Header パターン、live-client.tsx の `aria-live="polite"` パターン
- **IMPORTS**: 既存の `@/components/ui/button` / next/link
- **GOTCHA**:
  - `enabled === false` の早期 return がないと、設定で消したのに UI に banner が残る違和感が出る
  - role 判定はこのコンポーネント外で行う（mount 自体を制御）
  - Tailwind の amber 色は WinnerBanner と被るが、優勝バナーは大型カード・unlock banner は小型なので視覚的に区別される
- **VALIDATE**: 手動レンダリング確認（ストーリー的にはなし）

### Task 9: Audio Settings ページとクライアント

- **ACTION**: 以下 2 ファイルを新設
  1. `src/app/groups/[gid]/audio-settings/page.tsx`（server entry / params 受け）
  2. `src/app/groups/[gid]/audio-settings/audio-settings-client.tsx`（フォーム本体）
- **IMPLEMENT**:

  `page.tsx`:
  ```typescript
  import { RequireAuth } from "@/components/auth/RequireAuth";

  import { AudioSettingsClient } from "./audio-settings-client";

  export default async function Page({
    params,
  }: {
    params: Promise<{ gid: string }>;
  }) {
    const { gid } = await params;
    return (
      <RequireAuth allowAnonymous={false}>
        <AudioSettingsClient gid={gid} />
      </RequireAuth>
    );
  }
  ```

  `audio-settings-client.tsx`（要点抜粋）:
  ```typescript
  "use client";

  import Link from "next/link";
  import { useRouter } from "next/navigation";
  import { useCallback, useEffect, useState } from "react";

  import { Button } from "@/components/ui/button";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
  import { Input } from "@/components/ui/input";
  import { listAvailableSounds } from "@/lib/audio/sound-catalog";
  import { AppError } from "@/lib/errors";
  import { useAuthUser } from "@/lib/firebase/AuthProvider";
  import { getGroup, updateAudioSettings } from "@/lib/firebase/repositories/groups";
  import {
    deriveRole,
    DEFAULT_AUDIO_SETTINGS,
    type AudioSettings,
    type GroupDoc,
  } from "@/lib/firebase/schemas/group";
  import { useAudioPlayer } from "@/lib/hooks/useAudioPlayer";
  import { logger } from "@/lib/logger";

  export function AudioSettingsClient({ gid }: { gid: string }) {
    const { user } = useAuthUser();
    const router = useRouter();
    const [group, setGroup] = useState<GroupDoc | null>(null);
    const [settings, setSettings] = useState<AudioSettings>(DEFAULT_AUDIO_SETTINGS);
    const [working, setWorking] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // role 判定 → member は redirect
    useEffect(() => {
      if (!user) return;
      void (async () => {
        try {
          const g = await getGroup(gid);
          setGroup(g);
          setSettings(g.audioSettings);
          const role = deriveRole(g, user.uid);
          if (role !== "owner" && role !== "organizer") {
            router.replace(`/groups/${gid}`);
          }
        } catch (e) {
          const wrapped = AppError.from(e, "firestore/read_failed", "サークル取得失敗");
          logger.warn(wrapped.message, { code: wrapped.code, gid });
          setError(`${wrapped.code}: ${wrapped.message}`);
        }
      })();
    }, [gid, user, router]);

    const player = useAudioPlayer({
      tournament: null,
      group,
      players: [],
      role: user && group ? deriveRole(group, user.uid) : null,
    });

    const onSave = useCallback(async () => {
      setWorking(true);
      setError(null);
      try {
        await updateAudioSettings(gid, settings);
        router.push(`/groups/${gid}`);
      } catch (e) {
        const wrapped = AppError.from(
          e,
          "firestore/write_failed",
          "サウンド設定の更新に失敗しました",
        );
        setError(`${wrapped.code}: ${wrapped.message}`);
      } finally {
        setWorking(false);
      }
    }, [gid, settings, router]);

    if (!user) return null;
    if (!group) {
      return (
        <main className="mx-auto max-w-md p-8 text-sm text-muted-foreground">
          {error ?? "読込中…"}
        </main>
      );
    }

    const sounds = listAvailableSounds();

    return (
      <main className="mx-auto max-w-md space-y-6 p-8">
        <header>
          <Link href={`/groups/${gid}`} className="text-sm text-muted-foreground">
            ← サークルへ戻る
          </Link>
          <h1 className="mt-2 text-2xl font-bold">サウンド設定</h1>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>通知音</CardTitle>
            <CardDescription>
              ブラインド変更／優勝確定で音を鳴らします。設定はサークル全体に反映されます。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, enabled: e.target.checked }))
                }
              />
              <span>通知音を有効にする</span>
            </label>

            <div className="space-y-2">
              <label className="block text-sm">
                ブラインド変更時:
                <select
                  value={settings.levelUpSoundId}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, levelUpSoundId: e.target.value }))
                  }
                  className="ml-2 rounded border px-2 py-1 text-sm"
                >
                  {sounds.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-2"
                  onClick={() => void player.preview(settings.levelUpSoundId)}
                >
                  試聴
                </Button>
              </label>

              <label className="block text-sm">
                優勝確定時:
                <select
                  value={settings.winnerSoundId}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, winnerSoundId: e.target.value }))
                  }
                  className="ml-2 rounded border px-2 py-1 text-sm"
                >
                  {sounds.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-2"
                  onClick={() => void player.preview(settings.winnerSoundId)}
                >
                  試聴
                </Button>
              </label>
            </div>

            <label className="block text-sm">
              音量: {Math.round(settings.volume * 100)}%
              <Input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.volume}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, volume: Number(e.target.value) }))
                }
              />
            </label>

            {!player.unlocked ? (
              <p className="text-xs text-muted-foreground">
                試聴ボタンを押すとブラウザのサウンド権限を有効にします。
              </p>
            ) : null}

            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Link href={`/groups/${gid}`}>
                <Button variant="outline">キャンセル</Button>
              </Link>
              <Button onClick={() => void onSave()} disabled={working}>
                {working ? "保存中…" : "保存"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }
  ```
- **MIRROR**:
  - group-detail-client.tsx の `getGroup` + role 判定 + redirect パターン（L81-141）
  - tournament-edit-client や structure form の Card / Button レイアウト
- **IMPORTS**: 上記コード参照
- **GOTCHA**:
  - **匿名ユーザーは `RequireAuth(allowAnonymous=false)` で弾く**（Phase 4.8 の structureTemplates と同方針）
  - role 判定は groups read 後に行う（loading 中は banner なし）
  - 試聴は **AudioSettingsClient 内で完結**（tournament を None で渡しているので levelUp/winner 検知は走らない、preview のみ動く）
  - `<input type="range">` を `Input` で wrap すると Tailwind スタイルが効かないことがある。基本 `Input` で問題ないが、必要なら `<input>` 直接でも可
  - select の選択肢は Phase 4.9 では 1 件のみだが、Phase 4.10 で増えるため `listAvailableSounds()` を呼ぶ
- **VALIDATE**:
  - 手動: organizer で `/groups/{gid}/audio-settings` を開いて有効化トグル / 試聴 / 音量調整 / 保存
  - 手動: member で同 URL に直アクセス → `/groups/{gid}` に redirect
  - 手動: 匿名で同 URL → ログインページに redirect

### Task 10: dashboard-client / live-client への組み込み

- **ACTION**: 両 client に `useAudioPlayer` + `SoundUnlockBanner` を組み込む。group の取得は `useCurrentGroup` から（既存）。tournament.groupId と current group の整合確認は dashboard 既存の redirect ロジックで十分

  **dashboard-client.tsx**（運営者ロール時のみ render される箇所）:
  ```typescript
  // 既存 import に追加
  import { SoundUnlockBanner } from "@/components/audio/SoundUnlockBanner";
  import { useAudioPlayer } from "@/lib/hooks/useAudioPlayer";

  // 関数内 (currentGroup, myRole が取れた後に追加)
  const audioPlayer = useAudioPlayer({
    tournament: data,
    group: currentGroup ?? null,
    players,
    role: myRole,
  });

  // render の TimerDisplay の前に追加
  {currentGroup && isOrganizer ? (
    <SoundUnlockBanner
      unlocked={audioPlayer.unlocked}
      enabled={currentGroup.audioSettings.enabled}
      onUnlock={audioPlayer.unlock}
      settingsHref={`/groups/${currentGroup.id}/audio-settings`}
    />
  ) : null}
  ```

  **live-client.tsx**（誰でも見られる /live。運営者ロール時のみ banner と音）:
  - `useCurrentGroup` を import し、tournament.groupId に対応する group / role を取得
  - `useAudioPlayer({ tournament, group, players, role })` を呼ぶ
  - `role === "owner" || role === "organizer"` のときのみ SoundUnlockBanner を render
- **MIRROR**: dashboard-client.tsx 既存の role 判定 → 表示分岐パターン（L186-191）
- **IMPORTS**: 上記
- **GOTCHA**:
  - dashboard-client は既に `currentGroup` / `myRole` を持っているので、そのまま渡す
  - live-client は tournament の groupId に対応する group を `useCurrentGroup().groups.find(...)` で取り、`deriveRole` で role を計算する。**tournament の group が current group でないケースもあり得る**ため `groups.find` で確実に取る
  - SoundUnlockBanner は `enabled === false` のとき自動で非表示になるので、親側で再 check 不要
  - **重要**: live-client では既存の `useTournamentTimer(tid)` が `autoAdvance` を渡していない（参加者ビュー）。useAudioPlayer は autoAdvance とは独立に動くので問題なし
- **VALIDATE**:
  - 手動: organizer で `/tournaments/{tid}` → unlock → 任意のレベル進行操作 → 音が鳴る
  - 手動: organizer で `/tournaments/{tid}/live` を全画面表示 → unlock → 同上
  - 手動: member で `/tournaments/{tid}/live` → banner 出ない / 音も鳴らない
  - 手動: anonymous で `/tournaments/{tid}/live`（受付フローで匿名入った後）→ banner 出ない / 音も鳴らない

### Task 11: group-detail-client にリンク追加

- **ACTION**: `src/app/groups/[gid]/group-detail-client.tsx` のヘッダ Button 群（L262-305 周辺）に「サウンド設定」リンクを追加
- **IMPLEMENT**:
  ```typescript
  // isOrganizer ? <ストラクチャ Button /> : null の直後に追加
  {isOrganizer ? (
    <Link href={`/groups/${gid}/audio-settings`}>
      <Button variant="outline" size="sm">
        サウンド設定
      </Button>
    </Link>
  ) : null}
  ```
- **MIRROR**: 既存の「ストラクチャ」 Button / 「トーナメント」 Button のスタイル
- **IMPORTS**: 既存の `next/link` / Button
- **GOTCHA**:
  - **organizer 以上**にだけ表示する（owner / organizer 共に同じ条件）
  - rename / delete Button より上、ストラクチャ Button の下に配置すると視線の流れが自然
- **VALIDATE**:
  - 手動: owner で `/groups/{gid}` → 「サウンド設定」ボタン表示
  - 手動: organizer で同上
  - 手動: member で同上 → ボタン表示されない

### Task 12: schema test 追加

- **ACTION**: `src/lib/firebase/schemas/index.test.ts` （または `group.test.ts` 新設）に audioSettings の zod default テストを追加
- **IMPLEMENT**:
  ```typescript
  import { describe, it, expect } from "vitest";

  import { groupBodySchema, DEFAULT_AUDIO_SETTINGS } from "@/lib/firebase/schemas/group";

  describe("groupBodySchema audioSettings", () => {
    it("supplies default audioSettings when missing (legacy doc)", () => {
      const legacy = {
        name: "Saturday",
        ownerUids: ["u1"],
        organizerUids: ["u1"],
        memberUids: ["u1"],
        createdAt: { toMillis: () => 0 } as never,
        memberDisplayNames: {},
      };
      const parsed = groupBodySchema.parse(legacy);
      expect(parsed.audioSettings).toEqual(DEFAULT_AUDIO_SETTINGS);
    });

    it("preserves explicit audioSettings", () => {
      const doc = {
        /* legacy 同上 */
        name: "Saturday",
        ownerUids: ["u1"],
        organizerUids: ["u1"],
        memberUids: ["u1"],
        createdAt: { toMillis: () => 0 } as never,
        memberDisplayNames: {},
        audioSettings: {
          enabled: false,
          levelUpSoundId: "default:blind-up",
          winnerSoundId: "default:victory-chime",
          volume: 0.3,
        },
      };
      const parsed = groupBodySchema.parse(doc);
      expect(parsed.audioSettings.enabled).toBe(false);
      expect(parsed.audioSettings.volume).toBe(0.3);
    });

    it("rejects volume out of range", () => {
      const bad = {
        /* ... */
        audioSettings: { enabled: true, levelUpSoundId: "x", winnerSoundId: "x", volume: 1.5 },
      };
      expect(() => groupBodySchema.parse(bad)).toThrow();
    });
  });
  ```
- **MIRROR**: TEST_STRUCTURE（Phase 4.7 の groups schema test と同パターン）
- **GOTCHA**: createdAt は Timestamp instance を期待するため、minimum mock として `{ toMillis: () => 0 }` を cast する（既存テストでも類似手法を使用）
- **VALIDATE**: `npm run test -- src/lib/firebase/schemas`

### Task 13: repository test 追加

- **ACTION**: `src/lib/firebase/repositories/groups.test.ts` に `updateAudioSettings` のテストを追加
- **IMPLEMENT**:
  ```typescript
  import { updateAudioSettings } from "./groups";

  describe("updateAudioSettings", () => {
    it("writes audioSettings as a single object field", async () => {
      vi.mocked(updateDoc).mockResolvedValue(undefined as never);

      await updateAudioSettings("g1", {
        enabled: true,
        levelUpSoundId: "default:blind-up",
        winnerSoundId: "default:victory-chime",
        volume: 0.5,
      });

      expect(updateDoc).toHaveBeenCalledTimes(1);
      const [, patch] = vi.mocked(updateDoc).mock.calls[0];
      expect(patch).toEqual({
        audioSettings: {
          enabled: true,
          levelUpSoundId: "default:blind-up",
          winnerSoundId: "default:victory-chime",
          volume: 0.5,
        },
      });
    });

    it("rejects invalid volume (out of range) before write", async () => {
      vi.mocked(updateDoc).mockResolvedValue(undefined as never);

      await expect(
        updateAudioSettings("g1", {
          enabled: true,
          levelUpSoundId: "default:blind-up",
          winnerSoundId: "default:victory-chime",
          volume: 1.5,
        }),
      ).rejects.toMatchObject({ code: "validation/audio-settings-invalid" });
      expect(updateDoc).not.toHaveBeenCalled();
    });
  });
  ```
- **MIRROR**: REPOSITORY_TEST_MOCK_PATTERN（既存 groups.test.ts L34-46 の vi.mock 設定）
- **GOTCHA**: 既存 mock setup（vi.mock("firebase/firestore", ...)）はファイル先頭にあるためそのまま使える
- **VALIDATE**: `npm run test -- src/lib/firebase/repositories/groups.test.ts`

### Task 14: useAudioPlayer test 追加

- **ACTION**: `src/lib/hooks/useAudioPlayer.test.tsx` を新設
- **IMPLEMENT**（要点）:
  ```typescript
  import { renderHook, act } from "@testing-library/react";
  import { Timestamp } from "firebase/firestore";
  import { describe, it, expect, vi, beforeEach } from "vitest";

  // resolveAudioContext をモック
  vi.mock("@/lib/audio/audio-context", () => ({
    getOrCreateAudioContext: vi.fn(() => ({ state: "running" })),
    resumeAudioContext: vi.fn(async () => "running"),
  }));

  // HTMLMediaElement.play を polyfill
  beforeEach(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", {
      configurable: true,
      value: vi.fn(() => "probably"),
    });
  });

  import { useAudioPlayer } from "./useAudioPlayer";

  function makeGroup(overrides = {}) {
    return {
      id: "g1",
      name: "Test",
      ownerUids: ["u1"],
      organizerUids: ["u1"],
      memberUids: ["u1"],
      createdAt: Timestamp.fromMillis(0),
      memberDisplayNames: {},
      audioSettings: {
        enabled: true,
        levelUpSoundId: "default:blind-up",
        winnerSoundId: "default:victory-chime",
        volume: 0.5,
      },
      ...overrides,
    };
  }

  function makeTournament(overrides = {}) {
    return {
      /* ... timer.test.ts の makeTournament と同形 ... */
      ...overrides,
    };
  }

  describe("useAudioPlayer — role filter", () => {
    it("does not play for member role", async () => {
      const { result, rerender } = renderHook(
        ({ tournament }) =>
          useAudioPlayer({
            tournament,
            group: makeGroup(),
            players: [],
            role: "member",
          }),
        { initialProps: { tournament: makeTournament({ currentLevel: 1 }) } },
      );
      await act(async () => {
        await result.current.unlock();
      });
      rerender({ tournament: makeTournament({ currentLevel: 2 }) });
      // play が呼ばれていないこと
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    });

    it("plays for organizer on level change", async () => {
      const { result, rerender } = renderHook(
        ({ tournament }) =>
          useAudioPlayer({
            tournament,
            group: makeGroup(),
            players: [],
            role: "organizer",
          }),
        { initialProps: { tournament: makeTournament({ currentLevel: 1 }) } },
      );
      await act(async () => {
        await result.current.unlock();
      });
      // 初回 mount は鳴らない
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
      rerender({ tournament: makeTournament({ currentLevel: 2 }) });
      // 1 回鳴る
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    });

    it("does not play if audioSettings.enabled is false", async () => {
      const { result, rerender } = renderHook(
        ({ tournament }) =>
          useAudioPlayer({
            tournament,
            group: makeGroup({ audioSettings: { ...makeGroup().audioSettings, enabled: false } }),
            players: [],
            role: "owner",
          }),
        { initialProps: { tournament: makeTournament({ currentLevel: 1 }) } },
      );
      await act(async () => {
        await result.current.unlock();
      });
      rerender({ tournament: makeTournament({ currentLevel: 2 }) });
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    });
  });

  describe("useAudioPlayer — winner detection", () => {
    it("plays once on null → PlayerDoc transition", async () => {
      const tournament = makeTournament({ state: "running", currentLevel: 1 });
      const players = [
        { id: "p1", uid: "u1", displayName: "A", isBusted: false, /* ... */ },
        { id: "p2", uid: "u2", displayName: "B", isBusted: true, /* ... */ },
      ];
      // ... renderHook → unlock → players を winner 確定状態にして rerender
      // play が 1 回呼ばれることを assert
    });
  });
  ```
- **MIRROR**: TEST_STRUCTURE / `timer.test.ts` の factory pattern
- **GOTCHA**:
  - jsdom には HTMLMediaElement.play / canPlayType 実装がないため `Object.defineProperty` でスタブする
  - `renderHook` の rerender は `initialProps` と同形のオブジェクトを渡す。**`tournament` が新参照**になることが必要（同参照だと useEffect が走らない）
  - winner test は `players` 配列を **新参照** で渡す（同上）
- **VALIDATE**: `npm run test -- src/lib/hooks/useAudioPlayer.test.tsx`

### Task 15: PRD ステータス更新

- **ACTION**: PRD の Phase 4.9 を `pending → in-progress` に更新（plan 生成時に既に実施済み。実装完了時に `complete` へ）
- **IMPLEMENT**: 実装完了時に PRD の Phase 4.9 行の Status 列を `complete` に変更し、レポートリンクを追加
- **MIRROR**: Phase 4.7 / 4.8 完了時の PRD 更新パターン
- **VALIDATE**: PRD 目視確認

> **Note**: 当初 plan に含めていた「README に音源生成手順追記」は、運営者が音源を直接調達したため不要。Phase 4.9 では README への追記は **音源 license の出典記載**のみ運営者側で実施（必要なら）。

### Task 16: rules deploy（最終工程）

- **ACTION**: ローカル emulator で Task 4 の rule 変更を検証してから本番デプロイ
- **IMPLEMENT**:
  ```bash
  # ローカル
  npm run emulator
  # 別ターミナルで手動 / E2E で organizer / member / 非メンバーの 3 視点を試行

  # 本番
  firebase deploy --only firestore:rules
  ```
- **GOTCHA**: rule deploy は **schema migration ではない**ため即時反映。デプロイ前に Phase 4.9 の app コードが本番に出ていなくても問題ないが、**順序は app deploy → rule deploy** が無難（古い app が新 rule を満たせなくなるリスクがあるが、本 phase は organizer-only branch の追加のみで既存 path に影響なし）
- **VALIDATE**: 本番で organizer ユーザーから `/groups/{gid}/audio-settings` で保存 → success

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| `groupBodySchema.parse` legacy doc | audioSettings なしの旧 doc | `audioSettings === DEFAULT_AUDIO_SETTINGS` | ○（migration 互換） |
| `groupBodySchema.parse` 範囲外 volume | `volume: 1.5` | `ZodError` throw | ○ |
| `updateAudioSettings` 正常 | valid AudioSettings | `updateDoc` が `{ audioSettings: {...} }` で 1 回呼ばれる | - |
| `updateAudioSettings` 不正値 | `volume: -0.5` | `AppError(code="validation/audio-settings-invalid")` throw、updateDoc 呼ばれない | ○ |
| `useAudioPlayer` member role | role="member" + currentLevel 変化 | play 呼ばれない | ○ |
| `useAudioPlayer` organizer role | role="organizer" + unlock + currentLevel 1→2 | play 1 回呼ばれる | - |
| `useAudioPlayer` initial mount | role="organizer" + currentLevel=1 mount | play 呼ばれない（前回値 ref 初期化） | ○ |
| `useAudioPlayer` enabled=false | role="organizer" + audioSettings.enabled=false | play 呼ばれない | ○ |
| `useAudioPlayer` winner null→PlayerDoc | players が isBusted false 1 人になる | winner sound 1 回 play | - |
| `useAudioPlayer` winner 同 ID 連続 | 同 PlayerDoc に対し再 emit | play 追加で呼ばれない | ○ |
| `useAudioPlayer` unlock 前 | role=organizer + currentLevel 変化 + unlocked=false | play 呼ばれない | ○ |

### Edge Cases Checklist

- [x] 初回 mount で audio が即発火しない（前回値 ref で吸収）
- [x] 同 currentLevel が複数 snapshot で再 emit されても 1 回しか鳴らない
- [x] unlock 前は audio が鳴らない（ブラウザの autoplay 制約準拠）
- [x] member / anonymous では音が鳴らない
- [x] enabled=false で音が鳴らない
- [x] enabled=false のとき banner が表示されない
- [x] tournament.state === "setup" / "seating" / "finished" では levelUp が鳴らない
- [x] AudioContext 未対応ブラウザで crash しない（古い Safari の webkit fallback、それでも null 戻りなら no-op）
- [x] mp3 / ogg fallback が canPlayType で正しく解決される
- [x] tab backgrounded で AudioContext が interrupted になっても次の visibility 復帰で resume される（visibilitychange handler は既存 useTournamentTimer 内）
- [x] 自分が組織していない group の tournament を見たときに、自分の role が `null` のため音が鳴らない
- [x] race: auto-advance が同時刻に多端末から発火しても、Firestore は最初の 1 件のみ通る → currentLevel は 1 回だけ変わる → 音は 1 回だけ鳴る

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
```

EXPECT: Zero type errors

```bash
npm run lint
```

EXPECT: Zero errors / warnings

### Unit Tests（影響範囲）

```bash
npm run test -- src/lib/firebase/schemas src/lib/firebase/repositories/groups src/lib/hooks/useAudioPlayer src/lib/audio
```

EXPECT: 全テスト pass

### Full Test Suite

```bash
npm run test
```

EXPECT: 既存 296+ テストに加え、新規 12 件前後（schema 3 / repo 2 / hook 6+）が全て pass。No regressions.

### Build

```bash
npm run build
```

EXPECT: Build success（next build が public/sounds/* を static として bundle に含めることを確認）

### Default Sounds Verification

```bash
ls -la public/sounds/
```

EXPECT: 4 ファイル存在（`blind-up.{mp3,ogg}` / `victory-chime.{mp3,ogg}`、全て git tracked）

```bash
# dev サーバ起動後、ブラウザで以下を直接開いて再生確認
# Firefox: ogg / Safari: mp3 が選ばれていることをネットワークタブで確認可能
open http://localhost:3000/sounds/blind-up.mp3
open http://localhost:3000/sounds/blind-up.ogg
open http://localhost:3000/sounds/victory-chime.mp3
open http://localhost:3000/sounds/victory-chime.ogg
```

EXPECT: 4 ファイルすべて単独で再生可能

### Emulator Validation（rule 変更検証）

```bash
npm run emulator
# 別ターミナルで手動 or test スクリプトで以下を試行:
#   - organizer uid から audioSettings を update → success
#   - member uid から audioSettings を update → permission-denied
#   - organizer uid から { audioSettings, name: "X" } を同時 update → permission-denied
#   - 非メンバーから audioSettings を update → permission-denied
```

### Browser Validation

```bash
npm run dev
```

以下を手動で確認（ロール別に最低 2 端末/タブ用意）:

- [ ] organizer で `/tournaments/{tid}` を開く → SoundUnlockBanner 表示
- [ ] 「サウンドを有効化」ボタンクリック → unlocked になる
- [ ] レベル進行（手動 advance または auto-advance）→ デフォルト音が鳴る
- [ ] 残り 1 人になる（winner 確定）→ デフォルト音が鳴る
- [ ] organizer で `/tournaments/{tid}/live` 全画面表示 → 同様に音が鳴る
- [ ] member で `/tournaments/{tid}/live` 開く → banner 表示されない / 音が鳴らない
- [ ] anonymous で `/tournaments/{tid}/live` 開く → banner 表示されない / 音が鳴らない
- [ ] organizer で `/groups/{gid}/audio-settings` を開く → 試聴 / 音量変更 / on/off 切替 / 保存
- [ ] enabled=false で再度 `/tournaments/{tid}` 開く → banner 表示されない / 音が鳴らない
- [ ] member で `/groups/{gid}/audio-settings` を直アクセス → `/groups/{gid}` に redirect
- [ ] iOS Safari でも unlock → 音再生が動く（実機 or BrowserStack で検証）

### Manual Validation

- [ ] Phase 4.7 の確認手順 + Phase 4.8 の確認手順が引き続き green（regression check）
- [ ] `/groups/{gid}` ヘッダに「サウンド設定」ボタンが organizer 以上のみ表示
- [ ] `/groups/{gid}/audio-settings` の試聴ボタンが unlock 前後で正しく動作

---

## Acceptance Criteria

- [ ] 上記 16 タスク全完了
- [ ] `npm run typecheck` / `lint` / `test` / `build` が green
- [ ] デフォルト音源（mp3/ogg）が `public/sounds/` にコミットされている
- [ ] Firestore Rules に organizer-only audioSettings branch が追加され、emulator で検証 + 本番 deploy 済み
- [ ] PRD の Phase 4.9 status が `complete` に更新（実装完了報告時）
- [ ] 4 ロール × 2 ページ（dashboard / live）の音再生フィルタが期待通り
- [ ] iOS Safari / Chrome / Firefox で unlock が動作

## Completion Checklist

- [ ] Code follows discovered patterns（NAMING_CONVENTION / ERROR_HANDLING / LOGGING_PATTERN）
- [ ] All `try/catch` paths use `AppError.from(...)` + `logger.warn` + re-throw（[error-logging.md](../../rules/error-logging.md) 準拠）
- [ ] No `console.*` direct calls
- [ ] No hardcoded gid / uid / sound URLs in components（catalog 経由）
- [ ] zod schema additive（既存 group docs を破壊しない）
- [ ] Firestore Rules はローカル emulator で 4 ロール × 2 操作（read/write）の matrix 検証済み
- [ ] Phase 4.10 で拡張する箇所（catalog の `custom:` prefix / 設定 UI のプルダウン）に **TODO コメント無し**で延長可能な設計
- [ ] README にデフォルト音源生成手順記載
- [ ] PRD の Phase 4.9 status 更新

## Risks

| # | Risk | Likelihood | Impact | Mitigation |
| - | ---- | ---------- | ------ | ---------- |
| R1 | iOS Safari の AudioContext 挙動差異 | M | M | `webkitAudioContext` fallback + user gesture と同一 sync block で `resume()` 呼出。実機 1 回テスト |
| R2 | 初回 mount で音が誤発火（currentLevel=1 で爆音） | M | H | `prevLevelRef.current === null` early return で吸収。Task 14 のテストで cover |
| R3 | reconnect / auto-advance race で同 currentLevel が再 emit | L | M | `prev === lv` early return。既存 race guard（advanceInflightRef）と独立に有効 |
| R4 | rule の owner branch と organizer branch の競合 | L | H | owner branch は包括 update、organizer branch は単独フィールド更新と immutable 列挙の AND。OR 連結で互いに干渉しない設計 |
| R5 | 調達した音源のライセンスが MIT 配布と非互換（帰属表示必須なのに README 未記載 等） | M | M | Phase 5 投入前に運営者が出典・ライセンス確認 → 必要なら README に表記追加。実装作業者は確認外（運営者責務） |
| R6 | 既存 296+ テストが zod default 追加で壊れる | L | M | `default()` は parse 通過を緩める方向の変更。既存テストは parse 失敗ケースを直接書いていないため影響なし。Task 12 のテストで明示的に cover |
| R7 | `/live` ページで運営者ロールでも tournament の groupId が current group と異なるケースで role 判定が抜ける | M | M | `groups.find(g => g.id === tournament.groupId)` で確実に対応 group を取り、`deriveRole` で計算。`useCurrentGroup` の current group ではなく tournament の group を見る |
| R8 | <audio> element が複数同時 play で AbortError | L | L | 共通 ref の使い回しで `pause(); currentTime = 0;` リセット |
| R9 | Phase 4.10 で `custom:<id>` 形式に拡張する際の data drift | L | M | `resolveSound` の fallback を default に置く設計で、削除済み custom 音源 ID も無音にならず default で鳴る |

## Notes

- **Phase 4.10 への引継ぎポイント**:
  - `sound-catalog.ts` の `listAvailableSounds()` / `resolveSound()` を Firebase Storage URL 対応に拡張
  - audio-settings-client.tsx の Select options を `[...defaults, ...customs]` に拡張
  - `groups/{gid}/audioAssets` サブコレクション + Storage Rules を新設
  - 削除した custom 音源を `audioSettings.{levelUp,winner}SoundId` が参照しているとき、service 層でアトミックに `default:bell` にフォールバック
- **要件 Q1〜Q7 と実装の整合確認**:
  - Q1: 段階1 / 段階2 分割 → Phase 4.9 / 4.10
  - Q2: 運営側のみ音 → role-based filter（owner / organizer）
  - Q3: group 単位 → `groups/{gid}.audioSettings`
  - Q4 当初: 「1 種類 / mp3+ogg / フリー素材または自作」 → **更新**: 運営者調達済みの mp3 **2 種類**（[blind-up.mp3](public/sounds/blind-up.mp3) / [victory-chime.mp3](public/sounds/victory-chime.mp3)）+ ffmpeg 変換版 ogg 2 種類（[blind-up.ogg](public/sounds/blind-up.ogg) / [victory-chime.ogg](public/sounds/victory-chime.ogg)）。levelUp / winner で音を分けられるため UX が向上、両 codec 対応で全ブラウザを軽量配信
  - Q5: 1MB / 3 本 / mp3 or ogg / organizer 全員削除 → Phase 4.10 で適用
  - Q6: 明示 unlock ボタン → SoundUnlockBanner
  - Q7: Phase 5 前 / MVP Must → PRD 更新済み
- **音源ファイル**:
  - `public/sounds/blind-up.mp3`（62KB）— ブラインドアップ通知音 mp3
  - `public/sounds/blind-up.ogg`（25KB）— 同 ogg/vorbis（ffmpeg 変換）
  - `public/sounds/victory-chime.mp3`（23KB）— 優勝確定通知音 mp3
  - `public/sounds/victory-chime.ogg`（13KB）— 同 ogg/vorbis（ffmpeg 変換）
  - 配置済み（Phase 4.9 plan 生成時に運営者が mp3 を直接配置 → ffmpeg で ogg 変換）
  - **typo 修正履歴**: 当初 `blaind-up.mp3` で配置されていたものを plan 整合のため `blind-up.mp3` にリネーム済み
- **PR 単位**: 1 つの PR で全タスクをカバーできる規模。タスク 1-2（音源確認 + schema）→ タスク 3-4（repo / rule）→ タスク 5-9（hook + UI）→ タスク 10-11（組み込み）→ タスク 12-14（テスト）→ タスク 15-16（PRD/deploy）の順で commit を分けると review しやすい
