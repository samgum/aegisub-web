import { expect, it } from "vitest";
import { blankCue } from "./cue";
import { parseSubtitles } from "./formats";
import { setVisualTags, transformDrag, visualState, type VisualState } from "./visual-transform";
const state: VisualState = { position: { x: 100, y: 100 }, origin: { x: 100, y: 100 }, rx: 0, ry: 0, rz: 0, sx: 100, sy: 50 };
const plain = { ctrl: false, shift: false, alt: false };

it("replaces only static first-block tags and aliases, preserving nested transforms and inline changes", () => {
  const text = "{\\fr10\\t(0,1000,\\frz90\\clip(1,2,3,4))\\blur2}中文{\\frz15}text\\Nmore";
  expect(setVisualTags(text, { frz: "30" })).toBe("{\\t(0,1000,\\frz90\\clip(1,2,3,4))\\blur2\\frz30}中文{\\frz15}text\\Nmore");
  expect(setVisualTags("{comment}字幕", { fscx: "125" })).toBe("{\\fscx125}{comment}字幕");
});
it("reads style defaults and margins without mistaking animated tags for the initial rotation", () => {
  const doc = parseSubtitles("[Script Info]\nPlayResX: 640\nPlayResY: 360\n[V4+ Styles]\nFormat: Name, Angle, ScaleX, ScaleY, Alignment, MarginL, MarginR, MarginV\nStyle: Default,15,120,80,2,30,10,20\n[Events]\n", "test.ass");
  doc.styles = [{ name: "Default", fields: { Angle: "15", ScaleX: "120", ScaleY: "80", Alignment: "2", MarginL: "30", MarginR: "10", MarginV: "20" } }];
  const cue = blankCue(0, 1000, "{\\t(0,1000,\\frz120)}中文");
  expect(visualState(doc, cue)).toMatchObject({ rz: 15, sx: 120, sy: 80, position: { x: 330, y: 340 } });
});
it("rotates counter-clockwise and snaps Z angles to 30 degrees with Ctrl", () => {
  expect(transformDrag("rotate-z", state, { x: 150, y: 100 }, { x: 100, y: 50 }, state.origin, plain)).toEqual({ frz: "90" });
  expect(transformDrag("rotate-z", state, { x: 150, y: 100 }, { x: 150, y: 88 }, state.origin, { ...plain, ctrl: true })).toEqual({ frz: "0" });
});
it("uses native XY two-degrees-per-pixel and Shift single-axis constraints", () => {
  expect(transformDrag("rotate-xy", state, { x: 0, y: 0 }, { x: 10, y: 5 }, state.origin, plain)).toEqual({ frx: "350", fry: "20" });
  expect(transformDrag("rotate-xy", state, { x: 0, y: 0 }, { x: 10, y: 5 }, state.origin, { ...plain, shift: true })).toEqual({ frx: "0", fry: "20" });
});
it("uses native scale increments, Alt aspect lock and Ctrl 25-percent snapping", () => {
  expect(transformDrag("scale", state, { x: 0, y: 0 }, { x: 20, y: -10 }, state.origin, plain)).toEqual({ fscx: "125", fscy: "62" });
  expect(transformDrag("scale", state, { x: 0, y: 0 }, { x: 40, y: 0 }, state.origin, { ...plain, alt: true })).toEqual({ fscx: "150", fscy: "75" });
  expect(transformDrag("scale", state, { x: 0, y: 0 }, { x: 16, y: -16 }, state.origin, { ...plain, ctrl: true })).toEqual({ fscx: "125", fscy: "75" });
});
