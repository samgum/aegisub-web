import { AudioSample, EncodedPacketSink, type InputAudioTrack } from "mediabunny";

/** Vorbis consumes its first packet only to initialize the overlap window. Firefox
 * emits an empty frame timestamped zero; Chromium emits nothing. The pinned generic
 * sink shifts all following samples when seeking after that empty frame. Associate
 * nonempty output with the actual next packet instead, without user-agent guesses. */
export async function decodeVorbisClip(track: InputAudioTrack, start: number, end: number, consume: (timestamp: number, sample: AudioSample) => void): Promise<void> {
  const sink = new EncodedPacketSink(track), first = await sink.getPacket(start) ?? await sink.getFirstPacket();
  if (!first) return;
  const config = await track.getDecoderConfig();
  if (!config) throw new Error("Vorbis 解码配置缺失。");
  const timestamps: number[] = [];
  let failure: unknown, wake: (() => void) | null = null;
  const decoder = new AudioDecoder({
    output: data => {
      try {
        if (!data.numberOfFrames) return;
        const timestamp = timestamps.shift();
        if (timestamp === undefined) throw new Error("Vorbis 数据包与解码样本数量不符。");
        consume(timestamp, new AudioSample(data));
      } catch (error) { failure = error; wake?.(); }
      finally { data.close(); }
    },
    error: error => { failure = error; wake?.(); },
  });
  decoder.ondequeue = () => wake?.();
  try {
    decoder.configure(config);
    let priming = true;
    for await (const packet of sink.packets(first)) {
      if (packet.timestamp >= end) break;
      if (priming) priming = false; else timestamps.push(packet.timestamp);
      decoder.decode(packet.toEncodedAudioChunk());
      while (decoder.decodeQueueSize > 8 && !failure) await new Promise<void>(resolve => { wake = resolve; });
      wake = null;
      if (failure) throw failure;
    }
    await decoder.flush();
    if (failure) throw failure;
  } finally { if (decoder.state !== "closed") decoder.close(); }
}
