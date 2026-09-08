type GainRoute = { source: MediaElementAudioSourceNode; gain: GainNode; meter: AnalyserNode; sync(): void };

/** A single native decoder remains the source. Web Audio is connected lazily only when
 * non-unity gain is requested, so normal 4K playback retains the native AV fast path. */
export class MediaGain {
  private context: AudioContext | null = null;
  private active = new Map<HTMLMediaElement, GainRoute>();
  private routes = new WeakMap<HTMLMediaElement, GainRoute>();
  private gain = 1;
  private idleTimer = 0;
  private resuming: Promise<void> | null = null;
  private suspending: Promise<void> | null = null;
  private allPaused(): boolean { return [...this.active.keys()].every(media => media.paused); }

  private wake(): void {
    window.clearTimeout(this.idleTimer); this.idleTimer = 0;
    const context = this.context;
    if (!context || context.state === "closed" || this.resuming) return;
    if (!this.suspending && context.state === "running") return;
    // Do not enqueue opposing suspend/resume transitions during rapid range switches.
    // The first resume still runs synchronously in the user's playback gesture.
    const resumed = this.suspending ? this.suspending.then(() => context.state !== "closed" ? context.resume() : undefined) : context.resume();
    const pending = resumed.catch(() => undefined).finally(() => {
      if (this.resuming !== pending) return;
      this.resuming = null;
      if (this.context === context && this.allPaused()) this.pauseIfIdle();
    });
    this.resuming = pending;
  }
  setGain(gain: number): void {
    this.gain = Math.max(0, Math.min(8, gain));
    for (const route of this.active.values()) route.sync();
    if (this.active.size) this.wake();
  }
  prepare(media: HTMLMediaElement): void {
    if (this.gain === 1 && !this.routes.has(media)) return;
    const Context = globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) { media.volume = Math.min(1, this.gain); if (this.gain > 1) throw new Error("此浏览器没有 Web Audio，不能将音量放大到 100% 以上。"); return; }
    this.context ??= new Context();
    let route = this.routes.get(media);
    if (!route) {
      const gain = this.context.createGain();
      route = { source: this.context.createMediaElementSource(media), gain, meter: this.context.createAnalyser(), sync: () => { gain.gain.value = media.muted ? 0 : this.gain; } };
      route.meter.fftSize = 2048; this.routes.set(media, route);
    }
    if (!this.active.has(media)) { route.source.connect(route.gain); route.gain.connect(route.meter); route.meter.connect(this.context.destination); media.addEventListener("volumechange", route.sync); this.active.set(media, route); }
    route.sync(); media.volume = 1;
    this.wake();
  }
  release(media: HTMLMediaElement): void {
    const route = this.active.get(media); if (!route) return;
    route.source.disconnect(); route.gain.disconnect(); route.meter.disconnect(); media.removeEventListener("volumechange", route.sync); this.active.delete(media); this.pauseIfIdle();
  }
  pauseIfIdle(): void {
    window.clearTimeout(this.idleTimer); this.idleTimer = 0;
    if (!this.context || !this.allPaused()) return;
    // HTMLMediaElement.pause stops sound immediately. Suspend the output context only
    // after a quiet interval, not in the middle of a stop/seek/play command sequence.
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = 0; const context = this.context;
      if (!context || context.state !== "running" || !this.allPaused()) return;
      if (this.resuming) { this.pauseIfIdle(); return; }
      const pending = context.suspend().catch(() => undefined).finally(() => { if (this.suspending === pending) this.suspending = null; });
      this.suspending = pending;
    }, 300);
  }
  level(media: HTMLMediaElement): number {
    const route = this.active.get(media); if (!route) return 0;
    const samples = new Float32Array(route.meter.fftSize); route.meter.getFloatTimeDomainData(samples);
    return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
  }
  dispose(): void {
    for (const media of this.active.keys()) this.release(media);
    window.clearTimeout(this.idleTimer); this.idleTimer = 0;
    void this.context?.close().catch(() => undefined); this.context = null; this.resuming = null; this.suspending = null;
  }
}
