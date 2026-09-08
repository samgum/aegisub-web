// Adapter for the existing replaceable libav.js assets (see
// node_modules/mediaplay/libav/NOTICE.md and THIRD_PARTY_NOTICES.md).
// Registration belongs to the export worker, not the player's separate decoder
// registry. No additional decoder/download is introduced.
import { AudioSample, CustomAudioDecoder, registerDecoder, type EncodedPacket } from "mediabunny";

interface Frame { data: Float32Array | Float32Array[]; sample_rate: number }
interface Libav {
  ff_init_decoder(name: string): Promise<[number, number, number, number]>;
  ff_decode_multi(context: number, packet: number, frame: number, packets: { data: Uint8Array }[], flush: boolean): Promise<Frame[]>;
  ff_free_decoder(context: number, packet: number, frame: number): Promise<void>;
  ff_channels(frame: Frame): number;
}

export function registerClipDolbyDecoder(base: string): void {
  class ClipDolbyDecoder extends CustomAudioDecoder {
    private libav: Libav | null = null;
    private context = 0;
    private packet = 0;
    private frame = 0;
    private nextTime: number | null = null;
    static supports(codec: string): boolean { return codec === "ac3" || codec === "eac3"; }
    async init(): Promise<void> {
      const url = new URL("libav-6.9.8.1-audio.mjs", base).href;
      const factory = await import(/* @vite-ignore */ url);
      this.libav = await factory.LibAV({ base, noworker: true }) as Libav;
      [, this.context, this.packet, this.frame] = await this.libav.ff_init_decoder(this.codec);
    }
    async decode(packet: EncodedPacket): Promise<void> {
      if (this.nextTime === null || Math.abs(packet.timestamp - this.nextTime) > .1) this.nextTime = packet.timestamp;
      this.emit(await this.libav!.ff_decode_multi(this.context, this.packet, this.frame, [{ data: packet.data }], false));
    }
    async flush(): Promise<void> { this.emit(await this.libav!.ff_decode_multi(this.context, this.packet, this.frame, [], true)); }
    private emit(frames: Frame[]): void {
      for (const frame of frames) {
        const planar = Array.isArray(frame.data);
        const channels = planar ? (frame.data as Float32Array[]).length : this.libav!.ff_channels(frame);
        let data: Float32Array<ArrayBuffer>;
        if (planar) {
          const planes = frame.data as Float32Array[];
          data = new Float32Array(planes[0].length * channels);
          planes.forEach((plane, index) => data.set(plane, index * planes[0].length));
        } else data = new Float32Array(frame.data as Float32Array);
        const timestamp = this.nextTime ?? 0;
        this.nextTime = timestamp + data.length / channels / frame.sample_rate;
        this.onSample(new AudioSample({ data, format: planar ? "f32-planar" : "f32", numberOfChannels: channels, sampleRate: frame.sample_rate, timestamp }));
      }
    }
    async close(): Promise<void> {
      if (this.libav && this.context) await this.libav.ff_free_decoder(this.context, this.packet, this.frame);
      this.libav = null; this.context = this.packet = this.frame = 0;
    }
  }
  registerDecoder(ClipDolbyDecoder);
}
