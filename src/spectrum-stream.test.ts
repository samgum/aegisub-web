import { expect, it } from "vitest";
import { streamSpectrum } from "./spectrum-stream";

function wav(rate: number, channels: number, frames: number, value: (i: number, c: number) => number): Blob {
  const bytes = Buffer.alloc(44 + frames * channels * 2); bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22); bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * channels * 2, 28); bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) bytes.writeInt16LE(value(i, c), 44 + (i * channels + c) * 2);
  return new Blob([bytes], { type: "audio/wav" });
}
it("reads 48/96 kHz PCM without a speech decoder and retains the 12 kHz band", async () => {
  for (const rate of [48000, 96000]) {
    const source = wav(rate, 1, rate, i => Math.round(Math.sin(2 * Math.PI * 12000 * i / rate) * 2000));
    const result = await streamSpectrum(source, { startPixel: 20, width: 20, pixelsPerSecond: 50, quality: 1 });
    expect(result.parameters.sampleRate).toBe(rate);
    for (let column = 0; column < result.columns; column++) {
      const values = result.values.subarray(column * result.bins, (column + 1) * result.bins);
      const peak = values.indexOf(Math.max(...values)); expect(peak * rate / result.parameters.fftSize).toBe(12000);
    }
  }
});
it("mixes channels before the transform and does not repeat the last spectrum after EOF", async () => {
  const result = await streamSpectrum(wav(48000, 2, 4800, (i, c) => ((i * 379) % 30000 - 15000) * (c ? -1 : 1)), { startPixel: 0, width: 64, pixelsPerSecond: 50, quality: 1 });
  expect(result.values.every(value => value === 0)).toBe(true);
  expect(result.pixelColumns[50]).toBe(-1);
});
it("seeks a bounded viewport in a 115 MB WAV and retains only its FFT blocks", async () => {
  const part = wav(48000, 2, 48000, (i) => [0, 2000, 0, -2000][i % 4]);
  const raw = await part.arrayBuffer(), header = new Uint8Array(raw.slice(0, 44)), data = new Blob([raw.slice(44)]);
  const view = new DataView(header.buffer); view.setUint32(4, data.size * 600 + 36, true); view.setUint32(40, data.size * 600, true);
  let read = 0;
  class WatchedBlob extends Blob {
    override async arrayBuffer(): Promise<ArrayBuffer> { throw new Error("whole source read"); }
    override slice(start?: number, end?: number, type?: string): Blob {
      const result = super.slice(start, end, type);
      result.arrayBuffer = async () => { read += result.size; return Blob.prototype.arrayBuffer.call(result); };
      result.stream = () => { const reader = Blob.prototype.stream.call(result).getReader(); return new ReadableStream({ async pull(controller) {
        const value = await reader.read(); if (value.done) controller.close(); else { read += value.value.length; controller.enqueue(value.value); }
      }, cancel: () => reader.cancel() }); };
      return result;
    }
  }
  const file = new WatchedBlob([header, ...Array(600).fill(data)]);
  const result = await streamSpectrum(file, { startPixel: 500 * 675, width: 100, pixelsPerSecond: 675, quality: 1 });
  expect(read).toBeLessThan(4 * 1024 * 1024); expect(result.values.byteLength).toBeLessThan(200000);
  expect(result.parameters.fftSize).toBe(1024); expect(result.values[256]).toBeGreaterThan(.7);
}, 10000);
