import { describe, expect, it } from "vitest";
import { TimingDraft } from "./timing-draft";
import { blankCue } from "./cue";
import { History } from "./history";

describe("audio marker drafts", () => {
  it("does not change the saved line until commit, and preserves intervening text edits", () => {
    const cue = blankCue(1000, 3000, "原文\\N第二行");
    const draft = new TimingDraft();
    draft.set(cue, 1200, 2700);
    expect(cue.startMs).toBe(1000);
    expect(draft.read(cue).startMs).toBe(1200);
    cue.text = "已修改\\N第二行";
    const committed = draft.commit([cue]);
    expect(committed[0]).toMatchObject({ startMs: 1200, endMs: 2700, text: cue.text });
    expect(draft.pending).toBe(false);
  });
  it("discards pending markers when reverting without an undo entry", () => {
    const cue = blankCue(1000, 3000);
    const draft = new TimingDraft();
    draft.set(cue, 1500, 3500);
    draft.clear();
    expect(draft.read(cue)).toBe(cue);
    expect(draft.pending).toBe(false);
  });
  it("normalizes crossing markers and supports zero-duration ranges like the native controller", () => {
    const cue = blankCue(1000, 3000);
    const draft = new TimingDraft();
    draft.set(cue, 4000, 2000);
    expect(draft.read(cue)).toMatchObject({ startMs: 2000, endMs: 4000 });
    draft.set(cue, -20, -10);
    expect(draft.read(cue)).toMatchObject({ startMs: 0, endMs: 0 });
    draft.set(cue, 1000, 3000);
    expect(draft.pending).toBe(false);
  });
  it("commits several selected lines as one reversible document transaction", () => {
    const cues = [blankCue(1000, 2000), blankCue(3000, 4000)];
    const history = new History<typeof cues>(structuredClone);
    history.reset(cues);
    const draft = new TimingDraft();
    for (const cue of cues) draft.set(cue, cue.startMs + 250, cue.endMs + 250);
    history.begin();
    const committed = draft.commit(cues);
    history.commit(committed);
    expect(history.undo(committed)).toEqual(cues);
    expect(history.redo(cues)).toEqual(committed);
    expect(cues[0].startMs).toBe(1000);
  });
});
