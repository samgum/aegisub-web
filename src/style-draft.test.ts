import { describe, expect, it } from "vitest";
import { applyStyleDraft } from "./native-style-editor";
import { validStyleLibrary, parseStyleLibrary } from "./native-style-manager";
import { readFileSync } from "node:fs";
import { makeDefaultStyle } from "./formats/ass";
import type { SubtitleDoc } from "./cue";

describe("native style draft transactions", () => {
  const document = (): SubtitleDoc => ({ format: "ass", eol: "\n", bom: false, finalNewline: true, styles: [makeDefaultStyle("Original")], cues: [{ id: "a", text: "中文", startMs: 0, endMs: 1000, assFields: { Style: "Original" } }] });
  it("re-resolves the current style after each host clone and preserves unknown fields", () => {
    let doc = document(); const draft = structuredClone(doc.styles![0]); draft.fields.Custom = "keep";
    draft.fields.Fontsize = "75"; applyStyleDraft(doc, "Original", draft); doc = structuredClone(doc);
    draft.fields.MarginL = "100"; applyStyleDraft(doc, "Original", draft); doc = structuredClone(doc);
    draft.name = "翻译"; applyStyleDraft(doc, "Original", draft);
    expect(doc.styles![0]).toEqual(draft); expect(doc.cues[0].assFields!.Style).toBe("翻译");
  });
  it("rejects name collisions without mutating the document", () => {
    const doc = document(); doc.styles!.push(makeDefaultStyle("Other")); const before = structuredClone(doc);
    expect(() => applyStyleDraft(doc, "Original", makeDefaultStyle("Other"))).toThrow("已存在"); expect(doc).toEqual(before);
  });
  it("a new draft only adds a style when applied, and subsequent applies update it", () => {
    const doc = document(), draft = makeDefaultStyle("New"); expect(doc.styles).toHaveLength(1);
    applyStyleDraft(doc, null, draft); draft.fields.Fontsize = "90"; applyStyleDraft(doc, "New", draft);
    expect(doc.styles).toHaveLength(2); expect(doc.styles![1].fields.Fontsize).toBe("90");
  });
  it("rejects malformed imported libraries and duplicate names", () => {
    expect(validStyleLibrary([makeDefaultStyle("A")])).toBe(true);
    for (const bad of [{}, [{ name: "A", fields: [] }], [{ name: "A", fields: { Fontsize: 20 } }], [makeDefaultStyle("A"), makeDefaultStyle("A")]]) expect(validStyleLibrary(bad)).toBe(false);
  });
  it("imports native .sty Style lines without an Events section", () => {
    const ass = readFileSync("test-corpus/base.ass", "utf8");
    const expected = parseStyleLibrary(ass, "base.ass");
    const lines = ass.split(/\r?\n/).filter(line => /^Style:/.test(line)).join("\n");
    expect(parseStyleLibrary(lines, "Default.sty")).toEqual(expected);
    expect(() => parseStyleLibrary("garbage", "broken.sty")).toThrow("没有有效样式");
  });
});
