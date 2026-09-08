import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readMatroskaAudioTiming } from "./matroska-audio-timing";

it("reads actual FFmpeg codec delay without scanning audio/video packets", async () => {
  const source = new Blob([readFileSync("test-corpus/audio-clip-ac3.mka")]);
  let bytes = 0;
  class Watched extends Blob {
    override slice(start?: number, end?: number, type?: string): Blob { const result = super.slice(start, end, type); bytes += result.size; return result; }
    override async arrayBuffer(): Promise<ArrayBuffer> { throw new Error("whole file read"); }
  }
  const result = await readMatroskaAudioTiming(new Watched([source]), 1);
  expect(Math.round(result.delay * 48000)).toBe(256); expect(result.preroll).toBe(0);
  expect(bytes).toBeLessThan(1024);
});

it("returns no Matroska adjustment for WAV and rejects malformed/unknown track data", async () => {
  expect(await readMatroskaAudioTiming(new Blob(["RIFF1234"]), 1)).toEqual({ delay: 0, preroll: 0 });
  await expect(readMatroskaAudioTiming(new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x8f, 0])]), 1)).rejects.toThrow("时间信息不完整");
  await expect(readMatroskaAudioTiming(new Blob([readFileSync("test-corpus/audio-clip-ac3.mka")]), 999)).rejects.toThrow("时间信息不完整");
});
