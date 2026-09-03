import { type Cue, type SubtitleFormat, blankCue, newCueId, visibleText } from "./cue";

const copyCue = (cue: Cue): Cue => structuredClone(cue);
const lineBreak = (format: SubtitleFormat): string => format === "ass" ? "\\N" : "\n";

export type GridSortKey = "actor" | "effect" | "end" | "layer" | "start" | "style";

function compareField(a: Cue, b: Cue, key: GridSortKey): number {
  const text = (cue: Cue, field: string): string => (cue.assFields?.[field] ?? "").toLocaleLowerCase();
  switch (key) {
    case "start": return a.startMs - b.startMs || a.endMs - b.endMs;
    case "end": return a.endMs - b.endMs || a.startMs - b.startMs;
    case "layer": return Number(a.assFields?.Layer ?? 0) - Number(b.assFields?.Layer ?? 0);
    case "actor": return text(a, "Name").localeCompare(text(b, "Name"));
    case "effect": return text(a, "Effect").localeCompare(text(b, "Effect"));
    case "style": return text(a, "Style").localeCompare(text(b, "Style"));
  }
}

/** Sort all cues, or sort selected cues within their existing slots. */
export function sortCueGrid(cues: Cue[], key: GridSortKey, selected?: ReadonlySet<string>): Cue[] {
  const out = cues.map(copyCue);
  if (!selected) return out.map((cue, index) => ({ cue, index })).sort((a, b) => compareField(a.cue, b.cue, key) || a.index - b.index).map((item) => item.cue);
  const slots = out.map((cue, index) => selected.has(cue.id) ? index : -1).filter((index) => index >= 0);
  const sorted = slots.map((index) => out[index]).map((cue, index) => ({ cue, index })).sort((a, b) => compareField(a.cue, b.cue, key) || a.index - b.index).map((item) => item.cue);
  slots.forEach((slot, index) => { out[slot] = sorted[index]; });
  return out;
}

export function moveSelectedRows(cues: Cue[], selected: ReadonlySet<string>, direction: "up" | "down"): Cue[] {
  const out = cues.map(copyCue);
  if (direction === "up") {
    for (let index = 1; index < out.length; index += 1) {
      if (selected.has(out[index].id) && !selected.has(out[index - 1].id)) [out[index - 1], out[index]] = [out[index], out[index - 1]];
    }
  } else {
    for (let index = out.length - 2; index >= 0; index -= 1) {
      if (selected.has(out[index].id) && !selected.has(out[index + 1].id)) [out[index], out[index + 1]] = [out[index + 1], out[index]];
    }
  }
  return out;
}

export function swapSelectedRows(cues: Cue[], selected: ReadonlySet<string>): Cue[] | null {
  const indices = cues.map((cue, index) => selected.has(cue.id) ? index : -1).filter((index) => index >= 0);
  if (indices.length !== 2) return null;
  const out = cues.map(copyCue);
  [out[indices[0]], out[indices[1]]] = [out[indices[1]], out[indices[0]]];
  return out;
}

export type JoinMode = "concatenate" | "keep-first" | "karaoke";

export function joinSelectedCues(
  cues: Cue[],
  selected: ReadonlySet<string>,
  mode: JoinMode,
  format: SubtitleFormat,
): { cues: Cue[]; joinedId: string } | null {
  const indices = cues.map((cue, index) => selected.has(cue.id) ? index : -1).filter((index) => index >= 0);
  if (indices.length < 2) return null;
  const chosen = indices.map((index) => cues[index]);
  const first = copyCue(chosen[0]);
  first.startMs = Math.min(...chosen.map((cue) => cue.startMs));
  first.endMs = Math.max(...chosen.map((cue) => cue.endMs));
  if (mode === "concatenate") first.text = chosen.map((cue) => cue.text).join(lineBreak(format));
  if (mode === "karaoke") {
    first.text = chosen.map((cue) => {
      const centiseconds = Math.max(1, Math.round((cue.endMs - cue.startMs) / 10));
      return `{\\k${centiseconds}}${cue.text}`;
    }).join("");
  }
  const indexSet = new Set(indices);
  const out = cues.filter((_cue, index) => !indexSet.has(index)).map(copyCue);
  out.splice(indices[0], 0, first);
  return { cues: out, joinedId: first.id };
}

function trimRecombineText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** Port of Aegisub's Recombine Lines prefix/suffix reduction. */
export function recombineSelectedCues(cues: Cue[], selected: ReadonlySet<string>): { cues: Cue[]; selectedIds: string[] } {
  const out = cues.map(copyCue);
  const chosen = out.filter((cue) => selected.has(cue.id)).sort((a, b) => a.startMs - b.startMs);
  const deleted = new Set<string>();
  for (const cue of chosen) cue.text = trimRecombineText(cue.text);
  const expand = (source: Cue, destination: Cue): void => {
    destination.startMs = Math.min(destination.startMs, source.startMs);
    destination.endMs = Math.max(destination.endMs, source.endMs);
  };
  for (let firstIndex = 0; firstIndex < chosen.length - 1; firstIndex += 1) {
    const first = chosen[firstIndex];
    if (deleted.has(first.id)) continue;
    for (let secondIndex = firstIndex + 1; secondIndex < chosen.length; secondIndex += 1) {
      const second = chosen[secondIndex];
      if (deleted.has(second.id)) continue;
      if (first.text === second.text) {
        expand(first, second);
        deleted.add(first.id);
        break;
      }
      if (!first.text) { deleted.add(first.id); break; }
      if (!second.text) { deleted.add(second.id); continue; }
      if (second.text.startsWith(first.text)) {
        second.text = trimRecombineText(second.text.slice(first.text.length));
        expand(second, first);
      } else if (second.text.endsWith(first.text)) {
        second.text = trimRecombineText(second.text.slice(0, -first.text.length));
        expand(second, first);
      } else if (first.text.endsWith(second.text)) {
        first.text = trimRecombineText(first.text.slice(0, -second.text.length));
        expand(first, second);
      } else if (first.text.startsWith(second.text)) {
        first.text = trimRecombineText(first.text.slice(second.text.length));
        expand(first, second);
      }
    }
  }
  const survivors = out.filter((cue) => !deleted.has(cue.id) && cue.text !== "");
  return { cues: survivors, selectedIds: survivors.filter((cue) => selected.has(cue.id)).map((cue) => cue.id) };
}

export interface KaraokeSyllable {
  durationCs: number;
  text: string;
}

export function parseKaraokeSyllables(text: string): KaraokeSyllable[] {
  const matches = [...text.matchAll(/\{[^}]*\\(?:k|K|kf|ko)(\d+)[^}]*\}([\s\S]*?)(?=\{[^}]*\\(?:k|K|kf|ko)\d+[^}]*\}|$)/g)];
  return matches.map((match) => ({ durationCs: Number(match[1]), text: match[2] }));
}

export function splitCueByKaraoke(cues: Cue[], cueId: string): { cues: Cue[]; newIds: string[] } | null {
  const index = cues.findIndex((cue) => cue.id === cueId);
  const source = cues[index];
  if (!source) return null;
  const syllables = parseKaraokeSyllables(source.text);
  if (syllables.length < 2) return null;
  let cursor = source.startMs;
  const made = syllables.map((syllable, syllableIndex) => {
    const end = syllableIndex === syllables.length - 1
      ? source.endMs
      : Math.min(source.endMs, cursor + syllable.durationCs * 10);
    const cue: Cue = {
      ...copyCue(source),
      id: newCueId(),
      startMs: cursor,
      endMs: Math.max(cursor + 1, end),
      text: syllable.text,
    };
    cursor = cue.endMs;
    return cue;
  });
  const out = cues.map(copyCue);
  out.splice(index, 1, ...made);
  return { cues: out, newIds: made.map((cue) => cue.id) };
}

export type SplitTimingMode = "estimate" | "preserve" | "video";

export function splitCueAtText(
  cues: Cue[],
  cueId: string,
  offset: number,
  mode: SplitTimingMode,
  playheadMs?: number,
): { cues: Cue[]; ids: [string, string] } | null {
  const index = cues.findIndex((cue) => cue.id === cueId);
  const source = cues[index];
  if (!source || source.text.length < 2) return null;
  const at = Math.max(1, Math.min(source.text.length - 1, offset > 0 ? offset : Math.floor(source.text.length / 2)));
  const leftText = source.text.slice(0, at).trimEnd();
  const rightText = source.text.slice(at).trimStart();
  if (!leftText && !rightText) return null;
  let splitMs: number;
  if (mode === "preserve") splitMs = source.startMs;
  else if (mode === "video" && playheadMs != null) splitMs = Math.max(source.startMs + 1, Math.min(source.endMs - 1, playheadMs));
  else {
    const ratio = leftText.length / Math.max(1, leftText.length + rightText.length);
    splitMs = source.startMs + Math.max(1, Math.min(source.endMs - source.startMs - 1, Math.round((source.endMs - source.startMs) * ratio)));
  }
  const left = copyCue(source);
  const right = copyCue(source);
  right.id = newCueId();
  left.text = leftText;
  right.text = rightText;
  if (mode === "preserve") {
    left.startMs = source.startMs;
    left.endMs = source.endMs;
    right.startMs = source.startMs;
    right.endMs = source.endMs;
  } else {
    left.endMs = splitMs;
    right.startMs = splitMs;
  }
  const out = cues.map(copyCue);
  out.splice(index, 1, left, right);
  return { cues: out, ids: [left.id, right.id] };
}

export function splitLineAtFrame(
  cues: Cue[],
  cueId: string,
  frameMs: number,
  side: "before" | "after",
  frameDurationMs: number,
): { cues: Cue[]; ids: [string, string] } | null {
  const index = cues.findIndex((cue) => cue.id === cueId);
  const source = cues[index];
  if (!source) return null;
  const split = side === "before" ? frameMs : frameMs + frameDurationMs;
  if (split <= source.startMs || split >= source.endMs) return null;
  const left = copyCue(source);
  const right = copyCue(source);
  right.id = newCueId();
  left.endMs = split;
  right.startMs = split;
  const out = cues.map(copyCue);
  out.splice(index, 1, left, right);
  return { cues: out, ids: [left.id, right.id] };
}

export function insertCueRelative(
  cues: Cue[],
  currentId: string | null,
  where: "before" | "after",
  atMs?: number,
): { cues: Cue[]; id: string } {
  const currentIndex = cues.findIndex((cue) => cue.id === currentId);
  const current = cues[currentIndex];
  const defaultStart = current ? (where === "before" ? Math.max(0, current.startMs - 1000) : current.endMs) : 0;
  const cue = blankCue(Math.max(0, Math.round(atMs ?? defaultStart)));
  if (current?.assFields) {
    cue.assFields = { ...current.assFields };
    cue.assKind = "Dialogue";
  }
  const insertAt = currentIndex < 0 ? cues.length : currentIndex + (where === "after" ? 1 : 0);
  const out = cues.map(copyCue);
  out.splice(insertAt, 0, cue);
  return { cues: out, id: cue.id };
}

export function clearCueText(text: string, keepTags: boolean): string {
  if (!keepTags) return "";
  return [...text.matchAll(/\{[^}]*\}/g)].map((match) => match[0]).join("");
}

export interface PasteOverFields {
  comment?: boolean;
  start?: boolean;
  end?: boolean;
  text?: boolean;
  style?: boolean;
  actor?: boolean;
  effect?: boolean;
  layer?: boolean;
  marginLeft?: boolean;
  marginRight?: boolean;
  marginVertical?: boolean;
}

export function pasteOverCues(
  cues: Cue[],
  targetIds: readonly string[],
  clipboard: readonly Cue[],
  fields: PasteOverFields,
): Cue[] {
  if (!clipboard.length || !targetIds.length) return cues.map(copyCue);
  const targets = new Map(targetIds.map((id, index) => [id, index]));
  return cues.map((cue) => {
    const targetIndex = targets.get(cue.id);
    if (targetIndex == null) return copyCue(cue);
    const source = clipboard[targetIndex % clipboard.length];
    const next = copyCue(cue);
    if (fields.comment) next.assKind = source.assKind;
    if (fields.start) next.startMs = source.startMs;
    if (fields.end) next.endMs = source.endMs;
    if (fields.text) next.text = source.text;
    const assign = (key: string): void => {
      (next.assFields ??= {})[key] = source.assFields?.[key] ?? "";
    };
    if (fields.style) assign("Style");
    if (fields.actor) assign("Name");
    if (fields.effect) assign("Effect");
    if (fields.layer) assign("Layer");
    if (fields.marginLeft) assign("MarginL");
    if (fields.marginRight) assign("MarginR");
    if (fields.marginVertical) assign("MarginV");
    return next;
  });
}

export interface ShiftTimesOptions {
  amount: number;
  unit: "milliseconds" | "frames";
  direction: "forward" | "backward";
  scope: "all" | "selected" | "onward";
  fields: "both" | "start" | "end";
  selectedIds: ReadonlySet<string>;
  frameRate: number;
  timecodesMs?: readonly number[];
}

function shiftFrameTime(value: number, frames: number, options: ShiftTimesOptions): number {
  const times = options.timecodesMs;
  if (!times?.length) return value + frames * 1000 / Math.max(1, options.frameRate);
  let index = times.findIndex((time) => time >= value);
  if (index < 0) index = times.length - 1;
  return times[Math.max(0, Math.min(times.length - 1, index + frames))];
}

export function shiftCueTimes(cues: Cue[], options: ShiftTimesOptions): Cue[] {
  const sign = options.direction === "backward" ? -1 : 1;
  const firstSelected = cues.findIndex((cue) => options.selectedIds.has(cue.id));
  return cues.map((cue, index) => {
    const affected = options.scope === "all" || (options.scope === "selected" && options.selectedIds.has(cue.id)) || (options.scope === "onward" && firstSelected >= 0 && index >= firstSelected);
    if (!affected) return copyCue(cue);
    const shift = (value: number): number => Math.max(0, options.unit === "milliseconds"
      ? value + sign * options.amount
      : shiftFrameTime(value, sign * options.amount, options));
    const next = copyCue(cue);
    if (options.fields !== "end") next.startMs = shift(cue.startMs);
    if (options.fields !== "start") next.endMs = shift(cue.endMs);
    next.endMs = Math.max(next.startMs + 1, next.endMs);
    return next;
  });
}

export interface TimingPostProcessOptions {
  styles?: ReadonlySet<string>;
  selectedIds?: ReadonlySet<string>;
  leadInMs: number;
  leadOutMs: number;
  adjacentEnabled: boolean;
  maxGapMs: number;
  maxOverlapMs: number;
  adjacentBias: number;
  keyframesMs?: readonly number[];
  keyStartBeforeMs: number;
  keyStartAfterMs: number;
  keyEndBeforeMs: number;
  keyEndAfterMs: number;
}

function closest(values: readonly number[], target: number): number | null {
  if (!values.length) return null;
  let best = values[0];
  for (const value of values) if (Math.abs(value - target) < Math.abs(best - target)) best = value;
  return best;
}

export function postProcessTiming(cues: Cue[], options: TimingPostProcessOptions): Cue[] {
  const out = cues.map(copyCue);
  const valid = (cue: Cue): boolean => cue.assKind !== "Comment"
    && (!options.styles || options.styles.has(cue.assFields?.Style ?? "Default"))
    && (!options.selectedIds || options.selectedIds.has(cue.id));
  const sorted = out.filter(valid).sort((a, b) => a.startMs - b.startMs);
  for (let index = 0; index < sorted.length; index += 1) {
    const cue = sorted[index];
    const previous = sorted.slice(0, index);
    const following = sorted.slice(index + 1);
    let start = Math.max(0, cue.startMs - options.leadInMs);
    let end = cue.endMs + options.leadOutMs;
    for (const other of previous) if (other.endMs <= cue.startMs) start = Math.max(start, other.endMs);
    for (const other of following) if (other.startMs >= cue.endMs) end = Math.min(end, other.startMs);
    cue.startMs = Math.min(start, cue.endMs - 1);
    cue.endMs = Math.max(cue.startMs + 1, end);
  }
  if (options.adjacentEnabled) {
    const bias = Math.max(0, Math.min(1, options.adjacentBias));
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      const distance = current.startMs - previous.endMs;
      if ((distance < 0 && -distance <= options.maxOverlapMs) || (distance > 0 && distance <= options.maxGapMs)) {
        const position = Math.round(previous.endMs + distance * bias);
        previous.endMs = Math.max(previous.startMs + 1, position);
        current.startMs = Math.min(current.endMs - 1, position);
      }
    }
  }
  if (options.keyframesMs?.length) {
    for (const cue of sorted) {
      const start = closest(options.keyframesMs, cue.startMs);
      if (start != null) {
        const delta = start - cue.startMs;
        if ((delta >= 0 && delta <= options.keyStartBeforeMs) || (delta < 0 && -delta <= options.keyStartAfterMs)) cue.startMs = start;
      }
      const end = closest(options.keyframesMs, cue.endMs);
      if (end != null) {
        const delta = end - cue.endMs;
        if ((delta >= 0 && delta <= options.keyEndBeforeMs) || (delta < 0 && -delta <= options.keyEndAfterMs)) cue.endMs = Math.max(cue.startMs + 1, end);
      }
    }
  }
  return out;
}

export function setContinuousTiming(
  cues: Cue[],
  selected: ReadonlySet<string>,
  edge: "start" | "end",
): Cue[] {
  const out = cues.map(copyCue);
  for (let index = 0; index < out.length; index += 1) {
    if (!selected.has(out[index].id)) continue;
    if (edge === "start" && index > 0) out[index].startMs = Math.min(out[index].endMs - 1, out[index - 1].endMs);
    if (edge === "end" && index + 1 < out.length) out[index].endMs = Math.max(out[index].startMs + 1, out[index + 1].startMs);
  }
  return out;
}

export function addLead(
  cues: Cue[],
  selected: ReadonlySet<string>,
  leadInMs: number,
  leadOutMs: number,
): Cue[] {
  return cues.map((cue) => selected.has(cue.id) ? {
    ...copyCue(cue),
    startMs: Math.max(0, cue.startMs - leadInMs),
    endMs: Math.max(cue.startMs + 1, cue.endMs + leadOutMs),
  } : copyCue(cue));
}

export function nudgeTimingUnit(
  cues: Cue[],
  selected: ReadonlySet<string>,
  operation: "start" | "length" | "length-shift",
  deltaMs: number,
): Cue[] {
  const out = cues.map(copyCue);
  const selectedIndices = out.map((cue, index) => selected.has(cue.id) ? index : -1).filter((index) => index >= 0);
  for (const index of selectedIndices) {
    const cue = out[index];
    if (operation === "start") cue.startMs = Math.max(0, Math.min(cue.endMs - 1, cue.startMs + deltaMs));
    else cue.endMs = Math.max(cue.startMs + 1, cue.endMs + deltaMs);
  }
  if (operation === "length-shift" && selectedIndices.length) {
    const last = Math.max(...selectedIndices);
    for (let index = last + 1; index < out.length; index += 1) {
      out[index].startMs = Math.max(0, out[index].startMs + deltaMs);
      out[index].endMs = Math.max(out[index].startMs + 1, out[index].endMs + deltaMs);
    }
  }
  return out;
}

export function shiftSelectionToTime(cues: Cue[], selected: ReadonlySet<string>, targetMs: number): Cue[] {
  const chosen = cues.filter((cue) => selected.has(cue.id));
  if (!chosen.length) return cues.map(copyCue);
  const delta = targetMs - Math.min(...chosen.map((cue) => cue.startMs));
  return cues.map((cue) => selected.has(cue.id) ? {
    ...copyCue(cue),
    startMs: Math.max(0, cue.startMs + delta),
    endMs: Math.max(1, cue.endMs + delta),
  } : copyCue(cue));
}

export function snapSelectedToScene(
  cues: Cue[],
  selected: ReadonlySet<string>,
  keyframesMs: readonly number[],
  playheadMs: number,
): Cue[] {
  if (!keyframesMs.length) return cues.map(copyCue);
  const before = [...keyframesMs].reverse().find((time) => time <= playheadMs) ?? keyframesMs[0];
  const after = keyframesMs.find((time) => time > playheadMs) ?? keyframesMs.at(-1)!;
  return cues.map((cue) => selected.has(cue.id) ? {
    ...copyCue(cue),
    startMs: before,
    endMs: Math.max(before + 1, after),
  } : copyCue(cue));
}

export interface SelectCriteria {
  field: "text" | "style" | "actor" | "effect";
  query: string;
  mode: "contains" | "equals" | "regex";
  caseSensitive?: boolean;
}

export function selectCueIds(cues: Cue[], criteria: SelectCriteria): string[] {
  const value = (cue: Cue): string => {
    if (criteria.field === "text") return visibleText(cue.text);
    if (criteria.field === "style") return cue.assFields?.Style ?? "";
    if (criteria.field === "actor") return cue.assFields?.Name ?? "";
    return cue.assFields?.Effect ?? "";
  };
  let regex: RegExp | null = null;
  if (criteria.mode === "regex") {
    try { regex = new RegExp(criteria.query, criteria.caseSensitive ? "" : "i"); } catch { return []; }
  }
  const query = criteria.caseSensitive ? criteria.query : criteria.query.toLocaleLowerCase();
  return cues.filter((cue) => {
    const source = criteria.caseSensitive ? value(cue) : value(cue).toLocaleLowerCase();
    if (regex) return regex.test(value(cue));
    return criteria.mode === "equals" ? source === query : source.includes(query);
  }).map((cue) => cue.id);
}

export interface StyleOverlap {
  firstId: string;
  secondId: string;
  style: string;
  overlapMs: number;
}

export function findStyleOverlaps(cues: Cue[]): StyleOverlap[] {
  const byStyle = new Map<string, Cue[]>();
  for (const cue of cues.filter((item) => item.assKind !== "Comment")) {
    const style = cue.assFields?.Style ?? "Default";
    const list = byStyle.get(style) ?? [];
    list.push(cue);
    byStyle.set(style, list);
  }
  const overlaps: StyleOverlap[] = [];
  for (const [style, styleCues] of byStyle) {
    styleCues.sort((a, b) => a.startMs - b.startMs);
    for (let first = 0; first < styleCues.length; first += 1) {
      for (let second = first + 1; second < styleCues.length && styleCues[second].startMs < styleCues[first].endMs; second += 1) {
        overlaps.push({
          firstId: styleCues[first].id,
          secondId: styleCues[second].id,
          style,
          overlapMs: Math.min(styleCues[first].endMs, styleCues[second].endMs) - styleCues[second].startMs,
        });
      }
    }
  }
  return overlaps;
}
