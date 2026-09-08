// Source-derived non-FFTW spectrum: samgum/Aegisub dc2a5b4, fft.cpp,
// audio_renderer_spectrum.cpp, audio_colorscheme.cpp and colorspace.cpp.
// Original BSD notices are retained in test-corpus/aegisub-fft/ and
// vendor/LICENSE-AEGISUB-SPECTRUM.txt (also shipped with the site).
const f = Math.fround;
export interface SpectrumParameters { fftSize: number; hop: number; binCount: number; storedBins: number; sampleRate: number; scale: number }
export interface SpectrumViewport { startPixel: number; width: number; pixelsPerSecond: number; quality: number }
export interface SpectrumData {
  values: Float32Array;
  pixelColumns: Int32Array;
  blockIndexes: Float64Array;
  columns: number;
  bins: number;
  parameters: SpectrumParameters;
  viewport: SpectrumViewport;
  totalSamples: number;
}
export const spectrumViewKey = (view: SpectrumViewport): string => `${view.startPixel}/${view.width}/${view.pixelsPerSecond}/${view.quality}`;
export function spectrumParameters(sampleRate: number, quality = 1): SpectrumParameters {
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 1 || sampleRate > 1536000) throw new Error("频谱采样率无效。");
  const q = Math.max(0, Math.min(3, Math.round(quality)));
  let size = [8, 9, 9, 9][q], distance = [8, 8, 7, 6][q], extra = 0;
  let ratio = f(sampleRate / 50000);
  while (ratio > 1) { size++; distance++; extra++; ratio = f(ratio * .5); }
  const fftSize = 2 ** (size + 1), binCount = fftSize / 2;
  const maxBand = Math.min(Math.floor(f(f(binCount * 20000) / f(sampleRate * .5)) + .5), binCount);
  const scaleFix = f(1 / f(Math.sqrt(2 ** extra)));
  return { fftSize, hop: 2 ** distance, binCount, storedBins: Math.min(binCount, maxBand + 1), sampleRate,
    scale: f(f(scaleFix * 9) / f(Math.sqrt(f(2 * fftSize)))) };
}

/** Mirrors the native float recurrence, including float rounding of intermediates. */
export class NativeSpectrumFFT {
  private real: Float32Array;
  private imag: Float32Array;
  private reversed: Uint32Array;
  private stages: { size: number; cm1: number; cm2: number; sm1: number; sm2: number; w: number }[] = [];
  constructor(readonly parameters: SpectrumParameters) {
    const n = parameters.fftSize, bits = Math.log2(n);
    this.real = new Float32Array(n); this.imag = new Float32Array(n); this.reversed = new Uint32Array(n);
    for (let i = 0; i < n; i++) { let value = i, reversed = 0; for (let b = 0; b < bits; b++) { reversed = (reversed << 1) | (value & 1); value >>>= 1; } this.reversed[i] = reversed; }
    for (let size = 2; size <= n; size *= 2) {
      const angle = f(f(2 * f(Math.PI)) / size), cm1 = f(Math.cos(-angle));
      this.stages.push({ size, cm1, cm2: f(Math.cos(f(-2 * angle))), sm1: f(Math.sin(-angle)), sm2: f(Math.sin(f(-2 * angle))), w: f(2 * cm1) });
    }
  }
  power(pcm: Int16Array, ringStart = 0): Float32Array {
    const n = this.real.length, mask = n - 1, real = this.real, imag = this.imag;
    for (let i = 0; i < n; i++) { real[this.reversed[i]] = pcm[(ringStart + i) & mask] / 32768; imag[i] = 0; }
    for (const stage of this.stages) for (let begin = 0; begin < n; begin += stage.size) {
      let ar1 = stage.cm1, ar2 = stage.cm2, ai1 = stage.sm1, ai2 = stage.sm2;
      for (let offset = 0; offset < stage.size / 2; offset++) {
        const j = begin + offset, k = j + stage.size / 2;
        const ar0 = f(f(stage.w * ar1) - ar2), ai0 = f(f(stage.w * ai1) - ai2);
        ar2 = ar1; ar1 = ar0; ai2 = ai1; ai1 = ai0;
        const tr = f(f(ar0 * real[k]) - f(ai0 * imag[k])), ti = f(f(ar0 * imag[k]) + f(ai0 * real[k]));
        real[k] = real[j] - tr; imag[k] = imag[j] - ti; real[j] += tr; imag[j] += ti;
      }
    }
    const power = new Float32Array(this.parameters.storedBins);
    for (let i = 0; i < power.length; i++) {
      const magnitude = f(Math.sqrt(f(f(real[i] * real[i]) + f(imag[i] * imag[i]))));
      power[i] = Math.log10(f(f(magnitude * this.parameters.scale) + 1));
    }
    return power;
  }
}

export interface SpectrumRow { from: number; to: number; fraction: number; maximum: boolean }
/** Rows are bottom-to-top, exclude DC, and stop at min(20 kHz, Nyquist). */
export function spectrumRows(parameters: SpectrumParameters, height: number, curve = 0): SpectrumRow[] {
  const { binCount, sampleRate } = parameters;
  const maxBand = Math.min(Math.floor(f(f(binCount * 20000) / f(sampleRate * .5)) + .5), binCount);
  const position = f([.001, .125, .333, .425, .999][Math.max(0, Math.min(4, Math.round(curve)))]);
  const scaleLog = f(Math.log(maxBand)), reference = Math.max(1, Math.min(maxBand - 1, f(f(binCount * 1000) / f(sampleRate * .5))));
  const linear = f(1 + f((maxBand - 1) * position)), log = f(Math.exp(f(position * scaleLog)));
  const ratio = Math.max(0, Math.min(1, f(f(reference - linear) / f(log - linear))));
  const rows: SpectrumRow[] = [];
  let previous = 1, current = 1;
  for (let y = 0; y < height; y++) {
    let next = maxBand;
    if (y + 1 < height) {
      const relative = f((y + 1) / height), lin = f(1 + f(relative * (maxBand - 1))), logarithmic = f(Math.exp(f(relative * scaleLog)));
      next = f(lin + f(ratio * f(logarithmic - lin)));
    }
    if (f(next - previous) < 2) {
      const from = Math.floor(current);
      rows.push({ from, to: Math.min(from + 1, binCount - 1), fraction: f(current - from), maximum: false });
    } else rows.push({ from: Math.min(Math.floor(f(f(previous + current) * .5)), binCount - 2), to: Math.min(Math.floor(f(f(current + next) * .5)), binCount - 1), fraction: 0, maximum: true });
    previous = current; current = next;
  }
  return rows;
}
export function spectrumRowValue(values: Float32Array, offset: number, row: SpectrumRow): number {
  if (!row.maximum) { const low = values[offset + row.from] ?? 0; return f(low + f(row.fraction * f((values[offset + row.to] ?? 0) - low))); }
  let peak = 0; for (let i = row.from; i < row.to; i++) peak = Math.max(peak, values[offset + i] ?? 0); return peak;
}

export function nativeHslRgb(H: number, S: number, L: number): number[] {
  if (!S) return [L, L, L];
  if (L === 128 && S === 255) {
    const special: Record<number, number[]> = { 0: [255, 0, 0], 255: [255, 0, 0], 43: [255, 255, 0], 85: [0, 255, 0], 128: [0, 255, 255], 171: [0, 0, 255], 213: [255, 0, 255] };
    if (special[H]) return special[H];
  }
  const h = f(H / 255), s = f(S / 255), l = f(L / 255);
  const two = l < .5 ? f(l * f(1 + s)) : f(f(l + s) - f(l * s)), one = f(f(2 * l) - two);
  return [f(h + f(1 / 3)), h, f(h - f(1 / 3))].map(value => {
    if (value > 1) value = f(value - 1); if (value < 0) value = f(value + 1);
    const rgb = f(6 * value) < 1 ? f(one + f(f(f(two - one) * 6) * value)) : f(2 * value) < 1 ? two
      : f(3 * value) < 2 ? f(one + f(f(f(two - one) * f(f(2 / 3) - value)) * 6)) : one;
    return Math.max(0, Math.min(255, Math.trunc(f(rgb * 255))));
  });
}
const palettes = new Map<string, Uint8Array>();
export function spectrumPalette(style: number, scheme = "Icy Blue"): Uint8Array {
  const key = `${scheme}/${style}`; if (palettes.has(key)) return palettes.get(key)!;
  // Normal, inactive, selected, primary -- in native priority order.
  const offsets = scheme === "Green" ? [[85, 0, 255, 0, 0, 200], [85, 0, 255, 0, 0, 100], [80, 0, 255, 0, 10, 175], [85, 0, 128, 0, 25, 300]][style]
    : [[191, -128, 127, 128, 0, 255], [191, -128, 63, 192, 32, 192], [191, -128, 127, 128, 32, 192], [191, -128, 127, 128, 64, 192]][style];
  const out = new Uint8Array(4097 * 3);
  for (let i = 0; i <= 4096; i++) {
    const component = (n: number) => Math.max(0, Math.min(255, Math.trunc(offsets[n] + i / 4096 * offsets[n + 1])));
    out.set(nativeHslRgb(component(0), component(2), component(4)), i * 3);
  }
  palettes.set(key, out); return out;
}
