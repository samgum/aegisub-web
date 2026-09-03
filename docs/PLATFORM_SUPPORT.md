# Platform and device validation

The application has three workspace modes:

- Desktop: Aegisub-style video pane at upper left, audio waveform/spectrum and selected-line
  editor at upper right, and the full subtitle grid across the bottom.
- Tablet: an explicit Subtitles / Video / Audio switcher. Subtitles is the default and keeps
  both the cue grid and selected-line text editor visible.
- Phone: the same three workspaces with 44px cue rows and touch-size controls. Subtitle editing
  remains the default view.

## Automated matrix

`playwright/platforms.spec.ts` opens a real ASS file, verifies the upstream menu hierarchy,
selects a cue, edits its text, downloads the result, and verifies serialization in every
project. Desktop projects additionally exercise the upstream Default/Grid/Video/Edit Box hotkey
contexts, row-selection stop-and-seek, exact duplicate timing, mouse left/right waveform timing,
fit-to-pane and wheel/trackpad zoom. Mobile projects use touch input to select a cue, change its
start time and pinch the video preview. Every browser verifies WAV, FLAC, Opus, Vorbis, MP3,
AAC/M4A, ALAC, AIFF and CAF playback, installed-app `launchQueue`, Service Worker control and
the cached executable shell; Chromium and
Firefox also perform a true offline reload.

| Project | Runtime | Target path |
|---|---|---|
| `windows-chromium` | Windows runner + Chromium | Windows Chrome/Edge desktop |
| `linux-firefox` | Ubuntu runner + Firefox | Linux Firefox desktop |
| `macos-webkit` | macOS runner + WebKit | macOS Safari engine path |
| `android-chromium` | Chromium + Pixel 7 profile | Android Chrome layout/input |
| `ipad-webkit` | WebKit + iPad Pro 11 profile | iPadOS Safari layout/input |
| `iphone-webkit` | WebKit + iPhone 15 profile | iOS Safari layout/input |

The Cypress production workflow additionally verifies literal ASS `\N`, native grid columns,
font bytes reaching libass, media-before-subtitle persistence, stop-and-seek row selection, FFT
spectrum, serialization/reopening and the complete tablet edit/video/audio cycle.

## Browser-specific paths

- Chromium exposes direct file-system writing and optional local-font access where the user
  grants permission.
- Safari/WebKit and Firefox use the download path when direct file writing is unavailable.
- Keyboard shortcuts accept both Control and Command modifiers. Touch layouts do not require a
  hardware keyboard.
- WebGPU features fall back to WASM when the browser or GPU does not expose WebGPU.
