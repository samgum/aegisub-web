import { registerFlacDecoder } from "./flac-decoder";
import { registerClipDolbyDecoder } from "./audio-clip-dolby";
import { computeWaveform, computeSyntheticWaveform, type WaveformViewport } from "./waveform-data";
import type { DummyAudioKind } from "./dummy-audio";

registerFlacDecoder();
const worker = self as unknown as { onmessage: ((event: MessageEvent<{ file: Blob | null; viewport?: WaveformViewport; synthetic?: DummyAudioKind; libavBase: string }>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };
worker.onmessage = async ({ data }) => {
  try {
    registerClipDolbyDecoder(data.libavBase);
    const result = data.synthetic && data.viewport ? computeSyntheticWaveform(data.synthetic, data.viewport) : await computeWaveform(data.file!, data.viewport, ratio => worker.postMessage({ type: "progress", ratio }));
    const transfer = Object.values(result).filter((value): value is Float32Array => value instanceof Float32Array).map(value => value.buffer);
    worker.postMessage({ type: "done", result }, transfer);
  } catch (error) { worker.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) }); }
};
