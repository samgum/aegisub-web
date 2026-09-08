import { AudioSample, CustomAudioDecoder, registerDecoder, type EncodedPacket } from "mediabunny";
import type { FLACDecoder } from "@wasm-audio-decoders/flac";

/** libFLAC's wrapper divides signed samples by the positive full-scale value,
 * unlike Web Audio's power-of-two convention. Recover the integer first, then
 * take the high 16 bits just like the desktop generic provider. */
export function flacSampleToPcm16(value: number, depth: number): number {
  const integer = Math.round(value * Math.fround(2 ** (depth - 1) - 1));
  const sample = depth < 16 ? integer * 2 ** (16 - depth) : Math.floor(integer / 2 ** (depth - 16));
  return Math.max(-32768, Math.min(32767, sample));
}

let registered = false;
/** Safari can advertise FLAC support then fail in InternalAudioDecoderCocoa.
 * Use one deterministic, packet-streaming libFLAC path in analysis/export workers. */
export function registerFlacDecoder(): void {
  if (registered) return;
  registered = true;
  class WorkerFlacDecoder extends CustomAudioDecoder {
    private decoder: FLACDecoder | null = null;
    static supports(codec: string): boolean { return codec === "flac"; }
    async init(): Promise<void> {
      const { FLACDecoder } = await import("@wasm-audio-decoders/flac");
      this.decoder = new FLACDecoder(); await this.decoder.ready;
    }
    async decode(packet: EncodedPacket): Promise<void> {
      const decoded = await this.decoder!.decodeFrames([packet.data]);
      if (decoded.errors.length) throw new Error(`FLAC 解码失败：${decoded.errors.map(error => error.message).join("; ")}`);
      if (!decoded.samplesDecoded) throw new Error("FLAC 数据包未产生有效采样。");
      if (![8, 16, 24, 32].includes(decoded.bitDepth)) throw new Error(`暂不支持 ${decoded.bitDepth} 位 FLAC 音轨。`);
      const channels = decoded.channelData.length, frames = decoded.samplesDecoded;
      const data = new Int16Array(channels * frames);
      for (let channel = 0; channel < channels; channel++) for (let i = 0; i < frames; i++) data[channel * frames + i] = flacSampleToPcm16(decoded.channelData[channel][i], decoded.bitDepth);
      this.onSample(new AudioSample({ data, format: "s16-planar", sampleRate: decoded.sampleRate, numberOfChannels: channels, timestamp: packet.timestamp }));
    }
    async flush(): Promise<void> { /* decodeFrames receives complete demuxed frames, not a partial byte stream. */ }
    async close(): Promise<void> { this.decoder?.free(); this.decoder = null; }
  }
  registerDecoder(WorkerFlacDecoder);
}
