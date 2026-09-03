// Vendored from hikashop-nicolas/localml (MIT), commit
// f05924cba88680afe79306e66bf223cfca672016.
import { pipeline, env } from "@huggingface/transformers";
import { post, onMessage, hasWebGpu, downloadProgress } from "./worker-common";

env.allowLocalModels = false;

type DtypeSpec = string | Record<string, string>;
interface RunMessage {
  type: "run";
  texts: string[];
  model: string;
  srcLang: string;
  tgtLang: string;
  device?: "webgpu" | "wasm";
  dtype?: { webgpu: DtypeSpec; wasm: DtypeSpec };
}

type Translator = (
  texts: string[],
  options: Record<string, unknown>,
) => Promise<{ translation_text: string }[] | { translation_text: string }>;

let cached: { key: string; fn: Translator } | null = null;
let paused = false;
let stopped = false;
let wake: (() => void) | null = null;

const waitWhilePaused = async (): Promise<void> => {
  while (paused && !stopped) await new Promise<void>((resolve) => (wake = resolve));
  wake = null;
};

async function getTranslator(
  model: string,
  device: "webgpu" | "wasm",
  dtypeSpec?: { webgpu: DtypeSpec; wasm: DtypeSpec },
): Promise<Translator> {
  const key = `${model}@${device}`;
  if (cached && cached.key === key) return cached.fn;
  const options = {
    device,
    dtype: dtypeSpec ? dtypeSpec[device] : "q8",
    progress_callback: downloadProgress(),
  };
  const fn = (await pipeline("translation", model, options as never)) as unknown as Translator;
  cached = { key, fn };
  return fn;
}

onMessage(async (event: MessageEvent) => {
  const message = event.data as { type: "run" | "pause" | "resume" | "stop" };
  if (message.type === "pause") {
    paused = true;
    return;
  }
  if (message.type === "resume") {
    paused = false;
    wake?.();
    return;
  }
  if (message.type === "stop") {
    stopped = true;
    paused = false;
    wake?.();
    return;
  }
  if (message.type !== "run") return;

  const run = event.data as RunMessage;
  try {
    let device: "webgpu" | "wasm" = run.device ?? ((await hasWebGpu()) ? "webgpu" : "wasm");
    let translate: Translator;
    try {
      translate = await getTranslator(run.model, device, run.dtype);
    } catch (gpuError) {
      if (device !== "webgpu") throw gpuError;
      device = "wasm";
      translate = await getTranslator(run.model, device, run.dtype);
    }
    post({ type: "device", device });

    const tokenizerOf = (fn: Translator) =>
      (fn as unknown as {
        tokenizer?: (text: string) => { input_ids?: { size?: number; dims?: number[] } };
      }).tokenizer;
    let tokenizer = tokenizerOf(translate);
    const capFor = (text: string): number => {
      let count = Math.ceil(text.length / 3) + 4;
      try {
        const ids = tokenizer?.(text).input_ids;
        const tokens = ids?.size ?? ids?.dims?.[ids.dims.length - 1];
        if (typeof tokens === "number" && tokens > 0) count = tokens;
      } catch {
        // Keep the character-based estimate.
      }
      return Math.min(220, Math.max(24, Math.round(count * 1.6) + 8));
    };

    const maxGpuRetries = 3;
    let gpuRetries = 0;
    for (let index = 0; index < run.texts.length; ) {
      await waitWhilePaused();
      if (stopped) break;
      try {
        const output = await translate([run.texts[index]], {
          src_lang: run.srcLang,
          tgt_lang: run.tgtLang,
          max_new_tokens: capFor(run.texts[index]),
          no_repeat_ngram_size: 3,
        });
        const results = Array.isArray(output) ? output : [output];
        post({ type: "partial", start: index, texts: [results[0].translation_text] });
        post({ type: "progress", stage: "translate", ratio: (index + 1) / run.texts.length });
        index += 1;
        gpuRetries = 0;
      } catch (runError) {
        if (device !== "webgpu") throw runError;
        if (gpuRetries < maxGpuRetries) {
          gpuRetries += 1;
          try {
            await new Promise((resolve) => setTimeout(resolve, 800));
            cached = null;
            translate = await getTranslator(run.model, "webgpu", run.dtype);
            tokenizer = tokenizerOf(translate);
            continue;
          } catch {
            // Fall through to the deterministic CPU backend.
          }
        }
        device = "wasm";
        cached = null;
        translate = await getTranslator(run.model, device, run.dtype);
        tokenizer = tokenizerOf(translate);
        post({ type: "device", device });
      }
    }
    post({ type: "done", stopped });
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
});
