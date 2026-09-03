// Vendored from hikashop-nicolas/localml (MIT), commit
// f05924cba88680afe79306e66bf223cfca672016.
import { translateModel, mtLangCode, type TranscribeProgress } from "./backend";

export {
  TRANSLATE_MODELS,
  DEFAULT_TRANSLATE_MODEL,
  translateModel,
  TRANSLATE_LANGS,
  mtLangCode,
  type TranslateModelInfo,
  type TranscribeProgress,
  type DtypeSpec,
} from "./backend";

export interface TranslateRun {
  cancel(): void;
  pause(): void;
  resume(): void;
  done: Promise<{ stopped: boolean }>;
}

export interface TranslateOptions {
  model: string;
  srcLang: string;
  tgtLang: string;
  device?: "webgpu" | "wasm";
}

export interface TranslateCallbacks {
  onProgress?: (progress: TranscribeProgress) => void;
  onPartial?: (start: number, texts: string[]) => void;
  onDevice?: (device: "webgpu" | "wasm") => void;
}

export function runTranslate(
  texts: string[],
  options: TranslateOptions,
  callbacks: TranslateCallbacks = {},
): TranslateRun {
  const info = translateModel(options.model);
  const scheme = info?.scheme ?? "iso";
  const worker = new Worker(new URL("./translate.worker.ts", import.meta.url), { type: "module" });

  const done = new Promise<{ stopped: boolean }>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.type) {
        case "progress":
          callbacks.onProgress?.({ stage: message.stage, ratio: message.ratio, file: message.file });
          break;
        case "partial":
          callbacks.onPartial?.(message.start, message.texts);
          break;
        case "device":
          callbacks.onDevice?.(message.device);
          break;
        case "done":
          resolve({ stopped: !!message.stopped });
          worker.terminate();
          break;
        case "error":
          reject(new Error(message.message));
          worker.terminate();
          break;
      }
    };
    worker.onerror = (event) => {
      reject(new Error(event.message || "worker error"));
      worker.terminate();
    };
  });

  worker.postMessage({
    type: "run",
    texts,
    model: options.model,
    srcLang: mtLangCode(scheme, options.srcLang),
    tgtLang: mtLangCode(scheme, options.tgtLang),
    device: options.device,
    dtype: info?.dtype,
  });

  return {
    cancel: () => worker.terminate(),
    pause: () => worker.postMessage({ type: "pause" }),
    resume: () => worker.postMessage({ type: "resume" }),
    done,
  };
}
