import { expect, it } from "vitest";
import { dummyFrameSeconds, indexedFrameSeconds, nativeFrameSeconds } from "./presentation-time";
it("uses FFMS2's integer-millisecond frame PTS without floating-point underflow", () => {
  expect(nativeFrameSeconds(25 / 24)).toBe(1.041);
  expect(nativeFrameSeconds(.958333)).toBe(.958);
  expect(nativeFrameSeconds(1.001)).toBe(1.001);
  expect(nativeFrameSeconds(-.02)).toBe(0);
});
it("normalizes a reported seek target to the actual containing VFR frame", () => {
  expect(indexedFrameSeconds(.15, [0, 120, 200, 360])).toBe(.12);
  expect(indexedFrameSeconds(.36, [0, 120, 200, 360])).toBe(.36);
  const cfr = Array.from({ length: 240 }, (_, i) => i * 1000 / 24);
  expect(indexedFrameSeconds(1.2, cfr)).toBe(1.166);
  expect(indexedFrameSeconds(4.2, cfr)).toBe(4.166);
});
it("uses native rounded CFR frame times for dummy sources, including final-frame clamping", () => {
  expect(dummyFrameSeconds(1 / 24, 24, 240)).toBe(.042);
  expect(dummyFrameSeconds(10, 24, 240)).toBe(9.958);
  expect(dummyFrameSeconds(.02, 24, 240)).toBe(0);
  expect(dummyFrameSeconds(1001 / 24000, 24000 / 1001, 100)).toBe(.042);
});
