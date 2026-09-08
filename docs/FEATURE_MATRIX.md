# Aegisub desktop → Aegisub Web feature matrix

This matrix is an implementation inventory, not a claim that a sandboxed webpage is a binary
build of wxWidgets Aegisub. “Web equivalent” means the user-facing result is available through
a browser-safe implementation. “Extension bridge” marks native desktop APIs that browsers do
not expose.

| Area | Desktop capability | Aegisub Web implementation | Status |
|---|---|---|---|
| Interface | Native menu, toolbar artwork, video/audio/editor/grid hierarchy | Original Aegisub application and toolbar assets; native-density desktop arrangement | Visual/workflow comparison pending |
| Project | New/open/save, BOM/EOL preservation, crash recovery | Local file picker/download, byte-faithful model, IndexedDB autosave | Implemented; desktop comparison pending |
| Formats | ASS/SSA, SRT and common subtitle formats | 18 editable formats plus EBU STL, Encore, TranStation, SSA and plain-text export/import | Implemented; desktop comparison pending |
| Grid | Cue list, multi-select, comments, actor, effect, margins, layer | Native upstream column order, dynamic empty columns, 9pt-density rows, upstream colours and literal `\N` | Implemented; desktop comparison pending |
| Editing | Undo/redo, add/delete, duplicate, split/merge, copy/paste | Exact-time block duplicate, local history and command API | Implemented; desktop comparison pending |
| Search | Find/replace and next/previous | Live find bar and replace-all | Implemented; desktop comparison pending |
| QA | CPS, duration, overlap, long-line warnings | CPS/duration checks, problem panel, estimated rendered overflow | Partial / comparison pending |
| Styles | Style manager/editor and script properties | Full ASS style fields, duplicate/delete, PlayRes/wrap properties, embedded fonts and bundled Source Han CN preview fallbacks | Implemented; desktop comparison pending |
| Overrides | Bold/italic/underline, colours, font, transforms, fade | ASS override toolbar and transform panels | Implemented; desktop comparison pending |
| Visual typesetting | Position/move, origin, clip/iclip, drawing | Interactive preview overlays and vector editor | Implemented; desktop comparison pending |
| Karaoke | Syllable timing and `\k`/`\kf` authoring | Waveform karaoke editor with distributed timing | Implemented; desktop comparison pending |
| Video | Local preview, seek, subtitle overlay | Frame-synchronised libass effects, custom controls without browser chrome; fit/aspect, pointer-centred wheel/trackpad and touch-pinch zoom, frame capture, vector clip, overscan, PiP and configured blank video | Partial / comparison pending |
| HDR | HDR/BT.2020/Dolby Vision preview | Browser/OS hardware decode and tone mapping; no RPU reference pipeline | Browser dependent |
| Audio | Waveform, spectrum, playback, clips, speed | WAV/FLAC/Opus/Vorbis/MP3/AAC/M4A/ALAC/AIFF/CAF, left-start/right-end waveform timing, Worker FFT, WAV clips and pitch-preserving 0.25×–4× speed | Partial / comparison pending |
| Large media | Multi-GB files | Disk-backed playback/output; memory-heavy scans disabled above a device-aware limit | Partial: full-file scans skipped |
| Timing | Mark in/out, shift, overlaps, drag/resize | Selection stops playback and seeks to line start; keyboard/playhead tools and native left/right audio markers | Implemented; desktop comparison pending |
| Timing processor | Lead/gap/duration cleanup | Style/selection filters, collision-safe leads, biased continuity and asymmetric keyframe thresholds | Implemented; desktop comparison pending |
| Keyframes/timecodes | Load, save and snap to scenes | Aegisub keyframes v1 and timecodes v1/v2, recent lists, VFR frame shifts and export | Partial / comparison pending |
| Resample | Script/video resolution handling | Stretch/add-border/remove-border modes, PlayRes/style/margin/position/move/clip scaling and mismatch dialog | Implemented; desktop comparison pending |
| Text cleanup | CJK punctuation and whitespace cleanup | Tag-preserving SGMY cleanup port | Implemented; desktop comparison pending |
| Chinese conversion | Simplified ↔ Traditional | Bundled OpenCC phrase dictionaries, no runtime dictionary fetch | Implemented; desktop comparison pending |
| Pair check | Quotes/brackets pairing | ASCII/CJK pair scanner with clickable cue results | Implemented; desktop comparison pending |
| Furigana | SGMY Japanese ruby annotation | User-editable reading map generates independently movable, positioned libass events | Partial / comparison pending |
| Lyrics scroll | SGMY music-player scroll generator | Resolution/style/context controls and animated stacked ASS events | Implemented; desktop comparison pending |
| Spellcheck | Hunspell dictionaries and correction dialog | nspell window, suggestions/actions, bundled English, personal/custom Hunspell dictionaries | Implemented; desktop comparison pending |
| Translation | Translation assistant | Manual line assistant plus M2M-100/NLLB track translation with tag preservation | Implemented; desktop comparison pending |
| Transcription | External/manual workflow | Whisper transcription with WebGPU/CPU fallback | Added capability |
| Attachments/fonts | ASS font attachments and font collector | Embedded/collected bytes are passed to live libass; missing-font action uses local access or upload fallback | Partial / comparison pending |
| Export/mux | Subtitle export/filter/container workflow | Ordered cleanup/timing/resample filters, editable formats, EBU STL legacy tables, Encore/TranStation/SSA/text and streamed MKV/MP4 mux | Implemented; desktop comparison pending |
| Automation 4 | LuaJIT macros/modules | Fengari Lua macro API and local/autoload registry; JavaScript Worker bridge for web-native extensions | Browser replacement |
| Native plugins | VSFilter, VapourSynth, Avisynth, DirectShow | libass/WASM/WebCodecs/media remux paths | Browser replacement |
| Collaboration | Not standard desktop Aegisub | Host API for remote cue/document fields and peer cursors | Added capability |
| Mobile/tablet | Desktop-only layout | Subtitle-first workspace with explicit Subtitle/Video/Audio tabs, 40–44px cue rows and touch controls | Web adaptation |

## Known browser boundaries

1. Safari and Firefox do not expose Chromium's File System Access API, so save is a download.
2. WebGPU availability depends on browser, GPU, and driver; ML tools fall back to CPU/WASM.
3. A webpage cannot execute LuaJIT FFI, native Lua modules, or codec DLLs. Fengari covers
   portable Lua macros; font upload/local-font permission and Worker extensions cover web-safe paths.
4. Very large media stays playable, but embedded-track and waveform scans that require a full
   byte view are disabled above the memory safety threshold on lower-memory devices.
5. Furigana uses an explicit reading map rather than a bundled Japanese morphological model;
   every generated reading remains an ordinary editable ASS event.
