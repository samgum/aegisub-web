export function extractStreamedWaveform(file: Blob, signal: AbortSignal, onProgress: (ratio: number) => void): Promise<{ peaks: Float32Array; peaksPerSec: number }> {
  signal.throwIfAborted();
  const worker = new Worker(new URL("./waveform-extractor.worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    const close = () => { signal.removeEventListener("abort", abort); worker.terminate(); };
    const abort = () => { close(); reject(new DOMException("波形计算已取消。", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") onProgress(data.ratio);
      else if (data.type === "done") { close(); resolve({ peaks: new Float32Array(data.peaks), peaksPerSec: data.peaksPerSec }); }
      else if (data.type === "error") { close(); reject(new Error(data.message)); }
    };
    worker.onerror = event => { close(); reject(new Error(event.message)); };
    worker.postMessage({ file });
  });
}
