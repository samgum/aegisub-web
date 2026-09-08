import type { Cue } from "./cue";

export function audioFlag(key: string, fallback = true): boolean {
  const value = localStorage.getItem(`aegisub-web.audio-${key}`); return value === null ? fallback : value === "true";
}
export function audioNumber(key: string, fallback: number, min: number, max: number): number {
  const value = localStorage.getItem(`aegisub-web.audio-${key}`), number = value === null ? fallback : Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
}
/** AudioDisplay::GetZoomLevelFactor and AudioBox's cubic gain mapping. */
export function audioZoomFactor(level: number): number {
  level = Math.max(-30, Math.min(50, Math.round(level)));
  return level >= 0 ? 100 + level * 25 : level >= -5 ? 100 + level * 10 : level >= -11 ? 50 + (level + 5) * 5 : Math.max(1, 31 + level);
}
export const audioGain = (position: number): number => (Math.max(1, Math.min(100, position)) / 50) ** 3;

/** RegenerateInactiveLines: visibility determines which unselected lines may be snapped
 * or Ctrl-dragged. Selected/active lines remain available even when they are comments. */
export function audioTimingCues(cues: Cue[], activeId: string, selectedIds: string[], mode = 3, comments = false): Cue[] {
  const active = cues.findIndex(cue => cue.id === activeId), selected = new Set([activeId, ...selectedIds]);
  const visible = new Set<string>();
  const eligible = (cue: Cue) => comments || cue.assKind !== "Comment";
  if (mode === 3) for (const cue of cues) { if (eligible(cue)) visible.add(cue.id); }
  if ((mode === 1 || mode === 2) && active >= 0) {
    for (let i = active - 1; i >= 0; i--) if (eligible(cues[i])) { visible.add(cues[i].id); break; }
    if (mode === 2) for (let i = active + 1; i < cues.length; i++) if (eligible(cues[i])) { visible.add(cues[i].id); break; }
  }
  return cues.filter(cue => selected.has(cue.id) || visible.has(cue.id));
}
