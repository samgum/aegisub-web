import { type SubtitleDoc } from "../cue";

const plainText = (text: string): string => text.replace(/\{[^}]*\}/g, "").replace(/\\[Nn]/g, "\r\n").replace(/\\h/g, " ");

function smpte(ms: number, fps: number, separator = ":"): string {
  const frames = Math.max(0, Math.round(ms * fps / 1000));
  const nominal = Math.round(fps);
  const h = Math.floor(frames / (nominal * 3600));
  const m = Math.floor(frames / (nominal * 60)) % 60;
  const s = Math.floor(frames / nominal) % 60;
  const f = frames % nominal;
  return [h, m, s].map((value) => String(value).padStart(2, "0")).join(":") + separator + String(f).padStart(2, "0");
}

export function serializeEncore(doc: SubtitleDoc, fps = 25): string {
  const separator = Math.abs(fps - 29.97) < .02 ? ";" : ":";
  return doc.cues.filter((cue) => cue.assKind !== "Comment").sort((a, b) => a.startMs - b.startMs).map((cue, index) =>
    `${index + 1} ${smpte(cue.startMs, fps, separator)} ${smpte(cue.endMs, fps, separator)} ${plainText(cue.text)}`,
  ).join("\r\n") + "\r\n";
}

export function serializeTranStation(doc: SubtitleDoc, fps = 25): string {
  const cues = doc.cues.filter((cue) => cue.assKind !== "Comment").sort((a, b) => a.startMs - b.startMs);
  const lines: string[] = [];
  cues.forEach((cue, index) => {
    const style = (doc.styles ?? []).find((item) => item.name === cue.assFields?.Style);
    const alignment = Number(style?.fields.Alignment ?? 2);
    const vertical = alignment >= 7 ? 9 : alignment >= 4 ? 4 : 0;
    const horizontal = [1, 4, 7].includes(alignment) ? "L" : [3, 6, 9].includes(alignment) ? "R" : " ";
    const italic = style?.fields.Italic !== "0" || /\\i1/.test(cue.text) ? "I" : "N";
    let end = cue.endMs;
    if (cues[index + 1] && cues[index + 1].startMs === end) end = Math.max(cue.startMs, end - 1000 / fps);
    lines.push(`SUB[${vertical}${horizontal}${italic} ${smpte(cue.startMs, fps)}>${smpte(end, fps)}]\r\n${plainText(cue.text)}`);
  });
  return `${lines.join("\r\n\r\n")}\r\nSUB[\r\n`;
}

function ssaColor(value: string | undefined): string {
  const hex = (value ?? "&H00FFFFFF").replace(/[^0-9a-f]/gi, "").padStart(8, "0").slice(-8);
  return `&H${hex.slice(2)}`;
}

function assToSsaAlignment(alignment: number): number {
  return ({ 1: 1, 2: 2, 3: 3, 4: 9, 5: 10, 6: 11, 7: 5, 8: 6, 9: 7 } as Record<number, number>)[alignment] ?? 2;
}

export function serializeSsa(doc: SubtitleDoc): string {
  const eol = doc.eol;
  const info = (doc.assScriptInfo ?? "[Script Info]").replace(/^ScriptType\s*:\s*.*$/im, "ScriptType: v4.00").split(/\r?\n/).filter((line) => !/^\[V4\+? Styles\]/i.test(line) && !/^Format\s*:/i.test(line));
  const lines = [...info, "", "[V4 Styles]", "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, TertiaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, AlphaLevel, Encoding"];
  for (const style of doc.styles ?? []) {
    const f = style.fields;
    lines.push(`Style: ${style.name.replace(/,/g, ";")},${f.Fontname},${f.Fontsize},${ssaColor(f.PrimaryColour)},${ssaColor(f.SecondaryColour)},0,${ssaColor(f.BackColour)},${f.Bold},${f.Italic},${f.BorderStyle},${f.Outline},${f.Shadow},${assToSsaAlignment(Number(f.Alignment))},${f.MarginL},${f.MarginR},${f.MarginV},0,${f.Encoding}`);
  }
  lines.push("", "[Events]", "Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text");
  for (const cue of doc.cues) {
    const fields = cue.assFields ?? {};
    const time = (ms: number): string => { const cs = Math.max(0, Math.round(ms / 10)); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`; };
    lines.push(`${cue.assKind === "Comment" ? "Comment" : "Dialogue"}: Marked=0,${time(cue.startMs)},${time(cue.endMs)},${(fields.Style ?? "Default").replace(/,/g, ";")},${(fields.Name ?? "").replace(/,/g, ";")},${fields.MarginL ?? 0},${fields.MarginR ?? 0},${fields.MarginV ?? 0},${(fields.Effect ?? "").replace(/,/g, ";")},${cue.text.replace(/[\r\n]/g, "")}`);
  }
  return lines.join(eol) + (doc.finalNewline ? eol : "");
}
