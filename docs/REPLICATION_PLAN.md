# Desktop behavior replication — active, incomplete

Reference: `samgum/Aegisub`, `dc2a5b448174a194127f165e2446fcb5810a8a55`.
Repository scope: `samgum/aegisub-web`; preserve existing license/provenance notices.
The earlier Git history rewrite did not replace the implementation. Do not describe it as
a from-scratch application rewrite or use a different project's history as the foundation.

## Acceptance rule

For each workflow, run the same input and operation sequence against the desktop reference
and the browser. Check actual document output, media time, sound/rendered frames and focus.
Menu presence, command-string counts and test names containing “complete” are not evidence.
Playwright device profiles are browser emulation, not actual iOS/macOS/Linux hardware tests.
Keep the long-term goal active while substantive gaps remain.

## In-progress implementation (2026-09-08)

- Separate `AudioWorkspace` from video preview: independent load/close and analysis sources;
  importing audio or a new subtitle document retains the video. Video transport can drive
  the separate audio source; audio audition pauses video instead of replacing its frame.
- `TimingDraft` keeps audio markers out of saved subtitles/ASS preview/autosave until commit.
  G commits; default auto-next is on; Shift+G sets the next draft to previous end + 3000 ms.
  Manual timing commits use a separate undo transaction. Auto-commit is optional, default off.
- `AudioTimingGesture` follows desktop far-click/near-marker/right-button/Alt-translate and
  Ctrl-coincident-marker rules, including marker crossings and multi-selection.
- Audio S/D/F/G are scoped to the audio display; Video S/D/F/G stay in video context.
  Medusa enables Always keypad overrides, not letter-key theft from the text editor.
- Prevent the pinned embedded player from stealing focus on loadeddata and delayed timers.
- Single-line video playback now stops at the line end. Audio ranges use frame/timer checks;
  sample-accurate endpoint scheduling and background-tab guarantees are still pending.

Local evidence so far: typecheck passes; 360 Vitest cases pass (11 skipped); 68 Cypress
cases pass; four new regressions pass in both Windows/Chromium and Windows/Firefox.
The paused ASS race found during regression was changed to repaint after seeked rather
than during decoding; the existing CJK/effects regression then passed five consecutive runs.
Local Windows WebKit cannot decode even a plain WAV or MP4 in an isolated native media
element (MEDIA_ERR_SRC_NOT_SUPPORTED); target macOS CI must verify Safari-engine media.
These results do not establish complete desktop parity or physical-device compatibility.

First increment `b7318e2` passed all nine GitHub CI jobs, including real macOS/Linux/Windows
runners ([run 34179750233](https://github.com/samgum/aegisub-web/actions/runs/34179750233)).
Pages deployment [34179961700](https://github.com/samgum/aegisub-web/actions/runs/34179961700)
succeeded. An isolated browser against the public URL verified a pending marker, G changing
the saved end from 3000 to 3010 ms, and WAV loading while the existing video remained mounted.

Second increment in progress: metadata-only frame indexing with a disk-backed BlobSource,
presentation-order/B-frame sorting, VFR-aware frame stepping, native frame-midpoint start/end
snapping, packet keyframes, and manual timecode override. The 24 fps/240-frame fixture and
synthetic VFR cases pass unit tests. Five workflow tests in each of Chromium and Firefox
pass locally. A generated VFR test pattern additionally matches FFprobe timestamps and
FFmpeg-decoded frame geometry when stepping forward/back (both browsers); colour identity
remains unverified, as documented in `test-corpus/VFR_ORACLE.md`.
Dummy video retains its requested virtual CFR clock rather than being reported
as one frame; its encoder-free implementation is still pending.

## Remaining implementation and verification

1. Transport: verify the new frame index/seek path against decoded frame images and native
   VFR fixtures, not only media.currentTime; streaming audio analysis/export retaining original channels/sample rate; reliable
   unsupported-codec audio (including video with ALAC) on every target engine. Audio clip
   export is still 16k mono. Dummy audio still shares the dummy-video generator: replace it.
2. Native timing: adaptive zoom/scroll, keyframe snapping, playback-follow options, linked
   gain/volume, audio cache policy, full pointer-cancel and repeated-commit edge cases.
3. Visual typesetting: replace rotation/scale parameter popovers with native on-frame
   handles and math, including perspective/origin/move/clip and per-frame updates.
4. ASS preview/fonts: eliminate stale paused-frame renders; compare pixel output with
   desktop libass for Chinese glyphs, weight/name matching, fn overrides, drawings,
   karaoke, transforms, animated clipping and effects. Missing fonts cannot be called exact.
5. Editing/dialogs: clipboard and text/history boundaries, all hotkey contexts, style and
   translation assistants, timing processor, import/export settings and window behavior.
6. Automation: native-compatible Lua API/module semantics and actual extension bridge for
   unavoidable native operations. A Fengari worker alone is not full Automation 4 parity.
7. Phone/tablet/desktop: reachable grid + editor in portrait/landscape, soft keyboard/IME,
   pointer vs touch behaviors, trackpad/pinch zoom; physical iOS/Android and macOS/Linux/
   Windows acceptance beyond emulated viewport and user-agent tests.
8. Publishing: only publish verified increments, keeping incomplete status explicit. Check
   CI and the actual GitHub Pages build after pushing; do not equate deployment with parity.

Next: finish the current regression failures, then replace the frame clock and paused ASS
renderer. Keep this list current; do not close the goal at a command-count milestone.
