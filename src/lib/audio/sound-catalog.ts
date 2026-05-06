/**
 * Phase 4.9: 音源 ID と実 URL のマッピング。
 *   - "default:<key>" 形式: bundle 済み音源（public/sounds/）
 *   - Phase 4.10 で "custom:<assetId>" 形式が追加される（Firebase Storage URL）
 *
 * UI のプルダウンに表示する選択肢もここで定義する。
 */

interface SoundOption {
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

/** Phase 4.9 のデフォルト割り当て。schemas/group.ts の DEFAULT_AUDIO_SETTINGS と同期する。 */
export const DEFAULT_LEVEL_UP_SOUND_ID = "default:blind-up";
export const DEFAULT_WINNER_SOUND_ID = "default:victory-chime";

export function listAvailableSounds(): SoundOption[] {
  // Phase 4.10 で custom 音源も merge する。
  return DEFAULT_SOUNDS;
}

/**
 * 未知 ID は levelUp 側のデフォルトにフォールバック。
 * Phase 4.10 で削除済み custom 音源 ID 対応にも使う。
 */
export function resolveSound(soundId: string): SoundOption {
  const found = DEFAULT_SOUNDS.find((s) => s.id === soundId);
  if (found) return found;
  return DEFAULT_SOUNDS[0];
}
