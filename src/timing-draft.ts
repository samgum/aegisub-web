import type { Cue } from "./cue";

export type TimingRange = Pick<Cue, "startMs" | "endMs">;

/** Uncommitted audio markers are not subtitle edits. In particular they must not leak
 * into autosave, libass, collaboration or the document undo stack before Commit. */
export class TimingDraft {
  private ranges = new Map<string, TimingRange>();
  private dirty = new Set<string>();

  get pending(): boolean { return this.dirty.size > 0; }
  entries(): ReadonlyMap<string, TimingRange> { return new Map([...this.dirty].map(id => [id, this.ranges.get(id)!])); }

  read(cue: Cue, quantum = 1): Cue {
    const range = this.ranges.get(cue.id);
    const startMs = range?.startMs ?? Math.round(cue.startMs / quantum) * quantum;
    const endMs = range?.endMs ?? Math.round(cue.endMs / quantum) * quantum;
    return startMs === cue.startMs && endMs === cue.endMs ? cue : { ...cue, startMs, endMs };
  }

  set(cue: Cue, startMs: number, endMs: number): void {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return;
    const left = Math.max(0, Math.round(Math.min(startMs, endMs)));
    const right = Math.max(0, Math.round(Math.max(startMs, endMs)));
    this.ranges.set(cue.id, { startMs: left, endMs: right });
    if (left === cue.startMs && right === cue.endMs) this.dirty.delete(cue.id);
    else this.dirty.add(cue.id);
  }

  commit(cues: Cue[]): Cue[] {
    const result = cues.map(cue => this.dirty.has(cue.id) ? this.read(cue) : cue);
    // The native controller retains exact marker positions after commit. Its stored ASS
    // time is displayed at centiseconds, but S still auditions the exact live markers.
    this.markCommitted();
    return result;
  }

  markCommitted(): void { this.dirty.clear(); }

  discard(id: string): void { this.ranges.delete(id); this.dirty.delete(id); }
  clear(): void { this.ranges.clear(); this.dirty.clear(); }
}
