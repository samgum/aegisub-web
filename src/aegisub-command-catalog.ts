// Command ids extracted from samgum/Aegisub commit dc2a5b448174a194127f165e2446fcb5810a8a55.
// This is the parity contract: the web port is not considered complete while any command is
// classified as missing without a browser-sandbox justification and an actual replacement.
export const UPSTREAM_AEGISUB_COMMANDS = [
  "app/about", "app/display/audio_subs", "app/display/full", "app/display/subs", "app/display/video_subs",
  "app/exit", "app/language", "app/log", "app/new_window", "app/options", "app/toggle/global_hotkeys",
  "app/toggle/toolbar", "app/updates", "app/minimize", "app/maximize", "app/bring_to_front",
  "audio/close", "audio/open", "audio/open/blank", "audio/open/noise", "audio/open/video",
  "audio/view/spectrum", "audio/view/waveform", "audio/save/clip", "audio/play/current", "audio/play/line",
  "audio/play/selection", "audio/play/toggle", "audio/stop", "audio/play/selection/before",
  "audio/play/selection/after", "audio/play/selection/end", "audio/play/selection/begin", "audio/play/to_end",
  "audio/commit", "audio/commit/default", "audio/commit/next", "audio/commit/stay", "audio/go_to",
  "audio/go_to/start", "audio/go_to/end", "audio/scroll/left", "audio/scroll/right",
  "audio/playback/speed/increase", "audio/playback/speed/decrease", "audio/opt/autoscroll",
  "audio/opt/autocommit", "audio/opt/autonext", "audio/opt/spectrum", "audio/opt/vertical_link", "audio/karaoke",
  "am/reload", "am/reload/autoload", "am/manager", "am/meta",
  "edit/color/primary", "edit/color/secondary", "edit/color/outline", "edit/color/shadow", "edit/style/bold",
  "edit/style/italic", "edit/style/underline", "edit/style/strikeout", "edit/font", "edit/find_replace",
  "edit/line/copy", "edit/line/cut", "edit/line/delete", "edit/line/duplicate", "edit/line/split/after",
  "edit/line/split/before", "edit/line/join/as_karaoke", "edit/line/join/concatenate",
  "edit/line/join/keep_first", "edit/line/paste", "edit/line/paste/over", "edit/line/recombine",
  "edit/line/split/by_karaoke", "edit/line/split/estimate", "edit/line/split/preserve", "edit/line/split/video",
  "edit/redo", "edit/undo", "edit/revert", "edit/clear", "edit/clear/text", "edit/insert_original",
  "grid/line/next", "grid/line/next/create", "grid/line/prev", "grid/sort/actor", "grid/sort/actor/selected",
  "grid/sort/effect", "grid/sort/effect/selected", "grid/sort/end", "grid/sort/end/selected", "grid/sort/layer",
  "grid/sort/layer/selected", "grid/sort/start", "grid/sort/start/selected", "grid/sort/style",
  "grid/sort/style/selected", "grid/tag/cycle_hiding", "grid/tags/hide", "grid/tags/show", "grid/tags/simplify",
  "grid/move/up", "grid/move/down", "grid/swap",
  "help/bugs", "help/contents", "help/irc", "help/video", "help/website",
  "keyframe/close", "keyframe/open", "keyframe/save", "recent/audio/", "recent/keyframes/", "recent/subtitle/",
  "recent/timecodes/", "recent/video/", "subtitle/attachment", "subtitle/find", "subtitle/find/next",
  "subtitle/insert/after", "subtitle/insert/after/videotime", "subtitle/insert/before",
  "subtitle/insert/before/videotime", "subtitle/new", "subtitle/close", "subtitle/open", "subtitle/open/autosave",
  "subtitle/open/charset", "subtitle/open/video", "subtitle/properties", "subtitle/save", "subtitle/save/as",
  "subtitle/select/all", "subtitle/select/visible", "subtitle/spellcheck",
  "time/continuous/end", "time/continuous/start", "time/frame/current", "time/shift", "time/snap/end_video",
  "time/snap/scene", "time/lead/both", "time/lead/in", "time/lead/out", "time/length/increase",
  "time/length/increase/shift", "time/length/decrease", "time/length/decrease/shift", "time/start/increase",
  "time/start/decrease", "time/snap/start_video", "time/next", "time/prev", "timecode/close", "timecode/open",
  "timecode/save", "tool/lyrics_scroll", "tool/export", "tool/font_collector", "tool/line/select",
  "tool/resampleres", "tool/style/assistant", "tool/styling_assistant/commit", "tool/styling_assistant/preview",
  "tool/style/manager", "tool/time/kanji", "tool/time/stitch", "tool/style/overlap_check", "tool/text/cleanup",
  "tool/text/chinese_convert", "tool/text/pair_check", "tool/ai/analysis_settings", "tool/text/furigana",
  "tool/time/fix_common_errors", "tool/time/postprocess", "tool/translation_assistant",
  "tool/translation_assistant/commit", "tool/translation_assistant/preview", "tool/translation_assistant/next",
  "tool/translation_assistant/prev", "tool/translation_assistant/insert_original", "video/aspect/cinematic",
  "video/aspect/custom", "video/aspect/default", "video/aspect/full", "video/aspect/wide", "video/close",
  "video/copy_coordinates", "video/subtitles_provider/cycle", "video/detach", "video/details", "video/focus_seek",
  "video/frame/copy", "video/frame/copy/raw", "video/frame/copy/subs", "video/frame/next",
  "video/frame/next/boundary", "video/frame/next/keyframe", "video/frame/next/large", "video/frame/prev",
  "video/frame/prev/boundary", "video/frame/prev/keyframe", "video/frame/prev/large", "video/frame/save",
  "video/frame/save/raw", "video/frame/save/subs", "video/jump", "video/jump/end", "video/jump/start", "video/open",
  "video/open/dummy", "video/opt/autoscroll", "video/play", "video/play/line", "video/show_overscan",
  "video/reset_pan", "video/zoom/100", "video/stop", "video/zoom/200", "video/zoom/50", "video/zoom/in",
  "video/zoom/out", "video/tool/cross", "video/tool/drag", "video/tool/rotate/z", "video/tool/rotate/xy",
  "video/tool/scale", "video/tool/clip", "video/tool/vector_clip", "video/tool/vclip/drag", "video/tool/vclip/line",
  "video/tool/vclip/bicubic", "video/tool/vclip/convert", "video/tool/vclip/insert", "video/tool/vclip/remove",
  "video/tool/vclip/freehand", "video/tool/vclip/freehand_smooth",
] as const;

export type UpstreamAegisubCommand = typeof UPSTREAM_AEGISUB_COMMANDS[number];
export type CommandParityStatus = "implemented" | "browser-replacement" | "partial" | "missing";

const IMPLEMENTED_EXACT = new Set<string>([
  "app/about", "app/display/audio_subs", "app/display/full", "app/display/subs", "app/display/video_subs", "app/language",
  "app/log", "app/new_window", "app/options", "app/toggle/global_hotkeys", "app/toggle/toolbar", "app/updates",
  "audio/close", "audio/open", "audio/open/blank", "audio/open/noise", "audio/open/video", "audio/view/spectrum",
  "audio/view/waveform", "audio/save/clip", "audio/play/current", "audio/play/line",
  "audio/play/selection", "audio/play/toggle", "audio/play/selection/before", "audio/play/selection/after",
  "audio/play/selection/end", "audio/play/selection/begin", "audio/play/to_end", "audio/commit", "audio/commit/default",
  "audio/commit/next", "audio/commit/stay", "audio/go_to", "audio/go_to/start", "audio/go_to/end", "audio/scroll/left",
  "audio/scroll/right", "audio/stop", "audio/playback/speed/increase", "audio/playback/speed/decrease",
  "audio/opt/autoscroll", "audio/opt/autocommit", "audio/opt/autonext", "audio/opt/spectrum", "audio/opt/vertical_link", "audio/karaoke",
  "am/reload", "am/reload/autoload", "am/manager", "am/meta", "help/bugs", "help/contents", "help/irc", "help/video", "help/website",
  "recent/audio/", "recent/keyframes/", "recent/subtitle/", "recent/timecodes/", "recent/video/", "subtitle/attachment", "subtitle/find", "subtitle/find/next",
  "subtitle/insert/after", "subtitle/insert/after/videotime",
  "subtitle/insert/before", "subtitle/insert/before/videotime", "subtitle/properties", "subtitle/select/all",
  "subtitle/select/visible", "subtitle/spellcheck", "subtitle/new", "subtitle/close", "subtitle/open",
  "subtitle/open/autosave", "subtitle/open/charset", "subtitle/open/video", "subtitle/save", "subtitle/save/as",
  "keyframe/open", "keyframe/close", "keyframe/save",
  "timecode/open", "timecode/close", "timecode/save", "tool/lyrics_scroll", "tool/export", "tool/font_collector",
  "tool/line/select", "tool/resampleres", "tool/style/assistant", "tool/styling_assistant/commit",
  "tool/styling_assistant/preview", "tool/style/manager", "tool/time/kanji", "tool/time/stitch",
  "tool/style/overlap_check", "tool/text/cleanup", "tool/text/chinese_convert", "tool/text/pair_check",
  "tool/ai/analysis_settings", "tool/text/furigana", "tool/time/fix_common_errors", "tool/time/postprocess",
  "tool/translation_assistant", "tool/translation_assistant/commit", "tool/translation_assistant/preview",
  "tool/translation_assistant/next", "tool/translation_assistant/prev", "tool/translation_assistant/insert_original",
  "video/aspect/cinematic", "video/aspect/custom", "video/aspect/default",
  "video/aspect/full", "video/aspect/wide", "video/close", "video/copy_coordinates", "video/detach", "video/details",
  "video/focus_seek", "video/frame/copy", "video/frame/copy/raw", "video/frame/copy/subs", "video/frame/save",
  "video/frame/save/raw", "video/frame/save/subs", "video/frame/next",
  "video/frame/next/boundary", "video/frame/next/keyframe", "video/frame/next/large", "video/frame/prev",
  "video/frame/prev/boundary", "video/frame/prev/keyframe", "video/frame/prev/large", "video/jump", "video/jump/end",
  "video/jump/start", "video/open", "video/open/dummy", "video/opt/autoscroll", "video/play", "video/play/line", "video/show_overscan",
  "video/reset_pan", "video/stop", "video/zoom/50",
  "video/zoom/100", "video/zoom/200", "video/zoom/in", "video/zoom/out", "video/tool/cross", "video/tool/drag",
  "video/tool/rotate/z", "video/tool/rotate/xy", "video/tool/scale", "video/tool/clip",
  "video/tool/vector_clip", "video/tool/vclip/drag", "video/tool/vclip/line", "video/tool/vclip/bicubic",
  "video/tool/vclip/convert", "video/tool/vclip/insert", "video/tool/vclip/remove", "video/tool/vclip/freehand",
  "video/tool/vclip/freehand_smooth",
]);

const IMPLEMENTED_PREFIXES = ["edit/", "grid/", "time/"];

const BROWSER_REPLACEMENTS = new Set<string>([
  "app/exit", "app/minimize", "app/maximize", "app/bring_to_front", "video/detach",
  "video/subtitles_provider/cycle",
  "app/options", "audio/opt/autocommit", "audio/opt/vertical_link",
  "am/reload", "am/reload/autoload", "am/manager", "am/meta",
]);

const PARTIAL_COMMANDS = new Set<string>();

export function aegisubCommandStatus(command: string): CommandParityStatus {
  if (PARTIAL_COMMANDS.has(command)) return "partial";
  if (BROWSER_REPLACEMENTS.has(command)) return "browser-replacement";
  if (IMPLEMENTED_EXACT.has(command) || IMPLEMENTED_PREFIXES.some((prefix) => command.startsWith(prefix))) return "implemented";
  return "missing";
}

export function aegisubParitySummary(): Record<CommandParityStatus, number> {
  return UPSTREAM_AEGISUB_COMMANDS.reduce<Record<CommandParityStatus, number>>((summary, command) => {
    summary[aegisubCommandStatus(command)] += 1;
    return summary;
  }, { implemented: 0, "browser-replacement": 0, partial: 0, missing: 0 });
}
