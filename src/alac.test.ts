import { describe, expect, it } from "vitest";
import { containsAlacBox } from "./alac";

describe("ALAC codec detection", () => {
  it("recognises an ALAC ISO-BMFF sample entry", () => {
    const bytes = new Uint8Array([0, 0, 0, 36, 0x61, 0x6c, 0x61, 0x63, ...new Array(28).fill(0)]);
    expect(containsAlacBox(bytes)).toBe(true);
  });

  it("does not accept an arbitrary metadata string", () => {
    expect(containsAlacBox(new TextEncoder().encode("artist=the alac test"))).toBe(false);
  });
});
