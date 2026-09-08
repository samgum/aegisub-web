import { expect, it, vi } from "vitest";
import { dummyNoiseSample } from "./dummy-audio";
import type { SpectrumData } from "./spectrum-core";

it("procedural spectrum matches the identical file PCM and silence stays zero", async () => {
  let result: SpectrumData | null = null;
  const errors: string[] = [];
  const worker = { onmessage: null as ((event: { data: unknown }) => Promise<void>) | null,
    postMessage: (message: any) => { if (message.type === "done") result = message.spectrum; if (message.type === "error") errors.push(message.message); } };
  vi.stubGlobal("self", worker);
  try {
    await import("./spectrum.worker");
    const rate = 44100, frames = rate * 2, bytes = Buffer.alloc(44 + frames * 2);
    bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(frames * 2, 40);
    for (let i = 0; i < frames; i++) bytes.writeInt16LE(Math.round(dummyNoiseSample(i) * 32768), 44 + i * 2);
    const viewport = { startPixel: 5, width: 20, pixelsPerSecond: 50, quality: 1 }, libavBase = "https://example.test/libav/";
    await worker.onmessage!({ data: { file: new Blob([bytes]), viewport, libavBase } });
    expect(errors).toEqual([]); const fileData = result! as SpectrumData;
    await worker.onmessage!({ data: { file: null, synthetic: "noise", viewport, libavBase } });
    expect(errors).toEqual([]); expect((result! as SpectrumData).values).toEqual(fileData.values);
    expect((result! as SpectrumData).values.some(value => value > 0)).toBe(true);
    await worker.onmessage!({ data: { file: null, synthetic: "blank", viewport, libavBase } });
    expect(errors).toEqual([]); expect((result! as SpectrumData).values.every(value => value === 0)).toBe(true);
  } finally { vi.unstubAllGlobals(); }
});
