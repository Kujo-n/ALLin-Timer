"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import {
  readAudioContextState,
  resumeAudioContext,
  subscribeAudioContextState,
} from "@/lib/audio/audio-context";
import { resolveSound } from "@/lib/audio/sound-catalog";
import { AppError } from "@/lib/errors";
import { isOrganizerRole, type GroupDoc } from "@/lib/firebase/schemas/group";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { useImplicitAudioUnlock } from "@/lib/hooks/useImplicitAudioUnlock";
import { logger } from "@/lib/logger";
import { resolveWinner, shouldPlayLevelEndSound } from "@/lib/services/timer";
import { isFinished } from "@/lib/services/tournament-state";

export type AudioRole = "owner" | "organizer" | "member" | null;

interface UseAudioPlayerArgs {
  /** 現在 view している tournament（null 可：tournament ロード前 / 設定ページから呼ぶ場合） */
  tournament: TournamentDoc | null;
  /** 現在 view している tournament の group（null 可：group 未確定） */
  group: GroupDoc | null;
  /** 現在 view している tournament の players（winner 判定用） */
  players: readonly PlayerDoc[];
  /** view している user の current role */
  role: AudioRole;
  /**
   * 現在レベルのローカル残り時間（ms）。useTournamentTimer から渡す。
   * 要望④: ブラインドアップ音を Firestore 往復を待たず、ローカルで残り 0 を検知した
   * 瞬間に鳴らすトリガに使う。null は pending-write / levelStartedAt 未確定（無音）。
   */
  remainingMs: number | null;
  /**
   * 再生失敗時に親へ通知する callback。設定変更ページ / dashboard / live で UI に
   * エラーメッセージを出すために使う。logger.warn でも記録するため省略可。
   */
  onError?: (message: string) => void;
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
 * ローカルの残り 0 検知（要望④）と resolveWinner の null → PlayerDoc 遷移を
 * 観測し、運営者ロール（owner / organizer）かつ group.audioSettings.enabled の場合
 * のみ音を鳴らす。levelStartedAt / winnerId をキーにした ref + early return で
 * 重複再生を抑止する。
 */
export function useAudioPlayer({
  tournament,
  group,
  players,
  role,
  remainingMs,
  onError,
}: UseAudioPlayerArgs): UseAudioPlayerState {
  // onError は呼出毎に identity が変わる可能性があるため ref に逃がす。
  // playInternal の deps に入れずに、参照は最新の値を使う。
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  // Phase 5.1: 任意の pointerdown で AudioContext を 1 回 resume する
  // （明示「サウンドを有効化」ボタンを押さない参加者でも音が鳴る経路を確保）。
  useImplicitAudioUnlock();

  // AudioContext は 1 タブ singleton なので、複数の useAudioPlayer 呼び出し
  // （dashboard / live / 設定タブの AudioSettingsCard）で unlock 状態を共有する必要がある。
  // useSyncExternalStore で global な statechange イベントを購読し、どこで unlock しても
  // すべての mount 中 hook が即時に再レンダリングされる。
  // server snapshot は null（SSR では AudioContext を触らない）。
  const ctxState = useSyncExternalStore(
    subscribeAudioContextState,
    readAudioContextState,
    () => null,
  );
  // unlocked の判定:
  //   - ctxState === "running": ユーザー操作で unlock 済み
  //   - ctxState === null: AudioContext 未生成 = unlock してない（false）
  //                         ※ AudioContext 未対応環境でも unlock() 内で
  //                         resumeAudioContext() の戻り値 null を見て play 経路を許可するため、
  //                         hook 自体は unlocked=false のままで問題なし。
  const unlocked = ctxState === "running";

  // levelStartedAt をキーに「このレベルの終了音は鳴らし済み」を記録し二重再生を抑止する。
  const playedLevelEndKeyRef = useRef<number | null>(null);
  const prevWinnerIdRef = useRef<string | null>(null);

  // 共有 <audio> インスタンス（unmount 時に破棄）。
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const isOrganizer = isOrganizerRole(role);
  const enabled = group?.audioSettings.enabled ?? false;
  const volume = group?.audioSettings.volume ?? 0.7;

  // 実再生の共通処理。gate（role / enabled / unlocked）は呼び出し側で判定する。
  // preview は unlock 直後の sync block を維持するため unlocked state を経由せず呼ぶ
  // 必要があり、play は逆に unlocked を gate に含める必要があるため引数で切り替える。
  //
  // 旧実装は audioElRef を再利用していたが、`pause() → src=` → play() の遷移途中で
  // 直前の play() Promise が AbortError で reject すると次の play() まで element 状態が
  // 不整合のままになるケースがあった。毎回 fresh Audio() を生成することで状態汚染を回避し、
  // unmount cleanup 用に audioElRef は「最後に再生した element」のみ保持する。
  const playInternal = useCallback(
    async (soundId: string) => {
      if (typeof window === "undefined") return;
      const sound = resolveSound(soundId);
      // canPlayType を probe するための一時 element。fresh Audio() で十分。
      const probe = new Audio();
      const supported = sound.sources.find(
        (s) => probe.canPlayType(s.type) !== "",
      );
      if (!supported) {
        const message =
          "音声再生に失敗しました（対応する音声フォーマットが見つかりません）";
        logger.warn(message, { code: "audio/no-supported-source", soundId });
        onErrorRef.current?.(message);
        return;
      }
      const audio = new Audio(supported.src);
      audio.volume = Math.max(0, Math.min(1, volume));
      // 直前の再生が走っていれば中断しておく（同時複数再生で耳障りなのを防ぐ）。
      audioElRef.current?.pause();
      audioElRef.current = audio;
      try {
        await audio.play();
      } catch (e) {
        const wrapped = AppError.from(e, "audio/play-failed", "音声再生に失敗しました");
        logger.warn(wrapped.message, { code: wrapped.code, soundId });
        onErrorRef.current?.(wrapped.message);
      }
    },
    [volume],
  );

  // 通常の play。levelUp / winner 検知の effect から呼ぶ。前提: unlocked === true.
  const play = useCallback(
    async (soundId: string) => {
      if (!isOrganizer || !enabled || !unlocked) return;
      await playInternal(soundId);
    },
    [isOrganizer, enabled, unlocked, playInternal],
  );

  const unlock = useCallback(async () => {
    // resumeAudioContext は内部で statechange を notify する（audio-context.ts 参照）。
    // useSyncExternalStore 経由で全 useAudioPlayer 呼び出し先が即座に再レンダリングされる。
    await resumeAudioContext();
  }, []);

  const preview = useCallback(
    async (soundId: string) => {
      if (!unlocked) {
        await unlock();
      }
      // unlock 直後は React state が次レンダまで反映されないため、play() の unlocked gate
      // は通らない。preview 専用 fast-path として playInternal を直接呼ぶ。
      if (!isOrganizer || !enabled) return;
      await playInternal(soundId);
    },
    [unlock, unlocked, isOrganizer, enabled, playInternal],
  );

  // 要望④: レベル終了（ローカル残り0）の瞬間にブラインドアップ音を鳴らす。
  // currentLevel 変化（Firestore 往復後）を待たないため遅延ゼロ。
  // levelStartedAt をキーに二重再生を抑止（残り0が複数 tick 続いても 1 回）。
  // 手動遷移は残り0を経由しないため自然に無音、seating→running は残り full のため無音、
  // finished / 最終レベルは shouldPlayLevelEndSound 側で除外。
  useEffect(() => {
    if (!tournament) return;
    if (!shouldPlayLevelEndSound(tournament, remainingMs)) return;
    const key = tournament.levelStartedAt?.toMillis() ?? null;
    if (key === null) return;
    if (playedLevelEndKeyRef.current === key) return;
    // play が gate（role / enabled / unlocked）で no-op でも key を消費する。
    // 旧実装の prevLevelRef 更新と同じ挙動（unlock 遅れ時の取りこぼしは許容）。
    playedLevelEndKeyRef.current = key;
    void play(group?.audioSettings.levelUpSoundId ?? "default:blind-up");
  }, [tournament, remainingMs, group?.audioSettings.levelUpSoundId, play]);

  // winner 検知: null → PlayerDoc 遷移。同 winner の再 emit / 取消し→再確定の両方に対応。
  // 要望③: finished トーナメントの運営ページを開いた瞬間、resolveWinner が winner を返し
  // null → winner 遷移とみなして優勝音が誤発火するバグを防ぐ。finished のときは
  // prevWinnerIdRef を更新する（再発火防止）が play() しない。進行中（running/paused）の
  // 正常な優勝音は維持する。
  useEffect(() => {
    if (!tournament) return;
    const w = resolveWinner(tournament, players);
    const wid = w?.id ?? null;
    const prev = prevWinnerIdRef.current;
    prevWinnerIdRef.current = wid;
    if (isFinished(tournament)) return;
    if (prev === null && wid !== null) {
      void play(group?.audioSettings.winnerSoundId ?? "default:victory-chime");
    }
  }, [tournament, players, group?.audioSettings.winnerSoundId, play]);

  // Phase 4.14: 再生中に enabled が false に切替わった瞬間、再生中の <audio> 要素を pause する。
  // gate（line 115 の play()）は新規再生をブロックするだけで、既に走っている再生は止めない。
  // これがないと「OFF をクリック → アイコンは ☓ に変わるが、直前のレベルアップ音が最後まで鳴り続ける」
  // という UI / 音 の不整合が起きる（ユーザー報告）。
  useEffect(() => {
    if (!enabled && audioElRef.current) {
      audioElRef.current.pause();
    }
  }, [enabled]);

  // unmount 時に audio を破棄
  useEffect(() => {
    return () => {
      audioElRef.current?.pause();
      audioElRef.current = null;
    };
  }, []);

  return { unlocked, unlock, preview };
}
