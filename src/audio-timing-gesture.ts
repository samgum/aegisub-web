import type { Cue } from "./cue";
import type { TimingRange } from "./timing-draft";

type Marker = { id: string; edge: "left" | "right" };

/** Desktop AudioTimingControllerDialogue mouse rules, in milliseconds. Marker identity
 * is retained across crossings; left/right display order is normalized only on output. */
export class AudioTimingGesture {
  private markers = new Map<string, { left: number; right: number }>();
  private grabbed: Marker[] = [];
  private changed = new Set<string>();
  private translation = false;

  constructor(cues: Cue[], activeId: string, selectedIds: string[], private originMs: number,
    options: { button: number; alt: boolean; ctrl: boolean; sensitivityMs: number }) {
    const active = cues.find(cue => cue.id === activeId);
    if (!active) return;
    for (const cue of cues) this.markers.set(cue.id, { left: cue.startMs, right: cue.endMs });
    const selected = cues.filter(cue => cue.id === activeId || selectedIds.includes(cue.id));
    const group = (edge: Marker["edge"]): Marker[] => selected.map(cue => ({ id: cue.id, edge }));
    if (options.alt && options.button === 0) {
      this.translation = true;
      this.grabbed = [...group("left"), ...group("right")];
    } else if (options.button === 2) {
      this.grabbed = group("right");
      this.set(this.grabbed, originMs);
    } else {
      const leftDistance = Math.abs(active.startMs - originMs);
      const rightDistance = Math.abs(active.endMs - originMs);
      if (Math.min(leftDistance, rightDistance) > options.sensitivityMs) {
        this.grabbed = group("right");
        this.set(group("left"), originMs);
      } else {
        const edge = leftDistance <= rightDistance ? "left" : "right";
        const position = edge === "left" ? active.startMs : active.endMs;
        if (options.ctrl) {
          for (const [id, pair] of this.markers) {
            for (const key of ["left", "right"] as const) if (pair[key] === position) this.grabbed.push({ id, edge: key });
          }
        } else this.grabbed = [{ id: activeId, edge }];
        if (edge === "left") this.set(this.grabbed, originMs);
      }
    }
    for (const marker of this.grabbed) this.changed.add(marker.id);
  }

  private set(markers: Marker[], ms: number): void {
    for (const marker of markers) {
      this.markers.get(marker.id)![marker.edge] = Math.max(0, Math.round(ms));
      this.changed.add(marker.id);
    }
  }

  ranges(): { id: string; range: TimingRange }[] {
    return [...this.changed].map(id => {
      const pair = this.markers.get(id)!;
      return { id, range: { startMs: Math.min(pair.left, pair.right), endMs: Math.max(pair.left, pair.right) } };
    });
  }

  move(ms: number): void {
    if (this.translation) {
      const minimum = Math.min(...this.grabbed.map(m => this.markers.get(m.id)![m.edge]));
      const delta = Math.max(-minimum, Math.round(ms - this.originMs));
      for (const marker of this.grabbed) this.markers.get(marker.id)![marker.edge] += delta;
      this.originMs = ms;
    } else this.set(this.grabbed, ms);
  }
}
