import { MAX_LEVELS_PER_TOURNAMENT } from "@/lib/limits";

import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";

/**
 * Tournament state-machine の許可判定を集約する純関数群。
 *
 * Phase 4 architect-refactor (P4) で `dashboard-client.tsx` / `TimerControls.tsx` /
 * `repositories/tournaments.ts` に分散していた `tournament.state` 条件式の単一
 * 真実源として導入する。
 *
 * 本ファイルの関数は以下の方針で並べる:
 *   - state 述語 (isSetup / isSeating / ...): UI の hook 順制御や条件分岐の
 *     primitive として再利用する
 *   - 操作許可関数 (canX): 各 UI ボタンの visibility / disabled の表現と
 *     repository 内の guard を同一定義に揃える
 *   - 表示判定 (showX): dashboard 上のカード / バナーの visibility 判定
 *
 * 副作用なし。引数を mutate しない。membership / role の判定は呼び出し側で別途
 * 行う（本ファイルは state のみを扱う）。
 */
export function isSetup(t: TournamentDoc): boolean {
  return t.state === "setup";
}

export function isSeating(t: TournamentDoc): boolean {
  return t.state === "seating";
}

export function isRunning(t: TournamentDoc): boolean {
  return t.state === "running";
}

export function isPaused(t: TournamentDoc): boolean {
  return t.state === "paused";
}

export function isFinished(t: TournamentDoc): boolean {
  return t.state === "finished";
}

/** running または paused（タイマー駆動中）。 */
export function isInProgress(t: TournamentDoc): boolean {
  return isRunning(t) || isPaused(t);
}

/**
 * setup または seating（トーナメント開始前）。
 *
 * Phase 4 architect-refactor 後の Phase 5.x で TimerDisplay / NextBreakCard /
 * AverageStackCard の 3 component で `state === "setup" || state === "seating"` の
 * 直接比較が散在したため、再集約のために導入。
 */
export function isBeforeStart(t: TournamentDoc): boolean {
  return isSetup(t) || isSeating(t);
}

/**
 * トーナメント編集が可能か（dashboard の「編集」ボタン visibility）。
 * 開始前の setup 中のみ。membership は呼出側で別途判定する。
 */
export function canEdit(t: TournamentDoc): boolean {
  return isSetup(t);
}

/**
 * トーナメント削除が可能か。setup（開始前）または finished（終了済み）のみ。
 * `repositories/tournaments.ts:deleteTournament` の guard と一致させる。
 */
export function canDelete(t: TournamentDoc): boolean {
  return isSetup(t) || isFinished(t);
}

/** setup → seating 遷移（`beginSeating`）が可能か。 */
export function canBeginSeating(t: TournamentDoc): boolean {
  return isSetup(t);
}

/** seating → running 遷移（`confirmSeating`）が可能か。 */
export function canConfirmSeating(t: TournamentDoc): boolean {
  return isSeating(t);
}

/**
 * 初回席決め (`commitInitialSeating`) が可能か。
 * `seating/orchestrator.ts` の guard と一致 — setup（初回）または seating（再配席）。
 */
export function canCommitInitialSeating(t: TournamentDoc): boolean {
  return isSetup(t) || isSeating(t);
}

/** running → paused 遷移（`pauseTournament`）が可能か。 */
export function canPause(t: TournamentDoc): boolean {
  return isRunning(t);
}

/** paused → running 遷移（`resumeTournament`）が可能か。 */
export function canResume(t: TournamentDoc): boolean {
  return isPaused(t);
}

/**
 * 「次レベル」操作（`advanceLevel`）が可能か。最終レベル超過を防ぐ。
 * UI 側の visibility は `isInProgress(t) && canAdvanceLevel(t)` の合成で判定する。
 */
export function canAdvanceLevel(t: TournamentDoc): boolean {
  return t.currentLevel < t.structureSnapshot.levels.length;
}

/**
 * 「前レベル」操作（`revertLevel`）が可能か。currentLevel が 1 以下なら不可。
 */
export function canRevertLevel(t: TournamentDoc): boolean {
  return t.currentLevel > 1;
}

/**
 * 「終了」操作（`finishTournament`）の UI button visibility。
 * TimerControls は running / paused の branch でのみ「終了」ボタンを描画する。
 * `finishTournament` 自身は finished への二重呼出に対して idempotent (no-op) なので、
 * UI 表示判定とは別に repository は `isFinished(t)` で early return する。
 */
export function canFinish(t: TournamentDoc): boolean {
  return isInProgress(t);
}

/**
 * dashboard 上で SeatingBoard カードを表示するか。
 * 席が確定している seating / running / paused の 3 state で表示。
 */
export function showSeatingBoard(t: TournamentDoc): boolean {
  return isSeating(t) || isInProgress(t);
}

/**
 * Phase 5.1: 自動配席の許可判定（座席確定後 (seating) 中・running・paused で受け入れる）。
 *
 * 座席確定後 (state="seating") のレイトエントリーが、運営者がトーナメント開始
 * (state="running") に遷移するまで配席されないドライラン #1 issue を解消する。
 * setup（席決め前）と finished では false を返す。
 *
 * lateEntryDeadlineLevel との突合は呼出側で行う（state=seating は currentLevel===0 で
 * deadline チェックは常に false なので問題ないが、running/paused では deadline と
 * 突合する必要がある）。
 */
export function isAcceptingLateSeats(t: TournamentDoc): boolean {
  return isSeating(t) || isInProgress(t);
}

/**
 * Phase 5.2: 指定レベルの durationSec を運営者が編集できるか。
 *  - state === "setup": 全レベル編集可（structureSnapshot 全体の編集経路 /edit が別途
 *    あるが、こちらでも認める）
 *  - state === "seating" / "running" / "paused": currentLevel 以降のみ編集可
 *    （過去レベルは混乱回避で弾く）
 *  - state === "finished": 編集不可（履歴を改竄しない）
 *  - levelIndex は 0-based。currentLevel は 1-based のため `levelIndex >= currentLevel - 1`
 *    で「現在以降」を判定する（seating 中は currentLevel === 0 なので全レベル編集可）。
 *
 * 範囲外 levelIndex は false を返す（防衛的）。
 */
export function canEditLevelDurations(t: TournamentDoc, levelIndex: number): boolean {
  if (!Number.isInteger(levelIndex)) return false;
  if (levelIndex < 0 || levelIndex >= t.structureSnapshot.levels.length) return false;
  if (isFinished(t)) return false;
  if (isSetup(t)) return true;
  return levelIndex >= t.currentLevel - 1;
}

/**
 * Phase 5.3: 末尾レベル append が可能か。
 *  - state === "finished": false（履歴を改竄しない）
 *  - state === "setup" / "seating" / "running" / "paused":
 *    levels.length < MAX_LEVELS_PER_TOURNAMENT
 *
 * MAX_LEVELS_PER_TOURNAMENT を超える append は repository / UI 双方で deny。
 */
export function canAppendLevel(t: TournamentDoc): boolean {
  if (isFinished(t)) return false;
  return t.structureSnapshot.levels.length < MAX_LEVELS_PER_TOURNAMENT;
}

/**
 * Phase 5.4: 「同じ参加者で次のトーナメントを作成」操作の許可判定。
 *  - state === "finished" のみ true。
 *  - membership / role の判定は呼出側（dashboard 側で `isOrganizer` と AND する）。
 */
export function canClone(t: TournamentDoc): boolean {
  return isFinished(t);
}

/**
 * Phase 1 (07-third-dryrun-improvements): 運営者による代理受付（proxy receipt）が
 * 可能な state かを判定する。
 *  - setup / seating / running / paused（= !finished）で true、finished で false。
 *  - 可読性のため 4 述語の OR で明示する（実質 `!isFinished(t)` と等価）。
 *
 * ⚠ DRIFT WARNING: 本述語の許可 state 集合は `firestore.rules` の以下 2 箇所の
 *   `["setup", "seating", "running", "paused"]` リテラルと**手動同期**すること
 *   （Cloud Firestore Rules に const 機構がないためハードコード）:
 *   - `match /players/{pid}` `allow create` の member-proxy / name-only ブランチ
 *   - `hasTournamentEntryProof(gid, tid)`（08-auto-group-join-on-entry Phase 1 追加。
 *     トーナメント受付を消費証明とした `groups/{gid}` self-add で使う）
 *   state を増減する場合は上記すべてと本述語を同時更新する。
 *
 * membership / role の判定は呼出側（service の `assertOrganizer`）で別途行う。
 * late entry deadline 超過の扱いは service 側（entry-guards の `assertAcceptingEntries`）。
 */
export function isAcceptingProxyEntry(t: TournamentDoc): boolean {
  return isSetup(t) || isSeating(t) || isInProgress(t);
}
