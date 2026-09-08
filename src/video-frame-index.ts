import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } from "mediabunny";

export class VideoFrameIndex {
  readonly startsMs: number[];
  readonly keyframesMs: number[];
  readonly durationMs: number;
  readonly frameRate: number;

  constructor(packets: { timestamp: number; duration: number; type: string }[]) {
    const ordered = packets.filter(p => Number.isFinite(p.timestamp) && p.timestamp + p.duration > 0)
      .sort((a, b) => a.timestamp - b.timestamp);
    this.startsMs = [...new Set(ordered.map(p => Math.max(0, p.timestamp * 1000)))];
    this.keyframesMs = [...new Set(ordered.filter(p => p.type === "key").map(p => Math.max(0, p.timestamp * 1000)))];
    const last = ordered.at(-1);
    this.durationMs = last ? (last.timestamp + last.duration) * 1000 : 0;
    const span = (this.startsMs.at(-1) ?? 0) - (this.startsMs[0] ?? 0);
    this.frameRate = span > 0 ? (this.startsMs.length - 1) * 1000 / span : this.durationMs > 0 ? 1000 / this.durationMs : 0;
  }

  /** EXACT in the desktop vfr implementation: frame containing the time, not nearest. */
  static frameAtTime(startsMs: readonly number[], ms: number): number {
    let lo = 0, hi = startsMs.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      // HTML media times may be truncated to integer microseconds after seeked (e.g.
      // 25/24 -> 1.041666 in Chromium). Accept that one-microsecond quantization only.
      if (startsMs[mid] <= ms + .001) lo = mid + 1;
      else hi = mid;
    }
    return Math.max(0, lo - 1);
  }

  static timeAtFrame(startsMs: readonly number[], frame: number, fallbackFps: number, boundary: "exact" | "start" | "end" = "exact"): number {
    const exact = (n: number): number => {
      if (!startsMs.length) return n * 1000 / fallbackFps;
      if (n < 0) return startsMs[0] + n * 1000 / fallbackFps;
      if (n >= startsMs.length) return startsMs.at(-1)! + (n - startsMs.length + 1) * 1000 / fallbackFps;
      return startsMs[n];
    };
    const current = exact(frame);
    if (boundary === "exact") return current;
    // Aegisub's START/END snap uses the midpoint between adjacent frame timestamps.
    const other = exact(frame + (boundary === "start" ? -1 : 1));
    return Math.ceil((Math.round(current) + Math.round(other)) / 2);
  }
}

/** Reads only packet metadata using disk-backed slices, not an entire video byte array. */
export async function readVideoFrameIndex(file: Blob, signal: AbortSignal): Promise<VideoFrameIndex> {
  signal.throwIfAborted();
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const abort = () => input.dispose();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error("文件没有视频轨。");
    const packets: { timestamp: number; duration: number; type: string }[] = [];
    const sink = new EncodedPacketSink(track);
    for await (const packet of sink.packets(undefined, undefined, { metadataOnly: true })) {
      signal.throwIfAborted();
      packets.push({ timestamp: packet.timestamp, duration: packet.duration, type: packet.type });
      // Yield periodically so a large Matroska scan cannot starve editing or cancellation.
      if (packets.length % 2048 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    signal.throwIfAborted();
    const index = new VideoFrameIndex(packets);
    if (!index.startsMs.length) throw new Error("视频轨没有可显示的帧。");
    return index;
  } finally {
    signal.removeEventListener("abort", abort);
    input.dispose();
  }
}
