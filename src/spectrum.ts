import type { DummyAudioKind } from "./dummy-audio";
import type { SpectrumData, SpectrumViewport } from "./spectrum-core";
export type { SpectrumData, SpectrumViewport } from "./spectrum-core";

export function computeSpectrum(file: Blob | null, viewport: SpectrumViewport, synthetic?: DummyAudioKind, onProgress?: (ratio: number) => void): { done: Promise<SpectrumData>; cancel(): void } {
  const worker = new Worker(new URL("./spectrum.worker.ts", import.meta.url), { type: "module" });
  let rejectRun!: (reason: unknown) => void, settled = false;
  const done = new Promise<SpectrumData>((resolve, reject) => {
    rejectRun = reject;
    const fail = (error: Error) => { if (settled) return; settled = true; worker.terminate(); reject(error); };
    worker.onmessage = ({ data }) => {
      if (settled) return;
      if (data.type === "progress") onProgress?.(data.ratio);
      else if (data.type === "done") { settled = true; worker.terminate(); resolve(data.spectrum); }
      else if (data.type === "error") fail(new Error(data.message));
    };
    worker.onerror = event => fail(new Error(event.message || "频谱计算失败。"));
    try { worker.postMessage({ file, viewport, synthetic, libavBase: new URL("libav/", document.baseURI).href }); }
    catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
  });
  return { done, cancel: () => { if (!settled) { settled = true; worker.terminate(); rejectRun(new DOMException("频谱计算已取消。", "AbortError")); } } };
}
