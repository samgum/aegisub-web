import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { flacSampleToPcm16, registerFlacDecoder } from "./flac-decoder";
import { streamAudioClip } from "./audio-clip-stream";

it("recovers every signed 16-bit value from the libFLAC wrapper normalization", () => {
  for (let value = -32768; value <= 32767; value++) expect(flacSampleToPcm16(Math.fround(value / 32767), 16)).toBe(value);
});
it("keeps 8-bit levels and 24-bit signed high words instead of expanding float amplitude", () => {
  for (let value = -128; value <= 127; value++) expect(flacSampleToPcm16(Math.fround(value / 127), 8)).toBe(value * 256);
  for (const value of [-8388608, -8388607, -65537, -257, -256, -1, 0, 1, 255, 256, 65535, 8388606, 8388607]) {
    expect(flacSampleToPcm16(Math.fround(value / 8388607), 24)).toBe(value >> 8);
  }
});
it("decodes actual FLAC packets without AudioDecoder or an AudioContext and preserves oracle samples", async () => {
  // Node has neither browser decoder; this exercises the exact worker adapter,
  // dynamic WASM import, demuxed-frame API and source-rate WAV conversion.
  registerFlacDecoder();
  const reference = JSON.parse(readFileSync("test-corpus/audio-clip-oracle.json", "utf8")).find((row: { name: string }) => row.name === "tiny.flac");
  const file = new Blob([readFileSync("test-corpus/tiny.flac")]);
  const result = await streamAudioClip(file, { startMs: reference.startMs, endMs: reference.endMs });
  const bytes = new DataView(await result.arrayBuffer());
  expect(bytes.getUint32(24, true)).toBe(reference.rate); expect(bytes.getUint32(40, true)).toBe(reference.count * 2);
  for (const [offset, sample] of reference.points) expect(bytes.getInt16(44 + offset * 2, true)).toBe(sample);
});
it.each([16, 24])("%i-bit FLAC yields every signed PCM16 value exactly, without amplitude renormalization", async depth => {
  registerFlacDecoder();
  const file = new Blob([readFileSync(`test-corpus/audio-clip-depth${depth}.flac`)]);
  const output = new DataView(await (await streamAudioClip(file, { startMs: 0, endMs: 10000 })).arrayBuffer());
  expect(output.getUint32(40, true)).toBe(65536 * 2);
  for (let i = 0; i < 65536; i++) expect(output.getInt16(44 + i * 2, true)).toBe(i - 32768);
});
