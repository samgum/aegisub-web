# Aegisub Web

An installable Aegisub-compatible subtitle workstation for timing, styling, karaoke and media workflows.

**Live app:** https://samgum.github.io/aegisub-web/

The desktop workspace follows Aegisub's native video/audio/editor/grid hierarchy and uses the
original Aegisub application and toolbar artwork. Tablet and phone layouts keep the subtitle
grid and selected-line editor as the default workspace.

## What is included

- A native-density cue grid in Aegisub's `# / L / Start / End / CPS / Style / Actor / Effect /
  Left / Right / Vert / Text` order, with matching selection/in-frame colours, literal ASS `\N`,
  multi-selection, comments, exact-time duplicate, merge, split, search/replace and keyboard timing.
- Byte-faithful ASS/SSA, SRT, and WebVTT editing, plus MicroDVD, LRC, TTML/DFXP, SBV,
  SubViewer, SAMI, MPL2, YouTube JSON, Spruce STL, TMPlayer, CSV, QuickTime Text,
  DVD Studio Pro, generic JSON, and TTXT conversion. Export also covers EBU Tech 3264 STL,
  Adobe Encore, TranStation, SSA v4, and untimed plain text.
- ASS style management, script properties, inline override tags, colours, transforms, fades,
  `\pos`/`\move`, rectangular/inverse clips, vector drawings, effects, waveform karaoke,
  embedded-font attachments, bundled Source Han Sans/Serif CN preview fallbacks, and
  permission-based local font collection for exact project matching.
- Media preview with custom Aegisub controls (no browser control frame), fit-to-pane and
  pointer-centred wheel/trackpad or touch-pinch zoom, libass rendering, and multi-track MKV/MP4
  subtitle import. WAV, FLAC, Opus, Vorbis, MP3, AAC/M4A, ALAC, AIFF and CAF audio share the waveform,
  spectrum, seek and speed paths; ALAC/AIFF/CAF use the bundled Aurora/Apache-2.0 decoder fallback. The audio
  display supports left-button start timing and right-button end timing. Also included are
  screenshots, vector clips and configurable long-duration blank video.
- Whisper transcription and M2M-100/NLLB translation with WebGPU acceleration and
  CPU/WASM fallback. Models are downloaded on demand and cached by the browser.
- Browser-side MKV/MP4 subtitle muxing. Chromium's File System Access API streams large output
  directly to disk; other browsers receive a normal download.
- SGMY tools ported from `samgum/Aegisub`: configurable common-error repair, text cleanup,
  OpenCC Simplified/Traditional conversion, paired-punctuation checks, overflow estimation,
  editable Japanese furigana placement, adjacent-timing stitching, keyframe/timecode snapping,
  ASS resolution resampling, and a music-player-style scrolling-lyrics generator.
- Automation 4 compatibility through a Fengari Lua 5.3 worker implementing
  `aegisub.register_macro`, subtitle mutation, selections and common API helpers, plus the
  JavaScript Worker extension API. Saved and autoload extensions remain local to the browser.
- A full nspell/Hunspell spelling window with suggestions, replace/ignore/all actions,
  personal words, bundled English, and custom `.aff`/`.dic` loading; configurable
  OpenAI-compatible grammar analysis keeps API keys in memory only.
- IndexedDB subtitle autosave version history and recent files, responsive touch UI, dark/light themes, drag-and-drop, Chinese,
  English, Japanese, and French UI, service-worker caching, and an installable PWA manifest.

Local video/audio files and decoded PCM are never written to IndexedDB or Cache Storage. Replacing
media, closing media, refreshing or leaving the page revokes Blob URLs and tears down decoder and
AudioContext state.

The pinned upstream command/dialog inventory is tracked in
[docs/PARITY_AUDIT.md](docs/PARITY_AUDIT.md). Inventory coverage is not treated as a substitute
for end-to-end workflow tests.

The detailed desktop-to-web mapping is in [docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md), and
the browser/device test matrix is in [docs/PLATFORM_SUPPORT.md](docs/PLATFORM_SUPPORT.md).

## Browser support

| Platform | Recommended browser | Notes |
|---|---|---|
| Windows / macOS / Linux | Current Chrome, Edge, Firefox, Safari | Chrome/Edge provide the fullest file-system and WebGPU path. |
| Android | Current Chrome or Chromium-based browser | Install from the browser menu; large media automatically uses memory-safe streaming mode. |
| iPhone / iPad | Current Safari | Use Share → Add to Home Screen. Downloads replace direct arbitrary-file overwrite. |

Browsers cannot load native LuaJIT binaries,
VapourSynth/Avisynth, DirectShow, or arbitrary system-codec plug-ins. Those capabilities are
mapped to Fengari Lua, WebAssembly/WebCodecs media paths, Picture-in-Picture, or explicit
Worker extensions. HDR and Dolby
Vision preview quality follows the browser, OS, display, and hardware decoder; the app does not
claim reference colour-grading output.

## Development

Requirements: Node.js 24+ and npm 11+.

```bash
npm ci
npm run dev
```

Validation:

```bash
npm run typecheck
npm test
npm run build
npm run build:demo
npm run test:e2e
npm run test:platforms
```

The repository also contains independent format checks against ffmpeg, ffprobe, pysubs2, and
xmllint:

```bash
npm run corpus
npm run check:writers
npm run check:xml
npm run check:mux
```

GitHub Pages is deployed by `.github/workflows/deploy.yml` after a successful static build.
The site base is relative, so forks and project Pages subpaths work without code changes.

## Automation extension API

Choose a local `.lua` or `.js` file in **Automation → Automation extension manager**. Standard
Aegisub macros can register through `aegisub.register_macro`; the first registered macro runs
against the current subtitle document and selection. JavaScript extensions export
`run(doc, api)` using CommonJS syntax and returns a subtitle document or `{ doc, message }`:

```js
module.exports.run = (doc, api) => {
  for (const cue of doc.cues) {
    if (cue.assKind !== "Comment") cue.text = cue.text.trim();
  }
  return { doc, message: "Trimmed dialogue lines" };
};
```

Both runtimes are isolated from the editor DOM. JavaScript extensions time out after 15 seconds
and must return a structurally valid document. Lua uses 5.3 semantics rather than LuaJIT 5.2;
native `io`, FFI, DLL modules, and process spawning are intentionally unavailable in a webpage.

## Architecture

- `src/` — format model, parsers/serializers, editor, media/timeline integration, ML workers,
  Aegisub compatibility tools, and public library API.
- `demo/` — the full Aegisub Web application shell, PWA assets, IndexedDB recovery, menus, and
  responsive layout.
- `test-corpus/` — independently authored/validated subtitle fixtures.
- `cypress/` — real-browser editing, conversion, collaboration, tool, PWA, and mobile tests.

## Provenance and license

This application uses the MIT-licensed
[`hikashop-nicolas/subedit`](https://github.com/hikashop-nicolas/subedit) editor as its browser
foundation and implements the workflow and SGMY feature surface of
[`samgum/Aegisub`](https://github.com/samgum/Aegisub). The original notices are preserved.

Project code is distributed under the MIT License. Bundled dependencies retain their own
licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and package metadata.
