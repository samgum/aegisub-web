import { nativePcmRate, NativePcmRange } from "./audio-clip-pcm";
import { processAudioPcm } from "./audio-clip-stream";
import { DUMMY_AUDIO_RATE, DUMMY_AUDIO_SECONDS, dummyNoiseSample, type DummyAudioKind } from "./dummy-audio";

export interface WaveformValues {
  minima: Float32Array;
  maxima: Float32Array;
  negativeMeans: Float32Array;
  positiveMeans: Float32Array;
}
export interface WaveformOverview extends WaveformValues { peaks: Float32Array; peaksPerSec: number }
export interface WaveformViewport { startSeconds: number; pixelsPerSecond: number; width: number; startPixel?: number }
export interface WaveformPixels extends WaveformValues { viewport: WaveformViewport; sampleRate: number }
export const waveformViewKey = (view: WaveformViewport): string => `${view.startSeconds}/${view.pixelsPerSecond}/${view.width}`;

/** Source-derived AudioWaveformRenderer: a separate signed peak and average over
 * each integer-sized pixel strip. Silent/missing samples contribute zero to means. */
export class WaveformPixelAccumulator {
  readonly starts: Float64Array;
  readonly samplesPerPixel: number;
  readonly sampleSpan: number;
  readonly minima: Float32Array;
  readonly maxima: Float32Array;
  private negative: Float64Array;
  private positive: Float64Array;
  private pixel = 0;
  constructor(readonly viewport: WaveformViewport, readonly sampleRate: number) {
    if (!Number.isFinite(viewport.startSeconds) || viewport.startSeconds < 0 || !Number.isFinite(viewport.pixelsPerSecond) || viewport.pixelsPerSecond <= 0
      || !Number.isInteger(viewport.width) || viewport.width < 0 || viewport.width > 10000000) throw new Error("波形视口无效。");
    this.sampleSpan = (1000 / viewport.pixelsPerSecond) * sampleRate / 1000;
    this.samplesPerPixel = Math.floor(this.sampleSpan);
    if (this.samplesPerPixel < 1) throw new Error("波形缩放超过采样分辨率。");
    // Native AudioRenderer caches 32-pixel bitmaps. Reproduce its double-precision
    // stepping and reset at each block, including fractional-sample rounding.
    const firstPixel = viewport.startPixel ?? Math.round(viewport.startSeconds * viewport.pixelsPerSecond);
    this.starts = new Float64Array(viewport.width);
    let cursor = 0;
    for (let x = 0; x < viewport.width; x++) {
      const pixel = firstPixel + x;
      if (x === 0 || pixel % 32 === 0) {
        cursor = Math.floor(pixel / 32) * 32 * this.sampleSpan;
        for (let offset = 0; offset < pixel % 32; offset++) cursor += this.sampleSpan;
      }
      this.starts[x] = Math.trunc(cursor); cursor += this.sampleSpan;
    }
    this.minima = new Float32Array(viewport.width); this.maxima = new Float32Array(viewport.width);
    this.negative = new Float64Array(viewport.width); this.positive = new Float64Array(viewport.width);
  }
  get range(): { startSample: number; endSample: number } {
    return { startSample: this.starts[0] ?? 0, endSample: this.starts.length ? this.starts[this.starts.length - 1] + this.samplesPerPixel : 0 };
  }
  append(bytes: Uint8Array, start: number): void {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = start + bytes.byteLength / 2;
    while (this.pixel < this.starts.length && this.starts[this.pixel] + this.samplesPerPixel <= start) this.pixel++;
    for (let pixel = this.pixel; pixel < this.starts.length && this.starts[pixel] < end; pixel++) {
      const first = Math.max(start, this.starts[pixel]), last = Math.min(end, this.starts[pixel] + this.samplesPerPixel);
      for (let index = first; index < last; index++) {
        const sample = view.getInt16((index - start) * 2, true);
        if (sample >= 0) { this.maxima[pixel] = Math.max(this.maxima[pixel], sample); this.positive[pixel] += sample; }
        else { this.minima[pixel] = Math.min(this.minima[pixel], sample); this.negative[pixel] += sample; }
      }
    }
  }
  finish(): WaveformPixels {
    return {
      viewport: this.viewport, sampleRate: this.sampleRate,
      minima: this.minima.map(value => value / 32768), maxima: this.maxima.map(value => value / 32768),
      negativeMeans: Float32Array.from(this.negative, value => value / this.sampleSpan / 32768),
      positiveMeans: Float32Array.from(this.positive, value => value / this.sampleSpan / 32768),
    };
  }
}

export async function computeWaveform(file: Blob, viewport?: WaveformViewport, progress?: (ratio: number) => void): Promise<WaveformPixels | WaveformOverview> {
  let accumulator!: WaveformPixelAccumulator;
  const stream = await processAudioPcm(file, (sourceRate, frames) => {
    const { rate, factor } = nativePcmRate(sourceRate);
    const view = viewport ?? { startSeconds: 0, pixelsPerSecond: 100, width: Math.ceil(frames * factor / rate * 100) };
    accumulator = new WaveformPixelAccumulator(view, rate);
    return new NativePcmRange(sourceRate, frames, accumulator.range, (bytes, start) => accumulator.append(bytes, start));
  }, progress);
  stream.finish();
  const values = accumulator.finish();
  if (viewport) return values;
  return { ...values, peaksPerSec: 100, peaks: values.maxima.map((value, index) => Math.max(value, -values.minima[index])) };
}

export function computeSyntheticWaveform(kind: DummyAudioKind, viewport: WaveformViewport): WaveformPixels {
  const accumulator = new WaveformPixelAccumulator(viewport, DUMMY_AUDIO_RATE);
  if (kind === "noise") {
    const { startSample, endSample } = accumulator.range;
    const end = Math.min(endSample, DUMMY_AUDIO_RATE * DUMMY_AUDIO_SECONDS);
    for (let start = startSample; start < end; start += 32768) {
      const count = Math.min(32768, end - start), bytes = new Uint8Array(count * 2), view = new DataView(bytes.buffer);
      for (let i = 0; i < count; i++) view.setInt16(i * 2, Math.round(dummyNoiseSample(start + i) * 32768), true);
      accumulator.append(bytes, start);
    }
  }
  return accumulator.finish();
}
