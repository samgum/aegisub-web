import { expect, it, vi } from "vitest";
import { dummyNoiseSample } from "./dummy-audio";

it("procedural spectrum matches FFT of the identical PCM and silence stays zero", async () => {
  let result: Uint8Array | null = null;
  const worker = { onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage: (message: any) => { if (message.type === "done") result = new Uint8Array(message.values); } };
  vi.stubGlobal("self", worker);
  try {
    await import("./spectrum.worker");
    const sampleRate = 44100, samples = new Float32Array(sampleRate);
    for (let i = 0; i < samples.length; i++) samples[i] = dummyNoiseSample(i);
    worker.onmessage!({ data: { samples: samples.buffer, sampleRate, columnsPerSecond: 20, bins: 72 } });
    const decoded = result!;
    worker.onmessage!({ data: { generated: { kind: "noise", sampleCount: sampleRate }, sampleRate, columnsPerSecond: 20, bins: 72 } });
    expect(result).toEqual(decoded);
    expect([...result!].some(value => value > 0)).toBe(true);
    worker.onmessage!({ data: { generated: { kind: "blank", sampleCount: sampleRate }, sampleRate, columnsPerSecond: 20, bins: 72 } });
    expect([...result!].every(value => value === 0)).toBe(true);
  } finally { vi.unstubAllGlobals(); }
});
