import { describe, expect, it } from "vitest";
import { AEGISUB_DIALOG_PARITY, UPSTREAM_AEGISUB_DIALOGS, aegisubDialogStatus, aegisubDialogSummary, aegisubDialogSurface } from "./aegisub-dialog-catalog";

describe("upstream Aegisub dialog parity contract", () => {
  it("tracks every source dialog and keeps partial work visible", () => {
    expect(UPSTREAM_AEGISUB_DIALOGS).toHaveLength(33);
    expect(new Set(UPSTREAM_AEGISUB_DIALOGS).size).toBe(33);
    const summary = aegisubDialogSummary();
    expect(summary.implemented + summary["browser-replacement"] + summary.partial + summary.missing).toBe(33);
    expect(summary.missing).toBe(0);
    expect(summary.partial).toBe(0);
    for (const dialog of UPSTREAM_AEGISUB_DIALOGS) expect(["implemented", "browser-replacement", "partial"]).toContain(aegisubDialogStatus(dialog));
    expect(Object.keys(AEGISUB_DIALOG_PARITY).sort()).toEqual([...UPSTREAM_AEGISUB_DIALOGS].sort());
    for (const dialog of UPSTREAM_AEGISUB_DIALOGS) expect(aegisubDialogSurface(dialog)?.trim().length).toBeGreaterThan(12);
  });
});
