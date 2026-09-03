import { describe, expect, it } from "vitest";
import { parseAss } from "./ass";
import { serializeEncore, serializeSsa, serializeTranStation } from "./legacy-export";

const DOC = parseAss("[Script Info]\nScriptType: v4.00+\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,20,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hello");

describe("legacy Aegisub export formats", () => {
  it("writes Adobe Encore and TranStation SMPTE layouts", () => {
    expect(serializeEncore(DOC, 25)).toContain("1 00:00:01:00 00:00:03:00 Hello");
    expect(serializeTranStation(DOC, 25)).toContain("SUB[0 N 00:00:01:00>00:00:03:00]");
  });
  it("writes SSA v4 styles and Marked events", () => {
    const ssa = serializeSsa(DOC);
    expect(ssa).toContain("[V4 Styles]");
    expect(ssa).toContain("Dialogue: Marked=0,");
  });
});
