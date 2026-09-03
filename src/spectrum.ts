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
  const worker = new Worker(new URL("./spectrum.worker.ts", import.meta.url), { type: "module" });
  const copy = samples.slice();
  const done = new Promise<SpectrumData>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent) => {
      if (event.data.type === "progress") onProgress?.(event.data.ratio);
      if (event.data.type === "done") {
        resolve({ values: new Uint8Array(event.data.values), columns: event.data.columns, bins: event.data.bins, columnsPerSecond: event.data.columnsPerSecond });
        worker.terminate();
      }
    };
    worker.onerror = (event) => {
      reject(new Error(event.message || "Spectrum worker failed"));
      worker.terminate();
    };
  });
  worker.postMessage({ samples: copy.buffer, sampleRate, columnsPerSecond: 20, bins: 72 }, [copy.buffer]);
  return { done, cancel: () => worker.terminate() };
}
