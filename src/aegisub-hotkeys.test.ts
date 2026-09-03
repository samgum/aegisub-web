import { describe, expect, it } from "vitest";
import { resolveAegisubContextHotkey, resolveAegisubDefaultHotkey, resolveAegisubOverrideHotkey } from "./aegisub-hotkeys";

describe("upstream hotkey contexts", () => {
  it("maps representative default-context shortcuts", () => {
    expect(resolveAegisubDefaultHotkey({ key: "d", ctrlKey: true })).toBe("edit/line/split/before");
    expect(resolveAegisubDefaultHotkey({ key: "D", ctrlKey: true, shiftKey: true })).toBe("edit/line/split/after");
    expect(resolveAegisubDefaultHotkey({ key: "F3" })).toBe("subtitle/find/next");
    expect(resolveAegisubDefaultHotkey({ key: "6", ctrlKey: true })).toBe("time/frame/current");
    expect(resolveAegisubDefaultHotkey({ key: "+", code: "NumpadAdd", ctrlKey: true })).toBe("video/zoom/in");
    expect(resolveAegisubDefaultHotkey({ key: "s", metaKey: true })).toBe("subtitle/save");
    expect(resolveAegisubDefaultHotkey({ key: "S", metaKey: true, shiftKey: true })).toBe("subtitle/save/as");
  });

  it("keeps keypad-always commands available without Medusa mode", () => {
    expect(resolveAegisubOverrideHotkey({ key: "Enter", code: "NumpadEnter" }, false)).toBe("audio/commit");
    expect(resolveAegisubOverrideHotkey({ key: "2", code: "Numpad2" }, false)).toBe("time/next");
    expect(resolveAegisubOverrideHotkey({ key: "*", code: "NumpadMultiply", ctrlKey: true }, false)).toBe("app/toggle/global_hotkeys");
  });

  it("enables and disables Medusa letter overrides", () => {
    expect(resolveAegisubOverrideHotkey({ key: "g" }, false)).toBeUndefined();
    expect(resolveAegisubOverrideHotkey({ key: "g" }, true)).toBe("audio/commit");
    expect(resolveAegisubOverrideHotkey({ key: "G", shiftKey: true }, true)).toBe("audio/commit/default");
    expect(resolveAegisubOverrideHotkey({ key: "ArrowUp", ctrlKey: true, shiftKey: true }, true)).toBe("audio/playback/speed/increase");
  });

  it("maps the upstream subtitle-grid and video contexts", () => {
    expect(resolveAegisubContextHotkey({ key: "ArrowRight" }, "grid")).toBe("video/frame/next");
    expect(resolveAegisubContextHotkey({ key: "ArrowLeft", ctrlKey: true }, "grid")).toBe("video/frame/prev/boundary");
    expect(resolveAegisubContextHotkey({ key: "ArrowRight", shiftKey: true }, "video")).toBe("video/frame/next/keyframe");
    expect(resolveAegisubContextHotkey({ key: "ArrowLeft", altKey: true }, "video")).toBe("video/frame/prev/large");
    expect(resolveAegisubContextHotkey({ key: "a", metaKey: true }, "grid")).toBe("subtitle/select/all");
    expect(resolveAegisubContextHotkey({ key: "g" }, "video")).toBe("video/tool/scale");
  });

  it("maps edit-box Enter/colour keys and audio-context keys", () => {
    expect(resolveAegisubContextHotkey({ key: "Enter" }, "edit-box")).toBe("grid/line/next/create");
    expect(resolveAegisubContextHotkey({ key: "3", altKey: true }, "edit-box")).toBe("edit/color/outline");
    expect(resolveAegisubContextHotkey({ key: "s" }, "audio")).toBe("audio/play/selection");
  });
});
