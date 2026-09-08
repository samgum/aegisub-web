import type { SubtitleDoc } from "./cue";

/** Families actually requested by styles and static inline \fn overrides. Text outside
 * override blocks and nested transforms are not font declarations. */
export function requestedFontFamilies(doc: SubtitleDoc): string[] {
  const families = new Set<string>();
  const add = (value: string) => { const family = value.trim().replace(/^@/, ""); if (family) families.add(family); };
  for (const style of doc.styles ?? []) add(style.fields.Fontname ?? "");
  for (const cue of doc.cues) for (const match of cue.text.matchAll(/\{([^}]*)\}/g)) {
    const block = match[1];
    let depth = 0;
    for (let i = 0; i < block.length; i++) {
      if (block[i] === "(") depth++;
      else if (block[i] === ")") depth = Math.max(0, depth - 1);
      else if (depth === 0 && block.startsWith("\\fn", i)) {
        const next = block.indexOf("\\", i + 3);
        add(block.slice(i + 3, next < 0 ? undefined : next));
        i = next < 0 ? block.length : next - 1;
      }
    }
  }
  return [...families];
}

export function bundledFontFilename(family: string): string | null {
  const name = family.trim().toLowerCase().replace(/^@/, "").replace(/[\s_-]+/g, " ");
  const sans = /^(?:source han sans cn|思源黑体(?: cn)?)(?: (regular|medium|heavy|常规|中等|特粗))?$/i.exec(name);
  if (sans) {
    const weight = /heavy|特粗/.test(sans[1] ?? "") ? "Heavy" : /medium|中等/.test(sans[1] ?? "") ? "Medium" : "Regular";
    return `SourceHanSansCN-${weight}.otf`;
  }
  if (/^(?:source han serif cn|思源宋体(?: cn)?) (?:heavy|特粗)$/.test(name)) return "SourceHanSerifCN-Heavy.otf";
  // Do not silently label an unbundled Bold/Light/etc. face as an exact Regular match.
  return null;
}

export function bundledPreviewFonts(doc: SubtitleDoc): string[] {
  const files = new Set<string>();
  if (doc.cues.some(cue => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(cue.text))) files.add("SourceHanSansCN-Regular.otf");
  if (doc.format === "ass") for (const family of requestedFontFamilies(doc)) { const file = bundledFontFilename(family); if (file) files.add(file); }
  return [...files].sort();
}

/** Content fingerprint for a non-security cache key, including same-name/same-size edits. */
export function fontBytesFingerprint(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193);
  return `${bytes.byteLength}:${(hash >>> 0).toString(16)}`;
}

export function matchingLocalFonts<T extends { family: string; fullName: string; postscriptName: string }>(fonts: T[], wantedFamilies: string[]): T[] {
  const normalize = (name: string) => name.trim().replace(/^@/, "").toLowerCase();
  const wanted = new Set(wantedFamilies.map(normalize));
  const unique = new Map<string, T>();
  for (const font of fonts) if ([font.family, font.fullName, font.postscriptName].some(name => wanted.has(normalize(name)))) {
    unique.set(font.postscriptName || font.fullName, font);
  }
  return [...unique.values()];
}
