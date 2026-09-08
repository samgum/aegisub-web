import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MediaGain } from "./media-gain";

class Context {
  static instances: Context[] = [];
  state = "suspended"; destination = {}; resumeCalls = 0; suspendCalls = 0;
  completeResume: (() => void) | null = null;
  constructor() { Context.instances.push(this); }
  createMediaElementSource() { return { connect() {}, disconnect() {} }; }
  createGain() { return { ...this.createMediaElementSource(), gain: { value: 1 } }; }
  createAnalyser() { return { ...this.createMediaElementSource(), fftSize: 2048 }; }
  resume() { this.resumeCalls++; return new Promise<void>(resolve => { this.completeResume = () => { this.state = "running"; resolve(); }; }); }
  async suspend() { this.suspendCalls++; this.state = "suspended"; }
  async close() { this.state = "closed"; }
}
const media = () => Object.assign(new EventTarget(), { paused: true, muted: false, volume: 1 }) as unknown as HTMLMediaElement;
beforeEach(() => { vi.useFakeTimers(); Context.instances = []; vi.stubGlobal("window", globalThis); vi.stubGlobal("AudioContext", Context); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("coalesces pending resumes and cancels idle suspension on immediate replay", async () => {
  const output = new MediaGain(), source = media(); output.setGain(.125); output.prepare(source); output.prepare(source);
  const context = Context.instances[0]; expect(context.resumeCalls).toBe(1);
  context.completeResume!(); await vi.advanceTimersByTimeAsync(0);
  output.pauseIfIdle(); output.prepare(source); Object.assign(source, { paused: false });
  await vi.advanceTimersByTimeAsync(1000); expect(context.suspendCalls).toBe(0);
  Object.assign(source, { paused: true }); output.pauseIfIdle(); await vi.advanceTimersByTimeAsync(300);
  expect(context.suspendCalls).toBe(1);
  output.prepare(source); expect(context.resumeCalls).toBe(2); context.completeResume!(); await vi.advanceTimersByTimeAsync(0); output.dispose();
});
it("disposal cancels idle work and closes the output context", async () => {
  const output = new MediaGain(); output.setGain(.5); output.prepare(media()); const context = Context.instances[0];
  context.completeResume!(); await vi.advanceTimersByTimeAsync(0); output.pauseIfIdle(); output.dispose();
  await vi.advanceTimersByTimeAsync(1000); expect(context.state).toBe("closed"); expect(context.suspendCalls).toBe(0);
});
it("suspends after a late initial resume if playback was already stopped", async () => {
  const output = new MediaGain(); output.setGain(.5); output.prepare(media()); const context = Context.instances[0];
  output.pauseIfIdle(); await vi.advanceTimersByTimeAsync(500); expect(context.suspendCalls).toBe(0);
  context.completeResume!(); await vi.advanceTimersByTimeAsync(300); expect(context.suspendCalls).toBe(1); output.dispose();
});
it("does not suspend a still-playing video just because its audio is muted", async () => {
  const output = new MediaGain(), source = media(); Object.assign(source, { paused: false, muted: true });
  output.setGain(.5); output.prepare(source); const context = Context.instances[0]; context.completeResume!(); await vi.advanceTimersByTimeAsync(0);
  output.pauseIfIdle(); await vi.advanceTimersByTimeAsync(1000); expect(context.suspendCalls).toBe(0); output.dispose();
});
