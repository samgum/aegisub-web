import { NativePcmRange, nativePcmRate } from "./audio-clip-pcm";
import { processAudioPcm } from "./audio-clip-stream";
import { dummyNoiseSample, DUMMY_AUDIO_RATE, DUMMY_AUDIO_SECONDS, type DummyAudioKind } from "./dummy-audio";
import { NativeSpectrumFFT, spectrumParameters, type SpectrumData, type SpectrumViewport } from "./spectrum-core";

export class SpectrumAccumulator {
  readonly data: SpectrumData;
  readonly startSample: number;
  readonly endSample: number;
  private cursor: number;
  private next = 0;
  private ring: Int16Array;
  private fft: NativeSpectrumFFT;
  constructor(rate: number, totalSamples: number, viewport: SpectrumViewport) {
    if (!Number.isInteger(viewport.width) || viewport.width < 1 || viewport.width > 16384 || !Number.isSafeInteger(viewport.startPixel) || viewport.startPixel < 0
      || !Number.isFinite(viewport.pixelsPerSecond) || viewport.pixelsPerSecond <= 0 || !Number.isInteger(viewport.quality) || viewport.quality < 0 || viewport.quality > 3) throw new Error("频谱视口无效。");
    const parameters = spectrumParameters(rate, viewport.quality), blocks: number[] = [], pixelColumns = new Int32Array(viewport.width).fill(-1);
    const blockCount = Math.ceil(totalSamples / parameters.hop), pixelMs = 1000 / viewport.pixelsPerSecond;
    for (let x = 0; x < viewport.width; x++) {
      const block = Math.floor(Math.trunc((viewport.startPixel + x) * pixelMs * rate / 1000) / parameters.hop);
      if (block >= blockCount) continue;
      if (blocks[blocks.length - 1] !== block) blocks.push(block);
      pixelColumns[x] = blocks.length - 1;
    }
    this.data = { values: new Float32Array(blocks.length * parameters.storedBins), pixelColumns, blockIndexes: Float64Array.from(blocks), columns: blocks.length, bins: parameters.storedBins, parameters, viewport, totalSamples };
    this.startSample = blocks.length ? blocks[0] * parameters.hop - parameters.fftSize / 2 : 0;
    this.endSample = blocks.length ? blocks[blocks.length - 1] * parameters.hop + parameters.fftSize / 2 : 0;
    this.cursor = this.startSample; this.ring = new Int16Array(parameters.fftSize); this.fft = new NativeSpectrumFFT(parameters);
  }
  append(bytes: Uint8Array, start: number): void {
    while (this.cursor < Math.min(start, this.endSample)) { this.skipToWindow(Math.min(start, this.endSample)); if (this.cursor < start) this.feed(0); }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), end = Math.min(this.endSample, start + bytes.byteLength / 2);
    while (this.cursor < end) { this.skipToWindow(end); if (this.cursor < end) this.feed(view.getInt16((this.cursor - start) * 2, true)); }
  }
  private skipToWindow(end: number): void {
    if (this.next < this.data.columns) this.cursor = Math.max(this.cursor, Math.min(end, this.data.blockIndexes[this.next] * this.data.parameters.hop - this.data.parameters.fftSize / 2));
  }
  private feed(value: number): void {
    const p = this.data.parameters, mask = p.fftSize - 1;
    this.ring[(this.cursor - this.startSample) & mask] = value; this.cursor++;
    if (this.next < this.data.columns && this.cursor === this.data.blockIndexes[this.next] * p.hop + p.fftSize / 2) {
      this.data.values.set(this.fft.power(this.ring, (this.cursor - this.startSample) & mask), this.next * this.data.bins); this.next++;
    }
  }
  finish(): SpectrumData { while (this.cursor < this.endSample) { this.skipToWindow(this.endSample); if (this.cursor < this.endSample) this.feed(0); } return this.data; }
}

export async function streamSpectrum(file: Blob | null, viewport: SpectrumViewport, synthetic?: DummyAudioKind, progress?: (ratio: number) => void): Promise<SpectrumData> {
  let accumulator!: SpectrumAccumulator;
  if (synthetic) {
    accumulator = new SpectrumAccumulator(DUMMY_AUDIO_RATE, DUMMY_AUDIO_RATE * DUMMY_AUDIO_SECONDS, viewport);
    if (synthetic === "blank") return accumulator.data;
    const data = accumulator.data, fft = new NativeSpectrumFFT(data.parameters), pcm = new Int16Array(data.parameters.fftSize);
    for (let column = 0; column < data.columns; column++) {
      const start = data.blockIndexes[column] * data.parameters.hop - pcm.length / 2;
      for (let i = 0; i < pcm.length; i++) pcm[i] = start + i >= 0 && start + i < data.totalSamples ? Math.round(dummyNoiseSample(start + i) * 32768) : 0;
      data.values.set(fft.power(pcm), column * data.bins);
      if (column % 32 === 0) progress?.(column / data.columns);
    }
    progress?.(1); return data;
  } else {
    if (!file) throw new Error("请先加载音频。");
    const stream = await processAudioPcm(file, (rate, count) => {
      const native = nativePcmRate(rate); accumulator = new SpectrumAccumulator(native.rate, count * native.factor, viewport);
      return new NativePcmRange(rate, count, { startSample: accumulator.startSample, endSample: accumulator.endSample }, (bytes, start) => accumulator.append(bytes, start));
    }, progress);
    stream.finish();
  }
  const data = accumulator.finish(); progress?.(1); return data;
}
