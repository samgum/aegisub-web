import { describe, expect, it } from "vitest";
import { parseAss } from "./formats/ass";
import { parseSrt } from "./formats/srt";
import {
  checkPairedPunctuation,
  annotateFurigana,
  autoFillFuriganaReadings,
  cleanSubtitleText,
  convertKana,
  embedAssAttachment,
  estimateOverflow,
  extractKanjiOccurrences,
  listAssAttachments,
  removeAssAttachment,
  cleanupSubtitleText,
  fixCommonErrors,
  generateLyricsScroll,
  isAssWhitespaceOnly,
  parseKeyframeTimes,
  parseTimecodes,
  resampleAssDocument,
  snapToKeyframes,
  stitchAdjacentTimings,
} from "./aegisub-tools";

const SRT = [
  "1", "00:00:01,000 --> 00:00:01,300", "第一句。  “test”  ", "",
  "2", "00:00:01,350 --> 00:00:05,000", "第二句（未闭合", "",
].join("\n");

describe("Aegisub compatibility tools", () => {
  it("ports the opt-in common-error timing and text fixes", () => {
    const result = fixCommonErrors(parseSrt(SRT), {
      overlaps: true,
      shortGaps: true,
      shortDurations: true,
      longDurations: true,
      removeEmpty: true,
      trimTrailingWhitespace: true,
      minGapMs: 100,
      minDurationMs: 1000,
      maxDurationMs: 2000,
    });
    expect(result.report.shortDurations).toBe(1);
    expect(result.report.shortGaps).toBe(1);
    expect(result.report.longDurations).toBe(1);
    expect(result.report.trailingWhitespace).toBe(1);
    expect(result.doc.cues[0].endMs).toBe(1250);
  });

  it("cleans visible text without changing override tags", () => {
    const doc = parseAss("[Script Info]\nPlayResX: 640\nPlayResY: 360\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\b1}你好，  世界。{\\b0} “好”");
    const result = cleanupSubtitleText(doc);
    expect(result.doc.cues[0].text).toContain("{\\b1}");
    expect(result.doc.cues[0].text).toContain("你好 世界");
    expect(result.doc.cues[0].text).toContain('"好"');
  });

  it("reports paired punctuation and ignores apostrophes inside words", () => {
    const doc = parseSrt("1\n00:00:01,000 --> 00:00:02,000\nI'm fine（really\n");
    const issues = checkPairedPunctuation(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("（");
  });

  it("stitches nearby edges and snaps imported keyframes", () => {
    const doc = parseSrt("1\n00:00:01,000 --> 00:00:02,000\nA\n\n2\n00:00:02,080 --> 00:00:03,000\nB\n");
    const stitched = stitchAdjacentTimings(doc, 100).doc;
    expect(stitched.cues[0].endMs).toBe(2040);
    expect(stitched.cues[1].startMs).toBe(2040);
    const times = parseKeyframeTimes("# keyframe format v1\nfps 25\n25\n50\n75\n");
    expect(times).toEqual([1000, 2000, 3000]);
    const snapped = snapToKeyframes(doc, times, 90);
    expect(snapped.doc.cues[1].startMs).toBe(2000);
    const v1 = parseTimecodes("# timecode format v1\nAssume 25\n2,3,50\n");
    expect(v1.slice(0, 5).map(Math.round)).toEqual([0, 40, 80, 100, 120]);
  });

  it("resamples ASS coordinates and generates a scrolling lyric project", () => {
    const doc = parseAss("[Script Info]\nPlayResX: 640\nPlayResY: 360\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\pos(320,180)}One\nDialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,Two");
    const resampled = resampleAssDocument(doc, 1280, 720).doc;
    expect(resampled.assScriptInfo).toContain("PlayResX: 1280");
    expect(resampled.cues[0].text).toContain("\\pos(640,360)");
    const scrolling = generateLyricsScroll(doc, {
      width: 1280, height: 720, currentY: 360, lineGap: 70, before: 1, after: 1,
      transitionMs: 250, currentFontSize: 48, otherFontSize: 36,
    });
    expect(scrolling.format).toBe("ass");
    expect(scrolling.cues.length).toBeGreaterThan(2);
    expect(scrolling.styles?.some((style) => style.name.includes("Current"))).toBe(true);
  });

  it("adds independently editable furigana events without rewriting the base text", () => {
    const doc = parseAss("[Script Info]\nPlayResX: 640\nPlayResY: 360\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,20,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,東京へ行く");
    const result = annotateFurigana(doc, {
      entries: [{ base: "東京", reading: "とうきょう" }],
      above: true,
      sizePercent: 50,
      removeExisting: true,
    });
    expect(result.annotations).toBe(1);
    expect(result.doc.cues[0].text).toBe("東京へ行く");
    expect(result.doc.cues[1].text).toContain("とうきょう");
    expect(result.doc.cues[1].assFields?.Name).toBe("Aegisub Web Furigana");
  });

  it("embeds, lists and removes ASS attachments", () => {
    const doc = parseSrt("1\n00:00:01,000 --> 00:00:02,000\nText\n");
    const embedded = embedAssAttachment(doc, "Example.ttf", new Uint8Array([0, 1, 2, 3, 4, 5]));
    expect(embedded.format).toBe("ass");
    expect(embedded.trailingNotes).toContain("[Fonts]");
    expect(listAssAttachments(embedded)).toEqual([
      expect.objectContaining({ kind: "font", name: "Example.ttf", approximateBytes: 6 }),
    ]);
    expect(listAssAttachments(removeAssAttachment(embedded, "Example.ttf", "font"))).toHaveLength(0);
  });

  it("preserves template and vector-drawing lines when removing empty lines, and reports per-line cleanup metrics", () => {
    const assDoc = parseAss(
      "[Script Info]\nPlayResX: 640\nPlayResY: 360\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n" +
      "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\b1}\\h\\N\u3000\n" +
      "Dialogue: 0,0:00:02.00,0:00:03.00,Default,,0,0,0,template line,{\\k50}\n" +
      "Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,{\\p1}m 0 0 l 20 20",
    );
    expect(isAssWhitespaceOnly(assDoc.cues[0])).toBe(true);
    expect(isAssWhitespaceOnly(assDoc.cues[1])).toBe(false);
    expect(isAssWhitespaceOnly(assDoc.cues[2])).toBe(false);
    const fixed = fixCommonErrors(assDoc, {
      overlaps: false, shortGaps: false, shortDurations: false, longDurations: false,
      removeEmpty: true, trimTrailingWhitespace: false, minGapMs: 100, minDurationMs: 1000, maxDurationMs: 7000,
    });
    expect(fixed.report.emptyLines).toBe(1);
    expect(fixed.doc.cues).toHaveLength(2);

    const cleaned = cleanSubtitleText(parseSrt("1\n00:00:01,000 --> 00:00:02,000\n你好，  世界。\n"));
    expect(cleaned.report.checkedLines).toBe(1);
    expect(cleaned.report.doubleSpaceFixedLines).toBe(1);
  });

  it("supports stitch anchor modes and frame distances, plus advanced overflow estimation", () => {
    const doc = parseSrt("1\n00:00:01,000 --> 00:00:02,000\nA\n\n2\n00:00:02,080 --> 00:00:03,000\nB\n");
    const prevAnchor = stitchAdjacentTimings(doc, 100, undefined, { anchor: "previous" });
    expect(prevAnchor.doc.cues[0].endMs).toBe(2000);
    expect(prevAnchor.doc.cues[1].startMs).toBe(2000);
    const nextAnchor = stitchAdjacentTimings(doc, 2, undefined, { anchor: "next", unit: "frames", frameRate: 25 });
    expect(nextAnchor.report.stitched).toBe(1);
    expect(nextAnchor.doc.cues[0].endMs).toBe(2080);

    const ovDoc = parseAss(
      "[Script Info]\nPlayResX: 640\nPlayResY: 360\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n" +
      "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\pos(10,180)\\an6\\fs80}VeryLongTextHere\n" +
      "Dialogue: 0,0:00:02.00,0:00:03.00,Default,,0,0,0,,{\\p1}m 0 0 l 9999 9999 l 0 9999",
    );
    const issues = estimateOverflow(ovDoc);
    expect(issues).toHaveLength(1);
    expect(issues[0].reason).toBe("bounds");
  });

  it("extracts kanji, autofills/converts kana furigana, and generates bilingual lyrics scroll", () => {
    const jaDoc = parseAss(
      "[Script Info]\nPlayResX: 1280\nPlayResY: 720\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1\nStyle: CN,Arial,32,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n" +
      "Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,東京の未来\n" +
      "Dialogue: 0,0:00:01.00,0:00:03.00,CN,,0,0,0,,东京的未来",
    );
    const occs = extractKanjiOccurrences(jaDoc, { style: "Default" });
    expect(occs.map((o) => o.kanji)).toEqual(["東京", "未来"]);
    expect(convertKana("とうきょう", "katakana")).toBe("トウキョウ");
    const filled = autoFillFuriganaReadings(jaDoc, [], { style: "Default" }, "katakana");
    expect(filled).toEqual([
      { base: "東京", reading: "トウキョウ" },
      { base: "未来", reading: "ミライ" },
    ]);

    const scroll = generateLyricsScroll(jaDoc, {
      width: 1280, height: 720, currentY: 360, lineGap: 80, before: 1, after: 1,
      transitionMs: 200, currentFontSize: 50, otherFontSize: 38,
      languageMode: "bilingual", secondaryStyle: "CN", sourceAction: "comment",
    });
    expect(scroll.cues.some((c) => c.assKind === "Comment")).toBe(true);
    expect(scroll.cues.some((c) => c.text.includes("东京的未来"))).toBe(true);
  });
});
