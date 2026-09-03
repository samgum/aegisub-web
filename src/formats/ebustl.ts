import { type Cue, type SubtitleDoc } from "../cue";

export interface EbuStlOptions {
  fps: 23.976 | 24 | 25 | 29.97 | 30;
  dropFrame: boolean;
  timecodeOffsetFrames: number;
  inclusiveEndTimes: boolean;
  maxLineLength: number;
  wrapping: "auto" | "balanced" | "abort" | "skip";
  translateAlignments: boolean;
  displayStandard: "open" | "level1" | "level2";
  textEncoding: "iso6937" | "iso8859-5" | "iso8859-6" | "iso8859-7" | "iso8859-8" | "utf8";
}

export const DEFAULT_EBU_STL_OPTIONS: EbuStlOptions = {
  fps: 25, dropFrame: false, timecodeOffsetFrames: 0, inclusiveEndTimes: false,
  maxLineLength: 42, wrapping: "auto", translateAlignments: true, displayStandard: "open",
  textEncoding: "utf8",
};

const encoder = new TextEncoder();
const singleByteMaps = new Map<string, Map<string, number>>();
function encodeSingleByte(text: string, encoding: string): Uint8Array {
  let map = singleByteMaps.get(encoding);
  if (!map) {
    map = new Map<string, number>();
    const decoder = new TextDecoder(encoding.replace(/^iso8859-/, "iso-8859-"));
    for (let byte = 0; byte < 256; byte += 1) map.set(decoder.decode(new Uint8Array([byte])), byte);
    singleByteMaps.set(encoding, map);
  }
  return new Uint8Array([...text].map((character) => map!.get(character) ?? 0x3f));
}

function encodeIso6937(text: string): Uint8Array {
  const accents: Record<string, number> = { "\u0300": 0xc1, "\u0301": 0xc2, "\u0302": 0xc3, "\u0303": 0xc4, "\u0304": 0xc5, "\u0306": 0xc6, "\u0307": 0xc7, "\u0308": 0xc8, "\u030a": 0xca, "\u0327": 0xcb, "\u030b": 0xcd, "\u0328": 0xce, "\u030c": 0xcf };
  const direct: Record<string, number> = { "£": 0xa3, "€": 0xa4, "Æ": 0xe1, "Đ": 0xe2, "Ħ": 0xe4, "Ł": 0xe8, "Ø": 0xe9, "Œ": 0xea, "Þ": 0xec, "Ŧ": 0xee, "Ŋ": 0xef, "æ": 0xf1, "đ": 0xf2, "ħ": 0xf4, "ı": 0xf5, "ł": 0xf8, "ø": 0xf9, "œ": 0xfa, "ß": 0xfb, "þ": 0xfc, "ŧ": 0xfe, "ŋ": 0xff };
  const bytes: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (code < 0x80) { bytes.push(code); continue; }
    if (direct[character] != null) { bytes.push(direct[character]); continue; }
    const parts = [...character.normalize("NFD")];
    if (parts.length === 2 && parts[0].codePointAt(0)! < 0x80 && accents[parts[1]] != null) bytes.push(accents[parts[1]], parts[0].charCodeAt(0));
    else bytes.push(0x3f);
  }
  return new Uint8Array(bytes);
}

function encodeText(text: string, encoding: EbuStlOptions["textEncoding"]): Uint8Array {
  if (encoding === "utf8") return encoder.encode(text);
  if (encoding === "iso6937") return encodeIso6937(text);
  return encodeSingleByte(text, encoding);
}
const writeAscii = (target: Uint8Array, offset: number, length: number, value: string, pad = 0x20): void => {
  target.fill(pad, offset, offset + length);
  target.set(encoder.encode(value).subarray(0, length), offset);
};
const writeNumber = (target: Uint8Array, offset: number, length: number, value: number): void => writeAscii(target, offset, length, String(Math.max(0, Math.round(value))).padStart(length, " "));

function scriptInfo(doc: SubtitleDoc, key: string): string {
  return doc.assScriptInfo?.match(new RegExp(`^${key}\\s*:\\s*(.*)$`, "im"))?.[1].trim() ?? "";
}

function wrapRow(row: string, max: number, balanced: boolean): string[] {
  if ([...row].length <= max) return [row];
  const words = row.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [...row].reduce<string[]>((lines, character) => {
    const last = lines.at(-1) ?? "";
    if ([...last].length >= max) lines.push(character); else lines[lines.length - 1] = last + character;
    return lines;
  }, [""]);
  if (balanced) {
    const total = words.reduce((sum, word) => sum + [...word].length, 0) + words.length - 1;
    max = Math.min(max, Math.ceil(total / Math.ceil(total / max)));
  }
  const lines: string[] = [];
  for (const word of words) {
    const last = lines.at(-1);
    if (!last || [...`${last} ${word}`].length > max) lines.push(word); else lines[lines.length - 1] = `${last} ${word}`;
  }
  return lines;
}

function plainRows(cue: Cue, options: EbuStlOptions): string[] | null {
  const text = cue.text.replace(/\{[^}]*\}/g, "").replace(/\\[Nn]/g, "\n").replace(/\\h/g, " ");
  const rows = text.split(/\r?\n/);
  if (rows.some((row) => [...row].length > options.maxLineLength)) {
    if (options.wrapping === "abort") throw new Error(`Line over maximum length: ${text}`);
    if (options.wrapping === "skip") return null;
    return rows.flatMap((row) => wrapRow(row, options.maxLineLength, options.wrapping === "balanced"));
  }
  return rows;
}

function timecode(frame: number, fps: number): [number, number, number, number] {
  const nominal = fps < 24 ? 24 : fps < 30 ? Math.round(fps) : 30;
  const safe = Math.max(0, Math.round(frame));
  return [Math.floor(safe / (nominal * 3600)) % 100, Math.floor(safe / (nominal * 60)) % 60, Math.floor(safe / nominal) % 60, safe % nominal];
}
const asciiTimecode = (value: [number, number, number, number]): string => value.map((part) => String(part).padStart(2, "0")).join("");

function alignment(doc: SubtitleDoc, cue: Cue): number {
  const style = (doc.styles ?? []).find((item) => item.name === cue.assFields?.Style);
  const inline = cue.text.match(/\\an([1-9])/i)?.[1];
  return Number(inline ?? style?.fields.Alignment ?? 2) || 2;
}

export function encodeEbuStl(source: SubtitleDoc, options: EbuStlOptions = DEFAULT_EBU_STL_OPTIONS): Uint8Array {
  const cues = source.cues.filter((cue) => cue.assKind !== "Comment").sort((a, b) => a.startMs - b.startMs);
  const subtitles = cues.map((cue) => ({ cue, rows: plainRows(cue, options) })).filter((item): item is { cue: Cue; rows: string[] } => !!item.rows);
  if (!subtitles.length) subtitles.push({ cue: { id: "empty", startMs: 0, endMs: 1000, text: " " }, rows: [" "] });
  const textBlocks = subtitles.map(({ rows }) => {
    const bytes: number[] = [];
    rows.forEach((row, index) => {
      if (index) bytes.push(0x8a);
      bytes.push(...encodeText(row, options.textEncoding));
    });
    return new Uint8Array(bytes);
  });
  const blockCount = textBlocks.reduce((sum, text) => sum + Math.max(1, Math.ceil(text.length / 112)), 0);
  const output = new Uint8Array(1024 + blockCount * 128);
  output.fill(0x20, 0, 1024);
  writeAscii(output, 0, 3, "850");
  const disk = options.fps < 24.5 ? "STL24.01" : options.fps < 27 ? "STL25.01" : "STL30.01";
  writeAscii(output, 3, 8, disk);
  output[11] = "012"[options.displayStandard === "open" ? 0 : options.displayStandard === "level1" ? 1 : 2].charCodeAt(0);
  const encodingIndex = ["iso6937", "iso8859-5", "iso8859-6", "iso8859-7", "iso8859-8"].indexOf(options.textEncoding);
  writeAscii(output, 12, 2, options.textEncoding === "utf8" ? "U8" : `0${Math.max(0, encodingIndex)}`);
  writeAscii(output, 14, 2, "00");
  writeAscii(output, 16, 32, scriptInfo(source, "Title"));
  writeAscii(output, 144, 32, scriptInfo(source, "Original Translation"));
  const now = new Date();
  const date = `${String(now.getUTCFullYear()).slice(-2)}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
  writeAscii(output, 208, 16, `AW-${date}${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}`);
  writeAscii(output, 224, 6, date); writeAscii(output, 230, 6, date); writeAscii(output, 236, 2, "00");
  writeNumber(output, 238, 5, blockCount); writeNumber(output, 243, 5, subtitles.length); writeAscii(output, 248, 3, "001");
  writeAscii(output, 251, 2, String(options.maxLineLength).padStart(2, "0")); writeAscii(output, 253, 2, "99"); output[255] = 0x31;
  const programme = timecode(options.timecodeOffsetFrames, options.fps); writeAscii(output, 256, 8, asciiTimecode(programme));
  writeAscii(output, 272, 1, "1"); writeAscii(output, 273, 1, "1"); writeAscii(output, 274, 3, "XXX");
  writeAscii(output, 309, 32, scriptInfo(source, "Original Editing"));
  writeAscii(output, 448, 576, options.textEncoding === "utf8" ? "Exported by Aegisub Web using non-standard UTF-8 subtitle text (CCT=U8)." : "Exported by Aegisub Web.");

  let blockIndex = 0;
  subtitles.forEach(({ cue, rows }, subtitleNumber) => {
    const text = textBlocks[subtitleNumber];
    const blocks = Math.max(1, Math.ceil(text.length / 112));
    const startFrame = Math.round(cue.startMs * options.fps / 1000) + options.timecodeOffsetFrames;
    let endFrame = Math.round(cue.endMs * options.fps / 1000) + options.timecodeOffsetFrames;
    if (options.inclusiveEndTimes) endFrame = Math.max(startFrame, endFrame - 1);
    const align = alignment(source, cue);
    for (let part = 0; part < blocks; part += 1) {
      const offset = 1024 + blockIndex++ * 128;
      output[offset] = 0;
      new DataView(output.buffer).setUint16(offset + 1, subtitleNumber, true);
      output[offset + 3] = part === blocks - 1 ? 0xff : part;
      output[offset + 4] = 0;
      output.set(timecode(startFrame, options.fps), offset + 5);
      output.set(timecode(endFrame, options.fps), offset + 9);
      output[offset + 13] = options.translateAlignments ? (align >= 7 ? 0 : align >= 4 ? 50 : options.displayStandard === "open" ? 99 : 23) : options.displayStandard === "open" ? 99 : 23;
      output[offset + 14] = options.translateAlignments ? ((align - 1) % 3) + 1 : 2;
      output[offset + 15] = 0;
      output.fill(0x8f, offset + 16, offset + 128);
      output.set(text.subarray(part * 112, (part + 1) * 112), offset + 16);
    }
    void rows;
  });
  const firstTc = [...output.subarray(1024 + 5, 1024 + 9)] as [number, number, number, number];
  writeAscii(output, 264, 8, asciiTimecode(firstTc));
  return output;
}
