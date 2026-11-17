// LRC timed lyrics: "[mm:ss.xx]text" per line, Enhanced LRC inline "<mm:ss.xx>" word-level
// karaoke (mapped to ASS \kf sweeping tags, with trailing "<mm:ss.xx>" line-end markers),
// "[offset:+/-ms]" file-wide offset metadata, "[ar:]/[ti:]/[al:]" metadata, spacer skipping,
// and untimed .lrc fallback. Each timed line carries only a start unless an end marker is
// present; otherwise the end is taken as the next line's start (the last line gets a short tail).

import { type Cue, type SubtitleDoc, detectEol, newCueId } from "../cue";

const META_RE = /^\[([a-z#]+):(.*)\]$/i; // [ar:...], [ti:...], [offset:...], etc.
const TAIL_MS = 3000;

interface ParsedLrcLine {
  ms: number;
  endMarkerMs?: number;
  text: string;
  syllables?: { ms: number; text: string }[];
}

export interface SerializeLrcOptions {
  enhanced?: boolean;
  offsetMs?: number;
}

/** Parse "mm:ss", "mm:ss.xx" or "mm:ss.xxx" (or colon separator), returning milliseconds or null. */
function parseLrcTimestamp(body: string): number | null {
  const m = body.trim().match(/^(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?$/);
  if (!m) return null;
  const minutes = parseInt(m[1], 10);
  const seconds = parseInt(m[2], 10);
  if (seconds >= 60) return null;
  const fracRaw = m[3] ?? "";
  const frac =
    fracRaw.length === 0 ? 0 :
    fracRaw.length === 1 ? parseInt(fracRaw, 10) * 100 :
    fracRaw.length === 2 ? parseInt(fracRaw, 10) * 10 :
    parseInt(fracRaw, 10);
  return (minutes * 60 + seconds) * 1000 + frac;
}

function karaokeCs(ms: number): number {
  return Math.max(0, Math.floor((ms + 5) / 10));
}

export function parseLrc(raw: string): SubtitleDoc {
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  const eol = detectEol(body);
  const finalNewline = /\r?\n$/.test(body);
  const lines = body.split(/\r?\n/);
  const meta: string[] = [];
  const stamped: ParsedLrcLine[] = [];
  const untimedLines: string[] = [];
  let offsetMs = 0;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "").trim();
    if (!line) continue;
    if (!line.startsWith("[")) {
      untimedLines.push(line);
      continue;
    }

    // Peel leading [tags] off the line cleanly so metadata colons like [ti:01:23] never misparse.
    const timestamps: number[] = [];
    let pos = 0;
    let isOffsetTag = false;
    while (pos < line.length && line[pos] === "[") {
      const close = line.indexOf("]", pos);
      if (close < 0) break;
      const tagBody = line.slice(pos + 1, close).trim();
      const ms = parseLrcTimestamp(tagBody);
      if (ms !== null) {
        timestamps.push(ms);
      } else if (/^offset\s*:/i.test(tagBody)) {
        const val = tagBody.slice(tagBody.indexOf(":") + 1).trim();
        const normalized = val.startsWith("+") ? val.slice(1).trim() : val;
        if (/^-?\d+$/.test(normalized)) {
          const parsedOffset = parseInt(normalized, 10);
          if (Number.isSafeInteger(parsedOffset)) offsetMs = parsedOffset;
        }
        isOffsetTag = true;
      }
      pos = close + 1;
    }

    if (!timestamps.length) {
      if (!isOffsetTag && META_RE.test(line)) meta.push(rawLine.replace(/\r$/, ""));
      continue;
    }

    const textAfterTags = line.slice(pos).trim();

    // Enhanced LRC: parse inline <mm:ss.xx> syllable markers inside text.
    const syllables: { ms: number; text: string }[] = [];
    let hasSyllables = false;
    let endMarkerMs: number | undefined;
    let scan = 0;
    let lastSyllableMs = timestamps[0];
    let pendingText = "";

    while (scan < textAfterTags.length) {
      const lt = textAfterTags.indexOf("<", scan);
      const gt = lt >= 0 ? textAfterTags.indexOf(">", lt + 1) : -1;
      if (lt < 0 || gt < 0) {
        pendingText += textAfterTags.slice(scan);
        break;
      }
      const tagBody = textAfterTags.slice(lt + 1, gt);
      const ms = parseLrcTimestamp(tagBody);
      if (ms === null) {
        // Keep non-timestamp <...> text verbatim.
        pendingText += textAfterTags.slice(scan, gt + 1);
        scan = gt + 1;
        continue;
      }
      pendingText += textAfterTags.slice(scan, lt);
      if (pendingText.length > 0) {
        syllables.push({ ms: lastSyllableMs, text: pendingText });
        pendingText = "";
      }
      lastSyllableMs = ms;
      hasSyllables = true;
      scan = gt + 1;
    }

    const trailingTrimmed = pendingText.trim();
    if (hasSyllables && trailingTrimmed.length > 0) {
      syllables.push({ ms: lastSyllableMs, text: trailingTrimmed });
    } else if (hasSyllables) {
      // Trailing <mm:ss.xx> with no text after it marks the line end (e.g., Apple Music LRC).
      endMarkerMs = lastSyllableMs;
    }

    for (const ts of timestamps) {
      const delta = ts - timestamps[0];
      if (hasSyllables) {
        const nonEmpty = syllables.some((syl) => syl.text.trim().length > 0);
        if (!nonEmpty) continue;
        stamped.push({
          ms: ts,
          endMarkerMs: endMarkerMs !== undefined ? endMarkerMs + delta : undefined,
          text: "",
          syllables: syllables.map((syl) => ({ ms: syl.ms + delta, text: syl.text })),
        });
      } else {
        if (!textAfterTags.length) continue; // skip timestamp-only spacer lines
        stamped.push({ ms: ts, text: textAfterTags });
      }
    }
  }

  if (!stamped.length && untimedLines.length) {
    const cues: Cue[] = untimedLines.map((text) => ({
      id: newCueId(),
      startMs: 0,
      endMs: 0,
      text,
    }));
    return { format: "lrc", cues, eol, bom, finalNewline, header: meta.length ? meta.join(eol) : undefined };
  }

  // Apply file-wide [offset:+/-ms] (LRC offset may appear anywhere in the file).
  if (offsetMs !== 0) {
    const adjust = (ms: number): number => Math.max(0, ms - offsetMs);
    for (const entry of stamped) {
      entry.ms = adjust(entry.ms);
      if (entry.endMarkerMs !== undefined) entry.endMarkerMs = adjust(entry.endMarkerMs);
      if (entry.syllables) {
        for (const syl of entry.syllables) syl.ms = adjust(syl.ms);
      }
    }
  }

  stamped.sort((a, b) => a.ms - b.ms);

  const cues: Cue[] = stamped.map((s, i) => {
    const nextStartMs = i + 1 < stamped.length ? stamped[i + 1].ms : undefined;
    let endMs: number;
    if (s.endMarkerMs !== undefined) {
      endMs = nextStartMs !== undefined ? Math.min(s.endMarkerMs, nextStartMs) : s.endMarkerMs;
      if (endMs <= s.ms) {
        endMs = nextStartMs !== undefined && nextStartMs > s.ms ? nextStartMs : s.ms + 500;
      }
    } else {
      endMs = nextStartMs !== undefined ? nextStartMs : s.ms + TAIL_MS;
    }

    let text = s.text;
    if (s.syllables?.length) {
      text = "";
      let elapsedCs = 0;
      for (let k = 0; k < s.syllables.length; k += 1) {
        const syl = s.syllables[k];
        const segBegin = Math.min(Math.max(syl.ms, s.ms), endMs);
        const beginCs = karaokeCs(segBegin - s.ms);
        if (beginCs > elapsedCs) {
          text += `{\\k${beginCs - elapsedCs}}`;
          elapsedCs = beginCs;
        }
        const segEndRaw = k + 1 < s.syllables.length ? s.syllables[k + 1].ms : endMs;
        const segEnd = Math.min(Math.max(segEndRaw, segBegin), endMs);
        const endCs = karaokeCs(segEnd - s.ms);
        const durCs = Math.max(0, endCs - elapsedCs);
        text += `{\\kf${durCs}}${syl.text}`;
        elapsedCs += durCs;
      }
    }

    return {
      id: newCueId(),
      startMs: s.ms,
      endMs,
      text,
    };
  });

  return { format: "lrc", cues, eol, bom, finalNewline, header: meta.length ? meta.join(eol) : undefined };
}

export function serializeLrc(doc: SubtitleDoc, options?: SerializeLrcOptions): string {
  const eol = doc.eol;
  const lines: string[] = [];
  if (doc.header) lines.push(...doc.header.split(/\r?\n/));
  if (options?.offsetMs) {
    const sign = options.offsetMs > 0 ? "+" : "";
    lines.push(`[offset:${sign}${options.offsetMs}]`);
  }
  const hasKaraoke = doc.cues.some((c) => /\{[^}]*\\(?:k|kf|K|ko)\d+[^}]*\}/.test(c.text));
  const useEnhanced = options?.enhanced ?? hasKaraoke;

  for (const c of doc.cues) {
    if (useEnhanced && /\{[^}]*\\(?:k|kf|K|ko)\d+[^}]*\}/.test(c.text)) {
      lines.push(serializeEnhancedLine(c));
    } else {
      const plain = c.text.replace(/\{[^}]*\}/g, "").replace(/\r?\n/g, " ");
      lines.push(`${lrcTime(c.startMs)}${plain}`);
    }
  }
  let out = lines.join(eol);
  if (doc.finalNewline) out += eol;
  return (doc.bom ? "\ufeff" : "") + out;
}

function serializeEnhancedLine(cue: Cue): string {
  const parts = cue.text.split(/(\{[^}]*\})/);
  let cursorMs = cue.startMs;
  let pendingDurMs = 0;
  let out = lrcTime(cue.startMs);
  let emittedAny = false;

  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("{") && part.endsWith("}")) {
      const kMatch = part.match(/\\(?:kf|k|K|ko)(\d+)/);
      if (kMatch) {
        cursorMs += pendingDurMs;
        pendingDurMs = parseInt(kMatch[1], 10) * 10;
      }
      continue;
    }
    const clean = part.replace(/\r?\n/g, " ");
    if (clean.length > 0) {
      out += `<${lrcClock(cursorMs)}>${clean}`;
      emittedAny = true;
    }
  }
  cursorMs += pendingDurMs;
  const endMs = Math.max(cue.endMs, cursorMs);
  if (emittedAny) out += `<${lrcClock(endMs)}>`;
  return out;
}

function lrcClock(ms: number): string {
  const cs = Math.max(0, Math.round(ms / 10));
  const mm = Math.floor(cs / 6000);
  const ss = Math.floor((cs % 6000) / 100);
  const cc = cs % 100;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(cc).padStart(2, "0")}`;
}

function lrcTime(ms: number): string {
  return `[${lrcClock(ms)}]`;
}
