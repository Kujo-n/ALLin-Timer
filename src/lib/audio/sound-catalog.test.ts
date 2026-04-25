import { describe, expect, it } from "vitest";

import {
  DEFAULT_LEVEL_UP_SOUND_ID,
  DEFAULT_WINNER_SOUND_ID,
  listAvailableSounds,
  resolveSound,
} from "./sound-catalog";

describe("listAvailableSounds", () => {
  it("returns the 2 default sounds", () => {
    const sounds = listAvailableSounds();
    expect(sounds).toHaveLength(2);
    expect(sounds.map((s) => s.id)).toEqual([
      DEFAULT_LEVEL_UP_SOUND_ID,
      DEFAULT_WINNER_SOUND_ID,
    ]);
  });

  it("each sound has both ogg and mp3 sources, with ogg first", () => {
    const sounds = listAvailableSounds();
    for (const s of sounds) {
      expect(s.sources).toHaveLength(2);
      expect(s.sources[0].type).toBe("audio/ogg");
      expect(s.sources[1].type).toBe("audio/mpeg");
      expect(s.sources[0].src).toMatch(/^\/sounds\//);
      expect(s.sources[1].src).toMatch(/^\/sounds\//);
    }
  });

  it("each sound has a non-empty Japanese label", () => {
    const sounds = listAvailableSounds();
    for (const s of sounds) {
      expect(s.label.length).toBeGreaterThan(0);
    }
  });
});

describe("resolveSound", () => {
  it("returns blind-up sound for default:blind-up id", () => {
    const sound = resolveSound("default:blind-up");
    expect(sound.id).toBe("default:blind-up");
    expect(sound.sources[0].src).toContain("blind-up");
  });

  it("returns victory-chime sound for default:victory-chime id", () => {
    const sound = resolveSound("default:victory-chime");
    expect(sound.id).toBe("default:victory-chime");
    expect(sound.sources[0].src).toContain("victory-chime");
  });

  it("falls back to the first default sound for unknown id", () => {
    const sound = resolveSound("custom:nonexistent");
    expect(sound.id).toBe(DEFAULT_LEVEL_UP_SOUND_ID);
  });

  it("falls back for empty string id", () => {
    const sound = resolveSound("");
    expect(sound.id).toBe(DEFAULT_LEVEL_UP_SOUND_ID);
  });
});
