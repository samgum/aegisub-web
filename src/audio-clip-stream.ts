import { ALL_FORMATS, AudioSampleSink, BlobSource, EncodedPacketSink, Input, type AudioSample } from "mediabunny";
import { downmixPcm16, floatToPcm16, pcm16Reader, PcmClipWriter, type AudioClipRange, type NativePcmRange } from "./audio-clip-pcm";
import { readMatroskaAudioTiming } from "./matroska-audio-timing";
import { decodeVorbisClip } from "./audio-clip-vorbis";

function decodedMono(sample: AudioSample): Int16Array {
  if (typeof AudioData !== "undefined") {
    // Same-format WebCodecs copies preserve integer bits and do not ask WebKit
    // to perform its problematic multi-channel format conversion.
    const data = sample.toAudioData();
    try {
      const format = sample.format.replace("-planar", ""), planar = sample.format.endsWith("-planar");
      const reader = pcm16Reader(`pcm-${format}`)!;
      const planeBytes = sample.numberOfFrames * reader.bytes;
      const bytes = new Uint8Array(planeBytes * sample.numberOfChannels);
      if (planar) for (let channel = 0; channel < sample.numberOfChannels; channel++) data.copyTo(bytes.subarray(channel * planeBytes, (channel + 1) * planeBytes), { planeIndex: channel, format: sample.format });
      else data.copyTo(bytes, { planeIndex: 0, format: sample.format });
      return downmixPcm16(new DataView(bytes.buffer), sample.numberOfChannels, sample.numberOfFrames, reader.read, reader.bytes, planar);
    } finally { data.close(); }
  }
  // Software companded PCM decoders also work without WebCodecs/Web Audio.
  const sums = new Float64Array(sample.numberOfFrames), plane = new Float32Array(sample.numberOfFrames);
  for (let channel = 0; channel < sample.numberOfChannels; channel++) {
    sample.copyTo(plane, { planeIndex: channel, format: "f32-planar" });
    for (let i = 0; i < plane.length; i++) sums[i] += sample.format.startsWith("f32") ? floatToPcm16(plane[i]) : Math.max(-32768, Math.min(32767, Math.floor(plane[i] * 32768)));
  }
  return Int16Array.from(sums, value => Math.trunc(value / sample.numberOfChannels));
}

/** Demux just the selected interval plus decoder preroll/lookahead. No video decode,
 * AudioContext resampling, full-file arrayBuffer, or persistent media cache. */
export async function streamAudioClip(file: Blob, range: AudioClipRange, progress: (ratio: number) => void = () => undefined): Promise<Blob> {
  const writer = await processAudioPcm(file, (rate, count) => new PcmClipWriter(rate, count, range), progress);
  const blob = writer.finish(); progress(1); return blob;
}

export async function processAudioPcm<T extends NativePcmRange>(file: Blob, create: (sourceRate: number, totalFrames: number) => T, progress: (ratio: number) => void = () => undefined): Promise<T> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error("文件中没有音频轨。");
    const [sourceRate, channels, duration, codec] = await Promise.all([track.getSampleRate(), track.getNumberOfChannels(), track.computeDuration(), track.getCodec()]);
    const timing = await readMatroskaAudioTiming(file, track.id);
    const delaySamples = Math.round(timing.delay * sourceRate);
    const writer = create(sourceRate, Math.max(0, Math.round(duration * sourceRate) - delaySamples));
    if (writer.start === writer.end) return writer;
    const startTime = (writer.readStart + delaySamples) / sourceRate, endTime = (writer.readEnd + delaySamples) / sourceRate;
    let lastProgress = 0;
    let primingSamples = 0;
    const append = (timestamp: number, mono: Int16Array) => {
      writer.append(Math.round(timestamp * sourceRate) + primingSamples - delaySamples, mono);
      const now = performance.now();
      if (now - lastProgress >= 100) { lastProgress = now; progress(writer.progress); }
    };
    const reader = pcm16Reader(codec ?? "");
    if (reader) {
      const sink = new EncodedPacketSink(track);
      const first = await sink.getPacket(startTime) ?? await sink.getFirstPacket();
      if (first) for await (const packet of sink.packets(first)) {
        if (packet.timestamp >= endTime) break;
        const frames = packet.data.length / (reader.bytes * channels);
        if (!Number.isInteger(frames)) throw new Error("PCM 数据块不完整。");
        const view = new DataView(packet.data.buffer, packet.data.byteOffset, packet.data.byteLength);
        append(packet.timestamp, downmixPcm16(view, channels, frames, reader.read, reader.bytes));
      }
    } else {
      if (!await track.canDecode()) throw new Error(`当前浏览器无法分段解码 ${codec ?? "此编码"} 音频；请打开对应的 WAV / FLAC 音轨后导出。`);
      const sink = new AudioSampleSink(track);
      // Transform codecs need preceding packets to rebuild overlap/predictor state.
      // Begin with bounded preroll, including negative encoder-delay packets at BOF.
      const decodeStart = Math.max(await track.getFirstTimestamp(), startTime - Math.max(1, timing.preroll));
      const packets = new EncodedPacketSink(track), first = await packets.getFirstPacket();
      const begin = await packets.getPacket(decodeStart) ?? first;
      const middle = begin && first && begin.sequenceNumber !== first.sequenceNumber;
      if (codec === "opus" && (middle || String(await track.getInternalCodecId()).startsWith("A_"))) {
        const description = (await track.getDecoderConfig())?.description;
        if (description) {
          const bytes = ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength) : new Uint8Array(description);
          if (bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(0, 8)) === "OpusHead") {
            // A fresh decoder applies OpusHead.preSkip even in the middle of a
            // stream, but anchors its shortened output at the original packet PTS.
            // At Ogg BOF the demuxer already clamps the negative preroll PTS to 0.
            primingSamples = Math.round(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(10, true) * sourceRate / 48000);
          }
        }
      }
      const consume = (timestamp: number, sample: AudioSample) => {
        if (sample.sampleRate !== sourceRate) throw new Error("音轨中途改变了采样率，无法按原始时间轴导出。");
        append(timestamp, decodedMono(sample));
      };
      if (codec === "vorbis") await decodeVorbisClip(track, decodeStart, endTime, consume);
      else for await (const sample of sink.samples(decodeStart, endTime)) {
        try { consume(sample.timestamp, sample); } finally { sample.close(); }
      }
    }
    return writer;
  } finally { input.dispose(); }
}
