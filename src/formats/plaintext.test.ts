import { describe, expect, it } from "vitest";
import { exportPlainText, importPlainText } from "./plaintext";

describe("Aegisub plain-text import/export", () => {
  it("tracks actors, comments and blank lines", () => {
    const doc = importPlainText("Alice: Hello\n  continued\n# note\n\n", { actorSeparator: ":", commentStarter: "#", includeBlank: true });
    expect(doc.cues).toHaveLength(4);
    expect(doc.cues[0].assFields?.Name).toBe("Alice");
    expect(doc.cues[1].assFields?.Name).toBe("Alice");
    expect(doc.cues[2].assKind).toBe("Comment");
    expect(exportPlainText(doc)).toContain("Alice: Hello");
  });
});
