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
