import { expect, it } from "vitest";
import { checkerboardAlternate, parseDummyFrameRate } from "./dummy-video";
it("accepts fractional frame rates and rejects malformed or zero rates", () => {
  expect(parseDummyFrameRate("24000/1001")).toBe(24000 / 1001);
  expect(parseDummyFrameRate("29.97")).toBe(29.97);
  expect(parseDummyFrameRate(".5")).toBe(.5);
  for (const text of ["0", "24/0", "abc", "1/2/3", "-1", "1.5/2", "24/99999999999"]) expect(parseDummyFrameRate(text)).toBeNull();
});
it("matches native 24-step checkerboard lightness for grey backgrounds", () => {
  expect(checkerboardAlternate("#000000")).toBe("#181818");
  expect(checkerboardAlternate("#808080")).toBe("#989898");
  expect(checkerboardAlternate("#ffffff")).toBe("#e7e7e7");
});
