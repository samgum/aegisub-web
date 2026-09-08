/** Native FFMS2 builds integer-millisecond timecodes by truncating frame PTS.
 * The epsilon only absorbs floating-point error at an integer millisecond. */
export function nativeFrameSeconds(presentationSeconds: number): number {
  return Math.floor(Math.max(0, presentationSeconds) * 1000 + 1e-6) / 1000;
}

/** Firefox can report the seek target instead of the decoded frame's original PTS.
 * Normalize the callback through the demuxed presentation-order index when available. */
export function indexedFrameSeconds(reportedSeconds: number, startsMs: readonly number[]): number {
  if (!startsMs.length) return nativeFrameSeconds(reportedSeconds);
  return nativeFrameSeconds(startsMs[VideoFrameIndex.frameAtTime(startsMs, reportedSeconds * 1000)] / 1000);
}

/** Dummy video uses the native CFR clock, whose positive frame times round to ms. */
export function dummyFrameSeconds(seconds: number, rate: number, frames: number): number {
  const frame = Math.max(0, Math.min(frames - 1, Math.floor(seconds * rate + 1e-7)));
  return Math.round(frame * 1000 / rate) / 1000;
}
import { VideoFrameIndex } from "./video-frame-index";
