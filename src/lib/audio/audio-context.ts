/**
 * Phase 4.9: ブラウザ autoplay policy 対策の薄い wrapper。
 *   - SSR で AudioContext を触らない（build error 回避）
 *   - 1 タブ内で 1 つの AudioContext を使い回す（vendor 制限）
 *   - resume は user gesture と同 event loop で sync 実行できる callable を返す
 *   - state 変化を listener に通知（複数コンポーネントが同期的に再レンダリングできる）
 */

import { logger } from "@/lib/logger";

type AudioContextStateListener = (state: AudioContextState | null) => void;
const listeners = new Set<AudioContextStateListener>();

let cachedContext: AudioContext | null = null;

function notify(state: AudioContextState | null): void {
  listeners.forEach((cb) => {
    try {
      cb(state);
    } catch (e) {
      // listener 例外は他の listener に波及させないが、
      // useSyncExternalStore snapshot 不整合などを発見できるよう warn は残す。
      logger.warn("audio listener error", {
        state,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
}

export function getOrCreateAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (cachedContext) return cachedContext;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  const ctx = new Ctor();
  cachedContext = ctx;
  // statechange を購読して全 listener に転送する。
  ctx.addEventListener("statechange", () => notify(ctx.state));
  return ctx;
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
  // statechange イベントが何らかの理由で発火しないブラウザでも
  // 確実に listener に通知するため明示的に notify する。
  notify(ctx.state);
  return ctx.state;
}

/**
 * AudioContext.state（および「未生成」を示す null）の変化を購読する。
 * unmount 時に呼ぶ unsubscribe 関数を返す。
 *
 * 1 タブ内に AudioContext singleton があるため、複数コンポーネント（例: dashboard と /live）
 * の useAudioPlayer 同士で unlock 状態を同期するために使う。
 */
export function subscribeAudioContextState(cb: AudioContextStateListener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** 現時点の AudioContext.state を取得（未生成なら null）。useSyncExternalStore の getSnapshot 用。 */
export function readAudioContextState(): AudioContextState | null {
  if (typeof window === "undefined") return null;
  return cachedContext?.state ?? null;
}
