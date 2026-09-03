// Vendored from hikashop-nicolas/localml (MIT), commit
// f05924cba88680afe79306e66bf223cfca672016.

type ProgressEvent = {
  status?: string;
  name?: string;
  progress?: number;
  file?: string;
  loaded?: number;
  total?: number;
};

const ctx = self as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
};

export const post = (message: unknown): void => ctx.postMessage(message);
export const onMessage = (handler: (event: MessageEvent) => void): void => {
  ctx.onmessage = handler;
};

export const hasWebGpu = async (): Promise<boolean> => {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
};

export const downloadProgress = (): ((progress: ProgressEvent) => void) => {
  const files = new Map<string, { loaded: number; total: number; done: boolean }>();
  const emit = (): void => {
    let sum = 0;
    for (const file of files.values()) {
      sum += file.done ? 1 : file.total > 0 ? file.loaded / file.total : 0;
    }
    post({ type: "progress", stage: "download", ratio: files.size ? sum / files.size : 0 });
  };
  return (progress) => {
    if (!progress.file) return;
    if (progress.status === "initiate") {
      if (!files.has(progress.file)) files.set(progress.file, { loaded: 0, total: 0, done: false });
    } else if (progress.status === "progress") {
      const file = files.get(progress.file) ?? { loaded: 0, total: 0, done: false };
      if (typeof progress.loaded === "number") file.loaded = progress.loaded;
      if (typeof progress.total === "number") file.total = progress.total;
      files.set(progress.file, file);
    } else if (progress.status === "done") {
      const file = files.get(progress.file);
      if (file) {
        file.done = true;
        file.loaded = file.total || file.loaded;
      } else {
        files.set(progress.file, { loaded: 1, total: 1, done: true });
      }
    } else {
      return;
    }
    emit();
  };
};
