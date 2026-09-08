// Audio display: waveform/spectrum, timing markers, ruler, scrollbar and playhead.
// Like desktop Aegisub, a primary-button gesture in
// the audio area sets/drags the active line's start marker and a secondary-button gesture
// sets/drags its end marker. The ruler pans; middle-button seeks video. Wheel pans by
// default and Ctrl/Command inverts it to zoom. Shift inverts marker snapping.

import type { Cue } from "./cue";
import { AudioTimingGesture } from "./audio-timing-gesture";
import { audioFlag, audioNumber, audioTimingCues, audioZoomFactor } from "./audio-options";
import { spectrumPalette, spectrumRows, spectrumRowValue, spectrumViewKey, type SpectrumData, type SpectrumViewport } from "./spectrum-core";
import { waveformViewKey, type WaveformValues, type WaveformPixels, type WaveformViewport } from "./waveform-data";

export interface TimelineCallbacks {
  getCues: () => Cue[];
  getDuration: () => number; // media duration (s); 0 if unknown
  getCurrentTime: () => number; // s
  getSnapTargetsMs?: () => readonly number[];
  getVideoPositionMs?: () => number | null;
  getKeyframesMs?: () => readonly number[];
  onZoom?: (level: number) => void;
  onWaveformViewport?: (viewport: WaveformViewport) => void;
  onSpectrumViewport?: (viewport: SpectrumViewport) => void;
  onVideoSeek?: (seconds: number) => void;
  followPlayback?: () => boolean;
  getSelectedId: () => string | null;
  getSelectedIds?: () => string[];
  onSeek: (sec: number) => void;
  onSelectCue: (id: string) => void;
  onRetime: (id: string, startMs: number, endMs: number, commit: boolean) => void;
  onRetimeBatch?: (updates: { id: string; startMs: number; endMs: number }[], commit: boolean) => void;
}

const MIN_H = 104;
const RULER_H = 16;
const EDGE_PX = 8;
const PEAKS_PER_SEC = 100; // waveform bucket resolution

type Palette = {
  bg: string;
  ruler: string;
  wave: string;
  cue: string;
  cueSel: string;
  cueText: string;
  playhead: string;
  border: string;
};


export class Timeline {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private cb: TimelineCallbacks;
  private pxPerSec = 50; // native AudioDisplay base zoom
  private zoomLevel = audioNumber("zoom-horizontal", 0, -30, 50);
  private amplitude = 1;
  private wheelAccumulator = 0;
  private scrollbar!: HTMLInputElement;
  private scrollTimer = 0;
  private pointerId: number | null = null;
  private dragButton = 0;
  private middleSeek = false;
  private hoverX: number | null = null;
  private scrollSec = 0; // time at the left edge
  private width = 0;
  private height = MIN_H;
  private peaks: Float32Array | null = null;
  private peakProvider: ((start: number, end: number) => number) | null = null;
  private peaksPerSec = PEAKS_PER_SEC;
  private waveform: WaveformValues | null = null;
  private waveformPixels: WaveformPixels | null = null;
  private waveformPixelCache: WaveformPixels[] = [];
  private waveformRequest = "";
  private spectrum: SpectrumData | null = null;
  private spectrumCache: SpectrumData[] = [];
  private spectrumRequest = "";
  private audioView: "waveform" | "spectrum" = "waveform";
  private pal!: Palette;
  private ro: ResizeObserver | null = null;
  private raf = 0;
  private backdrop = document.createElement("canvas");
  private drag: AudioTimingGesture | null = null;
  private dragOriginal: Cue[] = [];
  private pan: { startX: number; startScroll: number; moved: boolean } | null = null;
  private dpr = Math.min(2, typeof devicePixelRatio === "number" ? devicePixelRatio : 1);

  constructor(callbacks: TimelineCallbacks) {
    this.cb = callbacks;
    this.pxPerSec = audioZoomFactor(this.zoomLevel) / 2;
  }

  mount(container: HTMLElement): void {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "se-timeline";
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("aria-label", "音频时间轴");
    this.canvas.dataset.audioView = this.audioView;
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.minHeight = `${MIN_H}px`;
    this.canvas.style.display = "block";
    container.appendChild(this.canvas);
    this.scrollbar = document.createElement("input"); this.scrollbar.type = "range"; this.scrollbar.className = "se-audio-scrollbar";
    this.scrollbar.setAttribute("aria-label", "音频水平滚动"); this.scrollbar.min = "0"; this.scrollbar.step = "1";
    this.scrollbar.addEventListener("input", () => { this.scrollSec = Number(this.scrollbar.value) / this.pxPerSec; this.render(); });
    container.append(this.scrollbar);
    this.ctx = this.canvas.getContext("2d")!;
    this.readPalette(container);

    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onHover);
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("pointerleave", () => { if (!this.drag && !this.pan) this.hoverX = null; });
    this.canvas.addEventListener("keydown", this.onKeyDown);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.canvas);
    this.resize();
  }

  private readPalette(el: HTMLElement): void {
    const cs = getComputedStyle(el);
    const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
    this.pal = {
      bg: v("--se-head", "#25272c"),
      ruler: v("--se-muted", "#9aa0aa"),
      wave: v("--se-muted", "#9aa0aa"),
      cue: v("--se-sel", "#1e3a5f"),
      cueSel: v("--se-accent", "#60a5fa"),
      cueText: v("--se-fg", "#e6e7ea"),
      playhead: v("--se-accent", "#60a5fa"),
      border: v("--se-border", "#33353b"),
    };
  }

  // Absolute-peak buckets (PEAKS_PER_SEC per second) mixed down from the audio buffer.
  setPeaks(peaks: Float32Array, peaksPerSec = PEAKS_PER_SEC, waveform?: WaveformValues): void {
    this.peakProvider = null;
    this.peaks = peaks;
    this.peaksPerSec = peaksPerSec;
    this.waveform = waveform ?? null; this.waveformPixels = null; this.waveformPixelCache = []; this.waveformRequest = "";
    this.render();
  }

  setWaveformPixels(pixels: WaveformPixels): void {
    const key = waveformViewKey(pixels.viewport);
    this.waveformPixelCache = [...this.waveformPixelCache.filter(item => waveformViewKey(item.viewport) !== key), pixels].slice(-2);
    this.render();
  }

  clearPeaks(): void {
    this.peakProvider = null;
    this.peaks = null;
    this.waveform = null; this.waveformPixels = null; this.waveformPixelCache = []; this.waveformRequest = "";
    this.canvas.dataset.waveformResolution = "none";
    this.render();
  }

  setPeakProvider(provider: (start: number, end: number) => number): void {
    this.peaks = null; this.peakProvider = provider;
    this.waveform = null; this.waveformPixels = null; this.waveformPixelCache = []; this.waveformRequest = "";
    this.render();
  }

  clearSpectrum(): void {
    this.spectrum = null; this.spectrumCache = []; this.spectrumRequest = "";
    this.canvas.dataset.spectrumResolution = "none";
    this.render();
  }

  resetSpectrumRequest(): void { this.spectrumRequest = ""; }

  private trimSpectrumCache(): void {
    const budget = audioNumber("spectrum-memory", 128, 2, 1024) * 1024 * 1024;
    const bytes = () => this.spectrumCache.reduce((sum, data) => sum + data.values.byteLength + data.blockIndexes.byteLength + data.pixelColumns.byteLength, 0);
    // The active working tile must remain drawable. The budget bounds retained
    // neighbours; one unusually large active tile may itself exceed a small budget.
    while (this.spectrumCache.length > 1 && (bytes() > budget || this.spectrumCache.length > 2)) this.spectrumCache.shift();
  }
  refreshAudioOptions(): void { this.trimSpectrumCache(); this.render(); }

  setSpectrum(spectrum: SpectrumData): void {
    const key = spectrumViewKey(spectrum.viewport);
    this.spectrumCache = [...this.spectrumCache.filter(item => spectrumViewKey(item.viewport) !== key), spectrum];
    this.trimSpectrumCache();
    this.audioView = "spectrum";
    this.canvas.dataset.audioView = "spectrum";
    this.render();
  }

  setAudioView(view: "waveform" | "spectrum"): void {
    this.spectrumRequest = "";
    if (view === "waveform") this.waveformRequest = "";
    this.audioView = view;
    this.canvas.dataset.audioView = view;
    this.render();
  }

  panBy(seconds: number): void {
    const visible = this.width / this.pxPerSec;
    this.scrollSec = clamp(this.scrollSec + seconds, 0, Math.max(0, this.totalDuration() - visible));
    this.render();
  }

  panPixels(pixels: number): void { this.panBy(pixels / this.pxPerSec); }

  /** Native ScrollTimeRangeInView: a 5% margin, preserving an already visible range. */
  showRange(start: number, end: number): void {
    const margin = this.width / 20 / this.pxPerSec;
    const visible = this.width * .9 / this.pxPerSec, left = this.scrollSec + margin;
    const length = end - start;
    if (start >= left && end <= left + visible) return;
    if (length < visible) this.scrollSec = start - (visible - length) / 2 - margin;
    else if (start < left && end > left + visible) return;
    else if (end >= left && end < left + visible) this.scrollSec = end - visible - margin;
    else this.scrollSec = start - margin;
    this.scrollSec = Math.max(0, Math.min(this.scrollSec, this.totalDuration() - this.width / this.pxPerSec));
    this.render();
  }

  centerOn(seconds: number): void {
    const visible = this.width / this.pxPerSec;
    this.scrollSec = clamp(seconds - visible / 2, 0, Math.max(0, this.totalDuration() - visible));
    this.render();
  }

  zoomBy(factor: number): void {
    this.setZoomLevel(this.zoomLevel + (factor > 1 ? 1 : -1));
  }

  setZoomLevel(level: number, anchor = this.hoverX ?? this.width / 2): void {
    const time = this.secOf(anchor);
    this.zoomLevel = clamp(Math.round(level), -30, 50);
    this.pxPerSec = audioZoomFactor(this.zoomLevel) / 2;
    this.scrollSec = Math.max(0, time - anchor / this.pxPerSec);
    localStorage.setItem("aegisub-web.audio-zoom-horizontal", String(this.zoomLevel));
    this.cb.onZoom?.(this.zoomLevel);
    this.render();
  }

  setAmplitudeScale(gain: number): void { this.amplitude = Math.max(0, gain); this.render(); }

  // Fit the whole media (or the last cue) into the view.
  fitAll(): void {
    const dur = this.totalDuration();
    if (dur > 0 && this.width > 0) {
      let level = -30;
      while (level < 50 && audioZoomFactor(level + 1) / 2 <= this.width / dur) level++;
      this.setZoomLevel(level);
      this.scrollSec = 0;
    }
  }

  private totalDuration(): number {
    const d = this.cb.getDuration();
    if (d && Number.isFinite(d)) return d;
    const cues = this.cb.getCues();
    const last = cues.length ? Math.max(...cues.map((c) => c.endMs)) / 1000 : 0;
    return Math.max(last, this.peaks ? this.peaks.length / this.peaksPerSec : 0, 1);
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width) return;
    this.width = rect.width;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.height = Math.max(MIN_H, rect.height || MIN_H);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.render();
  }

  // Keep a smooth playhead while the media plays.
  startPlayheadLoop(): void {
    if (this.raf) return;
    const tick = () => {
      const previousScroll = this.scrollSec;
      if (this.cb.followPlayback?.()) this.followPlayhead();
      if (previousScroll !== this.scrollSec) this.render(); else this.renderPlayhead();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stopPlayheadLoop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private followPlayhead(): void {
    const t = this.cb.getCurrentTime();
    const width = this.width / this.pxPerSec, edge = width / 20;
    if (this.scrollSec > 0 && t < this.scrollSec + edge) this.scrollSec = Math.max(0, t - edge);
    else if (this.scrollSec + width < Math.min(this.totalDuration() - 1 / this.pxPerSec, t + edge)) this.scrollSec = Math.max(0, Math.min(t - width + edge, this.totalDuration() - width - 1 / this.pxPerSec));
  }

  private xOf(sec: number): number {
    return (sec - this.scrollSec) * this.pxPerSec;
  }
  private secOf(x: number): number {
    return this.scrollSec + x / this.pxPerSec;
  }

  render(): void {
    const ctx = this.ctx;
    const w = this.width;
    if (!w) return;
    if (this.scrollbar) {
      this.scrollbar.max = String(Math.max(0, Math.ceil(this.totalDuration() * this.pxPerSec - w)));
      this.scrollbar.value = String(Math.round(this.scrollSec * this.pxPerSec));
      this.scrollbar.setAttribute("aria-valuetext", `${this.scrollSec.toFixed(3)} s`);
    }
    const h = this.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = this.pal.bg;
    ctx.fillRect(0, 0, w, h);

    this.drawRuler();
    if (this.audioView === "spectrum") this.drawSpectrum();
    else this.drawWaveform();
    this.drawCues();

    ctx.strokeStyle = this.pal.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, RULER_H + 0.5);
    ctx.lineTo(w, RULER_H + 0.5);
    ctx.stroke();
    this.backdrop.width = this.canvas.width; this.backdrop.height = this.canvas.height;
    this.backdrop.getContext("2d")!.drawImage(this.canvas, 0, 0);
    this.drawPlayhead();
  }

  renderPlayhead(): void {
    if (!this.backdrop.width || this.backdrop.width !== this.canvas.width || this.backdrop.height !== this.canvas.height) { this.render(); return; }
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.drawImage(this.backdrop, 0, 0, this.width, this.height);
    this.drawPlayhead();
  }

  private drawRuler(): void {
    const ctx = this.ctx;
    ctx.fillStyle = this.pal.ruler;
    ctx.font = "10px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    // Choose a "nice" tick interval targeting ~80px spacing.
    const targetSec = 80 / this.pxPerSec;
    const step = niceStep(targetSec);
    const first = Math.ceil(this.scrollSec / step) * step;
    const decimals = step < 1 ? (step < 0.1 ? 2 : 1) : 0;
    for (let t = first; this.xOf(t) < this.width; t += step) {
      const x = this.xOf(t);
      ctx.fillRect(x, RULER_H - 5, 1, 5);
      ctx.fillText(clock(t, decimals), x + 3, RULER_H / 2);
    }
  }

  private drawWaveform(): void {
    if (!this.peaks && !this.peakProvider) return;
    const ctx = this.ctx;
    const halfH = Math.floor((this.height - RULER_H) / 2);
    const midY = RULER_H + halfH;
    const startPixel = Math.floor(this.scrollSec * this.pxPerSec), width = Math.ceil(this.width);
    this.waveformPixels = this.waveformPixelCache.find(item => {
      const left = Math.round(item.viewport.startSeconds * this.pxPerSec);
      return item.viewport.pixelsPerSecond === this.pxPerSec && left <= startPixel && left + item.viewport.width >= startPixel + width;
    }) ?? null;
    const detail = this.waveformPixels;
    const detailStart = detail ? Math.round(detail.viewport.startSeconds * this.pxPerSec) : 0;
    const precise = !!detail && detail.viewport.pixelsPerSecond === this.pxPerSec && detailStart <= startPixel && detailStart + detail.viewport.width >= startPixel + width;
    if ((this.waveform || this.peakProvider) && !precise && this.cb.onWaveformViewport) {
      const tile = Math.floor(startPixel / 128) * 128;
      const view = { startSeconds: tile / this.pxPerSec, startPixel: tile, pixelsPerSecond: this.pxPerSec, width: Math.ceil((startPixel - tile + width + 128) / 128) * 128 };
      const key = waveformViewKey(view);
      if (key !== this.waveformRequest) { this.waveformRequest = key; this.cb.onWaveformViewport(view); }
    }
    this.canvas.dataset.waveformResolution = precise ? "samples" : this.waveform ? "overview" : "legacy";
    const averages = audioNumber("waveform-style", 0, 0, 1) === 1;
    const avgRanges: number[][] = [];
    ctx.strokeStyle = this.pal.wave;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    for (let x = 0; x < width; x++) {
      const t0 = this.secOf(x);
      const t1 = this.secOf(x + 1);
      let low = 0, high = 0, avgLow = 0, avgHigh = 0;
      if (precise) {
        const i = startPixel + x - detailStart;
        low = detail.minima[i]; high = detail.maxima[i]; avgLow = detail.negativeMeans[i]; avgHigh = detail.positiveMeans[i];
      } else if (this.peakProvider) { high = this.peakProvider(t0, t1); low = -high; }
      else if (this.peaks) {
        const b0 = Math.max(0, Math.floor(t0 * this.peaksPerSec));
        const b1 = Math.min(this.peaks.length - 1, Math.ceil(t1 * this.peaksPerSec) - 1);
        for (let b = b0; b <= b1; b++) {
          if (this.waveform) {
            low = Math.min(low, this.waveform.minima[b]); high = Math.max(high, this.waveform.maxima[b]);
            avgLow += this.waveform.negativeMeans[b]; avgHigh += this.waveform.positiveMeans[b];
          } else { high = Math.max(high, this.peaks[b]); low = -high; }
        }
        avgLow /= Math.max(1, b1 - b0 + 1); avgHigh /= Math.max(1, b1 - b0 + 1);
        if (b1 < 0 || b0 >= this.peaks.length) continue;
      }
      const y = (value: number) => midY - Math.trunc(Math.max(-1, Math.min(1, value * this.amplitude)) * halfH);
      ctx.moveTo(x + 0.5, y(high)); ctx.lineTo(x + 0.5, y(low));
      if (averages) avgRanges.push([x + .5, y(avgHigh), y(avgLow)]);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (averages) {
      ctx.beginPath(); for (const [x, top, bottom] of avgRanges) { ctx.moveTo(x, top); ctx.lineTo(x, bottom); } ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(0, midY + .5); ctx.lineTo(this.width, midY + .5); ctx.stroke();
  }

  private drawSpectrum(): void {
    const startPixel = Math.floor(this.scrollSec * this.pxPerSec), logicalWidth = Math.ceil(this.width);
    const quality = Math.round(audioNumber("spectrum-quality", 1, 0, 3));
    this.spectrum = this.spectrumCache.find(item => item.viewport.quality === quality && item.viewport.pixelsPerSecond === this.pxPerSec
      && item.viewport.startPixel <= startPixel && item.viewport.startPixel + item.viewport.width >= startPixel + logicalWidth) ?? null;
    const spectrum = this.spectrum;
    if (!spectrum && this.cb.onSpectrumViewport) {
      const tile = Math.floor(startPixel / 128) * 128;
      const view = { startPixel: tile, width: Math.ceil((startPixel - tile + logicalWidth + 128) / 128) * 128, pixelsPerSecond: this.pxPerSec, quality };
      const key = spectrumViewKey(view);
      if (key !== this.spectrumRequest) { this.spectrumRequest = key; this.cb.onSpectrumViewport(view); }
    }
    this.canvas.dataset.spectrumResolution = spectrum ? "samples" : "pending";
    if (spectrum) { this.canvas.dataset.spectrumSampleRate = String(spectrum.parameters.sampleRate); this.canvas.dataset.spectrumFftSize = String(spectrum.parameters.fftSize); }
    const top = RULER_H + 1, height = Math.max(1, Math.round((this.height - top) * this.dpr)), width = Math.max(1, Math.round(this.width * this.dpr));
    const image = this.ctx.createImageData(width, height), styles = new Uint8Array(width);
    const active = this.cb.getSelectedId(), selected = new Set(this.cb.getSelectedIds?.() ?? []), cues = this.timingCues();
    for (const priority of [1, 2, 3]) for (const cue of cues) {
      const style = cue.id === active ? 3 : selected.has(cue.id) ? 2 : 1;
      if (style !== priority) continue;
      const left = Math.max(0, Math.floor(this.xOf(cue.startMs / 1000) * this.dpr)), right = Math.min(width, Math.floor(this.xOf(cue.endMs / 1000) * this.dpr));
      if (right > left) styles.fill(style, left, right);
    }
    const curve = Math.round(audioNumber("spectrum-curve", 0, 0, 4));
    const rows = spectrum ? spectrumRows(spectrum.parameters, height, curve) : [];
    const scheme = localStorage.getItem("aegisub-web.audio-spectrum-scheme") === "Green" ? "Green" : "Icy Blue";
    const palettes = [0, 1, 2, 3].map(style => spectrumPalette(style, scheme));
    for (let x = 0; x < width; x++) {
      const pixel = startPixel + Math.floor(x / this.dpr);
      const column = spectrum ? spectrum.pixelColumns[pixel - spectrum.viewport.startPixel] : -1;
      const palette = palettes[styles[x]];
      for (let y = 0; y < height; y++) {
        const power = spectrum && column >= 0 ? spectrumRowValue(spectrum.values, column * spectrum.bins, rows[height - y - 1]) : 0;
        const index = Math.max(0, Math.min(4096, Math.trunc(Math.fround(Math.fround(power * Math.fround(this.amplitude)) * 4096)))) * 3;
        const offset = (y * width + x) * 4;
        image.data[offset] = palette[index]; image.data[offset + 1] = palette[index + 1]; image.data[offset + 2] = palette[index + 2]; image.data[offset + 3] = 255;
      }
    }
    this.ctx.putImageData(image, 0, Math.round(top * this.dpr));
  }

  private cueRect(c: Cue): { x0: number; x1: number } {
    return { x0: this.xOf(c.startMs / 1000), x1: this.xOf(c.endMs / 1000) };
  }

  private drawCues(): void {
    const ctx = this.ctx, top = RULER_H + 1, bottom = this.height;
    const active = this.cb.getSelectedId(), selected = new Set(this.cb.getSelectedIds?.() ?? []);
    const cues = this.timingCues().filter(cue => {
      const { x0, x1 } = this.cueRect(cue);
      return x1 >= 0 && x0 <= this.width && (cue.assKind !== "Comment" || cue.id === active || selected.has(cue.id));
    });
    // Dialogue mode supplies ranges and markers, not cue-text labels or ASS fade shapes.
    // Karaoke has its own syllable editor; ordinary timing must not obscure the waveform.
    if (this.audioView !== "spectrum") for (const cue of cues) {
      const { x0, x1 } = this.cueRect(cue);
      ctx.fillStyle = this.pal.cue;
      ctx.globalAlpha = cue.id === active ? .18 : selected.has(cue.id) ? .1 : .04;
      ctx.fillRect(x0, top, Math.max(1, x1 - x0), bottom - top);
    }
    ctx.globalAlpha = 1;
    for (const emphasized of [false, true]) for (const cue of cues) {
      const primary = cue.id === active || selected.has(cue.id);
      if (primary !== emphasized) continue;
      const { x0, x1 } = this.cueRect(cue);
      ctx.lineWidth = primary ? 2 : 1;
      for (const [x, color, direction] of [[x0, "#d80000", 1], [x1, "#0000d8", -1]] as const) {
        ctx.strokeStyle = primary ? color : "#bebebe";
        ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom);
        if (primary) { ctx.moveTo(x, top + 3); ctx.lineTo(x + direction * 6, top + 3); ctx.moveTo(x, bottom - 3); ctx.lineTo(x + direction * 6, bottom - 3); }
        ctx.stroke();
      }
    }
  }

  private drawPlayhead(): void {
    if (audioFlag("show-keyframes")) {
      this.ctx.strokeStyle = "#bc00bc"; this.ctx.lineWidth = 1; this.ctx.beginPath();
      for (const time of this.cb.getKeyframesMs?.() ?? []) { const x = this.xOf(time / 1000); if (x < 0 || x > this.width) continue; this.ctx.moveTo(x, RULER_H); this.ctx.lineTo(x, this.height); }
      this.ctx.stroke();
    }
    const videoTime = audioFlag("show-video-position") ? this.cb.getVideoPositionMs?.() : null;
    if (videoTime != null) {
      const vx = this.xOf(videoTime / 1000); this.ctx.strokeStyle = "#00a040"; this.ctx.lineWidth = 1; this.ctx.beginPath(); this.ctx.moveTo(vx, RULER_H); this.ctx.lineTo(vx, this.height); this.ctx.stroke();
    }
    const x = this.xOf(this.cb.getCurrentTime());
    if (x < 0 || x > this.width) return;
    const ctx = this.ctx;
    ctx.strokeStyle = this.audioView === "spectrum" ? "#ffffff" : this.pal.playhead;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, this.height);
    ctx.stroke();
  }

  // --- interaction ---------------------------------------------------------

  private timingCues(): Cue[] { return audioTimingCues(this.cb.getCues(), this.cb.getSelectedId() ?? "", this.cb.getSelectedIds?.() ?? [], audioNumber("inactive-lines", 3, 0, 3), audioFlag("inactive-comments", false)); }
  private snapRange(shift: boolean): number { return audioFlag("snap") !== shift ? Math.trunc(audioNumber("snap-distance", 8, 0, 100) * 1000 / this.pxPerSec) : 0; }
  private pointerX(event: PointerEvent): number { return Math.round(event.clientX - this.canvas.getBoundingClientRect().left); }

  private hitTest(x: number): { id: string; mode: "start" | "end" | "move" } | null {
    for (const c of this.cb.getCues()) {
      const { x0, x1 } = this.cueRect(c);
      if (x >= x0 - EDGE_PX && x <= x1 + EDGE_PX) {
        if (Math.abs(x - x0) <= EDGE_PX) return { id: c.id, mode: "start" };
        if (Math.abs(x - x1) <= EDGE_PX) return { id: c.id, mode: "end" };
        if (x > x0 && x < x1) return { id: c.id, mode: "move" };
      }
    }
    return null;
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    if (this.pointerId !== null) return;
    e.preventDefault();
    const x = this.pointerX(e);
    this.canvas.focus({ preventScroll: true });
    const y = e.offsetY;
    const timeMs = Math.max(0, Math.round(this.secOf(x) * 1000));

    // Native ruler drag pans; middle-button drag seeks the VIDEO, never retimes cues.
    if (e.button === 1 || (y <= RULER_H && e.button === 0)) {
      this.middleSeek = e.button === 1; this.pointerId = e.pointerId;
      this.pan = { startX: x, startScroll: this.scrollSec, moved: false };
      if (this.middleSeek) this.cb.onVideoSeek?.(timeMs / 1000);
      this.canvas.style.cursor = "grabbing";
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.addEventListener("pointermove", this.onPanMove);
      this.canvas.addEventListener("pointerup", this.onPanUp);
      this.canvas.addEventListener("pointercancel", this.onPanUp);
      this.canvas.addEventListener("lostpointercapture", this.onPanUp);
      return;
    }

    if (y > RULER_H && (e.button === 0 || e.button === 2)) {
      let id = this.cb.getSelectedId();
      let cue = this.cb.getCues().find((item) => item.id === id);
      if (!cue) {
        const hit = this.hitTest(x);
        if (hit) {
          id = hit.id;
          this.cb.onSelectCue(hit.id);
          cue = this.cb.getCues().find((item) => item.id === hit.id);
        }
      }
      if (!id || !cue) return;
      this.dragOriginal = this.timingCues().map(cue => ({ ...cue }));
      this.drag = new AudioTimingGesture(this.dragOriginal, id, this.cb.getSelectedIds?.() ?? [id], timeMs, {
        button: e.button, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, sensitivityMs: audioNumber("drag-sensitivity", 8, 0, 100) * 1000 / this.pxPerSec,
        dragTiming: audioFlag("drag-timing"), snapRangeMs: this.snapRange(e.shiftKey), snapTargetsMs: this.cb.getSnapTargetsMs?.(),
      });
      this.pointerId = e.pointerId;
      this.dragButton = e.button;
      this.publishDrag(false);
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.addEventListener("pointermove", this.onPointerMove);
      this.canvas.addEventListener("pointerup", this.onPointerUp);
      this.canvas.addEventListener("pointercancel", this.onPointerCancel);
      this.canvas.addEventListener("lostpointercapture", this.onPointerCancel);
      this.render();
      return;
    }
  };

  private onContextMenu = (event: MouseEvent): void => {
    // Secondary drag is the end-marker gesture, not the browser context menu.
    event.preventDefault();
  };

  private onPanMove = (e: PointerEvent): void => {
    if (!this.pan || e.pointerId !== this.pointerId) return;
    if (this.middleSeek) { this.cb.onVideoSeek?.(Math.max(0, this.secOf(this.pointerX(e)))); return; }
    const dx = this.pointerX(e) - this.pan.startX;
    if (Math.abs(dx) > 3) this.pan.moved = true;
    this.scrollSec = clamp(this.pan.startScroll - dx / this.pxPerSec, 0, Math.max(0, this.totalDuration() - this.width / this.pxPerSec));
    this.render();
  };

  private onPanUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.pan = null;
    this.canvas.style.cursor = "grab";
    this.pointerId = null; this.middleSeek = false;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.canvas.removeEventListener("pointermove", this.onPanMove);
    this.canvas.removeEventListener("pointerup", this.onPanUp);
    this.canvas.removeEventListener("pointercancel", this.onPanUp);
    this.canvas.removeEventListener("lostpointercapture", this.onPanUp);
    this.render();
  };

  private onHover = (e: PointerEvent): void => {
    this.hoverX = this.pointerX(e);
    if (this.drag || this.pan) return;
    this.canvas.style.cursor = e.offsetY <= RULER_H ? "pointer" : "crosshair";
  };

  private publishDrag(commit: boolean): void {
    const ranges = this.drag?.ranges() ?? [];
    this.publishRanges(ranges.map(({ id, range }) => ({ id, ...range })), commit);
    this.render();
  }

  private publishRanges(updates: { id: string; startMs: number; endMs: number }[], commit: boolean): void {
    if (this.cb.onRetimeBatch) this.cb.onRetimeBatch(updates, commit);
    else updates.forEach(({ id, startMs, endMs }, index) => this.cb.onRetime(id, startMs, endMs, commit && index === updates.length - 1));
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.drag || e.pointerId !== this.pointerId) return;
    const ms = Math.max(0, Math.trunc(this.secOf(this.pointerX(e)) * 1000));
    this.drag.move(ms, this.snapRange(e.shiftKey), this.cb.getSnapTargetsMs?.());
    this.publishDrag(false);
    const position = this.xOf(this.drag.positionMs / 1000);
    if (!this.scrollTimer && (position < 0 || position >= this.width)) this.scrollTimer = window.setTimeout(() => {
      this.scrollTimer = 0; if (!this.drag) return;
      const x = this.xOf(this.drag.positionMs / 1000);
      if (x < 0) this.panPixels(x - this.width / 20);
      else if (x >= this.width) this.panPixels(x - this.width + this.width / 20);
    }, 50);
  };

  private finishDrag(e: PointerEvent): void {
    this.drag = null;
    clearTimeout(this.scrollTimer); this.scrollTimer = 0; this.pointerId = null;
    this.dragOriginal = [];
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerCancel);
    this.canvas.removeEventListener("lostpointercapture", this.onPointerCancel);
  }

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.drag || e.pointerId !== this.pointerId || e.button !== this.dragButton) return;
    this.publishDrag(true);
    this.finishDrag(e);
    if (audioFlag("autoscroll")) {
      const x = this.pointerX(e);
      if (x < this.width / 20) this.panPixels(-this.width / 3);
      else if (this.width - x < this.width / 20) this.panPixels(this.width / 3);
    }
  };

  private onPointerCancel = (e: PointerEvent): void => {
    if (!this.drag || e.pointerId !== this.pointerId) return;
    const changed = new Set(this.drag.ranges().map(item => item.id));
    this.publishRanges(this.dragOriginal.filter(cue => changed.has(cue.id)), false);
    this.finishDrag(e);
    this.render();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || this.pointerId === null) return;
    event.preventDefault(); event.stopPropagation();
    const cancel = new PointerEvent("pointercancel", { pointerId: this.pointerId });
    if (this.drag) this.onPointerCancel(cancel); else this.onPanUp(cancel);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? this.width : 1;
    const zoom = (e.ctrlKey || e.metaKey) !== audioFlag("wheel-zoom", false);
    if (!zoom) {
      this.wheelAccumulator = 0; this.panPixels((e.deltaX || e.deltaY) * unit);
    } else {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      this.wheelAccumulator -= e.deltaY * unit;
      const levels = Math.trunc(this.wheelAccumulator / 100); this.wheelAccumulator -= levels * 100;
      if (levels) this.setZoomLevel(this.zoomLevel + levels, e.offsetX);
    }
    this.render();
  };

  refreshTheme(container: HTMLElement): void {
    this.readPalette(container);
    this.render();
  }

  destroy(): void {
    this.stopPlayheadLoop();
    clearTimeout(this.scrollTimer);
    this.ro?.disconnect();
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.canvas.remove();
    this.backdrop.width = this.backdrop.height = 0;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function niceStep(target: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  for (const m of [1, 2, 5, 10]) if (pow * m >= target) return pow * m;
  return pow * 10;
}

function clock(sec: number, decimals = 0): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n: number) => String(Math.floor(n)).padStart(2, "0");
  const secStr = decimals ? ss.toFixed(decimals).padStart(3 + decimals, "0") : p(ss);
  return h ? `${h}:${p(m)}:${secStr}` : `${m}:${secStr}`;
}
