import { expect, it } from "vitest";
import { blankCue, type SubtitleDoc } from "./cue";
import { bundledFontFilename, bundledPreviewFonts, fontBytesFingerprint, requestedFontFamilies, matchingLocalFonts } from "./preview-fonts";
const doc = (text: string): SubtitleDoc => ({ format: "ass", cues: [blankCue(0, 1000, text)], eol: "\n", bom: false, finalNewline: true,
  styles: [{ name: "Default", fields: { Fontname: "Arial" } }] });

it("loads CJK fallback when Chinese is introduced after an English-only project", () => {
  expect(bundledPreviewFonts(doc("English"))).toEqual([]);
  expect(bundledPreviewFonts(doc("中文"))).toEqual(["SourceHanSansCN-Regular.otf"]);
});
it("recognizes inline fonts without treating visible text or animated tags as static declarations", () => {
  const project = doc("{\\fnSource Han Sans CN Heavy\\bord2}中文{\\t(0,100,\\fnNotAStaticFont)}\\fnNotAnOverride");
  expect(requestedFontFamilies(project)).toEqual(["Arial", "Source Han Sans CN Heavy"]);
  expect(bundledPreviewFonts(project)).toEqual(["SourceHanSansCN-Heavy.otf", "SourceHanSansCN-Regular.otf"]);
});
it("does not falsely claim an unsupported font weight is bundled", () => {
  expect(bundledFontFilename("Source Han Sans CN Bold")).toBeNull();
  expect(bundledFontFilename("@Source Han Sans CN Medium")).toBe("SourceHanSansCN-Medium.otf");
});
it("fingerprints different same-size font contents independently", () => {
  expect(fontBytesFingerprint(new Uint8Array([0, 1, 2]))).not.toBe(fontBytesFingerprint(new Uint8Array([0, 2, 1])));
});
it("finds local fonts referenced by full or PostScript name rather than only family", () => {
  const font = { family: "Example", fullName: "Example Medium", postscriptName: "Example-Medium" };
  expect(matchingLocalFonts([font], ["Example Medium"])).toEqual([font]);
  expect(matchingLocalFonts([font], ["@example-medium"])).toEqual([font]);
  expect(matchingLocalFonts([font], ["Example Bold"])).toEqual([]);
});
