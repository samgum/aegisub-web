import type SubtitlesOctopus from "@jellyfin/libass-wasm";

/** A single, explicitly clocked ASS renderer. It does not own or reload the video. */
export class CanvasAssRenderer {
  private renderer: SubtitlesOctopus | null = null;
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
    this.renderer?.dispose(); this.renderer = null; this.loading = true;
    try {
      const { default: Octopus } = await import("@jellyfin/libass-wasm");
      if (this.disposed || generation !== this.generation) return;
      this.renderer = new Octopus({ canvas: this.canvas, subContent: this.content, fonts: this.fonts,
        workerUrl: new URL("octopus/subtitles-octopus-worker.js", document.baseURI).toString(),
        fallbackFont: new URL("octopus/default.woff2", document.baseURI).toString(), targetFps: 60,
        onReady: () => { if (generation === this.generation) { this.renderer?.setIsPaused(true, this.time); this.renderAt(this.time, true); } },
        onError: error => { if (!this.disposed && generation === this.generation) this.onError(String(error)); },
      });
      this.renderer.setIsPaused(true, this.time);
      this.renderAt(this.time, true);
    } catch (error) { if (!this.disposed && generation === this.generation) this.onError(String(error)); }
    finally { if (generation === this.generation) this.loading = false; }
  }
  dispose(): void { this.disposed = true; this.generation++; this.renderer?.dispose(); this.renderer = null; this.canvas.width = 0; this.canvas.height = 0; }
}
