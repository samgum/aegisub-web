# Source inventory and incomplete parity audit

Pinned source: `samgum/Aegisub` commit `dc2a5b448174a194127f165e2446fcb5810a8a55`.

`src/aegisub-command-catalog.test.ts` and `src/aegisub-dialog-catalog.test.ts` check the
inventory, not equivalence. Finding a command string or opening a dialog cannot establish
native behavior. The previous zero-partial/zero-missing table was not a valid acceptance
result and has been withdrawn. See [REPLICATION_PLAN.md](REPLICATION_PLAN.md).

## Inventory scope

There are 243 command IDs and 33 dialog surfaces in the pinned inventory. Runtime status
counts are computed by the catalogs. Audio, timing, video and automation workflows remain
partial pending native comparisons, including after individual regression tests pass.
An `implemented` entry only records a code path; it is not a complete-replica certification.

“Browser replacement” does not mean a disabled menu item. It means an actual web-safe path is
present but the desktop primitive cannot exist in a sandboxed page.

## Command replacements

| Desktop command(s) | Web implementation |
|---|---|
| `app/exit`, `app/minimize`, `app/maximize`, `app/bring_to_front` | Close guidance, Fullscreen API, focus, and OS/browser window controls. |
| `app/options` | Browser-specific settings for timing, spellcheck, theme, hotkeys, persistence and media behavior. |
| `audio/opt/vertical_link` | Native cubic-gain sliders and linking; actual file/procedural output uses gain nodes. Physical-device and exhaustive native output comparison remain pending. |
| `audio/save/clip` | Saved selection span, PCM16 mono/native generic conversion and cancellable range decoding. Independent PCM/FFmpeg sample checks cover selected fixtures; compressed surround mixing and terminal padding remain partial. |
| `am/reload`, `am/reload/autoload`, `am/manager`, `am/meta` | Local extension registry with autoload, Fengari Lua 5.3 macros and isolated JavaScript workers. |
| `video/subtitles_provider/cycle` | One deterministic libass-WASM renderer replaces the desktop provider plug-in chain. |
| `video/detach` | Picture-in-Picture API. |

## Dialog replacements

| Desktop dialog | Web implementation |
|---|---|
| Automation manager | Local/autoload Lua and JavaScript registry; no executable autoload directory scanning. |
| Detached video | Picture-in-Picture controlled by the browser. |
| Generic selected-choices helper | Native accessible select/list controls inside each owning dialog. |

## Format parity additions

Besides the editable 18-format corpus, the parser and export paths implement the formats and SGMY extensions present in the desktop fork:

- Enhanced LRC (`<mm:ss.xx>` inline word karaoke to `\kf`, trailing line-end markers, `[offset:+/-ms]`, spacer skipping, and untimed fallback).
- TTML / DFXP (`tt:` prefixed namespaces, `dur` attributes, nested spans, `<span begin=..>` word karaoke to `\kf`, and `ttm:role="x-bg"` overlapping harmony line splitting).
- EBU Tech 3264 STL: binary GSI/TTI blocks, 23.976/24/25/29.97/30 standards, UTF-8,
  ISO-6937 and ISO-8859-5/6/7/8 character tables, wrapping, display standards, alignment,
  offsets and inclusive end times.
- Adobe Encore and TranStation SMPTE text exports.
- SubStation Alpha v4 export.
- Aegisub plain-text actor/comment import and export.

## SGMY & visual tool completions

- **Common-error & cleanup tools**: `IsAssWhitespaceOnly` preserves `template` and `\p1+` drawing lines; text cleanup tracks checked/per-line counts and double-space runs; Stitch supports `midpoint` / `previous` / `next` anchors, ms/frames units, and history.
- **Same-style overlap & overflow**: Detailed per-style overlap dialog (`exact`, `sameStart`, `sameEnd`, `crossing`) with clickable grid selection; inline-tag-aware overflow checks (`\fs`, `\fscx`, `\fsp`, `\pos`, `\move`, `\N`, `\p0+` exclusion) surfaced in the edit box and problems panel.
- **Furigana & scrolling lyrics**: Kanji occurrence extraction, Hiragana/Katakana conversion, built-in dictionary auto-fill, bilingual secondary-style pairing, resolution presets, alignment, and source-line handling (`delete` / `comment` / `keep`).
- **Visual typesetting & dialogs**: Interactive `\pos`/`\move` SVG crosshair & drag handles, cubic Bézier control handles for vector clips, relative multi-selection visual transforms, synchronized Time/Frame Jump-To dialog, style/actor/effect/regex/case Search & Replace, expanded Script Info & Video Details, inline `\fn` font collection, clickable sortable grid headers, and Automation 4 `aegisub.dialog.display` + preloaded `karaskel`/`utils`/`unicode`/`re`/`clipboard` Lua modules.

Native LuaJIT FFI, process spawning, DLL loading, DirectShow, Avisynth and VapourSynth remain
outside a browser security sandbox. A Worker registry is not an implemented native bridge.
The requested optional extension path remains work to do, not accepted parity.
