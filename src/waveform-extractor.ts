import type { WaveformOverview, WaveformPixels, WaveformViewport } from "./waveform-data";
import type { DummyAudioKind } from "./dummy-audio";

export async function extractStreamedWaveform(file: Blob, signal: AbortSignal, onProgress: (ratio: number) => void): Promise<WaveformOverview> {
  return await runWaveform(file, signal, onProgress) as WaveformOverview;
}
export async function extractWaveformViewport(file: Blob | null, viewport: WaveformViewport, signal: AbortSignal, synthetic?: DummyAudioKind): Promise<WaveformPixels> {
  return await runWaveform(file, signal, () => undefined, viewport, synthetic) as WaveformPixels;
}
function runWaveform(file: Blob | null, signal: AbortSignal, onProgress: (ratio: number) => void, viewport?: WaveformViewport, synthetic?: DummyAudioKind): Promise<WaveformOverview | WaveformPixels> {
  signal.throwIfAborted();
  const worker = new Worker(new URL("./waveform-extractor.worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    const close = () => { signal.removeEventListener("abort", abort); worker.terminate(); };
    const abort = () => { close(); reject(new DOMException("波形计算已取消。", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") onProgress(data.ratio);
      else if (data.type === "done") { close(); resolve(data.result); }
      else if (data.type === "error") { close(); reject(new Error(data.message)); }
    };
    worker.onerror = event => { close(); reject(new Error(event.message)); };
    worker.postMessage({ file, viewport, synthetic, libavBase: new URL("libav/", document.baseURI).href });
  });
}
