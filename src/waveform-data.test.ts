import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { WaveformPixelAccumulator, computeSyntheticWaveform, computeWaveform, type WaveformPixels, type WaveformOverview } from "./waveform-data";
import { dummyNoiseSample } from "./dummy-audio";

const cases = JSON.parse(readFileSync("test-corpus/native-waveform-oracle.json", "utf8")) as { rate: number; pps: number; startPixel: number; width: number; sampleCount: number; sampleSpan: number; pixels: number[][] }[];
function sample(index: number): number {
  if (index % 23497 === 1) return -32768;
  if (index % 104729 === 13) return 32767;
  return (index * 37 + Math.floor(index / 17) * 3) % 2001 - 1000;
}
it.each(cases)("matches native C++ strips: $rate Hz, $pps px/s, starting pixel $startPixel", ref => {
  const accumulator = new WaveformPixelAccumulator({ startSeconds: ref.startPixel / ref.pps, startPixel: ref.startPixel, pixelsPerSecond: ref.pps, width: ref.width }, ref.rate);
  const { startSample, endSample } = accumulator.range;
  for (let start = startSample; start < Math.min(endSample, ref.sampleCount); start += 4093) {
    const count = Math.min(4093, endSample - start, ref.sampleCount - start), bytes = new Uint8Array(count * 2), view = new DataView(bytes.buffer);
    for (let i = 0; i < count; i++) view.setInt16(i * 2, sample(start + i), true);
    accumulator.append(bytes, start);
  }
  const actual = accumulator.finish();
  ref.pixels.forEach(([start, low, high, neg, pos], x) => {
    expect(accumulator.starts[x]).toBe(start);
    expect(actual.minima[x]).toBe(low / 32768); expect(actual.maxima[x]).toBe(high / 32768);
    expect(actual.negativeMeans[x]).toBe(Math.fround(neg / ref.sampleSpan / 32768));
    expect(actual.positiveMeans[x]).toBe(Math.fround(pos / ref.sampleSpan / 32768));
  });
});

function pcmWav(channels: number, frames: number, value: (frame: number, channel: number) => number): Blob {
  const bytes = Buffer.alloc(44 + frames * channels * 2);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22); bytes.writeUInt32LE(48000, 24); bytes.writeUInt32LE(48000 * channels * 2, 28);
  bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) bytes.writeInt16LE(value(i, c), 44 + (i * channels + c) * 2);
  return new Blob([bytes], { type: "audio/wav" });
}
it("downmixes PCM channels before measuring, retaining single-sample transients", async () => {
  const cancelled = await computeWaveform(pcmWav(2, 48000, (_i, c) => c ? -30000 : 30000)) as WaveformOverview;
  expect(cancelled.peaks.some(value => value !== 0)).toBe(false);
  const pulses = await computeWaveform(pcmWav(1, 48000, i => i === 1 ? 32767 : i === 2 ? -12345 : 0)) as WaveformOverview;
  expect(pulses.maxima[0]).toBe(32767 / 32768); expect(pulses.minima[0]).toBe(-12345 / 32768);
});
it("signed positive-only waveform does not fabricate a negative half, and EOF is silence", async () => {
  const data = await computeWaveform(pcmWav(1, 100, () => 16384), { startSeconds: 0, pixelsPerSecond: 675, width: 32 }) as WaveformPixels;
  expect(data.minima.every(value => value === 0)).toBe(true); expect(data.maxima[0]).toBe(.5);
  expect(data.maxima[3]).toBe(0); expect(data.positiveMeans[1]).toBeLessThan(.5);
});
it("uses the same actual procedural samples for generated noise and averages", () => {
  const view = { startSeconds: 0, pixelsPerSecond: 675, width: 1 };
  const result = computeSyntheticWaveform("noise", view);
  const count = Math.floor(44100 / 675), values = Array.from({ length: count }, (_, i) => dummyNoiseSample(i));
  expect(result.minima[0]).toBe(Math.min(0, ...values)); expect(result.maxima[0]).toBe(Math.max(0, ...values));
  expect(result.positiveMeans[0]).toBeCloseTo(values.filter(v => v > 0).reduce((a, b) => a + b, 0) / (44100 / 675), 7);
  expect(computeSyntheticWaveform("blank", view).maxima[0]).toBe(0);
});
