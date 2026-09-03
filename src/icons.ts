// The deployed application ships the original Aegisub artwork under aegisub-icons/.
// Keep the few web-only glyphs inline, but use the upstream icons whenever an Aegisub
// command has one so the toolbar remains visually recognisable to existing users.
const svgIcon = (inner: string): string =>
  `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const nativeIcon = (name: string): string =>
  `<img class="se-native-icon" src="./aegisub-icons/${name}.svg" width="20" height="20" alt="" aria-hidden="true">`;

export const ICON = {
  add: nativeIcon("new_toolbutton"),
  remove: nativeIcon("delete_button"),
  shift: nativeIcon("shift_times_toolbutton"),
  overlaps: nativeIcon("timing_processor_toolbutton"),
  styles: nativeIcon("style_toolbutton"),
  script: nativeIcon("properties_toolbutton"),
  mic: svgIcon('<rect x="6" y="2" width="4" height="7" rx="2"/><path d="M4 7a4 4 0 0 0 8 0M8 11v2.5M6 13.5h4"/>'),
  fade: svgIcon('<path d="M2 13l5-10v10z" fill="currentColor" stroke="none"/><path d="M14 13L9 3v10z" fill="currentColor" stroke="none" opacity="0.5"/>'),
  transform: svgIcon('<path d="M12.5 5A5.5 5.5 0 1 0 13 8.5"/><path d="M11 2.5v3h3"/>'),
  clip: nativeIcon("visual_clip"),
  draw: nativeIcon("visual_standard"),
  save: nativeIcon("save_toolbutton"),
  transcribe: nativeIcon("automation_toolbutton"),
  translate: nativeIcon("translation_toolbutton"),
  savevideo: nativeIcon("export_menu"),
  undo: nativeIcon("undo_button"),
  redo: nativeIcon("redo_button"),
  setstart: nativeIcon("substart_to_video"),
  setend: nativeIcon("subend_to_video"),
  playcue: nativeIcon("button_playline"),
  follow: nativeIcon("toggle_video_autoscroll"),
  merge: nativeIcon("kara_join"),
  split: nativeIcon("kara_split"),
  search: nativeIcon("find_button"),
  problems: nativeIcon("select_lines_button"),
  more: svgIcon('<circle cx="3.5" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r="1.1" fill="currentColor" stroke="none"/>'),
  tune: nativeIcon("options_button"),
  meta: nativeIcon("automation_toolbutton"),
};
