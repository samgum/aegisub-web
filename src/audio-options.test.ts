import { expect, it } from "vitest";
import { audioZoomFactor, audioGain, audioTimingCues } from "./audio-options";
import { blankCue } from "./cue";
it("matches native horizontal zoom breakpoints and cubic amplitude/volume", () => {
  expect([-30, -12, -11, -6, -5, -1, 0, 1, 50].map(audioZoomFactor)).toEqual([1, 19, 20, 45, 50, 90, 100, 125, 1350]);
  expect([0, 25, 50, 75, 100].map(audioGain)).toEqual([.02 ** 3, .125, 1, 3.375, 8]);
});
it("inactive display mode excludes comments but keeps selected comment markers", () => {
  const cues = [blankCue(0, 1000), { ...blankCue(1000, 2000), assKind: "Comment" as const }, blankCue(2000, 3000), blankCue(3000, 4000)];
  expect(audioTimingCues(cues, cues[2].id, [], 1).map(c => c.id)).toEqual([cues[0].id, cues[2].id]);
  expect(audioTimingCues(cues, cues[2].id, [], 2, true).map(c => c.id)).toEqual([cues[1].id, cues[2].id, cues[3].id]);
  expect(audioTimingCues(cues, cues[2].id, [cues[1].id], 0).map(c => c.id)).toEqual([cues[1].id, cues[2].id]);
});
