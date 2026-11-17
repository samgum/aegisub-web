import { type Cue, type SubtitleDoc, newCueId, sortCues, visibleText } from "./cue";
import { convertDoc } from "./formats";
import { getPlayRes, makeDefaultStyle, uniqueStyleName } from "./formats/ass";

export interface ToolScope {
  selectedIds?: ReadonlySet<string>;
  style?: string;
}

function cloneDoc(doc: SubtitleDoc): SubtitleDoc {
  return structuredClone(doc);
}

function isDialogue(cue: Cue): boolean {
  return cue.assKind !== "Comment";
}

function inScope(cue: Cue, scope?: ToolScope): boolean {
  if (!isDialogue(cue)) return false;
  if (scope?.selectedIds && !scope.selectedIds.has(cue.id)) return false;
  if (scope?.style && cue.assFields?.Style !== scope.style) return false;
  return true;
}

const PROTECTED_TEXT = /(\{[^}]*\}|<[^>]*>)/g;

/** Transform visible text while preserving ASS override blocks and HTML/VTT tags byte-for-byte. */
export function mapPlainText(text: string, transform: (plain: string) => string): string {
  let output = "";
  let cursor = 0;
  for (const match of text.matchAll(PROTECTED_TEXT)) {
    const index = match.index ?? 0;
    output += transform(text.slice(cursor, index));
    output += match[0];
    cursor = index + match[0].length;
  }
  return output + transform(text.slice(cursor));
}

export interface FixCommonOptions {
  overlaps: boolean;
  shortGaps: boolean;
  shortDurations: boolean;
  longDurations: boolean;
  removeEmpty: boolean;
  trimTrailingWhitespace: boolean;
  minGapMs: number;
  minDurationMs: number;
  maxDurationMs: number;
}

export interface FixCommonReport {
  overlaps: number;
  shortGaps: number;
  shortDurations: number;
  longDurations: number;
  emptyLines: number;
  trailingWhitespace: number;
}

export const DEFAULT_FIX_COMMON: FixCommonOptions = {
  overlaps: true,
  shortGaps: true,
  shortDurations: true,
  longDurations: false,
  removeEmpty: false,
  trimTrailingWhitespace: true,
  minGapMs: 100,
  minDurationMs: 1000,
  maxDurationMs: 7000,
};

/**
 * Mirrors samgum/Aegisub IsAssWhitespaceOnly: preserves template lines and vector drawings
 * (\p1+), while treating lines with only override blocks, \N/\n/\h, ASCII space, or U+3000 as empty.
 */
export function isAssWhitespaceOnly(cue: Cue): boolean {
  if ((cue.assFields?.Effect ?? "").trim().toLowerCase().startsWith("template")) return false;
  if (/\{[^}]*\\p[1-9]\d*[^}]*\}/.test(cue.text)) return false;
  const stripped = cue.text
    .replace(/\{[^}]*\}/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\\(?:N|n|h)/g, "")
    .replace(/[\s\u3000]+/gu, "");
  return stripped.length === 0;
}

/** Browser port of samgum/Aegisub's opt-in Fix Common Subtitle Errors operation. */
export function fixCommonErrors(
  source: SubtitleDoc,
  options: FixCommonOptions = DEFAULT_FIX_COMMON,
  scope?: ToolScope,
): { doc: SubtitleDoc; report: FixCommonReport } {
  const doc = cloneDoc(source);
  const report: FixCommonReport = {
    overlaps: 0,
    shortGaps: 0,
    shortDurations: 0,
    longDurations: 0,
    emptyLines: 0,
    trailingWhitespace: 0,
  };

  for (const cue of doc.cues) {
    if (!inScope(cue, scope)) continue;
    const duration = cue.endMs - cue.startMs;
    if (options.shortDurations && duration < options.minDurationMs) {
      cue.endMs = cue.startMs + options.minDurationMs;
      report.shortDurations += 1;
    } else if (options.longDurations && duration > options.maxDurationMs) {
      cue.endMs = cue.startMs + options.maxDurationMs;
      report.longDurations += 1;
    }
  }

  const chronological = doc.cues
    .filter(isDialogue)
    .map((cue, order) => ({ cue, order }))
    .sort((a, b) => a.cue.startMs - b.cue.startMs || a.order - b.order)
    .map(({ cue }) => cue);

  for (let index = 0; index + 1 < chronological.length; index += 1) {
    const current = chronological[index];
    const next = chronological[index + 1];
    if (!inScope(current, scope)) continue;

    if (options.overlaps && current.endMs > next.startMs && next.startMs > current.startMs) {
      current.endMs = next.startMs;
      report.overlaps += 1;
    }

    const gap = next.startMs - current.endMs;
    if (options.shortGaps && gap >= 0 && gap < options.minGapMs) {
      const newEnd = next.startMs - options.minGapMs;
      if (newEnd > current.startMs) {
        current.endMs = newEnd;
        report.shortGaps += 1;
      }
    }
  }

  if (options.trimTrailingWhitespace) {
    for (const cue of doc.cues) {
      if (!inScope(cue, scope)) continue;
      const trimmed = cue.text.replace(/[\u0020\t\r\n\u3000]+$/u, "");
      if (trimmed !== cue.text) {
        cue.text = trimmed;
        report.trailingWhitespace += 1;
      }
    }
  }

  if (options.removeEmpty) {
    doc.cues = doc.cues.filter((cue) => {
      if (!inScope(cue, scope)) return true;
      if (!isAssWhitespaceOnly(cue)) return true;
      report.emptyLines += 1;
      return false;
    });
  }

  return { doc, report };
}

export interface TextCleanupOptions {
  replaceFullwidthCommas: boolean;
  cleanFullwidthPeriods: boolean;
  replaceSmartQuotes: boolean;
  collapseDoubleSpaces: boolean;
  checkDoubleSpaces?: boolean;
}

export interface TextCleanupReport {
  changedLines: number;
  commaReplacements: number;
  periodsRemoved: number;
  periodsSpaced: number;
  quoteReplacements: number;
  doubleSpaceRuns: number;
  checkedLines: number;
  commaLines: number;
  periodRemovedLines: number;
  periodSpacedLines: number;
  quoteLines: number;
  doubleSpaceLines: number;
  doubleSpaceFixedLines: number;
  doubleSpaceRunsFixed: number;
}

export const DEFAULT_TEXT_CLEANUP: TextCleanupOptions = {
  replaceFullwidthCommas: true,
  cleanFullwidthPeriods: true,
  replaceSmartQuotes: true,
  collapseDoubleSpaces: true,
  checkDoubleSpaces: true,
};

function splitProtected(text: string): { protected: boolean; value: string }[] {
  const parts: { protected: boolean; value: string }[] = [];
  let cursor = 0;
  for (const match of text.matchAll(PROTECTED_TEXT)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ protected: false, value: text.slice(cursor, index) });
    parts.push({ protected: true, value: match[0] });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) parts.push({ protected: false, value: text.slice(cursor) });
  return parts;
}

function nextPlainCharacter(parts: { protected: boolean; value: string }[], partIndex: number, offset: number): string {
  const current = parts[partIndex].value;
  if (offset + 1 < current.length) return current[offset + 1];
  for (let index = partIndex + 1; index < parts.length; index += 1) {
    if (!parts[index].protected && parts[index].value.length > 0) return parts[index].value[0];
  }
  return "";
}

function cleanCueText(
  text: string,
  options: TextCleanupOptions,
  report: TextCleanupReport,
): string {
  const parts = splitProtected(text);
  let hadComma = false;
  let hadPeriodRemoved = false;
  let hadPeriodSpaced = false;
  let hadQuote = false;
  let hadDoubleSpace = false;
  let fixedDoubleSpace = false;
  const checkSpaces = options.checkDoubleSpaces ?? true;

  for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
    const part = parts[partIndex];
    if (part.protected) continue;
    let output = "";
    for (let offset = 0; offset < part.value.length; offset += 1) {
      const character = part.value[offset];
      if (options.replaceFullwidthCommas && character === "，") {
        output += " ";
        report.commaReplacements += 1;
        hadComma = true;
      } else if (options.cleanFullwidthPeriods && character === "。") {
        const next = nextPlainCharacter(parts, partIndex, offset);
        if (next && next !== " ") {
          output += " ";
          report.periodsSpaced += 1;
          hadPeriodSpaced = true;
        } else {
          report.periodsRemoved += 1;
          hadPeriodRemoved = true;
        }
      } else if (options.replaceSmartQuotes && (character === "“" || character === "”")) {
        output += '"';
        report.quoteReplacements += 1;
        hadQuote = true;
      } else if (options.replaceSmartQuotes && (character === "‘" || character === "’")) {
        output += "'";
        report.quoteReplacements += 1;
        hadQuote = true;
      } else {
        output += character;
      }
    }
    if (checkSpaces || options.collapseDoubleSpaces) {
      const matches = output.match(/ {2,}/g);
      if (matches?.length) {
        hadDoubleSpace = true;
        if (options.collapseDoubleSpaces) {
          fixedDoubleSpace = true;
          report.doubleSpaceRuns += matches.length;
          report.doubleSpaceRunsFixed += matches.length;
          output = output.replace(/ {2,}/g, " ");
        } else {
          report.doubleSpaceRuns += matches.length;
        }
      }
    }
    part.value = output;
  }
  if (hadComma) report.commaLines += 1;
  if (hadPeriodRemoved) report.periodRemovedLines += 1;
  if (hadPeriodSpaced) report.periodSpacedLines += 1;
  if (hadQuote) report.quoteLines += 1;
  if (hadDoubleSpace) report.doubleSpaceLines += 1;
  if (fixedDoubleSpace) report.doubleSpaceFixedLines += 1;
  return parts.map((part) => part.value).join("");
}

export function cleanupSubtitleText(
  source: SubtitleDoc,
  options: TextCleanupOptions = DEFAULT_TEXT_CLEANUP,
  scope?: ToolScope,
): { doc: SubtitleDoc; report: TextCleanupReport } {
  const doc = cloneDoc(source);
  const report: TextCleanupReport = {
    changedLines: 0,
    commaReplacements: 0,
    periodsRemoved: 0,
    periodsSpaced: 0,
    quoteReplacements: 0,
    doubleSpaceRuns: 0,
    checkedLines: 0,
    commaLines: 0,
    periodRemovedLines: 0,
    periodSpacedLines: 0,
    quoteLines: 0,
    doubleSpaceLines: 0,
    doubleSpaceFixedLines: 0,
    doubleSpaceRunsFixed: 0,
  };
  for (const cue of doc.cues) {
    if (!inScope(cue, scope)) continue;
    report.checkedLines += 1;
    const cleaned = cleanCueText(cue.text, options, report);
    if (cleaned !== cue.text) {
      cue.text = cleaned;
      report.changedLines += 1;
    }
  }
  return { doc, report };
}

export const cleanSubtitleText = cleanupSubtitleText;

export type ChineseDirection = "simplified" | "traditional";

export async function convertChinese(
  source: SubtitleDoc,
  direction: ChineseDirection,
  scope?: ToolScope,
): Promise<{ doc: SubtitleDoc; changedLines: number }> {
  const OpenCC = (await import("opencc-js")).default;
  const converter = OpenCC.Converter(
    direction === "traditional" ? { from: "cn", to: "tw" } : { from: "tw", to: "cn" },
  );
  const doc = cloneDoc(source);
  let changedLines = 0;
  for (const cue of doc.cues) {
    if (!inScope(cue, scope)) continue;
    const converted = mapPlainText(cue.text, converter);
    if (converted !== cue.text) {
      cue.text = converted;
      changedLines += 1;
    }
  }
  return { doc, changedLines };
}

export interface PairIssue {
  cueId: string;
  cueIndex: number;
  message: string;
  position: number;
}

const PAIRS = [
  ["(", ")"], ["[", "]"], ["{", "}"], ["（", "）"], ["【", "】"], ["《", "》"],
  ["〈", "〉"], ["「", "」"], ["『", "』"], ["“", "”"], ["‘", "’"],
] as const;

export function checkPairedPunctuation(source: SubtitleDoc, scope?: ToolScope): PairIssue[] {
  const issues: PairIssue[] = [];
  source.cues.forEach((cue, cueIndex) => {
    if (!inScope(cue, scope)) return;
    const text = visibleText(cue.text);
    const stack: { pair: number; position: number }[] = [];
    let doubleQuote = -1;
    let singleQuote = -1;
    const characters = [...text];
    for (let position = 0; position < characters.length; position += 1) {
      const character = characters[position];
      if (character === '"') {
        doubleQuote = doubleQuote < 0 ? position : -1;
        continue;
      }
      if (character === "'") {
        const previous = characters[position - 1] ?? "";
        const next = characters[position + 1] ?? "";
        if (/\p{L}|\p{N}/u.test(previous) && /\p{L}|\p{N}/u.test(next)) continue;
        singleQuote = singleQuote < 0 ? position : -1;
        continue;
      }
      for (let pair = 0; pair < PAIRS.length; pair += 1) {
        if (character === PAIRS[pair][0]) {
          stack.push({ pair, position });
          break;
        }
        if (character === PAIRS[pair][1]) {
          const top = stack.at(-1);
          if (!top || top.pair !== pair) {
            issues.push({ cueId: cue.id, cueIndex, position, message: `Unexpected closing ${character}` });
          } else {
            stack.pop();
          }
          break;
        }
      }
    }
    for (const unclosed of stack) {
      issues.push({
        cueId: cue.id,
        cueIndex,
        position: unclosed.position,
        message: `Unclosed ${PAIRS[unclosed.pair][0]}`,
      });
    }
    if (doubleQuote >= 0) issues.push({ cueId: cue.id, cueIndex, position: doubleQuote, message: "Unpaired ASCII double quote" });
    if (singleQuote >= 0) issues.push({ cueId: cue.id, cueIndex, position: singleQuote, message: "Unpaired ASCII single quote" });
  });
  return issues;
}

export interface StitchReport {
  stitched: number;
}

export interface StitchTimingsOptions {
  anchor?: "midpoint" | "previous" | "next";
  unit?: "time" | "frames";
  frameRate?: number;
  timecodesMs?: readonly number[];
}

function frameIndexAtMs(ms: number, fps: number, timecodes?: readonly number[]): number {
  if (timecodes?.length) {
    let lo = 0;
    let hi = timecodes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (timecodes[mid] < ms) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(timecodes[lo - 1] - ms) <= Math.abs(timecodes[lo] - ms)) return lo - 1;
    return lo;
  }
  return Math.round((ms * Math.max(1, fps)) / 1000);
}

export function stitchAdjacentTimings(
  source: SubtitleDoc,
  maxDistance: number,
  scope?: ToolScope,
  options?: StitchTimingsOptions,
): { doc: SubtitleDoc; report: StitchReport } {
  const doc = cloneDoc(source);
  const cues = sortCues(doc.cues.filter(isDialogue));
  const anchor = options?.anchor ?? "midpoint";
  const unit = options?.unit ?? "time";
  const fps = options?.frameRate ?? source.fps ?? 23.976;
  let stitched = 0;
  for (let index = 0; index + 1 < cues.length; index += 1) {
    const current = cues[index];
    const next = cues[index + 1];
    if (!inScope(current, scope) && !inScope(next, scope)) continue;
    const distance = unit === "frames"
      ? Math.abs(frameIndexAtMs(next.startMs, fps, options?.timecodesMs) - frameIndexAtMs(current.endMs, fps, options?.timecodesMs))
      : Math.abs(next.startMs - current.endMs);
    if (distance > maxDistance) continue;
    if (anchor === "previous") {
      if (inScope(next, scope) && current.endMs < next.endMs) {
        next.startMs = current.endMs;
        stitched += 1;
      }
    } else if (anchor === "next") {
      if (inScope(current, scope) && next.startMs > current.startMs) {
        current.endMs = next.startMs;
        stitched += 1;
      }
    } else {
      const midpoint = Math.round((current.endMs + next.startMs) / 2);
      if (inScope(current, scope) && midpoint > current.startMs) current.endMs = midpoint;
      if (inScope(next, scope) && midpoint < next.endMs) next.startMs = midpoint;
      stitched += 1;
    }
  }
  return { doc, report: { stitched } };
}

export function parseKeyframeTimes(text: string, fps = 23.976, frameTime?: (frame: number) => number): number[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const timecodeV2 = lines.some((line) => /timecode format v2/i.test(line));
  if (timecodeV2) {
    return lines
      .filter((line) => !line.startsWith("#"))
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
  }
  const declaredFps = lines.find((line) => /^fps\s+/i.test(line));
  const effectiveFps = declaredFps ? Number(declaredFps.split(/\s+/)[1]) : fps;
  return lines
    .filter((line) => /^\d+$/.test(line))
    .map((line) => frameTime ? frameTime(Number(line)) : Math.round((Number(line) * 1000) / (effectiveFps || fps)))
    .sort((a, b) => a - b);
}

/** Parse Aegisub timecodes v1 (Assume + frame ranges) or v2 (one timestamp per frame). */
export function parseTimecodes(text: string, fallbackFps = 23.976): number[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.some((line) => /timecode format v2/i.test(line))) {
    return lines.filter((line) => !line.startsWith("#")).map(Number).filter(Number.isFinite);
  }
  if (!lines.some((line) => /timecode format v1/i.test(line))) return parseKeyframeTimes(text, fallbackFps);
  const assumed = Number(lines.find((line) => /^assume\s+/i.test(line))?.split(/\s+/)[1]) || fallbackFps;
  const ranges = lines.map((line) => line.match(/^(\d+)\s*,\s*(\d+)\s*,\s*(\d+(?:\.\d+)?)$/)).filter((match): match is RegExpMatchArray => !!match)
    .map((match) => ({ start: Number(match[1]), end: Number(match[2]), fps: Number(match[3]) }));
  const maxFrame = Math.max(0, ...ranges.map((range) => range.end));
  const times: number[] = [];
  let time = 0;
  for (let frame = 0; frame <= maxFrame + 1; frame += 1) {
    times.push(time);
    const override = ranges.find((range) => frame >= range.start && frame <= range.end);
    time += 1000 / (override?.fps || assumed);
  }
  return times;
}

function nearestTime(times: readonly number[], value: number): number {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (times[middle] < value) low = middle + 1;
    else high = middle;
  }
  const before = times[Math.max(0, low - 1)];
  const after = times[Math.min(times.length - 1, low)];
  return Math.abs(value - before) <= Math.abs(after - value) ? before : after;
}

export function snapToKeyframes(
  source: SubtitleDoc,
  times: readonly number[],
  thresholdMs: number,
  scope?: ToolScope,
): { doc: SubtitleDoc; snappedStarts: number; snappedEnds: number } {
  const doc = cloneDoc(source);
  let snappedStarts = 0;
  let snappedEnds = 0;
  if (!times.length) return { doc, snappedStarts, snappedEnds };
  for (const cue of doc.cues) {
    if (!inScope(cue, scope)) continue;
    const start = nearestTime(times, cue.startMs);
    if (Math.abs(start - cue.startMs) <= thresholdMs && start < cue.endMs) {
      cue.startMs = start;
      snappedStarts += 1;
    }
    const end = nearestTime(times, cue.endMs);
    if (Math.abs(end - cue.endMs) <= thresholdMs && end > cue.startMs) {
      cue.endMs = end;
      snappedEnds += 1;
    }
  }
  return { doc, snappedStarts, snappedEnds };
}

function replaceScriptInfoValue(scriptInfo: string, key: string, value: string): string {
  const pattern = new RegExp(`^${key}\\s*:\\s*.*$`, "im");
  if (pattern.test(scriptInfo)) return scriptInfo.replace(pattern, `${key}: ${value}`);
  const header = /^\[Script Info\]\s*$/im;
  return header.test(scriptInfo)
    ? scriptInfo.replace(header, (match) => `${match}\n${key}: ${value}`)
    : `[Script Info]\n${key}: ${value}\n${scriptInfo}`;
}

function scaled(value: string | undefined, factor: number): string | undefined {
  if (value == null || value === "") return value;
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.max(0, Math.round(number * factor * 100) / 100)) : value;
}

function scaleOverrideCoordinates(text: string, sx: number, sy: number, borderScale: number, offsetX = 0, offsetY = 0): string {
  return text.replace(/\{[^}]*\}/g, (block) => {
    let output = block;
    output = output.replace(/\\(pos|org)\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/gi,
      (_, name: string, x: string, y: string) => `\\${name}(${Number(x) * sx + offsetX},${Number(y) * sy + offsetY})`);
    output = output.replace(/\\move\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)([^)]*)\)/gi,
      (_, x1: string, y1: string, x2: string, y2: string, tail: string) =>
        `\\move(${Number(x1) * sx + offsetX},${Number(y1) * sy + offsetY},${Number(x2) * sx + offsetX},${Number(y2) * sy + offsetY}${tail})`);
    output = output.replace(/\\(i?clip)\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/gi,
      (_, name: string, x1: string, y1: string, x2: string, y2: string) =>
        `\\${name}(${Number(x1) * sx + offsetX},${Number(y1) * sy + offsetY},${Number(x2) * sx + offsetX},${Number(y2) * sy + offsetY})`);
    output = output.replace(/\\(fs|bord|shad|blur)(-?\d+(?:\.\d+)?)/gi,
      (_, name: string, value: string) => `\\${name}${Math.round(Number(value) * (name.toLowerCase() === "fs" ? sy : borderScale) * 100) / 100}`);
    output = output.replace(/\\(xbord|xshad)(-?\d+(?:\.\d+)?)/gi,
      (_, name: string, value: string) => `\\${name}${Math.round(Number(value) * sx * 100) / 100}`);
    output = output.replace(/\\(ybord|yshad)(-?\d+(?:\.\d+)?)/gi,
      (_, name: string, value: string) => `\\${name}${Math.round(Number(value) * sy * 100) / 100}`);
    return output;
  });
}

export function resampleAssDocument(
  source: SubtitleDoc,
  width: number,
  height: number,
  mode: "stretch" | "add-borders" | "remove-borders" = "stretch",
): { doc: SubtitleDoc; from: { x: number; y: number }; to: { x: number; y: number } } {
  const doc = source.format === "ass" ? cloneDoc(source) : convertDoc(source, "ass");
  const from = getPlayRes(doc);
  let sx = width / Math.max(1, from.x);
  let sy = height / Math.max(1, from.y);
  let offsetX = 0;
  let offsetY = 0;
  if (mode !== "stretch") {
    const scale = mode === "add-borders" ? Math.min(sx, sy) : Math.max(sx, sy);
    sx = sy = scale;
    offsetX = (width - from.x * scale) / 2;
    offsetY = (height - from.y * scale) / 2;
  }
  const borderScale = Math.sqrt(sx * sy);
  let info = doc.assScriptInfo ?? "[Script Info]\n";
  info = replaceScriptInfoValue(info, "PlayResX", String(Math.round(width)));
  info = replaceScriptInfoValue(info, "PlayResY", String(Math.round(height)));
  doc.assScriptInfo = info;

  for (const style of doc.styles ?? []) {
    style.fields.Fontsize = scaled(style.fields.Fontsize, sy) ?? style.fields.Fontsize;
    style.fields.MarginL = scaled(style.fields.MarginL, sx) ?? style.fields.MarginL;
    style.fields.MarginR = scaled(style.fields.MarginR, sx) ?? style.fields.MarginR;
    style.fields.MarginV = scaled(style.fields.MarginV, sy) ?? style.fields.MarginV;
    style.fields.Outline = scaled(style.fields.Outline, borderScale) ?? style.fields.Outline;
    style.fields.Shadow = scaled(style.fields.Shadow, borderScale) ?? style.fields.Shadow;
  }
  for (const cue of doc.cues) {
    if (cue.assFields) {
      cue.assFields.MarginL = scaled(cue.assFields.MarginL, sx) ?? cue.assFields.MarginL;
      cue.assFields.MarginR = scaled(cue.assFields.MarginR, sx) ?? cue.assFields.MarginR;
      cue.assFields.MarginV = scaled(cue.assFields.MarginV, sy) ?? cue.assFields.MarginV;
    }
    cue.text = scaleOverrideCoordinates(cue.text, sx, sy, borderScale, offsetX, offsetY);
  }
  return { doc, from, to: { x: width, y: height } };
}

export interface LyricsScrollOptions {
  width: number;
  height: number;
  currentY: number;
  lineGap: number;
  before: number;
  after: number;
  transitionMs: number;
  currentFontSize: number;
  otherFontSize: number;
  resolutionPreset?: "script" | "4k" | "1080p" | "720p" | "1080x1920" | "720x1280" | "custom";
  languageMode?: "single" | "bilingual";
  secondaryStyle?: string;
  sourceAction?: "keep" | "comment" | "delete";
  clearPrevious?: boolean;
  stripTags?: boolean;
  preserveLineBreaks?: boolean;
  animate?: boolean;
  horizontalAlignment?: "left" | "center" | "right";
}

export const DEFAULT_LYRICS_SCROLL: LyricsScrollOptions = {
  width: 1920,
  height: 1080,
  currentY: 540,
  lineGap: 92,
  before: 2,
  after: 3,
  transitionMs: 280,
  currentFontSize: 58,
  otherFontSize: 44,
  resolutionPreset: "1080p",
  languageMode: "single",
  sourceAction: "delete",
  clearPrevious: true,
  stripTags: true,
  preserveLineBreaks: false,
  animate: true,
  horizontalAlignment: "center",
};

function resolveLyricsResolution(
  source: SubtitleDoc,
  options: LyricsScrollOptions,
): { width: number; height: number } {
  switch (options.resolutionPreset) {
    case "script": {
      const res = getPlayRes(source);
      return { width: res.x, height: res.y };
    }
    case "4k": return { width: 3840, height: 2160 };
    case "1080p": return { width: 1920, height: 1080 };
    case "720p": return { width: 1280, height: 720 };
    case "1080x1920": return { width: 1080, height: 1920 };
    case "720x1280": return { width: 720, height: 1280 };
    default: return { width: options.width, height: options.height };
  }
}

function cleanScrollText(text: string, stripTags: boolean, preserveLineBreaks: boolean): string {
  let out = stripTags ? text.replace(/\{[^}]*\}/g, "") : text;
  if (!preserveLineBreaks) out = out.replace(/\\N|\\n|\r?\n/g, " ");
  return out.replace(/\s{2,}/g, " ").trim();
}

/** Generate a music-player-style stacked scrolling ASS project from the current cue timing. */
export function generateLyricsScroll(
  source: SubtitleDoc,
  options: LyricsScrollOptions = DEFAULT_LYRICS_SCROLL,
): SubtitleDoc {
  const doc = source.format === "ass" ? cloneDoc(source) : convertDoc(source, "ass");
  const targetRes = resolveLyricsResolution(doc, options);
  const resampled = resampleAssDocument(doc, targetRes.width, targetRes.height).doc;
  const clearPrevious = options.clearPrevious ?? true;
  const sourceAction = options.sourceAction ?? "delete";
  const stripTags = options.stripTags ?? true;
  const preserveBreaks = options.preserveLineBreaks ?? false;
  const animate = options.animate ?? true;
  const alignment = options.horizontalAlignment ?? "center";
  const anTag = alignment === "left" ? 4 : alignment === "right" ? 6 : 5;
  const anchorX = alignment === "left"
    ? Math.round(targetRes.width * 0.08)
    : alignment === "right"
      ? Math.round(targetRes.width * 0.92)
      : Math.round(targetRes.width / 2);

  const isGenerated = (cue: Cue): boolean =>
    cue.assFields?.Name === "Aegisub Web Lyrics Scroll" || cue.text.includes("{sgmy-lyric-scroll}");

  const allDialogue = sortCues(
    resampled.cues.filter((cue) => isDialogue(cue) && (!clearPrevious || !isGenerated(cue))),
  );
  const secondaryStyle = options.secondaryStyle?.trim() || "";
  const isBilingual = options.languageMode === "bilingual" && secondaryStyle !== "";
  const primaryCues = isBilingual
    ? allDialogue.filter((cue) => (cue.assFields?.Style ?? "") !== secondaryStyle)
    : allDialogue;
  const secondaryCues = isBilingual
    ? allDialogue.filter((cue) => (cue.assFields?.Style ?? "") === secondaryStyle)
    : [];

  const styles = (resampled.styles ??= []);
  const base = styles[0] ? structuredClone(styles[0]) : makeDefaultStyle("Default");
  const currentName = uniqueStyleName(resampled, "AegisubWeb Current");
  const otherName = uniqueStyleName(resampled, "AegisubWeb Context");
  const currentStyle = structuredClone(base);
  currentStyle.name = currentName;
  currentStyle.fields.Fontsize = String(options.currentFontSize);
  currentStyle.fields.Bold = "-1";
  currentStyle.fields.Alignment = String(anTag);
  currentStyle.fields.MarginL = currentStyle.fields.MarginR = currentStyle.fields.MarginV = "0";
  const otherStyle = structuredClone(base);
  otherStyle.name = otherName;
  otherStyle.fields.Fontsize = String(options.otherFontSize);
  otherStyle.fields.Alignment = String(anTag);
  otherStyle.fields.MarginL = otherStyle.fields.MarginR = otherStyle.fields.MarginV = "0";
  styles.push(currentStyle, otherStyle);

  const findTranslation = (cue: Cue): string => {
    if (!secondaryCues.length) return "";
    let best: Cue | null = null;
    let bestScore = -1;
    for (const candidate of secondaryCues) {
      const overlap = Math.min(cue.endMs, candidate.endMs) - Math.max(cue.startMs, candidate.startMs);
      const delta = Math.abs(cue.startMs - candidate.startMs);
      if (overlap > 0 || delta <= 500) {
        const score = overlap > 0 ? overlap + 10000 - delta : 5000 - delta;
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
    }
    return best ? cleanScrollText(best.text, stripTags, preserveBreaks) : "";
  };

  const generated: Cue[] = [];
  for (let stage = 0; stage < primaryCues.length; stage += 1) {
    const stageStart = primaryCues[stage].startMs;
    const stageEnd = Math.max(
      stageStart + 100,
      primaryCues[stage + 1]?.startMs ?? primaryCues[stage].endMs,
    );
    const first = Math.max(0, stage - options.before);
    const last = Math.min(primaryCues.length - 1, stage + options.after);
    for (let item = first; item <= last; item += 1) {
      const sourceCue = primaryCues[item];
      const y = Math.round(options.currentY + (item - stage) * options.lineGap);
      const fromY = stage > 0 ? y + options.lineGap : y;
      const motion = animate && stage > 0 && options.transitionMs > 0
        ? `\\move(${anchorX},${fromY},${anchorX},${y},0,${options.transitionMs})`
        : `\\pos(${anchorX},${y})`;
      const opacity = item < stage ? "\\alpha&H70&" : "";
      const mainText = cleanScrollText(sourceCue.text, stripTags, preserveBreaks);
      const subText = isBilingual ? findTranslation(sourceCue) : "";
      const bodyText = subText
        ? `${mainText}\\N{\\fs${Math.max(12, Math.round((item === stage ? options.currentFontSize : options.otherFontSize) * 0.72))}\\alpha&H30&}${subText}`
        : mainText;
      generated.push({
        id: newCueId(),
        startMs: stageStart,
        endMs: stageEnd,
        text: `{\\an${anTag}${motion}${opacity}\\fad(90,90)}${bodyText}`,
        assKind: "Dialogue",
        assFields: {
          ...(sourceCue.assFields ?? {}),
          Layer: item === stage ? "2" : "1",
          Style: item === stage ? currentName : otherName,
          Name: "Aegisub Web Lyrics Scroll",
          MarginL: "0",
          MarginR: "0",
          MarginV: "0",
          Effect: "",
        },
      });
    }
  }

  const remaining = resampled.cues.filter((cue) => !clearPrevious || !isGenerated(cue));
  if (sourceAction === "keep") {
    resampled.cues = [...remaining, ...generated];
  } else if (sourceAction === "comment") {
    const commented = remaining.map((cue) => (isDialogue(cue) ? { ...cue, assKind: "Comment" as const } : cue));
    resampled.cues = [...commented, ...generated];
  } else {
    const nonDialogue = remaining.filter((cue) => !isDialogue(cue));
    resampled.cues = [...nonDialogue, ...generated];
  }
  return resampled;
}

export interface FuriganaEntry {
  base: string;
  reading: string;
}

export interface FuriganaOptions {
  entries: FuriganaEntry[];
  above: boolean;
  sizePercent: number;
  removeExisting: boolean;
  kanaMode?: "hiragana" | "katakana";
  outlinePercent?: number;
  shadowPercent?: number;
}

export interface KanjiOccurrence {
  rowIndex: number;
  occurrenceIndex: number;
  cueId: string;
  kanji: string;
  key: string;
  contextText: string;
}

const KANJI_RUN_RE = /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF々ヶ]+/gu;

const COMMON_KANJI_READINGS: Record<string, string> = {
  "東京": "とうきょう", "日本": "にほん", "世界": "せかい", "音楽": "おんがく",
  "青春": "せいしゅん", "未来": "みらい", "希望": "きぼう", "友達": "ともだち",
  "時間": "じかん", "場所": "ばしょ", "笑顔": "えがお", "涙": "なみだ",
  "心": "こころ", "夢": "ゆめ", "空": "そら", "星": "ほし", "光": "ひかり",
  "風": "かぜ", "雨": "あめ", "雪": "ゆき", "恋": "こい", "愛": "あい",
  "君": "きみ", "僕": "ぼく", "私": "わたし", "彼女": "かのじょ", "彼": "かれ",
  "今日": "きょう", "明日": "あした", "昨日": "きのう", "夜": "よる", "朝": "あさ",
  "声": "こえ", "歌": "うた", "道": "みち", "手": "て", "目": "め",
  "言葉": "ことば", "気持ち": "きもち", "約束": "やくそく", "記憶": "きおく",
  "奇跡": "きせき", "季節": "きせつ", "瞬間": "しゅんかん", "永遠": "えいえん",
  "運命": "うんめい", "勇気": "ゆうき", "秘密": "ひみつ", "物語": "ものがたり",
  "学校": "がっこう", "先生": "せんせい", "教室": "きょうしつ", "夏": "なつ",
  "冬": "ふゆ", "春": "はる", "秋": "あき", "花": "はな", "桜": "さくら",
  "海": "うみ", "山": "やま", "街": "まち", "町": "まち", "家": "いえ",
  "部屋": "へや", "窓": "まど", "扉": "とびら", "名前": "なまえ", "意味": "いみ",
  "理由": "りゆう", "返事": "へんじ", "大丈夫": "だいじょうぶ", "本当": "ほんとう",
  "毎日": "まいにち", "一緒": "いっしょ", "一人": "ひとり", "二人": "ふたり",
  "子供": "こども", "大人": "おとな", "人間": "にんげん", "人生": "じんせい",
  "幸せ": "しあわせ", "悲しみ": "かなしみ", "優しさ": "やさしさ", "強さ": "つよさ",
  "行": "い", "来": "き", "見": "み", "聞": "き", "言": "い", "思": "おも",
  "知": "し", "好": "す", "待": "ま", "信": "しん", "忘": "わす", "守": "まも",
  "走": "はし", "歩": "ある", "飛": "と", "笑": "わら", "泣": "な", "歌う": "うたう",
};

export function convertKana(text: string, mode: "hiragana" | "katakana"): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (mode === "katakana" && code >= 0x3041 && code <= 0x3096) {
      out += String.fromCodePoint(code + 0x60);
    } else if (mode === "hiragana" && code >= 0x30a1 && code <= 0x30f6) {
      out += String.fromCodePoint(code - 0x60);
    } else {
      out += ch;
    }
  }
  return out;
}

export function extractKanjiOccurrences(source: SubtitleDoc, scope?: ToolScope): KanjiOccurrence[] {
  const occurrences: KanjiOccurrence[] = [];
  source.cues.forEach((cue, rowIndex) => {
    if (!inScope(cue, scope)) return;
    if (cue.assFields?.Name === "Aegisub Web Furigana" || cue.text.includes("{sgmy-furigana}")) return;
    const plain = visibleText(cue.text);
    if (!plain) return;
    let occ = 0;
    KANJI_RUN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = KANJI_RUN_RE.exec(plain))) {
      occ += 1;
      occurrences.push({
        rowIndex: rowIndex + 1,
        occurrenceIndex: occ,
        cueId: cue.id,
        kanji: m[0],
        key: `${rowIndex + 1}#${occ} ${m[0]}`,
        contextText: plain,
      });
    }
  });
  return occurrences;
}

export function autoFillFuriganaReadings(
  source: SubtitleDoc,
  existingEntries: readonly FuriganaEntry[],
  scope?: ToolScope,
  kanaMode: "hiragana" | "katakana" = "hiragana",
): FuriganaEntry[] {
  const result = new Map<string, string>();
  for (const entry of existingEntries) {
    if (entry.base.trim() && entry.reading.trim()) {
      result.set(entry.base.trim(), convertKana(entry.reading.trim(), kanaMode));
    }
  }
  const seenKanji = new Set<string>();
  for (const occ of extractKanjiOccurrences(source, scope)) {
    if (seenKanji.has(occ.kanji)) continue;
    seenKanji.add(occ.kanji);
    if (result.has(occ.kanji)) continue;
    const known = COMMON_KANJI_READINGS[occ.kanji];
    if (known) {
      result.set(occ.kanji, convertKana(known, kanaMode));
    }
  }
  return [...result.entries()].map(([base, reading]) => ({ base, reading }));
}

function parseOccurrenceKey(rawBase: string): { rowIndex: number; occurrenceIndex: number; base: string } | null {
  const m = rawBase.trim().match(/^@?(\d+)#(\d+)[\s#]+(.+)$/);
  if (!m) return null;
  return { rowIndex: Number(m[1]), occurrenceIndex: Number(m[2]), base: m[3].trim() };
}

/**
 * Add editable ruby readings as ordinary positioned ASS dialogue events. A separate event per
 * occurrence keeps the output libass-compatible (ASS has no native ruby tag) and makes every
 * reading independently movable in the normal visual typesetter.
 */
export function annotateFurigana(
  source: SubtitleDoc,
  options: FuriganaOptions,
  scope?: ToolScope,
): { doc: SubtitleDoc; annotations: number } {
  const doc = source.format === "ass" ? cloneDoc(source) : convertDoc(source, "ass");
  const resolution = getPlayRes(doc);
  const styles = (doc.styles ??= []);
  const styleMap = new Map(styles.map((style) => [style.name, style]));
  const existingRubyStyle = styles.find((style) => style.name.startsWith("AegisubWeb Furigana"));
  const rubyStyle = existingRubyStyle ?? (() => {
    const base = styles[0] ? structuredClone(styles[0]) : makeDefaultStyle("Default");
    base.name = uniqueStyleName(doc, "AegisubWeb Furigana");
    base.fields.Fontsize = String(Math.max(8, Math.round((Number(base.fields.Fontsize || 48) * options.sizePercent) / 100)));
    base.fields.Alignment = "2";
    base.fields.MarginL = base.fields.MarginR = base.fields.MarginV = "0";
    if (options.outlinePercent != null) {
      const outline = Math.max(0, Math.round(((Number(base.fields.Outline || 2) * options.outlinePercent) / 100) * 100) / 100);
      base.fields.Outline = String(outline);
    }
    if (options.shadowPercent != null) {
      const shadow = Math.max(0, Math.round(((Number(base.fields.Shadow || 0) * options.shadowPercent) / 100) * 100) / 100);
      base.fields.Shadow = String(shadow);
    }
    styles.push(base);
    styleMap.set(base.name, base);
    return base;
  })();

  const normalizeReading = (reading: string): string =>
    options.kanaMode ? convertKana(reading.trim(), options.kanaMode) : reading.trim();

  const specificEntries = new Map<string, { base: string; reading: string }>();
  const globalEntries: { base: string; reading: string }[] = [];

  for (const raw of options.entries) {
    const base = raw.base.trim();
    const reading = normalizeReading(raw.reading);
    if (!base || !reading) continue;
    const occ = parseOccurrenceKey(base);
    if (occ) {
      specificEntries.set(`${occ.rowIndex}#${occ.occurrenceIndex}#${occ.base}`, { base: occ.base, reading });
    } else {
      globalEntries.push({ base, reading });
    }
  }
  globalEntries.sort((a, b) => b.base.length - a.base.length);

  const generated: Cue[] = [];
  let annotations = 0;
  let sourceRowNumber = 0;

  for (const cue of doc.cues) {
    const isRubyLine = cue.assFields?.Name === "Aegisub Web Furigana" || cue.text.includes("{sgmy-furigana}");
    if (options.removeExisting && isRubyLine) continue;
    generated.push(cue);
    if (isRubyLine) continue;
    sourceRowNumber += 1;
    if (!inScope(cue, scope)) continue;

    const plain = visibleText(cue.text);
    if (!plain) continue;
    const style = styleMap.get(cue.assFields?.Style ?? "") ?? styles[0] ?? rubyStyle;
    const fontSize = Number(style.fields.Fontsize || 48) || 48;
    const scaleX = (Number(style.fields.ScaleX || 100) || 100) / 100;
    const marginV = Number(cue.assFields?.MarginV || style.fields.MarginV || 30) || 30;
    const alignment = Number(style.fields.Alignment || 2) || 2;
    const totalWidth = displayUnits(plain) * fontSize * scaleX;
    const explicit = cue.text.match(/\\pos\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/i);
    const centerX = explicit ? Number(explicit[1]) : resolution.x / 2;
    const baseY = explicit ? Number(explicit[2]) : alignment >= 7 ? marginV + fontSize : alignment >= 4 ? resolution.y / 2 : resolution.y - marginV;
    const readingSize = Math.max(8, Math.round((fontSize * options.sizePercent) / 100));
    const readingY = options.above ? baseY - fontSize * 0.9 : baseY + readingSize * 1.15;

    const occupied: [number, number][] = [];

    // First apply occurrence-specific readings (if any match kanji runs in this row).
    if (specificEntries.size > 0) {
      let occIdx = 0;
      KANJI_RUN_RE.lastIndex = 0;
      let km: RegExpExecArray | null;
      while ((km = KANJI_RUN_RE.exec(plain))) {
        occIdx += 1;
        const spec = specificEntries.get(`${sourceRowNumber}#${occIdx}#${km[0]}`);
        if (!spec) continue;
        const index = km.index;
        const end = index + km[0].length;
        occupied.push([index, end]);
        const prefixWidth = displayUnits(plain.slice(0, index)) * fontSize * scaleX;
        const termWidth = displayUnits(km[0]) * fontSize * scaleX;
        const x = Math.round((centerX - totalWidth / 2 + prefixWidth + termWidth / 2) * 100) / 100;
        const y = Math.round(readingY * 100) / 100;
        generated.push({
          id: newCueId(),
          startMs: cue.startMs,
          endMs: cue.endMs,
          text: `{sgmy-furigana}{\\an2\\pos(${x},${y})\\fs${readingSize}}${spec.reading}`,
          assKind: "Dialogue",
          assFields: {
            ...(cue.assFields ?? {}),
            Layer: String((Number(cue.assFields?.Layer || 0) || 0) + 1),
            Style: rubyStyle.name,
            Name: "Aegisub Web Furigana",
            MarginL: "0",
            MarginR: "0",
            MarginV: "0",
            Effect: "",
          },
        });
        annotations += 1;
      }
    }

    for (const entry of globalEntries) {
      let from = 0;
      while (from < plain.length) {
        const index = plain.indexOf(entry.base, from);
        if (index < 0) break;
        const end = index + entry.base.length;
        from = end;
        if (occupied.some(([left, right]) => index < right && end > left)) continue;
        occupied.push([index, end]);
        const prefixWidth = displayUnits(plain.slice(0, index)) * fontSize * scaleX;
        const termWidth = displayUnits(entry.base) * fontSize * scaleX;
        const x = Math.round((centerX - totalWidth / 2 + prefixWidth + termWidth / 2) * 100) / 100;
        const y = Math.round(readingY * 100) / 100;
        generated.push({
          id: newCueId(),
          startMs: cue.startMs,
          endMs: cue.endMs,
          text: `{sgmy-furigana}{\\an2\\pos(${x},${y})\\fs${readingSize}}${entry.reading}`,
          assKind: "Dialogue",
          assFields: {
            ...(cue.assFields ?? {}),
            Layer: String((Number(cue.assFields?.Layer || 0) || 0) + 1),
            Style: rubyStyle.name,
            Name: "Aegisub Web Furigana",
            MarginL: "0",
            MarginR: "0",
            MarginV: "0",
            Effect: "",
          },
        });
        annotations += 1;
      }
    }
  }
  doc.cues = generated;
  return { doc, annotations };
}

export type AssAttachmentKind = "font" | "graphic";

export interface AssAttachmentInfo {
  kind: AssAttachmentKind;
  name: string;
  encodedCharacters: number;
  approximateBytes: number;
}

function encodeAssAttachment(bytes: Uint8Array): string {
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    encoded += String.fromCharCode((first >> 2) + 33);
    encoded += String.fromCharCode((((first & 3) << 4) | ((second ?? 0) >> 4)) + 33);
    if (index + 1 < bytes.length) encoded += String.fromCharCode((((second & 15) << 2) | ((third ?? 0) >> 6)) + 33);
    if (index + 2 < bytes.length) encoded += String.fromCharCode((third & 63) + 33);
  }
  return encoded.match(/.{1,80}/g)?.join("\n") ?? "";
}

function attachmentText(doc: SubtitleDoc): string {
  return doc.trailingNotes ?? "";
}

export function listAssAttachments(doc: SubtitleDoc): AssAttachmentInfo[] {
  if (doc.format !== "ass") return [];
  const lines = attachmentText(doc).split(/\r?\n/);
  const result: AssAttachmentInfo[] = [];
  let section: AssAttachmentKind | null = null;
  let current: AssAttachmentInfo | null = null;
  const flush = (): void => {
    if (!current) return;
    current.approximateBytes = Math.floor((current.encodedCharacters * 3) / 4);
    result.push(current);
    current = null;
  };
  for (const line of lines) {
    const heading = line.trim().match(/^\[([^\]]+)\]$/)?.[1].toLowerCase();
    if (heading) {
      flush();
      section = heading === "fonts" ? "font" : heading === "graphics" ? "graphic" : null;
      continue;
    }
    if (!section) continue;
    const marker = line.match(/^(?:fontname|filename)\s*:\s*(.+?)\s*$/i);
    if (marker) {
      flush();
      current = { kind: section, name: marker[1], encodedCharacters: 0, approximateBytes: 0 };
    } else if (current) {
      current.encodedCharacters += line.replace(/[^\x21-\x60]/g, "").length;
    }
  }
  flush();
  return result;
}

export function removeAssAttachment(source: SubtitleDoc, name: string, kind: AssAttachmentKind): SubtitleDoc {
  const doc = source.format === "ass" ? cloneDoc(source) : convertDoc(source, "ass");
  const eol = doc.eol;
  const lines = attachmentText(doc).split(/\r?\n/);
  const output: string[] = [];
  let section: AssAttachmentKind | null = null;
  let skipping = false;
  for (const line of lines) {
    const heading = line.trim().match(/^\[([^\]]+)\]$/)?.[1].toLowerCase();
    if (heading) {
      section = heading === "fonts" ? "font" : heading === "graphics" ? "graphic" : null;
      skipping = false;
      output.push(line);
      continue;
    }
    const marker = section ? line.match(/^(?:fontname|filename)\s*:\s*(.+?)\s*$/i) : null;
    if (marker) skipping = section === kind && marker[1] === name;
    if (!skipping) output.push(line);
  }
  const compactBlankLines = eol === "\r\n" ? /(?:\r\n){3,}/g : /\n{3,}/g;
  doc.trailingNotes = output.join(eol).replace(compactBlankLines, `${eol}${eol}`) || undefined;
  return doc;
}

export function embedAssAttachment(
  source: SubtitleDoc,
  filename: string,
  bytes: Uint8Array,
  kind: AssAttachmentKind = "font",
): SubtitleDoc {
  let doc = source.format === "ass" ? cloneDoc(source) : convertDoc(source, "ass");
  const safeName = (filename.split(/[\\/]/).pop() ?? "attachment.bin").replace(/[\r\n:]/g, "_");
  doc = removeAssAttachment(doc, safeName, kind);
  const eol = doc.eol;
  const sectionName = kind === "font" ? "Fonts" : "Graphics";
  const marker = kind === "font" ? "fontname" : "filename";
  const block = `${marker}: ${safeName}${eol}${encodeAssAttachment(bytes).replace(/\n/g, eol)}`;
  const raw = attachmentText(doc);
  const heading = new RegExp(`^\\[${sectionName}\\]\\s*$`, "im");
  const match = heading.exec(raw);
  if (!match) {
    doc.trailingNotes = `${raw}${raw ? `${eol}${eol}` : ""}[${sectionName}]${eol}${block}`;
    return doc;
  }
  const afterHeading = match.index + match[0].length;
  const rest = raw.slice(afterHeading);
  const nextSection = rest.search(/^\[[^\]]+\]\s*$/m);
  const insertAt = nextSection >= 0 ? afterHeading + nextSection : raw.length;
  const before = raw.slice(0, insertAt).replace(/[\r\n]*$/, "");
  const after = raw.slice(insertAt).replace(/^[\r\n]*/, "");
  doc.trailingNotes = `${before}${eol}${block}${after ? `${eol}${eol}${after}` : ""}`;
  return doc;
}

export interface OverflowIssue {
  cueId: string;
  cueIndex: number;
  estimatedWidth: number;
  availableWidth: number;
  reason?: "width" | "bounds" | "chars";
}

export interface OverflowOptions {
  characterLimit?: number;
}

function displayUnits(text: string): number {
  let units = 0;
  for (const character of [...visibleText(text)]) {
    if (/\s/u.test(character)) units += 0.32;
    else if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(character)) units += 1;
    else if (/[A-Z0-9]/.test(character)) units += 0.64;
    else if (/\p{P}/u.test(character)) units += 0.42;
    else units += 0.55;
  }
  return units;
}

const LEGACY_AN: Record<number, number> = { 1: 1, 2: 2, 3: 3, 5: 7, 6: 8, 7: 9, 9: 4, 10: 5, 11: 6 };

function splitTopLevelTags(block: string): string[] {
  const result: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < block.length; i += 1) {
    const ch = block[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "\\" && depth === 0 && i > start) {
      result.push(block.slice(start, i));
      start = i;
    }
  }
  if (start < block.length) result.push(block.slice(start));
  return result;
}

export function estimateCueOverflow(
  cue: Cue,
  source: SubtitleDoc,
  cueIndex: number,
  options?: OverflowOptions,
): OverflowIssue | null {
  const resolution = getPlayRes(source);
  const styles = new Map((source.styles ?? []).map((style) => [style.name, style]));
  const baseStyle = styles.get(cue.assFields?.Style ?? "") ?? source.styles?.[0];
  const baseFs = Number(baseStyle?.fields.Fontsize ?? 42) || 42;
  const baseScaleX = (Number(baseStyle?.fields.ScaleX ?? 100) || 100) / 100;
  const baseSpacing = Number(baseStyle?.fields.Spacing ?? 0) || 0;
  const baseOutline = Number(baseStyle?.fields.Outline ?? 0) || 0;
  const baseShadow = Number(baseStyle?.fields.Shadow ?? 0) || 0;
  const baseAn = Number(baseStyle?.fields.Alignment ?? 2) || 2;
  const marginL = Number(cue.assFields?.MarginL || baseStyle?.fields.MarginL || 20) || 0;
  const marginR = Number(cue.assFields?.MarginR || baseStyle?.fields.MarginR || 20) || 0;

  let fs = baseFs;
  let scaleX = baseScaleX;
  let spacing = baseSpacing;
  let outlineX = baseOutline;
  let shadowX = baseShadow;
  let alignment = baseAn;
  let drawingLevel = 0;
  const anchorXs: number[] = [];

  const visualLines: { width: number; chars: number }[] = [{ width: 0, chars: 0 }];
  const pushText = (chunk: string): void => {
    if (drawingLevel > 0 || !chunk) return;
    const normalized = chunk.replace(/\\h/g, " ").replace(/\r/g, "");
    const parts = normalized.split(/\\[Nn]|\n/);
    for (let i = 0; i < parts.length; i += 1) {
      if (i > 0) visualLines.push({ width: 0, chars: 0 });
      const segment = parts[i];
      if (!segment) continue;
      const units = displayUnits(segment);
      const count = [...segment].length;
      const line = visualLines[visualLines.length - 1];
      line.width += units * fs * scaleX + count * spacing;
      line.chars += count;
    }
  };

  let cursor = 0;
  for (const match of cue.text.matchAll(/\{([^}]*)\}/g)) {
    const idx = match.index ?? 0;
    if (idx > cursor) pushText(cue.text.slice(cursor, idx));
    cursor = idx + match[0].length;
    for (const tag of splitTopLevelTags(match[1])) {
      const mPos = tag.match(/^\\pos\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/);
      if (mPos) { anchorXs.push(Number(mPos[1])); continue; }
      const mMove = tag.match(/^\\move\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
      if (mMove) { anchorXs.push(Number(mMove[1]), Number(mMove[3])); continue; }
      const mFs = tag.match(/^\\fs(\d+(?:\.\d+)?)/);
      if (mFs) { fs = Number(mFs[1]) || baseFs; continue; }
      const mScx = tag.match(/^\\fscx(\d+(?:\.\d+)?)/);
      if (mScx) { scaleX = (Number(mScx[1]) || 100) / 100; continue; }
      const mFsp = tag.match(/^\\fsp(-?\d+(?:\.\d+)?)/);
      if (mFsp) { spacing = Number(mFsp[1]) || 0; continue; }
      const mBord = tag.match(/^\\(?:bord|xbord)(\d+(?:\.\d+)?)/);
      if (mBord) { outlineX = Number(mBord[1]) || 0; continue; }
      const mShad = tag.match(/^\\(?:shad|xshad)(\d+(?:\.\d+)?)/);
      if (mShad) { shadowX = Number(mShad[1]) || 0; continue; }
      const mAn = tag.match(/^\\an([1-9])/);
      if (mAn) { alignment = Number(mAn[1]); continue; }
      const mA = tag.match(/^\\a(\d+)/);
      if (mA && LEGACY_AN[Number(mA[1])]) { alignment = LEGACY_AN[Number(mA[1])]; continue; }
      const mP = tag.match(/^\\p(\d+)/);
      if (mP) { drawingLevel = Number(mP[1]); continue; }
      const mReset = tag.match(/^\\r(.*)$/);
      if (mReset) {
        const targetStyle = styles.get(mReset[1].trim()) ?? baseStyle;
        fs = Number(targetStyle?.fields.Fontsize ?? baseFs) || baseFs;
        scaleX = (Number(targetStyle?.fields.ScaleX ?? 100) || 100) / 100;
        spacing = Number(targetStyle?.fields.Spacing ?? baseSpacing) || baseSpacing;
        outlineX = Number(targetStyle?.fields.Outline ?? baseOutline) || baseOutline;
        shadowX = Number(targetStyle?.fields.Shadow ?? baseShadow) || baseShadow;
        alignment = Number(targetStyle?.fields.Alignment ?? baseAn) || baseAn;
        drawingLevel = 0;
      }
    }
  }
  if (cursor < cue.text.length) pushText(cue.text.slice(cursor));

  const edgePad = Math.max(0, outlineX * 2 + shadowX);
  const maxWidth = Math.max(0, ...visualLines.map((l) => (l.width > 0 ? l.width + edgePad : 0)));
  const maxChars = Math.max(0, ...visualLines.map((l) => l.chars));

  if (options?.characterLimit && options.characterLimit > 0 && maxChars > options.characterLimit) {
    return { cueId: cue.id, cueIndex, estimatedWidth: maxChars, availableWidth: options.characterLimit, reason: "chars" };
  }

  if (anchorXs.length > 0 && maxWidth > 0) {
    const col = (alignment - 1) % 3;
    for (const ax of anchorXs) {
      const boundLeft = col === 0 ? ax : col === 2 ? ax - maxWidth : ax - maxWidth / 2;
      const boundRight = col === 0 ? ax + maxWidth : col === 2 ? ax : ax + maxWidth / 2;
      if (boundLeft < -1 || boundRight > resolution.x + 1) {
        const excess = Math.max(boundRight - resolution.x, -boundLeft, 0);
        return {
          cueId: cue.id,
          cueIndex,
          estimatedWidth: resolution.x + excess,
          availableWidth: resolution.x,
          reason: "bounds",
        };
      }
    }
    return null;
  }

  const availableWidth = Math.max(1, resolution.x - marginL - marginR);
  if (maxWidth > availableWidth * 1.02) {
    return { cueId: cue.id, cueIndex, estimatedWidth: maxWidth, availableWidth, reason: "width" };
  }
  return null;
}

export function estimateOverflow(source: SubtitleDoc, options?: OverflowOptions): OverflowIssue[] {
  const issues: OverflowIssue[] = [];
  source.cues.forEach((cue, cueIndex) => {
    if (!isDialogue(cue)) return;
    const issue = estimateCueOverflow(cue, source, cueIndex, options);
    if (issue) issues.push(issue);
  });
  return issues;
}
