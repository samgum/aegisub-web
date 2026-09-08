/** Common transport contract for native media and explicitly virtual dummy providers. */
export interface PlaybackClock extends EventTarget {
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  playbackRate: number;
  play(): Promise<void>;
  pause(): void;
}

interface Scheduler {
  now(): number;
  request(callback: FrameRequestCallback): number;
  cancel(id: number): void;
}

/** A bounded, seekable clock. Dummy media never allocates an encoded frame per timestamp. */
export class VirtualPlaybackClock extends EventTarget implements PlaybackClock {
  private position = 0;
  private epoch = 0;
  private rate = 1;
  private running = false;
  private raf = 0;
  private serial = 0;
  private disposed = false;
  seeking = false;
  constructor(readonly duration: number, private scheduler: Scheduler = {
    now: () => performance.now(), request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id),
  }) {
    super();
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("虚拟媒体时长必须大于零。");
  }
  get currentTime(): number {
    return Math.min(this.duration, this.position + (this.running ? (this.scheduler.now() - this.epoch) * this.rate / 1000 : 0));
  }
  set currentTime(seconds: number) {
    if (this.disposed || !Number.isFinite(seconds)) return;
    this.position = Math.max(0, Math.min(this.duration, seconds));
    this.epoch = this.scheduler.now();
    this.seeking = true;
    this.emit("seeking");
    const serial = ++this.serial;
    queueMicrotask(() => {
      if (serial !== this.serial || this.disposed) return;
      this.seeking = false;
      this.emit("seeked"); this.emit("timeupdate");
    });
  }
  get paused(): boolean { return !this.running; }
  get ended(): boolean { return this.currentTime >= this.duration; }
  get playbackRate(): number { return this.rate; }
  set playbackRate(rate: number) {
    if (!Number.isFinite(rate) || rate <= 0 || this.disposed) return;
    this.position = this.currentTime;
    this.epoch = this.scheduler.now();
    this.rate = rate;
    this.emit("ratechange");
  }
  async play(): Promise<void> {
    if (this.disposed || this.running) return;
    if (this.ended) this.position = 0;
    this.epoch = this.scheduler.now(); this.running = true;
    this.emit("play"); this.emit("playing");
    this.raf = this.scheduler.request(this.tick);
  }
  pause(): void {
    if (!this.running) return;
    this.position = this.currentTime; this.running = false;
    this.scheduler.cancel(this.raf); this.raf = 0;
    this.emit("pause"); this.emit("timeupdate");
  }
  private tick = (): void => {
    if (!this.running || this.disposed) return;
    if (this.ended) { this.pause(); this.emit("ended"); return; }
    this.emit("timeupdate");
    if (this.running) this.raf = this.scheduler.request(this.tick);
  };
  private emit(name: string): void { if (!this.disposed) this.dispatchEvent(new Event(name)); }
  dispose(): void {
    this.pause(); this.disposed = true; this.serial++;
    this.scheduler.cancel(this.raf); this.raf = 0;
  }
}
