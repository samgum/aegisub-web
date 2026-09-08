import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { VideoFrameIndex, readVideoFrameIndex } from "./video-frame-index";
import { parseKeyframeTimes } from "./aegisub-tools";

it("indexes the actual fixture frame rate instead of the old 23.976 constant", async () => {
  const bytes = readFileSync("test-corpus/tiny-timing.mp4");
  const index = await readVideoFrameIndex(new Blob([bytes]), new AbortController().signal);
  expect(index.startsMs).toHaveLength(240);
  expect(index.frameRate).toBeCloseTo(24, 6);
  expect(index.durationMs).toBeCloseTo(10000, 3);
  expect(index.startsMs[1]).toBeCloseTo(1000 / 24, 6);
  expect(VideoFrameIndex.frameAtTime(index.startsMs, 1041.666)).toBe(25);
  expect(index.keyframesMs[0]).toBe(0);
});

it("sorts B-frame presentation times and steps irregular VFR intervals in both directions", () => {
  const index = new VideoFrameIndex([
    { timestamp: 0, duration: .04, type: "key" },
    { timestamp: .1, duration: .08, type: "delta" },
    { timestamp: .04, duration: .06, type: "delta" },
    { timestamp: .18, duration: .04, type: "key" },
  ]);
  expect(index.startsMs).toEqual([0, 40, 100, 180]);
  expect(VideoFrameIndex.frameAtTime(index.startsMs, 99)).toBe(1);
  expect(VideoFrameIndex.frameAtTime(index.startsMs, 100)).toBe(2);
  const frame = VideoFrameIndex.frameAtTime(index.startsMs, 150);
  expect(VideoFrameIndex.timeAtFrame(index.startsMs, frame - 1, 25)).toBe(40);
  expect(VideoFrameIndex.timeAtFrame(index.startsMs, frame + 1, 25)).toBe(180);
  expect(VideoFrameIndex.timeAtFrame(index.startsMs, frame, 25, "start")).toBe(70);
  expect(VideoFrameIndex.timeAtFrame(index.startsMs, frame, 25, "end")).toBe(140);
  expect(parseKeyframeTimes("# keyframe format v1\nfps 25\n0\n2\n3", 25,
    frame => VideoFrameIndex.timeAtFrame(index.startsMs, frame, 25))).toEqual([0, 100, 180]);
});

it("cancels before allocating a demuxer when a video is replaced", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(readVideoFrameIndex(new Blob(), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
});

it("reads VFR timestamps from the container, matching the independent ffprobe oracle", async () => {
  const bytes = readFileSync("test-corpus/vfr-frame-timing.mp4");
  const index = await readVideoFrameIndex(new Blob([bytes]), new AbortController().signal);
  expect(index.startsMs).toEqual([0, 120, 200, 240, 360, 400, 480, 600, 720, 800, 840, 960]);
});
