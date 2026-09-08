// Read the real family names of fonts embedded in an ASS [Fonts] section. Each font is a
// "fontname: <file>" line followed by the font binary encoded in VSFilter's UUEncode-like
// scheme (3 bytes -> 4 chars, each a 6-bit value + 33). We decode enough to read the
// TrueType/OpenType `name` table; anything unparseable falls back to the filename.

export interface EmbeddedFont {
  filename: string;
  family: string | null;
  /** Family, full and PostScript names available to the subtitle renderer. */
  names?: string[];
  /** Decoded font bytes, ready for FontFace/libass rather than merely inventory display. */
  bytes: Uint8Array;
  mime: string;
}

// Decode VSFilter-embedded font data (a run of encoded lines) to bytes.
function uudecode(encoded: string): Uint8Array {
  const chars = encoded.replace(/[^\x21-\x60]/g, ""); // keep only the 33..96 alphabet
  const out = new Uint8Array(Math.floor(chars.length * 3 / 4));
  let position = 0;
  for (let i = 0; i < chars.length; i += 4) {
    const n = Math.min(4, chars.length - i);
    const a = chars.charCodeAt(i) - 33, b = chars.charCodeAt(i + 1) - 33;
    const c = chars.charCodeAt(i + 2) - 33, d = chars.charCodeAt(i + 3) - 33;
    if (n >= 2) out[position++] = (a << 2) | (b >> 4);
    if (n >= 3) out[position++] = (b << 4) | (c >> 2);
    if (n >= 4) out[position++] = (c << 6) | d;
  }
  return out;
}

// Read the family (name ID 1) or full name (4) from a sfnt/TTC font binary. Prefers the
// Windows platform record. Returns null on any structural problem.
function fontNames(bytes: Uint8Array): { family: string | null; names: string[] } {
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (o: number) => dv.getUint16(o);
    const u32 = (o: number) => dv.getUint32(o);
    let dir = 0;
    if (u32(0) === 0x74746366) dir = u32(12); // 'ttcf' collection: use the first font
    const numTables = u16(dir + 4);
    let nameOff = -1;
    for (let i = 0; i < numTables; i++) {
      const rec = dir + 12 + i * 16;
      if (u32(rec) === 0x6e616d65) {
        nameOff = u32(rec + 8); // 'name'
        break;
      }
    }
    if (nameOff < 0) return { family: null, names: [] };
    const count = u16(nameOff + 2);
    const storage = nameOff + u16(nameOff + 4);
    let best: string | null = null;
    let bestScore = -1;
    const names = new Set<string>();
    for (let i = 0; i < count; i++) {
      const rec = nameOff + 6 + i * 12;
      const platformID = u16(rec);
      const nameID = u16(rec + 6);
      const len = u16(rec + 8);
      const off = storage + u16(rec + 10);
      if (![1, 4, 6, 16].includes(nameID)) continue;
      let s = "";
      if (platformID === 3 || platformID === 0) {
        for (let j = 0; j + 1 < len; j += 2) s += String.fromCharCode(u16(off + j)); // UTF-16BE
      } else {
        for (let j = 0; j < len; j++) s += String.fromCharCode(bytes[off + j]); // Mac/ASCII
      }
      if (s.trim()) names.add(s.trim());
      const score = (nameID === 1 ? 4 : nameID === 16 ? 2 : 0) + (platformID === 3 ? 1 : 0);
      if (s.trim() && score > bestScore) {
        best = s.trim();
        bestScore = score;
      }
    }
    return { family: best, names: [...names] };
  } catch {
    return { family: null, names: [] };
  }
}

// Parse every embedded font declared in the raw ASS text (the section is byte-preserved,
// so we scan for its "fontname:" markers directly).
export function parseEmbeddedFonts(raw: string): EmbeddedFont[] {
  const lines = raw.split(/\r?\n/);
  const fonts: EmbeddedFont[] = [];
  let current: { filename: string; data: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const bytes = current.data.length ? uudecode(current.data.join("")) : new Uint8Array(0);
    const { family, names } = bytes.length ? fontNames(bytes) : { family: null, names: [] };
    const ext = current.filename.split(".").pop()?.toLowerCase();
    const mime = ext === "otf" ? "font/otf" : ext === "woff" ? "font/woff" : ext === "woff2" ? "font/woff2" : "font/ttf";
    fonts.push({ filename: current.filename, family, names, bytes, mime });
    current = null;
  };
  for (const line of lines) {
    const m = line.match(/^fontname:\s*(.+?)\s*$/i);
    if (m) {
      flush();
      current = { filename: m[1], data: [] };
    } else if (/^\[.+\]\s*$/.test(line)) {
      flush(); // a new [Section] ends the font list
    } else if (current) {
      current.data.push(line);
    }
  }
  flush();
  return fonts;
}
