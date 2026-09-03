import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { UPSTREAM_AEGISUB_COMMANDS, aegisubCommandStatus, aegisubParitySummary } from "./aegisub-command-catalog";

describe("upstream Aegisub command parity contract", () => {
  it("tracks every command from the pinned upstream source", () => {
    expect(UPSTREAM_AEGISUB_COMMANDS).toHaveLength(243);
    expect(new Set(UPSTREAM_AEGISUB_COMMANDS).size).toBe(243);
  });

  it("classifies every command and reports remaining work honestly", () => {
    for (const command of UPSTREAM_AEGISUB_COMMANDS) expect(["implemented", "browser-replacement", "partial", "missing"]).toContain(aegisubCommandStatus(command));
    const summary = aegisubParitySummary();
    expect(summary.implemented + summary["browser-replacement"] + summary.partial + summary.missing).toBe(243);
    expect(summary.missing).toBe(0);
    expect(summary.partial).toBe(0);
  });

  it("routes every classified command through the editor or application shell", () => {
    const runtimeSources = ["src/editor.ts", "demo/demo.ts"]
      .map((path) => readFileSync(resolve(path), "utf8"))
      .join("\n");
    const unrouted = UPSTREAM_AEGISUB_COMMANDS.filter((command) =>
      !command.startsWith("grid/sort/") && !runtimeSources.includes(`"${command}"`),
    );
    expect(unrouted).toEqual([]);
  });
});
