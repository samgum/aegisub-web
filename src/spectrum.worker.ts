import { registerFlacDecoder } from "./flac-decoder";
import { registerClipDolbyDecoder } from "./audio-clip-dolby";
import { streamSpectrum } from "./spectrum-stream";
import type { SpectrumViewport } from "./spectrum-core";
import type { DummyAudioKind } from "./dummy-audio";

registerFlacDecoder();
const worker = self as unknown as { onmessage: ((event: MessageEvent<{ file: Blob | null; viewport: SpectrumViewport; synthetic?: DummyAudioKind; libavBase: string }>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };
worker.onmessage = async ({ data }) => {
  try {
    registerClipDolbyDecoder(data.libavBase);
    const spectrum = await streamSpectrum(data.file, data.viewport, data.synthetic, ratio => worker.postMessage({ type: "progress", ratio }));
    worker.postMessage({ type: "done", spectrum }, [spectrum.values.buffer, spectrum.pixelColumns.buffer, spectrum.blockIndexes.buffer]);
  } catch (error) { worker.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) }); }
};
