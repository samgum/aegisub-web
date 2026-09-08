import { expect, it } from "vitest";
import { blankCue } from "./cue";
import { AudioTimingGesture } from "./audio-timing-gesture";
const options = { button: 0, alt: false, ctrl: false, sensitivityMs: 50 };
it("far-left click sets start, subsequent drag sets end (including crossings)", () => {
  const cue = blankCue(1000, 2000);
  const drag = new AudioTimingGesture([cue], cue.id, [cue.id], 1300, options);
  expect(drag.ranges()[0].range).toEqual({ startMs: 1300, endMs: 2000 });
  drag.move(1800);
  expect(drag.ranges()[0].range).toEqual({ startMs: 1300, endMs: 1800 });
  drag.move(800);
  expect(drag.ranges()[0].range).toEqual({ startMs: 800, endMs: 1300 });
});
it("left near end grabs end without initially moving it", () => {
  const cue = blankCue(1000, 2000);
  const drag = new AudioTimingGesture([cue], cue.id, [], 1980, options);
  expect(drag.ranges()[0].range.endMs).toBe(2000);
  drag.move(2200);
  expect(drag.ranges()[0].range).toEqual({ startMs: 1000, endMs: 2200 });
});
it("right-click updates every selected end marker", () => {
  const cues = [blankCue(1000, 2000), blankCue(3000, 4000)];
  const drag = new AudioTimingGesture(cues, cues[0].id, cues.map(c => c.id), 4500, { ...options, button: 2 });
  expect(drag.ranges().map(c => c.range.endMs)).toEqual([4500, 4500]);
});
it("Alt translates the complete selection while retaining durations", () => {
  const cues = [blankCue(1000, 2000), blankCue(3000, 4000)];
  const drag = new AudioTimingGesture(cues, cues[0].id, cues.map(c => c.id), 1500, { ...options, alt: true });
  drag.move(1750);
  expect(drag.ranges().map(c => c.range)).toEqual([{ startMs: 1250, endMs: 2250 }, { startMs: 3250, endMs: 4250 }]);
});
it("Ctrl drags coincident markers even across an unselected neighbouring line", () => {
  const cues = [blankCue(1000, 2000), blankCue(2000, 3000)];
  const drag = new AudioTimingGesture(cues, cues[0].id, [], 2000, { ...options, ctrl: true });
  drag.move(2300);
  expect(drag.ranges().map(c => c.range)).toEqual([{ startMs: 1000, endMs: 2300 }, { startMs: 2300, endMs: 3000 }]);
});
