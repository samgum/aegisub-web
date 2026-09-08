import { describe, expect, it, vi, afterEach } from "vitest";
import { blankCue } from "./cue";
import { clipSampleRange, downmixPcm16, floatToPcm16, monoWavHeader, pcm16Reader, PcmClipWriter, selectedAudioClipRange } from "./audio-clip-pcm";
import { streamAudioClip } from "./audio-clip-stream";
import { exportAudioClip } from "./audio-clip";

function wav(rate: number, channels: number, bits: number, samples: number[], float = false): Blob {
  // Independent fixture encoder; not the production header/conversion code.
  const bytes = new Uint8Array(44 + samples.length * bits / 8), view = new DataView(bytes.buffer);
  for (const [offset, text] of [[0, "RIFF"], [8, "WAVEfmt "], [36, "data"]] as const) bytes.set(new TextEncoder().encode(text), offset);
  view.setUint32(4, bytes.length - 8, true); view.setUint32(16, 16, true);
  view.setUint16(20, float ? 3 : 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * channels * bits / 8, true);
  view.setUint16(32, channels * bits / 8, true); view.setUint16(34, bits, true); view.setUint32(40, bytes.length - 44, true);
  samples.forEach((value, i) => {
    const offset = 44 + i * bits / 8;
    if (float) { if (bits === 64) view.setFloat64(offset, value, true); else view.setFloat32(offset, value, true); }
    else for (let j = 0; j < bits / 8; j++) bytes[offset + j] = value >> (j * 8);
  });
  return new Blob([bytes], { type: "audio/wav" });
}
async function pcm(blob: Blob): Promise<number[]> { return [...new Int16Array((await blob.arrayBuffer()).slice(44))]; }

it("exports the saved selection's full span, ASS centiseconds, and not just the active row", () => {
  const cues = [blankCue(), blankCue(), blankCue()].map((cue, i) => ({ ...cue, id: String(i), startMs: i * 1000 + 15, endMs: i * 1000 + 105 }));
  expect(selectedAudioClipRange(cues, new Set(["0", "2"]), true)).toEqual({ startMs: 20, endMs: 2110 });
  expect(selectedAudioClipRange(cues, new Set(["0", "2"]), false)).toEqual({ startMs: 15, endMs: 2105 });
  expect(selectedAudioClipRange(cues, new Set(), true)).toBeNull();
});

it("uses native ceiling boundaries, clamped EOF, and a valid empty WAV", async () => {
  expect(clipSampleRange({ startMs: 1, endMs: 2 }, 44100, 44100)).toEqual({ start: 45, end: 89 });
  expect(clipSampleRange({ startMs: 1000, endMs: 3000 }, 44100, 44101)).toEqual({ start: 44100, end: 44101 });
  for (const range of [{ startMs: 12, endMs: 2 }, { startMs: 5000, endMs: 6000 }]) {
    const result = await streamAudioClip(wav(44100, 1, 16, [200, 300]), range);
    expect(result.size).toBe(44); expect(await pcm(result)).toEqual([]);
  }
  expect(() => monoWavHeader(48000, 0x80000000)).toThrow("4 GiB");
  expect(() => new PcmClipWriter(0, 100, { startMs: 0, endMs: 1 })).toThrow();
});

it("rounds each float channel before the native integer downmix and saturates invalid amplitudes", () => {
  expect([-1, -.5, -.00002, 0, .00002, .5, 1, 2, -2, NaN].map(floatToPcm16)).toEqual([-32768, -16384, -1, 0, 1, 16384, 32767, 32767, -32768, 0]);
  const data = new Float32Array([.00002, .00005, -.00002, -.00005]);
  const reader = pcm16Reader("pcm-f32")!;
  expect([...downmixPcm16(new DataView(data.buffer), 2, 2, reader.read, reader.bytes)]).toEqual([1, -1]);
});

describe("packet PCM keeps bits through the native provider conversion", () => {
  it.each([
    { bits: 8, values: [0, 255, 128, 129], expected: [-128, 128] },
    { bits: 16, values: [32767, -1000, -32768, -1, 1, 2, -1, -2], expected: [15883, -16384, 1, -1] },
    { bits: 24, values: [-1, -257, 0x7fffff, -0x800000], expected: [-1, 0] },
    { bits: 32, values: [-1, -65537, 0x7fffffff, -0x80000000], expected: [-1, 0] },
    { bits: 32, float: true, values: [-.5, -.25, .5, .25], expected: [-12288, 12288] },
    { bits: 64, float: true, values: [-.5, -.25, .5, .25], expected: [-12288, 12288] },
  ])("$bits bit, float=$float", async ({ bits, values, expected, float }) => {
    const blob = await streamAudioClip(wav(48000, 2, bits, values, float), { startMs: 0, endMs: 100 });
    expect(await pcm(blob)).toEqual(expected);
    const header = new DataView(await blob.arrayBuffer());
    expect(header.getUint16(20, true)).toBe(1); expect(header.getUint16(22, true)).toBe(1);
    expect(header.getUint32(24, true)).toBe(48000); expect(header.getUint16(34, true)).toBe(16);
    expect(header.getUint32(4, true) + 8).toBe(blob.size);
  });

  it("reads big-endian 24-bit data without rounding sign bits", () => {
    const reader = pcm16Reader("pcm-s24be")!;
    const bytes = new Uint8Array([255, 255, 255, 128, 0, 0, 127, 255, 255]);
    expect([...downmixPcm16(new DataView(bytes.buffer), 1, 3, reader.read, reader.bytes)]).toEqual([-1, -32768, 32767]);
  });

  it("does not silently truncate the one-sample positive or negative peaks", async () => {
    const values = Array.from({ length: 65536 }, (_, i) => i - 32768);
    expect(await pcm(await streamAudioClip(wav(96000, 1, 16, values), { startMs: 0, endMs: 1000 }))).toEqual(values);
  });
});

it("performs every low-rate doubling with integer midpoints, including packet seams and EOF", async () => {
  const writer = new PcmClipWriter(8000, 3, { startMs: 0, endMs: 10 });
  writer.append(0, new Int16Array([-3])); writer.append(1, new Int16Array([8])); writer.append(2, new Int16Array([-5]));
  expect(writer.rate).toBe(32000);
  expect(await pcm(writer.finish())).toEqual([-3, 0, 2, 5, 8, 4, 1, -2, -5, -3, -2, -1]);
  const blob = await streamAudioClip(wav(22050, 1, 16, [-3, 8, -5]), { startMs: 0, endMs: 1 });
  expect(await pcm(blob)).toEqual([-3, 2, 8, 1, -5, -2]);
});

it("clips an odd interpolated start sample and includes only the required end lookahead", async () => {
  const source = Int16Array.from({ length: 800 }, (_, i) => (i * 379) % 64000 - 32000);
  const writer = new PcmClipWriter(22050, source.length, { startMs: 10, endMs: 20 });
  expect(writer.readStart).toBe(220); expect(writer.readEnd).toBe(442);
  writer.append(0, source.subarray(0, 221)); writer.append(221, source.subarray(221));
  const expected = Array.from({ length: 441 }, (_, i) => { const n = i + 441; return n % 2 ? Math.trunc((source[n >> 1] + source[(n >> 1) + 1]) / 2) : source[n >> 1]; });
  expect(await pcm(writer.finish())).toEqual(expected);
});

it("zero-fills gaps without repeating overlapping samples", async () => {
  const writer = new PcmClipWriter(48000, 6, { startMs: 0, endMs: 1 });
  writer.append(-1, new Int16Array([99, 1, 2]));
  writer.append(1, new Int16Array([999, 3]));
  writer.append(4, new Int16Array([5]));
  expect(await pcm(writer.finish())).toEqual([1, 2, 3, 0, 5, 0]);
});

it("seeks into a large WAV without reading the whole source or allocating full-track PCM", async () => {
  const seconds = 600, rate = 48000, channels = 2;
  const small = wav(rate, channels, 16, [30000, -10000]);
  const header = new Uint8Array((await small.arrayBuffer()).slice(0, 44)), view = new DataView(header.buffer);
  const dataBytes = seconds * rate * channels * 2;
  view.setUint32(4, dataBytes + 36, true); view.setUint32(40, dataBytes, true);
  const chunk = new Int16Array(rate * channels);
  for (let i = 0; i < chunk.length; i += 2) { chunk[i] = 30000; chunk[i + 1] = -10000; }
  let requested = 0;
  class WatchedBlob extends Blob {
    override async arrayBuffer(): Promise<ArrayBuffer> { throw new Error("whole-file read forbidden"); }
    override slice(start?: number, end?: number, contentType?: string): Blob {
      const result = super.slice(start, end, contentType);
      // A suffix slice is a lazy view, not a read. Count consumed stream bytes (or
      // actual arrayBuffer bytes on WebKit), not the size of that unconsumed view.
      result.arrayBuffer = async () => { requested += result.size; return Blob.prototype.arrayBuffer.call(result); };
      result.stream = () => {
        const reader = Blob.prototype.stream.call(result).getReader();
        return new ReadableStream({ async pull(controller) {
          const next = await reader.read();
          if (next.done) controller.close();
          else { requested += next.value.length; controller.enqueue(next.value); }
        }, cancel: () => reader.cancel() });
      };
      return result;
    }
  }
  const file = new WatchedBlob([header, ...Array<BlobPart>(seconds).fill(new Blob([chunk]))], { type: "audio/wav" });
  expect(file.size).toBeGreaterThan(100 * 1024 * 1024);
  const result = await streamAudioClip(file, { startMs: 500001, endMs: 500011 });
  expect(await pcm(result)).toEqual(Array(480).fill(10000));
  expect(requested).toBeLessThan(4 * 1024 * 1024);
}, 10000);

describe("export worker ownership", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("terminates on cancellation, removes its listener and ignores unrelated waveform state", async () => {
    vi.stubGlobal("document", { baseURI: "https://example.test/aegisub-web/" });
    let instance: any;
    class WorkerStub { terminate = vi.fn(); postMessage = vi.fn(); constructor() { instance = this; } }
    vi.stubGlobal("Worker", WorkerStub);
    const ac = new AbortController(), remove = vi.spyOn(ac.signal, "removeEventListener");
    const promise = exportAudioClip(new Blob(), { startMs: 0, endMs: 1 }, ac.signal, () => undefined);
    ac.abort(); await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(instance.terminate).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledOnce();
  });
  it("terminates on completion/error, and does not spawn for an already-aborted request", async () => {
    vi.stubGlobal("document", { baseURI: "https://example.test/aegisub-web/" });
    const workers: any[] = [];
    class WorkerStub { terminate = vi.fn(); postMessage = vi.fn(); constructor() { workers.push(this); } }
    vi.stubGlobal("Worker", WorkerStub);
    const ac = new AbortController(), progress = vi.fn(), blob = new Blob(["result"]);
    const result = exportAudioClip(new Blob(), { startMs: 0, endMs: 1 }, ac.signal, progress);
    workers[0].onmessage({ data: { type: "progress", ratio: .5 } });
    workers[0].onmessage({ data: { type: "done", blob } });
    expect(await result).toBe(blob); expect(progress).toHaveBeenCalledWith(.5); expect(workers[0].terminate).toHaveBeenCalledOnce();
    const failure = exportAudioClip(new Blob(), { startMs: 0, endMs: 1 }, ac.signal, progress);
    workers[1].onmessage({ data: { type: "error", message: "broken audio" } });
    await expect(failure).rejects.toThrow("broken audio"); expect(workers[1].terminate).toHaveBeenCalledOnce();
    ac.abort(); expect(() => exportAudioClip(new Blob(), { startMs: 0, endMs: 1 }, ac.signal, progress)).toThrow();
    expect(workers).toHaveLength(2);
  });
});
