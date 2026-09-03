import { type AssStyle, type Cue, type SubtitleDoc, type SubtitleFormat } from "./cue";
import { convertDoc, serializeSubtitles } from "./formats";
import { makeDefaultStyle, uniqueStyleName } from "./formats/ass";
import { openStyleEditor } from "./styles-editor";
import { DEFAULT_EBU_STL_OPTIONS, encodeEbuStl } from "./formats/ebustl";
import { exportPlainText } from "./formats/plaintext";
import { serializeEncore, serializeSsa, serializeTranStation } from "./formats/legacy-export";
import {
  cleanupSubtitleText,
  fixCommonErrors,
  resampleAssDocument,
} from "./aegisub-tools";
import {
  pasteOverCues,
  postProcessTiming,
  selectCueIds,
  shiftCueTimes,
  type PasteOverFields,
  type SelectCriteria,
  type ShiftTimesOptions,
  type TimingPostProcessOptions,
} from "./aegisub-operations";

export interface DialogHost {
  getDoc(): SubtitleDoc;
  getSelectedIds(): string[];
  applyDoc(doc: SubtitleDoc, message: string): void;
  setSelection(ids: string[]): void;
  frameRate(): number;
  timecodes(): readonly number[];
  keyframes(): readonly number[];
  download(filename: string, bytes: BlobPart[], mime: string): void;
  renameStyle(from: string, to: string): void;
}

const STYLE_ID = "aegisub-web-dialogs-style";
function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.ad-back{position:fixed;inset:0;z-index:1650;background:rgba(0,0,0,.58);display:grid;place-items:center;padding:16px}.ad-modal{width:min(760px,100%);max-height:calc(100dvh - 32px);overflow:auto;background:var(--se-bg,#1d2025);color:var(--se-fg,#e9ebef);border:1px solid var(--se-border,#373b44);border-radius:12px;box-shadow:0 24px 70px rgba(0,0,0,.45)}
.ad-head,.ad-foot{display:flex;align-items:center;gap:8px;padding:11px 14px;background:var(--se-head,#24272d);border-bottom:1px solid var(--se-border,#373b44)}.ad-foot{border-top:1px solid var(--se-border,#373b44);border-bottom:0;justify-content:flex-end}.ad-head h2{font-size:15px;margin:0;flex:1}.ad-body{padding:14px;display:grid;gap:12px}.ad-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.ad-grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}.ad-field{display:grid;gap:5px;font-size:11px;color:var(--se-muted,#9aa2ae)}.ad-check{display:flex;gap:7px;align-items:center;font-size:12px}.ad-group{display:grid;gap:8px;padding:10px;border:1px solid var(--se-border,#373b44);border-radius:8px}.ad-group h3{font-size:12px;margin:0}.ad-modal input,.ad-modal select,.ad-modal textarea{box-sizing:border-box;width:100%;font:inherit;padding:7px;border:1px solid var(--se-border,#373b44);border-radius:6px;background:var(--se-bg,#1d2025);color:inherit}.ad-btn{font:inherit;padding:7px 11px;border:1px solid var(--se-border,#373b44);border-radius:7px;background:var(--se-head,#24272d);color:inherit;cursor:pointer}.ad-btn.primary{background:var(--se-accent,#2563eb);border-color:var(--se-accent,#2563eb);color:#fff}.ad-list{display:flex;flex-direction:column;gap:5px;max-height:310px;overflow:auto}.ad-list button{text-align:left}.ad-row{display:flex;gap:8px;align-items:center}.ad-row>*{flex:1}.ad-quick{display:flex;gap:5px;flex-wrap:wrap}.ad-status{font-size:11px;color:var(--se-muted,#9aa2ae)}
@media(max-width:640px){.ad-back{padding:0}.ad-modal{height:100dvh;max-height:none;border-radius:0}.ad-grid,.ad-grid.three{grid-template-columns:1fr}}
`;
  document.head.append(style);
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (text) value.textContent = text;
  return value;
}

function button(label: string, action: () => void, primary = false): HTMLButtonElement {
  const value = element("button", `ad-btn${primary ? " primary" : ""}`, label);
  value.type = "button";
  value.addEventListener("click", action);
  return value;
}

function modal(title: string): { body: HTMLDivElement; foot: HTMLDivElement; close(): void } {
  injectStyles();
  const back = element("div", "ad-back");
  const panel = element("div", "ad-modal");
  const head = element("div", "ad-head");
  const body = element("div", "ad-body");
  const foot = element("div", "ad-foot");
  const close = (): void => back.remove();
  head.append(element("h2", "", title), button("×", close));
  panel.append(head, body, foot);
  back.append(panel);
  back.addEventListener("mousedown", (event) => { if (event.target === back) close(); });
  document.body.append(back);
  return { body, foot, close };
}

function field(label: string, input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): HTMLLabelElement {
  const value = element("label", "ad-field");
  value.append(document.createTextNode(label), input);
  return value;
}

function check(label: string, checked = false): { label: HTMLLabelElement; input: HTMLInputElement } {
  const input = element("input");
  input.type = "checkbox";
  input.checked = checked;
  const value = element("label", "ad-check");
  value.append(input, document.createTextNode(label));
  return { label: value, input };
}

function select(options: [string, string][], value?: string): HTMLSelectElement {
  const control = element("select");
  for (const [id, label] of options) control.append(new Option(label, id));
  if (value != null) control.value = value;
  return control;
}

function numberInput(value: number, min?: number, max?: number): HTMLInputElement {
  const input = element("input");
  input.type = "number";
  input.value = String(value);
  if (min != null) input.min = String(min);
  if (max != null) input.max = String(max);
  return input;
}

const PASTE_FIELDS: [keyof PasteOverFields, string][] = [
  ["comment", "Comment"], ["layer", "Layer"], ["start", "Start Time"], ["end", "End Time"],
  ["style", "Style"], ["actor", "Actor"], ["marginLeft", "Margin Left"], ["marginRight", "Margin Right"],
  ["marginVertical", "Margin Vertical"], ["effect", "Effect"], ["text", "Text"],
];

export function openPasteOverDialog(host: DialogHost, clipboard: readonly Cue[]): void {
  const ui = modal("Select Fields to Paste Over");
  const selected = new Set(host.getSelectedIds());
  const saved = JSON.parse(localStorage.getItem("aegisub-web.paste-over-fields") ?? "{}") as PasteOverFields;
  const checks = new Map<keyof PasteOverFields, HTMLInputElement>();
  const grid = element("div", "ad-grid");
  for (const [key, label] of PASTE_FIELDS) {
    const item = check(label, saved[key] ?? false);
    checks.set(key, item.input);
    grid.append(item.label);
  }
  const quick = element("div", "ad-quick");
  const set = (keys: (keyof PasteOverFields)[]): void => { for (const [key, input] of checks) input.checked = keys.includes(key); };
  quick.append(button("All", () => set(PASTE_FIELDS.map(([key]) => key))), button("None", () => set([])), button("Times", () => set(["start", "end"])), button("Text", () => set(["text"])));
  ui.body.append(grid, quick);
  ui.foot.append(button("Cancel", ui.close), button("Paste Over", () => {
    const fields: PasteOverFields = {};
    for (const [key, input] of checks) fields[key] = input.checked;
    localStorage.setItem("aegisub-web.paste-over-fields", JSON.stringify(fields));
    host.applyDoc({ ...structuredClone(host.getDoc()), cues: pasteOverCues(host.getDoc().cues, [...selected], clipboard, fields) }, "Pasted selected fields");
    ui.close();
  }, true));
}

function parseTimeAmount(value: string): number {
  const plain = Number(value);
  if (Number.isFinite(plain)) return plain;
  const match = value.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!match) return 0;
  return (((Number(match[1] ?? 0) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000) + Number((match[4] ?? "0").padEnd(3, "0"));
}

export function openShiftTimesDialog(host: DialogHost): void {
  const ui = modal("Shift Times / 平移时间");
  const amount = element("input"); amount.value = "0";
  const unit = select([["milliseconds", "Time (ms or h:mm:ss.ms)"], ["frames", "Frames"]]);
  const direction = select([["forward", "Forward / 向后"], ["backward", "Backward / 向前"]]);
  const scope = select([["all", "All rows"], ["selected", "Selected rows"], ["onward", "Selection onward"]], host.getSelectedIds().length ? "selected" : "all");
  const fields = select([["both", "Start and End"], ["start", "Start only"], ["end", "End only"]]);
  const grid = element("div", "ad-grid");
  grid.append(field("Amount", amount), field("Unit", unit), field("Direction", direction), field("Affect", scope), field("Times", fields));
  const historyList = element("div", "ad-list");
  const history = JSON.parse(localStorage.getItem("aegisub-web.shift-history") ?? "[]") as ShiftTimesOptions[];
  for (const entry of history.slice(0, 12)) historyList.append(button(`${entry.amount} ${entry.unit} · ${entry.direction} · ${entry.scope} · ${entry.fields}`, () => {
    amount.value = String(entry.amount); unit.value = entry.unit; direction.value = entry.direction; scope.value = entry.scope; fields.value = entry.fields;
  }));
  ui.body.append(grid, element("h3", "", "History"), historyList);
  ui.foot.append(button("Cancel", ui.close), button("Shift", () => {
    const options: ShiftTimesOptions = {
      amount: Math.abs(unit.value === "frames" ? Number(amount.value) || 0 : parseTimeAmount(amount.value)),
      unit: unit.value as ShiftTimesOptions["unit"], direction: direction.value as ShiftTimesOptions["direction"],
      scope: scope.value as ShiftTimesOptions["scope"], fields: fields.value as ShiftTimesOptions["fields"],
      selectedIds: new Set(host.getSelectedIds()), frameRate: host.frameRate(), timecodesMs: host.timecodes(),
    };
    const doc = structuredClone(host.getDoc());
    doc.cues = shiftCueTimes(doc.cues, options);
    host.applyDoc(doc, "Shifted subtitle times");
    localStorage.setItem("aegisub-web.shift-history", JSON.stringify([{ ...options, selectedIds: [] }, ...history].slice(0, 50)));
    ui.close();
  }, true));
}

export function openSelectLinesDialog(host: DialogHost): void {
  const ui = modal("Select Lines / 选择字幕行");
  const query = element("input");
  const condition = select([["match", "Matches"], ["not", "Does not match"]]);
  const mode = select([["equals", "Exact"], ["contains", "Contains"], ["regex", "Regular expression"]]);
  const fieldSelect = select([["text", "Text"], ["style", "Style"], ["actor", "Actor"], ["effect", "Effect"]]);
  const action = select([["set", "Set selection"], ["add", "Add"], ["subtract", "Subtract"], ["intersect", "Intersect"]]);
  const caseSensitive = check("Match case", false);
  const dialogues = check("Dialogues", true);
  const comments = check("Comments", true);
  const grid = element("div", "ad-grid");
  grid.append(field("Text", query), field("Condition", condition), field("Mode", mode), field("In field", fieldSelect), field("Action", action));
  ui.body.append(grid, caseSensitive.label, dialogues.label, comments.label);
  const apply = (): void => {
    const criteria: SelectCriteria = { field: fieldSelect.value as SelectCriteria["field"], query: query.value, mode: mode.value as SelectCriteria["mode"], caseSensitive: caseSensitive.input.checked };
    let matches = new Set(selectCueIds(host.getDoc().cues.filter((cue) => cue.assKind === "Comment" ? comments.input.checked : dialogues.input.checked), criteria));
    if (condition.value === "not") matches = new Set(host.getDoc().cues.filter((cue) => !matches.has(cue.id)).map((cue) => cue.id));
    const old = new Set(host.getSelectedIds());
    if (action.value === "add") for (const id of old) matches.add(id);
    if (action.value === "subtract") matches = new Set([...old].filter((id) => !matches.has(id)));
    if (action.value === "intersect") matches = new Set([...old].filter((id) => matches.has(id)));
    host.setSelection([...matches]);
  };
  ui.foot.append(button("Apply", apply), button("Cancel", ui.close), button("Apply + Close", () => { apply(); ui.close(); }, true));
}

export function openTimingPostProcessorDialog(host: DialogHost): void {
  const ui = modal("Timing Post-Processor");
  const styles = new Map<string, HTMLInputElement>();
  const stylesGroup = element("div", "ad-group");
  stylesGroup.append(element("h3", "", "Apply to styles"));
  for (const style of host.getDoc().styles ?? [{ name: "Default" } as AssStyle]) {
    const item = check(style.name, true); styles.set(style.name, item.input); stylesGroup.append(item.label);
  }
  const selectionOnly = check("Affect selection only", false);
  const leadIn = numberInput(0, 0, 10000); const leadOut = numberInput(0, 0, 10000);
  const adjacent = check("Make adjacent subtitles continuous", true);
  const maxGap = numberInput(200, 0, 5000); const maxOverlap = numberInput(200, 0, 5000); const bias = numberInput(50, 0, 100);
  const keyEnabled = check("Enable keyframe snapping", host.keyframes().length > 0);
  const startBefore = numberInput(100, 0, 5000); const startAfter = numberInput(100, 0, 5000);
  const endBefore = numberInput(100, 0, 5000); const endAfter = numberInput(100, 0, 5000);
  const grid = element("div", "ad-grid three");
  grid.append(field("Lead-in ms", leadIn), field("Lead-out ms", leadOut), field("Max gap ms", maxGap), field("Max overlap ms", maxOverlap), field("Adjacent bias %", bias), field("Start before threshold", startBefore), field("Start after threshold", startAfter), field("End before threshold", endBefore), field("End after threshold", endAfter));
  ui.body.append(stylesGroup, selectionOnly.label, adjacent.label, keyEnabled.label, grid);
  ui.foot.append(button("Cancel", ui.close), button("Process", () => {
    const options: TimingPostProcessOptions = {
      styles: new Set([...styles].filter(([, input]) => input.checked).map(([name]) => name)),
      selectedIds: selectionOnly.input.checked ? new Set(host.getSelectedIds()) : undefined,
      leadInMs: Number(leadIn.value), leadOutMs: Number(leadOut.value), adjacentEnabled: adjacent.input.checked,
      maxGapMs: Number(maxGap.value), maxOverlapMs: Number(maxOverlap.value), adjacentBias: Number(bias.value) / 100,
      keyframesMs: keyEnabled.input.checked ? host.keyframes() : undefined,
      keyStartBeforeMs: Number(startBefore.value), keyStartAfterMs: Number(startAfter.value), keyEndBeforeMs: Number(endBefore.value), keyEndAfterMs: Number(endAfter.value),
    };
    const doc = structuredClone(host.getDoc());
    doc.cues = postProcessTiming(doc.cues, options);
    host.applyDoc(doc, "Timing post-processing complete");
    ui.close();
  }, true));
}

const FORMAT_OPTIONS: [SubtitleFormat, string][] = [
  ["ass", "ASS"], ["srt", "SRT"], ["vtt", "WebVTT"], ["lrc", "LRC"], ["ttml", "TTML"], ["sbv", "SBV"],
  ["sub", "MicroDVD"], ["subviewer", "SubViewer"], ["sami", "SAMI"], ["mpl2", "MPL2"], ["ytjson", "YouTube JSON"],
  ["spruce", "Spruce STL"], ["tmp", "TMPlayer"], ["csv", "CSV"], ["qttext", "QuickTime Text"], ["dvdsp", "DVD Studio Pro"], ["jsonsub", "JSON"], ["ttxt", "TTXT"],
];

export function openExportDialog(host: DialogHost): void {
  const ui = modal("Export Subtitles / 导出字幕");
  const format = select([...FORMAT_OPTIONS, ["ssa", "SubStation Alpha v4"], ["encore", "Adobe Encore"], ["transtation", "TranStation"], ["ebustl", "EBU Tech 3264 STL"], ["plaintext", "Plain Text"]], host.getDoc().format);
  const encoding = select([["utf8", "UTF-8"], ["utf8bom", "UTF-8 with BOM"], ["utf16le", "UTF-16 LE"]]);
  const clean = check("Subtitle text cleanup", false);
  const fix = check("Fix common timing/text errors", false);
  const resample = check("Resample resolution", false);
  const width = numberInput(1920, 16, 16384); const height = numberInput(1080, 16, 16384);
  const ebuFps = select([["23.976", "23.976 fps"], ["24", "24 fps"], ["25", "25 fps"], ["29.97", "29.97 fps"], ["30", "30 fps"]], "25");
  const ebuMax = numberInput(DEFAULT_EBU_STL_OPTIONS.maxLineLength, 10, 99);
  const ebuWrap = select([["auto", "Auto wrap"], ["balanced", "Balanced wrap"], ["abort", "Abort over length"], ["skip", "Skip over length"]]);
  const ebuDisplay = select([["open", "Open subtitles"], ["level1", "Level-1 teletext"], ["level2", "Level-2 teletext"]]);
  const ebuEncoding = select([["iso6937", "ISO 6937-2"], ["iso8859-5", "ISO 8859-5 Cyrillic"], ["iso8859-6", "ISO 8859-6 Arabic"], ["iso8859-7", "ISO 8859-7 Greek"], ["iso8859-8", "ISO 8859-8 Hebrew"], ["utf8", "UTF-8 (non-standard)"]], "utf8");
  const ebuInclusive = check("EBU out-times are inclusive", false);
  const ebuAlign = check("Translate ASS alignments to EBU positions", true);
  const grid = element("div", "ad-grid");
  grid.append(field("Format", format), field("Encoding", encoding), field("Target width", width), field("Target height", height), field("EBU TV standard", ebuFps), field("EBU text encoding", ebuEncoding), field("EBU max line length", ebuMax), field("EBU wrapping", ebuWrap), field("EBU display standard", ebuDisplay));
  ui.body.append(grid, clean.label, fix.label, resample.label, ebuInclusive.label, ebuAlign.label);
  ui.foot.append(button("Cancel", ui.close), button("Export", () => {
    let doc = structuredClone(host.getDoc());
    if (clean.input.checked) doc = cleanupSubtitleText(doc).doc;
    if (fix.input.checked) doc = fixCommonErrors(doc).doc;
    if (resample.input.checked) doc = resampleAssDocument(doc, Number(width.value), Number(height.value)).doc;
    if (format.value === "ebustl") {
      const bytes = encodeEbuStl(doc, { ...DEFAULT_EBU_STL_OPTIONS, fps: Number(ebuFps.value) as 23.976 | 24 | 25 | 29.97 | 30, textEncoding: ebuEncoding.value as typeof DEFAULT_EBU_STL_OPTIONS.textEncoding, maxLineLength: Number(ebuMax.value), wrapping: ebuWrap.value as "auto" | "balanced" | "abort" | "skip", displayStandard: ebuDisplay.value as "open" | "level1" | "level2", inclusiveEndTimes: ebuInclusive.input.checked, translateAlignments: ebuAlign.input.checked });
      host.download("export.stl", [bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], "application/octet-stream");
      ui.close();
      return;
    }
    if (format.value === "plaintext") {
      host.download("export.txt", [exportPlainText(doc)], "text/plain;charset=utf-8");
      ui.close();
      return;
    }
    if (format.value === "ssa" || format.value === "encore" || format.value === "transtation") {
      const content = format.value === "ssa" ? serializeSsa(doc) : format.value === "encore" ? serializeEncore(doc, Number(ebuFps.value)) : serializeTranStation(doc, Number(ebuFps.value));
      const filename = format.value === "ssa" ? "export.ssa" : format.value === "encore" ? "export.encore.txt" : "export.transtation.txt";
      host.download(filename, [content], "text/plain;charset=utf-8"); ui.close(); return;
    }
    doc = convertDoc(doc, format.value as SubtitleFormat);
    let text = serializeSubtitles(doc);
    const extension = FORMAT_OPTIONS.find(([id]) => id === doc.format)?.[1].toLowerCase().replace(/[^a-z0-9]+/g, "") || doc.format;
    if (encoding.value === "utf8bom" && !text.startsWith("﻿")) text = `﻿${text}`;
    if (encoding.value === "utf16le") {
      const bytes = new Uint8Array(2 + text.length * 2); bytes[0] = 0xff; bytes[1] = 0xfe;
      const view = new DataView(bytes.buffer); for (let index = 0; index < text.length; index += 1) view.setUint16(2 + index * 2, text.charCodeAt(index), true);
      host.download(`export.${extension}`, [bytes], "text/plain;charset=utf-16le");
    } else host.download(`export.${extension}`, [text], "text/plain;charset=utf-8");
    ui.close();
  }, true));
}

export function openStyleManagerDialog(host: DialogHost): void {
  const ui = modal("Styles Manager / 样式管理器");
  const list = element("div", "ad-list");
  const render = (): void => {
    list.textContent = "";
    for (const style of host.getDoc().styles ?? []) list.append(button(style.name, () => openStyleEditor({
      getDoc: host.getDoc,
      onChange: () => { host.applyDoc(host.getDoc(), "Style updated"); render(); },
      onRenameStyle: host.renameStyle,
    }, style)));
  };
  const actions = element("div", "ad-quick");
  actions.append(button("New style", () => {
    const doc = host.getDoc(); doc.styles ??= [];
    const style = makeDefaultStyle(uniqueStyleName(doc, "Default")); doc.styles.push(style);
    host.applyDoc(doc, "Style added"); render();
  }, true), button("Export style library", () => host.download("aegisub-web-styles.json", [JSON.stringify(host.getDoc().styles ?? [], null, 2)], "application/json")));
  const importInput = element("input"); importInput.type = "file"; importInput.accept = ".json"; importInput.hidden = true;
  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0]; if (!file) return;
    try { const styles = JSON.parse(await file.text()) as AssStyle[]; const doc = host.getDoc(); doc.styles = styles; host.applyDoc(doc, "Style library imported"); render(); } catch { /* invalid library */ }
  });
  actions.append(button("Import style library", () => importInput.click()), importInput);
  ui.body.append(actions, list);
  ui.foot.append(button("Close", ui.close));
  render();
}
