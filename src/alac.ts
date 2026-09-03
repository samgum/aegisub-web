const DECODER_SCRIPT = "alac/aurora-alac-0.1.0.js";
const SCAN_HEAD_BYTES = 8 * 1024 * 1024;
const SCAN_TAIL_BYTES = 16 * 1024 * 1024;

interface AuroraFormat {
  sampleRate?: number;
  channelsPerFrame?: number;
}

interface AuroraAsset {
  on(event: "format", callback: (format: AuroraFormat) => void): void;
  on(event: "buffer", callback: (percent: number) => void): void;
  on(event: "error", callback: (error: unknown) => void): void;
  decodeToBuffer(callback: (samples: Float32Array) => void): void;
  destroy(): void;
}

interface AuroraApi {
  Asset: { fromBuffer(bytes: Uint8Array): AuroraAsset };
}

declare global {
  interface Window { AegisubAuroraAV?: AuroraApi }
}

let auroraPromise: Promise<AuroraApi> | null = null;

function releaseAurora(): void {
  delete window.AegisubAuroraAV;
  document.querySelector('script[data-aegisub-alac-decoder="true"]')?.remove();
  auroraPromise = null;
}

/** Detect an ISO-BMFF/CAF ALAC sample/configuration atom. Requiring a plausible box size
 * avoids treating an arbitrary metadata string containing "alac" as a codec declaration. */
export function containsAlacBox(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 4; index + 4 <= bytes.length; index += 1) {
    if (bytes[index] !== 0x61 || bytes[index + 1] !== 0x6c || bytes[index + 2] !== 0x61 || bytes[index + 3] !== 0x63) continue;
    const size = view.getUint32(index - 4);
    if (size >= 12 && (size <= bytes.length - index + 4 || size <= 1024 * 1024)) return true;
  }
  return false;
}

/** Fast, disk-backed ALAC probe. Fast-start files put `moov` in the head; ordinary MOV/M4A
 * files commonly put it in the tail. Small files are read once. */
export async function fileHasAlac(file: File): Promise<boolean> {
  if (file.size <= SCAN_HEAD_BYTES + SCAN_TAIL_BYTES) {
    return containsAlacBox(new Uint8Array(await file.arrayBuffer()));
  }
  const head = new Uint8Array(await file.slice(0, SCAN_HEAD_BYTES).arrayBuffer());
  if (containsAlacBox(head)) return true;
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - SCAN_TAIL_BYTES)).arrayBuffer());
  return containsAlacBox(tail);
}

function loadAurora(): Promise<AuroraApi> {
  if (window.AegisubAuroraAV) return Promise.resolve(window.AegisubAuroraAV);
  if (!auroraPromise) {
    auroraPromise = new Promise<AuroraApi>((resolve, reject) => {
      const script = document.createElement("script");
      script.dataset.aegisubAlacDecoder = "true";
      script.src = new URL(DECODER_SCRIPT, document.baseURI).toString();
      script.async = true;
      script.addEventListener("load", () => {
        if (window.AegisubAuroraAV) resolve(window.AegisubAuroraAV);
        else reject(new Error("Audio decoder loaded without its Aurora API"));
      }, { once: true });
      script.addEventListener("error", () => reject(new Error("Unable to load the ALAC decoder")), { once: true });
      document.head.append(script);
    }).catch((error) => {
      auroraPromise = null;
      throw error;
    });
  }
  return auroraPromise!;
}

function pcm16Wav(interleaved: Float32Array, sampleRate: number, channels: number): Blob {
  const count = interleaved.length;
  const bytes = new ArrayBuffer(44 + count * 2);
  const view = new DataView(bytes);
  const ascii = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  const channelCount = Math.max(1, Math.min(32, Math.round(channels)));
  const rate = Math.max(8000, Math.round(sampleRate));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + count * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, count * 2, true);
  for (let index = 0; index < count; index += 1) {
    const value = Math.max(-1, Math.min(1, interleaved[index]));
    view.setInt16(44 + index * 2, value < 0 ? Math.round(value * 0x8000) : Math.round(value * 0x7fff), true);
  }
  return new Blob([bytes], { type: "audio/wav" });
}

/** Decode an Aurora-supported audio file (ALAC M4A/CAF, PCM CAF or AIFF) into PCM WAV.
 * The decoder bundle is only 149 KiB, loaded on demand, and the Asset is destroyed as soon
 * as PCM is copied into the WAV so no worker, virtual filesystem, or codec heap survives. */
export async function decodeAuroraAudioToWav(file: File, onProgress?: (ratio: number) => void): Promise<Blob> {
  const AV = await loadAurora();
  onProgress?.(.02);
  const input = new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const asset = AV.Asset.fromBuffer(input);
    let format: AuroraFormat = {};
    let finished = false;
    const dispose = (): void => {
      if (finished) return;
      finished = true;
      asset.destroy();
      queueMicrotask(releaseAurora);
    };
    asset.on("format", (value) => { format = value; onProgress?.(.08); });
    asset.on("buffer", (percent) => onProgress?.(.08 + Math.max(0, Math.min(100, percent)) / 100 * .12));
    asset.on("error", (error) => {
      dispose();
      reject(error instanceof Error ? error : new Error(String(error)));
    });
    asset.decodeToBuffer((samples) => {
      try {
        if (!samples.length) throw new Error("Audio decoder produced no PCM samples");
        const output = pcm16Wav(samples, format.sampleRate || 44100, format.channelsPerFrame || 2);
        onProgress?.(1);
        dispose();
        resolve(output);
      } catch (error) {
        dispose();
        reject(error);
      }
    });
  });
}

/** Kept as the focused public entry point used by callers and tests that only handle ALAC. */
export const decodeAlacToWav = decodeAuroraAudioToWav;
