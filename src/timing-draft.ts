import type { Cue } from "./cue";

export type TimingRange = Pick<Cue, "startMs" | "endMs">;

/** Uncommitted audio markers are not subtitle edits. In particular they must not leak
 * into autosave, libass, collaboration or the document undo stack before Commit. */
export class TimingDraft {
  private ranges = new Map<string, TimingRange>();

  get pending(): boolean { return this.ranges.size > 0; }

  read(cue: Cue): Cue {
    const range = this.ranges.get(cue.id);
    return range ? { ...cue, ...range } : cue;
  }

  set(cue: Cue, startMs: number, endMs: number): void {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return;
    const left = Math.max(0, Math.round(Math.min(startMs, endMs)));
    const right = Math.max(0, Math.round(Math.max(startMs, endMs)));
    if (left === cue.startMs && right === cue.endMs) this.ranges.delete(cue.id);
    else this.ranges.set(cue.id, { startMs: left, endMs: right });
  }

  commit(cues: Cue[]): Cue[] {
    const result = cues.map(cue => this.read(cue));
    this.clear();
    return result;
  }

  discard(id: string): void { this.ranges.delete(id); }
  clear(): void { this.ranges.clear(); }
}
