import type { AudioClipRange } from "./audio-clip-pcm";

export function exportAudioClip(file: Blob, range: AudioClipRange, signal: AbortSignal, onProgress: (ratio: number) => void): Promise<Blob> {
  signal.throwIfAborted();
  const worker = new Worker(new URL("./audio-clip.worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    const close = () => { signal.removeEventListener("abort", abort); worker.terminate(); };
    const abort = () => { close(); reject(new DOMException("音频导出已取消。", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") onProgress(data.ratio);
      else if (data.type === "done") { close(); resolve(data.blob); }
      else if (data.type === "error") { close(); reject(new Error(data.message)); }
    };
    worker.onerror = event => { close(); reject(new Error(event.message)); };
    try { worker.postMessage({ file, range, libavBase: new URL("libav/", document.baseURI).href }); } catch (error) { close(); reject(error); }
  });
}
