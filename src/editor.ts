// The subtitle editor UI and the createSubtitleEditor entry point.
//
// Layout: a toolbar on top; below it a row with the cue list + a detail editor on the
// left and a video/audio preview on the right. The cue list is virtualized so files
// with thousands of cues stay responsive. The preview is a plain <video> in this phase
// (double-click a cue to seek, current cue highlights); a later phase swaps in the
// mediaplay embed for full-format playback and live subtitle rendering.

import {
  type Cue,
  type AssStyle,
  type SubtitleDoc,
  type SubtitleFormat,
  blankCue,
  assTimeMilliseconds,
  cps,
  formatAssTime,
  formatTimestamp,
  newCueId,
  parseTimestamp,
  sortCues,
  visibleText,
} from "./cue";
import { History } from "./history";
import {
  mergeCuesAt,
  splitCueAt,
  clampStart,
  clampEnd,
  findProblems,
  matchCues,
  replaceAllInCues,
  autoFixTiming,
  duplicateCues,
  pasteCues,
  rangeIds,
  type ProblemKind,
} from "./edit-ops";
import { ROW_H, OVERSCAN, CPS_WARN, CPS_BAD } from "./metrics";
import { ICON, nativeIcon } from "./icons";
import { SHORTCUTS, type Shortcut } from "./shortcuts";
import { injectStyles } from "./styles";
import { parseSubtitles, serializeSubtitles, convertDoc } from "./formats";
import { styleNames, assColorToHex, hexToAssColor, makeDefaultStyle, uniqueStyleName, getPlayRes, embeddedFontNames } from "./formats/ass";
import { openStyleEditor, openScriptProperties } from "./styles-editor";
import { openKaraoke } from "./karaoke";
import { setLocale, t, alignmentOptions } from "./i18n";
import { Timeline } from "./waveform";
import { AudioWorkspace, isAudioFile } from "./audio-workspace";
import { AudioAdjustments, openAudioTimingOptions } from "./audio-adjustments";
import { audioFlag } from "./audio-options";
import { TimingDraft } from "./timing-draft";
import { VideoFrameIndex, readVideoFrameIndex } from "./video-frame-index";
import { VisualTransformOverlay } from "./visual-transform-overlay";
import type { VisualTransformMode } from "./visual-transform";
import { decodeAudioToMono16k, extractWaveformPeaks, extractMkvSubtitles, type MediaPlayerHandle, type MkvSubtitleTrack } from "mediaplay";
import { createEmbeddedPlayer } from "./embedded-player";
import { createNativeVideoPlayer } from "./native-video-player";
import { indexedFrameSeconds } from "./presentation-time";
import { extractStreamedWaveform } from "./waveform-extractor";
import { exportAudioClip } from "./audio-clip";
import { selectedAudioClipRange } from "./audio-clip-pcm";
import { extractMp4Subtitles } from "./mp4subs";
import { runTranslate, type TranslateRun } from "./localml/translate";
import { buildTranslationPlan, applyUniqueTranslation, rebuildCueText, type TranslationPlan } from "./translate-plan";
import {
  clearCueText,
  findStyleOverlaps,
  insertCueRelative,
  joinSelectedCues,
  moveSelectedRows,
  recombineSelectedCues,
  setContinuousTiming,
  shiftSelectionToTime,
  snapSelectedToScene,
  sortCueGrid,
  splitCueAtText,
  splitCueByKaraoke,
  splitLineAtFrame,
  swapSelectedRows,
  type GridSortKey,
} from "./aegisub-operations";
import { embedAssAttachment, parseKeyframeTimes, parseTimecodes as parseTimecodeFile, resampleAssDocument } from "./aegisub-tools";
import { openStylingAssistant, openTranslationAssistant, type AssistantHandle } from "./aegisub-assistants";
import { resolveAegisubContextHotkey, resolveAegisubDefaultHotkey, resolveAegisubOverrideHotkey, type AegisubHotkeyContext } from "./aegisub-hotkeys";
import { listAutomationExtensions, runAutomationExtension } from "./automation";
import { runLuaAutomation } from "./lua-automation";
import { openVectorClip, type VectorClipHandle, type VectorClipMode } from "./vector-clip";
import { computeSpectrum, computeDummySpectrum, type SpectrumData } from "./spectrum";
import { createDummyVideoPlayer, parseDummyFrameRate, type DummyVideoElement, type DummyVideoOptions } from "./dummy-video";
import {
  openExportDialog,
  openPasteOverDialog,
  openSelectLinesDialog,
  openShiftTimesDialog,
  openStyleManagerDialog,
  openTimingPostProcessorDialog,
  type DialogHost,
} from "./aegisub-dialogs";
import { openKanjiTimer } from "./kanji-timer";
import { getAIAnalysisSettings, openAIAnalysis, openAIAnalysisSettings } from "./ai-analysis";
import { openSpellchecker } from "./spellchecker";
import { openResolutionMismatchDialog, openVideoDetails } from "./video-details";
import { parseEmbeddedFonts, type EmbeddedFont } from "./fonts";
import { requestedFontFamilies, bundledFontFilename, bundledPreviewFonts, fontBytesFingerprint, matchingLocalFonts } from "./preview-fonts";

export interface SubtitleInput {
  text: string;
  filename?: string;
}

type PreviewMedia = HTMLMediaElement | DummyVideoElement;
type PreviewPlayer = Omit<MediaPlayerHandle, "getMediaElement"> & {
  getMediaElement(): PreviewMedia | undefined;
  setSubtitleFonts?(fonts: string[]): void;
  getPresentedTime?(): number;
};

// A vertex of an ASS drawing, in PlayRes coordinates. `type` is how it connects from the
// previous vertex: "m" start, "l" straight line, "b" cubic bezier (with control points),
// "s" b-spline control point (a run of consecutive "s" nodes forms one spline).
interface DrawNode {
  type: "m" | "l" | "b" | "s";
  px: number;
  py: number;
  c1?: { px: number; py: number };
  c2?: { px: number; py: number };
}

export interface SubtitleEditorOptions {
  // Called after any edit that changes the document.
  onChange?: () => void;
  // Force a UI locale (else auto-detected from the browser).
  locale?: string;
  // Show the toolbar Save button (downloads the file). Hosts that own saving pass false.
  showSave?: boolean;
  // Use the browser's native spelling dictionaries in the dialogue editor (default true).
  spellcheck?: boolean;
  // Application-shell commands (recent files, language, update, window controls) live outside
  // the embeddable editor. Return true when the host handled a canonical Aegisub command id.
  onAegisubCommand?: (command: string) => boolean;
  /** The cue this person moved to. A shared session publishes it so the others can see it. */
  onSelectionChanged?: (cueId: string | null) => void;
}

export type EditorCommand =
  | "undo"
  | "redo"
  | "add-cue"
  | "remove-cue"
  | "duplicate-cue"
  | "copy-cues"
  | "paste-cues"
  | "merge-cue"
  | "split-cue"
  | "find-replace"
  | "problems"
  | "shift-times"
  | "fix-overlaps"
  | "aegisub-tools"
  | "transcribe"
  | "translate"
  | "save"
  | "save-video";

/** Undo and redo, when a host owns them (a collaboration session). */
export interface UndoHandler {
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

/** Another person in a shared session, and the cue they are on. */
export interface PeerCue {
  /** Stable per peer, used only to tell one marker from another. */
  id: string;
  /** Any CSS colour. Drawn as the cue row's border so several peers stay distinguishable. */
  colour: string;
  name: string;
  /** The cue they have selected, or null when they are not on one. */
  cueId: string | null;
}

export interface SubtitleEditorHandle {
  getText(): string;
  getDoc(): SubtitleDoc;
  /**
   * Everything a subtitle document is besides its cues: the ASS style table, the verbatim
   * script-info and tail, the format field orders, the line endings, and the tracks.
   *
   * One channel, keyed per entry, because they are unrelated to one another: someone
   * editing a style and someone renaming a track should not overwrite each other.
   */
  docFields(): { key: string; value: string }[];
  setDocFieldsReporter(handler: ((fields: { key: string; value: string }[]) => void) | null): void;
  /** Take a peer's styles, tracks and document fields. Reports nothing back. */
  applyRemoteDocFields(fields: { key: string; value: string }[]): void;
  /**
   * Replace the cue list from somewhere other than this editor: a collaboration peer.
   *
   * Re-renders and refreshes the preview, and deliberately does NOT fire onChange or push
   * an undo step. Firing onChange would echo the remote edit straight back to whoever sent
   * it; pushing history would put someone else's typing into your own undo stack.
   *
   * The selection is kept when the selected cue still exists, so a remote edit elsewhere
   * in the file does not move the cursor out from under you.
   */
  applyRemoteCues(cues: Cue[]): void;
  /** Cues as they stand, cloned, so a caller can diff against a later state safely. */
  cueSnapshot(): Cue[];
  /** The cue this person is on. A session publishes it on binding, so a peer is visible
   *  straight away instead of only once they next move. */
  selectedCueId(): string | null;
  selectedCueIds(): string[];
  selectCueById(cueId: string): void;
  /** Replace the active document through the normal render/preview/history path. */
  replaceDocument(doc: SubtitleDoc, message?: string): void;
  /** Open another subtitle document without destroying the loaded video/audio workspace. */
  loadDocument(input: SubtitleInput): void;
  /** Stable command surface used by the Aegisub-like application menu. */
  runCommand(command: EditorCommand): void;
  /** Run a canonical command id from samgum/Aegisub's src/command registry. */
  runAegisubCommand(command: string): boolean;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  /**
   * Hand undo and redo to the host, or pass null to take them back.
   *
   * A collaboration session must do this. This editor's own undo restores a whole-model
   * snapshot, so once a peer's edit has landed, undoing would revert THEIR work along with
   * yours and the two documents would silently diverge. A host that owns the shared
   * document can undo only what this peer did, which is the behaviour people expect.
   */
  setUndoHandler(handler: UndoHandler | null): void;
  /** Show where the other people in a session are. Replaces the whole set each call. */
  setPeerCues(peers: PeerCue[]): void;
  // Load a video/audio file into the preview pane programmatically (same as the
  // "Load video" button). Useful for a host that already has the media in hand.
  loadPreviewMedia(file: File): void;
  focus(): void;
  destroy(): void;
}

// One subtitle track of a media-anchored project: an independent, editable document plus a
// display label and (optional) language tag. Opening a bare subtitle file yields one track.
export interface Track {
  id: string;
  label: string;
  language: string;
  doc: SubtitleDoc;
  job?: TranslationJob;
}

// One undo/redo entry: the full editable model minus transient bits (a running translation
// job isn't snapshotted). Only plain data, so it deep-clones cleanly.
interface HistorySnap {
  tracks: { id: string; label: string; language: string; doc: SubtitleDoc }[];
  activeTrackId: string;
  selectedId: string | null;
  selectedIds: string[];
}
const HIST_MAX = 100;

// An in-progress background translation attached to a track. The track's cues are filled live
// as the worker streams batches; `parsed`/`refs` map each translatable run back to its cue so
// results can be spliced in without disturbing tags. Can be paused/resumed/stopped.
interface TranslationJob {
  run: TranslateRun | null; // null while stopped/errored (no live worker)
  state: "running" | "paused" | "error";
  stage: "download" | "translate";
  device?: "webgpu" | "wasm";
  ratio: number;
  plan: TranslationPlan;
  opts: { model: string; srcLang: string; tgtLang: string }; // to resume/retry a fresh pass
  translated: boolean[]; // per unique text; survives errors so retry only does the rest
  errorMsg?: string;
  done: number; // unique texts translated so far
  total: number; // total unique texts to translate
}

let trackSeq = 0;
const newTrackId = (): string => `tr${(trackSeq += 1)}`;

// Embedded tracks tag language as ISO 639-2 (e.g. "eng"); map to the 2-letter code the UI
// (track label, translate source auto-detect) uses. "und"/unknown -> "".
const LANG3TO2: Record<string, string> = { eng: "en", fra: "fr", fre: "fr", jpn: "ja", spa: "es", deu: "de", ger: "de", ita: "it", por: "pt", nld: "nl", dut: "nl", rus: "ru", zho: "zh", chi: "zh", kor: "ko", ara: "ar" };
const normalizeLang = (code?: string): string => {
  const c = (code ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!c || c === "und") return "";
  return c.length === 3 ? (LANG3TO2[c] ?? c) : c;
};

// Best-effort label + language from a filename, recognising a ".<lang>." tag (e.g.
// "movie.en.srt" -> language "en").
function deriveTrackMeta(filename?: string): { label: string; language: string } {
  if (!filename) return { label: t("track"), language: "" };
  const base = filename.replace(/\.[^.]+$/, ""); // strip extension
  const m = base.match(/[.\-_]([a-z]{2,3})$/i);
  const language = m && /^(en|fr|ja|es|de|it|pt|nl|ru|zh|ko|ar)$/i.test(m[1]) ? m[1].toLowerCase() : "";
  return { label: base || t("track"), language };
}


class SubtitleEditor implements SubtitleEditorHandle {
  private root: HTMLDivElement;
  private tracks: Track[] = [];
  private originalDocs = new Map<string, SubtitleDoc>();
  private activeTrackId = "";
  // The active track's document. A get/set accessor keeps the rest of the editor, which was
  // written against a single `this.doc`, working unchanged.
  private get doc(): SubtitleDoc {
    return (this.tracks.find((t) => t.id === this.activeTrackId) ?? this.tracks[0]).doc;
  }
  private set doc(v: SubtitleDoc) {
    const tr = this.tracks.find((t) => t.id === this.activeTrackId);
    if (tr) tr.doc = v;
  }
  private opts: SubtitleEditorOptions;
  private selectedId: string | null = null; // the primary (detail-edited) cue
  private selectedIds = new Set<string>(); // the full selection (multi-select)
  private keyframesMs: number[] = [];
  private timecodesMs: number[] = [];
  private frameRate = 23.976;
  private videoFrameIndex: VideoFrameIndex | null = null;
  private frameIndexAbort: AbortController | null = null;
  private pendingVideoFrame: { frame: number; timeMs: number } | null = null;
  private dummyFrameCount = 0;
  private tagDisplayMode: "show" | "hide" | "simplify" = "simplify";
  private playRangeStop: (() => void) | null = null;
  private lastVideoPointer: { x: number; y: number } | null = null;
  private overscanOverlay: HTMLDivElement | null = null;
  private assistant: AssistantHandle | null = null;
  private vectorClip: VectorClipHandle | null = null;
  private videoZoom = 1;
  private videoPanX = 0;
  private videoPanY = 0;
  private videoAspectOverride: number | null = null;
  private videoHost: HTMLDivElement | null = null;
  private videoStage: HTMLElement | null = null;
  private videoResizeObserver: ResizeObserver | null = null;
  private videoScrubber: HTMLInputElement | null = null;
  private videoTimeLabel: HTMLSpanElement | null = null;
  private videoZoomLabel: HTMLButtonElement | null = null;
  private mediaCleanup: (() => void)[] = [];
  private mediaLoadGeneration = 0;
  private activeHotkeyContext: AegisubHotkeyContext = "grid";
  private activeVideoTool = "video/tool/cross";
  private visualTransform: VisualTransformOverlay | null = null;
  private audio!: AudioWorkspace;
  private audioLoadGeneration = 0;
  private audioExportAbort: AbortController | null = null;
  private timingDraft = new TimingDraft();
  private embeddedFontUrls: string[] = [];
  private embeddedFontSignature = "";
  private bundledFontSignature = "";
  private previewFontFaces = new Set<FontFace>();
  private previewFontGeneration = 0;
  private knownEmbeddedFontFamilies = new Set<string>();
  private fontWarningEl: HTMLDivElement | null = null;
  private gridColumns: GridColumnKey[] = [];
  private cueClipboard: Cue[] = []; // internal copy/paste buffer
  private playingId: string | null = null;
  private paneButtons: HTMLButtonElement[] = [];

  private scrollEl!: HTMLDivElement;
  private innerEl!: HTMLDivElement;
  private detailEl!: HTMLDivElement;
  private countEl!: HTMLSpanElement;
  private stylesBtn!: HTMLButtonElement;
  private scriptBtn!: HTMLButtonElement;
  private fmtSel!: HTMLSelectElement;
  private trackBar!: HTMLDivElement;
  private jobStrip!: HTMLDivElement;
  private previewPushTimer: number | null = null;
  private leftEl!: HTMLDivElement;
  private headEl!: HTMLDivElement;
  private rightEl!: HTMLDivElement;
  private player: PreviewPlayer | null = null;
  private video: PreviewMedia | null = null;
  private mediaFile: File | null = null; // the original file; streamed from disk (never held whole in RAM)
  private mediaContainer: "mkv" | "mp4" = "mp4"; // detected at load, for save-into-video
  private subtitleFileHandle: FileSystemFileHandle | null = null;
  private decodedMono16k: Float32Array | null = null;
  private spectrumData: SpectrumData | null = null;
  private spectrumRequest = 0;
  private spectrumCancel: (() => void) | null = null;
  private audioViewMode: "waveform" | "spectrum" = "waveform";
  private timeline: Timeline | null = null;
  private audioAdjustments: AudioAdjustments | null = null;
  private audioMarkerCache: { keys: number[]; frames: number[]; fps: number; result: number[] } | null = null;
  private waveAbort: AbortController | null = null;
  private waveStatusEl: HTMLDivElement | null = null;
  private detailTextarea: HTMLTextAreaElement | null = null;
  private detailTab: "text" | "drawing" = "text";
  // Show the ASS inline styling tools by default on roomy screens, collapse them on
  // phones so the styling controls do not swamp the cue list. Toggled per session.
  private assStyleToolsOpen = !(typeof window !== "undefined" && window.matchMedia?.("(max-width: 680px)").matches);
  // Same idea for the per-line option fields (disabled / actor / layer / effect / margins).
  private assExtrasOpen = !(typeof window !== "undefined" && window.matchMedia?.("(max-width: 680px)").matches);
  private posOverlay: HTMLDivElement | null = null;
  private positionCueId: string | null = null;
  private clipOverlay: HTMLDivElement | null = null;
  private drawOverlay: HTMLDivElement | null = null;
  private wavePeaks: { peaks: Float32Array; peaksPerSec: number } | null = null;
  private rows = new Map<string, HTMLDivElement>();
  private rafPending = false;
  private subtitleTimer = 0;
  private subtitleFrameRaf = 0;

  // Undo/redo. The whole editable model (all tracks + selection) is snapshotted; edits within
  // a short window coalesce into one step (so typing a word is one undo, not one per key).
  // Snapshots are immutable (restore clones out), so History's clone can be identity.
  private history = new History<HistorySnap>((s) => s, HIST_MAX);
  private histTimer = 0;
  private autoTimingHistory: { id: number; snapshot: HistorySnap } | null = null;
  private timingPreviewRaf = 0;
  private restoring = false;
  private undoHandler: UndoHandler | null = null;
  /** Where the other people in a session are, by cue id. */
  private peerCues: PeerCue[] = [];
  private undoBtn: HTMLButtonElement | null = null;
  private redoBtn: HTMLButtonElement | null = null;
  private followBtn: HTMLButtonElement | null = null;
  private followPlayback = true;
  private problemsBtn: HTMLButtonElement | null = null;
  private tbObserver: ResizeObserver | null = null;
  private tbLayout: (() => void) | null = null;
  private tbOnDocClick: ((e: MouseEvent) => void) | null = null;
  private findBar: HTMLDivElement | null = null;
  private findInput: HTMLInputElement | null = null;
  private findReplaceInput: HTMLInputElement | null = null;
  private findCountEl: HTMLSpanElement | null = null;
  private findMatches: string[] = []; // ids of cues matching the current query
  private findPos = -1;
  private problemsPanel: HTMLDivElement | null = null;
  private contextMenu: HTMLDivElement | null = null;
  private contextMenuClose: ((event: PointerEvent) => void) | null = null;

  constructor(container: HTMLElement, input: SubtitleInput, opts: SubtitleEditorOptions) {
    this.opts = opts;
    if (opts.locale) setLocale(opts.locale);
    injectStyles();
    const meta = deriveTrackMeta(input.filename);
    this.tracks = [{ id: newTrackId(), label: meta.label, language: meta.language, doc: parseSubtitles(input.text, input.filename) }];
    this.activeTrackId = this.tracks[0].id;
    this.originalDocs.set(this.activeTrackId, structuredClone(this.tracks[0].doc));

    this.root = document.createElement("div");
    this.root.className = "se-root";
    this.root.tabIndex = 0;
    container.appendChild(this.root);

    this.buildToolbar();
    this.buildTrackBar();
    this.buildBody();
    this.renderList();
    this.renderDetail();
    if (this.doc.cues.length) this.select(this.doc.cues[0].id);

    this.history.reset(this.snapshot()); // the loaded document is the initial undo baseline
    this.root.addEventListener("keydown", this.onKeydown);
    this.root.addEventListener("pointerdown", this.onContextActivation, true);
    this.root.addEventListener("focusin", this.onContextActivation, true);
    document.addEventListener("keydown", this.onShellKeydown, true);
  }

  // --- structure -----------------------------------------------------------

  private buildToolbar(): void {
    const bar = el("div", "se-toolbar");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", t("toolbarLabel"));

    this.undoBtn = this.iconButton(ICON.undo, t("undo"), () => this.undo(), SHORTCUTS.undo);
    this.redoBtn = this.iconButton(ICON.redo, t("redo"), () => this.redo(), SHORTCUTS.redo);
    this.undoBtn.disabled = true;
    this.redoBtn.disabled = true;
    bar.appendChild(this.undoBtn);
    bar.appendChild(this.redoBtn);

    const addCueButton = this.iconButton(ICON.add, t("addCue"), () => this.addCue(), SHORTCUTS.addCue);
    addCueButton.dataset.editorCommand = "add-cue";
    bar.appendChild(addCueButton);
    const removeCueButton = this.iconButton(ICON.remove, t("removeCue"), () => this.removeCue(), SHORTCUTS.removeCue);
    removeCueButton.dataset.editorCommand = "remove-cue";
    bar.appendChild(removeCueButton);

    // Secondary buttons are "pocketable": when the toolbar is too narrow to fit, they move
    // (from the right) into a "…" overflow popover, so no control is lost on small screens.
    const pocket: HTMLElement[] = [];
    const pk = (b: HTMLButtonElement): HTMLButtonElement => {
      bar.appendChild(b);
      pocket.push(b);
      return b;
    };
    pk(this.iconButton(ICON.merge, t("mergeCue"), () => this.mergeCue()));
    pk(this.iconButton(ICON.split, t("splitCue"), () => this.splitCue()));
    pk(this.iconButton(ICON.search, t("findReplace"), () => this.toggleFind(), SHORTCUTS.find));
    this.problemsBtn = pk(this.iconButton(ICON.problems, t("problems"), () => this.toggleProblems()));
    pk(this.iconButton(ICON.tune, t("aegisubTools"), () => void this.openAegisubTools()));
    pk(this.iconButton(ICON.shift, t("shiftTimes"), () => this.shiftTimes()));
    pk(this.iconButton(ICON.overlaps, t("fixOverlaps"), () => this.fixOverlaps()));
    // Video-timing tools: set the selected cue's start/end to the playhead, play from the cue,
    // and toggle the list auto-scrolling to follow playback.
    pk(this.iconButton(ICON.setstart, t("setStartAtPlayhead"), () => this.setCueEdge("start"), SHORTCUTS.markIn));
    pk(this.iconButton(ICON.setend, t("setEndAtPlayhead"), () => this.setCueEdge("end"), SHORTCUTS.markOut));
    pk(this.iconButton(ICON.playcue, t("playFromCue"), () => this.playFromSelected(), SHORTCUTS.playCue));
    this.followBtn = pk(this.iconButton(ICON.follow, t("followPlayback"), () => this.toggleFollow()));
    this.followBtn.classList.toggle("on", this.followPlayback);

    const fmt = document.createElement("select");
    fmt.className = "se-btn";
    const FORMAT_LABELS: Record<SubtitleFormat, string> = {
      srt: "SRT",
      vtt: "VTT",
      ass: "ASS",
      sub: "MicroDVD",
      lrc: "LRC",
      ttml: "TTML",
      sbv: "SBV",
      subviewer: "SubViewer",
      sami: "SAMI",
      mpl2: "MPL2",
      ytjson: "YouTube JSON",
      spruce: "Spruce STL",
      tmp: "TMPlayer",
      csv: "CSV",
      qttext: "QuickTime Text",
      dvdsp: "DVD Studio Pro",
      jsonsub: "JSON",
      ttxt: "TTXT",
    };
    for (const f of Object.keys(FORMAT_LABELS) as SubtitleFormat[]) {
      const o = document.createElement("option");
      o.value = f;
      o.textContent = FORMAT_LABELS[f];
      fmt.appendChild(o);
    }
    fmt.value = this.doc.format;
    fmt.title = t("format");
    fmt.setAttribute("aria-label", t("format"));
    fmt.addEventListener("change", () => this.setFormat(fmt.value as SubtitleFormat));
    this.fmtSel = fmt;
    bar.appendChild(fmt);

    // New ASS style (ASS only); edit lives next to the per-cue style dropdown.
    this.stylesBtn = this.iconButton(ICON.styles, t("addStyle"), () => this.addStyle());
    this.stylesBtn.style.display = this.doc.format === "ass" ? "" : "none";
    bar.appendChild(this.stylesBtn);

    // Script properties (ASS only).
    this.scriptBtn = this.iconButton(ICON.script, t("scriptProps"), () =>
      openScriptProperties({ getDoc: () => this.doc, onChange: () => this.markDirty() }),
    );
    this.scriptBtn.style.display = this.doc.format === "ass" ? "" : "none";
    bar.appendChild(this.scriptBtn);

    pk(this.iconButton(ICON.transcribe, t("autoTranscribe"), () => this.openTranscribe()));
    pk(this.iconButton(ICON.translate, t("translateTrack"), () => this.openTranslate()));
    pk(this.iconButton(ICON.savevideo, t("saveVideo"), () => this.saveIntoVideo(), SHORTCUTS.saveVideo));

    // The "…" overflow button sits at the right edge of the button cluster (before the spacer);
    // pocketed buttons appear in a popover below it.
    const moreBtn = this.iconButton(ICON.more, t("moreTools"), () => {});
    moreBtn.classList.add("se-tb-more");
    bar.appendChild(moreBtn);

    const sp = el("span", "se-sp");
    bar.appendChild(sp);

    this.countEl = el("span", "se-count") as HTMLSpanElement;
    bar.appendChild(this.countEl);

    if (this.opts.showSave !== false) {
      bar.appendChild(this.iconButton(ICON.save, t("save"), () => this.save(), SHORTCUTS.save));
    }
    this.root.appendChild(bar);
    this.setupToolbarOverflow(bar, pocket, moreBtn);
  }

  // Compact the toolbar: when the buttons don't fit on one row, move pocketable ones (from the
  // right) into a "…" popover, recomputed on resize. Non-pocketable controls (undo/redo/add/
  // remove, the format select, the ASS style/script buttons and count/save) always stay.
  private setupToolbarOverflow(bar: HTMLElement, pocket: HTMLElement[], moreBtn: HTMLButtonElement): void {
    const overflow = el("div", "se-tb-overflow") as HTMLDivElement;
    overflow.hidden = true;
    overflow.setAttribute("role", "menu");
    overflow.setAttribute("aria-label", t("moreTools"));
    this.root.appendChild(overflow);
    moreBtn.style.display = "none";
    moreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      overflow.style.top = `${bar.offsetHeight}px`;
      overflow.hidden = !overflow.hidden;
    });
    // Clicking a pocketed button runs its action, then closes the popover.
    overflow.addEventListener("click", () => (overflow.hidden = true));
    this.tbOnDocClick = (e: MouseEvent) => {
      if (!overflow.hidden && !overflow.contains(e.target as Node) && e.target !== moreBtn) overflow.hidden = true;
    };
    document.addEventListener("click", this.tbOnDocClick);

    const canonical = [...bar.children] as HTMLElement[]; // canonical order for reset
    const fits = () => bar.scrollWidth <= bar.clientWidth + 1;
    this.tbLayout = () => {
      overflow.hidden = true;
      for (const c of canonical) bar.appendChild(c); // restore order, pulling any back from the popover
      moreBtn.style.display = "none";
      if (fits()) return;
      moreBtn.style.display = "";
      // Pocket visible pocketable buttons from the right until everything fits.
      for (let i = pocket.length - 1; i >= 0 && !fits(); i -= 1) {
        if (pocket[i].style.display === "none") continue;
        overflow.insertBefore(pocket[i], overflow.firstChild);
      }
    };
    this.tbLayout();
    requestAnimationFrame(() => this.tbLayout?.());
    setTimeout(() => this.tbLayout?.(), 150); // re-measure once fonts/layout settle
    this.tbObserver = new ResizeObserver(() => {
      this.tbLayout?.();
      if (this.innerEl) this.renderList();
    });
    this.tbObserver.observe(bar);
  }

  // --- tracks --------------------------------------------------------------

  private buildTrackBar(): void {
    this.trackBar = el("div", "se-tracks") as HTMLDivElement;
    this.root.appendChild(this.trackBar);
    this.jobStrip = el("div", "se-jobstrip") as HTMLDivElement;
    this.root.appendChild(this.jobStrip);
    this.renderTrackBar();
    this.renderJobStrip();
  }

  private renderTrackBar(): void {
    this.trackBar.textContent = "";
    this.trackBar.classList.toggle("single", this.tracks.length === 1);
    // A lone track still shows its tab so the "+" (add track) stays discoverable.
    for (const tr of this.tracks) {
      const tab = el("div", "se-track" + (tr.id === this.activeTrackId ? " on" : "") + (tr.job ? " busy" : ""));
      const name = el("span", "se-track-name", tr.language ? `${tr.label} (${tr.language})` : tr.label);
      name.addEventListener("click", () => this.switchTrack(tr.id));
      name.addEventListener("dblclick", () => this.renameTrack(tr.id));
      tab.appendChild(name);
      if (tr.job) {
        const prog = el("div", "se-track-prog");
        prog.style.width = `${Math.round(tr.job.ratio * 100)}%`;
        tab.appendChild(prog);
      }
      if (this.tracks.length > 1) {
        const close = el("button", "se-track-x", "×");
        close.title = t("removeTrack");
        close.addEventListener("click", (e) => {
          e.stopPropagation();
          this.removeTrack(tr.id);
        });
        tab.appendChild(close);
      }
      this.trackBar.appendChild(tab);
    }
    const add = el("button", "se-track-add", "+");
    add.title = t("addTrack");
    add.addEventListener("click", () => this.addEmptyTrack());
    this.trackBar.appendChild(add);
  }

  private switchTrack(id: string): void {
    if (id === this.activeTrackId || !this.tracks.some((t) => t.id === id)) return;
    if (this.posOverlay) this.exitPosition();
    if (this.clipOverlay) this.exitClip();
    if (this.drawOverlay) this.exitDraw();
    this.vectorClip?.close();
    this.vectorClip = null;
    this.activeTrackId = id;
    this.selectedId = null;
    this.refreshForActiveDoc();
    this.pushSubtitles();
    this.renderTrackBar();
    this.renderJobStrip();
  }

  private addEmptyTrack(): void {
    let doc = parseSubtitles("", "track.srt");
    if (this.doc.format !== "srt") doc = convertDoc(doc, this.doc.format);
    const id = newTrackId();
    this.tracks.push({ id, label: `${t("track")} ${this.tracks.length + 1}`, language: "", doc });
    this.originalDocs.set(id, structuredClone(doc));
    this.switchTrack(id);
    this.markDirty();
  }

  private removeTrack(id: string): void {
    if (this.tracks.length <= 1) return;
    const idx = this.tracks.findIndex((t) => t.id === id);
    if (idx < 0) return;
    this.tracks[idx].job?.run?.cancel();
    this.tracks.splice(idx, 1);
    this.originalDocs.delete(id);
    if (this.activeTrackId === id) {
      this.activeTrackId = this.tracks[Math.min(idx, this.tracks.length - 1)].id;
      this.selectedId = null;
      this.refreshForActiveDoc();
      this.pushSubtitles();
    }
    this.renderTrackBar();
    this.markDirty();
  }

  private renameTrack(id: string): void {
    const tr = this.tracks.find((t) => t.id === id);
    if (!tr) return;
    const name = prompt(t("trackNamePrompt"), tr.label);
    if (name != null) {
      tr.label = name.trim() || tr.label;
      this.renderTrackBar();
      this.markDirty();
    }
  }

  // Re-point all views at the active track's document (format UI, list head, list, detail).
  private refreshForActiveDoc(): void {
    this.autoTimingHistory = null;
    this.timingDraft.clear();
    const isAss = this.doc.format === "ass";
    this.stylesBtn.style.display = isAss ? "" : "none";
    this.scriptBtn.style.display = isAss ? "" : "none";
    this.tbLayout?.(); // the style/script buttons changed the toolbar width
    this.leftEl.classList.toggle("se-ass", isAss);
    this.fmtSel.value = this.doc.format;
    this.renderListHead();
    this.rows.clear();
    this.innerEl.textContent = "";
    this.scrollEl.scrollTop = 0;
    this.renderList();
    if (this.doc.cues.length) this.select(this.doc.cues[0].id);
    else this.renderDetail();
  }

  private buildBody(): void {
    this.root.dataset.mobilePane = "subtitles";
    const paneSwitch = el("div", "se-pane-switch");
    paneSwitch.setAttribute("role", "tablist");
    paneSwitch.setAttribute("aria-label", "Workspace");
    const addPane = (pane: "subtitles" | "video" | "audio", label: string, icon: string): void => {
      const control = el("button", "se-pane-button") as HTMLButtonElement;
      control.type = "button";
      control.dataset.pane = pane;
      control.setAttribute("role", "tab");
      control.innerHTML = `${nativeIcon(icon)}<span>${label}</span>`;
      control.addEventListener("click", () => this.setMobilePane(pane));
      this.paneButtons.push(control);
      paneSwitch.append(control);
    };
    addPane("subtitles", "字幕", "substart_to_video");
    addPane("video", "视频", "open_video_menu");
    addPane("audio", "音频", "button_playsel");
    this.paneButtons[0].classList.add("on");
    this.paneButtons[0].setAttribute("aria-selected", "true");
    this.root.appendChild(paneSwitch);

    const body = el("div", "se-body");
    const left = el("div", "se-left") as HTMLDivElement;
    this.leftEl = left;
    left.classList.toggle("se-ass", this.doc.format === "ass");

    this.headEl = el("div", "se-listhead") as HTMLDivElement;
    left.appendChild(this.headEl);
    this.renderListHead();

    this.scrollEl = el("div", "se-scroll") as HTMLDivElement;
    this.innerEl = el("div", "se-inner") as HTMLDivElement;
    // The cue list is a listbox: rows are options, the selected cue is the active descendant,
    // and Up/Down arrows move the selection (handled in onKeydown).
    this.innerEl.setAttribute("role", "listbox");
    this.innerEl.setAttribute("aria-label", t("cueListLabel"));
    this.innerEl.tabIndex = 0;
    this.scrollEl.appendChild(this.innerEl);
    this.scrollEl.addEventListener("scroll", this.onScroll);
    left.appendChild(this.scrollEl);

    this.detailEl = el("div", "se-detail") as HTMLDivElement;
    left.appendChild(this.detailEl);

    this.rightEl = el("div", "se-right") as HTMLDivElement;
    this.renderPreviewPlaceholder();

    body.appendChild(left);
    body.appendChild(this.rightEl);

    // Aegisub-style audio pane: waveform/spectrum with the canonical timing controls.
    const strip = el("div", "se-timeline-wrap");
    this.waveStatusEl = el("div", "se-wave-status") as HTMLDivElement;
    strip.appendChild(this.waveStatusEl);
    const audioHost = el("div", "se-audio-player");
    audioHost.hidden = true;
    strip.append(audioHost);
    this.audio = new AudioWorkspace(audioHost, {
      changed: (reason) => {
        this.root.dataset.audioName = this.audio?.file?.name ?? this.audio?.synthetic?.name ?? "";
        this.root.dataset.audioPlaying = String(this.audio?.playing ?? false);
        this.root.dataset.audioSource = this.audio?.synthetic?.kind ?? (this.audio?.file ? "file" : "");
        if (audioHost.dataset.fallback) this.root.dataset.audioFallback = audioHost.dataset.fallback;
        else delete this.root.dataset.audioFallback;
        if (this.video && this.audio && this.video.muted !== this.audio.muteVideo) this.video.muted = this.audio.muteVideo;
        if (this.audio?.playing) this.timeline?.startPlayheadLoop();
        else this.timeline?.stopPlayheadLoop();
        if (reason && reason !== "loadedmetadata") this.timeline?.renderPlayhead();
        else this.timeline?.render();
      },
      error: (message) => { this.setWaveStatus(message); this.toast(`音频：${message}`); },
      progress: (message) => this.setWaveStatus(message),
    });
    const audioControls = el("div", "se-audio-controls");
    const audioButton = (icon: string, title: string, command: string): void => {
      const control = this.iconButton(nativeIcon(icon), title, () => this.runAegisubCommand(command));
      control.classList.add("se-audio-button");
      audioControls.append(control);
    };
    audioButton("button_prev", "上一行", "time/prev");
    audioButton("button_next", "下一行", "time/next");
    audioButton("button_playsel", "播放选择", "audio/play/selection");
    audioButton("button_playline", "播放当前行", "audio/play/line");
    audioButton("button_stop", "停止", "audio/stop");
    audioButton("button_playfivehbefore", "播放开始前", "audio/play/selection/before");
    audioButton("button_playfivehafter", "播放结束后", "audio/play/selection/after");
    audioButton("button_leadin", "添加 Lead-in", "time/lead/in");
    audioButton("button_leadout", "添加 Lead-out", "time/lead/out");
    audioButton("button_audio_commit", "提交时间", "audio/commit");
    audioButton("button_audio_goto", "跳到选择", "audio/go_to");
    audioButton("kara_mode", "卡拉 OK", "audio/karaoke");
    audioButton("zoom_in_button", "放大音频时间轴", "audio/zoom/in");
    audioButton("zoom_out_button", "缩小音频时间轴", "audio/zoom/out");
    for (const [key, label, defaultOn, icon] of [
      ["audio-autoscroll", "自动滚动到所选字幕", true, "toggle_audio_autoscroll"],
      ["audio-autocommit", "自动提交", false, "toggle_audio_autocommit"],
      ["audio-autonext", "提交后下一行", true, "toggle_audio_nextcommit"],
    ] as const) {
      const control = this.iconButton(nativeIcon(icon), label, () => this.runAegisubCommand(`audio/opt/${key.slice(6)}`));
      control.classList.add("se-audio-button"); control.dataset.audioOption = key;
      const enabled = localStorage.getItem(`aegisub-web.${key}`) === null ? defaultOn : localStorage.getItem(`aegisub-web.${key}`) === "true";
      control.classList.toggle("on", enabled); control.setAttribute("aria-pressed", String(enabled));
      audioControls.append(control);
    }
    strip.appendChild(audioControls);
    this.audioAdjustments = new AudioAdjustments({ zoom: level => this.timeline?.setZoomLevel(level), amplitude: gain => this.timeline?.setAmplitudeScale(gain), volume: gain => this.audio.setGain(gain) });
    strip.append(this.audioAdjustments.root);
    body.appendChild(strip);
    this.root.appendChild(body);
    this.timeline = new Timeline({
      getCues: () => this.doc.cues.map(cue => this.timingDraft.read(cue, this.doc.format === "ass" ? 10 : 1)),
      getDuration: () => this.audio.duration,
      getCurrentTime: () => this.audio.currentTime,
      getKeyframesMs: () => this.audioKeyframeTimes(),
      getVideoPositionMs: () => this.video ? VideoFrameIndex.timeAtFrame(this.frameTimes, this.currentVideoFrame(), this.frameRate) : null,
      getSnapTargetsMs: () => [
        ...(audioFlag("show-keyframes") ? this.audioKeyframeTimes() : []),
        ...(audioFlag("show-video-position") && this.video ? [this.videoBoundaryTime("start"), this.videoBoundaryTime("end")] : []),
      ],
      onZoom: level => this.audioAdjustments?.setZoom(level),
      onVideoSeek: seconds => this.stopAndSeek(seconds * 1000),
      followPlayback: () => localStorage.getItem("aegisub-web.audio-lock-cursor") === "true",
      getSelectedId: () => this.selectedId,
      getSelectedIds: () => [...this.selectedIds],
      onSeek: (sec) => { this.audio.stop(); this.audio.seek(sec); },
      onSelectCue: (id) => this.select(id),
      onRetime: (id, startMs, endMs, commit) => this.retimeCue(id, startMs, endMs, commit),
      onRetimeBatch: (updates) => {
        const cues = new Map(this.doc.cues.map(cue => [cue.id, cue]));
        for (const update of updates) { const cue = cues.get(update.id); if (cue) this.timingDraft.set(cue, update.startMs, update.endMs); }
        this.renderTimingDraft();
        if (audioFlag("autocommit", false)) this.applyTimingDraft(true);
      },
    });
    this.timeline.mount(strip);
    this.audioAdjustments.apply();
  }

  private setMobilePane(pane: "subtitles" | "video" | "audio"): void {
    this.root.dataset.mobilePane = pane;
    this.activeHotkeyContext = pane === "video" ? "video" : pane === "audio" ? "audio" : "grid";
    for (const button of this.paneButtons) {
      const active = button.dataset.pane === pane;
      button.classList.toggle("on", active);
      button.setAttribute("aria-selected", String(active));
    }
    requestAnimationFrame(() => {
      this.timeline?.render();
    });
  }

  private appendVideoChrome(): void {
    const tools = el("div", "se-video-tools");
    const add = (icon: string, title: string, command: string): void => {
      const control = this.iconButton(nativeIcon(icon), title, () => this.runAegisubCommand(command));
      control.classList.add("se-video-tool");
      control.dataset.videoTool = command;
      control.classList.toggle("on", command === this.activeVideoTool);
      tools.append(control);
    };
    add("visual_standard", "坐标工具", "video/tool/cross");
    add("visual_move", "移动", "video/tool/drag");
    add("visual_rotatez", "Z 轴旋转", "video/tool/rotate/z");
    add("visual_rotatexy", "XY 轴旋转", "video/tool/rotate/xy");
    add("visual_scale", "缩放", "video/tool/scale");
    add("visual_clip", "矩形裁剪", "video/tool/clip");
    add("visual_vector_clip", "矢量裁剪", "video/tool/vector_clip");
    add("show_overscan_menu_checked", "过扫描遮罩", "video/show_overscan");
    add("visual_help", "视觉排版帮助", "help/video");

    const playback = el("div", "se-video-controls");
    const play = this.iconButton(nativeIcon("button_play"), "播放视频", () => this.runAegisubCommand("video/play"));
    const line = this.iconButton(nativeIcon("button_playline"), "播放当前行", () => this.runAegisubCommand("video/play/line"));
    const stop = this.iconButton(nativeIcon("button_stop"), "停止", () => this.runAegisubCommand("video/stop"));
    const scrubber = document.createElement("input");
    scrubber.className = "se-video-scrubber";
    scrubber.type = "range";
    scrubber.min = "0";
    scrubber.max = "1";
    scrubber.step = "1";
    scrubber.value = "0";
    scrubber.setAttribute("aria-label", "视频时间轴");
    scrubber.addEventListener("input", () => this.stopAndSeek(Number(scrubber.value)));
    this.videoScrubber = scrubber;
    const time = el("span", "se-video-time", "0:00.000 / 0:00.000") as HTMLSpanElement;
    this.videoTimeLabel = time;
    const fit = this.iconButton(nativeIcon("set_zoom_menu"), "适合预览框", () => this.resetVideoView());
    fit.classList.add("se-video-fit");
    const zoom = el("button", "se-video-zoom", "100%") as HTMLButtonElement;
    zoom.type = "button";
    zoom.title = "重置缩放；在画面上滚轮或触摸板可缩放";
    zoom.addEventListener("click", () => this.resetVideoView());
    this.videoZoomLabel = zoom;
    playback.append(play, line, stop, scrubber, time, fit, zoom);
    this.rightEl.append(tools, playback);
    this.root.dataset.videoTool = this.activeVideoTool;
  }

  private activateVideoTool(command: string): void {
    this.visualTransform?.close(); this.visualTransform = null;
    this.activeVideoTool = command;
    this.activeHotkeyContext = "video";
    this.root.dataset.videoTool = command;
    for (const button of this.rightEl.querySelectorAll<HTMLElement>(".se-video-tool")) {
      button.classList.toggle("on", button.dataset.videoTool === command);
    }
  }

  private mediaClock(seconds: number): string {
    const value = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const secs = value % 60;
    const body = `${String(minutes).padStart(hours ? 2 : 1, "0")}:${secs.toFixed(3).padStart(6, "0")}`;
    return hours ? `${hours}:${body}` : body;
  }

  private updateVideoChrome(): void {
    const media = this.video;
    if (!media) return;
    const duration = Number.isFinite(media.duration) ? Math.max(0, media.duration) : 0;
    if (this.videoScrubber) {
      this.videoScrubber.max = String(Math.max(1, Math.round(duration * 1000)));
      this.videoScrubber.value = String(Math.max(0, Math.min(Number(this.videoScrubber.max), Math.round(media.currentTime * 1000))));
    }
    if (this.videoTimeLabel) this.videoTimeLabel.textContent = `${this.mediaClock(media.currentTime)} / ${this.mediaClock(duration)}`;
    if (this.videoZoomLabel) this.videoZoomLabel.textContent = `${Math.round(this.videoZoom * 100)}%`;
  }

  private configureVideoSurface(media: PreviewMedia, host: HTMLDivElement): void {
    media.controls = false;
    media.removeAttribute("controls");
    // Removing native controls also removes the element from some browsers' tab order.
    // Keep it focusable so Aegisub's Video-context hotkeys work consistently.
    media.tabIndex = 0;
    media.setAttribute("playsinline", "");
    media.setAttribute("webkit-playsinline", "");
    media.style.width = "100%";
    media.style.height = "100%";
    media.style.maxWidth = "none";
    media.style.maxHeight = "none";
    media.style.objectFit = "fill";
    const seeking = () => {
      if (this.video !== media) return;
      const timeMs = media.currentTime * 1000;
      if (!this.pendingVideoFrame || Math.abs(this.pendingVideoFrame.timeMs - timeMs) >= 2) this.pendingVideoFrame = { frame: this.frameAtMediaMs(timeMs), timeMs };
    };
    media.addEventListener("seeking", seeking);
    this.mediaCleanup.push(() => media.removeEventListener("seeking", seeking));
    const stage = host.querySelector<HTMLElement>(".ot-media-stage");
    const wrap = host.querySelector<HTMLElement>(".ot-media");
    this.videoHost = host;
    this.videoStage = stage;
    if (wrap) wrap.style.overflow = "hidden";
    if (stage) {
      stage.style.flex = "0 0 auto";
      stage.style.maxWidth = "none";
      stage.style.maxHeight = "none";
      stage.style.transformOrigin = "center center";
      stage.style.willChange = "transform";
    }
    const wheel = (event: WheelEvent): void => {
      if (!this.videoStage) return;
      event.preventDefault();
      const normalized = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 18 :
        event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? event.deltaY * host.clientHeight : event.deltaY;
      const factor = Math.exp(-normalized * 0.0017);
      this.setVideoZoom(this.videoZoom * factor, event.clientX, event.clientY);
    };
    host.addEventListener("wheel", wheel, { passive: false });
    this.mediaCleanup.push(() => host.removeEventListener("wheel", wheel));
    const touchPoints = new Map<number, { x: number; y: number }>();
    let pinchDistance = 0;
    let pinchZoom = this.videoZoom;
    const distance = (): number => {
      const points = [...touchPoints.values()];
      return points.length < 2 ? 0 : Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    };
    const touchDown = (event: PointerEvent): void => {
      if (event.pointerType !== "touch") return;
      touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPoints.size === 2) { pinchDistance = distance(); pinchZoom = this.videoZoom; }
    };
    const touchMove = (event: PointerEvent): void => {
      if (!touchPoints.has(event.pointerId)) return;
      touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPoints.size !== 2 || !pinchDistance) return;
      event.preventDefault();
      const points = [...touchPoints.values()];
      this.setVideoZoom(pinchZoom * (distance() / pinchDistance), (points[0].x + points[1].x) / 2, (points[0].y + points[1].y) / 2);
    };
    const touchUp = (event: PointerEvent): void => {
      touchPoints.delete(event.pointerId);
      if (touchPoints.size < 2) pinchDistance = 0;
    };
    host.addEventListener("pointerdown", touchDown);
    host.addEventListener("pointermove", touchMove);
    host.addEventListener("pointerup", touchUp);
    host.addEventListener("pointercancel", touchUp);
    this.mediaCleanup.push(() => {
      host.removeEventListener("pointerdown", touchDown);
      host.removeEventListener("pointermove", touchMove);
      host.removeEventListener("pointerup", touchUp);
      host.removeEventListener("pointercancel", touchUp);
    });
    const focusVideoContext = (event: PointerEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("button,input,select,textarea")) return;
      this.activeHotkeyContext = "video";
      media.focus({ preventScroll: true });
    };
    host.addEventListener("pointerdown", focusVideoContext, true);
    this.mediaCleanup.push(() => host.removeEventListener("pointerdown", focusVideoContext, true));
    this.videoResizeObserver?.disconnect();
    this.videoResizeObserver = new ResizeObserver(() => this.fitVideoSurface());
    this.videoResizeObserver.observe(host);
    this.fitVideoSurface();
    this.applyVideoTransform();
  }

  private fitVideoSurface(): void {
    if (!this.video || !this.videoHost || !this.videoStage) return;
    const host = this.videoHost.getBoundingClientRect();
    if (!host.width || !host.height) return;
    const video = this.video as HTMLVideoElement;
    const nativeWidth = video.videoWidth || 16;
    const nativeHeight = video.videoHeight || 9;
    const ratio = this.videoAspectOverride ?? nativeWidth / Math.max(1, nativeHeight);
    let width = host.width;
    let height = width / ratio;
    if (height > host.height) {
      height = host.height;
      width = height * ratio;
    }
    this.videoStage.style.width = `${Math.max(1, Math.floor(width))}px`;
    this.videoStage.style.height = `${Math.max(1, Math.floor(height))}px`;
    this.applyVideoTransform();
  }

  private applyVideoTransform(): void {
    if (!this.videoStage) return;
    this.videoStage.style.transform = `translate(${this.videoPanX}px, ${this.videoPanY}px) scale(${this.videoZoom})`;
    this.updateVideoChrome();
  }

  private setVideoZoom(value: number, clientX?: number, clientY?: number): void {
    const next = Math.max(.1, Math.min(8, value));
    if (this.videoHost && clientX !== undefined && clientY !== undefined) {
      const rect = this.videoHost.getBoundingClientRect();
      const pointX = clientX - (rect.left + rect.width / 2);
      const pointY = clientY - (rect.top + rect.height / 2);
      const localX = (pointX - this.videoPanX) / this.videoZoom;
      const localY = (pointY - this.videoPanY) / this.videoZoom;
      this.videoPanX = pointX - localX * next;
      this.videoPanY = pointY - localY * next;
    }
    this.videoZoom = next;
    if (next <= 1) {
      this.videoPanX = 0;
      this.videoPanY = 0;
    }
    this.applyVideoTransform();
  }

  private resetVideoView(): void {
    this.videoZoom = 1;
    this.videoPanX = 0;
    this.videoPanY = 0;
    this.videoAspectOverride = null;
    this.fitVideoSurface();
    this.applyVideoTransform();
  }

  private setVideoAspect(ratio: number | null): void {
    this.videoAspectOverride = ratio;
    this.videoPanX = 0;
    this.videoPanY = 0;
    this.fitVideoSurface();
  }

  // Marker movement is a draft until the explicit audio commit (or optional auto-commit).
  private retimeCue(id: string, startMs: number, endMs: number, _commit: boolean): void {
    const cue = this.doc.cues.find((c) => c.id === id);
    if (!cue) return;
    this.timingDraft.set(cue, startMs, endMs);
    this.renderTimingDraft();
    // The audio display owns native drag-edge scrolling; do not fit/jump on mouse-up.
    if (audioFlag("autocommit", false)) this.applyTimingDraft(true);
  }

  private audioSelection(): Cue | undefined {
    const cue = this.selectedCue();
    return cue && this.timingDraft.read(cue, this.doc.format === "ass" ? 10 : 1);
  }

  private scrollAudioSelectionIntoView(): void {
    const range = this.audioSelection();
    if (this.audio.element && range?.endMs && localStorage.getItem("aegisub-web.audio-autoscroll") !== "false") this.timeline?.showRange(range.startMs / 1000, range.endMs / 1000);
  }

  private audioLead(which: "in" | "out"): number {
    const fallback = which === "in" ? 100 : 350;
    const raw = localStorage.getItem(`aegisub-web.lead-${which}`);
    const value = raw === null ? fallback : Number(raw);
    return Number.isFinite(value) ? Math.max(0, value) : fallback;
  }

  private renderTimingDraft(): void {
    this.root.dataset.timingPending = String(this.timingDraft.pending);
    const cue = this.audioSelection();
    if (cue) {
      const fields = this.detailEl.querySelectorAll<HTMLInputElement>(".se-times:first-child > .se-field > input");
      const values = [this.formatEditTime(cue.startMs), this.formatEditTime(cue.endMs), this.formatEditDuration(cue)];
      fields.forEach((field, index) => { if (document.activeElement !== field && values[index] !== undefined) field.value = values[index]; });
      this.updateCpsInfo(cue);
    }
    this.timeline?.render();
  }

  private formatEditTime(ms: number): string { return this.doc.format === "ass" ? formatAssTime(ms) : formatTimestamp(ms, this.doc.format === "srt" ? "," : "."); }
  private formatEditDuration(cue: Cue): string { return this.doc.format === "ass" ? formatAssTime(assTimeMilliseconds(cue.endMs) - assTimeMilliseconds(cue.startMs)) : ((cue.endMs - cue.startMs) / 1000).toFixed(3); }

  private applyTimingDraft(automatic: boolean): void {
    if (!this.timingDraft.pending) return;
    const updates = this.timingDraft.entries();
    const previous = automatic && this.autoTimingHistory && this.history.canAmend(this.autoTimingHistory.id) ? this.autoTimingHistory : null;
    const before = previous?.snapshot ?? this.snapshot();
    window.clearTimeout(this.histTimer); this.histTimer = 0;
    if (!previous) this.history.commit(before); // seal text/other edits before timing
    // Keep the runtime line objects stable, like TimeableLine::Apply. The detail editor's
    // style/actor controls hold these objects; replacing them would silently detach edits.
    for (const cue of this.doc.cues) { const range = updates.get(cue.id); if (range) Object.assign(cue, range); }
    this.timingDraft.markCommitted();
    // Structural sharing mirrors the native single-line amendment: keep large embedded
    // font strings and unchanged cues out of repeated full-document clones while dragging.
    const snapshot: HistorySnap = { ...before, activeTrackId: this.activeTrackId, selectedId: this.selectedId, selectedIds: [...this.selectedIds],
      tracks: before.tracks.map(track => track.id !== this.activeTrackId ? track : { ...track, doc: { ...track.doc,
        cues: track.doc.cues.map(cue => updates.has(cue.id) ? { ...cue, ...updates.get(cue.id)! } : cue),
      } }),
    };
    const id = this.history.record(snapshot, previous?.id);
    this.autoTimingHistory = automatic ? { id, snapshot } : null;
    for (const cueId of updates.keys()) this.refreshRow(cueId);
    this.root.dataset.timingPending = "false";
    this.markDirty(false); this.updateHistoryButtons();
    // Auto-commit updates the real ASS preview during the gesture, not 300ms after
    // the final pointer event. At most one renderer update is submitted per paint.
    if (!this.timingPreviewRaf) this.timingPreviewRaf = requestAnimationFrame(() => { this.timingPreviewRaf = 0; this.pushSubtitles(true); });
  }

  private commitAudioTiming(next: boolean, resetNext = false): void {
    const range = this.audioSelection();
    if (!range) return;
    this.applyTimingDraft(false);
    if (next) {
      const index = this.doc.cues.findIndex(cue => cue.id === range.id);
      let following = this.doc.cues[index + 1];
      if (!following) {
        following = blankCue(0, 0);
        following.assKind = range.assKind;
        following.assFields = range.assFields ? { ...range.assFields } : undefined;
        this.applyCueList([...this.doc.cues, following], [following.id]);
      } else this.select(following.id);
      if (resetNext || following.endMs === 0) this.timingDraft.set(following, range.endMs, range.endMs + 3000);
    }
    this.renderDetail();
    this.renderTimingDraft();
    this.scrollAudioSelectionIntoView();
  }

  private adjustAudioTiming(startDelta: number, endDelta: number): void {
    const cue = this.audioSelection();
    if (!cue) return;
    const start = Math.max(0, Math.min(cue.endMs, cue.startMs + startDelta));
    const end = Math.max(start, cue.endMs + endDelta);
    this.retimeCue(cue.id, start, end, true);
  }

  // --- cue list (virtualized) ----------------------------------------------

  private onScroll = (): void => {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.renderWindow();
    });
  };

  private renderList(): void {
    this.innerEl.style.height = `${this.doc.cues.length * this.rowHeight()}px`;
    this.countEl.textContent = t("cueCount", { n: this.doc.cues.length });
    this.renderWindow();
    if (this.doc.cues.length === 0) this.renderEmptyList();
    this.timeline?.render();
  }

  private renderEmptyList(): void {
    this.rows.clear();
    this.innerEl.textContent = "";
    const empty = el("div", "se-empty");
    empty.style.position = "absolute";
    empty.style.inset = "0";
    empty.appendChild(el("div", "", t("noCues")));
    this.innerEl.appendChild(empty);
  }

  private renderWindow(): void {
    const cues = this.doc.cues;
    if (cues.length === 0) return;
    const scrollTop = this.scrollEl.scrollTop;
    const viewH = this.scrollEl.clientHeight || 400;
    const rowHeight = this.rowHeight();
    const first = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
    const last = Math.min(cues.length - 1, Math.ceil((scrollTop + viewH) / rowHeight) + OVERSCAN);

    const needed = new Set<string>();
    for (let i = first; i <= last; i += 1) {
      const cue = cues[i];
      needed.add(cue.id);
      let row = this.rows.get(cue.id);
      if (!row) {
        row = this.makeRow(cue);
        this.rows.set(cue.id, row);
        this.innerEl.appendChild(row);
      }
      this.fillRow(row, cue, i);
      row.style.top = `${i * rowHeight}px`;
    }
    // Recycle rows that scrolled out of the window.
    for (const [id, row] of this.rows) {
      if (!needed.has(id)) {
        row.remove();
        this.rows.delete(id);
      }
    }
  }

  // Build the grid exactly in Aegisub's native column order. Optional ASS columns collapse
  // to zero when every line is empty, matching GridColumn::Width in upstream Aegisub.
  private renderListHead(): void {
    this.headEl.textContent = "";
    const ass = this.doc.format === "ass";
    const has = (field: string): boolean => this.doc.cues.some((cue) => {
      const value = cue.assFields?.[field] ?? "";
      return field === "Layer" || field.startsWith("Margin") ? Number(value) !== 0 : value.trim() !== "";
    });
    this.gridColumns = ["num"];
    if (ass && has("Layer")) this.gridColumns.push("layer");
    this.gridColumns.push("start", "end", "cps");
    if (ass) this.gridColumns.push("style");
    if (ass && has("Name")) this.gridColumns.push("actor");
    if (ass && has("Effect")) this.gridColumns.push("effect");
    if (ass && has("MarginL")) this.gridColumns.push("margin-l");
    if (ass && has("MarginR")) this.gridColumns.push("margin-r");
    if (ass && has("MarginV")) this.gridColumns.push("margin-v");
    this.gridColumns.push("text");
    const widths: Record<GridColumnKey, string> = {
      num: "32px", layer: "27px", start: "82px", end: "82px", cps: "38px", style: "86px",
      actor: "86px", effect: "86px", "margin-l": "43px", "margin-r": "43px", "margin-v": "43px",
      text: "minmax(180px,1fr)",
    };
    this.leftEl.style.setProperty("--se-grid-columns", this.gridColumns.map((column) => widths[column]).join(" "));
    const labels: Record<GridColumnKey, string> = {
      num: "#", layer: "L", start: t("colStart"), end: t("colEnd"), cps: "CPS", style: "Style",
      actor: "Actor", effect: "Effect", "margin-l": "Left", "margin-r": "Right", "margin-v": "Vert", text: t("colText"),
    };
    for (const column of this.gridColumns) this.headEl.appendChild(el("div", `se-cell se-${column}`, labels[column]));
  }

  private makeRow(cue: Cue): HTMLDivElement {
    const row = el("div", "se-row") as HTMLDivElement;
    row.dataset.id = cue.id;
    row.id = `se-opt-${cue.id}`;
    row.setAttribute("role", "option");
    for (const column of this.gridColumns) {
      const time = column === "start" || column === "end" ? " se-time" : "";
      row.appendChild(el("div", `se-cell se-${column}${time}`));
    }
    // Focus the list on click so the keyboard shortcuts (arrows, Insert/⌘Enter, Delete) work
    // immediately after picking a cue with the mouse.
    row.addEventListener("click", (e) => {
      if (e.shiftKey) this.extendSelect(cue.id);
      else if (e.metaKey || e.ctrlKey) this.toggleSelect(cue.id);
      else this.select(cue.id);
      if (this.video) this.stopAndSeek(cue.startMs);
      this.innerEl.focus();
    });
    row.addEventListener("dblclick", () => this.stopAndSeek(cue.startMs));
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (!this.selectedIds.has(cue.id)) this.select(cue.id);
      this.openGridContextMenu(event.clientX, event.clientY);
    });
    return row;
  }

  private openGridContextMenu(x: number, y: number): void {
    this.contextMenu?.remove();
    if (this.contextMenuClose) document.removeEventListener("pointerdown", this.contextMenuClose, true);
    const menu = el("div", "se-context-menu") as HTMLDivElement;
    menu.setAttribute("role", "menu");
    const add = (label: string, command: string): void => {
      const control = el("button", "se-context-item", label) as HTMLButtonElement;
      control.type = "button";
      control.setAttribute("role", "menuitem");
      control.addEventListener("click", () => {
        this.runAegisubCommand(command);
        menu.remove();
        this.contextMenu = null;
        if (this.contextMenuClose) document.removeEventListener("pointerdown", this.contextMenuClose, true);
        this.contextMenuClose = null;
      });
      menu.append(control);
    };
    const separator = (): void => { menu.append(el("div", "se-context-separator")); };
    add("在前面插入", "subtitle/insert/before");
    add("在后面插入", "subtitle/insert/after");
    add("重复所选行", "edit/line/duplicate");
    add("在播放头前拆分", "edit/line/split/before");
    add("在播放头后拆分", "edit/line/split/after");
    separator();
    add("交换所选行", "grid/swap");
    add("合并（连接文本）", "edit/line/join/concatenate");
    add("合并（保留首行）", "edit/line/join/keep_first");
    add("合并为卡拉 OK", "edit/line/join/as_karaoke");
    add("重组行", "edit/line/recombine");
    separator();
    add("连续时间（修改开始）", "time/continuous/start");
    add("连续时间（修改结束）", "time/continuous/end");
    add("导出所选音频片段", "audio/save/clip");
    separator();
    add("剪切", "edit/line/cut");
    add("复制", "edit/line/copy");
    add("粘贴", "edit/line/paste");
    add("选择字段覆盖粘贴…", "edit/line/paste/over");
    add("删除", "edit/line/delete");
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.append(menu);
    this.contextMenu = menu;
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`;
      menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`;
    });
    const close = (event: PointerEvent): void => {
      if (!menu.contains(event.target as Node)) {
        menu.remove();
        this.contextMenu = null;
          document.removeEventListener("pointerdown", close, true);
          this.contextMenuClose = null;
      }
    };
    this.contextMenuClose = close;
    requestAnimationFrame(() => document.addEventListener("pointerdown", close, true));
  }

  private fillRow(row: HTMLDivElement, cue: Cue, index: number): void {
    const sep = this.doc.format === "srt" ? "," : ".";
    const cell = (c: string) => row.querySelector<HTMLElement>(`.${c}`);
    const set = (name: string, value: string): void => {
      const target = cell(name);
      if (target) {
        target.textContent = value;
        target.title = value;
      }
    };
    const gridTime = (ms: number): string => this.doc.format === "ass" ? formatAssTime(ms) : formatTimestamp(ms, sep);
    set("se-num", String(index + 1));
    set("se-layer", Number(cue.assFields?.Layer ?? 0) ? String(cue.assFields?.Layer) : "");
    set("se-start", gridTime(cue.startMs));
    set("se-end", gridTime(cue.endMs));
    const c = cps(cue);
    const cpsCell = cell("se-cps");
    if (cpsCell) {
      cpsCell.textContent = c ? c.toFixed(0) : "";
      cpsCell.className = "se-cell se-cps" + (c > CPS_BAD ? " bad" : c > CPS_WARN ? " warn" : "");
    }
    set("se-style", cue.assFields?.Style || "Default");
    set("se-actor", cue.assFields?.Name ?? "");
    set("se-effect", cue.assFields?.Effect ?? "");
    set("se-margin-l", Number(cue.assFields?.MarginL ?? 0) ? String(Number(cue.assFields?.MarginL)) : "");
    set("se-margin-r", Number(cue.assFields?.MarginR ?? 0) ? String(Number(cue.assFields?.MarginR)) : "");
    set("se-margin-v", Number(cue.assFields?.MarginV ?? 0) ? String(Number(cue.assFields?.MarginV)) : "");
    const gridText = this.tagDisplayMode === "hide"
      ? cue.text.replace(/\{[^}]*\}/g, "")
      : this.tagDisplayMode === "simplify"
        ? cue.text.replace(/\{[^}]*\}/g, "☀")
        : cue.text;
    // Keep ASS's literal \N visible just as desktop Aegisub does. Only libass interprets it
    // as a rendered line break; SRT/VTT model newlines remain visual break markers here.
    set("se-text", this.doc.format === "ass" ? gridText.replace(/\r\n?|\n/g, "\\N") : gridText.replace(/\n/g, " ⏎ "));
    row.classList.toggle("sel", this.selectedIds.has(cue.id));
    row.classList.toggle("primary", cue.id === this.selectedId && this.selectedIds.size > 1);
    row.classList.toggle("playing", cue.id === this.playingId);
    const mediaMs = (this.video?.currentTime ?? -1) * 1000;
    row.classList.toggle("inframe", mediaMs >= cue.startMs && mediaMs < cue.endMs);
    row.classList.toggle("commented", cue.assKind === "Comment");
    this.paintPeers(row, cue.id);
    row.setAttribute("aria-selected", String(this.selectedIds.has(cue.id)));
    // A spoken description of the cue for screen readers: index, timing, and text.
    const spoken = visibleText(cue.text) || t("noCues");
    row.setAttribute("aria-label", `${index + 1}. ${formatTimestamp(cue.startMs, sep)} – ${formatTimestamp(cue.endMs, sep)}. ${spoken}`);
  }

  private refreshRow(id: string): void {
    const row = this.rows.get(id);
    const index = this.doc.cues.findIndex((c) => c.id === id);
    if (row && index >= 0) this.fillRow(row, this.doc.cues[index], index);
  }

  // --- selection + detail editor -------------------------------------------

  // Single-select a cue (collapsing any multi-selection to just it).
  private select(id: string): void {
    this.setSelection([id], id);
  }

  /** Paint the peer markers onto a row. Called for every row as it is (re)rendered. */
  private paintPeers(row: HTMLElement, cueId: string): void {
    const here = this.peerCues.filter((p) => p.cueId === cueId);
    row.querySelector(".se-peerflags")?.remove();
    row.classList.toggle("se-peer", here.length > 0);
    if (!here.length) {
      row.style.removeProperty("--se-peer-colour");
      return;
    }

    // A row has one border, so it can only carry one colour; with several people on the
    // same cue the border says "someone is here" and each name badge says who, in that
    // person's own colour. Otherwise two peers on one cue would be indistinguishable.
    row.style.setProperty("--se-peer-colour", here[0].colour);
    const flags = el("span", "se-peerflags");
    for (const peer of here) {
      const flag = el("i", "se-peerflag");
      flag.textContent = peer.name;
      flag.style.background = peer.colour;
      flags.appendChild(flag);
    }
    row.appendChild(flags);
  }

  setPeerCues(peers: PeerCue[]): void {
    this.peerCues = peers;
    for (const [id, row] of this.rows) this.paintPeers(row, id);
  }

  // Set the selection to `ids` with `primary` as the detail-edited cue. Refreshes every row
  // whose selected state changed, and re-renders the detail for the primary.
  private setSelection(ids: string[], primary: string): void {
    this.visualTransform?.refresh();
    const primaryChanged = primary !== this.selectedId;
    if (primaryChanged) {
      this.autoTimingHistory = null;
      this.timingDraft.clear();
      this.root.dataset.timingPending = "false";
      // Deferred: setSelection runs mid-render, and a host may repaint in response.
      queueMicrotask(() => this.opts.onSelectionChanged?.(this.selectedId));
    }
    if (this.posOverlay) this.exitPosition();
    if (this.clipOverlay) this.exitClip();
    if (this.drawOverlay) this.exitDraw();
    this.vectorClip?.close();
    this.vectorClip = null;
    const affected = new Set<string>([...this.selectedIds, ...ids]);
    this.selectedIds = new Set(ids);
    this.selectedId = primary;
    const c = this.doc.cues.find((k) => k.id === primary);
    this.detailTab = c && /\\p[1-9]/.test(c.text) ? "drawing" : "text";
    for (const rid of affected) this.refreshRow(rid);
    this.innerEl.setAttribute("aria-activedescendant", `se-opt-${primary}`);
    this.scrollSelectedIntoView();
    this.renderDetail();
    this.timeline?.render();
    // Aegisub treats choosing a line as choosing its timing range. Stop any old range/video
    // playback and put the playhead on the new line immediately; otherwise audio from the
    // previous line continues while the edit box shows a different one.
    if (primaryChanged && c) this.stopAndSeek(c.startMs);
    if (primaryChanged) this.scrollAudioSelectionIntoView();
    this.visualTransform?.refresh();
  }

  // Cmd/Ctrl-click: toggle a cue in/out of the selection.
  private toggleSelect(id: string): void {
    const ids = new Set(this.selectedIds);
    if (ids.has(id) && ids.size > 1) {
      ids.delete(id);
      const primary = this.selectedId === id ? [...ids][ids.size - 1] : this.selectedId!;
      this.setSelection([...ids], primary);
    } else {
      ids.add(id);
      this.setSelection([...ids], id);
    }
  }

  // Shift-click / shift-arrow: select the range between the current primary (anchor) and id.
  private extendSelect(id: string): void {
    this.setSelection(rangeIds(this.doc.cues, this.selectedId, id), id);
  }

  private scrollSelectedIntoView(): void {
    if (this.selectedId) this.scrollCueIntoView(this.selectedId);
  }

  private renderDetail(): void {
    this.detailEl.textContent = "";
    const cue = this.selectedCue();
    if (!cue) {
      this.detailEl.appendChild(el("div", "se-count", t("selectCue")));
      return;
    }
    const times = el("div", "se-times");
    times.appendChild(
      this.timeField(t("start"), this.formatEditTime(cue.startMs), (v) => {
        const ms = parseTimestamp(v);
        if (!Number.isNaN(ms)) this.updateCue(cue.id, { startMs: ms });
      }),
    );
    times.appendChild(
      this.timeField(t("end"), this.formatEditTime(cue.endMs), (v) => {
        const ms = parseTimestamp(v);
        if (!Number.isNaN(ms)) this.updateCue(cue.id, { endMs: ms });
      }),
    );
    times.appendChild(
      this.timeField(t("duration"), this.formatEditDuration(cue), (v) => {
        const durationMs = v.includes(":") ? parseTimestamp(v) : Number(v) * 1000;
        if (v && Number.isFinite(durationMs)) this.updateCue(cue.id, { endMs: this.doc.format === "ass" ? assTimeMilliseconds(cue.startMs) + assTimeMilliseconds(durationMs) : cue.startMs + Math.max(0, Math.round(durationMs)) });
      }),
    );
    if (this.doc.format === "ass") times.appendChild(this.styleField(cue));
    // Live reading-speed feedback for the selected cue, right-aligned in the times row.
    this.cpsInfoEl = el("div", "se-cpsinfo");
    times.appendChild(this.cpsInfoEl);
    this.updateCpsInfo(cue);
    this.detailEl.appendChild(times);

    const ta = this.makeTextarea(cue);
    this.detailEl.appendChild(ta);
    if (this.doc.format === "ass" && this.assExtrasOpen) this.detailEl.appendChild(this.assExtrasRow(cue));
    if (this.doc.format === "ass" && this.assStyleToolsOpen) {
      // Text / Drawing tabs: each shows only its relevant tools.
      const tabs = el("div", "se-tabs");
      const mkTab = (id: "text" | "drawing", label: string) => {
        const b = el("button", "se-tab" + (this.detailTab === id ? " on" : ""), label);
        b.addEventListener("click", () => {
          this.detailTab = id;
          this.renderDetail();
        });
        return b;
      };
      tabs.append(mkTab("text", t("tabText")), mkTab("drawing", t("tabDrawing")));
      this.detailEl.appendChild(tabs);
      this.detailEl.appendChild(this.inlineToolbar(cue, ta, this.detailTab));
    }
    if (getAIAnalysisSettings().enabled) {
      const ai = this.button("AI", () => openAIAnalysis(visibleText(cue.text)));
      ai.classList.add("se-ai-analysis");
      ai.title = "AI Grammar Analysis";
      this.detailEl.appendChild(ai);
    }
  }

  private makeTextarea(cue: Cue): HTMLTextAreaElement {
    const ta = document.createElement("textarea");
    ta.value = this.doc.format === "ass" ? cue.text.replace(/\r\n?|\n/g, "\\N") : cue.text;
    if (this.doc.format === "ass") ta.wrap = "off";
    ta.spellcheck = this.opts.spellcheck !== false;
    ta.lang = this.opts.locale || navigator.language || "en";
    this.detailTextarea = ta;
    ta.addEventListener("keydown", (event) => {
      if (this.doc.format !== "ass" || event.key !== "Enter" || !event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      // execCommand is retained here specifically because browser editing commands join the
      // native textarea undo transaction. Assigning ta.value after a physical newline made
      // Ctrl/Cmd+Z skip \N entirely. The fallback keeps editing functional on engines which
      // do not expose insertText, while all supported desktop engines take the undo-safe path.
      if (!document.execCommand("insertText", false, "\\N")) {
        ta.setRangeText("\\N", ta.selectionStart, ta.selectionEnd, "end");
        ta.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "\\N" }));
      }
    });
    ta.addEventListener("input", () => {
      if (this.doc.format === "ass" && /\r|\n/.test(ta.value)) {
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const before = ta.value.slice(0, start).replace(/\r\n?|\n/g, "\\N").length;
        const selected = ta.value.slice(start, end).replace(/\r\n?|\n/g, "\\N").length;
        ta.value = ta.value.replace(/\r\n?|\n/g, "\\N");
        ta.setSelectionRange(before, before + selected);
      }
      this.updateCue(cue.id, { text: ta.value }, /*fromText*/ true);
      this.updateCpsInfo(cue); // text edits don't re-render the detail, so refresh the readout
    });
    return ta;
  }

  private cpsInfoEl: HTMLElement | null = null;

  // Show the selected cue's reading speed and visible-character count, coloured like the list.
  private updateCpsInfo(cue: Cue): void {
    if (!this.cpsInfoEl) return;
    const c = cps(cue);
    const chars = visibleText(cue.text).length;
    this.cpsInfoEl.textContent = t("cpsChars", { cps: c ? c.toFixed(0) : "0", chars: String(chars) });
    this.cpsInfoEl.className = "se-cpsinfo" + (c > CPS_BAD ? " bad" : c > CPS_WARN ? " warn" : "");
  }

  // --- colours (whole-cue \1c fill / \3c border / \4c shadow-or-box) --------

  private cueColorHex(cue: Cue, tag: string, styleField: string): string {
    const m = cue.text.match(new RegExp(`\\\\${tag}&H([0-9A-Fa-f]{6})&`));
    if (m) {
      const h = m[1];
      return `#${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toLowerCase();
    }
    const style = this.doc.styles?.find((s) => s.name === (cue.assFields?.Style ?? "Default"));
    return assColorToHex(style?.fields[styleField] ?? "&H00FFFFFF").hex;
  }

  private setCueColor(cue: Cue, ta: HTMLTextAreaElement, tag: string, hex: string): void {
    const m = hex.match(/^#?([0-9a-f]{6})$/i);
    const h = m ? m[1] : "ffffff";
    const bgr = (h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2)).toUpperCase();
    const stripped = cue.text.replace(new RegExp(`\\\\${tag}&H[0-9A-Fa-f]+&`, "g"), "").replace(/\{\}/g, "");
    ta.value = `{\\${tag}&H${bgr}&}` + stripped;
    this.updateCue(cue.id, { text: ta.value }, true);
  }

  // A boxed area pairing a colour swatch with an opacity slider and an optional width
  // field, under one label (Fill / Border / Shadow) so it reads as a single control.
  private colorGroup(cue: Cue, ta: HTMLTextAreaElement, label: string, colorTag: string, alphaTag: string, styleField: string, colorTitle: string, widthTag?: string): HTMLElement {
    const g = el("div", "se-cgroup");
    g.appendChild(el("span", "se-cglabel", label));
    g.appendChild(this.colorButton(cue, ta, colorTag, styleField, colorTitle));
    g.appendChild(this.alphaSlider(cue, ta, alphaTag, styleField));
    if (widthTag) g.appendChild(this.numField(cue, ta, widthTag, widthTag === "shad" ? t("tipShadowWidthField") : t("tipBorderWidthField")));
    return g;
  }

  // Opacity slider (0..100%) writing the alpha override (\1a/\3a/\4a). ASS alpha is
  // inverted (&H00 opaque, &HFF transparent), so 100% == &H00.
  private alphaSlider(cue: Cue, ta: HTMLTextAreaElement, alphaTag: string, styleField: string): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "range";
    input.className = "se-alpha";
    input.min = "0";
    input.max = "100";
    const m = cue.text.match(new RegExp(`\\\\${alphaTag}&H([0-9A-Fa-f]{2})&`));
    const style = this.doc.styles?.find((s) => s.name === (cue.assFields?.Style ?? "Default"));
    const aa = m ? m[1] : assColorToHex(style?.fields[styleField] ?? "&H00FFFFFF").alpha;
    const pct = Math.round((1 - parseInt(aa || "00", 16) / 255) * 100);
    input.value = String(pct);
    input.title = t("tipOpacity");
    input.addEventListener("input", () => {
      const hex = Math.round((1 - Number(input.value) / 100) * 255).toString(16).padStart(2, "0").toUpperCase();
      const stripped = cue.text.replace(new RegExp(`\\\\${alphaTag}&H[0-9A-Fa-f]+&`, "g"), "").replace(/\{\}/g, "");
      ta.value = `{\\${alphaTag}&H${hex}&}` + stripped;
      this.updateCue(cue.id, { text: ta.value }, true);
    });
    return input;
  }

  // Per-span font: name (\fn) and size (\fs), defaulting from the cue's style. The name
  // input offers used and embedded fonts as suggestions.
  private fontGroup(cue: Cue, ta: HTMLTextAreaElement): HTMLElement {
    const g = el("div", "se-cgroup");
    g.appendChild(el("span", "se-cglabel", t("styleFont")));
    const style = this.doc.styles?.find((s) => s.name === (cue.assFields?.Style ?? "Default"));
    const name = document.createElement("input");
    name.type = "text";
    name.className = "se-fontname";
    name.title = t("tipFontName");
    name.setAttribute("list", "se-spanfontlist");
    name.placeholder = style?.fields.Fontname ?? "";
    name.value = cue.text.match(/\\fn([^\\}]+)/)?.[1]?.trim() ?? "";
    name.addEventListener("change", () => {
      const stripped = cue.text.replace(/\\fn[^\\}]*/g, "").replace(/\{\}/g, "");
      ta.value = name.value.trim() === "" ? stripped : `{\\fn${name.value.trim()}}` + stripped;
      this.updateCue(cue.id, { text: ta.value }, true);
    });
    g.append(name, this.fontDatalist(), this.numField(cue, ta, "fs", t("tipFontSize")));
    return g;
  }

  private fontDatalist(): HTMLDataListElement {
    const dl = document.createElement("datalist");
    dl.id = "se-spanfontlist";
    const fonts = new Set<string>();
    for (const s of this.doc.styles ?? []) if (s.fields.Fontname) fonts.add(s.fields.Fontname);
    for (const f of embeddedFontNames(this.doc)) fonts.add(f);
    for (const f of ["Arial", "Helvetica", "Times New Roman", "Verdana", "Tahoma", "Trebuchet MS", "Georgia", "Courier New", "Comic Sans MS"]) fonts.add(f);
    for (const f of fonts) {
      const o = document.createElement("option");
      o.value = f;
      dl.appendChild(o);
    }
    return dl;
  }

  private colorButton(cue: Cue, ta: HTMLTextAreaElement, tag: string, styleField: string, title: string): HTMLElement {
    const input = document.createElement("input");
    input.type = "color";
    input.className = "se-incolor";
    input.title = title;
    input.value = this.cueColorHex(cue, tag, styleField);
    input.addEventListener("input", () => this.setCueColor(cue, ta, tag, input.value));
    return input;
  }

  // The per-cue tool row. In "text" mode it shows text formatting (B/I/U, fade, karaoke,
  // alignment); in "drawing" mode it shows shape tools (edit shape, border width). Colours,
  // transform, position and clip apply to both.
  private inlineToolbar(cue: Cue, ta: HTMLTextAreaElement, mode: "text" | "drawing"): HTMLElement {
    const bar = el("div", "se-inlinebar");
    const wrap = (before: string, after: string): void => {
      const s = ta.selectionStart ?? ta.value.length;
      const e = ta.selectionEnd ?? s;
      ta.value = ta.value.slice(0, s) + before + ta.value.slice(s, e) + after + ta.value.slice(e);
      ta.focus();
      ta.setSelectionRange(s + before.length, e + before.length);
      this.updateCue(cue.id, { text: ta.value }, true);
    };
    const iconBtn = (html: string, title: string, fn: () => void, extra = ""): HTMLButtonElement => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `se-inbtn ${extra}`;
      b.innerHTML = html;
      b.title = title;
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", fn);
      return b;
    };

    if (mode === "text") {
      const tagBtn = (label: string, on: string, off: string, cls: string, tip: string) => {
        const b = iconBtn("", tip, () => wrap(`{\\${on}}`, `{\\${off}}`), cls);
        b.textContent = label;
        return b;
      };
      bar.append(
        tagBtn("B", "b1", "b0", "se-in-b", t("tipBold")),
        tagBtn("I", "i1", "i0", "se-in-i", t("tipItalic")),
        tagBtn("U", "u1", "u0", "se-in-u", t("tipUnderline")),
      );
      bar.appendChild(this.fontGroup(cue, ta));
    }

    // Fill / border / shadow, each grouping its colour with its width. Applies to
    // drawings and text alike (an ASS shape is outlined and shadowed like glyphs are).
    bar.append(
      this.colorGroup(cue, ta, t("fill"), "1c", "1a", "PrimaryColour", t("tipColorFill")),
      this.colorGroup(cue, ta, t("borderWidth"), "3c", "3a", "OutlineColour", t("tipColorBorder"), "bord"),
      this.colorGroup(cue, ta, t("shadowWidth"), "4c", "4a", "BackColour", t("tipColorBack"), "shad"),
    );

    if (mode === "drawing") {
      bar.appendChild(iconBtn(ICON.draw, t("tipEditShape"), () => this.toggleDraw(cue), "se-posbtn" + (this.drawOverlay ? " on" : "")));
    }

    // Fade and transform apply to both text and drawings; karaoke is text-only.
    bar.appendChild(iconBtn(ICON.fade, t("tipFade"), () => this.openFade(cue, ta)));
    if (mode === "text") {
      bar.appendChild(
        iconBtn(ICON.mic, t("tipKaraoke"), () =>
          openKaraoke(cue, this.audio.element, this.wavePeaks, this.cueColorHex(cue, "2c", "SecondaryColour"), (text) => {
            ta.value = text;
            this.updateCue(cue.id, { text }, true);
          }),
        ),
      );
    }

    bar.appendChild(iconBtn(ICON.transform, t("tipTransform"), () => this.openTransform(cue, ta)));

    if (mode === "text") {
      const align = document.createElement("select");
      align.className = "se-inalign";
      align.title = t("tipAlign");
      const optNone = document.createElement("option");
      optNone.value = "none";
      optNone.textContent = t("noAlign");
      align.appendChild(optNone);
      for (const { value, label } of alignmentOptions()) {
        const o = document.createElement("option");
        o.value = value;
        o.textContent = label;
        align.appendChild(o);
      }
      align.value = cue.text.match(/\\an([1-9])/)?.[1] ?? "none";
      align.addEventListener("change", () => {
        const stripped = cue.text.replace(/\{\\an[1-9]\}/g, "").replace(/\\an[1-9]/g, "").replace(/\{\}/g, "");
        ta.value = align.value === "none" ? stripped : `{\\an${align.value}}` + stripped;
        this.updateCue(cue.id, { text: ta.value }, true);
        this.renderDetail();
      });
      bar.appendChild(align);

      // Wrap style (\q): how libass breaks the line. "Default" removes the override.
      const wrap = document.createElement("select");
      wrap.className = "se-inalign";
      wrap.title = t("tipWrap");
      for (const { value, label } of [
        { value: "none", label: t("wrapDefault") },
        { value: "0", label: t("wrapSmart") },
        { value: "1", label: t("wrapEol") },
        { value: "2", label: t("wrapNone") },
        { value: "3", label: t("wrapSmartLow") },
      ]) {
        const o = document.createElement("option");
        o.value = value;
        o.textContent = label;
        wrap.appendChild(o);
      }
      wrap.value = cue.text.match(/\\q([0-3])/)?.[1] ?? "none";
      wrap.addEventListener("change", () => {
        const stripped = cue.text.replace(/\{\\q[0-3]\}/g, "").replace(/\\q[0-3]/g, "").replace(/\{\}/g, "");
        ta.value = wrap.value === "none" ? stripped : `{\\q${wrap.value}}` + stripped;
        this.updateCue(cue.id, { text: ta.value }, true);
      });
      bar.appendChild(wrap);
    }

    bar.appendChild(iconBtn("⌖", t("tipPosition"), () => this.togglePosition(cue), "se-posbtn" + (this.positionCueId === cue.id ? " on" : "")));
    bar.appendChild(iconBtn(ICON.clip, t("tipClip"), () => this.toggleClip(cue), "se-posbtn" + (this.clipOverlay ? " on" : "")));
    return bar;
  }

  // A numeric override field, e.g. border width (\bord) or shadow depth (\shad).
  private numField(cue: Cue, ta: HTMLTextAreaElement, tag: string, title: string): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "number";
    input.className = "se-widthfield";
    input.min = "0";
    input.step = "0.5";
    input.title = title;
    input.placeholder = title;
    input.value = cue.text.match(new RegExp(`\\\\${tag}([\\d.]+)`))?.[1] ?? "";
    input.addEventListener("change", () => {
      const stripped = cue.text.replace(new RegExp(`\\\\${tag}[\\d.]+`, "g"), "").replace(/\{\}/g, "");
      ta.value = input.value === "" ? stripped : `{\\${tag}${input.value}}` + stripped;
      this.updateCue(cue.id, { text: ta.value }, true);
    });
    return input;
  }

  // --- position picker (\pos via clicking the preview) ---------------------

  // The stage is fitted to the active aspect ratio, so the media element itself is the exact
  // drawable content box (including wheel zoom/pan transforms).
  private videoContentRect(): { left: number; top: number; width: number; height: number } {
    const rect = this.video!.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }

  private togglePosition(cue: Cue): void {
    if (this.posOverlay) {
      this.exitPosition();
      return;
    }
    if (this.clipOverlay) this.exitClip();
    if (this.drawOverlay) this.exitDraw();
    if (!this.video) {
      this.toast(t("posNeedsVideo"));
      return;
    }
    this.positionCueId = cue.id;
    const ov = el("div", "se-posoverlay") as HTMLDivElement;
    ov.title = t("positionPick");
    // Cover only the video's content box so only clicks on the picture set a position.
    const cr = this.videoContentRect();
    const rr = this.rightEl.getBoundingClientRect();
    ov.style.left = `${cr.left - rr.left}px`;
    ov.style.top = `${cr.top - rr.top}px`;
    ov.style.width = `${cr.width}px`;
    ov.style.height = `${cr.height}px`;
    // Click sets a static \pos; drag turns it into a \move (the line animates from where
    // you pressed to where you release). The subtitle follows the cursor live during drag.
    let down: { x: number; y: number; moved: boolean } | null = null;
    const cur = () => this.doc.cues.find((k) => k.id === this.positionCueId);
    ov.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY, moved: false };
      ov.setPointerCapture(e.pointerId);
      const c = cur();
      if (c) this.setCuePosition(c, e.clientX, e.clientY);
    });
    ov.addEventListener("pointermove", (e) => {
      if (!down || !(e.buttons & 1)) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) down.moved = true;
      const c = cur();
      if (c) this.setCuePosition(c, e.clientX, e.clientY); // live follow
    });
    ov.addEventListener("pointerup", (e) => {
      const c = cur();
      if (down && down.moved && c) this.setCueMove(c, down.x, down.y, e.clientX, e.clientY);
      down = null;
    });
    // Explicit "Done" affordance (plus Esc and the toolbar toggle) to leave the mode.
    const done = document.createElement("button");
    done.className = "se-posdone";
    done.textContent = t("done");
    done.addEventListener("pointerdown", (e) => e.stopPropagation());
    done.addEventListener("click", () => this.exitPosition());
    const hint = el("div", "se-poshint", t("moveHint"));
    ov.append(done, hint);
    this.rightEl.appendChild(ov);
    this.posOverlay = ov;
    document.addEventListener("keydown", this.onPosKey, true);
    this.renderDetail(); // highlight the toggle
  }

  private onPosKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && this.posOverlay) {
      e.preventDefault();
      this.exitPosition();
    }
  };

  private exitPosition(): void {
    document.removeEventListener("keydown", this.onPosKey, true);
    this.posOverlay?.remove();
    this.posOverlay = null;
    this.positionCueId = null;
    this.renderDetail();
  }

  // Map a viewport point to PlayRes coordinates, or null if outside the picture.
  private clientToPlayRes(clientX: number, clientY: number): { px: number; py: number } | null {
    if (!this.video) return null;
    const cr = this.videoContentRect();
    const nx = (clientX - cr.left) / cr.width;
    const ny = (clientY - cr.top) / cr.height;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
    const res = getPlayRes(this.doc);
    return { px: Math.round(nx * res.x), py: Math.round(ny * res.y) };
  }

  private applyCueTag(cue: Cue, tag: string): void {
    const stripped = cue.text.replace(/\\(pos|move)\([^)]*\)/g, "").replace(/\{\}/g, "");
    cue.text = `{${tag}}` + stripped;
    if (this.detailTextarea) this.detailTextarea.value = cue.text;
    this.refreshRow(cue.id);
    this.markDirty();
  }

  private setCuePosition(cue: Cue, clientX: number, clientY: number): void {
    const p = this.clientToPlayRes(clientX, clientY);
    if (p) this.applyCueTag(cue, `\\pos(${p.px},${p.py})`);
  }

  private setCueMove(cue: Cue, x1: number, y1: number, x2: number, y2: number): void {
    const a = this.clientToPlayRes(x1, y1);
    const b = this.clientToPlayRes(x2, y2);
    if (a && b) this.applyCueTag(cue, `\\move(${a.px},${a.py},${b.px},${b.py})`);
  }

  // --- clip (\clip / \iclip via dragging a rectangle) ----------------------

  private toggleClip(cue: Cue): void {
    if (this.clipOverlay) {
      this.exitClip();
      return;
    }
    if (this.posOverlay) this.exitPosition();
    if (this.drawOverlay) this.exitDraw();
    if (!this.video) {
      this.toast(t("posNeedsVideo"));
      return;
    }
    const ov = el("div", "se-posoverlay se-clipoverlay") as HTMLDivElement;
    const cr = this.videoContentRect();
    const rr = this.rightEl.getBoundingClientRect();
    ov.style.left = `${cr.left - rr.left}px`;
    ov.style.top = `${cr.top - rr.top}px`;
    ov.style.width = `${cr.width}px`;
    ov.style.height = `${cr.height}px`;
    const band = el("div", "se-cliprect");
    band.style.display = "none";
    let inverse = /\\iclip\(/.test(cue.text);
    const bar = el("div", "se-posbar");
    const inv = document.createElement("button");
    inv.className = "se-obtn" + (inverse ? " on" : "");
    inv.textContent = t("inverse");
    inv.addEventListener("pointerdown", (e) => e.stopPropagation());
    inv.addEventListener("click", (e) => {
      e.stopPropagation();
      inverse = !inverse;
      inv.classList.toggle("on", inverse);
    });
    const done = document.createElement("button");
    done.className = "se-obtn se-obtn-primary";
    done.textContent = t("done");
    done.addEventListener("pointerdown", (e) => e.stopPropagation());
    done.addEventListener("click", () => this.exitClip());
    bar.append(inv, done);
    const hint = el("div", "se-poshint", t("clipHint"));
    let start: { x: number; y: number } | null = null;
    const updateBand = (cx: number, cy: number) => {
      const r = ov.getBoundingClientRect();
      band.style.display = "block";
      band.style.left = `${Math.min(start!.x, cx) - r.left}px`;
      band.style.top = `${Math.min(start!.y, cy) - r.top}px`;
      band.style.width = `${Math.abs(cx - start!.x)}px`;
      band.style.height = `${Math.abs(cy - start!.y)}px`;
    };
    ov.addEventListener("pointerdown", (e) => {
      start = { x: e.clientX, y: e.clientY };
      ov.setPointerCapture(e.pointerId);
      updateBand(e.clientX, e.clientY);
    });
    ov.addEventListener("pointermove", (e) => {
      if (start && e.buttons & 1) updateBand(e.clientX, e.clientY);
    });
    ov.addEventListener("pointerup", (e) => {
      if (start && (Math.abs(e.clientX - start.x) > 4 || Math.abs(e.clientY - start.y) > 4)) {
        this.setCueClip(cue, start.x, start.y, e.clientX, e.clientY, inverse);
      }
      start = null;
    });
    ov.append(band, bar, hint);
    this.rightEl.appendChild(ov);
    this.clipOverlay = ov;
    document.addEventListener("keydown", this.onClipKey, true);
    this.renderDetail();
  }

  private onClipKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && this.clipOverlay) {
      e.preventDefault();
      this.exitClip();
    }
  };

  private exitClip(): void {
    document.removeEventListener("keydown", this.onClipKey, true);
    this.clipOverlay?.remove();
    this.clipOverlay = null;
    this.renderDetail();
  }

  private setCueClip(cue: Cue, x1: number, y1: number, x2: number, y2: number, inverse: boolean): void {
    const a = this.clientToPlayRes(Math.min(x1, x2), Math.min(y1, y2));
    const b = this.clientToPlayRes(Math.max(x1, x2), Math.max(y1, y2));
    if (!a || !b) return;
    const tag = inverse ? "iclip" : "clip";
    const stripped = cue.text.replace(/\\i?clip\([^)]*\)/g, "").replace(/\{\}/g, "");
    cue.text = `{\\${tag}(${a.px},${a.py},${b.px},${b.py})}` + stripped;
    if (this.detailTextarea) this.detailTextarea.value = cue.text;
    this.refreshRow(cue.id);
    this.markDirty();
  }

  // --- vector drawing (\p): click points on the preview to build a shape ---

  private toggleDraw(cue: Cue): void {
    if (this.drawOverlay) {
      this.exitDraw();
      return;
    }
    if (this.posOverlay) this.exitPosition();
    if (this.clipOverlay) this.exitClip();
    if (!this.video) {
      this.toast(t("posNeedsVideo"));
      return;
    }
    const ov = el("div", "se-posoverlay se-drawoverlay") as HTMLDivElement;
    const cr = this.videoContentRect();
    const rr = this.rightEl.getBoundingClientRect();
    ov.style.left = `${cr.left - rr.left}px`;
    ov.style.top = `${cr.top - rr.top}px`;
    ov.style.width = `${cr.width}px`;
    ov.style.height = `${cr.height}px`;
    const canvas = document.createElement("canvas");
    canvas.className = "se-drawcanvas";
    canvas.width = Math.round(cr.width);
    canvas.height = Math.round(cr.height);
    const ctx = canvas.getContext("2d")!;
    const res = getPlayRes(this.doc);
    const toLocal = (px: number, py: number) => ({ x: (px / res.x) * canvas.width, y: (py / res.y) * canvas.height });
    const toPlay = (x: number, y: number) => ({ px: Math.round((x / canvas.width) * res.x), py: Math.round((y / canvas.height) * res.y) });

    const nodes: DrawNode[] = this.parseDrawing(cue); // existing shape, if any
    let selected = nodes.length ? nodes.length - 1 : -1;
    let drag: { index: number; part: "anchor" | "c1" | "c2" } | null = null;
    const HIT = 8;

    const redraw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!nodes.length) return;
      const L = (n: { px: number; py: number }) => toLocal(n.px, n.py);
      ctx.beginPath();
      const p0 = L(nodes[0]);
      ctx.moveTo(p0.x, p0.y);
      for (const n of nodes.slice(1)) {
        const p = L(n);
        if (n.type === "b" && n.c1 && n.c2) {
          const c1 = L(n.c1);
          const c2 = L(n.c2);
          ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p.x, p.y);
        } else ctx.lineTo(p.x, p.y);
      }
      if (nodes.length > 2) ctx.closePath();
      ctx.fillStyle = "rgba(96,165,250,0.35)";
      ctx.strokeStyle = "#60a5fa";
      ctx.lineWidth = 1.5;
      if (nodes.length > 2) ctx.fill();
      ctx.stroke();
      // Control handles for bezier nodes.
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1;
      nodes.forEach((n) => {
        if (n.type === "b" && n.c1 && n.c2) {
          const p = L(n);
          for (const c of [L(n.c1), L(n.c2)]) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(c.x, c.y);
            ctx.stroke();
            ctx.fillStyle = "#fde68a";
            ctx.fillRect(c.x - 3, c.y - 3, 6, 6);
          }
        }
      });
      // Anchor points.
      nodes.forEach((n, i) => {
        const p = L(n);
        ctx.beginPath();
        ctx.arc(p.x, p.y, i === selected ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = i === selected ? "#60a5fa" : "#fff";
        ctx.fill();
      });
    };

    const hitTest = (x: number, y: number): { index: number; part: "anchor" | "c1" | "c2" } | null => {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.type === "b") {
          for (const part of ["c1", "c2"] as const) {
            const c = n[part];
            if (c) {
              const l = toLocal(c.px, c.py);
              if (Math.hypot(l.x - x, l.y - y) <= HIT) return { index: i, part };
            }
          }
        }
      }
      for (let i = 0; i < nodes.length; i++) {
        const l = toLocal(nodes[i].px, nodes[i].py);
        if (Math.hypot(l.x - x, l.y - y) <= HIT) return { index: i, part: "anchor" };
      }
      return null;
    };

    ov.addEventListener("pointerdown", (e) => {
      const r = ov.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const hit = hitTest(x, y);
      if (hit) {
        drag = hit;
        if (hit.part === "anchor") selected = hit.index;
        ov.setPointerCapture(e.pointerId);
      } else {
        // Add a new vertex (the first one starts the shape).
        const pl = toPlay(x, y);
        nodes.push({ type: nodes.length ? "l" : "m", px: pl.px, py: pl.py });
        selected = nodes.length - 1;
      }
      redraw();
    });
    ov.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const r = ov.getBoundingClientRect();
      const pl = toPlay(e.clientX - r.left, e.clientY - r.top);
      const n = nodes[drag.index];
      if (drag.part === "anchor") {
        const dx = pl.px - n.px;
        const dy = pl.py - n.py;
        n.px = pl.px;
        n.py = pl.py;
        if (n.c1) (n.c1.px += dx), (n.c1.py += dy); // move the handles with the anchor
        if (n.c2) (n.c2.px += dx), (n.c2.py += dy);
      } else if (n[drag.part]) {
        n[drag.part]!.px = pl.px;
        n[drag.part]!.py = pl.py;
      }
      redraw();
    });
    const endDrag = (e: PointerEvent) => {
      if (drag) {
        drag = null;
        ov.releasePointerCapture(e.pointerId);
      }
    };
    ov.addEventListener("pointerup", endDrag);

    const bar = el("div", "se-posbar");
    const mkBtn = (label: string, primary: boolean, fn: () => void) => {
      const b = document.createElement("button");
      b.className = "se-obtn" + (primary ? " se-obtn-primary" : "");
      b.textContent = label;
      b.addEventListener("pointerdown", (e) => e.stopPropagation());
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        fn();
      });
      return b;
    };
    // Toggle the selected vertex between a straight line and a bezier curve (spline
    // control points are left as-is).
    const toggleCurve = () => {
      if (selected <= 0 || !nodes[selected] || nodes[selected].type === "s") return;
      const n = nodes[selected];
      const prev = nodes[selected - 1];
      if (n.type === "b") {
        n.type = "l";
        delete n.c1;
        delete n.c2;
      } else {
        n.type = "b";
        n.c1 = { px: Math.round(prev.px + (n.px - prev.px) / 3), py: Math.round(prev.py + (n.py - prev.py) / 3) };
        n.c2 = { px: Math.round(prev.px + (2 * (n.px - prev.px)) / 3), py: Math.round(prev.py + (2 * (n.py - prev.py)) / 3) };
      }
      redraw();
    };
    bar.append(
      mkBtn(t("drawUndo"), false, () => {
        nodes.pop();
        selected = Math.min(selected, nodes.length - 1);
        redraw();
      }),
      mkBtn(t("drawCurve"), false, toggleCurve),
      mkBtn(t("drawClear"), false, () => {
        nodes.length = 0;
        selected = -1;
        redraw();
      }),
      mkBtn(t("apply"), true, () => this.applyDrawing(cue, nodes)),
      mkBtn(t("done"), false, () => this.exitDraw()),
    );
    ov.append(canvas, bar, el("div", "se-poshint", t("drawHint")));
    this.rightEl.appendChild(ov);
    this.drawOverlay = ov;
    redraw();
    document.addEventListener("keydown", this.onDrawKey, true);
    this.renderDetail();
  }

  // Parse the cue's existing \p drawing into editable vertices (PlayRes coords, with any
  // \pos/\move offset folded in). Supports m / l / b / s (and p, treated as extending s);
  // the c (close) command and anything else is skipped.
  private parseDrawing(cue: Cue): DrawNode[] {
    const body = cue.text.match(/\\p[1-9][^}]*\}([^{]*)/)?.[1];
    if (!body) return [];
    const pos = cue.text.match(/\\(?:pos|move)\((-?[\d.]+),(-?[\d.]+)/);
    const ox = pos ? parseFloat(pos[1]) : 0;
    const oy = pos ? parseFloat(pos[2]) : 0;
    const toks = body.trim().split(/\s+/).filter(Boolean);
    const nodes: DrawNode[] = [];
    let i = 0;
    let cmd = "";
    const num = () => parseFloat(toks[i++]);
    while (i < toks.length) {
      if (/^[a-zA-Z]+$/.test(toks[i])) {
        cmd = toks[i].toLowerCase();
        i++;
        continue;
      }
      if (cmd === "m" || cmd === "l") {
        const px = num() + ox;
        const py = num() + oy;
        if (Number.isNaN(px) || Number.isNaN(py)) break;
        nodes.push({ type: cmd === "m" ? "m" : "l", px, py });
        if (cmd === "m") cmd = "l";
      } else if (cmd === "b") {
        const c1 = { px: num() + ox, py: num() + oy };
        const c2 = { px: num() + ox, py: num() + oy };
        const px = num() + ox;
        const py = num() + oy;
        if (Number.isNaN(px) || Number.isNaN(py) || Number.isNaN(c1.px) || Number.isNaN(c2.px)) break;
        nodes.push({ type: "b", px, py, c1, c2 });
      } else if (cmd === "s" || cmd === "p") {
        const px = num() + ox;
        const py = num() + oy;
        if (Number.isNaN(px) || Number.isNaN(py)) break;
        nodes.push({ type: "s", px, py });
      } else i++;
    }
    return nodes.length >= 2 ? nodes : [];
  }

  private applyDrawing(cue: Cue, nodes: DrawNode[]): void {
    if (nodes.length < 2) return;
    // Absolute drawing: \an7\pos(0,0) puts the drawing origin at the screen origin, so the
    // PlayRes coords map directly onto the picture. Existing style tags are preserved.
    // A run of consecutive spline points shares one leading "s".
    const parts: string[] = [];
    let prev = "";
    nodes.forEach((n, i) => {
      if (i === 0) parts.push(`m ${n.px} ${n.py}`), (prev = "m");
      else if (n.type === "b" && n.c1 && n.c2) parts.push(`b ${n.c1.px} ${n.c1.py} ${n.c2.px} ${n.c2.py} ${n.px} ${n.py}`), (prev = "b");
      else if (n.type === "s") parts.push(prev === "s" ? `${n.px} ${n.py}` : `s ${n.px} ${n.py}`), (prev = "s");
      else parts.push(`l ${n.px} ${n.py}`), (prev = "l");
    });
    const cmds = parts.join(" ");
    const style = cue.text.replace(/\\p[1-9][^}]*\}[^{]*(?:\{\\p0\})?/g, "").match(/\\(1c|3c|4c|1a|3a|4a|bord|shad)[^\\}]*/g)?.join("") ?? "";
    cue.text = `{\\an7\\pos(0,0)${style}\\p1}${cmds}{\\p0}`;
    if (this.detailTextarea) this.detailTextarea.value = cue.text;
    this.refreshRow(cue.id);
    this.markDirty();
    this.exitDraw();
  }

  private onDrawKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && this.drawOverlay) {
      e.preventDefault();
      this.exitDraw();
    }
  };

  private exitDraw(): void {
    document.removeEventListener("keydown", this.onDrawKey, true);
    this.drawOverlay?.remove();
    this.drawOverlay = null;
    this.renderDetail();
  }

  // --- fade ----------------------------------------------------------------

  // Fade popover. Simple in/out writes \fad(in,out); ticking "Advanced" exposes the
  // 7-argument \fade(a1,a2,a3,t1,t2,t3,t4) form and writes that instead.
  private openFade(cue: Cue, ta: HTMLTextAreaElement): void {
    this.detailEl.querySelector(".se-fadepop")?.remove();
    const simple = cue.text.match(/\\fad\((\d+),(\d+)\)/);
    const adv = cue.text.match(/\\fade\(([^)]*)\)/);
    const av = adv ? adv[1].split(",").map((s) => s.trim()) : [];
    const dur = Math.max(0, cue.endMs - cue.startMs);
    const pop = el("div", "se-fadepop se-xform");
    const field = (parent: HTMLElement, label: string, val: string): HTMLInputElement => {
      const wrap = el("label", "se-field", label);
      const input = document.createElement("input");
      input.type = "number";
      input.value = val;
      wrap.appendChild(input);
      parent.appendChild(wrap);
      return input;
    };
    const group = (title: string, tip = ""): HTMLElement => {
      const g = el("div", "se-xgroup");
      g.appendChild(el("span", "se-xglabel", title));
      if (tip) g.title = tip;
      pop.appendChild(g);
      return g;
    };

    const simpleGrp = group(t("fade"), t("tipFadeSimple"));
    const fin = field(simpleGrp, t("fadeIn"), simple?.[1] ?? "200");
    const fout = field(simpleGrp, t("fadeOut"), simple?.[2] ?? "200");

    const advToggle = el("label", "se-field se-checkfield", t("fadeAdvanced"));
    const advCb = document.createElement("input");
    advCb.type = "checkbox";
    advCb.checked = !!adv;
    advToggle.appendChild(advCb);
    pop.appendChild(advToggle);

    const advGrp = group(t("fadeAdvanced"));
    const a1 = field(advGrp, "α1", av[0] ?? "255");
    const a2 = field(advGrp, "α2", av[1] ?? "0");
    const a3 = field(advGrp, "α3", av[2] ?? "255");
    for (const a of [a1, a2, a3]) a.title = t("tipFadeAlpha");
    const t1 = field(advGrp, "t1", av[3] ?? "0");
    const t2 = field(advGrp, "t2", av[4] ?? String(Math.min(300, dur)));
    const t3 = field(advGrp, "t3", av[5] ?? String(Math.max(0, dur - 300)));
    const t4 = field(advGrp, "t4", av[6] ?? String(dur));
    for (const tf of [t1, t2, t3, t4]) tf.title = t("tipFadeTimes");

    const sync = (): void => {
      advGrp.style.display = advCb.checked ? "" : "none";
      simpleGrp.style.display = advCb.checked ? "none" : "";
    };
    advCb.addEventListener("change", sync);
    sync();

    const apply = document.createElement("button");
    apply.className = "se-btn";
    apply.textContent = t("apply");
    apply.addEventListener("click", () => {
      const stripped = cue.text.replace(/\\fade\([^)]*\)/g, "").replace(/\\fad\([^)]*\)/g, "").replace(/\{\}/g, "");
      let tag: string;
      if (advCb.checked) {
        const v = [a1, a2, a3, t1, t2, t3, t4].map((i) => parseInt(i.value, 10) || 0);
        tag = `{\\fade(${v.join(",")})}`;
      } else {
        tag = `{\\fad(${parseInt(fin.value, 10) || 0},${parseInt(fout.value, 10) || 0})}`;
      }
      ta.value = tag + stripped;
      this.updateCue(cue.id, { text: ta.value }, true);
      pop.remove();
    });
    pop.appendChild(apply);
    this.detailEl.appendChild(pop);
    fin.focus();
  }

  // Transform popover, grouped: Rotate (\frx/\fry/\frz) + origin (\org), Scale
  // (\fscx/\fscy), Shear (\fax/\fay), plus spacing/blur/edge-blur. Animate wraps the
  // animatable tags in \t (\org is not animatable, so it stays outside).
  private openTransform(cue: Cue, ta: HTMLTextAreaElement, focus: "rotate-z" | "rotate-xy" | "scale" = "rotate-z"): void {
    this.detailEl.querySelector(".se-fadepop")?.remove();
    const get = (re: RegExp, def: string): string => cue.text.match(re)?.[1] ?? def;
    const pop = el("div", "se-fadepop se-xform");
    const field = (parent: HTMLElement, label: string, val: string): HTMLInputElement => {
      const wrap = el("label", "se-field", label);
      const input = document.createElement("input");
      input.type = "number";
      input.value = val;
      wrap.appendChild(input);
      parent.appendChild(wrap);
      return input;
    };
    const group = (title: string, tip = ""): HTMLElement => {
      const g = el("div", "se-xgroup");
      g.appendChild(el("span", "se-xglabel", title));
      if (tip) g.title = tip;
      pop.appendChild(g);
      return g;
    };

    const rot = group(t("rotate"), t("tipRotate"));
    const frx = field(rot, "X", get(/\\frx(-?[\d.]+)/, "0"));
    const fry = field(rot, "Y", get(/\\fry(-?[\d.]+)/, "0"));
    const frz = field(rot, "Z", get(/\\frz(-?[\d.]+)/, "0"));
    const org = cue.text.match(/\\org\((-?[\d.]+),(-?[\d.]+)\)/);
    const originGrp = group(t("origin"), t("tipOrigin"));
    const orgX = field(originGrp, "X", org?.[1] ?? "");
    const orgY = field(originGrp, "Y", org?.[2] ?? "");
    const scale = group(t("scale"), t("tipScale"));
    const fscx = field(scale, "X", get(/\\fscx([\d.]+)/, "100"));
    const fscy = field(scale, "Y", get(/\\fscy([\d.]+)/, "100"));
    const shear = group(t("shear"), t("tipShear"));
    const fax = field(shear, "X", get(/\\fax(-?[\d.]+)/, "0"));
    const fay = field(shear, "Y", get(/\\fay(-?[\d.]+)/, "0"));
    const misc = group("");
    const fsp = field(misc, t("styleSpacing"), get(/\\fsp(-?[\d.]+)/, "0"));
    fsp.title = t("tipSpacing");
    const blur = field(misc, t("blur"), get(/\\blur([\d.]+)/, "0"));
    blur.title = t("tipBlur");
    const be = field(misc, t("edgeBlur"), get(/\\be([\d.]+)/, "0"));
    be.title = t("tipEdgeBlur");
    // Per-axis border/shadow. Blank = inherit \bord/\shad; a number (incl. 0) overrides.
    const axes = group(t("borderShadowAxes"), t("tipAxes"));
    const xbord = field(axes, `${t("borderWidth")} X`, cue.text.match(/\\xbord([\d.]+)/)?.[1] ?? "");
    const ybord = field(axes, `${t("borderWidth")} Y`, cue.text.match(/\\ybord([\d.]+)/)?.[1] ?? "");
    const xshad = field(axes, `${t("shadowWidth")} X`, cue.text.match(/\\xshad(-?[\d.]+)/)?.[1] ?? "");
    const yshad = field(axes, `${t("shadowWidth")} Y`, cue.text.match(/\\yshad(-?[\d.]+)/)?.[1] ?? "");

    // Animate: wrap the transform in \t so it eases from the style default to these values.
    const animWrap = el("label", "se-field se-checkfield", t("animate"));
    animWrap.title = t("tipAnimate");
    const anim = document.createElement("input");
    anim.type = "checkbox";
    anim.checked = /\\t\(/.test(cue.text);
    animWrap.appendChild(anim);
    pop.appendChild(animWrap);

    const apply = document.createElement("button");
    apply.className = "se-btn";
    apply.textContent = t("apply");
    apply.addEventListener("click", () => {
      const stripped = cue.text
        .replace(/\\t\([^)]*\)/g, "")
        .replace(/\\org\([^)]*\)/g, "")
        .replace(/\\(frx|fry|frz|fscx|fscy|fsp|be|blur|fax|fay|xbord|ybord|xshad|yshad)-?[\d.]+/g, "")
        .replace(/\{\}/g, "");
      const tags: string[] = [];
      const add = (tag: string, v: string, def: number) => {
        if (v !== "" && parseFloat(v) !== def) tags.push(`\\${tag}${v}`);
      };
      const addRaw = (tag: string, v: string) => {
        if (v !== "") tags.push(`\\${tag}${v}`); // no inherit-default, any value overrides
      };
      add("frx", frx.value, 0);
      add("fry", fry.value, 0);
      add("frz", frz.value, 0);
      add("fscx", fscx.value, 100);
      add("fscy", fscy.value, 100);
      add("fax", fax.value, 0);
      add("fay", fay.value, 0);
      add("fsp", fsp.value, 0);
      add("blur", blur.value, 0);
      add("be", be.value, 0);
      addRaw("xbord", xbord.value);
      addRaw("ybord", ybord.value);
      addRaw("xshad", xshad.value);
      addRaw("yshad", yshad.value);
      const anims = tags.length ? (anim.checked ? `\\t(${tags.join("")})` : tags.join("")) : "";
      const origin = orgX.value !== "" && orgY.value !== "" ? `\\org(${orgX.value},${orgY.value})` : "";
      const body = origin + anims;
      ta.value = (body ? `{${body}}` : "") + stripped;
      this.updateCue(cue.id, { text: ta.value }, true);
      pop.remove();
    });
    pop.appendChild(apply);
    this.detailEl.appendChild(pop);
    const focusTarget = focus === "rotate-xy" ? frx : focus === "scale" ? fscx : frz;
    focusTarget.focus();
    requestAnimationFrame(() => { if (pop.isConnected) focusTarget.focus(); });
  }

  private openVisualTransform(mode: VisualTransformMode): void {
    if (!this.video || !this.videoHost || !this.selectedCue()) return;
    if (this.doc.format !== "ass") { this.toast("视觉排版需要 ASS 字幕。"); return; }
    if (this.posOverlay) this.exitPosition();
    if (this.clipOverlay) this.exitClip();
    if (this.drawOverlay) this.exitDraw();
    this.vectorClip?.close(); this.vectorClip = null;
    this.visualTransform?.close();
    this.detailEl.querySelector(".se-fadepop")?.remove();
    this.visualTransform = new VisualTransformOverlay({
      container: this.videoHost,
      mode,
      getDoc: () => this.doc,
      getSelected: () => {
        const active = this.selectedCue();
        return active ? [active, ...this.doc.cues.filter(cue => cue.id !== active.id && this.selectedIds.has(cue.id))] : [];
      },
      getPictureRect: () => this.videoContentRect(),
      stop: () => { this.video?.pause(); this.audio.stop(); },
      preview: (updates) => {
        window.clearTimeout(this.subtitleTimer);
        const preview = { ...this.doc, cues: this.doc.cues.map(cue => updates.has(cue.id) ? { ...cue, text: updates.get(cue.id)! } : cue) };
        this.player?.setSubtitleText(serializeSubtitles(preview), "preview.ass");
      },
      commit: (updates) => {
        if (!this.doc.cues.some(cue => updates.has(cue.id) && updates.get(cue.id) !== cue.text)) return;
        window.clearTimeout(this.histTimer); this.histTimer = 0;
        this.history.commit(this.snapshot());
        for (const cue of this.doc.cues) if (updates.has(cue.id)) { cue.text = updates.get(cue.id)!; this.refreshRow(cue.id); }
        this.markDirty();
        window.clearTimeout(this.histTimer); this.histTimer = 0;
        this.history.commit(this.snapshot());
        this.renderDetail();
        this.pushSubtitles(true);
      },
      restore: () => this.pushSubtitles(true),
    });
  }

  private timeField(label: string, value: string, onCommit: (v: string) => void): HTMLElement {
    const wrap = el("label", "se-field", label);
    const input = document.createElement("input");
    input.value = value;
    let edited = false;
    input.addEventListener("input", () => { edited = true; });
    const commit = () => { if (edited) { edited = false; onCommit(input.value.trim()); } };
    input.addEventListener("change", commit);
    input.addEventListener("blur", commit);
    wrap.appendChild(input);
    return wrap;
  }

  // ASS style picker for the selected cue: the file's style names, plus the cue's own
  // style if the file didn't declare it. Writing sets the cue's Style Event field; the
  // adjacent pencil opens the editor for the selected style.
  private styleField(cue: Cue): HTMLElement {
    const wrap = el("label", "se-field se-stylefield", t("style"));
    const row = el("div", "se-stylerow");
    const select = document.createElement("select");
    const current = cue.assFields?.Style ?? "Default";
    const declared = styleNames(this.doc);
    const names = declared.length ? [...declared] : ["Default"];
    if (!names.includes(current)) names.unshift(current);
    for (const name of names) {
      const o = document.createElement("option");
      o.value = name;
      o.textContent = name;
      select.appendChild(o);
    }
    select.value = current;
    select.addEventListener("change", () => {
      (cue.assFields ??= {}).Style = select.value;
      this.refreshRow(cue.id);
      this.markDirty();
    });
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "se-btn se-iconbtn se-styleedit";
    edit.innerHTML = ICON.styles;
    edit.title = t("editStyle");
    edit.setAttribute("aria-label", t("editStyle"));
    edit.addEventListener("click", () => this.editStyle(select.value));
    // Two independent collapse toggles: the inline styling tools (Text/Drawing tabs +
    // override-tag bar) and the per-line option fields. Collapsing either frees room on phones.
    const styleToggle = this.detailToggle(ICON.tune, t("inlineStyle"), this.assStyleToolsOpen, () => {
      this.assStyleToolsOpen = !this.assStyleToolsOpen;
      this.renderDetail();
    });
    const extrasToggle = this.detailToggle(ICON.meta, t("lineOptions"), this.assExtrasOpen, () => {
      this.assExtrasOpen = !this.assExtrasOpen;
      this.renderDetail();
    });
    row.append(select, edit, styleToggle, extrasToggle);
    wrap.appendChild(row);
    return wrap;
  }

  // A small icon toggle button for a collapsible detail section (reflects on/off state).
  private detailToggle(icon: string, title: string, on: boolean, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "se-btn se-iconbtn se-styletoggle" + (on ? " on" : "");
    b.innerHTML = icon;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.setAttribute("aria-pressed", String(on));
    b.addEventListener("click", onClick);
    return b;
  }

  // The remaining ASS Event fields for the selected cue, grouped into a fields row
  // (disable / actor / layer / effect) and a margins row.
  private assExtrasRow(cue: Cue): HTMLElement {
    const box = el("div", "se-assbox");
    const row = el("div", "se-times se-assextras");

    const cwrap = el("label", "se-field se-checkfield", t("disabled"));
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = cue.assKind === "Comment";
    cb.addEventListener("change", () => {
      cue.assKind = cb.checked ? "Comment" : "Dialogue";
      this.refreshRow(cue.id);
      this.timeline?.render();
      this.markDirty();
    });
    cwrap.appendChild(cb);
    row.append(cwrap, this.assField(cue, "Name", t("actor"), "text", "se-actorfield", undefined, t("tipActor")), this.assField(cue, "Layer", t("layer"), "number", "se-numfield", undefined, t("tipLayer")), this.assEffectField(cue));
    box.appendChild(row);

    // Margins group: Left / Right, and Vertical only when the line is top/bottom aligned.
    const margins = el("div", "se-times se-margins");
    margins.appendChild(el("span", "se-grouplabel", t("marginsLabel")));
    margins.append(this.assField(cue, "MarginL", t("marginL"), "number", "se-numfield"), this.assField(cue, "MarginR", t("marginR"), "number", "se-numfield"));
    if (![4, 5, 6].includes(this.effectiveAlign(cue))) margins.appendChild(this.assField(cue, "MarginV", t("marginV"), "number", "se-numfield"));
    box.appendChild(margins);
    return box;
  }

  // The cue's alignment: an inline \an override, else the assigned style's, else 2.
  private effectiveAlign(cue: Cue): number {
    const an = cue.text.match(/\\an([1-9])/);
    if (an) return parseInt(an[1], 10);
    const style = this.doc.styles?.find((s) => s.name === (cue.assFields?.Style ?? "Default"));
    return parseInt(style?.fields.Alignment ?? "2", 10) || 2;
  }

  // Effect: a type dropdown (None / Banner / Scroll up / Scroll down; Karaoke only if the
  // cue already uses it) plus parameter fields for the chosen effect.
  private assEffectField(cue: Cue): HTMLElement {
    const PREFIX: Record<string, string> = { banner: "Banner", scrollup: "Scroll up", scrolldown: "Scroll down", karaoke: "Karaoke" };
    type ParamSpec = { label: string; def: string; options?: [string, string][] };
    const SPECS: Record<string, ParamSpec[]> = {
      banner: [
        { label: t("effDelay"), def: "40" },
        { label: t("direction"), def: "0", options: [["0", t("rightToLeft")], ["1", t("leftToRight")]] },
        { label: t("effFade"), def: "0" },
      ],
      scrollup: [{ label: t("effY1"), def: "0" }, { label: t("effY2"), def: "0" }, { label: t("effDelay"), def: "40" }, { label: t("effFade"), def: "0" }],
      scrolldown: [{ label: t("effY1"), def: "0" }, { label: t("effY2"), def: "0" }, { label: t("effDelay"), def: "40" }, { label: t("effFade"), def: "0" }],
    };
    const cur = cue.assFields?.Effect ?? "";
    const type = /^banner/i.test(cur) ? "banner" : /^scroll up/i.test(cur) ? "scrollup" : /^scroll down/i.test(cur) ? "scrolldown" : /^karaoke/i.test(cur) ? "karaoke" : "none";

    const group = el("div", "se-field se-effectgroup");
    group.append(el("span", "", t("effect")));
    const rowEl = el("div", "se-effectrow");
    const sel = document.createElement("select");
    sel.title = t("tipEffect");
    const opts: [string, string][] = [["none", t("effectNone")], ["banner", t("banner")], ["scrollup", t("scrollUp")], ["scrolldown", t("scrollDown")]];
    if (type === "karaoke") opts.push(["karaoke", t("karaoke")]);
    for (const [v, l] of opts) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = l;
      sel.appendChild(o);
    }
    sel.value = type;
    const params = el("div", "se-effectparams");
    rowEl.append(sel, params);
    group.appendChild(rowEl);

    const setEffect = (val: string) => {
      (cue.assFields ??= {}).Effect = val;
      this.refreshRow(cue.id);
      this.markDirty();
    };
    const build = (t2: string, parts: string[], commit: boolean): void => {
      params.textContent = "";
      if (t2 === "none") {
        if (commit) setEffect("");
        return;
      }
      if (t2 === "karaoke") {
        if (commit) setEffect("Karaoke");
        return;
      }
      const spec = SPECS[t2];
      const inputs = spec.map((s, i) => {
        const wrap = el("label", "se-field " + (s.options ? "se-selfield" : "se-numfield"), s.label);
        let input: HTMLInputElement | HTMLSelectElement;
        if (s.options) {
          const sel2 = document.createElement("select");
          for (const [v, l] of s.options) {
            const o = document.createElement("option");
            o.value = v;
            o.textContent = l;
            sel2.appendChild(o);
          }
          sel2.value = parts[i] ?? s.def;
          input = sel2;
        } else {
          const n = document.createElement("input");
          n.type = "number";
          n.value = parts[i] ?? s.def;
          input = n;
        }
        wrap.appendChild(input);
        params.appendChild(wrap);
        return input;
      });
      const rebuild = () => setEffect(`${PREFIX[t2]};${inputs.map((x) => x.value || "0").join(";")}`);
      inputs.forEach((x) => x.addEventListener("change", rebuild));
      if (commit) rebuild();
    };
    sel.addEventListener("change", () => build(sel.value, [], true));
    build(type, cur.split(";").slice(1), false);
    return group;
  }

  private assField(cue: Cue, key: string, label: string, type: "text" | "number", cls: string, datalist?: string[], tip?: string): HTMLElement {
    const wrap = el("label", `se-field ${cls}`, label);
    if (tip) wrap.title = tip;
    const input = document.createElement("input");
    input.type = type;
    input.value = cue.assFields?.[key] ?? (type === "number" ? "0" : "");
    if (datalist) {
      const id = `se-dl-${key}`;
      input.setAttribute("list", id);
      const dl = document.createElement("datalist");
      dl.id = id;
      for (const v of datalist) {
        const o = document.createElement("option");
        o.value = v;
        dl.appendChild(o);
      }
      wrap.appendChild(dl);
      input.title = t("effectHint");
    }
    const commit = () => {
      (cue.assFields ??= {})[key] = input.value;
      this.refreshRow(cue.id);
      this.markDirty();
    };
    input.addEventListener("change", commit);
    wrap.appendChild(input);
    return wrap;
  }

  private addStyle(): void {
    const style = makeDefaultStyle(uniqueStyleName(this.doc, "New style"));
    this.openStyleEditor(style);
  }

  private editStyle(name: string): void {
    this.doc.styles ??= [];
    let style = this.doc.styles.find((s) => s.name === name);
    if (!style) {
      style = makeDefaultStyle(name);
    }
    this.openStyleEditor(style);
  }

  private openStyleEditor(style: AssStyle): void {
    this.video?.pause(); this.audio.stop();
    openStyleEditor(
      {
        getDoc: () => this.doc,
        onChange: () => {
          this.renderDetail(); // refresh the style dropdown options + selection
          this.markDirty();
        },
        onRenameStyle: (from, to) => {
          for (const c of this.doc.cues) if (c.assFields?.Style === from) c.assFields.Style = to;
        },
      },
      style,
    );
  }

  // --- editing operations --------------------------------------------------

  private updateCue(id: string, patch: Partial<Cue>, fromText = false): void {
    const cue = this.doc.cues.find((c) => c.id === id);
    if (!cue) return;
    if (patch.startMs !== undefined || patch.endMs !== undefined) this.timingDraft.discard(id);
    const normalized = this.doc.format === "ass" && typeof patch.text === "string"
      ? { ...patch, text: patch.text.replace(/\r\n?|\n/g, "\\N") }
      : patch;
    Object.assign(cue, normalized);
    this.refreshRow(id);
    this.timeline?.render();
    // Editing the text area should not re-render the detail (it would drop the caret).
    if (!fromText) this.renderDetail();
    this.markDirty();
  }

  // Auto-transcription: lazily load the transcribe UI (which pulls in transformers.js) and
  // open the dialog, wired to the loaded media and cue insertion.
  // Lazily load the transcribe/translate dialog module. A dynamic import can fail transiently
  // (a dev-server dependency re-optimize race, a network hiccup) and would otherwise leave the
  // toolbar button doing nothing with no feedback; surface it as a toast instead of silence.
  private loadTranscribeUi(): Promise<typeof import("./transcribe/ui")> {
    return import("./transcribe/ui").catch((e) => {
      this.toast(t("dialogLoadFailed"));
      throw e;
    });
  }

  private openTranscribe(): void {
    void this.loadTranscribeUi()
      .then(({ openTranscribeDialog }) => {
        openTranscribeDialog({
          mediaFile: () => {
            const { file, analysisBlob } = this.audio;
            if (!file) return null;
            if (!analysisBlob || analysisBlob === file) return file;
            return new File([analysisBlob], `${file.name}.wav`, { type: "audio/wav" });
          },
          hasCues: () => this.doc.cues.length > 0,
          onResult: (cues, mode) => this.insertTranscribedCues(cues, mode),
        });
      })
      .catch(() => {});
  }

  private activeTrack(): Track {
    return this.tracks.find((t) => t.id === this.activeTrackId) ?? this.tracks[0];
  }

  // Mux all subtitle tracks back into the loaded media (stream-copying video/audio) and save
  // it. When the File System Access API is available the output streams straight to the
  // chosen file (so multi-GB saves never buffer in RAM); otherwise it downloads a blob.
  private async saveIntoVideo(): Promise<void> {
    if (!this.mediaFile) {
      this.toast(t("saveVideoNeedsMedia"));
      return;
    }
    // Save back into the source's container (detected at load). MKV keeps ASS tracks styled
    // (S_TEXT/ASS); MP4 and everything else can only hold plain-text WebVTT.
    const container = this.mediaContainer;

    // Ask for the destination file FIRST, before serializing the tracks: serializing thousands
    // of cues across tracks can take long enough to expire the click's transient user
    // activation, after which showSaveFilePicker throws and no dialog appears.
    const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
    let handle: FileSystemFileHandle | null = null;
    if (picker) {
      try {
        handle = await picker.call(window, { suggestedName: `subtitled.${container}`, types: [{ description: container.toUpperCase(), accept: { [container === "mkv" ? "video/x-matroska" : "video/mp4"]: [`.${container}`] } }] });
      } catch {
        return; // user cancelled the save dialog
      }
    }

    const subs = this.tracks.map((tr) =>
      container === "mkv" && tr.doc.format === "ass"
        ? { name: tr.label, language: tr.language, kind: "ass" as const, content: serializeSubtitles(tr.doc) }
        : { name: tr.label, language: tr.language, kind: "vtt" as const, content: serializeSubtitles(convertDoc(tr.doc, "vtt")) },
    );

    this.countEl.textContent = t("savingVideo");
    let lastTick = 0;
    const onBytes = (written: number): void => {
      const now = Date.now();
      if (now - lastTick < 250) return; // throttle DOM updates
      lastTick = now;
      this.countEl.textContent = `${t("savingVideo")} ${(written / 1e6).toFixed(1)} MB`;
    };
    // Stream from the original File (disk-backed); BlobSource reads it on demand, so a multi-GB
    // save never buffers the source in RAM.
    const media = this.mediaFile;
    try {
      const { muxIntoContainer, muxToFile } = await import("./mux");
      if (handle) {
        const writable = await (handle as unknown as { createWritable(): Promise<import("./mux").FileWritable> }).createWritable();
        await muxToFile(media, subs, container, writable, onBytes);
      } else {
        const out = await muxIntoContainer(media, subs, container);
        const mime = container === "mkv" ? "video/x-matroska" : "video/mp4";
        const url = URL.createObjectURL(new Blob([out as BlobPart], { type: mime }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `subtitled.${container}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      this.countEl.textContent = t("cueCount", { n: this.doc.cues.length });
      this.toast(t("saveVideoDone"));
    } catch (e) {
      this.countEl.textContent = t("cueCount", { n: this.doc.cues.length });
      this.toast(`${t("saveVideoError")}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Translate the active track: lazily open the translate dialog over its cue texts, then
  // add the result as a new track sharing the source timing/styles.
  private openTranslate(): void {
    const source = this.activeTrack();
    // Build a de-duplicated translation plan: split each cue into tag/run parts (only runs are
    // translated, tags and breaks are preserved), skip drawing cues, and translate each unique
    // run string once, fanning the result out to every cue that shares it.
    const plan = buildTranslationPlan(source.doc.cues.map((c) => c.text));
    void this.loadTranscribeUi()
      .then(({ openTranslateDialog }) => {
        openTranslateDialog({
          cueTexts: () => plan.uniqueTexts,
          sourceLanguage: () => source.language,
          onStart: (opts, targetCode, targetLabel) => this.startTranslateJob(source, plan, opts, targetCode, targetLabel),
        });
      })
      .catch(() => {});
  }

  // Create the target track immediately (cloning the source timing/styles, cues still holding
  // the source text) and run the translation as a live background job that fills the cues as
  // batches arrive. The user can keep editing meanwhile.
  private startTranslateJob(
    source: Track,
    plan: TranslationPlan,
    opts: { model: string; srcLang: string; tgtLang: string },
    targetCode: string,
    targetLabel: string,
  ): void {
    const doc = structuredClone(source.doc) as SubtitleDoc;
    doc.cues = doc.cues.map((c, ci) => ({ ...c, id: newCueId(), text: rebuildCueText(plan, ci) ?? c.text }));
    const track: Track = {
      id: newTrackId(),
      label: targetLabel,
      language: targetCode,
      doc,
      job: { run: null, state: "running", stage: "download", ratio: 0, plan, opts, translated: new Array(plan.uniqueTexts.length).fill(false), done: 0, total: plan.uniqueTexts.length },
    };
    this.tracks.push(track);
    this.originalDocs.set(track.id, structuredClone(doc));
    this.switchTrack(track.id);
    this.markDirty();
    // First pass covers every unique text.
    this.runTranslationPass(track, plan.uniqueTexts.map((_t, u) => u));
  }

  // Spawn a worker over the given unique-text indices and stream results back. Used both for the
  // initial pass (all indices) and for a retry (only the not-yet-translated indices), so an
  // interrupted job can be resumed without redoing finished lines.
  private runTranslationPass(track: Track, uniqueIndices: number[]): void {
    const job = track.job;
    if (!job) return;
    if (!uniqueIndices.length) {
      this.finishTranslateJob(track, false);
      return;
    }
    job.state = "running";
    job.errorMsg = undefined;
    job.stage = "download";
    this.renderJobStrip();
    this.renderTrackBar();
    const texts = uniqueIndices.map((u) => job.plan.mtSource[u]);
    job.run = runTranslate(texts, job.opts, {
      onProgress: (p) => {
        job.stage = p.stage === "download" ? "download" : "translate";
        // Translate progress is overall (done/total) so a resume continues the bar instead of
        // restarting it; the worker's own ratio only tracks this pass.
        job.ratio = p.stage === "download" ? p.ratio : job.total ? job.done / job.total : 0;
        this.renderJobStrip();
        this.renderTrackBar();
      },
      onPartial: (start, batch) => this.applyTranslatedBatch(track, uniqueIndices, start, batch),
      onDevice: (device) => {
        job.device = device;
        this.renderJobStrip();
      },
    });
    job.run.done
      .then((res) => this.finishTranslateJob(track, res.stopped))
      .catch((e) => this.pauseTranslateOnError(track, e));
  }

  // Splice a translated batch into the track: map each result back to its unique text via this
  // pass's index list, fan it out to every cue/part that shares it, then rebuild those cues.
  // Re-renders the list/preview only when this track is showing.
  private applyTranslatedBatch(track: Track, uniqueIndices: number[], start: number, batch: string[]): void {
    const job = track.job;
    if (!job) return;
    const touched = new Set<number>();
    batch.forEach((tx, k) => {
      const u = uniqueIndices[start + k];
      if (u === undefined || job.translated[u]) return;
      job.translated[u] = true;
      job.done += 1;
      if (tx == null) return;
      for (const ci of applyUniqueTranslation(job.plan, u, tx)) touched.add(ci);
    });
    touched.forEach((ci) => {
      const text = rebuildCueText(job.plan, ci);
      if (text != null) track.doc.cues[ci].text = text;
    });
    this.markDirty();
    if (track.id === this.activeTrackId) {
      this.renderWindow();
      this.schedulePreviewPush();
    }
    this.renderJobStrip();
    this.renderTrackBar();
  }

  // An error (e.g. a WebGPU device loss the worker couldn't recover from) leaves the job in
  // place, paused in an "error" state, so the already-translated lines are kept and the user can
  // retry to finish the rest instead of being stuck with a half-translated track.
  private pauseTranslateOnError(track: Track, e: unknown): void {
    const job = track.job;
    if (!job) return;
    job.run = null;
    if (job.done >= job.total) {
      this.finishTranslateJob(track, false); // everything landed despite the error
      return;
    }
    job.state = "error";
    job.stage = "translate";
    job.ratio = job.total ? job.done / job.total : 0;
    job.errorMsg = e instanceof Error ? e.message : String(e);
    this.toast(`${t("translateError")}: ${job.errorMsg}`);
    this.renderJobStrip();
    this.renderTrackBar();
  }

  private retryTranslateJob(track: Track): void {
    const job = track.job;
    if (!job) return;
    const remaining: number[] = [];
    for (let u = 0; u < job.total; u += 1) if (!job.translated[u]) remaining.push(u);
    this.runTranslationPass(track, remaining);
  }

  // Coalesce the (relatively costly) live subtitle re-push to the preview during a job.
  private schedulePreviewPush(): void {
    if (this.previewPushTimer != null) return;
    this.previewPushTimer = window.setTimeout(() => {
      this.previewPushTimer = null;
      this.pushSubtitles();
    }, 400);
  }

  private finishTranslateJob(track: Track, stopped: boolean): void {
    const job = track.job;
    if (job) {
      // Final pass in case a batch straddled the last render.
      job.plan.parsed.forEach((_parts, ci) => {
        const text = rebuildCueText(job.plan, ci);
        if (text != null) track.doc.cues[ci].text = text;
      });
    }
    track.job = undefined;
    this.renderTrackBar();
    this.renderJobStrip();
    if (track.id === this.activeTrackId) {
      this.renderWindow();
      this.pushSubtitles();
    }
    this.toast(stopped ? t("translateStopped") : t("translateDone"));
    this.markDirty();
  }

  private toggleTranslatePause(track: Track): void {
    const job = track.job;
    if (!job || !job.run) return; // no live worker (errored) -> use retry instead
    if (job.state === "paused") {
      job.state = "running";
      job.run.resume();
    } else {
      job.state = "paused";
      job.run.pause();
    }
    this.renderJobStrip();
  }

  private stopTranslateJob(track: Track): void {
    if (!track.job) return;
    track.job.run?.cancel(); // batches already applied stay; the rest keep the source text
    this.finishTranslateJob(track, true);
  }

  // The strip under the track bar: progress + pause/resume/stop for the active track's job.
  private renderJobStrip(): void {
    if (!this.jobStrip) return;
    this.jobStrip.textContent = "";
    const track = this.activeTrack();
    const job = track?.job;
    if (!job) {
      this.jobStrip.classList.remove("on");
      return;
    }
    this.jobStrip.classList.add("on");
    this.jobStrip.classList.toggle("err", job.state === "error");
    const pct = Math.round(job.ratio * 100);
    const dev = job.device ? ` · ${job.device === "webgpu" ? t("asrUsingGpu") : t("asrUsingCpu")}` : "";
    let text: string;
    if (job.state === "error") text = `⚠ ${t("translateInterrupted")} ${job.done}/${job.total}`;
    else if (job.stage === "download") text = `${t("asrDownloading")} ${pct}%`;
    else text = `${t("translating")} ${job.done}/${job.total} (${pct}%)${dev}`;
    const lab = el("span", "se-job-label", text);
    const bar = el("div", "se-job-bar");
    const fill = el("div", "se-job-fill");
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);
    this.jobStrip.append(lab, bar);
    if (job.state === "error") {
      const retryBtn = el("button", "se-job-btn", "↻");
      retryBtn.title = t("jobRetry");
      retryBtn.addEventListener("click", () => this.retryTranslateJob(track));
      this.jobStrip.appendChild(retryBtn);
    } else {
      const pauseBtn = el("button", "se-job-btn", job.state === "paused" ? "▶" : "⏸");
      pauseBtn.title = job.state === "paused" ? t("jobResume") : t("jobPause");
      pauseBtn.addEventListener("click", () => this.toggleTranslatePause(track));
      this.jobStrip.appendChild(pauseBtn);
    }
    const stopBtn = el("button", "se-job-btn", "⏹");
    stopBtn.title = t("jobStop");
    stopBtn.addEventListener("click", () => this.stopTranslateJob(track));
    this.jobStrip.appendChild(stopBtn);
  }

  private insertTranscribedCues(segs: { startMs: number; endMs: number; text: string }[], mode: "append" | "replace"): void {
    if (!segs.length) return;
    const style = this.doc.format === "ass" ? (styleNames(this.doc)[0] ?? "Default") : undefined;
    const made = segs.map((s) => {
      const cue = blankCue(s.startMs, s.endMs, s.text);
      if (style) (cue.assFields ??= {}).Style = style;
      return cue;
    });
    this.doc.cues = mode === "replace" ? made : sortCues([...this.doc.cues, ...made]);
    this.rows.clear();
    this.innerEl.textContent = "";
    this.scrollEl.scrollTop = 0;
    this.selectedId = null;
    this.renderList();
    this.select(this.doc.cues[0].id);
    this.markDirty();
  }

  private addCue(): void {
    const sel = this.selectedCue();
    const startMs = sel ? sel.endMs : (this.video?.currentTime ?? 0) * 1000;
    const cue = blankCue(Math.round(startMs));
    const insertAt = sel ? this.doc.cues.indexOf(sel) + 1 : this.doc.cues.length;
    this.doc.cues.splice(insertAt, 0, cue);
    this.renderList();
    this.select(cue.id);
    this.markDirty();
  }

  private removeCue(): void {
    if (!this.selectedIds.size) return;
    const firstIdx = this.doc.cues.findIndex((c) => this.selectedIds.has(c.id));
    this.doc.cues = this.doc.cues.filter((c) => !this.selectedIds.has(c.id));
    this.selectedId = null;
    this.selectedIds.clear();
    this.rows.clear();
    this.innerEl.textContent = "";
    this.renderList();
    const next = this.doc.cues[Math.min(Math.max(0, firstIdx), this.doc.cues.length - 1)];
    if (next) this.select(next.id);
    else this.renderDetail();
    this.markDirty();
  }

  // Duplicate the selected cue(s): each copy is placed right after its original with the same
  // timing, fields and text, matching Aegisub's Duplicate Lines command.
  private duplicateCue(): void {
    if (!this.selectedIds.size) return;
    const { cues, newIds } = duplicateCues(this.doc.cues, this.selectedIds);
    this.doc.cues = cues;
    this.rows.clear();
    this.innerEl.textContent = "";
    this.renderList();
    if (newIds.length) this.setSelection(newIds, newIds[newIds.length - 1]);
    this.markDirty();
  }

  // Copy the selected cue(s) into the internal clipboard (deep copies), in document order.
  private copyCues(): void {
    const picked = this.doc.cues.filter((c) => this.selectedIds.has(c.id));
    if (!picked.length) return;
    this.cueClipboard = picked.map((c) => structuredClone(c));
    this.toast(t("copiedN", { n: String(picked.length) }));
  }

  // Paste the clipboard cues after the primary selection, rebasing their times to follow it.
  private pasteCuesFromClipboard(): void {
    if (!this.cueClipboard.length) return;
    const at = this.selectedId ? this.doc.cues.findIndex((c) => c.id === this.selectedId) : this.doc.cues.length - 1;
    const { cues, newIds } = pasteCues(this.doc.cues, this.cueClipboard, at);
    this.doc.cues = cues;
    this.rows.clear();
    this.innerEl.textContent = "";
    this.renderList();
    if (newIds.length) this.setSelection(newIds, newIds[0]);
    this.markDirty();
  }

  // Merge the selected cue with the one after it: join their text with a space and span the
  // combined time, then drop the second cue. Styles/fields of the first cue are kept.
  private mergeCue(): void {
    const cue = this.selectedCue();
    if (!cue) return;
    const merged = mergeCuesAt(this.doc.cues, this.doc.cues.indexOf(cue));
    if (!merged) {
      this.toast(t("mergeNoNext"));
      return;
    }
    this.doc.cues = merged;
    this.rows.clear();
    this.innerEl.textContent = "";
    this.renderList();
    this.select(cue.id);
    this.markDirty();
  }

  // Split the selected cue at the caret (or the midpoint), dividing the duration in proportion
  // to each part's text length. ASS style/fields carry to the new second cue.
  private splitCue(): void {
    const cue = this.selectedCue();
    if (!cue) return;
    const ta = this.detailTextarea;
    const caret = ta && document.activeElement === ta ? ta.selectionStart : -1;
    const res = splitCueAt(this.doc.cues, this.doc.cues.indexOf(cue), caret, this.doc.format);
    if (!res) {
      this.toast(t("splitTooShort"));
      return;
    }
    this.doc.cues = res.cues;
    this.rows.clear();
    this.innerEl.textContent = "";
    this.renderList();
    this.select(res.firstId);
    this.markDirty();
  }

  // --- find / replace ------------------------------------------------------

  private toggleFind(): void {
    if (this.findBar) {
      this.closeFind();
      return;
    }
    const bar = el("div", "se-findbar") as HTMLDivElement;
    const find = document.createElement("input");
    find.type = "text";
    find.placeholder = t("find");
    find.className = "se-findinput";
    find.setAttribute("aria-label", t("find"));
    this.findInput = find;
    const count = el("span", "se-findcount") as HTMLSpanElement;
    this.findCountEl = count;
    const prev = this.button("‹", () => this.findStep(-1));
    const next = this.button("›", () => this.findStep(1));
    prev.className = next.className = "se-obtn";
    prev.title = t("findPrev");
    next.title = t("findNext");
    const repl = document.createElement("input");
    repl.type = "text";
    repl.placeholder = t("replace");
    repl.className = "se-findinput";
    repl.setAttribute("aria-label", t("replace"));
    this.findReplaceInput = repl;
    const replAll = this.button(t("replaceAll"), () => this.replaceAll());
    replAll.className = "se-obtn";
    const close = this.button("✕", () => this.closeFind());
    close.className = "se-obtn";
    close.title = t("close");
    close.setAttribute("aria-label", t("close"));
    find.addEventListener("input", () => this.runFind(find.value));
    find.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.findStep(e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.closeFind();
      }
    });
    repl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.closeFind();
      }
    });
    bar.append(find, count, prev, next, repl, replAll, close);
    this.findBar = bar;
    (this.jobStrip ?? this.trackBar).after(bar);
    find.focus();
    this.runFind("");
  }

  private closeFind(): void {
    this.findBar?.remove();
    this.findBar = null;
    this.findInput = this.findReplaceInput = this.findCountEl = null;
    this.findMatches = [];
    this.findPos = -1;
  }

  private runFind(query: string): void {
    this.findMatches = matchCues(this.doc.cues, query);
    this.findPos = this.findMatches.length ? 0 : -1;
    this.updateFindCount();
    if (this.findPos >= 0) this.select(this.findMatches[0]);
  }

  private findStep(dir: number): void {
    if (!this.findMatches.length) return;
    this.findPos = (this.findPos + dir + this.findMatches.length) % this.findMatches.length;
    this.updateFindCount();
    this.select(this.findMatches[this.findPos]);
  }

  private updateFindCount(): void {
    if (!this.findCountEl) return;
    this.findCountEl.textContent = this.findMatches.length
      ? t("findCount", { i: String(this.findPos + 1), n: String(this.findMatches.length) })
      : this.findInput?.value
        ? t("noMatches")
        : "";
  }

  private replaceAll(): void {
    const q = this.findInput?.value ?? "";
    if (!q) return;
    const repl = this.findReplaceInput?.value ?? "";
    const n = replaceAllInCues(this.doc.cues, q, repl);
    if (n) {
      this.renderList();
      if (this.selectedId) this.refreshRow(this.selectedId);
      this.renderDetail();
      this.markDirty();
    }
    this.toast(t("replacedN", { n: String(n) }));
    this.runFind(q);
  }

  // --- problems panel ------------------------------------------------------

  private toggleProblems(): void {
    if (this.problemsPanel) {
      this.problemsPanel.remove();
      this.problemsPanel = null;
      this.problemsBtn?.classList.remove("on");
      return;
    }
    const panel = el("div", "se-problems") as HTMLDivElement;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", t("problems"));
    const issues = this.computeProblems();
    if (!issues.length) {
      panel.appendChild(el("div", "se-prob-empty", t("noProblems")));
    } else {
      // Header: issue count + a one-click timing fix (caps durations, resolves overlaps).
      const head = el("div", "se-prob-head");
      head.appendChild(el("span", "", t("problemCount", { n: String(issues.length) })));
      const fixBtn = this.button(t("fixTiming"), () => this.fixTiming());
      fixBtn.className = "se-obtn se-obtn-primary";
      fixBtn.title = t("fixTimingHint");
      head.appendChild(fixBtn);
      panel.appendChild(head);
      for (const p of issues) {
        const row = el("div", "se-prob-row");
        row.appendChild(el("span", "se-prob-idx", String(p.index + 1)));
        row.appendChild(el("span", "se-prob-msg", p.msg));
        row.tabIndex = 0;
        const jump = () => {
          this.select(p.id);
          this.scrollCueIntoView(p.id);
        };
        row.addEventListener("click", jump);
        row.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            jump();
          }
        });
        panel.appendChild(row);
      }
    }
    this.problemsPanel = panel;
    this.problemsBtn?.classList.add("on");
    this.root.appendChild(panel);
    // Drop the panel just below the whole toolbar so it never covers the buttons.
    const tb = this.root.querySelector(".se-toolbar");
    if (tb) {
      const b = tb.getBoundingClientRect();
      const r = this.root.getBoundingClientRect();
      panel.style.top = `${Math.round(b.bottom - r.top + 4)}px`;
    }
  }

  // One-click timing cleanup: clamp durations and open gaps between cues. Re-renders and, if
  // the panel is open, refreshes it so the fixed problem list shows.
  private fixTiming(): void {
    this.doc.cues = autoFixTiming(this.doc.cues, { minGapMs: 80, minDurMs: 700, maxDurMs: 7000 });
    this.rows.clear();
    this.innerEl.textContent = "";
    this.renderList();
    this.renderDetail(); // the selected cue's times may have changed
    this.markDirty();
    this.toast(t("timingFixed"));
    if (this.problemsPanel) {
      this.toggleProblems(); // close, then reopen to refresh the (now shorter) issue list
      this.toggleProblems();
    }
  }

  // Localize the pure problem list (findProblems) into rows the panel renders.
  private computeProblems(): { id: string; index: number; msg: string }[] {
    const msgFor: Record<ProblemKind, (cps?: number) => string> = {
      overlap: () => t("probOverlap"),
      tooFast: (c) => t("probTooFast", { cps: (c ?? 0).toFixed(0) }),
      tooLong: () => t("probTooLong"),
    };
    return findProblems(this.doc.cues, { cpsBad: CPS_BAD, maxDurMs: 7000 }).map((p) => ({
      id: p.id,
      index: p.index,
      msg: msgFor[p.kind](p.cps),
    }));
  }

  private shiftTimes(): void {
    const answer = prompt(t("shiftPrompt"), "0");
    if (answer === null) return;
    const delta = parseInt(answer, 10);
    if (Number.isNaN(delta) || delta === 0) return;
    for (const c of this.doc.cues) {
      c.startMs = Math.max(0, c.startMs + delta);
      c.endMs = Math.max(0, c.endMs + delta);
    }
    this.renderList();
    this.renderDetail();
    this.markDirty();
  }

  private fixOverlaps(): void {
    this.doc.cues = sortCues(this.doc.cues);
    let fixed = 0;
    for (let i = 1; i < this.doc.cues.length; i += 1) {
      const prev = this.doc.cues[i - 1];
      const cur = this.doc.cues[i];
      if (cur.startMs < prev.endMs) {
        prev.endMs = Math.min(prev.endMs, cur.startMs);
        fixed += 1;
      }
    }
    this.rows.clear();
    this.innerEl.textContent = "";
    this.renderList();
    this.renderDetail();
    if (fixed) this.markDirty();
    this.toast(t("overlapsFixed", { n: fixed }));
  }

  private async openAegisubTools(initialPage: "qa" | "timing" | "language" | "ass" | "automation" = "qa"): Promise<void> {
    try {
      const { openAegisubToolbox } = await import("./aegisub-tools-ui");
      openAegisubToolbox({
        getDoc: () => this.doc,
        getSelectedIds: () => new Set(this.selectedIds),
        applyDoc: (doc, message) => this.replaceDocument(doc, message),
        selectCue: (id) => this.selectCueById(id),
        runAegisubCommand: (command) => this.runAegisubCommand(command),
      }, initialPage);
    } catch {
      this.toast(t("dialogLoadFailed"));
    }
  }

  private async runStoredAutomations(autoloadOnly: boolean): Promise<void> {
    const extensions = listAutomationExtensions().filter((extension) => !autoloadOnly || extension.autoload);
    if (!extensions.length) {
      this.toast(autoloadOnly ? "No autoload extensions are registered." : "No saved extensions are registered.");
      return;
    }
    let doc = structuredClone(this.doc);
    try {
      for (const extension of extensions) {
        doc = extension.language === "lua"
          ? await runLuaAutomation(extension.code, doc, [...this.selectedIds], this.selectedId).done
          : (await runAutomationExtension(extension.code, doc)).doc;
      }
      this.replaceDocument(doc, `Automation: ${extensions.length} extension(s) reloaded`);
    } catch (error) {
      this.toast(error instanceof Error ? error.message : String(error));
    }
  }

  private setFormat(target: SubtitleFormat): void {
    if (target === this.doc.format) return;
    this.doc = convertDoc(this.doc, target);
    this.refreshForActiveDoc();
    this.markDirty();
  }

  private save(): void {
    void this.saveSubtitles(false);
  }

  private async saveSubtitles(saveAs: boolean): Promise<void> {
    const picker = (window as unknown as { showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
    if (saveAs && picker) {
      try {
        this.subtitleFileHandle = await picker.call(window, {
          suggestedName: `${this.activeTrack().label || "subtitles"}.${this.doc.format}`,
          types: [{ description: `${this.doc.format.toUpperCase()} subtitles`, accept: { "text/plain": [`.${this.doc.format}`] } }],
        });
      } catch {
        return;
      }
    }
    this.autoTimingHistory = null; // accepted save is a boundary; cancelling the picker is not
    const text = serializeSubtitles(this.doc);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    if (this.subtitleFileHandle) {
      const writable = await this.subtitleFileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      this.toast(t("saveVideoDone"));
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(this.activeTrack().label || "subtitles").replace(/[<>:"/\\|?*]+/g, "_")}.${this.doc.format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // --- media preview -------------------------------------------------------

  private currentEmbeddedFontSignature(doc: SubtitleDoc = this.doc, fonts?: EmbeddedFont[]): string {
    if (doc.format !== "ass") return "";
    return JSON.stringify({ embedded: (fonts ?? parseEmbeddedFonts(serializeSubtitles(doc))).map(font => `${font.filename}:${fontBytesFingerprint(font.bytes)}`), bundled: bundledPreviewFonts(doc) });
  }

  private releaseEmbeddedFontUrls(): void {
    this.previewFontGeneration++;
    for (const face of this.previewFontFaces) document.fonts.delete(face);
    this.previewFontFaces.clear();
    this.knownEmbeddedFontFamilies.clear();
    this.bundledFontSignature = "";
    for (const url of this.embeddedFontUrls) URL.revokeObjectURL(url);
    this.embeddedFontUrls = [];
    this.root.dataset.previewFonts = "0";
    this.root.dataset.bundledPreviewFonts = "0";
  }

  private bundledPreviewFontUrls(): string[] {
    return bundledPreviewFonts(this.doc).map(filename => new URL(`octopus/${filename}`, document.baseURI).toString());
  }

  private prepareEmbeddedFontUrls(): string[] {
    this.releaseEmbeddedFontUrls();
    const fonts = this.doc.format === "ass" ? parseEmbeddedFonts(serializeSubtitles(this.doc)) : [];
    this.bundledFontSignature = JSON.stringify(bundledPreviewFonts(this.doc));
    this.embeddedFontSignature = this.currentEmbeddedFontSignature(this.doc, fonts);
    if (this.doc.format !== "ass") return [];
    const generation = this.previewFontGeneration;
    for (const font of fonts) {
      if (!font.bytes.length) continue;
      const url = URL.createObjectURL(new Blob([font.bytes as BlobPart], { type: font.mime }));
      this.embeddedFontUrls.push(url);
      const family = font.family || font.filename.replace(/(?:_\d+)?\.[^.]+$/i, "");
      if (family) this.knownEmbeddedFontFamilies.add(family.trim().toLowerCase());
      for (const name of font.names ?? []) this.knownEmbeddedFontFamilies.add(name.trim().toLowerCase());
      if (family && typeof FontFace !== "undefined") {
        try {
          const face = new FontFace(family, `url(${JSON.stringify(url)})`);
          this.previewFontFaces.add(face);
          void face.load().then(loaded => { if (generation === this.previewFontGeneration) document.fonts.add(loaded); }).catch(() => undefined);
        } catch { /* A malformed CSS family name must not prevent libass/video loading. */ }
      }
    }
    this.root.dataset.previewFonts = String(this.embeddedFontUrls.length);
    const bundled = this.bundledPreviewFontUrls();
    this.bundledFontSignature = JSON.stringify(bundledPreviewFonts(this.doc));
    this.root.dataset.bundledPreviewFonts = String(bundled.length);
    return [...this.embeddedFontUrls, ...bundled];
  }

  private missingFontFamilies(): string[] {
    if (this.doc.format !== "ass") return [];
    return requestedFontFamilies(this.doc).filter(family =>
      !this.knownEmbeddedFontFamilies.has(family.toLowerCase()) && !bundledFontFilename(family));
  }

  private updateFontWarning(): void {
    this.fontWarningEl?.remove();
    this.fontWarningEl = null;
    const missing = this.missingFontFamilies();
    if (!missing.length || !this.player) return;
    const warning = el("div", "se-font-warning") as HTMLDivElement;
    const summary = missing.length > 3 ? `${missing.slice(0, 3).join("、")} 等 ${missing.length} 个字体` : missing.join("、");
    warning.append(el("span", "", `缺失预览字体：${summary}`));
    const load = el("button", "", "加载字体") as HTMLButtonElement;
    load.type = "button";
    load.addEventListener("click", () => void this.collectMissingLocalFonts(missing));
    warning.append(load);
    this.rightEl.append(warning);
    this.fontWarningEl = warning;
  }

  private async collectMissingLocalFonts(families: string[]): Promise<void> {
    interface LocalFontData { family: string; fullName: string; postscriptName: string; blob(): Promise<Blob> }
    const query = (window as unknown as { queryLocalFonts?: () => Promise<LocalFontData[]> }).queryLocalFonts;
    if (!query) {
      await this.openAegisubTools("ass");
      return;
    }
    try {
      const available = await query.call(window);
      let doc = this.doc;
      let count = 0;
      for (const font of matchingLocalFonts(available, families)) {
        const blob = await font.blob();
        const name = `${(font.postscriptName || font.fullName).replace(/[^\p{L}\p{N}_.-]+/gu, "_")}.ttf`;
        doc = embedAssAttachment(doc, name, new Uint8Array(await blob.arrayBuffer()), "font");
        count += 1;
      }
      if (!count) {
        this.toast("本机字体列表中没有找到这些字体；请手动选择字体文件。 ");
        await this.openAegisubTools("ass");
        return;
      }
      this.replaceDocument(doc, `已加载 ${count} 个预览字体`);
    } catch (error) {
      this.toast(error instanceof Error ? error.message : String(error));
    }
  }

  private reloadMediaPreservingState(scanEmbedded = false): void {
    if (this.player?.setSubtitleFonts) {
      this.player.setSubtitleFonts(this.prepareEmbeddedFontUrls());
      this.pushSubtitles(true);
      return;
    }
    if (!this.mediaFile || !this.video) return;
    const file = this.mediaFile;
    const restoreTime = this.video.currentTime;
    const restorePaused = this.video.paused;
    void this.loadVideo(file, { restoreTime, restorePaused, scanEmbedded, preserveView: true });
  }

  private clearPlaybackRuntime(): void {
    this.pendingVideoFrame = null;
    this.visualTransform?.close(); this.visualTransform = null;
    this.audio?.bindVideo(null);
    this.playRangeStop?.();
    this.playRangeStop = null;
    this.videoResizeObserver?.disconnect();
    this.videoResizeObserver = null;
    for (const cleanup of this.mediaCleanup.splice(0)) cleanup();
    this.player?.destroy();
    this.player = null;
    this.video?.pause();
    this.video?.removeEventListener("timeupdate", this.onTimeUpdate);
    this.video?.removeEventListener("pointermove", this.onVideoPointer);
    this.video = null;
    this.videoHost = null;
    this.videoStage = null;
    this.videoScrubber = null;
    this.videoTimeLabel = null;
    this.videoZoomLabel = null;
    this.fontWarningEl?.remove();
    this.fontWarningEl = null;
    this.releaseEmbeddedFontUrls();
  }

  private renderPreviewPlaceholder(): void {
    this.root.classList.remove("se-has-media"); // no video: the preview may collapse on narrow
    this.rightEl.textContent = "";
    const box = el("div", "se-noprev");
    box.appendChild(el("div", "", t("noVideo")));
    box.appendChild(el("div", "", t("loadVideoHint")));
    const btn = this.button(t("loadVideo"), () => this.pickVideo());
    box.appendChild(btn);
    this.rightEl.appendChild(box);
    this.appendVideoChrome();
  }

  private pickVideo(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*,audio/*,.mkv,.avi,.mov,.m4v,.mp3,.wav,.flac,.opus,.ogg,.oga,.m4a,.aac,.alac,.caf,.aif,.aiff";
    input.addEventListener("change", () => {
      const f = input.files?.[0];
      if (f) void this.loadVideo(f);
    });
    input.click();
  }

  // Load the video/audio into an embedded mediaplay player: this brings MKV/legacy remux,
  // Dolby/DTS audio decode and libass ASS rendering. embedded=true so the player's global
  // shortcuts and CC menu stay out of the editor's way; subedit drives subtitles via
  // setSubtitleText and reads currentTime from the underlying media element.
  private async loadAudio(file: File, fromVideo = false): Promise<void> {
    const generation = ++this.audioLoadGeneration;
    if (!fromVideo) this.setMobilePane("audio");
    this.resetAudioAnalysis();
    this.setWaveStatus("正在加载音频…");
    const ready = await this.audio.load(file, fromVideo);
    if (generation !== this.audioLoadGeneration || !ready) return;
    this.audio.bindVideo(this.video);
    this.setPlaybackRate(this.getPlaybackRate());
    this.timeline?.render();
    this.scrollAudioSelectionIntoView();
    const blob = this.audio.analysisBlob;
    if (!blob) return;
    const ac = new AbortController(); this.waveAbort = ac;
    this.root.dataset.waveformDecoder = "worker-loading";
    try {
      const result = await extractStreamedWaveform(blob, ac.signal, ratio => this.setWaveStatus(`${t("extractingWave")} ${Math.round(ratio * 100)}%`));
      if (ac.signal.aborted || generation !== this.audioLoadGeneration) return;
      this.wavePeaks = result; this.timeline?.setPeaks(result.peaks, result.peaksPerSec);
      this.root.dataset.waveformDecoder = "worker-ready"; this.setWaveStatus("");
    } catch {
      if (ac.signal.aborted || generation !== this.audioLoadGeneration) return;
      // Legacy codecs retain the established decoder, but never copy a large video into RAM.
      if (blob.size <= 64 * 1024 * 1024) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (generation !== this.audioLoadGeneration) return;
        this.root.dataset.waveformDecoder = "compatibility";
        await this.extractWaveform(bytes);
      } else {
        this.root.dataset.waveformDecoder = "unavailable";
        this.setWaveStatus("当前编码无法生成波形；可单独打开 WAV / FLAC 音轨继续打轴。");
      }
    } finally { if (this.waveAbort === ac) this.waveAbort = null; }
  }

  private resetAudioAnalysis(): void {
    this.audioExportAbort?.abort();
    this.spectrumRequest++;
    this.waveAbort?.abort();
    this.waveAbort = null;
    this.decodedMono16k = null;
    this.spectrumCancel?.();
    this.spectrumCancel = null;
    this.spectrumData = null;
    this.wavePeaks = null;
    this.timeline?.clearPeaks();
    this.timeline?.clearSpectrum();
  }

  private closeAudio(): void {
    this.audioLoadGeneration++;
    this.resetAudioAnalysis();
    this.audio.close();
    this.setWaveStatus("");
  }

  private pickAudio(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*,video/*,.alac,.caf,.aiff,.flac,.opus,.mkv,.wav";
    input.addEventListener("change", () => { const file = input.files?.[0]; if (file) void this.loadAudio(file); });
    input.click();
  }

  private async loadVideo(
    file: File,
    options: { restoreTime?: number; restorePaused?: boolean; scanEmbedded?: boolean; preserveView?: boolean; dummyClock?: { fps: number; duration: number } } = {},
  ): Promise<void> {
    if (isAudioFile(file)) { await this.loadAudio(file); return; }
    delete this.root.dataset.dummyStatus;
    const generation = ++this.mediaLoadGeneration;
    const replaceAudio = !options.preserveView && ((!this.audio.file && !this.audio.synthetic) || this.audio.fromVideo);
    if (!options.preserveView) {
      this.frameIndexAbort?.abort();
      this.videoFrameIndex = null;
      this.dummyFrameCount = options.dummyClock ? Math.ceil(options.dummyClock.fps * options.dummyClock.duration) : 0;
      this.frameRate = options.dummyClock?.fps ?? 23.976;
      this.root.dataset.frameIndex = this.dummyFrameCount ? "dummy" : "loading";
      delete this.root.dataset.videoFrames;
      if (this.dummyFrameCount) this.root.dataset.videoFrames = String(this.dummyFrameCount);
      else void this.indexVideoFrames(file);
    }
    this.setMobilePane("video");
    this.clearPlaybackRuntime();
    if (this.posOverlay) this.exitPosition();
    if (this.clipOverlay) this.exitClip();
    if (this.drawOverlay) this.exitDraw();
    this.rightEl.textContent = "";
    this.root.classList.remove("se-has-media");
    this.root.dataset.mediaLoading = "true";
    this.root.dataset.mediaName = file.name;
    this.root.dataset.mediaKind = "video";
    if (!options.preserveView) {
      this.videoZoom = 1;
      this.videoPanX = 0;
      this.videoPanY = 0;
      this.videoAspectOverride = null;
    }
    const host = el("div", "se-playerhost") as HTMLDivElement;
    const loading = el("div", "se-media-loading", "正在加载媒体…");
    host.append(loading);
    this.rightEl.appendChild(host);
    this.appendVideoChrome();
    this.mediaFile = file;
    // Playback always receives the disk-backed File and can stream multi-GB media. Embedded-track
    // and waveform extraction currently need a byte view, so keep that optional on memory-limited
    // phones/tablets rather than forcing a huge allocation which can kill the whole page.
    this.mediaContainer = /\.(mkv|webm)$/i.test(file.name) || /matroska|webm/i.test(file.type) ? "mkv" : "mp4";
    host.textContent = "";
    const fontUrls = this.prepareEmbeddedFontUrls();
    const native = localStorage.getItem("aegisub-web.video-decoder") !== "compatibility" && !/\.(mkv|avi|wmv|flv|ts|m2ts)$/i.test(file.name);
    this.root.dataset.videoDecoder = native ? "native" : "compatibility";
    this.player = native ? createNativeVideoPlayer(host, file, fontUrls, message => this.toast(message), seconds => indexedFrameSeconds(seconds, this.videoFrameIndex?.startsMs ?? [])) : createEmbeddedPlayer(
      host,
      { blob: file, mime: file.type || "video/mp4", filename: file.name },
      { embedded: true, libass: { fonts: fontUrls }, onError: (message) => this.toast(message) },
    );
    const v = this.player.getMediaElement() ?? null;
    this.video = v;
    this.audio.bindVideo(v);
    if (v) v.muted = this.audio.muteVideo;
    if (replaceAudio) void this.loadAudio(file, true);
    this.root.classList.add("se-has-media"); // player is now mounted and command-ready
    delete this.root.dataset.mediaLoading;
    if (v) {
      this.configureVideoSurface(v, host);
      v.addEventListener("timeupdate", this.onTimeUpdate);
      v.addEventListener("pointermove", this.onVideoPointer);
      const metadataReady = () => {
        if (generation !== this.mediaLoadGeneration) return;
        if (options.restoreTime !== undefined) {
          const max = Number.isFinite(v.duration) ? Math.max(0, v.duration - .001) : options.restoreTime;
          v.currentTime = Math.min(Math.max(0, options.restoreTime), max);
        }
        this.timeline?.render();
        this.fitVideoSurface();
        this.updateVideoChrome();
        if (options.scanEmbedded !== false && v.tagName === "VIDEO") void this.handleResolutionMismatch(v as HTMLVideoElement);
        if (options.restorePaused === false) void v.play().catch(() => undefined);
      };
      v.addEventListener("loadedmetadata", metadataReady);
      v.addEventListener("seeked", () => {
        if (generation !== this.mediaLoadGeneration) return;
        this.updateVideoChrome();
        this.refreshPausedSubtitleFrame();
      });
      if (v.readyState >= 1) metadataReady();
      v.addEventListener("durationchange", () => this.updateVideoChrome());
      const savedRate = Number(localStorage.getItem("aegisub-web.playback-rate"));
      this.setPlaybackRate(Number.isFinite(savedRate) && savedRate > 0 ? savedRate : 1);
      this.updateVideoChrome();
    }
    this.pushSubtitles();
    this.updateFontWarning();
    // Embedded subtitle extraction is explicit. Opening a video must not scan/copy its
    // entire contents or silently switch away from the user's loaded ASS document.
    if (options.scanEmbedded !== true) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (generation !== this.mediaLoadGeneration) return;
    this.mediaContainer = bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3 ? "mkv" : "mp4";
    this.loadEmbeddedTracks(bytes);
    this.pushSubtitles(true);

  }

  // Read subtitle tracks embedded in the media container and load each as an editable track:
  // MKV/WebM via mediaplay (styled ASS via the reconstructed assDoc), else a progressive MP4
  // via mp4subs. A lone empty placeholder track is replaced; otherwise they are appended.
  private loadEmbeddedTracks(bytes: Uint8Array): void {
    const made: Track[] = [];
    let mkv: MkvSubtitleTrack[] = [];
    try {
      mkv = extractMkvSubtitles(bytes);
    } catch {
      /* not an MKV */
    }
    for (const s of mkv) {
      const doc = s.assDoc ? parseSubtitles(s.assDoc, "embedded.ass") : parseSubtitles(s.vtt ?? "", "embedded.vtt");
      const lang = normalizeLang(s.language);
      made.push({ id: newTrackId(), label: (s.label || lang || `${t("track")} ${made.length + 1}`).trim(), language: lang, doc });
    }
    if (!made.length) {
      // Not Matroska (or no subs): try a progressive MP4/MOV.
      for (const s of extractMp4Subtitles(bytes)) {
        const lang = normalizeLang(s.language);
        made.push({ id: newTrackId(), label: lang || `${t("track")} ${made.length + 1}`, language: lang, doc: parseSubtitles(s.text, "embedded.vtt") });
      }
    }
    if (!made.length) return;
    const placeholder = this.tracks.length === 1 && this.tracks[0].doc.cues.length === 0;
    for (const track of made) this.originalDocs.set(track.id, structuredClone(track.doc));
    if (placeholder) this.tracks = made;
    else this.tracks.push(...made);
    this.activeTrackId = made[0].id;
    this.refreshForActiveDoc();
    this.renderTrackBar();
    this.toast(t("tracksLoaded", { n: made.length }));
  }

  // Decode the media's audio to a waveform via mediaplay, which handles every codec it can
  // play (incl. Dolby/DTS the browser can't decode) and streams the PCM so large files
  // don't buffer in memory. Aborts if another media file is loaded meanwhile.
  private async extractWaveform(bytes: Uint8Array): Promise<void> {
    this.waveAbort?.abort();
    const ac = new AbortController();
    this.waveAbort = ac;
    this.wavePeaks = null;
    this.timeline?.clearPeaks();
    this.setWaveStatus(t("extractingWave"));
    try {
      const result = await extractWaveformPeaks(bytes, {
        base: new URL("libav/", document.baseURI).toString(),
        signal: ac.signal,
        durationHint: this.audio.duration || undefined,
        onProgress: (r) => this.setWaveStatus(`${t("extractingWave")} ${Math.round(r * 100)}%`),
      });
      if (ac.signal.aborted) return;
      if (result?.peaks.length) {
        this.wavePeaks = result;
        this.timeline?.setPeaks(result.peaks, result.peaksPerSec);
      }
    } catch {
      /* leave the timeline peak-less */
    } finally {
      if (this.waveAbort === ac) {
        this.waveAbort = null;
        this.setWaveStatus("");
      }
    }
  }

  private setWaveStatus(text: string): void {
    if (this.waveStatusEl) this.waveStatusEl.textContent = text;
  }

  // Feed the current (serialized) document to the preview so it renders the live edits.
  private pushSubtitles(immediate = false): void {
    if (!this.player) return;
    if (this.video && (this.mediaFile || this.player?.setSubtitleFonts) && JSON.stringify(bundledPreviewFonts(this.doc)) !== this.bundledFontSignature) {
      this.reloadMediaPreservingState(false);
      return;
    }
    this.updateFontWarning();
    window.clearTimeout(this.subtitleTimer);
    const send = () => this.player?.setSubtitleText(serializeSubtitles(this.doc), `subtitles.${this.doc.format}`);
    if (immediate) send();
    else this.subtitleTimer = window.setTimeout(send, 300);
  }

  private refreshPausedSubtitleFrame(): void {
    cancelAnimationFrame(this.subtitleFrameRaf);
    this.subtitleFrameRaf = requestAnimationFrame(() => {
      this.subtitleFrameRaf = 0;
      // During a seek the decoder has not yet presented the requested frame. Sending a
      // replacement ASS track here races the player's own seeked render and can leave
      // the previous transform on canvas. The seeked listener requests the final repaint.
      if (this.video?.paused && !this.video.seeking) this.pushSubtitles(true);
    });
  }

  private onTimeUpdate = (): void => {
    if (!this.video) return;
    this.updateVideoChrome();
    if (!this.audio.playing) this.timeline?.renderPlayhead();
    const ms = this.video.currentTime * 1000;
    const active = this.doc.cues.find((c) => ms >= c.startMs && ms < c.endMs);
    const id = active?.id ?? null;
    if (id === this.playingId) return;
    const prev = this.playingId;
    this.playingId = id;
    if (prev) this.refreshRow(prev);
    if (id) this.refreshRow(id);
    // Keep the playing cue in view while the video actually plays, unless the user turned it off.
    if (id && this.followPlayback && !this.video.paused) this.scrollCueIntoView(id);
  };

  private seekTo(ms: number, play = false): void {
    this.pendingVideoFrame = null;
    if (this.video) {
      this.pendingVideoFrame = { frame: this.frameAtMediaMs(ms), timeMs: ms };
      this.video.currentTime = ms / 1000;
      if (play) { this.audio.prepareOutput(); void this.video.play().catch(() => {}); }
      else {
        this.timeline?.render();
        this.refreshPausedSubtitleFrame();
      }
    }
  }

  private stopAndSeek(ms: number): void {
    this.audio.stop();
    this.audio.seek(ms / 1000);
    this.playRangeStop?.();
    this.playRangeStop = null;
    if (!this.video) return;
    this.video.pause();
    this.video.currentTime = Math.max(0, ms) / 1000;
    this.timeline?.stopPlayheadLoop();
    this.timeline?.render();
    this.updateVideoChrome();
    this.refreshPausedSubtitleFrame();
  }

  private onVideoPointer = (event: Event): void => {
    if (!(event instanceof PointerEvent) || !this.video) return;
    const rect = this.video.getBoundingClientRect();
    const resolution = getPlayRes(this.doc);
    this.lastVideoPointer = {
      x: Math.round(((event.clientX - rect.left) / Math.max(1, rect.width)) * resolution.x),
      y: Math.round(((event.clientY - rect.top) / Math.max(1, rect.height)) * resolution.y),
    };
  };

  private chooseDummyVideo(): Promise<DummyVideoOptions | null> {
    return new Promise(resolve => {
      let last: Partial<DummyVideoOptions & { fpsText: string }> = {};
      try {
        const saved = JSON.parse(localStorage.getItem("aegisub-web.dummy-video") ?? "{}");
        if (saved && typeof saved === "object" && !Array.isArray(saved)) last = saved;
      } catch { /* use defaults */ }
      const back = el("div", "ad-back");
      const modal = el("form", "ad-modal") as HTMLFormElement;
      const head = el("div", "ad-head"); head.append(el("h2", "", "使用空白视频"));
      const body = el("div", "ad-body"), grid = el("div", "ad-grid");
      const field = (label: string, input: HTMLElement) => { const wrap = el("label", "ad-field", label); wrap.append(input); return wrap; };
      const number = (value: number, min: number, max: number) => {
        const input = document.createElement("input"); input.type = "number"; input.min = String(min); input.max = String(max); input.step = "1"; input.required = true; input.value = String(value); return input;
      };
      const preset = document.createElement("select");
      for (const size of ["自定义", "640×480", "1280×720", "1920×1080", "3840×2160"]) preset.append(new Option(size, size === "自定义" ? "" : size.replace("×", "x")));
      const width = number(last.width ?? 1280, 1, 8192), height = number(last.height ?? 720, 1, 8192);
      preset.value = `${width.value}x${height.value}`;
      preset.addEventListener("change", () => { if (preset.value) [width.value, height.value] = preset.value.split("x"); });
      const frames = number(last.frames ?? 40000, 2, 36000000);
      const fps = document.createElement("input"); fps.type = "text"; fps.inputMode = "decimal"; fps.value = last.fpsText ?? "24000/1001"; fps.required = true;
      const color = document.createElement("input"); color.type = "color"; color.value = last.color ?? "#2fa3fe";
      const checkerboard = document.createElement("input"); checkerboard.type = "checkbox"; checkerboard.checked = last.checkerboard ?? false;
      const duration = el("output", "", "");
      const error = el("div", "se-dummy-error"); error.setAttribute("role", "alert");
      const updateDuration = () => {
        const rate = parseDummyFrameRate(fps.value);
        fps.setCustomValidity(rate === null ? "请输入有效帧率，例如 24 或 24000/1001。" : "");
        duration.textContent = rate ? `时长：${formatTimestamp(Number(frames.value) / rate * 1000, ".")}` : "帧率无效";
      };
      fps.addEventListener("input", updateDuration); frames.addEventListener("input", updateDuration); updateDuration();
      grid.append(field("预设", preset), field("背景颜色", color), field("宽度", width), field("高度", height), field("帧率", fps), field("时长（帧）", frames), field("棋盘格", checkerboard), duration);
      body.append(grid, error);
      const foot = el("div", "ad-foot");
      const cancel = el("button", "ad-btn", "取消") as HTMLButtonElement; cancel.type = "button";
      const create = el("button", "ad-btn primary", "创建") as HTMLButtonElement; create.type = "submit";
      foot.append(cancel, create); modal.append(head, body, foot); back.append(modal); document.body.append(back);
      const finish = (options: DummyVideoOptions | null) => { back.remove(); resolve(options); };
      cancel.addEventListener("click", () => finish(null));
      back.addEventListener("pointerdown", event => { if (event.target === back) finish(null); });
      modal.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); finish(null); } });
      modal.addEventListener("submit", event => {
        event.preventDefault(); updateDuration();
        const frameRate = parseDummyFrameRate(fps.value);
        if (!modal.reportValidity() || frameRate === null) return;
        if (Number(width.value) * Number(height.value) > 16777216) { error.textContent = "此预览画布最多支持 16777216 像素，请减小尺寸。"; return; }
        const options = { width: Number(width.value), height: Number(height.value), frames: Number(frames.value), frameRate, color: color.value, checkerboard: checkerboard.checked };
        localStorage.setItem("aegisub-web.dummy-video", JSON.stringify({ ...options, fpsText: fps.value }));
        finish(options);
      });
      fps.focus();
    });
  }

  private openDummyVideo(options: DummyVideoOptions): void {
    this.mediaLoadGeneration++;
    this.frameIndexAbort?.abort(); this.frameIndexAbort = null;
    this.videoFrameIndex = null;
    this.dummyFrameCount = options.frames; this.frameRate = options.frameRate;
    this.clearPlaybackRuntime();
    if (this.posOverlay) this.exitPosition();
    if (this.clipOverlay) this.exitClip();
    if (this.drawOverlay) this.exitDraw();
    this.mediaFile = null;
    this.videoZoom = 1; this.videoPanX = 0; this.videoPanY = 0; this.videoAspectOverride = null;
    this.rightEl.replaceChildren();
    const host = el("div", "se-playerhost") as HTMLDivElement;
    this.rightEl.append(host); this.appendVideoChrome();
    this.player = createDummyVideoPlayer(host, options, this.prepareEmbeddedFontUrls(), message => this.toast(message));
    const media = this.player.getMediaElement()!;
    this.video = media;
    this.configureVideoSurface(media, host);
    this.audio.bindVideo(media);
    media.addEventListener("timeupdate", this.onTimeUpdate);
    media.addEventListener("pointermove", this.onVideoPointer);
    media.addEventListener("seeked", () => { this.updateVideoChrome(); this.refreshPausedSubtitleFrame(); });
    this.root.classList.add("se-has-media");
    this.root.dataset.mediaKind = "dummy";
    this.root.dataset.mediaName = `空白视频 ${options.width}×${options.height}`;
    this.root.dataset.frameIndex = "dummy"; this.root.dataset.videoFrames = String(options.frames);
    this.root.dataset.dummyStatus = "ready"; delete this.root.dataset.mediaLoading;
    this.setMobilePane("video");
    this.setPlaybackRate(this.getPlaybackRate());
    this.pushSubtitles(true); this.updateVideoChrome(); this.updateFontWarning();
  }

  private async openDummyMedia(kind: "video" | "blank" | "noise"): Promise<void> {
    if (kind === "video") {
      const options = await this.chooseDummyVideo();
      if (options) this.openDummyVideo(options);
      return;
    }
    this.audioLoadGeneration++;
    this.resetAudioAnalysis();
    this.audio.openSynthetic(kind);
    this.audio.bindVideo(this.video);
    this.setMobilePane("audio");
    this.timeline?.setPeakProvider((start, end) => this.audio.synthetic?.peak(start, end) ?? 0);
    this.setPlaybackRate(this.getPlaybackRate());
    this.setWaveStatus("");
  }

  private closeMedia(): void {
    this.mediaLoadGeneration += 1;
    delete this.root.dataset.dummyStatus;
    this.frameIndexAbort?.abort();
    this.frameIndexAbort = null;
    this.videoFrameIndex = null;
    this.dummyFrameCount = 0;
    delete this.root.dataset.frameIndex;
    delete this.root.dataset.videoFrames;
    this.clearPlaybackRuntime();
    this.mediaFile = null;
    this.lastVideoPointer = null;
    delete this.root.dataset.mediaKind;
    delete this.root.dataset.mediaName;
    delete this.root.dataset.mediaLoading;
    this.renderPreviewPlaceholder();
  }

  private playAudioRange(startMs: number, endMs: number | (() => number)): void {
    if (!this.audio.element) { this.toast("请先加载音频。"); return; }
    this.video?.pause();
    this.playRangeStop?.();
    this.playRangeStop = null;
    this.audio.play(startMs, endMs);
  }

  private playRange(startMs: number, endMs: number): void {
    if (!this.video) {
      this.toast(t("timingNeedsVideo"));
      return;
    }
    this.playRangeStop?.();
    const video = this.video;
    this.audio.prepareOutput();
    const stop = (): void => {
      video.removeEventListener("timeupdate", check);
      if (this.playRangeStop === stop) this.playRangeStop = null;
    };
    const check = (): void => {
      if (video.currentTime * 1000 >= endMs) {
        video.pause();
        stop();
      }
    };
    this.playRangeStop = stop;
    video.addEventListener("timeupdate", check);
    video.currentTime = Math.max(0, startMs) / 1000;
    void video.play().catch(stop);
  }

  private async saveSelectedAudioClip(): Promise<void> {
    const range = selectedAudioClipRange(this.doc.cues, this.selectedIds, this.doc.format === "ass");
    const file = this.audio.analysisBlob, synthetic = this.audio.synthetic;
    if (!range || (!file && !synthetic)) {
      this.toast("请先加载音频并选择字幕行。");
      return;
    }
    this.audioExportAbort?.abort();
    const ac = new AbortController(); this.audioExportAbort = ac;
    const generation = this.audioLoadGeneration;
    const bar = el("div", "se-jobstrip on se-audio-export");
    bar.setAttribute("role", "status");
    const label = el("span", "", "正在导出所选音频…");
    const meter = document.createElement("progress"); meter.max = 1; meter.value = 0;
    meter.setAttribute("aria-label", "音频导出进度");
    const cancel = el("button", "", "取消") as HTMLButtonElement; cancel.type = "button";
    cancel.addEventListener("click", () => ac.abort());
    bar.append(label, meter, cancel); this.jobStrip.after(bar);
    // Closing/replacing the source or cancelling removes this job immediately. It
    // never cancels waveform analysis or changes the media transport/selection.
    ac.signal.addEventListener("abort", () => bar.remove(), { once: true });
    this.root.dataset.audioExport = "running";
    const progress = (ratio: number) => {
      if (ac.signal.aborted) return;
      meter.value = ratio; label.textContent = `正在导出所选音频… ${Math.round(ratio * 100)}%`;
    };
    try {
      const blob = synthetic
        ? await synthetic.wavClip(range.startMs / 1000, range.endMs / 1000, progress, ac.signal)
        : await exportAudioClip(file!, range, ac.signal, progress);
      if (ac.signal.aborted || generation !== this.audioLoadGeneration) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `audio-${formatTimestamp(range.startMs, ".").replace(/:/g, "-")}.wav`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.root.dataset.audioExport = "done";
    } catch (error) {
      if (!ac.signal.aborted && generation === this.audioLoadGeneration) {
        this.root.dataset.audioExport = "error";
        this.toast(error instanceof Error ? error.message : String(error));
      }
    } finally {
      bar.remove();
      if (this.audioExportAbort === ac) {
        this.audioExportAbort = null;
        if (ac.signal.aborted) this.root.dataset.audioExport = "cancelled";
      }
    }
  }

  private async showAudioView(view: "waveform" | "spectrum"): Promise<void> {
    const request = ++this.spectrumRequest;
    this.spectrumCancel?.(); this.spectrumCancel = null;
    this.setMobilePane("audio");
    this.audioViewMode = view;
    if (view === "waveform") { this.timeline?.setAudioView("waveform"); this.setWaveStatus(""); return; }
    if (this.spectrumData) { this.timeline?.setSpectrum(this.spectrumData); return; }
    if (!this.audio.analysisBlob && !this.audio.synthetic) { this.toast("请先加载音频。"); return; }
    const generation = this.audioLoadGeneration;
    const current = () => generation === this.audioLoadGeneration && request === this.spectrumRequest;
    const progress = (ratio: number) => { if (current()) this.setWaveStatus(`频谱 ${Math.round(ratio * 100)}%`); };
    try {
      this.setWaveStatus("正在计算频谱…");
      let run: ReturnType<typeof computeSpectrum>;
      if (this.audio.synthetic) run = computeDummySpectrum(this.audio.synthetic.kind, this.audio.duration, this.audio.synthetic.sampleRate, progress);
      else {
        const decoded = this.decodedMono16k ?? await decodeAudioToMono16k(this.audio.analysisBlob!, { durationHint: this.audio.duration || undefined });
        if (!current()) return;
        this.decodedMono16k = decoded;
        run = computeSpectrum(decoded, 16000, progress);
      }
      this.spectrumCancel = run.cancel;
      const data = await run.done;
      if (!current()) return;
      this.spectrumData = data;
      this.timeline?.setSpectrum(data);
    } catch (error) {
      if (current() && !(error instanceof DOMException && error.name === "AbortError")) this.toast(error instanceof Error ? error.message : String(error));
    } finally {
      if (current()) { this.spectrumCancel = null; this.setWaveStatus(""); }
    }
  }

  private async captureVideoFrame(mode: "with-subs" | "raw" | "subs", clipboard: boolean): Promise<void> {
    const video = this.video as HTMLVideoElement | null;
    if (!video || !video.videoWidth || !video.videoHeight) {
      this.toast("No decoded video frame is available.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d")!;
    if (mode !== "subs") context.drawImage(video, 0, 0, canvas.width, canvas.height);
    if (mode !== "raw") {
      for (const overlay of this.rightEl.querySelectorAll<HTMLCanvasElement>(".se-playerhost canvas")) {
        if (overlay === canvas || overlay === this.video || !overlay.width || !overlay.height) continue;
        context.drawImage(overlay, 0, 0, canvas.width, canvas.height);
      }
    }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG encoding failed")), "image/png"));
    if (clipboard && navigator.clipboard && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      this.toast("Frame copied to clipboard.");
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${mode}-${Math.round(video.currentTime * 1000)}.png`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private toggleOverscan(): void {
    if (this.overscanOverlay) {
      this.overscanOverlay.remove();
      this.overscanOverlay = null;
      return;
    }
    const overlay = el("div", "se-overscan") as HTMLDivElement;
    overlay.setAttribute("aria-label", "10 percent overscan mask");
    this.rightEl.appendChild(overlay);
    this.overscanOverlay = overlay;
  }

  private openVectorClipMode(mode: VectorClipMode = "drag"): void {
    const cue = this.selectedCue();
    if (!cue) return;
    if (!this.video) {
      this.toast(t("posNeedsVideo"));
      return;
    }
    if (!this.vectorClip) {
      const resolution = getPlayRes(this.doc);
      this.vectorClip = openVectorClip({
        container: this.rightEl,
        width: resolution.x,
        height: resolution.y,
        text: cue.text,
        onChange: (text) => this.updateCue(cue.id, { text }),
        onClose: () => { this.vectorClip = null; },
      });
    }
    this.vectorClip.setMode(mode);
  }

  private async handleResolutionMismatch(video: HTMLVideoElement): Promise<void> {
    if (this.doc.format !== "ass" || !video.videoWidth || !video.videoHeight) return;
    // The application opens with an instructional placeholder project. A video selected
    // before the real subtitle file must not trigger a modal based on that fake resolution.
    if (/^Title\s*:\s*Welcome to Aegisub Web\s*$/im.test(this.doc.assScriptInfo ?? "")) return;
    const script = getPlayRes(this.doc);
    const target = { x: video.videoWidth, y: video.videoHeight };
    if ((script.x === target.x && script.y === target.y) || (script.x % target.x === 0 && script.y % target.y === 0)) return;
    const choice = await openResolutionMismatchDialog(script, target);
    if (choice === "ignore") return;
    if (choice === "set") {
      const doc = structuredClone(this.doc);
      let info = doc.assScriptInfo ?? "[Script Info]\n";
      const set = (key: string, value: number): void => {
        const pattern = new RegExp(`^${key}\\s*:\\s*.*$`, "im");
        info = pattern.test(info) ? info.replace(pattern, `${key}: ${value}`) : `${info}\n${key}: ${value}`;
      };
      set("PlayResX", target.x); set("PlayResY", target.y); doc.assScriptInfo = info;
      this.replaceDocument(doc, "Script resolution set to video");
      return;
    }
    this.replaceDocument(resampleAssDocument(this.doc, target.x, target.y, choice).doc, `Script resampled: ${choice}`);
  }

  // --- video timing --------------------------------------------------------

  // Set the selected cue's start or end to the current playhead, keeping a minimal 1ms span.
  private setCueEdge(which: "start" | "end"): void {
    const cue = this.selectedCue();
    if (!cue) return;
    if (!this.video) {
      this.toast(t("timingNeedsVideo"));
      return;
    }
    const ms = Math.round(this.video.currentTime * 1000);
    if (which === "start") this.updateCue(cue.id, { startMs: clampStart(cue, ms) });
    else this.updateCue(cue.id, { endMs: clampEnd(cue, ms) });
  }

  private playFromSelected(): void {
    const cue = this.selectedCue();
    if (!cue) return;
    if (!this.video) {
      this.toast(t("timingNeedsVideo"));
      return;
    }
    this.playRange(cue.startMs, cue.endMs);
  }

  private toggleFollow(): void {
    this.followPlayback = !this.followPlayback;
    this.followBtn?.classList.toggle("on", this.followPlayback);
    if (this.followPlayback && this.playingId) this.scrollCueIntoView(this.playingId);
  }

  private scrollCueIntoView(id: string): void {
    const i = this.doc.cues.findIndex((c) => c.id === id);
    if (i < 0) return;
    const rowHeight = this.rowHeight();
    const top = i * rowHeight;
    const viewTop = this.scrollEl.scrollTop;
    const viewH = this.scrollEl.clientHeight;
    if (top < viewTop) this.scrollEl.scrollTop = top;
    else if (top + rowHeight > viewTop + viewH) this.scrollEl.scrollTop = top + rowHeight - viewH;
  }

  private rowHeight(): number {
    const value = Number.parseFloat(getComputedStyle(this.root).getPropertyValue("--se-row-height"));
    return Number.isFinite(value) && value > 0 ? value : ROW_H;
  }

  // --- keyboard ------------------------------------------------------------

  private hotkeyContextForTarget(target: Element | null): AegisubHotkeyContext {
    if (!target) return "default";
    if (target === this.detailTextarea || target.closest(".se-detail textarea")) return "edit-box";
    if (target.closest(".se-timeline-wrap")) return "audio";
    if (target.closest(".se-right,.se-playerhost")) return "video";
    if (target.closest(".se-inner,.se-row")) return "grid";
    return "default";
  }

  private onContextActivation = (event: Event): void => {
    const target = event.target instanceof Element ? event.target : null;
    const context = this.hotkeyContextForTarget(target);
    if (context !== "default") this.activeHotkeyContext = context;
  };

  private onShellKeydown = (event: KeyboardEvent): void => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target && this.root.contains(target)) return; // root's focused-context handler owns it
    if (target?.closest("dialog,[role=dialog],.aa-modal,.aw-toolbox,.sp-modal,.ai-modal")) return;
    const app = document.getElementById("app");
    if (target && target !== document.body && target !== document.documentElement && app && !app.contains(target)) return;
    this.onKeydown(event);
  };

  private onKeydown = (e: KeyboardEvent): void => {
    if (e.isComposing || e.defaultPrevented) return;
    // Save shortcuts fire even while typing (and pre-empt the browser's own save dialog), but
    // only when subedit owns saving; when a host owns it (showSave:false), let the key pass so
    // the host handles it. Save-into-video only acts when a media file is actually loaded.
    if (this.opts.showSave !== false && SHORTCUTS.save.match(e)) {
      e.preventDefault();
      this.save();
      return;
    }
    if (this.mediaFile && SHORTCUTS.saveVideo.match(e)) {
      e.preventDefault();
      void this.saveIntoVideo();
      return;
    }
    if (SHORTCUTS.find.match(e)) {
      e.preventDefault();
      if (!this.findBar) this.toggleFind();
      else this.findInput?.focus();
      return;
    }

    const target = e.target instanceof Element ? e.target : this.root;
    const rangeControl = target instanceof HTMLInputElement && target.type === "range";
    // A native slider owns navigation keys, but it is not a text editor: S/D/F/G
    // must continue to reach the Audio context after adjusting a slider.
    if (rangeControl && /^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown)$/.test(e.key)) return;
    const typing =
      (!rangeControl && target.tagName === "INPUT") || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || (target instanceof HTMLElement && target.isContentEditable);
    const alwaysCommand = resolveAegisubOverrideHotkey(e, localStorage.getItem("aegisub-web.global-hotkeys") === "true");
    if (alwaysCommand) {
      e.preventDefault();
      this.runAegisubCommand(alwaysCommand);
      return;
    }
    let context = this.hotkeyContextForTarget(target);
    if (context === "default" && !typing) context = this.activeHotkeyContext;
    if (typing && context !== "edit-box") context = "default";
    if (!typing && context === "audio" && e.key === "Escape") {
      e.preventDefault();
      this.timingDraft.clear();
      this.renderTimingDraft();
      return;
    }
    const contextCommand = resolveAegisubContextHotkey(e, context);
    if (contextCommand) {
      e.preventDefault();
      this.runAegisubCommand(contextCommand);
      return;
    }
    const defaultCommand = resolveAegisubDefaultHotkey(e);
    const nativeTextCommands = new Set(["edit/line/copy", "edit/line/cut", "edit/line/paste", "edit/undo", "edit/redo"]);
    if (defaultCommand && !(typing && nativeTextCommands.has(defaultCommand))) {
      e.preventDefault();
      this.runAegisubCommand(defaultCommand);
      return;
    }
    if (typing) return; // keep text copy/cut/paste and native field undo/redo

    // Undo/redo only claim the key when they have something to do, so an empty stack still
    // lets a host (e.g. Omnitext) handle it.
    if (SHORTCUTS.undo.match(e)) {
      if (this.canUndo()) {
        e.preventDefault();
        this.undo();
      }
      return;
    }
    if (SHORTCUTS.redo.match(e)) {
      if (this.canRedo()) {
        e.preventDefault();
        this.redo();
      }
      return;
    }

    if (SHORTCUTS.addCue.match(e)) {
      e.preventDefault();
      this.addCue();
    } else if (SHORTCUTS.removeCue.match(e)) {
      e.preventDefault();
      this.removeCue();
    } else if (SHORTCUTS.copy.match(e)) {
      e.preventDefault();
      this.copyCues();
    } else if (SHORTCUTS.paste.match(e)) {
      e.preventDefault();
      this.pasteCuesFromClipboard();
    } else if (SHORTCUTS.markIn.match(e)) {
      e.preventDefault();
      this.setCueEdge("start");
    } else if (SHORTCUTS.markOut.match(e)) {
      e.preventDefault();
      this.setCueEdge("end");
    } else if (SHORTCUTS.playCue.match(e)) {
      e.preventDefault();
      this.playFromSelected();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      this.moveSelection(1, e.shiftKey);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.moveSelection(-1, e.shiftKey);
    } else if (e.key === " ") {
      if (this.video) {
        e.preventDefault();
        if (this.video.paused) { this.audio.prepareOutput(); void this.video.play().catch(() => {}); }
        else this.video.pause();
      }
    }
  };

  private moveSelection(delta: number, extend = false): void {
    const i = this.doc.cues.findIndex((c) => c.id === this.selectedId);
    const next = Math.max(0, Math.min(this.doc.cues.length - 1, (i < 0 ? 0 : i) + delta));
    const cue = this.doc.cues[next];
    if (!cue) return;
    if (extend) this.extendSelect(cue.id);
    else this.select(cue.id);
  }

  // --- misc ----------------------------------------------------------------

  private selectedCue(): Cue | undefined {
    return this.doc.cues.find((c) => c.id === this.selectedId);
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "se-btn";
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  // An icon-only toolbar button: SVG glyph + a title/aria-label tooltip. When the action has
  // a keyboard shortcut, the tooltip shows it in parentheses and aria-keyshortcuts exposes it
  // to assistive tech. mousedown is suppressed so clicking keeps focus/selection in the editor.
  private iconButton(svg: string, title: string, onClick: () => void, sc?: Shortcut): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "se-btn se-iconbtn";
    b.innerHTML = svg;
    b.title = sc ? `${title} (${sc.label})` : title;
    b.setAttribute("aria-label", title);
    if (sc) b.setAttribute("aria-keyshortcuts", sc.aria);
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", onClick);
    return b;
  }

  private toastEl: HTMLDivElement | null = null;
  private toastTimer = 0;

  // A non-blocking toast at the bottom of the editor. Announced politely for screen readers.
  private toast(msg: string): void {
    if (!this.toastEl) {
      this.toastEl = el("div", "se-toast") as HTMLDivElement;
      this.toastEl.setAttribute("role", "status");
      this.toastEl.setAttribute("aria-live", "polite");
      this.root.appendChild(this.toastEl);
    }
    this.toastEl.textContent = msg;
    void this.toastEl.offsetWidth; // restart the fade-in even on a back-to-back toast
    this.toastEl.classList.add("on");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl?.classList.remove("on"), 2600);
  }

  private markDirty(recordHistory = true): void {
    this.reportDocFields();
    this.countEl.textContent = t("cueCount", { n: this.doc.cues.length });
    this.pushSubtitles();
    this.opts.onChange?.();
    if (recordHistory) { this.autoTimingHistory = null; this.scheduleHistory(); }
  }

  // --- undo / redo ---------------------------------------------------------

  private snapshot(): HistorySnap {
    return {
      tracks: this.tracks.map((tr) => ({ id: tr.id, label: tr.label, language: tr.language, doc: structuredClone(tr.doc) })),
      activeTrackId: this.activeTrackId,
      selectedId: this.selectedId,
      selectedIds: [...this.selectedIds],
    };
  }

  // Called from markDirty on every edit. begin() records the pre-edit baseline once per group;
  // a 500ms timer commits the group so rapid edits (typing) merge into one undo step.
  private scheduleHistory(): void {
    if (this.restoring) return;
    this.history.begin();
    window.clearTimeout(this.histTimer);
    this.histTimer = window.setTimeout(() => {
      this.history.commit(this.snapshot());
      this.histTimer = 0;
      this.updateHistoryButtons();
    }, 500);
    this.updateHistoryButtons();
  }

  private undo(): void {
    if (this.undoHandler) return void this.undoHandler.undo();
    window.clearTimeout(this.histTimer);
    this.histTimer = 0;
    const prev = this.history.undo(this.snapshot());
    if (!prev) return;
    this.restoreSnap(prev);
    this.updateHistoryButtons();
  }

  private redo(): void {
    if (this.undoHandler) return void this.undoHandler.redo();
    window.clearTimeout(this.histTimer);
    this.histTimer = 0;
    const next = this.history.redo(this.snapshot());
    if (!next) return;
    this.restoreSnap(next);
    this.updateHistoryButtons();
  }

  private canUndo(): boolean {
    return this.undoHandler ? this.undoHandler.canUndo() : this.history.canUndo();
  }
  private canRedo(): boolean {
    return this.undoHandler ? this.undoHandler.canRedo() : this.history.canRedo();
  }

  private restoreSnap(snap: HistorySnap): void {
    this.restoring = true;
    this.tracks = snap.tracks.map((tr) => ({ id: tr.id, label: tr.label, language: tr.language, doc: structuredClone(tr.doc) }));
    this.activeTrackId = this.tracks.some((tr) => tr.id === snap.activeTrackId) ? snap.activeTrackId : (this.tracks[0]?.id ?? "");
    this.renderTrackBar();
    this.refreshForActiveDoc(); // re-selects cues[0]; restore the saved selection if it survives
    if (snap.selectedId && this.doc.cues.some((c) => c.id === snap.selectedId)) this.setSelection(snap.selectedIds.filter(id => this.doc.cues.some(cue => cue.id === id)), snap.selectedId);
    this.pushSubtitles(true);
    this.opts.onChange?.();
    this.restoring = false;
  }

  private updateHistoryButtons(): void {
    if (this.undoBtn) this.undoBtn.disabled = !this.canUndo();
    if (this.redoBtn) this.redoBtn.disabled = !this.canRedo();
  }

  private applyCueList(cues: Cue[], selection: string[] = [], message?: string): void {
    this.doc.cues = cues;
    this.rows.clear();
    this.innerEl.textContent = "";
    this.renderList();
    const surviving = selection.filter((id) => cues.some((cue) => cue.id === id));
    if (surviving.length) this.setSelection(surviving, surviving.at(-1)!);
    else if (cues.length) this.select(cues[Math.min(cues.length - 1, Math.max(0, cues.findIndex((cue) => cue.id === this.selectedId)))].id);
    else {
      this.selectedId = null;
      this.selectedIds.clear();
      this.renderDetail();
    }
    this.markDirty();
    if (message) this.toast(message);
  }

  private async indexVideoFrames(file: File): Promise<void> {
    const controller = new AbortController();
    this.frameIndexAbort = controller;
    try {
      const index = await readVideoFrameIndex(file, controller.signal);
      if (controller.signal.aborted) return;
      this.videoFrameIndex = index;
      this.frameRate = index.frameRate;
      if (this.pendingVideoFrame) this.pendingVideoFrame.frame = this.frameAtMediaMs(this.pendingVideoFrame.timeMs);
      this.root.dataset.frameIndex = "ready";
      this.root.dataset.videoFrames = String(index.startsMs.length);
      this.updateVideoChrome();
      if (this.mediaFile === file) this.pushSubtitles(true);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.root.dataset.frameIndex = "unavailable";
      this.toast(`无法建立视频帧索引：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private get frameTimes(): number[] { return this.timecodesMs.length ? this.timecodesMs : this.videoFrameIndex?.startsMs ?? []; }
  private get frameKeyframes(): number[] { return this.keyframesMs.length ? this.keyframesMs : this.videoFrameIndex?.keyframesMs ?? []; }

  private audioKeyframeTimes(): number[] {
    const keys = this.frameKeyframes, frames = this.frameTimes;
    const cached = this.audioMarkerCache;
    if (cached && cached.keys === keys && cached.frames === frames && cached.fps === this.frameRate) return cached.result;
    // Native keyframe markers use START frame midpoints, not presentation timestamps.
    const result = keys.map(time => Math.max(0, VideoFrameIndex.timeAtFrame(frames, this.frameAtMs(time), this.frameRate, "start")));
    this.audioMarkerCache = { keys, frames, fps: this.frameRate, result }; return result;
  }

  private currentFrameDuration(): number {
    const frame = this.currentVideoFrame();
    return VideoFrameIndex.timeAtFrame(this.frameTimes, frame + 1, this.frameRate) - VideoFrameIndex.timeAtFrame(this.frameTimes, frame, this.frameRate);
  }

  private frameAtMs(timeMs: number): number {
    if (!this.frameTimes.length) return Math.max(0, Math.floor(timeMs * this.frameRate / 1000));
    return VideoFrameIndex.frameAtTime(this.frameTimes, timeMs);
  }

  private frameAtMediaMs(timeMs: number): number {
    const raw = this.videoFrameIndex?.startsMs ?? [];
    return raw.length ? VideoFrameIndex.frameAtTime(raw, timeMs)
      : this.dummyFrameCount ? Math.max(0, Math.min(this.dummyFrameCount - 1, Math.floor(timeMs * this.frameRate / 1000 + 1e-7))) : this.frameAtMs(timeMs);
  }

  private currentVideoFrame(): number {
    if (!this.video) return 0;
    if (!this.video.paused) this.pendingVideoFrame = null;
    if (this.video.seeking) return this.frameAtMediaMs(this.video.currentTime * 1000);
    const presented = this.frameAtMediaMs((this.player?.getPresentedTime?.() ?? this.video.currentTime) * 1000);
    if (this.pendingVideoFrame) {
      const pending = this.pendingVideoFrame;
      if (presented !== pending.frame && Math.abs(this.video.currentTime * 1000 - pending.timeMs) < 2) return pending.frame;
      this.pendingVideoFrame = null;
    }
    return presented;
  }

  private seekVideoFrame(delta: number): void {
    if (!this.video) return;
    const rawFrames = this.videoFrameIndex?.startsMs ?? (this.dummyFrameCount ? [] : this.frameTimes);
    const count = rawFrames.length || this.dummyFrameCount;
    if (!count) { this.toast("视频帧索引尚不可用。"); return; }
    const frame = Math.max(0, Math.min(count - 1, this.currentVideoFrame() + delta));
    this.video.pause();
    this.audio.stop();
    this.playRangeStop?.();
    this.playRangeStop = null;
    // Place the HTML decoder inside this frame's interval, avoiding floating-point
    // conversion rounding its exact start back onto the previous frame.
    const timeMs = VideoFrameIndex.timeAtFrame(rawFrames, frame, this.frameRate) + .001;
    this.seekTo(timeMs); this.pendingVideoFrame = { frame, timeMs };
  }

  private videoBoundaryTime(boundary: "start" | "end"): number {
    return Math.max(0, VideoFrameIndex.timeAtFrame(this.frameTimes, this.currentVideoFrame(), this.frameRate, boundary));
  }

  private currentPlayheadMs(): number {
    return Math.round((this.video?.currentTime ?? this.selectedCue()?.startMs ?? 0) * (this.video ? 1000 : 1));
  }

  private wrapCurrentText(open: string, close = ""): void {
    const cue = this.selectedCue();
    if (!cue) return;
    const textarea = this.detailTextarea;
    const start = textarea?.selectionStart ?? cue.text.length;
    const end = textarea?.selectionEnd ?? start;
    const text = `${cue.text.slice(0, start)}${open}${cue.text.slice(start, end)}${close}${cue.text.slice(end)}`;
    this.updateCue(cue.id, { text });
    requestAnimationFrame(() => {
      if (!this.detailTextarea) return;
      this.detailTextarea.focus();
      this.detailTextarea.setSelectionRange(start + open.length, end + open.length);
    });
  }

  private applyOverrideCommand(command: string): boolean {
    const tags: Record<string, [string, string]> = {
      "edit/style/bold": ["{\\b1}", "{\\b0}"],
      "edit/style/italic": ["{\\i1}", "{\\i0}"],
      "edit/style/underline": ["{\\u1}", "{\\u0}"],
      "edit/style/strikeout": ["{\\s1}", "{\\s0}"],
    };
    if (tags[command]) {
      this.wrapCurrentText(tags[command][0], tags[command][1]);
      return true;
    }
    const colourTag: Record<string, string> = {
      "edit/color/primary": "c",
      "edit/color/secondary": "2c",
      "edit/color/outline": "3c",
      "edit/color/shadow": "4c",
    };
    if (colourTag[command]) {
      const value = prompt("Colour (#RRGGBB):", "#ffffff");
      if (value && /^#[0-9a-f]{6}$/i.test(value)) this.wrapCurrentText(`{\\${colourTag[command]}${hexToAssColor(value, "00")}}`);
      return true;
    }
    if (command === "edit/font") {
      const font = prompt("Font family:", this.selectedCue()?.assFields?.Style || "Arial");
      if (font) this.wrapCurrentText(`{\\fn${font}}`);
      return true;
    }
    return false;
  }

  private setSelectedEdges(which: "start" | "end", valueMs: number): void {
    const cues = this.doc.cues.map((cue) => {
      if (!this.selectedIds.has(cue.id)) return structuredClone(cue);
      return which === "start"
        ? { ...structuredClone(cue), startMs: Math.min(valueMs, cue.endMs - 1) }
        : { ...structuredClone(cue), endMs: Math.max(valueMs, cue.startMs + 1) };
    });
    this.applyCueList(cues, [...this.selectedIds]);
  }

  private downloadText(filename: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private pickTimingList(kind: "keyframes" | "timecodes"): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt,.log,.keyframes,.timecodes";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      const times = kind === "keyframes" ? parseKeyframeTimes(text, this.frameRate, this.frameTimes.length ? frame => VideoFrameIndex.timeAtFrame(this.frameTimes, frame, this.frameRate) : undefined) : parseTimecodeFile(text, this.frameRate);
      if (kind === "keyframes") this.keyframesMs = times;
      else this.timecodesMs = times;
      const key = `aegisub-web.recent-${kind}`;
      const recent = JSON.parse(localStorage.getItem(key) ?? "[]") as { name: string; text: string; updatedAt: number }[];
      localStorage.setItem(key, JSON.stringify([{ name: file.name, text, updatedAt: Date.now() }, ...recent.filter((item) => item.name !== file.name)].slice(0, 10)));
      this.toast(`${kind}: ${times.length}`);
    });
    input.click();
  }

  private showRecentTimingLists(kind: "keyframes" | "timecodes"): void {
    const recent = JSON.parse(localStorage.getItem(`aegisub-web.recent-${kind}`) ?? "[]") as { name: string; text: string; updatedAt: number }[];
    const back = document.createElement("div"); back.className = "ad-back";
    const modal = document.createElement("div"); modal.className = "ad-modal";
    const head = document.createElement("div"); head.className = "ad-head";
    const title = document.createElement("h2"); title.textContent = `Recent ${kind}`;
    const close = document.createElement("button"); close.className = "ad-btn"; close.textContent = "×"; close.addEventListener("click", () => back.remove());
    head.append(title, close);
    const body = document.createElement("div"); body.className = "ad-body ad-list";
    if (!recent.length) body.textContent = `No recent ${kind} files in this browser.`;
    for (const item of recent) {
      const button = document.createElement("button"); button.className = "ad-btn"; button.textContent = `${item.name} · ${new Date(item.updatedAt).toLocaleString()}`;
      button.addEventListener("click", () => {
        const times = kind === "keyframes" ? parseKeyframeTimes(item.text, this.frameRate, this.frameTimes.length ? frame => VideoFrameIndex.timeAtFrame(this.frameTimes, frame, this.frameRate) : undefined) : parseTimecodeFile(item.text, this.frameRate);
        if (kind === "keyframes") this.keyframesMs = times; else this.timecodesMs = times;
        this.toast(`${kind}: ${times.length}`); back.remove();
      });
      body.append(button);
    }
    modal.append(head, body); back.append(modal); document.body.append(back);
  }

  private dialogHost(): DialogHost {
    return {
      getDoc: () => this.doc,
      getSelectedIds: () => [...this.selectedIds],
      applyDoc: (doc, message) => this.replaceDocument(doc, message),
      setSelection: (ids) => {
        const valid = ids.filter((id) => this.doc.cues.some((cue) => cue.id === id));
        if (valid.length) this.setSelection(valid, valid.at(-1)!);
      },
      frameRate: () => this.frameRate,
      timecodes: () => this.frameTimes,
      keyframes: () => this.frameKeyframes,
      download: (filename, bytes, mime) => {
        const url = URL.createObjectURL(new Blob(bytes, { type: mime }));
        const anchor = document.createElement("a");
        anchor.href = url; anchor.download = filename; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      renameStyle: (from, to) => {
        for (const cue of this.doc.cues) if (cue.assFields?.Style === from) cue.assFields.Style = to;
      },
    };
  }

  // --- public API ----------------------------------------------------------

  getText(): string {
    return serializeSubtitles(this.doc);
  }
  getDoc(): SubtitleDoc {
    return this.doc;
  }
  cueSnapshot(): Cue[] {
    return this.doc.cues.map((c) => structuredClone(c));
  }
  selectedCueId(): string | null {
    return this.selectedId;
  }
  selectedCueIds(): string[] {
    return [...this.selectedIds];
  }
  selectCueById(cueId: string): void {
    if (!this.doc.cues.some((cue) => cue.id === cueId)) return;
    this.select(cueId);
    this.scrollCueIntoView(cueId);
  }
  loadDocument(input: SubtitleInput): void {
    for (const track of this.tracks) track.job?.run?.cancel();
    const meta = deriveTrackMeta(input.filename);
    const doc = parseSubtitles(input.text, input.filename);
    const id = newTrackId();
    this.tracks = [{ id, label: meta.label, language: meta.language, doc }];
    this.activeTrackId = id;
    this.originalDocs.clear();
    this.originalDocs.set(id, structuredClone(doc));
    this.selectedId = null;
    this.selectedIds.clear();
    this.subtitleFileHandle = null;
    this.refreshForActiveDoc();
    this.renderTrackBar();
    window.clearTimeout(this.histTimer);
    this.histTimer = 0;
    this.history.reset(this.snapshot());
    this.updateHistoryButtons();
    const nextFontSignature = this.currentEmbeddedFontSignature(doc);
    if ((this.mediaFile || this.player?.setSubtitleFonts) && this.video && nextFontSignature !== this.embeddedFontSignature) {
      this.reloadMediaPreservingState(false);
    } else {
      this.pushSubtitles(true);
      this.updateFontWarning();
    }
    const media = this.video;
    if (media?.tagName === "VIDEO") {
      const checkResolution = (): void => {
        if (this.video === media) void this.handleResolutionMismatch(media as HTMLVideoElement);
      };
      if (media.readyState >= 1) checkResolution();
      else media.addEventListener("loadedmetadata", checkResolution, { once: true });
    }
  }
  replaceDocument(doc: SubtitleDoc, message?: string): void {
    const previousFontSignature = this.currentEmbeddedFontSignature();
    const keepIds = [...this.selectedIds].filter((id) => doc.cues.some((cue) => cue.id === id));
    const keepPrimary = this.selectedId && keepIds.includes(this.selectedId) ? this.selectedId : keepIds[0];
    this.doc = structuredClone(doc);
    this.refreshForActiveDoc();
    if (keepPrimary) this.setSelection(keepIds.length ? keepIds : [keepPrimary], keepPrimary);
    this.markDirty();
    this.updateFontWarning();
    if ((this.mediaFile || this.player?.setSubtitleFonts) && this.video && this.currentEmbeddedFontSignature() !== previousFontSignature) {
      this.reloadMediaPreservingState(false);
    }
    if (message) this.toast(message);
  }
  runCommand(command: EditorCommand): void {
    switch (command) {
      case "undo": this.undo(); break;
      case "redo": this.redo(); break;
      case "add-cue": this.addCue(); break;
      case "remove-cue": this.removeCue(); break;
      case "duplicate-cue": this.duplicateCue(); break;
      case "copy-cues": this.copyCues(); break;
      case "paste-cues": this.pasteCuesFromClipboard(); break;
      case "merge-cue": this.mergeCue(); break;
      case "split-cue": this.splitCue(); break;
      case "find-replace": this.toggleFind(); break;
      case "problems": this.toggleProblems(); break;
      case "shift-times": this.shiftTimes(); break;
      case "fix-overlaps": this.fixOverlaps(); break;
      case "aegisub-tools": void this.openAegisubTools(); break;
      case "transcribe": this.openTranscribe(); break;
      case "translate": this.openTranslate(); break;
      case "save": this.save(); break;
      case "save-video": void this.saveIntoVideo(); break;
    }
  }
  runAegisubCommand(command: string): boolean {
    if (this.applyOverrideCommand(command)) return true;
    if (command.startsWith("subtitle/format/")) {
      const format = command.slice("subtitle/format/".length) as SubtitleFormat;
      if (["srt", "vtt", "ass", "sub", "lrc", "ttml", "sbv", "subviewer", "sami", "mpl2", "ytjson", "spruce", "tmp", "csv", "qttext", "dvdsp", "jsonsub", "ttxt"].includes(format)) {
        this.setFormat(format);
        return true;
      }
      return false;
    }
    const selected = new Set(this.selectedIds);
    const selectedIds = [...selected];
    const selectedCue = this.selectedCue();
    const audioRange = this.audioSelection();
    const playhead = this.currentPlayheadMs();
    const frameDuration = this.currentFrameDuration();

    if (command.startsWith("grid/sort/")) {
      const parts = command.split("/");
      const key = parts[2] as GridSortKey;
      if (!["actor", "effect", "end", "layer", "start", "style"].includes(key)) return false;
      this.applyCueList(sortCueGrid(this.doc.cues, key, parts[3] === "selected" ? selected : undefined), selectedIds, `sorted by ${key}`);
      return true;
    }

    switch (command) {
      case "edit/undo": this.undo(); return true;
      case "edit/redo": this.redo(); return true;
      case "edit/find_replace": this.toggleFind(); return true;
      case "edit/line/copy": this.copyCues(); return true;
      case "edit/line/cut": this.copyCues(); this.removeCue(); return true;
      case "edit/line/delete": this.removeCue(); return true;
      case "edit/line/duplicate": this.duplicateCue(); return true;
      case "edit/line/paste": this.pasteCuesFromClipboard(); return true;
      case "edit/line/paste/over": {
        openPasteOverDialog(this.dialogHost(), this.cueClipboard);
        return true;
      }
      case "edit/line/join/concatenate":
      case "edit/line/join/keep_first":
      case "edit/line/join/as_karaoke": {
        const mode = command.endsWith("keep_first") ? "keep-first" : command.endsWith("as_karaoke") ? "karaoke" : "concatenate";
        const joined = joinSelectedCues(this.doc.cues, selected, mode, this.doc.format);
        if (joined) this.applyCueList(joined.cues, [joined.joinedId]);
        return true;
      }
      case "edit/line/recombine": {
        const result = recombineSelectedCues(this.doc.cues, selected);
        this.applyCueList(result.cues, result.selectedIds, "recombined selected lines");
        return true;
      }
      case "edit/line/split/by_karaoke": {
        if (!selectedCue) return true;
        const result = splitCueByKaraoke(this.doc.cues, selectedCue.id);
        if (result) this.applyCueList(result.cues, result.newIds);
        return true;
      }
      case "edit/line/split/estimate":
      case "edit/line/split/preserve":
      case "edit/line/split/video": {
        if (!selectedCue) return true;
        const caret = this.detailTextarea?.selectionStart ?? Math.floor(selectedCue.text.length / 2);
        const mode = command.endsWith("preserve") ? "preserve" : command.endsWith("video") ? "video" : "estimate";
        const result = splitCueAtText(this.doc.cues, selectedCue.id, caret, mode, playhead);
        if (result) this.applyCueList(result.cues, [...result.ids]);
        return true;
      }
      case "edit/line/split/after":
      case "edit/line/split/before": {
        if (!selectedCue) return true;
        const side = command.endsWith("before") ? "before" : "after";
        const result = splitLineAtFrame(this.doc.cues, selectedCue.id, playhead, side, frameDuration);
        if (result) this.applyCueList(result.cues, [...result.ids]);
        return true;
      }
      case "edit/revert":
      case "edit/insert_original": {
        if (!selectedCue) return true;
        const original = this.originalDocs.get(this.activeTrackId)?.cues.find((cue) => cue.id === selectedCue.id)?.text;
        if (original == null) return true;
        if (command === "edit/revert") this.updateCue(selectedCue.id, { text: original });
        else this.wrapCurrentText(original);
        return true;
      }
      case "edit/clear": if (selectedCue) this.updateCue(selectedCue.id, { text: "" }); return true;
      case "edit/clear/text": if (selectedCue) this.updateCue(selectedCue.id, { text: clearCueText(selectedCue.text, true) }); return true;

      case "grid/line/next": this.moveSelection(1); return true;
      case "grid/line/next/create": {
        const index = this.doc.cues.findIndex((cue) => cue.id === this.selectedId);
        if (index === this.doc.cues.length - 1) this.addCue(); else this.moveSelection(1);
        return true;
      }
      case "grid/line/prev": this.moveSelection(-1); return true;
      case "grid/move/up": this.applyCueList(moveSelectedRows(this.doc.cues, selected, "up"), selectedIds); return true;
      case "grid/move/down": this.applyCueList(moveSelectedRows(this.doc.cues, selected, "down"), selectedIds); return true;
      case "grid/swap": {
        const swapped = swapSelectedRows(this.doc.cues, selected);
        if (swapped) this.applyCueList(swapped, selectedIds);
        return true;
      }
      case "grid/tags/show": this.tagDisplayMode = "show"; this.renderWindow(); return true;
      case "grid/tags/hide": this.tagDisplayMode = "hide"; this.renderWindow(); return true;
      case "grid/tags/simplify": this.tagDisplayMode = "simplify"; this.renderWindow(); return true;
      case "grid/tag/cycle_hiding": {
        this.tagDisplayMode = this.tagDisplayMode === "show" ? "simplify" : this.tagDisplayMode === "simplify" ? "hide" : "show";
        this.renderWindow();
        return true;
      }

      case "subtitle/insert/after":
      case "subtitle/insert/before":
      case "subtitle/insert/after/videotime":
      case "subtitle/insert/before/videotime": {
        const before = command.includes("/before");
        const atVideo = command.endsWith("videotime");
        const result = insertCueRelative(this.doc.cues, this.selectedId, before ? "before" : "after", atVideo ? playhead : undefined);
        this.applyCueList(result.cues, [result.id]);
        return true;
      }
      case "subtitle/select/all": {
        if (this.doc.cues.length) this.setSelection(this.doc.cues.map((cue) => cue.id), this.doc.cues.at(-1)!.id);
        return true;
      }
      case "subtitle/select/visible": {
        const ids = this.doc.cues.filter((cue) => playhead >= cue.startMs && playhead < cue.endMs).map((cue) => cue.id);
        if (ids.length) this.setSelection(ids, ids.at(-1)!);
        return true;
      }
      case "subtitle/find": if (!this.findBar) this.toggleFind(); else this.findInput?.focus(); return true;
      case "subtitle/find/next": this.findStep(1); return true;
      case "subtitle/save": this.save(); return true;
      case "subtitle/save/as": void this.saveSubtitles(true); return true;
      case "subtitle/properties": openScriptProperties({ getDoc: () => this.doc, onChange: () => this.markDirty() }); return true;
      case "subtitle/spellcheck": void openSpellchecker({
        getDoc: () => this.doc,
        selectedCueId: () => this.selectedId,
        updateCue: (id, text) => this.updateCue(id, { text }),
        selectCue: (id) => this.selectCueById(id),
      }).catch((error) => this.toast(error instanceof Error ? error.message : String(error))); return true;
      case "subtitle/attachment": void this.openAegisubTools("ass"); return true;

      case "time/continuous/start": this.applyCueList(setContinuousTiming(this.doc.cues, selected, "start"), selectedIds); return true;
      case "time/continuous/end": this.applyCueList(setContinuousTiming(this.doc.cues, selected, "end"), selectedIds); return true;
      case "time/frame/current": this.applyCueList(shiftSelectionToTime(this.doc.cues, selected, playhead), selectedIds); return true;
      case "time/snap/start_video": if (this.video) this.setSelectedEdges("start", this.videoBoundaryTime("start")); return true;
      case "time/snap/end_video": if (this.video) this.setSelectedEdges("end", this.videoBoundaryTime("end")); return true;
      case "time/snap/scene": this.applyCueList(snapSelectedToScene(this.doc.cues, selected, this.frameKeyframes, playhead), selectedIds); return true;
      case "time/lead/in": this.adjustAudioTiming(-this.audioLead("in"), 0); return true;
      case "time/lead/out": this.adjustAudioTiming(0, this.audioLead("out")); return true;
      case "time/lead/both": this.adjustAudioTiming(-this.audioLead("in"), this.audioLead("out")); return true;
      case "time/start/increase": this.adjustAudioTiming(10, 0); return true;
      case "time/start/decrease": this.adjustAudioTiming(-10, 0); return true;
      case "time/length/increase":
      case "time/length/increase/shift": this.adjustAudioTiming(0, 10); return true;
      case "time/length/decrease":
      case "time/length/decrease/shift": this.adjustAudioTiming(0, -10); return true;
      case "time/next": this.moveSelection(1); return true;
      case "time/prev": this.moveSelection(-1); return true;
      case "time/shift": openShiftTimesDialog(this.dialogHost()); return true;

      case "keyframe/open": this.pickTimingList("keyframes"); return true;
      case "keyframe/close": this.keyframesMs = []; this.toast("keyframes closed"); return true;
      case "keyframe/save": this.downloadText("keyframes.txt", `# keyframe format v1\nfps ${this.frameRate}\n${this.frameKeyframes.map((time) => this.frameAtMs(time)).join("\n")}\n`); return true;
      case "timecode/open": this.pickTimingList("timecodes"); return true;
      case "timecode/close": this.timecodesMs = []; this.toast("timecodes closed"); return true;
      case "timecode/save": this.downloadText("timecodes.txt", `# timecode format v2\n${this.frameTimes.map((time) => time.toFixed(3)).join("\n")}\n`); return true;
      case "recent/keyframes/": this.showRecentTimingLists("keyframes"); return true;
      case "recent/timecodes/": this.showRecentTimingLists("timecodes"); return true;

      case "tool/style/overlap_check": {
        const overlaps = findStyleOverlaps(this.doc.cues);
        if (overlaps.length) this.setSelection([overlaps[0].firstId, overlaps[0].secondId], overlaps[0].secondId);
        this.toast(overlaps.length ? `${overlaps.length} style overlap(s)` : "No style overlaps.");
        return true;
      }
      case "tool/text/cleanup":
      case "tool/text/chinese_convert":
      case "tool/text/pair_check":
      case "tool/text/furigana": void this.openAegisubTools("language"); return true;
      case "tool/time/fix_common_errors": void this.openAegisubTools("qa"); return true;
      case "tool/time/stitch": void this.openAegisubTools("timing"); return true;
      case "tool/lyrics_scroll":
      case "tool/resampleres":
      case "tool/font_collector": void this.openAegisubTools("ass"); return true;
      case "am/manager":
      case "am/meta": void this.openAegisubTools("automation"); return true;
      case "am/reload": void this.runStoredAutomations(false); return true;
      case "am/reload/autoload": void this.runStoredAutomations(true); return true;
      case "tool/line/select": openSelectLinesDialog(this.dialogHost()); return true;
      case "tool/time/postprocess": openTimingPostProcessorDialog(this.dialogHost()); return true;
      case "tool/export": openExportDialog(this.dialogHost()); return true;
      case "tool/style/manager": this.video?.pause(); this.audio.stop(); openStyleManagerDialog(this.dialogHost()); return true;
      case "tool/time/kanji": openKanjiTimer({
        getDoc: () => this.doc,
        updateCue: (id, text) => this.updateCue(id, { text }),
        selectCue: (id) => this.selectCueById(id),
      }); return true;
      case "tool/ai/analysis_settings": openAIAnalysisSettings(() => this.renderDetail()); return true;
      case "tool/style/assistant": {
        this.assistant?.close();
        this.assistant = openStylingAssistant({
          getDoc: () => this.doc,
          selectedCueId: () => this.selectedId,
          updateCue: (id, patch) => this.updateCue(id, patch),
          selectCue: (id) => this.selectCueById(id),
          runCommand: (command) => this.runAegisubCommand(command),
        });
        return true;
      }
      case "tool/styling_assistant/commit": if (this.assistant?.kind === "styling") this.assistant.commit(); return true;
      case "tool/styling_assistant/preview": if (this.assistant?.kind === "styling") this.assistant.preview(); return true;
      case "tool/translation_assistant": {
        this.assistant?.close();
        this.assistant = openTranslationAssistant({
          getDoc: () => this.doc,
          selectedCueId: () => this.selectedId,
          updateCue: (id, patch) => this.updateCue(id, patch),
          selectCue: (id) => this.selectCueById(id),
          runCommand: (command) => this.runAegisubCommand(command),
        });
        return true;
      }
      case "tool/translation_assistant/commit": if (this.assistant?.kind === "translation") this.assistant.commit(); return true;
      case "tool/translation_assistant/preview": if (this.assistant?.kind === "translation") this.assistant.preview(); return true;
      case "tool/translation_assistant/next": if (this.assistant?.kind === "translation") this.assistant.next(); return true;
      case "tool/translation_assistant/prev": if (this.assistant?.kind === "translation") this.assistant.prev(); return true;
      case "tool/translation_assistant/insert_original": if (this.assistant?.kind === "translation") this.assistant.insertOriginal(); return true;

      case "audio/close": this.closeAudio(); return true;
      case "audio/open": this.pickAudio(); return true;
      case "audio/open/blank": void this.openDummyMedia("blank"); return true;
      case "audio/open/noise": void this.openDummyMedia("noise"); return true;
      case "audio/open/video": this.setMobilePane("audio"); if (this.mediaFile) void this.loadAudio(this.mediaFile, true); else this.toast("请先打开视频。"); return true;
      case "audio/view/spectrum": void this.showAudioView("spectrum"); return true;
      case "audio/view/waveform": void this.showAudioView("waveform"); return true;
      case "audio/save/clip": void this.saveSelectedAudioClip(); return true;
      case "audio/play/line":
        if (selectedCue) this.playAudioRange(this.doc.format === "ass" ? assTimeMilliseconds(selectedCue.startMs) : selectedCue.startMs, this.doc.format === "ass" ? assTimeMilliseconds(selectedCue.endMs) : selectedCue.endMs); return true;
      case "audio/play/current":
        if (audioRange) this.playAudioRange(audioRange.startMs, audioRange.endMs); return true;
      case "audio/play/toggle":
        if (this.audio.playing) { this.runAegisubCommand("audio/stop"); return true; }
        // Falls through to the active selection, as the desktop B command does.
      case "audio/play/selection":
        if (audioRange) this.playAudioRange(audioRange.startMs, () => this.audioSelection()?.endMs ?? audioRange.endMs); return true;
      case "audio/play/selection/before": if (audioRange) this.playAudioRange(Math.max(0, audioRange.startMs - 500), audioRange.startMs); return true;
      case "audio/play/selection/after": if (audioRange) this.playAudioRange(audioRange.endMs, audioRange.endMs + 500); return true;
      case "audio/play/selection/end": if (audioRange) this.playAudioRange(Math.max(audioRange.startMs, audioRange.endMs - 500), audioRange.endMs); return true;
      case "audio/play/selection/begin": if (audioRange) this.playAudioRange(audioRange.startMs, Math.min(audioRange.endMs, audioRange.startMs + 500)); return true;
      case "audio/play/to_end": if (audioRange) this.playAudioRange(audioRange.startMs, this.audio.duration * 1000); return true;
      case "audio/commit": this.commitAudioTiming(localStorage.getItem("aegisub-web.audio-autonext") !== "false"); return true;
      case "audio/commit/stay": this.commitAudioTiming(false); return true;
      case "audio/commit/next": this.commitAudioTiming(true); return true;
      case "audio/commit/default": this.commitAudioTiming(true, true); return true;
      case "audio/go_to": if (audioRange) this.timeline?.showRange(audioRange.startMs / 1000, audioRange.endMs / 1000); return true;
      case "audio/go_to/start": if (audioRange) this.timeline?.centerOn(audioRange.startMs / 1000); return true;
      case "audio/go_to/end": if (audioRange) this.timeline?.centerOn(audioRange.endMs / 1000); return true;
      case "audio/scroll/left": this.timeline?.panPixels(-128); return true;
      case "audio/scroll/right": this.timeline?.panPixels(128); return true;
      case "audio/zoom/in": this.timeline?.zoomBy(1.25); return true;
      case "audio/zoom/out": this.timeline?.zoomBy(.8); return true;
      case "audio/stop": if (this.audio.usesNativeVideoAudio) this.video?.pause(); this.audio.stop(); return true;
      case "video/stop": if (this.video) this.stopAndSeek(this.video.currentTime * 1000); return true;
      case "audio/playback/speed/increase": this.setPlaybackRate(this.getPlaybackRate() + 0.05); return true;
      case "audio/playback/speed/decrease": this.setPlaybackRate(this.getPlaybackRate() - 0.05); return true;
      case "audio/opt/autoscroll":
      case "audio/opt/autocommit":
      case "audio/opt/autonext": {
        const key = `audio-${command.slice("audio/opt/".length)}`;
        const raw = localStorage.getItem(`aegisub-web.${key}`);
        const enabled = !(raw === null ? key !== "audio-autocommit" : raw === "true");
        localStorage.setItem(`aegisub-web.${key}`, String(enabled));
        const control = this.root.querySelector<HTMLButtonElement>(`[data-audio-option="${key}"]`);
        control?.classList.toggle("on", enabled); control?.setAttribute("aria-pressed", String(enabled));
        return true;
      }
      case "audio/opt/vertical_link": this.audioAdjustments?.toggleLink(); return true;
      case "audio/options": openAudioTimingOptions(() => this.timeline?.render()); return true;
      case "audio/opt/spectrum": void this.showAudioView(this.audioViewMode === "spectrum" ? "waveform" : "spectrum"); return true;
      case "audio/karaoke": {
        this.setMobilePane("audio");
        if (selectedCue) openKaraoke(selectedCue, this.audio.element, this.wavePeaks, this.cueColorHex(selectedCue, "2c", "SecondaryColour"), (text) => this.updateCue(selectedCue.id, { text }));
        return true;
      }

      case "video/close": this.closeMedia(); return true;
      case "video/open": this.pickVideo(); return true;
      case "subtitle/open/video": {
        if (!this.mediaFile) { this.toast("请先打开视频。"); return true; }
        const file = this.mediaFile;
        if (file.size > 512 * 1024 * 1024) { this.toast("当前内嵌字幕提取器最多读取 512 MiB；请先提取字幕文件后打开。"); return true; }
        void file.arrayBuffer().then(bytes => { if (this.mediaFile === file) this.loadEmbeddedTracks(new Uint8Array(bytes)); }).catch(error => this.toast(String(error)));
        return true;
      }
      case "video/decoder/auto":
      case "video/decoder/compatibility": {
        localStorage.setItem("aegisub-web.video-decoder", command.endsWith("compatibility") ? "compatibility" : "auto");
        if (this.mediaFile && this.video) void this.loadVideo(this.mediaFile, { restoreTime: this.video.currentTime, restorePaused: this.video.paused, scanEmbedded: false, preserveView: true });
        return true;
      }
      case "video/open/dummy": void this.openDummyMedia("video"); return true;
      case "video/play": this.setMobilePane("video"); this.audio.prepareOutput(); if (this.video) void this.video.play().catch(() => {}); return true;
      case "video/play/line": this.setMobilePane("video"); this.playFromSelected(); return true;
      case "video/jump/start": if (selectedCue) this.seekTo(selectedCue.startMs); return true;
      case "video/jump/end": if (selectedCue) this.seekTo(selectedCue.endMs); return true;
      case "video/jump": {
        const answer = prompt("Jump to time in seconds:", String((this.video?.currentTime ?? 0).toFixed(3)));
        if (answer != null && Number.isFinite(Number(answer))) this.seekTo(Number(answer) * 1000);
        return true;
      }
      case "video/frame/next": this.seekVideoFrame(1); return true;
      case "video/frame/prev": this.seekVideoFrame(-1); return true;
      case "video/frame/next/large": this.seekTo(playhead + 5000); return true;
      case "video/frame/prev/large": this.seekTo(Math.max(0, playhead - 5000)); return true;
      case "video/frame/next/boundary": {
        const next = this.doc.cues.flatMap((cue) => [cue.startMs, cue.endMs]).sort((a, b) => a - b).find((time) => time > playhead + 1);
        if (next != null) this.seekTo(next);
        return true;
      }
      case "video/frame/prev/boundary": {
        const previous = this.doc.cues.flatMap((cue) => [cue.startMs, cue.endMs]).sort((a, b) => b - a).find((time) => time < playhead - 1);
        if (previous != null) this.seekTo(previous);
        return true;
      }
      case "video/frame/next/keyframe": {
        const next = this.frameKeyframes.find((time) => time > playhead + 1); if (next != null) this.stopAndSeek(next); return true;
      }
      case "video/frame/prev/keyframe": {
        const previous = [...this.frameKeyframes].reverse().find((time) => time < playhead - 1); if (previous != null) this.stopAndSeek(previous); return true;
      }
      case "video/frame/copy": void this.captureVideoFrame("with-subs", true); return true;
      case "video/frame/copy/raw": void this.captureVideoFrame("raw", true); return true;
      case "video/frame/copy/subs": void this.captureVideoFrame("subs", true); return true;
      case "video/frame/save": void this.captureVideoFrame("with-subs", false); return true;
      case "video/frame/save/raw": void this.captureVideoFrame("raw", false); return true;
      case "video/frame/save/subs": void this.captureVideoFrame("subs", false); return true;
      case "video/copy_coordinates": {
        const point = this.lastVideoPointer ?? { x: Math.round(getPlayRes(this.doc).x / 2), y: Math.round(getPlayRes(this.doc).y / 2) };
        void navigator.clipboard?.writeText(`${point.x},${point.y}`);
        this.toast(`${point.x},${point.y}`);
        return true;
      }
      case "video/focus_seek": this.video?.focus(); return true;
      case "video/opt/autoscroll": this.toggleFollow(); return true;
      case "video/show_overscan": this.toggleOverscan(); return true;
      case "video/tool/cross": this.setMobilePane("video"); this.activateVideoTool(command); if (selectedCue) this.togglePosition(selectedCue); return true;
      case "video/tool/clip": this.setMobilePane("video"); this.activateVideoTool(command); if (selectedCue) this.toggleClip(selectedCue); return true;
      case "video/tool/vector_clip": this.setMobilePane("video"); this.activateVideoTool(command); this.openVectorClipMode("drag"); return true;
      case "video/tool/vclip/drag": this.setMobilePane("video"); this.openVectorClipMode("drag"); return true;
      case "video/tool/vclip/line": this.setMobilePane("video"); this.openVectorClipMode("line"); return true;
      case "video/tool/vclip/bicubic": this.setMobilePane("video"); this.openVectorClipMode("bicubic"); return true;
      case "video/tool/vclip/freehand": this.setMobilePane("video"); this.openVectorClipMode("freehand"); return true;
      case "video/tool/vclip/freehand_smooth": this.setMobilePane("video"); this.openVectorClipMode("freehand-smooth"); return true;
      case "video/tool/vclip/convert": this.vectorClip?.convert(); return true;
      case "video/tool/vclip/insert": this.vectorClip?.insert(); return true;
      case "video/tool/vclip/remove": this.vectorClip?.remove(); return true;
      case "video/tool/drag": this.setMobilePane("video"); this.activateVideoTool(command); if (selectedCue) this.togglePosition(selectedCue); return true;
      case "video/tool/rotate/z": this.setMobilePane("video"); this.activateVideoTool(command); this.openVisualTransform("rotate-z"); return true;
      case "video/tool/rotate/xy": this.setMobilePane("video"); this.activateVideoTool(command); this.openVisualTransform("rotate-xy"); return true;
      case "video/tool/scale": this.setMobilePane("video"); this.activateVideoTool(command); this.openVisualTransform("scale"); return true;
      case "video/detach": {
        const candidate = this.video as HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> };
        if (candidate?.requestPictureInPicture) void candidate.requestPictureInPicture().catch(() => {});
        else this.toast("Picture-in-Picture is unavailable in this browser.");
        return true;
      }
      case "video/details": {
        if (!this.video) this.toast("No video loaded.");
        else openVideoDetails(this.mediaFile ?? { name: this.root.dataset.mediaName ?? "空白视频", size: 0, type: "virtual/canvas" }, this.video, this.frameRate);
        return true;
      }
      case "video/subtitles_provider/cycle":
        this.toast("The web build uses the bundled libass WebAssembly renderer; no second browser-safe provider is available.");
        return true;
      case "video/aspect/default": this.setVideoAspect(null); return true;
      case "video/aspect/full": this.setVideoAspect(4 / 3); return true;
      case "video/aspect/wide": this.setVideoAspect(16 / 9); return true;
      case "video/aspect/cinematic": this.setVideoAspect(2.35); return true;
      case "video/aspect/custom": {
        const aspect = prompt("Aspect ratio (for example 16 / 9):", "16 / 9");
        const match = aspect?.match(/^\s*(\d+(?:\.\d+)?)\s*(?:\/|:)\s*(\d+(?:\.\d+)?)\s*$/);
        if (match && Number(match[2]) > 0) this.setVideoAspect(Number(match[1]) / Number(match[2]));
        return true;
      }
      case "video/zoom/50": this.setVideoZoom(.5); return true;
      case "video/zoom/100": this.setVideoZoom(1); return true;
      case "video/zoom/200": this.setVideoZoom(2); return true;
      case "video/zoom/in": this.setVideoZoom(this.videoZoom * 1.25); return true;
      case "video/zoom/out": this.setVideoZoom(this.videoZoom / 1.25); return true;
      case "video/reset_pan": this.resetVideoView(); return true;

      case "app/display/full": this.root.dataset.displayMode = "full"; return true;
      case "app/display/audio_subs": this.root.dataset.displayMode = "audio-subs"; this.setMobilePane("audio"); return true;
      case "app/display/video_subs": this.root.dataset.displayMode = "video-subs"; this.setMobilePane("video"); return true;
      case "app/display/subs": this.root.dataset.displayMode = "subs"; this.setMobilePane("subtitles"); return true;
      case "app/toggle/toolbar":
        this.root.classList.toggle("se-toolbar-hidden");
        this.root.dispatchEvent(new CustomEvent("aegisub-toolbar-toggle", { bubbles: true }));
        return true;
      case "app/about": document.getElementById("about")?.showPopover(); return true;
      default: return this.opts.onAegisubCommand?.(command) ?? false;
    }
  }
  setPlaybackRate(rate: number): void {
    if (!Number.isFinite(rate)) return;
    const clamped = Math.max(0.25, Math.min(4, rate));
    if (this.video) {
      this.video.playbackRate = clamped;
      this.video.preservesPitch = true;
    }
    if (this.audio.element) {
      this.audio.element.playbackRate = clamped;
      this.audio.element.preservesPitch = true;
    }
    localStorage.setItem("aegisub-web.playback-rate", String(clamped));
  }
  getPlaybackRate(): number {
    const stored = Number(localStorage.getItem("aegisub-web.playback-rate"));
    return this.video?.playbackRate ?? (Number.isFinite(stored) && stored > 0 ? stored : 1);
  }
  /** Told what changed besides the cues, while a session wants to know. */
  private docFieldsReporter: ((fields: { key: string; value: string }[]) => void) | null = null;
  private lastDocFieldsSig: string | null = null;
  private applyingRemoteDocFields = false;

  docFields(): { key: string; value: string }[] {
    const doc = this.doc;
    const out: { key: string; value: string }[] = [
      { key: "format", value: doc.format },
      { key: "eol", value: doc.eol },
      { key: "bom", value: String(doc.bom) },
      { key: "finalNewline", value: String(doc.finalNewline) },
      { key: "header", value: doc.header ?? "" },
      { key: "trailingNotes", value: doc.trailingNotes ?? "" },
      { key: "assScriptInfo", value: doc.assScriptInfo ?? "" },
      { key: "assStylesTail", value: doc.assStylesTail ?? "" },
      { key: "assStyleFormat", value: JSON.stringify(doc.assStyleFormat ?? []) },
      { key: "assFormat", value: JSON.stringify(doc.assFormat ?? []) },
      { key: "fps", value: doc.fps == null ? "" : String(doc.fps) },
    ];
    // One entry per style, keyed by its name, so two people editing different styles both
    // keep their edit. A single blob would lose one of the two.
    for (const style of doc.styles ?? []) {
      out.push({ key: `style:${style.name ?? ""}`, value: JSON.stringify(style) });
    }
    // Tracks travel by label and language only: the cues of a track nobody is looking at
    // are a whole document of their own, and sharing every one of them would multiply the
    // session by the number of translations open.
    for (const track of this.tracks) {
      out.push({ key: `track:${track.id}`, value: JSON.stringify({ label: track.label, language: track.language }) });
    }
    return out;
  }

  setDocFieldsReporter(handler: ((fields: { key: string; value: string }[]) => void) | null): void {
    this.docFieldsReporter = handler;
    this.lastDocFieldsSig = handler ? JSON.stringify(this.docFields()) : null;
  }

  /** Report what changed beside the cues, if anything did. */
  private reportDocFields(): void {
    if (!this.docFieldsReporter) return;
    const fields = this.docFields();
    const sig = JSON.stringify(fields);
    if (sig === this.lastDocFieldsSig) return;
    this.lastDocFieldsSig = sig;
    if (this.applyingRemoteDocFields) return;
    this.docFieldsReporter(fields);
  }

  applyRemoteDocFields(fields: { key: string; value: string }[]): void {
    this.applyingRemoteDocFields = true;
    try {
      const doc = this.doc;
      let touched = false;
      for (const { key, value } of fields) {
        if (key.startsWith("style:")) {
          const name = key.slice("style:".length);
          try {
            const style = JSON.parse(value) as NonNullable<SubtitleDoc["styles"]>[number];
            const list = (doc.styles ??= []);
            const at = list.findIndex((s2) => (s2.name ?? "") === name);
            if (at >= 0) list[at] = style;
            else list.push(style);
            touched = true;
          } catch {
            /* unreadable style; leave what is there */
          }
          continue;
        }
        if (key.startsWith("track:")) {
          const id = key.slice("track:".length);
          const track = this.tracks.find((t) => t.id === id);
          if (!track) continue; // a track this peer does not have: its cues are not here
          try {
            const meta = JSON.parse(value) as { label: string; language: string };
            if (track.label !== meta.label || track.language !== meta.language) {
              track.label = meta.label;
              track.language = meta.language;
              touched = true;
            }
          } catch {
            /* unreadable */
          }
          continue;
        }
        switch (key) {
          case "format": doc.format = value as SubtitleDoc["format"]; touched = true; break;
          case "eol": doc.eol = value === "\r\n" ? "\r\n" : "\n"; touched = true; break;
          case "bom": doc.bom = value === "true"; touched = true; break;
          case "finalNewline": doc.finalNewline = value === "true"; touched = true; break;
          case "header": doc.header = value || undefined; touched = true; break;
          case "trailingNotes": doc.trailingNotes = value || undefined; touched = true; break;
          case "assScriptInfo": doc.assScriptInfo = value || undefined; touched = true; break;
          case "assStylesTail": doc.assStylesTail = value || undefined; touched = true; break;
          case "assStyleFormat": try { doc.assStyleFormat = JSON.parse(value) as string[]; touched = true; } catch { /* keep */ } break;
          case "assFormat": try { doc.assFormat = JSON.parse(value) as string[]; touched = true; } catch { /* keep */ } break;
          case "fps": doc.fps = value === "" ? undefined : Number(value); touched = true; break;
          default: break;
        }
      }
      if (touched) {
        // Through the same path a local change takes, so the flag above is the only thing
        // stopping the echo. Resyncing the signature by hand here instead would work today
        // and leave that guard unreachable, which is how it stops working later.
        this.reportDocFields();
        this.renderTrackBar();
        this.pushSubtitles();
      }
    } finally {
      this.applyingRemoteDocFields = false;
    }
  }

  applyRemoteCues(cues: Cue[]): void {
    const keepId = this.selectedId;
    this.doc.cues = cues.map((c) => structuredClone(c));

    // Rebuild rather than patch: a remote edit may have inserted, removed or reordered
    // cues, and the row cache is keyed by index.
    this.rows.clear();
    this.innerEl.textContent = "";
    this.renderList();

    const stillThere = keepId && this.doc.cues.some((c) => c.id === keepId);
    if (stillThere) this.select(keepId);
    else if (this.doc.cues.length) this.select(this.doc.cues[0].id);
    else this.renderDetail();

    this.countEl.textContent = t("cueCount", { n: this.doc.cues.length });
    this.pushSubtitles(); // the preview must follow, or it shows a stale burn-in

    // Without a host owning undo, the local stack now holds snapshots that predate this
    // remote edit, so one undo would quietly revert someone else's work. Dropping the
    // stack costs this peer its undo and is the safe direction to be wrong in; a session
    // installs an undo handler and keeps proper per-peer undo instead.
    if (!this.undoHandler) {
      window.clearTimeout(this.histTimer);
      this.histTimer = 0;
      this.history.reset(this.snapshot());
      this.updateHistoryButtons();
    }
  }

  setUndoHandler(handler: UndoHandler | null): void {
    this.undoHandler = handler;
    this.updateHistoryButtons();
  }
  loadPreviewMedia(file: File): void {
    void this.loadVideo(file);
  }
  focus(): void {
    this.root.focus();
  }
  destroy(): void {
    this.mediaLoadGeneration += 1;
    this.frameIndexAbort?.abort();
    this.assistant?.close();
    this.assistant = null;
    this.contextMenu?.remove();
    this.contextMenu = null;
    if (this.contextMenuClose) document.removeEventListener("pointerdown", this.contextMenuClose, true);
    this.contextMenuClose = null;
    this.vectorClip?.close();
    this.vectorClip = null;
    this.spectrumCancel?.();
    this.spectrumCancel = null;
    window.clearTimeout(this.subtitleTimer);
    cancelAnimationFrame(this.subtitleFrameRaf);
    cancelAnimationFrame(this.timingPreviewRaf);
    window.clearTimeout(this.toastTimer);
    window.clearTimeout(this.histTimer);
    this.tbObserver?.disconnect();
    if (this.tbOnDocClick) document.removeEventListener("click", this.tbOnDocClick);
    document.removeEventListener("keydown", this.onShellKeydown, true);
    document.removeEventListener("keydown", this.onPosKey, true);
    document.removeEventListener("keydown", this.onClipKey, true);
    document.removeEventListener("keydown", this.onDrawKey, true);
    this.waveAbort?.abort();
    this.clearPlaybackRuntime();
    this.audioExportAbort?.abort();
    this.mediaFile = null;
    this.audioLoadGeneration++;
    this.audio.destroy();
    this.decodedMono16k = null;
    this.wavePeaks = null;
    this.timeline?.destroy();
    this.timeline = null;
    this.root.remove();
  }
}

type GridColumnKey = "num" | "layer" | "start" | "end" | "cps" | "style" | "actor" | "effect" | "margin-l" | "margin-r" | "margin-v" | "text";

function el(tag: string, className = "", text = ""): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function createSubtitleEditor(
  container: HTMLElement,
  input: SubtitleInput,
  opts: SubtitleEditorOptions = {},
): SubtitleEditorHandle {
  return new SubtitleEditor(container, input, opts);
}

// newCueId is re-exported for hosts that build cues headlessly.
export { newCueId };
