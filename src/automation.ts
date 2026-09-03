import { type SubtitleDoc } from "./cue";

export interface AutomationResult {
  doc: SubtitleDoc;
  message?: string;
}

export interface StoredAutomationExtension {
  name: string;
  code: string;
  autoload: boolean;
  language?: "javascript" | "lua";
  updatedAt: number;
}

const REGISTRY_KEY = "aegisub-web.automation-registry.v1";

export function listAutomationExtensions(): StoredAutomationExtension[] {
  try {
    const value = JSON.parse(localStorage.getItem(REGISTRY_KEY) ?? "[]") as StoredAutomationExtension[];
    return Array.isArray(value) ? value.filter((entry) => entry && typeof entry.name === "string" && typeof entry.code === "string") : [];
  } catch {
    return [];
  }
}

export function saveAutomationExtension(extension: StoredAutomationExtension): void {
  const list = listAutomationExtensions().filter((entry) => entry.name !== extension.name);
  list.push(extension);
  localStorage.setItem(REGISTRY_KEY, JSON.stringify(list));
}

export function removeAutomationExtension(name: string): void {
  localStorage.setItem(REGISTRY_KEY, JSON.stringify(listAutomationExtensions().filter((entry) => entry.name !== name)));
}

const WORKER_SOURCE = String.raw`
self.onmessage = async (event) => {
  try {
    const { code, doc } = event.data;
    const module = { exports: {} };
    const exports = module.exports;
    const factory = new Function("module", "exports", "'use strict';\n" + code);
    factory(module, exports);
    const candidate = module.exports.run || exports.run || module.exports.default || module.exports;
    if (typeof candidate !== "function") {
      throw new Error("The extension must export run(doc, api).");
    }
    const result = await candidate(doc, {
      version: "2.2.0",
      visibleText(text) {
        return String(text || "")
          .replace(/<[^>]*>/g, "")
          .replace(/\{[^}]*\}/g, "")
          .replace(/\\[Nnh]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      },
    });
    self.postMessage({ ok: true, value: result || doc });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
`;

function isSubtitleDoc(value: unknown): value is SubtitleDoc {
  if (!value || typeof value !== "object") return false;
  const doc = value as Partial<SubtitleDoc>;
  return typeof doc.format === "string" && Array.isArray(doc.cues) && doc.cues.every((cue) =>
    !!cue && typeof cue.id === "string" && typeof cue.startMs === "number"
      && typeof cue.endMs === "number" && typeof cue.text === "string",
  );
}

/** Run an explicitly selected Aegisub Web JavaScript extension in an isolated worker. */
export function runAutomationExtension(
  code: string,
  source: SubtitleDoc,
  timeoutMs = 15_000,
): Promise<AutomationResult> {
  const blobUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
  const worker = new Worker(blobUrl);
  return new Promise((resolve, reject) => {
    const finish = (): void => {
      window.clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(blobUrl);
    };
    const timer = window.setTimeout(() => {
      finish();
      reject(new Error("Extension timed out."));
    }, timeoutMs);
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || "Extension worker failed."));
    };
    worker.onmessage = (event: MessageEvent) => {
      finish();
      if (!event.data?.ok) {
        reject(new Error(event.data?.error || "Extension failed."));
        return;
      }
      const value = event.data.value;
      const doc = isSubtitleDoc(value?.doc) ? value.doc : isSubtitleDoc(value) ? value : null;
      if (!doc) {
        reject(new Error("Extension returned an invalid subtitle document."));
        return;
      }
      resolve({ doc, message: typeof value?.message === "string" ? value.message : undefined });
    };
    worker.postMessage({ code, doc: structuredClone(source) });
  });
}
