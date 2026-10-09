import { describe, expect, it, vi } from "vitest";
import { SoundEffectsPlayback, type SoundEffectEvent } from "./sound-effects-playback.js";

function fakeAudio() {
  const audio = { src: "", currentTime: 0, volume: 1, onended: null as (() => void) | null, onerror: null as (() => void) | null, pause: vi.fn(), play: vi.fn().mockResolvedValue(undefined) };
  return audio;
}
const event = (id: string, time = Date.now()): SoundEffectEvent => ({ eventId: id, soundId: id, serverTime: new Date(time).toISOString(), defaultGain: 0.5 });

describe("SoundEffectsPlayback", () => {
  it("ignores pre-connect and duplicate history, tolerates clock skew, bounds voices and evicts oldest", () => {
    const audios = Array.from({ length: 6 }, fakeAudio);
    let next = 0;
    const bus = new SoundEffectsPlayback(() => audios[next++]!);
    expect(bus.play(event("before"), "/a", 1, false)).toBe(false);
    const connectedAt = Date.now();
    bus.setConnected(connectedAt);
    for (let i = 0; i < 5; i++) expect(bus.play(event(`e${i}`, connectedAt), "/a", 0.8, false)).toBe(true);
    expect(bus.activeVoiceCount).toBe(4);
    expect(audios[0]!.pause).toHaveBeenCalledOnce();
    expect(bus.play(event("e4", connectedAt), "/a", 1, false)).toBe(false);
    bus.setConnected(connectedAt + 10);
    expect(bus.play(event("clock-skewed-current", connectedAt - 5000), "/a", 1, false)).toBe(true);
    expect(bus.play(event("muted-event", connectedAt), "/a", 1, true)).toBe(false);
    expect(bus.play(event("muted-event", connectedAt), "/a", 1, false)).toBe(false);
  });

  it("keeps effects gain independent, mute clears active voices and stop cancels late play", async () => {
    const audio = fakeAudio();
    let resolvePlay!: () => void;
    audio.play.mockImplementation(() => new Promise<void>((resolve) => { resolvePlay = resolve; }));
    const bus = new SoundEffectsPlayback(() => audio);
    const connectedAt = Date.now();
    bus.setConnected(connectedAt);
    bus.play(event("pending", connectedAt), "/effect.ogg", 0.4, false);
    expect(audio.volume).toBeCloseTo(0.2);
    bus.mute();
    resolvePlay();
    await Promise.resolve();
    expect(audio.pause).toHaveBeenCalled();
    expect(bus.activeVoiceCount).toBe(0);
    expect(bus.play(event("muted", connectedAt), "/effect.ogg", 1, true)).toBe(false);
  });
});
