import { streamAudioClip } from "./audio-clip-stream";
import type { AudioClipRange } from "./audio-clip-pcm";
import { registerClipDolbyDecoder } from "./audio-clip-dolby";
import { registerFlacDecoder } from "./flac-decoder";

const worker = self as unknown as { onmessage: ((event: MessageEvent<{ file: Blob; range: AudioClipRange; libavBase: string }>) => void) | null; postMessage(message: unknown): void };
worker.onmessage = async ({ data }) => {
  try {
    registerClipDolbyDecoder(data.libavBase);
    registerFlacDecoder();
    const blob = await streamAudioClip(data.file, data.range, ratio => worker.postMessage({ type: "progress", ratio }));
    worker.postMessage({ type: "done", blob });
  } catch (error) { worker.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) }); }
};
