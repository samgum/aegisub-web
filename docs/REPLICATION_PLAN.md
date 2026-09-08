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

Second increment `c539a61` passed all nine target CI jobs ([34180530841](https://github.com/samgum/aegisub-web/actions/runs/34180530841))
and Pages deployment ([34180749242](https://github.com/samgum/aegisub-web/actions/runs/34180749242)).
The live site then indexed the 12-frame VFR fixture and displayed the next frame at 0.120001 s.

Third increment: on-video D/F/G rotation/scale gestures using the native angle, pixel-delta,
axis-lock, aspect-lock and snapping formulas; draggable rotation origin; isolated live ASS
preview, pointer-up commit, one-step undo and Escape cancellation. First-block tag updates
preserve nested transforms and later inline overrides. Chromium/Firefox tests verify both
saved text and actual libass canvas scaling/undo; an Android touch-event test verifies drag
and returning to the subtitle editor. Current local suite: 369 unit cases, 44 applicable
browser cases in three profiles (22 explicitly skipped). Native perspective guide rendering,
move/clip control-point fidelity, origin multi-selection and physical touch acceptance remain
unfinished; these tools are not marked full parity.

Third increment `58b379a` passed all nine CI jobs ([34181389242](https://github.com/samgum/aegisub-web/actions/runs/34181389242))
and was fast-forwarded to the public main branch. Font lifecycle work now underway fixes
late Chinese/inline-font introduction, fingerprints font bytes rather than filename/size,
recognizes embedded family/full/PostScript aliases, and removes owned FontFace objects on
preview disposal. Missing unbundled weights remain explicitly missing, not Regular aliases.

Pages deployment [34181614869](https://github.com/samgum/aegisub-web/actions/runs/34181614869)
published the on-frame tools. A fresh browser on the public site then dragged G and verified
saved `fscx150`/`fscy125` tags. Font regressions now also verify a real embedded WOFF2
FontFace is removed on video close, inline Medium loads after an English-only video, and
unsupported Bold remains identified as missing. The embedded decoder uses a preallocated
byte buffer and a single decode per preview initialization. Local-font collection matches
full/PostScript names as well as families. These tests do not claim exact glyph identity
for arbitrary unavailable fonts or all font collections.

## Remaining implementation and verification

1. Transport: verify the new frame index/seek path against decoded frame images and native
   VFR fixtures, not only media.currentTime; streaming audio analysis/export retaining original channels/sample rate; reliable
   unsupported-codec audio (including video with ALAC) on every target engine. Audio clip
   export for file audio is still 16k mono; synthetic audio exports native-rate PCM16.
2. Native timing: adaptive zoom/scroll, keyframe snapping, playback-follow options, linked
   gain/volume, audio cache policy, full pointer-cancel and repeated-commit edge cases.
3. Visual typesetting: complete native perspective/origin/move/clip control-point behavior
   and per-frame guide updates beyond the new on-frame rotation/scale implementation.
4. ASS preview/fonts: eliminate stale paused-frame renders; compare pixel output with
   desktop libass for Chinese glyphs, weight/name matching, fn overrides, drawings,
   karaoke, transforms, animated clipping and effects. Missing fonts cannot be called exact.
5. Editing/dialogs: project media links/restoration, clipboard and text/history boundaries, all hotkey contexts, style and
   translation assistants, timing processor, import/export settings and window behavior.
6. Automation: native-compatible Lua API/module semantics and actual extension bridge for
   unavoidable native operations. A Fengari worker alone is not full Automation 4 parity.
7. Phone/tablet/desktop: reachable grid + editor in portrait/landscape, soft keyboard/IME,
   pointer vs touch behaviors, trackpad/pinch zoom; physical iOS/Android and macOS/Linux/
   Windows acceptance beyond emulated viewport and user-agent tests.
8. Publishing: only publish verified increments, keeping incomplete status explicit. Check
   CI and the actual GitHub Pages build after pushing; do not equate deployment with parity.

## Encoder-free virtual providers (current increment)

The previous turn made verified implementation and deployment progress through `c82e1eb`.
This increment replaces the old encoded-file dummy implementation (removed `dummy-media.ts`)
with an explicitly canvas-backed video and seekable transport. It preserves independently
loaded audio and uses libass canvas mode for ASS. No video encoder or encoded media Blob is
created. Duration uses frame count and decimal/fractional FPS, with saved settings and native
8×8 checkerboard behavior. Allocation depends on background size, not frame count.

Blank/noise audio are independent 150-minute, 44.1 kHz mono sources, matching native duration
and format. Noise uses a seek-stable procedural generator in the native amplitude range;
native random-engine bit identity is not promised. An AudioWorklet outputs that signal;
the waveform, FFT and PCM16 export use the same sample function. Noise PCM is generated
on demand rather than allocating the entire 150-minute clip. Waveform display is decimated;
full-range FFT runs off-thread and is cancellable. File-audio analysis/export still needs
the separate streaming/quality work listed above.

Local tests explicitly disable VideoEncoder/AudioEncoder. Canvas preview/clock tests pass
in Chromium and the local Windows WebKit runtime. Windows WebKit lacks Web Audio (its
AudioContext is undefined), so real noise-output acceptance requires the configured macOS
runner. Chromium tests measure output through AnalyserNode, not just an advancing clock.
This increment is not complete until its full regression/target CI and deployed path pass.

Local evidence: 384 unit cases pass (11 existing skips); 60 applicable Playwright cases in
Chromium/Firefox/Android profiles pass (24 explicit skips). The old Cypress dummy test was
updated from encoded-media/seconds assumptions to frame-count/Canvas behavior; its 19-case
spec passes, with the other 49 Cypress cases passing in the preceding full run. FFT equality
is tested against raw procedural PCM, including the silent source's zero spectrum. Native
random-engine bit identity and exhaustive colored checkerboard rounding are not claimed.

Next: finish virtual-provider regression and publication, then address file-audio streaming,
quality and remaining native visual-edit workflows. Do not close the goal at a command-count milestone.
