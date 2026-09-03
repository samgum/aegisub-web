import { describe, expect, it } from "vitest";
import { blankCue } from "./cue";
import {
  addLead,
  clearCueText,
  findStyleOverlaps,
  insertCueRelative,
  joinSelectedCues,
  moveSelectedRows,
  nudgeTimingUnit,
  parseKaraokeSyllables,
  pasteOverCues,
  postProcessTiming,
  recombineSelectedCues,
  selectCueIds,
  setContinuousTiming,
  shiftSelectionToTime,
  shiftCueTimes,
  sortCueGrid,
  splitCueAtText,
  splitCueByKaraoke,
  swapSelectedRows,
} from "./aegisub-operations";

const cue = (start: number, end: number, text: string, style = "Default") => {
  const value = blankCue(start, end, text);
  value.assFields = { Style: style, Name: "", Effect: "", Layer: "0" };
  value.assKind = "Dialogue";
  return value;
};

describe("Aegisub command operations", () => {
  it("sorts all rows or only the selected slots", () => {
    const cues = [cue(3000, 4000, "C"), cue(1000, 2000, "A"), cue(2000, 3000, "B")];
    expect(sortCueGrid(cues, "start").map((item) => item.text)).toEqual(["A", "B", "C"]);
    expect(sortCueGrid(cues, "start", new Set([cues[0].id, cues[2].id])).map((item) => item.text)).toEqual(["B", "A", "C"]);
  });

  it("moves and swaps selected rows without losing ids", () => {
    const cues = [cue(0, 1, "A"), cue(1, 2, "B"), cue(2, 3, "C")];
    expect(moveSelectedRows(cues, new Set([cues[1].id]), "up").map((item) => item.text)).toEqual(["B", "A", "C"]);
    expect(swapSelectedRows(cues, new Set([cues[0].id, cues[2].id]))?.map((item) => item.text)).toEqual(["C", "B", "A"]);
  });

  it("joins as text, keeps first, or creates karaoke timing", () => {
    const cues = [cue(0, 1000, "One"), cue(1000, 2500, "Two")];
    const selected = new Set(cues.map((item) => item.id));
    expect(joinSelectedCues(cues, selected, "concatenate", "ass")?.cues[0].text).toBe("One\\NTwo");
    expect(joinSelectedCues(cues, selected, "keep-first", "ass")?.cues[0].text).toBe("One");
    expect(joinSelectedCues(cues, selected, "karaoke", "ass")?.cues[0].text).toBe("{\\k100}One{\\k150}Two");
  });

  it("splits text with preserve/video timing and splits karaoke", () => {
    const source = cue(1000, 3000, "Hello world");
    const split = splitCueAtText([source], source.id, 5, "video", 1800)!;
    expect(split.cues.map((item) => [item.startMs, item.endMs, item.text])).toEqual([[1000, 1800, "Hello"], [1800, 3000, "world"]]);
    const karaoke = cue(0, 1000, "{\\k40}la{\\kf60}la");
    expect(parseKaraokeSyllables(karaoke.text)).toEqual([{ durationCs: 40, text: "la" }, { durationCs: 60, text: "la" }]);
    expect(splitCueByKaraoke([karaoke], karaoke.id)?.cues.map((item) => [item.startMs, item.endMs])).toEqual([[0, 400], [400, 1000]]);
  });

  it("supports insert, clear tags and paste-over fields", () => {
    const source = cue(1000, 2000, "{\\b1}Text{\\b0}");
    expect(insertCueRelative([source], source.id, "after").cues).toHaveLength(2);
    expect(clearCueText(source.text, true)).toBe("{\\b1}{\\b0}");
    const target = cue(3000, 4000, "Old", "OldStyle");
    const pasted = pasteOverCues([target], [target.id], [source], { text: true, style: true });
    expect([pasted[0].text, pasted[0].assFields?.Style]).toEqual([source.text, "Default"]);
  });

  it("recombines split/merged text using upstream prefix and suffix rules", () => {
    const one = cue(0, 1000, "One");
    const merged = cue(900, 2000, "One Two");
    const two = cue(1900, 3000, "Two");
    const result = recombineSelectedCues([one, merged, two], new Set([one.id, merged.id, two.id]));
    expect(result.cues.map((item) => item.text)).toEqual(["One", "Two"]);
    expect(result.cues[0]).toMatchObject({ startMs: 0, endMs: 2000 });
  });

  it("shifts by frames/scopes and runs the timing post-processor", () => {
    const cues = [cue(1000, 1900, "A"), cue(2000, 3000, "B")];
    const shifted = shiftCueTimes(cues, { amount: 2, unit: "frames", direction: "forward", scope: "selected", fields: "both", selectedIds: new Set([cues[0].id]), frameRate: 25 });
    expect(shifted[0]).toMatchObject({ startMs: 1080, endMs: 1980 });
    expect(shifted[1]).toMatchObject({ startMs: 2000, endMs: 3000 });
    const processed = postProcessTiming(cues, { leadInMs: 100, leadOutMs: 100, adjacentEnabled: true, maxGapMs: 200, maxOverlapMs: 100, adjacentBias: .5, keyframesMs: [900, 3050], keyStartBeforeMs: 100, keyStartAfterMs: 100, keyEndBeforeMs: 100, keyEndAfterMs: 100 });
    expect(processed[0].startMs).toBe(900);
    expect(processed[0].endMs).toBe(processed[1].startMs);
  });

  it("implements continuous, lead, nudge and shift timing", () => {
    const cues = [cue(1000, 1900, "A"), cue(2000, 3000, "B")];
    const ids = new Set([cues[0].id]);
    expect(setContinuousTiming(cues, ids, "end")[0].endMs).toBe(2000);
    expect(addLead(cues, ids, 100, 200)[0]).toMatchObject({ startMs: 900, endMs: 2100 });
    expect(nudgeTimingUnit(cues, ids, "length", 50)[0].endMs).toBe(1950);
    expect(shiftSelectionToTime(cues, ids, 500)[0]).toMatchObject({ startMs: 500, endMs: 1400 });
  });

  it("selects by criteria and finds same-style overlaps", () => {
    const cues = [cue(0, 1500, "Hello", "A"), cue(1000, 2000, "World", "A"), cue(2100, 2500, "HELLO", "B")];
    expect(selectCueIds(cues, { field: "text", query: "hello", mode: "equals" })).toEqual([cues[0].id, cues[2].id]);
    expect(findStyleOverlaps(cues)).toEqual([expect.objectContaining({ firstId: cues[0].id, secondId: cues[1].id, overlapMs: 500 })]);
  });
});
