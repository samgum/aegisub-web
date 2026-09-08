export interface SpectrumData {
  values: Uint8Array;
  columns: number;
  bins: number;
  columnsPerSecond: number;
}

export function computeSpectrum(
  samples: Float32Array,
  sampleRate = 16000,
  onProgress?: (ratio: number) => void,
): { done: Promise<SpectrumData>; cancel(): void } {
  const copy = samples.slice();
  return runSpectrum({ samples: copy.buffer, sampleRate, columnsPerSecond: 20, bins: 72 }, onProgress);
}

export function computeDummySpectrum(kind: "blank" | "noise", duration: number, sampleRate: number, onProgress?: (ratio: number) => void): { done: Promise<SpectrumData>; cancel(): void } {
  return runSpectrum({ generated: { kind, sampleCount: Math.ceil(duration * sampleRate) }, sampleRate, columnsPerSecond: 20, bins: 72 }, onProgress);
}

function runSpectrum(request: { samples?: ArrayBuffer; generated?: { kind: "blank" | "noise"; sampleCount: number }; sampleRate: number; columnsPerSecond: number; bins: number }, onProgress?: (ratio: number) => void) {
  const worker = new Worker(new URL("./spectrum.worker.ts", import.meta.url), { type: "module" });
  let rejectRun!: (reason: unknown) => void;
  let settled = false;
  const done = new Promise<SpectrumData>((resolve, reject) => {
    rejectRun = reject;
    worker.onmessage = (event: MessageEvent) => {
      if (event.data.type === "progress") onProgress?.(event.data.ratio);
      if (event.data.type === "done") {
        settled = true;
        resolve({ values: new Uint8Array(event.data.values), columns: event.data.columns, bins: event.data.bins, columnsPerSecond: event.data.columnsPerSecond });
        worker.terminate();
      }
    };
    worker.onerror = (event) => {
      settled = true;
      reject(new Error(event.message || "Spectrum worker failed"));
      worker.terminate();
    };
  });
  worker.postMessage(request, request.samples ? [request.samples] : []);
  return { done, cancel: () => { if (!settled) { settled = true; worker.terminate(); rejectRun(new DOMException("频谱计算已取消。", "AbortError")); } } };
}
