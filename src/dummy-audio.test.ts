import { expect, it } from "vitest";
import { DUMMY_AUDIO_RATE, DummyAudioSource, dummyNoiseSample } from "./dummy-audio";
it("has native dummy duration/rate and silent PCM without an encoder", () => {
  const source = new DummyAudioSource("blank");
  expect(source.duration).toBe(9000); expect(source.sampleRate).toBe(44100);
  expect([...source.samples(123, 4)]).toEqual([0, 0, 0, 0]); expect(source.peak(0, 20)).toBe(0);
});
it("generates bounded, zero-mean, non-silent noise reproducibly across seeks", () => {
  const source = new DummyAudioSource("noise"), samples = source.samples(300 * DUMMY_AUDIO_RATE, 10000);
  expect(Math.max(...samples)).toBeLessThanOrEqual(5000 / 32768);
  expect(Math.min(...samples)).toBeGreaterThanOrEqual(-5000 / 32768);
  expect(Math.abs(samples.reduce((sum, value) => sum + value, 0) / samples.length)).toBeLessThan(.003);
  expect(source.peak(300, 301)).toBeGreaterThan(.1);
  expect(samples[0]).toBe(dummyNoiseSample(300 * DUMMY_AUDIO_RATE));
});
it("exports source-rate mono PCM16 rather than an ASR-resampled copy", async () => {
  const source = new DummyAudioSource("noise"), bytes = await (await source.wavClip(1, 1.1)).arrayBuffer();
  const view = new DataView(bytes);
  expect(view.getUint32(24, true)).toBe(44100); expect(view.getUint16(22, true)).toBe(1);
  expect(view.getUint16(34, true)).toBe(16); expect(view.getUint32(40, true)).toBe(4410 * 2);
  expect(view.getInt16(44, true)).toBe(Math.round(dummyNoiseSample(44100) * 32768));
});
it("shares ceiling boundaries with file export and cancels without destroying the source", async () => {
  const source = new DummyAudioSource("noise"), ac = new AbortController();
  const bytes = new DataView(await (await source.wavClip(.001, .002)).arrayBuffer());
  expect(bytes.getUint32(40, true)).toBe(44 * 2);
  expect(bytes.getInt16(44, true)).toBe(Math.round(dummyNoiseSample(45) * 32768));
  const result = source.wavClip(0, 9000, () => ac.abort(), ac.signal);
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  expect(source.samples(45, 1)[0]).toBe(dummyNoiseSample(45));
});
