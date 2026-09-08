import type SubtitlesOctopus from "@jellyfin/libass-wasm";

/** Firefox can crash if a WASM worker is terminated while its module is compiling.
 * A get-styles response is a runtime handshake (unlike Octopus.onReady, which fires
 * on the first log message). Close the UI immediately; retire the worker after that
 * handshake, with a bounded fallback for a failed/hung worker. */
function deferredRetirement(renderer: SubtitlesOctopus): () => Promise<void> {
  const worker = renderer.worker!;
  let initialized = false, retired = false, finished = false, timer = 0;
  let resolve!: () => void;
  const done = new Promise<void>(finish => { resolve = finish; });
  const finish = () => {
    if (finished) return;
    finished = true; clearTimeout(timer); worker.removeEventListener("message", ready);
    renderer.dispose(); resolve();
  };
  const ready = (event: MessageEvent) => {
    if (event.data?.target !== "get-styles") return;
    initialized = true;
    if (retired) { clearTimeout(timer); timer = window.setTimeout(finish, 0); }
  };
  worker.addEventListener("message", ready);
  worker.postMessage({ target: "get-styles" });
  return () => {
    if (!retired) { retired = true; timer = window.setTimeout(finish, initialized ? 0 : 30000); }
    return done;
  };
}

/** A single, explicitly clocked ASS renderer. It does not own or reload the video. */
export class CanvasAssRenderer {
  private renderer: SubtitlesOctopus | null = null;
  private retireCurrent: (() => Promise<void>) | null = null;
  private generation = 0;
  private disposed = false;
  private loading = false;
  private content = "";
  private time = 0;
  private lastSentTime = -1;
  private lastSentAt = -Infinity;
  constructor(readonly canvas: HTMLCanvasElement, private fonts: string[], private onError: (message: string) => void) {}

  setText(text: string): void {
    if (this.disposed) return;
    if (this.content !== text) {
      this.content = text;
      this.renderer?.setTrack(text);
    }
    if (!this.renderer && !this.loading) void this.start();
    this.renderAt(this.time, true);
  }
  setFonts(fonts: string[]): void {
    this.fonts = fonts;
    if (this.content) void this.start();
  }
  resize(width: number, height: number): void {
    width = Math.max(1, Math.round(width)); height = Math.max(1, Math.round(height));
    if (width === this.canvas.width && height === this.canvas.height) return;
    if (this.renderer) this.renderer.resize(width, height);
    else { this.canvas.width = width; this.canvas.height = height; }
    this.renderAt(this.time, true);
  }
  renderAt(time: number, force = false): void {
    this.time = Math.max(0, time);
    if (!this.renderer || this.disposed) return;
    const now = performance.now();
    if (!force && (this.time === this.lastSentTime || now - this.lastSentAt < 1000 / 60)) return;
    this.lastSentAt = now; this.lastSentTime = this.time;
    this.renderer.lastRenderTime = -1;
    this.renderer.setCurrentTime(this.time);
  }
  private async start(): Promise<void> {
    const generation = ++this.generation;
    void this.retireCurrent?.(); this.retireCurrent = null; this.renderer = null; this.loading = true;
    try {
      const { default: Octopus } = await import("@jellyfin/libass-wasm");
      if (this.disposed || generation !== this.generation) return;
      this.renderer = new Octopus({ canvas: this.canvas, subContent: this.content, fonts: this.fonts,
        workerUrl: new URL("octopus/subtitles-octopus-worker.js", document.baseURI).toString(),
        fallbackFont: new URL("octopus/default.woff2", document.baseURI).toString(), targetFps: 60,
        onReady: () => { if (generation === this.generation) { this.renderer?.setIsPaused(true, this.time); this.renderAt(this.time, true); } },
        onError: error => { if (!this.disposed && generation === this.generation) this.onError(String(error)); },
      });
      this.retireCurrent = deferredRetirement(this.renderer);
      this.renderer.setIsPaused(true, this.time);
      this.renderAt(this.time, true);
    } catch (error) { if (!this.disposed && generation === this.generation) this.onError(String(error)); }
    finally { if (generation === this.generation) this.loading = false; }
  }
  async dispose(): Promise<void> {
    this.disposed = true; this.generation++; this.renderer = null;
    await this.retireCurrent?.(); this.retireCurrent = null;
    this.canvas.width = 0; this.canvas.height = 0;
  }
}
