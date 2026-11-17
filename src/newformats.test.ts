import { describe, it, expect } from "vitest";
import { parseMicroDvd, serializeMicroDvd } from "./formats/microdvd";
import { parseLrc, serializeLrc } from "./formats/lrc";
import { parseTtml, serializeTtml } from "./formats/ttml";
import { parseSubtitles, detectFormat } from "./formats";

describe("MicroDVD (.sub)", () => {
  const SUB = ["{1}{1}25", "{25}{75}Hello, world.", "{100}{150}Line one|Line two"].join("\n");

  it("round-trips a well-formed file frame-exactly", () => {
    expect(serializeMicroDvd(parseMicroDvd(SUB))).toBe(SUB);
  });

  it("converts frames to time with the declared fps", () => {
    const doc = parseMicroDvd(SUB);
    expect(doc.fps).toBe(25);
    expect(doc.cues[0].startMs).toBe(1000); // 25 frames / 25 fps = 1s
    expect(doc.cues[0].endMs).toBe(3000); // 75 / 25 = 3s
    expect(doc.cues[1].text).toBe("Line one\nLine two"); // '|' becomes newline
  });

  it("omits the fps line when the source had none", () => {
    const out = serializeMicroDvd(parseMicroDvd("{24}{48}Hi"));
    expect(out.startsWith("{1}{1}")).toBe(false);
  });

  it("is detected by extension and by content", () => {
    expect(detectFormat("x.sub", "")).toBe("sub");
    expect(detectFormat(undefined, "{0}{50}Hi")).toBe("sub");
  });
});

describe("LRC", () => {
  const LRC = ["[ar:Artist]", "[ti:Title]", "[00:01.00]First line", "[00:03.50]Second line"].join("\n");

  it("parses metadata, timestamps and implicit end times", () => {
    const doc = parseLrc(LRC);
    expect(doc.header).toContain("[ar:Artist]");
    expect(doc.cues).toHaveLength(2);
    expect(doc.cues[0].startMs).toBe(1000);
    expect(doc.cues[0].endMs).toBe(3500); // end = next line's start
    expect(doc.cues[0].text).toBe("First line");
  });

  it("serializes starts and metadata (round-trips the timed lines)", () => {
    const out = serializeLrc(parseLrc(LRC));
    expect(out).toContain("[ar:Artist]");
    expect(out).toContain("[00:01.00]First line");
    expect(out).toContain("[00:03.50]Second line");
  });

  it("is detected by extension and by content", () => {
    expect(detectFormat("song.lrc", "")).toBe("lrc");
    expect(detectFormat(undefined, "[00:01.00]Hi")).toBe("lrc");
  });

  it("parses Enhanced LRC word karaoke, trailing end markers, [offset], spacers and untimed fallback", () => {
    const enhanced = [
      "[00:10.00]<00:10.50>Hel<00:10.80>lo <00:11.20>world<00:12.00>",
      "[00:23.05]",
      "[00:24.00]<00:24.00><00:25.00>",
      "[00:30.00]Next",
      "[offset:+500]",
    ].join("\n");
    const doc = parseLrc(enhanced);
    expect(doc.cues).toHaveLength(2);
    expect(doc.cues[0].startMs).toBe(9500);
    expect(doc.cues[0].endMs).toBe(11500);
    expect(doc.cues[0].text).toBe("{\\k50}{\\kf30}Hel{\\kf40}lo {\\kf80}world");
    expect(doc.cues[1].startMs).toBe(29500);

    const untimed = parseLrc("Line A\nLine B\n");
    expect(untimed.cues.map((c) => [c.startMs, c.endMs, c.text])).toEqual([
      [0, 0, "Line A"],
      [0, 0, "Line B"],
    ]);

    const reserialized = serializeLrc(parseLrc("[00:01.00]<00:01.00>Foo <00:01.50>bar<00:02.00>"));
    expect(reserialized).toContain("<00:01.00>Foo <00:01.50>bar<00:02.00>");
  });
});

describe("TTML / DFXP", () => {
  const TTML = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="en">',
    "  <body><div>",
    '    <p begin="00:00:01.000" end="00:00:03.500">Hello, world.</p>',
    '    <p begin="4s" end="00:00:07.000">Line one<br/>Line two</p>',
    "  </div></body>",
    "</tt>",
  ].join("\n");

  it("parses <p> cues with clock and offset times and <br/> breaks", () => {
    const doc = parseTtml(TTML);
    expect(doc.cues).toHaveLength(2);
    expect(doc.cues[0].startMs).toBe(1000);
    expect(doc.cues[0].endMs).toBe(3500);
    expect(doc.cues[1].startMs).toBe(4000); // "4s" offset
    expect(doc.cues[1].text).toBe("Line one\nLine two");
    expect(doc.header).toBe("en");
  });

  it("re-imports its own output consistently", () => {
    const a = parseTtml(TTML);
    const b = parseTtml(serializeTtml(a));
    expect(b.cues.map((c) => [c.startMs, c.endMs, c.text])).toEqual(a.cues.map((c) => [c.startMs, c.endMs, c.text]));
  });

  it("is detected by extension and by content", () => {
    expect(detectFormat("x.ttml", "")).toBe("ttml");
    expect(detectFormat("x.dfxp", "")).toBe("ttml");
    expect(detectFormat(undefined, '<tt xmlns="...">')).toBe("ttml");
  });

  it("parses prefixed tt: tags, dur, word karaoke spans, nested wrappers and overlapping x-bg harmonies", () => {
    const appleTtml = [
      '<tt:tt xmlns:tt="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">',
      "  <tt:body><tt:div>",
      '    <tt:p begin="00:01.000" dur="4s"><tt:span begin="00:01.000" end="00:02.000">Lead </tt:span><tt:span begin="00:02.000" end="00:04.000">singing</tt:span><tt:span ttm:role="x-bg"><tt:span begin="00:02.500" end="00:04.500">(ooh)</tt:span></tt:span></tt:p>',
      "    <tt:p>Untimed line</tt:p>",
      "  </tt:div></tt:body>",
      "</tt:tt>",
    ].join("\n");
    const doc = parseTtml(appleTtml);
    expect(doc.cues).toHaveLength(3);
    expect(doc.cues[0]).toMatchObject({ startMs: 0, endMs: 0, text: "Untimed line" });
    expect(doc.cues[1].startMs).toBe(1000);
    expect(doc.cues[1].endMs).toBe(5000);
    expect(doc.cues[1].text).toBe("{\\kf100}Lead {\\kf200}singing");
    expect(doc.cues[2].startMs).toBe(2500);
    expect(doc.cues[2].text).toBe("{\\kf200}(ooh)");
  });
});

describe("dispatch", () => {
  it("routes each format through parseSubtitles by extension", () => {
    expect(parseSubtitles("{0}{25}Hi", "a.sub").format).toBe("sub");
    expect(parseSubtitles("[00:01.00]Hi", "a.lrc").format).toBe("lrc");
    expect(parseSubtitles('<tt><body><div><p begin="1s">Hi</p></div></body></tt>', "a.ttml").format).toBe("ttml");
  });
});
