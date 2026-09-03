export const UPSTREAM_AEGISUB_DIALOGS = [
  "about", "ai-analysis", "attachments", "automation", "autosave", "colorpicker", "detached-video",
  "dummy-video", "export-ebu3264", "export", "fonts-collector", "jump-to", "kara-timing-copy", "log",
  "paste-over", "progress", "properties", "resample", "search-replace", "selected-choices", "selection",
  "shift-times", "spellchecker", "style-editor", "style-manager", "styling-assistant", "text-import",
  "timing-processor", "timing-tools", "translation", "version-check", "video-details", "video-properties",
] as const;

export type UpstreamAegisubDialog = typeof UPSTREAM_AEGISUB_DIALOGS[number];
export type DialogParityStatus = "implemented" | "browser-replacement" | "partial" | "missing";

export interface DialogParityEntry {
  status: Exclude<DialogParityStatus, "missing">;
  surface: string;
}

export const AEGISUB_DIALOG_PARITY: Record<UpstreamAegisubDialog, DialogParityEntry> = {
  "about": { status: "implemented", surface: "About popover and bundled build/runtime details" },
  "ai-analysis": { status: "implemented", surface: "AI grammar settings and result modals" },
  "attachments": { status: "implemented", surface: "ASS attachment list, remove, upload and local-font collection card" },
  "automation": { status: "browser-replacement", surface: "Local/autoload Lua and JavaScript Worker registry" },
  "autosave": { status: "implemented", surface: "IndexedDB autosave-version picker" },
  "colorpicker": { status: "implemented", surface: "Accessible HTML colour wells and ASS override colour entry" },
  "detached-video": { status: "browser-replacement", surface: "Browser Picture-in-Picture" },
  "dummy-video": { status: "implemented", surface: "Resolution, duration and colour prompt plus WebCodecs generator" },
  "export-ebu3264": { status: "implemented", surface: "EBU Tech 3264 options in Export" },
  "export": { status: "implemented", surface: "Ordered filter-chain and format Export dialog" },
  "fonts-collector": { status: "implemented", surface: "Uploaded/local-font collector and ASS embedding card" },
  "jump-to": { status: "implemented", surface: "Video jump-to-time prompt" },
  "kara-timing-copy": { status: "implemented", surface: "Kanji Timer source/destination linking window" },
  "log": { status: "implemented", surface: "Application event-log dialog" },
  "paste-over": { status: "implemented", surface: "Eleven-field Paste Over dialog with presets" },
  "progress": { status: "implemented", surface: "Cancellable transcription, translation and analysis progress surfaces" },
  "properties": { status: "implemented", surface: "ASS script-properties dialog" },
  "resample": { status: "implemented", surface: "Resolution resample controls and mismatch choices" },
  "search-replace": { status: "implemented", surface: "Find, replace, next and replace-all panel" },
  "selected-choices": { status: "browser-replacement", surface: "Accessible native select and list controls in owning dialogs" },
  "selection": { status: "implemented", surface: "Criteria/action/scope Select Lines dialog" },
  "shift-times": { status: "implemented", surface: "Time/frame, direction, scope and history Shift Times dialog" },
  "spellchecker": { status: "implemented", surface: "Hunspell-compatible correction window and personal dictionary" },
  "style-editor": { status: "implemented", surface: "Full style fields inside Style Manager" },
  "style-manager": { status: "implemented", surface: "Create, edit, import, export and delete Style Manager" },
  "styling-assistant": { status: "implemented", surface: "Line-by-line styling assistant" },
  "text-import": { status: "implemented", surface: "Plain-text actor/comment/blank-line import choices" },
  "timing-processor": { status: "implemented", surface: "Lead, adjacent and keyframe Timing Post-Processor" },
  "timing-tools": { status: "implemented", surface: "Timing repair, stitch and keyframe tools" },
  "translation": { status: "implemented", surface: "Manual translation assistant and local model translation" },
  "version-check": { status: "implemented", surface: "Service-worker update check and activation flow" },
  "video-details": { status: "implemented", surface: "File, codec, dimensions, duration and frame-rate details" },
  "video-properties": { status: "implemented", surface: "Script/video resolution mismatch choices" },
};

export function aegisubDialogStatus(dialog: string): DialogParityStatus {
  return AEGISUB_DIALOG_PARITY[dialog as UpstreamAegisubDialog]?.status ?? "missing";
}

export function aegisubDialogSurface(dialog: string): string | undefined {
  return AEGISUB_DIALOG_PARITY[dialog as UpstreamAegisubDialog]?.surface;
}

export function aegisubDialogSummary(): Record<DialogParityStatus, number> {
  return UPSTREAM_AEGISUB_DIALOGS.reduce<Record<DialogParityStatus, number>>((summary, dialog) => {
    summary[aegisubDialogStatus(dialog)] += 1;
    return summary;
  }, { implemented: 0, "browser-replacement": 0, partial: 0, missing: 0 });
}
