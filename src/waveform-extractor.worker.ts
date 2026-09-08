import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from "mediabunny";
import { registerFlacDecoder } from "./flac-decoder";

registerFlacDecoder();

const worker = self as unknown as { onmessage: ((event: MessageEvent<{ file: Blob }>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };
worker.onmessage = async event => {
  const input = new Input({ source: new BlobSource(event.data.file), formats: ALL_FORMATS });
  const pages: Float32Array[] = [], pageSize = 16384, peaksPerSec = 100;
  let length = 0, lastProgress = 0;
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error("没有音频轨。");
    if (!await track.canDecode()) throw new Error("此浏览器未提供该音频编码的分段解码器。");
    const duration = await input.computeDuration([track]);
    const sink = new AudioSampleSink(track);
    for await (const sample of sink.samples()) {
      try {
        const samples = new Float32Array(sample.numberOfFrames);
        for (let channel = 0; channel < sample.numberOfChannels; channel++) {
          sample.copyTo(samples, { planeIndex: channel, format: "f32-planar" });
          for (let i = 0; i < samples.length; i += 4) {
            const bucket = Math.floor((sample.timestamp + i / sample.sampleRate) * peaksPerSec);
            if (bucket < 0) continue;
            const page = Math.floor(bucket / pageSize), offset = bucket % pageSize;
            pages[page] ??= new Float32Array(pageSize);
            pages[page][offset] = Math.max(pages[page][offset], Math.abs(samples[i]));
            length = Math.max(length, bucket + 1);
          }
        }
        const now = performance.now();
        if (now - lastProgress > 150) { lastProgress = now; worker.postMessage({ type: "progress", ratio: Math.min(1, sample.timestamp / duration) }); }
      } finally { sample.close(); }
    }
    const peaks = new Float32Array(length);
    pages.forEach((page, index) => { if (page) peaks.set(page.subarray(0, Math.min(pageSize, length - index * pageSize)), index * pageSize); });
    worker.postMessage({ type: "done", peaks: peaks.buffer, peaksPerSec }, [peaks.buffer]);
  } catch (error) { worker.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) }); }
  finally { input.dispose(); }
};
