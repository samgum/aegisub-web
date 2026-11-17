// TTML / DFXP (.ttml/.dfxp): the common timed-text caption profile used by broadcast and
// streaming. Supports default or prefixed namespaces (<p>/<tt:p>, <span>/<tt:span>, <br/>/<tt:br/>),
// clock/offset/dur/seconds attributes, untimed <p> fallback, nested wrapper spans, word-level
// <span begin=.. end=..> karaoke mapped to ASS \kf/\k tags, and Apple Music ttm:role="x-bg"
// overlapping harmony splitting.

import { type Cue, type SubtitleDoc, detectEol, newCueId } from "../cue";

const P_RE = /<(?:[a-zA-Z0-9_]+:)?p\b([^>]*)>([\s\S]*?)<\/(?:[a-zA-Z0-9_]+:)?p>/gi;

interface XmlElementNode {
  kind: "element";
  localName: string;
  attrs: string;
  children: XmlNode[];
}

interface XmlTextNode {
  kind: "text";
  text: string;
}

type XmlNode = XmlElementNode | XmlTextNode;

interface TtmlSegment {
  beginMs: number;
  endMs: number;
  text: string;
  bg: boolean;
}

function localXmlName(name: string): string {
  const colon = name.indexOf(":");
  return colon >= 0 ? name.slice(colon + 1).toLowerCase() : name.toLowerCase();
}

function parseInnerXml(html: string): XmlNode[] {
  const root: XmlElementNode = { kind: "element", localName: "", attrs: "", children: [] };
  const stack: XmlElementNode[] = [root];
  const tokenRe = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<(\/?)([a-zA-Z0-9_:-]+)([^>]*?)(\/?)>/g;
  let cursor = 0;
  let m: RegExpExecArray | null;

  while ((m = tokenRe.exec(html))) {
    if (m.index > cursor) {
      stack[stack.length - 1].children.push({
        kind: "text",
        text: unescapeXml(html.slice(cursor, m.index)),
      });
    }
    cursor = m.index + m[0].length;
    if (m[1] !== undefined) {
      stack[stack.length - 1].children.push({ kind: "text", text: m[1] });
      continue;
    }
    const tagName = m[3];
    if (!tagName) continue; // comment
    const closing = m[2] === "/";
    const localName = localXmlName(tagName);
    const selfClosing = m[5] === "/" || localName === "br";

    if (closing) {
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].localName === localName) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const node: XmlElementNode = {
      kind: "element",
      localName,
      attrs: m[4] ?? "",
      children: [],
    };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }

  if (cursor < html.length) {
    stack[stack.length - 1].children.push({
      kind: "text",
      text: unescapeXml(html.slice(cursor)),
    });
  }
  return root.children;
}

function attrValue(attrs: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)(?:[a-zA-Z0-9_]+:)?${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const m = attrs.match(re);
  return m ? (m[1] ?? m[2] ?? "").trim() : null;
}

function collectVisibleText(nodes: readonly XmlNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.kind === "text") {
      out += node.text;
    } else if (node.localName === "br") {
      out += "\n";
    } else {
      out += collectVisibleText(node.children);
    }
  }
  return out;
}

function hasTimedSpan(nodes: readonly XmlNode[]): boolean {
  for (const node of nodes) {
    if (node.kind !== "element") continue;
    if (node.localName === "span" && attrTime(node.attrs, "begin") != null) return true;
    if (hasTimedSpan(node.children)) return true;
  }
  return false;
}

function karaokeCs(ms: number): number {
  return Math.max(0, Math.floor((ms + 5) / 10));
}

function buildKaraokeText(segs: readonly TtmlSegment[], lineBegin: number, lineEnd: number): string {
  let out = "";
  let elapsedCs = 0;
  for (let s = 0; s < segs.length; s += 1) {
    const segBegin = Math.min(Math.max(segs[s].beginMs, lineBegin), lineEnd);
    const beginCs = karaokeCs(segBegin - lineBegin);
    if (beginCs > elapsedCs) {
      out += `{\\k${beginCs - elapsedCs}}`;
      elapsedCs = beginCs;
    }
    let segEnd = segs[s].endMs > segs[s].beginMs ? segs[s].endMs : lineEnd;
    if (s + 1 < segs.length) segEnd = Math.min(segEnd, segs[s + 1].beginMs);
    segEnd = Math.min(Math.max(segEnd, segBegin), lineEnd);
    const endCs = karaokeCs(segEnd - lineBegin);
    const durCs = Math.max(0, endCs - elapsedCs);
    out += `{\\kf${durCs}}${segs[s].text}`;
    elapsedCs += durCs;
  }
  return out;
}

export function parseTtml(raw: string): SubtitleDoc {
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  const eol = detectEol(body);
  const lang = body.match(/xml:lang\s*=\s*"([^"]*)"/i)?.[1] ?? "";
  const cues: Cue[] = [];
  let m: RegExpExecArray | null;
  P_RE.lastIndex = 0;

  while ((m = P_RE.exec(body))) {
    const attrs = m[1];
    const inner = m[2];
    const rawBegin = attrValue(attrs, "begin");
    const beginParsed = attrTime(attrs, "begin");
    if (rawBegin != null && beginParsed == null) continue; // malformed begin attribute

    const paragraphTimed = beginParsed != null;
    let beginMs = beginParsed ?? 0;
    const endAttr = attrTime(attrs, "end");
    const durAttr = attrTime(attrs, "dur");

    const nodes = parseInnerXml(inner);
    const timedSpans = hasTimedSpan(nodes);

    if (!timedSpans) {
      const endMs = endAttr != null
        ? Math.max(beginMs, endAttr)
        : durAttr != null
          ? beginMs + durAttr
          : paragraphTimed
            ? beginMs + 3000
            : 0;
      const text = collectVisibleText(nodes).trim();
      if (paragraphTimed || text.length > 0) {
        cues.push({ id: newCueId(), startMs: beginMs, endMs, text });
      }
      continue;
    }

    let plain = "";
    let hasKaraoke = false;
    const segments: TtmlSegment[] = [];

    const walk = (children: readonly XmlNode[], bgVoice: boolean): void => {
      for (const node of children) {
        if (node.kind === "text") {
          if (hasKaraoke && segments.length > 0) segments[segments.length - 1].text += node.text;
          else plain += node.text;
          continue;
        }
        if (node.localName === "br") {
          if (hasKaraoke && segments.length > 0) segments[segments.length - 1].text += "\n";
          else plain += "\n";
          continue;
        }
        if (node.localName === "span") {
          const role = attrValue(node.attrs, "role") ?? "";
          const voiceBg = bgVoice || role.startsWith("x-bg");
          const spanText = collectVisibleText(node.children);
          const spanBegin = attrTime(node.attrs, "begin");
          const spanEndAttr = attrTime(node.attrs, "end");
          const spanDurAttr = attrTime(node.attrs, "dur");
          const spanEnd = spanEndAttr ?? (spanBegin != null && spanDurAttr != null ? spanBegin + spanDurAttr : -1);

          if (spanBegin != null && spanText.length > 0) {
            hasKaraoke = true;
            segments.push({ beginMs: spanBegin, endMs: spanEnd, text: spanText, bg: voiceBg });
          } else if (spanText.length > 0) {
            walk(node.children, voiceBg);
          }
          continue;
        }
        walk(node.children, bgVoice);
      }
    };

    walk(nodes, false);
    if (!hasKaraoke || segments.length === 0) continue;

    segments.sort((a, b) => a.beginMs - b.beginMs);
    let endMs = endAttr != null
      ? Math.max(beginMs, endAttr)
      : durAttr != null
        ? beginMs + durAttr
        : paragraphTimed
          ? beginMs
          : 0;

    if (!paragraphTimed || endMs <= beginMs) {
      if (!paragraphTimed) beginMs = segments[0].beginMs;
      endMs = Math.max(
        beginMs,
        ...segments.map((seg) => (seg.endMs > seg.beginMs ? seg.endMs : seg.beginMs + 500)),
      );
    }

    const leadSegs = segments.filter((seg) => !seg.bg);
    const bgSegs = segments.filter((seg) => seg.bg);
    const leadLastEnd = leadSegs.reduce(
      (max, seg) => Math.max(max, seg.endMs > seg.beginMs ? seg.endMs : seg.beginMs),
      0,
    );

    if (bgSegs.length > 0 && leadSegs.length > 0 && bgSegs[0].beginMs < leadLastEnd) {
      const harmonyBegin = Math.max(beginMs, bgSegs[0].beginMs);
      const harmonyEnd = Math.max(
        endMs,
        harmonyBegin,
        ...bgSegs.map((seg) => (seg.endMs > seg.beginMs ? seg.endMs : seg.beginMs)),
      );
      const leadText = (plain.trimStart() + buildKaraokeText(leadSegs, beginMs, endMs)).trim();
      const harmonyText = buildKaraokeText(bgSegs, harmonyBegin, harmonyEnd).trim();
      if (leadText && harmonyText) {
        cues.push({ id: newCueId(), startMs: beginMs, endMs, text: leadText });
        cues.push({ id: newCueId(), startMs: harmonyBegin, endMs: harmonyEnd, text: harmonyText });
        continue;
      }
    }

    const combined = (plain.trimStart() + buildKaraokeText(segments, beginMs, endMs)).trim();
    if (combined) {
      cues.push({ id: newCueId(), startMs: beginMs, endMs, text: combined });
    }
  }

  cues.sort((a, b) => a.startMs - b.startMs);
  return { format: "ttml", cues, eol, bom, finalNewline: /\n$/.test(body), header: lang || undefined };
}

export function serializeTtml(doc: SubtitleDoc): string {
  const eol = doc.eol;
  const lang = doc.header ? ` xml:lang="${escapeXml(doc.header)}"` : "";
  const rows = doc.cues.map((c) => {
    if (/\{[^}]*\\(?:kf|k|K|ko)\d+[^}]*\}/.test(c.text)) {
      return `      <p begin="${ttmlTime(c.startMs)}" end="${ttmlTime(c.endMs)}">${serializeTtmlKaraoke(c)}</p>`;
    }
    return `      <p begin="${ttmlTime(c.startMs)}" end="${ttmlTime(c.endMs)}">${escapeXml(c.text).replace(/\n/g, "<br/>")}</p>`;
  });
  const out = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<tt xmlns="http://www.w3.org/ns/ttml"${lang}>`,
    `  <body>`,
    `    <div>`,
    ...rows,
    `    </div>`,
    `  </body>`,
    `</tt>`,
  ].join(eol);
  return (doc.bom ? "\ufeff" : "") + out + (doc.finalNewline ? eol : "");
}

function serializeTtmlKaraoke(cue: Cue): string {
  const parts = cue.text.split(/(\{[^}]*\})/);
  let cursor = cue.startMs;
  let pendingMs = 0;
  let out = "";
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("{") && part.endsWith("}")) {
      const m = part.match(/\\(?:kf|k|K|ko)(\d+)/);
      if (m) {
        cursor += pendingMs;
        pendingMs = parseInt(m[1], 10) * 10;
      }
      continue;
    }
    const end = Math.min(cue.endMs, Math.max(cursor, cursor + pendingMs));
    out += `<span begin="${ttmlTime(cursor)}" end="${ttmlTime(end)}">${escapeXml(part).replace(/\n/g, "<br/>")}</span>`;
  }
  return out;
}

// begin/end/dur may be a clock ("[HH:]MM:SS[.mmm]"), an offset ("12.5s"/"200ms"/"..."), or bare
// seconds. Returns milliseconds, or null when the attribute is absent/unparseable.
function attrTime(attrs: string, name: string): number | null {
  const v = attrValue(attrs, name);
  if (!v) return null;
  const off = v.match(/^([\d.]+)(ms|s|m|h)$/i);
  if (off) {
    const n = parseFloat(off[1]);
    const unit = off[2].toLowerCase();
    return Math.round(n * (unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60000 : 3600000));
  }
  const clock = v.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (clock) {
    const h = clock[1] ? parseInt(clock[1], 10) : 0;
    const frac = clock[4] ? parseInt(clock[4].padEnd(3, "0").slice(0, 3), 10) : 0;
    return ((h * 60 + parseInt(clock[2], 10)) * 60 + parseInt(clock[3], 10)) * 1000 + frac;
  }
  if (/^[\d.]+$/.test(v)) return Math.round(parseFloat(v) * 1000);
  return null;
}

function ttmlTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const mmm = total % 1000;
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(h)}:${p2(m)}:${p2(s)}.${String(mmm).padStart(3, "0")}`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
