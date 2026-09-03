import { type Cue, type SubtitleDoc, newCueId, visibleText } from "../cue";
import { defaultAssParts, ASS_EVENT_FORMAT, DEFAULT_STYLE_FORMAT } from "./ass";

export interface PlainTextImportOptions {
  actorSeparator: string;
  commentStarter: string;
  includeBlank: boolean;
}

export function importPlainText(raw: string, options: PlainTextImportOptions): SubtitleDoc {
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const parts = defaultAssParts(eol);
  const cues: Cue[] = [];
  let actor = "";
  const lines = raw.replace(/^﻿/, "").split(/\r?\n/);
  if (/\r?\n$/.test(raw)) lines.pop();
  for (const rawLine of lines) {
    if (!rawLine && !options.includeBlank) continue;
    if (/^#\s*timecode/i.test(rawLine)) throw new Error("File is a timecode file, not plain-text subtitles.");
    let text = rawLine;
    let comment = false;
    if (options.commentStarter && text.startsWith(options.commentStarter)) {
      comment = true;
      text = text.slice(options.commentStarter.length);
    }
    if (!comment && options.actorSeparator && text && !/^\s/.test(text)) {
      const position = text.indexOf(options.actorSeparator);
      if (position >= 0) {
        actor = text.slice(0, position).trim();
        text = text.slice(position + options.actorSeparator.length);
      }
    }
    text = text.trimStart();
    if (!text) comment = true;
    cues.push({ id: newCueId(), startMs: 0, endMs: 0, text, assKind: comment ? "Comment" : "Dialogue", assFields: { Layer: "0", Style: "Default", Name: comment ? "" : actor, MarginL: "0", MarginR: "0", MarginV: "0", Effect: "" } });
  }
  return { format: "ass", cues, eol, bom: raw.charCodeAt(0) === 0xfeff, finalNewline: /\r?\n$/.test(raw), assScriptInfo: parts.scriptInfo, styles: parts.styles, assStylesTail: parts.tail, assStyleFormat: DEFAULT_STYLE_FORMAT, assFormat: ASS_EVENT_FORMAT };
}

export function exportPlainText(doc: SubtitleDoc, commentStarter = "# "): string {
  const dialogue = doc.cues.filter((cue) => cue.assKind !== "Comment");
  const actors = dialogue.filter((cue) => (cue.assFields?.Name ?? "") !== "").length;
  const writeActors = actors > dialogue.length / 2;
  const lines = ["# Exported by Aegisub Web"];
  for (const cue of doc.cues) {
    const text = visibleText(cue.text);
    if (!text) continue;
    lines.push(`${cue.assKind === "Comment" ? commentStarter : ""}${writeActors && cue.assKind !== "Comment" ? `${cue.assFields?.Name ?? ""}: ` : ""}${text}`);
  }
  return lines.join(doc.eol) + (doc.finalNewline ? doc.eol : "");
}
