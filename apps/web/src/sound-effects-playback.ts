export type SoundEffectEvent = { eventId: string; soundId: string; serverTime: string; defaultGain: number };
type AudioLike = Pick<HTMLAudioElement, "volume" | "onended" | "onerror" | "pause" | "play" | "src" | "currentTime">;
type Voice = { element: AudioLike; generation: number; soundGain: number };
const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

/** Independent local-effects bus. It never touches MusicBar or persistent audio transport. */
export class SoundEffectsPlayback {
  private voices: Voice[] = [];
  private seen = new Set<string>();
  private generation = 0;
  private connected = false;
  private playbackErrorReported = false;
  constructor(
    private readonly createAudio: () => AudioLike = () => new Audio(),
    maxVoices = 4,
    private readonly onPlaybackError?: () => void,
  ) { this.maxVoices = Math.max(1, Math.min(4, Math.floor(maxVoices))); }
  private readonly maxVoices: number;

  setConnected(_at?: number) { this.connected = true; }
  setDisconnected() { this.connected = false; this.stop(); }
  play(event: SoundEffectEvent, url: string, volume: number, muted: boolean): boolean {
    // Realtime events use volatile socket delivery and are never replayed after
    // reconnect. Do not compare server wall time to the client's clock: clock
    // skew must not suppress fresh effects.
    if (!this.connected || !url || this.seen.has(event.eventId)) return false;
    this.seen.add(event.eventId);
    if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value as string);
    if (muted) return false;
    while (this.voices.length >= this.maxVoices) this.dispose(this.voices[0]!);
    const generation = this.generation;
    const element = this.createAudio();
    element.src = url;
    element.currentTime = 0;
    const soundGain = clamp(event.defaultGain);
    element.volume = clamp(volume) * soundGain;
    const voice = { element, generation, soundGain };
    this.voices.push(voice);
    const remove = () => this.dispose(voice);
    element.onended = remove;
    element.onerror = remove;
    void element.play().then(() => {
      if (generation !== this.generation || !this.connected || !this.voices.includes(voice)) {
        element.pause();
        return;
      }
      this.playbackErrorReported = false;
    }).catch(() => {
      // A stop, mute, disconnect, eviction, or unmount can invalidate a
      // pending browser promise. Do not surface those stale rejections.
      if (generation !== this.generation || !this.connected || !this.voices.includes(voice)) return;
      remove();
      if (this.playbackErrorReported) return;
      this.playbackErrorReported = true;
      this.onPlaybackError?.();
    });
    return true;
  }

  setVolume(volume: number) {
    for (const voice of this.voices) voice.element.volume = clamp(volume) * voice.soundGain;
  }
  mute() { this.stop(); }
  stop() {
    this.generation++;
    this.playbackErrorReported = false;
    for (const voice of [...this.voices]) this.dispose(voice);
  }
  disposeAll() { this.stop(); this.seen.clear(); this.connected = false; }
  get activeVoiceCount() { return this.voices.length; }

  private dispose(voice: Voice) {
    const index = this.voices.indexOf(voice);
    if (index < 0) return;
    this.voices.splice(index, 1);
    voice.element.onended = null;
    voice.element.onerror = null;
    voice.element.pause();
    voice.element.src = "";
  }
}
