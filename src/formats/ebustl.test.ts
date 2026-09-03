import { describe, expect, it } from "vitest";
import { parseAss } from "./ass";
import { encodeEbuStl } from "./ebustl";

describe("EBU Tech 3264 STL export", () => {
  it("writes a 1024-byte GSI header and 128-byte TTI blocks", () => {
    const doc = parseAss("[Script Info]\nTitle: Test\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,20,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hello\\NWorld");
    const bytes = encodeEbuStl(doc);
    expect(bytes.length).toBe(1152);
    expect(new TextDecoder().decode(bytes.subarray(0, 11))).toBe("850STL25.01");
    expect(new TextDecoder().decode(bytes.subarray(16, 20))).toBe("Test");
    expect(bytes[1024 + 3]).toBe(0xff);
    expect([...bytes.subarray(1024 + 16, 1024 + 27)]).toEqual([...new TextEncoder().encode("Hello"), 0x8a, ...new TextEncoder().encode("World")]);
  });
  it("supports the EBU legacy single-byte and ISO-6937 character tables", () => {
    const doc = parseAss("[Script Info]\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,20,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,é");
    const bytes = encodeEbuStl(doc, { fps: 25, dropFrame: false, timecodeOffsetFrames: 0, inclusiveEndTimes: false, maxLineLength: 42, wrapping: "auto", translateAlignments: true, displayStandard: "open", textEncoding: "iso6937" });
    expect([...bytes.subarray(1040, 1042)]).toEqual([0xc2, 0x65]);
    expect(new TextDecoder().decode(bytes.subarray(12, 14))).toBe("00");
  });
});
