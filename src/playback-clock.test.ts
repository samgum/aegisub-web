import { expect, it } from "vitest";
import { VirtualPlaybackClock } from "./playback-clock";
function clock() {
  let now = 0, id = 0;
  const pending = new Map<number, FrameRequestCallback>();
  const transport = new VirtualPlaybackClock(10, { now: () => now, request: callback => { pending.set(++id, callback); return id; }, cancel: key => { pending.delete(key); } });
  return { transport, pending, step: (milliseconds: number) => { now += milliseconds; const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(cb => cb(now)); } };
}
it("pauses, seeks and changes playback rate without discontinuities", async () => {
  const { transport: c, step } = clock();
  await c.play(); step(500); expect(c.currentTime).toBe(.5);
  c.playbackRate = 2; step(500); expect(c.currentTime).toBe(1.5);
  c.pause(); step(2000); expect(c.currentTime).toBe(1.5);
  c.currentTime = 6; await Promise.resolve(); expect(c.seeking).toBe(false);
  await c.play(); step(1000); expect(c.currentTime).toBe(8);
});
it("ends exactly at duration and can restart", async () => {
  const { transport: c, step } = clock(); let endings = 0;
  c.addEventListener("ended", () => endings++);
  await c.play(); step(11000);
  expect([c.currentTime, c.paused, endings]).toEqual([10, true, 1]);
  await c.play(); expect(c.currentTime).toBe(0);
});
it("disposal cancels callbacks, including queued seek notifications", async () => {
  const { transport: c, pending } = clock(); let seeks = 0;
  c.addEventListener("seeked", () => seeks++);
  await c.play(); c.currentTime = 3; c.dispose(); await Promise.resolve();
  expect(pending.size).toBe(0); expect(seeks).toBe(0);
});
