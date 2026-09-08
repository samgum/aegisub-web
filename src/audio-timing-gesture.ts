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
    options: { button: number; alt: boolean; ctrl: boolean; sensitivityMs: number; dragTiming?: boolean; snapRangeMs?: number; snapTargetsMs?: readonly number[] }) {
    const active = cues.find(cue => cue.id === activeId);
    if (!active) return;
    for (const cue of cues) this.markers.set(cue.id, { left: cue.startMs, right: cue.endMs });
    const selected = [active, ...cues.filter(cue => cue.id !== activeId && selectedIds.includes(cue.id))];
    const group = (edge: Marker["edge"]): Marker[] => selected.map(cue => ({ id: cue.id, edge }));
    if (options.alt && options.button === 0) {
      this.translation = true;
      this.grabbed = [...group("left"), ...group("right")];
    } else if (options.button === 2) {
      this.grabbed = group("right");
      this.set(this.grabbed, originMs, options.snapRangeMs, options.snapTargetsMs);
    } else {
      const leftDistance = Math.abs(active.startMs - originMs);
      const rightDistance = Math.abs(active.endMs - originMs);
      if (Math.min(leftDistance, rightDistance) > options.sensitivityMs) {
        this.grabbed = group(options.dragTiming === false ? "left" : "right");
        this.set(group("left"), originMs, options.snapRangeMs, options.snapTargetsMs);
      } else {
        const edge = leftDistance <= rightDistance ? "left" : "right";
        const position = edge === "left" ? active.startMs : active.endMs;
        if (options.ctrl) {
          for (const [id, pair] of this.markers) {
            for (const key of ["left", "right"] as const) if (pair[key] === position) this.grabbed.push({ id, edge: key });
          }
        } else this.grabbed = [{ id: activeId, edge }];
        if (edge === "left") this.set(this.grabbed, originMs, options.snapRangeMs, options.snapTargetsMs);
      }
    }
    for (const marker of this.grabbed) this.changed.add(marker.id);
  }

  private set(markers: Marker[], ms: number, snapRangeMs = 0, targets: readonly number[] = []): void {
    for (const marker of markers) {
      this.markers.get(marker.id)![marker.edge] = Math.max(0, Math.round(ms));
      this.changed.add(marker.id);
    }
    this.snap(markers, snapRangeMs, targets);
  }

  private snap(moving: Marker[], range: number, targets: readonly number[]): number {
    if (range <= 0 || !moving.length) return 0;
    const inactive: number[] = [];
    const grabbed = new Set(moving.map(marker => `${marker.id}:${marker.edge}`));
    for (const [id, pair] of this.markers) for (const edge of ["left", "right"] as const) {
      if (!grabbed.has(`${id}:${edge}`)) inactive.push(pair[edge]);
    }
    inactive.sort((a, b) => a - b);
    let distance = Infinity;
    // Provider markers precede inactive dialogue markers, so equidistant keyframe/video
    // targets win ties. Shift every grabbed marker by ONE offset (including Alt groups).
    for (const marker of moving) {
      const position = this.markers.get(marker.id)![marker.edge];
      const check = (target: number) => {
        const delta = target - position;
        if (Math.abs(delta) <= range && Math.abs(delta) < Math.abs(distance)) distance = delta;
      };
      for (const target of targets) check(target);
      let lo = 0, hi = inactive.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (inactive[mid] < position) lo = mid + 1; else hi = mid; }
      if (lo > 0) check(inactive[lo - 1]); if (lo < inactive.length) check(inactive[lo]);
      if (distance === 0) return 0;
    }
    if (!Number.isFinite(distance)) return 0;
    for (const marker of moving) this.markers.get(marker.id)![marker.edge] += distance;
    return distance;
  }

  get positionMs(): number { const marker = this.grabbed[0]; return marker ? this.markers.get(marker.id)![marker.edge] : this.originMs; }

  ranges(): { id: string; range: TimingRange }[] {
    return [...this.changed].map(id => {
      const pair = this.markers.get(id)!;
      return { id, range: { startMs: Math.min(pair.left, pair.right), endMs: Math.max(pair.left, pair.right) } };
    });
  }

  move(ms: number, snapRangeMs = 0, targets: readonly number[] = []): void {
    if (this.translation) {
      const minimum = Math.min(...this.grabbed.map(m => this.markers.get(m.id)![m.edge]));
      const delta = Math.max(-minimum, Math.round(ms - this.originMs));
      for (const marker of this.grabbed) this.markers.get(marker.id)![marker.edge] += delta;
      this.originMs = ms;
      this.originMs += this.snap(this.grabbed, snapRangeMs, targets);
    } else this.set(this.grabbed, ms, snapRangeMs, targets);
  }
}
