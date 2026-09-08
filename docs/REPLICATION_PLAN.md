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
   VFR fixtures, not only media.currentTime; streaming audio analysis and provider-faithful audio export; reliable
   unsupported-codec audio (including video with ALAC) on every target engine. Audio clip
   export no longer uses the ASR 16k copy (see the source-derived increment below).
   Compressed-provider mixing, terminal codec padding and physical-device codec coverage still need native comparison.
   Custom project timecode remapping across preview/playback/seeking and frame capture,
   offscreen preview capture, and original-resolution subtitle-frame export remain open.
2. Native timing: exhaustive pointer-cancel/auto-commit edge cases, negative-range and native
   ten-hour clamp behavior, segmented time-input/frame modes, audio cache policy and
   sample-accurate endpoints. Live auto-commit and basic native amendment boundaries now
   have source-derived coverage below; they are not exhaustive native GUI acceptance.
   Native zoom/scroll, keyframe/video-edge snapping and linked gain now have the regression
   coverage described below; this is not exhaustive desktop timing acceptance.
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
Virtual-provider increment `d3ea0d5` passed all nine CI jobs
([34185626553](https://github.com/samgum/aegisub-web/actions/runs/34185626553)) and Pages
deployment ([34186438052](https://github.com/samgum/aegisub-web/actions/runs/34186438052)).
A fresh browser on the public URL, with VideoEncoder disabled, created a 2-second Canvas
video and measured nonzero noise output (RMS about 0.062) from the independent 9000-second source.

Local evidence: 384 unit cases pass (11 existing skips); 60 applicable Playwright cases in
Chromium/Firefox/Android profiles pass (24 explicit skips). The old Cypress dummy test was
updated from encoded-media/seconds assumptions to frame-count/Canvas behavior; its 19-case
spec passes, with the other 49 Cypress cases passing in the preceding full run. FFT equality
is tested against raw procedural PCM, including the silent source's zero spectrum. Native
random-engine bit identity and exhaustive colored checkerboard rounding are not claimed.

## Audio viewport corrections (current increment)

Source comparison found that the previous A/F commands scrolled seconds rather than the
native 128 pixels; auto-scroll incorrectly toggled subtitle-grid follow; and every media/
pane change fit the entire timeline. The viewport now starts at native 50 px/s, preserves
zoom, scrolls 128 pixels, and implements 5%-margin selected-range visibility independently
of grid follow. Cursor-lock scrolling is optional and off by default. Lead-out defaults to
native 350 ms, and explicit zero lead values are respected. Native toggle artwork replaces
the text-checkbox strip. Normal dialogue mode no longer draws invented subtitle-text labels,
fade triangles or karaoke divisions over the waveform; it displays ranges and boundaries.

Focused checks: 12 viewport cases across Chromium/Firefox/Android plus existing platform
regressions (38 passing, 10 intentional skips); the full local browser run then passed 72
cases with 24 intentional skips. A pre-existing Cypress race was exposed: the tablet test
clicked through before the asynchronous resolution-mismatch modal appeared. The test now
completes the actual Ignore choice instead of bypassing it; all five production-workflow
cases pass. Remaining audio interaction work includes
exact snapping/Shift inversion, drag-scroll, marker sensitivity, gain/volume linking, and
streaming file-audio rendering. In particular native snapping defaults on; the older gesture
implementation still needs its snap-target and modifier logic reconciled.
Dummy project URI restoration and generated timecode-file export also remain to be completed.

## 4K playback and native style-management repair (2026-09-08)

Work is now directly on `main`, per user instruction; no new validation branches.

The embedded video player eagerly copied/scanned the complete video even when the editor
guard skipped large-file analysis. Common MP4/MOV/WebM inputs now use a disk-backed native
video with one active AV transport. Independent audio audition remains available, but does
not decode/play the same soundtrack a second time during video playback. Compatibility
decode remains selectable in the Video menu for unsupported native formats.

ASS uses a separately owned, display-sized canvas renderer clocked by presented video frames.
Changing fonts does not recreate the video element. Audio waveform extraction uses a
cancellable worker and BlobSource/AudioSampleSink; it retains peaks, not a whole-file copy
or complete PCM. Legacy waveform fallback is restricted to 64 MiB. Unsupported large-file
waveforms are reported explicitly. Normal playback restores a cached waveform bitmap and
updates its cursor rather than rasterizing the waveform/spectrum and all cue bands per frame.
Embedded subtitle extraction is explicit and currently limited to 512 MiB; stream-based
embedded-subtitle extraction and whole-file legacy audio export remain open work.

Measured locally with a generated 8-second 3840×2160 30fps H.264/AAC motion pattern (34 MB):
154 video frames, zero dropped frames over about 5 seconds; a native-video-only baseline
also dropped zero frames. Whole input File.arrayBuffer calls: zero. Subtitle raster:
618×347 in a 1440×900 viewport. A transport probe counted zero full waveform repaints and
129 cursor updates while the hidden audio stayed paused and native video remained audible.
This is a bounded Windows/Chromium benchmark, not a guarantee for every 4K codec/device.
The optional repeatable test takes `AEGISUB_4K_FIXTURE`; it is explicitly skipped when no
real fixture is supplied, not counted as universal CI performance coverage.

The style manager previously retained a detached style object after its first Apply cloned
the host document. The new editor resolves the current document on every Apply, preserves
unknown fields, updates renamed cue references, and implements OK/Cancel/Apply with an
isolated draft. A native-style light dialog exposes the font/style fields, numeric ASS alpha,
alignment grid and actual libass sample preview. The manager separates persistent named
storage libraries from current-script styles, with edit/copy/delete/reorder, cross-copy and
validated ASS/STY/JSON import; malformed input cannot replace existing styles. Mobile dialogs
scroll within the viewport with reachable actions. Native audio zoom buttons provide a touch
alternative to wheel zoom, including iPad/iPhone WebKit where the test protocol has no wheel.

The long-term goal remains incomplete: full physical-device acceptance, native automation
semantics and the outstanding timing/visual-workflow items above still require verification.

Cross-platform publication checks exposed two follow-ups: Safari retained HAVE_METADATA
without a first image under `preload=metadata`, so native preview now requests frame data
with `preload=auto`. Rapid style-open/cancel reproduced a Firefox target crash (2/16 local
stress cases) while terminating a compiling WASM worker. Renderer retirement now waits for
a post-initialization get-styles handshake before terminating; font URLs outlive that
retirement and a 30-second watchdog bounds failed startup. The same 16 stress cases pass
after this change; browser tests also require the preview-worker count to return to zero.

## Native audio interaction and gain controls (2026-09-08)

Source comparison: `audio_display.cpp` mouse, zoom and scroll handlers;
`audio_timing_dialogue.cpp` marker selection and SnapMarkers; `audio_marker.cpp` keyframe
START midpoints and video START/END snap points; `audio_box.cpp` linked cubic gain and
`libresrc/default_config.json` defaults. No new base repository/history was introduced.
The obsolete validation branch was deleted at user request after proving its commits are
reachable from main; only main remains locally and remotely.

Implemented: default-on 8px snapping with Shift inversion, provider-before-dialogue ties,
group-wide Alt snapping and origin adjustment, Ctrl coincident markers among visible lines,
inactive-line/comment visibility, drag-timing toggle and sensitivity. Ruler drag pans;
middle drag seeks and pauses video. Dragging outside the viewport uses the native 50ms
scroll delay/5% inset; releasing at an edge applies the native one-third-width adjustment.
Escape/pointercancel restores the pre-gesture draft without contaminating the saved doc.

Audio wheel now pans by default, with Ctrl/Command inversion, and horizontal zoom uses
the native -30..50 levels and piecewise factor formula. Desktop-style vertical zoom,
amplitude and volume sliders plus a scrollbar are present, with larger touch controls.
Amplitude and volume use (clamp(position,1,100)/50)^3, and link defaults on. Non-unity file
audio gain uses the native decoder as one MediaElementAudioSource, not a second player.
Muting, idle suspension and source-node disconnection are explicit. Procedural audio's
analyser is downstream of its gain node, allowing tests to verify actual changed output.
Default-unity video audio retains the native fast path from the previous 4K repair.

Focused tests check pending 4000ms snap versus Shift-unsnapped 3900ms, cancellation and
single-step G/undo; 1979/2021ms frame snap boundaries; ruler and outside-drag scrolling;
native zoom breakpoints; actual 1/8 signal level at slider25 versus slider50 for both
procedural noise and a 48kHz PCM file. Output nodes must be released on audio close.
Local full regression at this increment: 396 unit tests (11 existing skips), 68 Cypress
tests and 96 Playwright tests across Chromium/Firefox/Android profiles (30 explicit skips).
The 4K benchmark and target macOS/Linux/Windows CI are checked separately before handoff.
Physical device validation and the other remaining objective requirements stay open.

## Live timing commits and paused-frame replacement (2026-09-08)

Compared `AudioTimingControllerDialogue::SetMarkers/DoCommit/Revert`,
`SubsController::OnCommit` and `agi::Time` formatting. The browser previously applied
automatic timing only on pointer-up and made every automatic change a manual-style undo
entry. It now commits each marker update to the actual document, while an explicit history
revision lets uninterrupted automatic updates amend one entry. Time passing alone does
not split that entry. Text/metadata edits, active-line changes, undo/redo and an accepted
save form boundaries. Cancelling the Save As picker does not form a save boundary.

Runtime cue objects remain stable during live commits, so actor/style controls cannot
retain a detached cue. Immutable timing snapshots share unchanged fields rather than
cloning embedded fonts repeatedly. Multi-selection is included in undo snapshots. The
preview is updated at most once per browser paint, instead of waiting for the old trailing
300ms subtitle debounce. Live committed markers retain their exact positions; reselecting
an ASS line reads centisecond-rounded stored time, matching native marker initialization.

ASS timestamp export already had the correct 5ms half-up rule. Its edit fields now also
show H:MM:SS.cc; duration subtracts individually rounded boundaries, as the desktop time
controls do. SRT and other non-ASS millisecond displays remain unchanged. Native masked
input, negative live-marker coordinates and full ten-hour boundary comparisons remain open.

Real canvas tests exposed a separate libass-WASM worker bug: replacing the track with one
having no visible event reset change detection but did not emit a blank frame, leaving
old subtitle pixels visible while paused. The asset-copy adapter forces only the initial
render after setTrack; ordinary video ticks are unchanged. It checks the exact pinned
worker method and fails on an incompatible upgrade. Copyright notices are preserved.
The renderer worker URL has an adapter revision to bypass stale HTTP caches on updates.

Checks: 401 unit cases pass (11 existing skips), 68 Cypress cases pass, and 115 applicable
Chromium/Firefox/Android-profile cases pass (35 explicit skips). New workflows verify
commit-before-pointer-up, amendments past 500ms and across gestures, separate text/save/
selection boundaries, live actor controls, whole-selection undo, ASS/SRT precision and
the actual transition from painted to blank ASS at a fixed paused video time. An additional
12-case Chromium run covers dummy video and the 4K benchmark with the revised worker URL.
These are bounded workflow checks, not proof of the complete replication objective.

## Presented-frame subtitle clock (2026-09-08)

Source: `VideoController::RequestFrame` passes the selected frame's time to the subtitle
provider; FFMS2 builds integer-ms timecodes from packet PTS, while dummy video uses the
rounded CFR clock. The web native-video path mixed callback mediaTime with the advancing
HTML currentTime on subtitle edits, pause and seeked. Regressions first reproduced a
1.000-second frame being rendered at 1.014 seconds and a 0.958-second frame at 0.966.

Rendering now holds the last submitted frame's timestamp when editing or pausing. A seek
does not advance ASS before its new image is presented. Real frame callbacks bypass the
additional 60Hz throttle, which could otherwise lose a paused seek or uneven 60Hz update.
Firefox additionally reports the seek target as callback mediaTime in some paused seeks;
the demuxed presentation-order index resolves that timestamp to the actual decoded frame.
The clock is resynchronized when asynchronous indexing completes. Engines without frame
callbacks retain a documented media-clock fallback, not a guarantee of compositor identity.

Frame-step commands and video-boundary timing use the displayed frame, with an explicit
pending target to accumulate rapid steps before asynchronous decoding finishes. Decoder
seeks use raw packet times independently of project timecode overrides. Dummy video now
uses the common renderer's guarded initialization/retirement and native rounded CFR times.

Proof includes real callback/worker timestamp tracing for playback, edits, pause and seek;
pixel geometry of an animated ASS rectangle at its expected paused-frame coordinate; and
FFmpeg PNG oracles for a between-frame VFR seek. At a 0.150-second seek, Firefox reported
0.150 but displayed the independently verified 0.120-second frame; ASS now receives 0.120.
The correct PNG's structural error was about 0.0011, versus 0.045 for the wrong frame.
The test drawing appeared at x=150 with width=12 as derived from its ASS geometry.

Local full suite: 404 unit cases pass (11 existing skips), 68 Cypress cases pass, and
133 browser cases pass in Chromium/Firefox/Android profiles (35 explicit skips). Tests
also cover stepping from a paused playback frame and accumulating three immediate steps.
Native desktop pixel identity for every font/effect, legacy decoder paths, custom timecode
remapping and physical-device behavior still require the remaining full-objective audit.

Follow-up checks also exercise rapid same-frame edits with widely separated drawing
positions, so an old but nearby image cannot satisfy the pixel check. WebKit may submit
one last frame after pause; the animated-drawing oracle now samples frame metadata and
pixels together and requires three matching samples with the unchanged 2px tolerance.
An iPhone rapid audio-switch check exposed a stalled pause/replay path. Output gain now
coalesces pending resumes and waits for an in-flight suspension before resuming; native
media pauses immediately, while context suspension is deferred by a 300ms idle interval.
Still-playing muted video is not mistaken for idle audio. Unit checks cover rapid replay,
late initial resume, muted playback and teardown; this is defensive lifecycle hardening,
not a claim about a proven browser-internal root cause.

Windows CI additionally exposed a seek/step ordering gap: currentTime had reached a
newly selected line, but its compositor callback still described frame zero, so an
immediate next-frame command jumped back toward the beginning. All editor seek commands
and native seeking events now record the pending target; the target is recalculated if
packet indexing finishes later. Regression checks step synchronously from seeked, before
the new presentation callback, and repeat the normal grid/video hotkey sequence.

## Selected-audio export (current increment)

`audio/save/clip` now uses the min start / max end of the saved selected lines, not
only the active line and not pending timing markers. ASS times use native centiseconds;
sample boundaries are ceilings and the exclusive end is clamped to provider length.
Playback gain and speed do not alter the downloaded PCM. Export has its own cancellable
worker/job strip; source replacement, close and editor disposal cancel the old job.
Waveform analysis and ASR caches are independent. No media bytes are stored persistently.

The earlier plan's "retain original channels" target was wrong for the native generic
provider. `provider_convert.cpp` converts individual channels to signed PCM16, averages
those integers to mono, then repeatedly doubles rates below 32 kHz using integer linear
midpoints. 44.1/48/96 kHz are not reduced to 16 kHz. Raw PCM packets bypass the dependency's
lossy integer-normalization round trip. Native PCM WAV decoding precedes FFmpegSource in
the factory's hidden-provider ordering. The relevant original permissive notice is retained.

File export reads a bounded range with transform-codec preroll. Decoded data is converted
in chunks and completed output kept as immutable Blobs, not a full-track Float32 array.
An instrumented 115 MB WAV fixture forbids whole-file reads and measures consumed bytes,
not the size of lazy Blob slices. It requires under 4 MiB read for a 10 ms clip at 500 s.
The procedural source shares the same header, ceiling rules and cancellation semantics.

Independent FFmpeg sample points test WAV, FLAC, Opus, Vorbis, AAC, ALAC, AIFF, CAF and
AC-3, including mid-file chirp clips where a phase shift cannot pass. Tests exposed missing
preroll, Opus reset pre-skip, Vorbis priming timestamps (including Firefox's empty frame),
and Matroska CodecDelay. Export now compensates those paths using packet/header metadata.
Vorbis uses packet-associated decoded output instead of the pinned sink's timestamp reset.
The existing replaceable libav assets handle AC-3/E-AC-3 in the export worker as well.

This is **not full audio-provider parity**. FFmpegSource may apply its own channel-layout
mixing before the common mono converter; compressed surround matrix identity has not been
compared with the desktop binary. Ogg terminal granule/discard-padding handling still differs
from the demuxer's last-packet duration and needs a provider-length audit. ALAC/AIFF/CAF
currently enter export through the player's already-decoded WAV; their initial whole-file
conversion and original high-bit-depth fidelity remain separate unfinished work. The source
and FFmpeg checks do not certify every codec, every last sample or physical mobile devices.

Local verification for this increment: 428 unit cases pass (11 existing skips), all
68 Cypress cases pass, and 187 Playwright cases pass in Chromium/Firefox/Android profiles
(35 explicit skips). The latter includes all 48 audio-clip cases across those profiles.
Safari-engine media acceptance is delegated to the real macOS CI runner, not inferred
from a Windows WebKit runtime that lacks usable native audio decoding.

Public browser verification of `c6f26f4` compared actual downloaded WAV samples for
WAV, ALAC, AC-3 and mid-file Opus/Vorbis against the reference (maximum error 0 or 1
PCM unit), while verifying that the video element survived every audio/subtitle change.
The release's macOS/iPad/iPhone CI exposed a FLAC export failure; it is not accepted as
passed. Subsequent tests report the worker's error immediately and retain failure artifacts.
The same visual check exposed missing CJK fallback on non-ASS files. Font preparation and
change detection now include plain formats. The SRT regression failed with two identical
tofu-box images before the fix; it now requires distinct ink for 甲甲/乙乙 and checks VTT
replacement without closing virtual video. Unit coverage also includes LRC and TTML.
