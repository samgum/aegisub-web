export interface AegisubHotkeyEvent {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export type AegisubHotkeyContext = "default" | "grid" | "video" | "audio" | "edit-box";

const modified = (event: AegisubHotkeyEvent): boolean => !!(event.ctrlKey || event.metaKey);
const plain = (event: AegisubHotkeyEvent): boolean => !modified(event) && !event.altKey;

/** Keypad bindings in the upstream "Always" context and Medusa-mode audio overrides. */
export function resolveAegisubOverrideHotkey(event: AegisubHotkeyEvent, medusa: boolean): string | undefined {
  const code = event.code ?? "";
  const key = event.key.toLowerCase();
  if (modified(event) && !event.altKey && !event.shiftKey && code === "NumpadMultiply") return "app/toggle/global_hotkeys";

  if (plain(event)) {
    const always: Record<string, string> = {
      NumpadEnter: "audio/commit",
      Numpad5: "audio/play/selection",
      Numpad3: "audio/play/selection/after",
      Numpad1: "audio/play/selection/before",
      Numpad8: "audio/stop",
      Numpad7: "time/length/decrease",
      Numpad9: "time/length/increase",
      Numpad2: "time/next",
      Numpad0: "time/prev",
      Numpad4: "time/start/decrease",
      Numpad6: "time/start/increase",
    };
    if (!event.shiftKey && always[code]) return always[code];
  }
  if (!medusa) return undefined;

  if (modified(event) && event.shiftKey && !event.altKey) {
    if (event.key === "ArrowUp") return "audio/playback/speed/increase";
    if (event.key === "ArrowDown") return "audio/playback/speed/decrease";
  }
  if (!plain(event)) return undefined;
  if (code === "NumpadAdd") return event.shiftKey ? "time/length/increase/shift" : "time/length/increase";
  if (code === "NumpadSubtract") return event.shiftKey ? "time/length/decrease/shift" : "time/length/decrease";
  if (event.shiftKey && key === "g") return "audio/commit/default";
  if (event.shiftKey) return undefined;
  const medusaKeys: Record<string, string> = {
    enter: "audio/commit", g: "audio/commit", r: "audio/play/line", s: "audio/play/selection",
    " ": "audio/play/selection", w: "audio/play/selection/after", q: "audio/play/selection/before",
    e: "audio/play/selection/begin", d: "audio/play/selection/end", t: "audio/play/to_end",
    b: "audio/play/toggle", a: "audio/scroll/left", f: "audio/scroll/right", h: "audio/stop",
    c: "time/lead/in", v: "time/lead/out", arrowright: "time/next", x: "time/next",
    arrowleft: "time/prev", z: "time/prev",
  };
  return medusaKeys[key];
}

/** Default-context shortcuts from the pinned upstream default_hotkey.json. */
export function resolveAegisubDefaultHotkey(event: AegisubHotkeyEvent): string | undefined {
  const code = event.code ?? "";
  const key = event.key.toLowerCase();
  const mod = modified(event);
  if (event.altKey && !mod) {
    if (key === "o") return "app/options";
    if (event.key === "ArrowUp") return "grid/move/up";
    if (event.key === "ArrowDown") return "grid/move/down";
    return undefined;
  }
  if (!mod && !event.altKey) {
    if (event.key === "F1") return "help/contents";
    if (event.key === "F2") return "subtitle/save";
    if (event.key === "F3") return "subtitle/find/next";
    return undefined;
  }
  if (!mod || event.altKey) return undefined;

  if (code === "Numpad2") return "grid/line/next";
  if (code === "Numpad8") return "grid/line/prev";
  if (code === "Numpad6") return "video/frame/next";
  if (code === "Numpad4") return "video/frame/prev";
  if (code === "NumpadAdd") return "video/zoom/in";
  if (code === "NumpadSubtract") return "video/zoom/out";

  if (event.key === "Delete") return "edit/line/delete";
  if (event.key === " ") return "video/focus_seek";
  if (event.shiftKey) {
    if (key === "d") return "edit/line/split/after";
    if (key === "v") return "edit/line/paste/over";
    if (key === "s") return "subtitle/save/as";
    if (key === "z") return "edit/redo";
    return undefined;
  }
  const defaults: Record<string, string> = {
    q: "app/exit", h: "edit/find_replace", c: "edit/line/copy", x: "edit/line/cut",
    d: "edit/line/split/before", v: "edit/line/paste", y: "edit/redo", z: "edit/undo",
    f: "subtitle/find", n: "subtitle/new", o: "subtitle/open", s: "subtitle/save", i: "time/shift",
    "1": "video/jump/start", "2": "video/jump/end", "3": "time/snap/start_video",
    "4": "time/snap/end_video", "5": "time/snap/scene", "6": "time/frame/current",
    g: "video/jump", p: "video/play",
  };
  return defaults[key];
}

/** Context bindings from upstream default_hotkey.json. Aegisub resolves the focused
 * control's context before the Default context; keeping this separate prevents browser
 * text fields from swallowing edit-box Enter/colour commands and prevents the grid's
 * frame-navigation keys from being mistaken for row navigation. */
export function resolveAegisubContextHotkey(
  event: AegisubHotkeyEvent,
  context: AegisubHotkeyContext,
): string | undefined {
  if (context === "audio") return resolveAegisubOverrideHotkey(event, true);

  const key = event.key.toLowerCase();
  const mod = modified(event);
  if (context === "edit-box") {
    if (!mod && !event.altKey && !event.shiftKey && (event.key === "Enter" || event.code === "NumpadEnter")) {
      return "grid/line/next/create";
    }
    if (!mod && event.altKey && !event.shiftKey) {
      const colours: Record<string, string> = {
        "1": "edit/color/primary",
        "2": "edit/color/secondary",
        "3": "edit/color/outline",
        "4": "edit/color/shadow",
      };
      return colours[key];
    }
    return undefined;
  }

  if (context === "grid" && mod && !event.altKey && !event.shiftKey && key === "a") {
    return "subtitle/select/all";
  }

  if (context === "grid" || context === "video") {
    const direction = event.key === "ArrowRight" ? "next" : event.key === "ArrowLeft" ? "prev" : "";
    if (direction) {
      if (mod && !event.altKey && !event.shiftKey) return `video/frame/${direction}/boundary`;
      if (!mod && event.shiftKey && !event.altKey) return `video/frame/${direction}/keyframe`;
      if (!mod && event.altKey && !event.shiftKey) return `video/frame/${direction}/large`;
      if (!mod && !event.altKey && !event.shiftKey) return `video/frame/${direction}`;
    }
  }

  if (context === "video" && !mod && !event.altKey && !event.shiftKey) {
    const tools: Record<string, string> = {
      a: "video/tool/cross",
      s: "video/tool/drag",
      d: "video/tool/rotate/z",
      f: "video/tool/rotate/xy",
      g: "video/tool/scale",
      h: "video/tool/clip",
      j: "video/tool/vector_clip",
    };
    return tools[key];
  }
  return undefined;
}
