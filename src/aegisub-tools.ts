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
      if (visibleText(cue.text) !== "") return true;
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
}

export interface TextCleanupReport {
  changedLines: number;
  commaReplacements: number;
  periodsRemoved: number;
  periodsSpaced: number;
  quoteReplacements: number;
  doubleSpaceRuns: number;
}

export const DEFAULT_TEXT_CLEANUP: TextCleanupOptions = {
  replaceFullwidthCommas: true,
  cleanFullwidthPeriods: true,
  replaceSmartQuotes: true,
  collapseDoubleSpaces: true,
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
  for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
    const part = parts[partIndex];
    if (part.protected) continue;
    let output = "";
    for (let offset = 0; offset < part.value.length; offset += 1) {
      const character = part.value[offset];
      if (options.replaceFullwidthCommas && character === "，") {
        output += " ";
        report.commaReplacements += 1;
      } else if (options.cleanFullwidthPeriods && character === "。") {
        const next = nextPlainCharacter(parts, partIndex, offset);
        if (next && next !== " ") {
          output += " ";
          report.periodsSpaced += 1;
        } else {
          report.periodsRemoved += 1;
        }
      } else if (options.replaceSmartQuotes && (character === "“" || character === "”")) {
        output += '"';
        report.quoteReplacements += 1;
      } else if (options.replaceSmartQuotes && (character === "‘" || character === "’")) {
        output += "'";
        report.quoteReplacements += 1;
      } else {
        output += character;
      }
    }
    if (options.collapseDoubleSpaces) {
      output = output.replace(/ {2,}/g, () => {
        report.doubleSpaceRuns += 1;
        return " ";
      });
    }
    part.value = output;
  }
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
  };
  for (const cue of doc.cues) {
    if (!inScope(cue, scope)) continue;
    const cleaned = cleanCueText(cue.text, options, report);
    if (cleaned !== cue.text) {
      cue.text = cleaned;
      report.changedLines += 1;
    }
  }
  return { doc, report };
}

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

export function stitchAdjacentTimings(
  source: SubtitleDoc,
  maxDistanceMs: number,
  scope?: ToolScope,
): { doc: SubtitleDoc; report: StitchReport } {
  const doc = cloneDoc(source);
  const cues = sortCues(doc.cues.filter(isDialogue));
  let stitched = 0;
  for (let index = 0; index + 1 < cues.length; index += 1) {
    const current = cues[index];
    const next = cues[index + 1];
    if (!inScope(current, scope) && !inScope(next, scope)) continue;
    const distance = next.startMs - current.endMs;
    if (Math.abs(distance) > maxDistanceMs) continue;
    const midpoint = Math.round((current.endMs + next.startMs) / 2);
    if (inScope(current, scope) && midpoint > current.startMs) current.endMs = midpoint;
    if (inScope(next, scope) && midpoint < next.endMs) next.startMs = midpoint;
    stitched += 1;
  }
  return { doc, report: { stitched } };
}

export function parseKeyframeTimes(text: string, fps = 23.976): number[] {
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
    .map((line) => Math.round((Number(line) * 1000) / (effectiveFps || fps)))
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
};

/** Generate a music-player-style stacked scrolling ASS project from the current cue timing. */
export function generateLyricsScroll(
  source: SubtitleDoc,
  options: LyricsScrollOptions = DEFAULT_LYRICS_SCROLL,
): SubtitleDoc {
  const doc = source.format === "ass" ? cloneDoc(source) : convertDoc(source, "ass");
  const resampled = resampleAssDocument(doc, options.width, options.height).doc;
  const sourceCues = sortCues(resampled.cues.filter(isDialogue));
  const styles = (resampled.styles ??= []);
  const base = styles[0] ? structuredClone(styles[0]) : makeDefaultStyle("Default");
  const currentName = uniqueStyleName(resampled, "AegisubWeb Current");
  const otherName = uniqueStyleName(resampled, "AegisubWeb Context");
  const currentStyle = structuredClone(base);
  currentStyle.name = currentName;
  currentStyle.fields.Fontsize = String(options.currentFontSize);
  currentStyle.fields.Bold = "-1";
  currentStyle.fields.Alignment = "5";
  currentStyle.fields.MarginL = currentStyle.fields.MarginR = currentStyle.fields.MarginV = "0";
  const otherStyle = structuredClone(base);
  otherStyle.name = otherName;
  otherStyle.fields.Fontsize = String(options.otherFontSize);
  otherStyle.fields.Alignment = "5";
  otherStyle.fields.MarginL = otherStyle.fields.MarginR = otherStyle.fields.MarginV = "0";
  styles.push(currentStyle, otherStyle);

  const centerX = Math.round(options.width / 2);
  const generated: Cue[] = [];
  for (let stage = 0; stage < sourceCues.length; stage += 1) {
    const stageStart = sourceCues[stage].startMs;
    const stageEnd = Math.max(
      stageStart + 100,
      sourceCues[stage + 1]?.startMs ?? sourceCues[stage].endMs,
    );
    const first = Math.max(0, stage - options.before);
    const last = Math.min(sourceCues.length - 1, stage + options.after);
    for (let item = first; item <= last; item += 1) {
      const sourceCue = sourceCues[item];
      const y = Math.round(options.currentY + (item - stage) * options.lineGap);
      const fromY = stage > 0 ? y + options.lineGap : y;
      const motion = stage > 0 && options.transitionMs > 0
        ? `\\move(${centerX},${fromY},${centerX},${y},0,${options.transitionMs})`
        : `\\pos(${centerX},${y})`;
      const opacity = item < stage ? "\\alpha&H70&" : "";
      generated.push({
        id: newCueId(),
        startMs: stageStart,
        endMs: stageEnd,
        text: `{\\an5${motion}${opacity}\\fad(90,90)}${sourceCue.text}`,
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
  resampled.cues = generated;
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
    styles.push(base);
    styleMap.set(base.name, base);
    return base;
  })();

  const entries = options.entries
    .map((entry) => ({ base: entry.base.trim(), reading: entry.reading.trim() }))
    .filter((entry) => entry.base && entry.reading)
    .sort((a, b) => b.base.length - a.base.length);
  const generated: Cue[] = [];
  let annotations = 0;

  for (const cue of doc.cues) {
    if (options.removeExisting && cue.assFields?.Name === "Aegisub Web Furigana") continue;
    generated.push(cue);
    if (!inScope(cue, scope) || cue.assFields?.Name === "Aegisub Web Furigana") continue;

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
    for (const entry of entries) {
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

export function estimateOverflow(source: SubtitleDoc): OverflowIssue[] {
  const resolution = getPlayRes(source);
  const styles = new Map((source.styles ?? []).map((style) => [style.name, style]));
  const fallback = source.styles?.[0];
  const issues: OverflowIssue[] = [];
  source.cues.forEach((cue, cueIndex) => {
    if (!isDialogue(cue)) return;
    const style = styles.get(cue.assFields?.Style ?? "") ?? fallback;
    const fontSize = Number(style?.fields.Fontsize ?? 42) || 42;
    const scaleX = (Number(style?.fields.ScaleX ?? 100) || 100) / 100;
    const marginL = Number(cue.assFields?.MarginL || style?.fields.MarginL || 20) || 0;
    const marginR = Number(cue.assFields?.MarginR || style?.fields.MarginR || 20) || 0;
    const availableWidth = Math.max(1, resolution.x - marginL - marginR);
    const estimatedWidth = displayUnits(cue.text) * fontSize * scaleX;
    if (estimatedWidth > availableWidth * 1.02) {
      issues.push({ cueId: cue.id, cueIndex, estimatedWidth, availableWidth });
    }
  });
  return issues;
}
