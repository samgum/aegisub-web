import { VirtualPlaybackClock } from "./playback-clock";

export type DummyAudioKind = "blank" | "noise";
export const DUMMY_AUDIO_RATE = 44100;
export const DUMMY_AUDIO_SECONDS = 150 * 60;

/** Seek-stable white noise with the native dummy provider's signed-16-bit amplitude
 * range [-5000, 5000]. Native std::default_random_engine is platform dependent, so no
 * cross-platform bit-identity to that generator is claimed. */
export function dummyNoiseSample(index: number): number {
  let value = (index + 1) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return (((value ^ (value >>> 15)) >>> 0) % 10001 - 5000) / 32768;
}

/** Procedural 150-minute source. Neither its PCM nor an encoded video is cached in full. */
export class DummyAudioSource extends VirtualPlaybackClock {
  preservesPitch = true;
  readonly sampleRate = DUMMY_AUDIO_RATE;
  readonly name: string;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;
  private loading: Promise<void> | null = null;
  private dead = false;
  private playGeneration = 0;

  constructor(readonly kind: DummyAudioKind, private onError?: (message: string) => void) {
    super(DUMMY_AUDIO_SECONDS);
    this.name = kind === "blank" ? "空白音频（150 分钟）" : "噪声音频（150 分钟）";
    this.addEventListener("seeked", () => this.syncProcessor());
    this.addEventListener("ratechange", () => this.syncProcessor());
  }
  private syncProcessor(): void {
    this.node?.port.postMessage({ sample: this.currentTime * DUMMY_AUDIO_RATE, rate: this.playbackRate });
  }
  private async prepareAudio(): Promise<void> {
    if (this.kind === "blank" || this.node) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const Context = globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) throw new Error("此浏览器运行环境未提供 Web Audio，无法播放生成的噪声。");
      const context = this.context = new Context();
      if (!context.audioWorklet) throw new Error("此浏览器未提供 AudioWorklet，无法生成噪声音频。");
      // A self-contained worklet uses the same sample function as waveform/export, rather
      // than showing unrelated randomly drawn peaks. The module URL is immediately revoked.
      const source = `const sample = ${dummyNoiseSample.toString()};
        registerProcessor('aegisub-dummy-noise', class extends AudioWorkletProcessor {
          constructor() { super(); this.cursor = 0; this.rate = 1;
            this.port.onmessage = event => { this.cursor = event.data.sample; this.rate = event.data.rate; }; }
          process(inputs, outputs) {
            const output = outputs[0]?.[0]; if (!output) return true;
            const step = 44100 / sampleRate * this.rate;
            for (let i = 0; i < output.length; i++) {
              const frame = Math.floor(this.cursor), fraction = this.cursor - frame;
              output[i] = sample(frame) * (1 - fraction) + sample(frame + 1) * fraction;
              this.cursor += step;
            }
            return true;
          }
        });`;
      const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      if (this.dead) return;
      this.node = new AudioWorkletNode(context, "aegisub-dummy-noise", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
      this.node.addEventListener("processorerror", () => { this.pause(); this.onError?.("噪声音频处理器停止了，请重新打开音频。"); });
      this.analyser = context.createAnalyser(); this.analyser.fftSize = 2048;
      this.node.connect(this.analyser);
    })();
    return this.loading;
  }
  override async play(): Promise<void> {
    if (this.dead || !this.paused) return;
    const generation = ++this.playGeneration;
    const prepared = this.prepareAudio();
    // Call resume in the user's gesture, before awaiting worklet loading (Safari).
    const resumed = this.context?.resume();
    await Promise.all([prepared, resumed]);
    if (this.dead || !this.paused || generation !== this.playGeneration) return;
    this.analyser?.connect(this.context!.destination);
    await super.play(); this.syncProcessor();
  }
  override pause(): void {
    this.playGeneration++;
    super.pause(); this.analyser?.disconnect();
    if (this.context?.state === "running") void this.context.suspend().catch(() => undefined);
  }
  samples(start: number, count: number): Float32Array {
    const result = new Float32Array(count);
    if (this.kind === "noise") for (let i = 0; i < count; i++) if (start + i >= 0 && start + i < DUMMY_AUDIO_RATE * this.duration) result[i] = dummyNoiseSample(start + i);
    return result;
  }
  peak(startSeconds: number, endSeconds: number): number {
    if (this.kind === "blank" || startSeconds >= this.duration || endSeconds <= 0) return 0;
    const first = Math.max(0, Math.floor(startSeconds * DUMMY_AUDIO_RATE));
    const last = Math.min(this.duration * DUMMY_AUDIO_RATE - 1, Math.ceil(endSeconds * DUMMY_AUDIO_RATE));
    let peak = 0;
    // Display sampling, analogous to waveform decimation; it never allocates long PCM.
    for (let i = 0; i < 64; i++) peak = Math.max(peak, Math.abs(dummyNoiseSample(Math.floor(first + (last - first) * i / 63))));
    return peak;
  }
  level(): number {
    if (!this.analyser) return 0;
    const samples = new Float32Array(this.analyser.fftSize); this.analyser.getFloatTimeDomainData(samples);
    return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
  }
  async wavClip(startSeconds: number, endSeconds: number, progress?: (ratio: number) => void): Promise<Blob> {
    const start = Math.max(0, Math.min(DUMMY_AUDIO_RATE * this.duration, Math.round(startSeconds * DUMMY_AUDIO_RATE)));
    const end = Math.max(start, Math.min(DUMMY_AUDIO_RATE * this.duration, Math.round(endSeconds * DUMMY_AUDIO_RATE)));
    const count = end - start, header = new Uint8Array(44), view = new DataView(header.buffer);
    const ascii = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) header[offset + i] = text.charCodeAt(i); };
    ascii(0, "RIFF"); view.setUint32(4, 36 + count * 2, true); ascii(8, "WAVE"); ascii(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, DUMMY_AUDIO_RATE, true); view.setUint32(28, DUMMY_AUDIO_RATE * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, "data"); view.setUint32(40, count * 2, true);
    const parts: BlobPart[] = [header];
    for (let offset = 0; offset < count; offset += 65536) {
      if (this.dead) throw new DOMException("音频导出已取消。", "AbortError");
      const size = Math.min(65536, count - offset), bytes = new Uint8Array(size * 2), pcm = new DataView(bytes.buffer);
      if (this.kind === "noise") for (let i = 0; i < size; i++) pcm.setInt16(i * 2, Math.round(dummyNoiseSample(start + offset + i) * 32768), true);
      // Store immutable chunks, letting browsers spool large output blobs instead of
      // retaining a full-length Float32 PCM array plus its encoded copy in JavaScript.
      parts.push(new Blob([bytes]));
      if (offset % (65536 * 8) === 0) { progress?.(offset / count); await new Promise<void>(resolve => setTimeout(resolve, 0)); }
    }
    if (this.dead) throw new DOMException("音频导出已取消。", "AbortError");
    progress?.(1);
    return new Blob(parts, { type: "audio/wav" });
  }
  override dispose(): void {
    this.dead = true; super.dispose(); this.node?.disconnect(); this.node = null;
    this.analyser?.disconnect(); this.analyser = null;
    void this.context?.close().catch(() => undefined); this.context = null;
  }
}
