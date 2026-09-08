import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { NativeSpectrumFFT, spectrumParameters, spectrumPalette, spectrumRows, spectrumRowValue } from "./spectrum-core";
import { SpectrumAccumulator, streamSpectrum } from "./spectrum-stream";
const oracle = JSON.parse(readFileSync("test-corpus/native-spectrum-oracle.json", "utf8")) as { powers: { rate: number; quality: number; signal: number; fftSize: number; hop: number; values: number[] }[]; colours: number[][]; rows: { rate: number; height: number; curve: number; rows: number[][] }[] };
it.each(oracle.powers)("matches original native FFT: $rate Hz, quality $quality, signal $signal", reference => {
  const parameters = spectrumParameters(reference.rate, reference.quality);
  expect(parameters.fftSize).toBe(reference.fftSize); expect(parameters.hop).toBe(reference.hop);
  const input = Int16Array.from({ length: parameters.fftSize }, (_, i) => reference.signal ? (i % 4 === 1 ? 2000 : i % 4 === 3 ? -2000 : 0) : (i * 237 + (i % 37) * 17) % 5001 - 2500);
  const actual = new NativeSpectrumFFT(parameters).power(input);
  expect(actual.length).toBe(reference.values.length);
  expect(Math.max(...actual.map((value, bin) => Math.abs(value - reference.values[bin])))).toBeLessThan(.0001);
});
it("matches native Icy Blue RGB quantization for all rendering styles", () => {
  for (const [style, index, ...colour] of oracle.colours) expect([...spectrumPalette(style).slice(index * 3, index * 3 + 3)]).toEqual(colour);
});
it.each(oracle.rows)("matches the native row map: $rate Hz, height $height, curve $curve", reference => {
  const actual = spectrumRows(spectrumParameters(reference.rate), reference.height, reference.curve);
  reference.rows.forEach(([from, to, fraction, maximum], index) => {
    expect(actual[index].from).toBe(from); expect(actual[index].to).toBe(to); expect(actual[index].maximum).toBe(!!maximum);
    expect(actual[index].fraction).toBeCloseTo(fraction, 4);
  });
});
it("retains a 12 kHz signal, scales high-rate FFTs and excludes ultrasound/DC from display rows", () => {
  for (const rate of [48000, 96000]) {
    const parameters = spectrumParameters(rate), fft = new NativeSpectrumFFT(parameters);
    const pcm = Int16Array.from({ length: parameters.fftSize }, (_, i) => Math.round(Math.sin(2 * Math.PI * 12000 * i / rate) * 2000));
    const values = fft.power(pcm), peak = values.indexOf(Math.max(...values));
    expect(peak * rate / parameters.fftSize).toBe(12000); expect(values[peak]).toBeGreaterThan(.7);
    for (const curve of [0, 1, 2, 3, 4]) {
      const rows = spectrumRows(parameters, 240, curve);
      expect(rows.every(row => row.from >= 1 && row.to < parameters.storedBins)).toBe(true);
      expect(rows.every(row => Number.isFinite(spectrumRowValue(values, 0, row)))).toBe(true);
    }
  }
});
it("uses centered windows with zero padding, native hops and shared columns at high zoom", () => {
  const viewport = { startPixel: 0, width: 8, pixelsPerSecond: 675, quality: 1 };
  const accumulator = new SpectrumAccumulator(48000, 200, viewport);
  const bytes = new Uint8Array(400), view = new DataView(bytes.buffer);
  view.setInt16(0, 2000, true);
  for (let start = 0; start < 200; start += 37) accumulator.append(bytes.subarray(start * 2, Math.min(200, start + 37) * 2), start);
  const result = accumulator.finish();
  expect(result.columns).toBe(1); expect([...result.pixelColumns.slice(0, 4)]).toEqual([0, 0, 0, 0]);
  expect(result.pixelColumns[4]).toBe(-1);
  const expected = new Int16Array(1024); expected[512] = 2000;
  expect([...result.values]).toEqual([...new NativeSpectrumFFT(result.parameters).power(expected)]);
});
it("blank generated audio allocates only the requested viewport, not 150 minutes of PCM", async () => {
  const result = await streamSpectrum(null, { startPixel: 14000, pixelsPerSecond: 50, width: 640, quality: 1 }, "blank");
  expect(result.values.every(value => value === 0)).toBe(true);
  expect(result.values.byteLength).toBeLessThan(2 * 1024 * 1024);
  expect(result.parameters.sampleRate).toBe(44100);
});
it("sparse low-zoom windows have the same FFT as independent exact PCM windows", () => {
  const viewport = { startPixel: 0, width: 4, pixelsPerSecond: .5, quality: 1 };
  const accumulator = new SpectrumAccumulator(32000, 200000, viewport), p = accumulator.data.parameters;
  const source = (i: number) => i >= 0 && i < 200000 ? (i * 149) % 3001 - 1500 : 0;
  for (let start = 0; start < 200000; start += 8191) {
    const count = Math.min(8191, 200000 - start), bytes = new Uint8Array(count * 2), view = new DataView(bytes.buffer);
    for (let i = 0; i < count; i++) view.setInt16(i * 2, source(start + i), true);
    accumulator.append(bytes, start);
  }
  const data = accumulator.finish(), fft = new NativeSpectrumFFT(p);
  for (let column = 0; column < data.columns; column++) {
    const first = data.blockIndexes[column] * p.hop - p.fftSize / 2;
    const expected = fft.power(Int16Array.from({ length: p.fftSize }, (_, i) => source(first + i)));
    expect(data.values.subarray(column * data.bins, (column + 1) * data.bins)).toEqual(expected);
  }
});
