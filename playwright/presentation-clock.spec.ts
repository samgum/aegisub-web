import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const fixtureFrameTime = (reported: number) => Math.floor(Math.floor(reported * 24 + 1e-4) * 1000 / 24 + 1e-6) / 1000;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    (window as any).renderClockMessages = [];
    (window as any).canvasFrameMessages = [];
    window.Worker = class extends NativeWorker {
      private subtitleWorker: boolean;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options); this.subtitleWorker = String(url).includes("subtitles-octopus-worker");
        this.addEventListener("message", event => { if (this.subtitleWorker && event.data?.target === "canvas" && event.data.op === "renderCanvas") {
          const frames = (window as any).canvasFrameMessages; frames.push(event.data.time); if (frames.length > 100) frames.shift();
        } });
      }
      postMessage(message: any, transfer?: any) {
        if (this.subtitleWorker && message?.target === "video" && typeof message.currentTime === "number") {
          const messages = (window as any).renderClockMessages as number[]; messages.push(message.currentTime); if (messages.length > 100) messages.shift();
        }
        super.postMessage(message, transfer);
      }
    };
    const nativeFrameCallback = HTMLVideoElement.prototype.requestVideoFrameCallback;
    HTMLVideoElement.prototype.requestVideoFrameCallback = function(callback) {
      return nativeFrameCallback.call(this, (now, metadata) => { (this as any).lastPresentedTime = metadata.mediaTime; callback(now, metadata); });
    };
  });
  await page.goto("/"); await expect.poll(() => page.evaluate(() => !!(window as any).subHandle)).toBe(true);
  await page.locator("#file").setInputFiles("test-corpus/base.ass");
  await page.locator("#media-file").setInputFiles("test-corpus/tiny-timing.mp4");
  await expect(page.locator(".se-root")).toHaveAttribute("data-frame-index", "ready");
  await expect.poll(() => page.locator(".se-playerhost video").evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => page.evaluate(() => (window as any).renderClockMessages.length)).toBeGreaterThan(0);
});

test("consecutive subtitle edits use the presented frame, not the advancing media clock", async ({ page }, info) => {
  const evidence = await page.evaluate(async () => {
    const h = (window as any).subHandle, video = h.video as HTMLVideoElement;
    const text = h.getText();
    return new Promise<{ presented: number; playback: number; sent: number[] }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("No video frame presented after playback started")), 5000);
      const frame: VideoFrameRequestCallback = (_now, metadata) => {
        const playback = video.currentTime;
        if (metadata.mediaTime < .25) { video.requestVideoFrameCallback(frame); return; }
        (window as any).renderClockMessages = [];
        h.player.setSubtitleText(text.replace("Hello, world.", "First edit"), "first.ass");
        h.player.setSubtitleText(text.replace("Hello, world.", "Second edit"), "second.ass");
        const sent = [...(window as any).renderClockMessages];
        clearTimeout(timeout); video.pause(); resolve({ presented: metadata.mediaTime, playback, sent });
      };
      video.requestVideoFrameCallback(frame); void video.play().catch(reject);
    });
  });
  await info.attach("frame-clock", { body: JSON.stringify(evidence), contentType: "application/json" });
  // Some engines align the clocks on this callback; correctness must not depend on
  // observing a particular scheduling offset. Both edits must use the frame PTS either way.
  expect(evidence.sent.length).toBeGreaterThanOrEqual(2);
  // FFMS2 passes integer-millisecond PTS to the desktop subtitle renderer.
  for (const timestamp of evidence.sent) expect(timestamp).toBeCloseTo(fixtureFrameTime(evidence.presented), 6);
});

test("pausing and editing holds the final presented video frame timestamp", async ({ page }, info) => {
  await page.locator(".se-playerhost video").evaluate((v: HTMLVideoElement) => v.play());
  await expect.poll(() => page.locator(".se-playerhost video").evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(.5);
  await page.locator(".se-playerhost video").evaluate((v: HTMLVideoElement) => v.pause());
  // Let the pause event and any final submitted compositor frame arrive before editing.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const evidence = await page.evaluate(() => {
    const h = (window as any).subHandle, video = h.video;
    (window as any).renderClockMessages = [];
    h.player.setSubtitleText(h.getText().replace("Hello, world.", "Paused edit"), "paused.ass");
    return { presented: video.lastPresentedTime, playback: video.currentTime, sent: [...(window as any).renderClockMessages] };
  });
  await info.attach("paused-clock", { body: JSON.stringify(evidence), contentType: "application/json" });
  expect(evidence.sent.length).toBeGreaterThan(0);
  for (const timestamp of evidence.sent) expect(timestamp).toBeCloseTo(fixtureFrameTime(evidence.presented), 6);
});

test("subtitle edits during a paused seek wait for the newly presented frame", async ({ page }, info) => {
  const video = page.locator(".se-playerhost video");
  await video.evaluate((v: HTMLVideoElement) => v.currentTime = 1.2);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.seeking && (v as any).lastPresentedTime >= 28 / 24 - 1e-5 && (v as any).lastPresentedTime <= 1.2)).toBe(true);
  const evidence = await page.evaluate(() => {
    const h = (window as any).subHandle, video = h.video;
    const presented = video.lastPresentedTime; (window as any).renderClockMessages = [];
    video.currentTime = 4.2;
    h.player.setSubtitleText(h.getText().replace("Hello, world.", "Edit during seek"), "seeking.ass");
    return { presented, seeking: video.seeking, requested: video.currentTime, sent: [...(window as any).renderClockMessages] };
  });
  expect(evidence.seeking).toBe(true); expect(evidence.requested).toBeCloseTo(4.2, 3); expect(evidence.sent.length).toBeGreaterThan(0);
  for (const timestamp of evidence.sent) expect(timestamp).toBeCloseTo(1.166, 6);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.seeking && (v as any).lastPresentedTime >= 100 / 24 - 1e-5 && (v as any).lastPresentedTime <= 4.2)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).renderClockMessages.at(-1))).toBeCloseTo(4.166, 6);
  await info.attach("seek-clock", { body: JSON.stringify(evidence), contentType: "application/json" });
});

test("an animated ASS drawing is rendered at the paused frame's position", async ({ page }, info) => {
  const video = page.locator(".se-playerhost video");
  await video.evaluate((v: HTMLVideoElement) => v.play());
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(.5);
  await video.evaluate((v: HTMLVideoElement) => v.pause());
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const reference = await page.evaluate(() => {
    const h = (window as any).subHandle, video = h.video;
    const frameMs = Math.floor(Math.floor(video.lastPresentedTime * 24 + 1e-4) * 1000 / 24 + 1e-6);
    const script = `[Script Info]\nScriptType: v4.00+\nPlayResX: 384\nPlayResY: 288\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Default,Arial,20,&H000000FF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\nDialogue: 0,0:00:00.00,0:00:10.00,Default,,0,0,0,,{\\an7\\move(50,10,250,10,${frameMs - 50},${frameMs + 50})\\p1}m 0 0 l 12 0 12 12 0 12\n`;
    h.player.setSubtitleText(script, "drawing-clock.ass");
    return { frameMs, playbackMs: video.currentTime * 1000 };
  });
  const position = () => page.locator(".se-playerhost .libassjs-canvas").evaluate((canvas: HTMLCanvasElement) => {
    const bytes = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let minX = Infinity, maxX = -1;
    for (let i = 0; i < bytes.length; i += 4) if (bytes[i] > 200 && bytes[i + 1] < 40 && bytes[i + 2] < 40 && bytes[i + 3] > 180) { const x = i / 4 % canvas.width; minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    const video = document.querySelector(".se-playerhost video") as HTMLVideoElement & { lastPresentedTime: number };
    const frameMs = Math.floor(Math.floor(video.lastPresentedTime * 24 + 1e-4) * 1000 / 24 + 1e-6);
    return maxX < 0 ? null : { x: minX / canvas.width * 384, width: (maxX - minX + 1) / canvas.width * 384, frameMs };
  });
  let actual: Awaited<ReturnType<typeof position>> = null, expectedX = 0, stable = 0;
  // WebKit may submit one final frame after the pause event. Derive the expected
  // drawing from the frame actually present in the SAME sample as its pixels, not
  // from a timestamp captured before that final submission. Keep the 2px requirement.
  await expect.poll(async () => {
    actual = await position(); if (!actual) return stable = 0;
    expectedX = Math.max(50, Math.min(250, 150 + (actual.frameMs - reference.frameMs) * 2));
    stable = Math.abs(actual.x - expectedX) < 2 && Math.abs(actual.width - 12) < 2 ? stable + 1 : 0;
    return stable;
  }, { intervals: [50, 100, 100] }).toBeGreaterThanOrEqual(3);
  await info.attach("drawing-clock", { body: JSON.stringify({ ...reference, actual, expectedX }), contentType: "application/json" });
  await page.screenshot({ path: info.outputPath("paused-drawing.png") });
});

test("a between-frame VFR seek matches an independently decoded image and subtitle timestamp", async ({ page }, info) => {
  await page.locator("#media-file").setInputFiles("test-corpus/vfr-frame-timing.mp4");
  await expect(page.locator(".se-root")).toHaveAttribute("data-video-frames", "12");
  await page.getByRole("button", { name: "忽略", exact: true }).click();
  const video = page.locator(".se-playerhost video");
  await video.evaluate((v: HTMLVideoElement) => v.currentTime = .15);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.seeking && v.readyState >= 2 && (v as any).lastPresentedTime >= .12)).toBe(true);
  const compare = (index: number) => video.evaluate(async (v: HTMLVideoElement, bytes) => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
    try {
      const expected = new Image(); expected.src = url; await expected.decode();
      const canvas = document.createElement("canvas"); canvas.width = v.videoWidth; canvas.height = v.videoHeight;
      const ctx = canvas.getContext("2d")!; ctx.drawImage(v, 0, 0); const actual = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      ctx.drawImage(expected, 0, 0); const reference = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let different = 0; for (let i = 0; i < actual.length; i++) if (i % 4 !== 3 && (actual[i] >= 128) !== (reference[i] >= 128)) different++;
      return different / (canvas.width * canvas.height * 3);
    } finally { URL.revokeObjectURL(url); }
  }, [...readFileSync(`test-corpus/vfr-frame-${index}.png`)]);
  const correctImage = await compare(1), wrongImage = await compare(0);
  expect(correctImage).toBeLessThan(wrongImage / 2);
  const clock = await page.evaluate(() => {
    const h = (window as any).subHandle; (window as any).renderClockMessages = [];
    h.player.setSubtitleText(h.getText().replace("Hello, world.", "VFR edit"), "vfr-edit.ass");
    return { requested: h.video.currentTime, reported: h.video.lastPresentedTime, sent: [...(window as any).renderClockMessages] };
  });
  expect(clock.sent.length).toBeGreaterThan(0); for (const time of clock.sent) expect(time).toBeCloseTo(.12, 6);
  await info.attach("vfr-image-and-clock", { body: JSON.stringify({ correctImage, wrongImage, clock }), contentType: "application/json" });
});

test("frame stepping after playback starts from the displayed frame and accumulates rapid steps", async ({ page }, info) => {
  const video = page.locator(".se-playerhost video");
  await video.evaluate((v: HTMLVideoElement) => v.play());
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(.5);
  await video.evaluate((v: HTMLVideoElement) => v.pause());
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const presented = await video.evaluate(v => (v as any).lastPresentedTime as number), frame = Math.floor(presented * 24 + 1e-4);
  await page.evaluate(() => (window as any).subHandle.runAegisubCommand("video/frame/next"));
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo((frame + 1) / 24, 4);
  await page.evaluate(() => { const h = (window as any).subHandle; for (let i = 0; i < 3; i++) h.runAegisubCommand("video/frame/next"); });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo((frame + 4) / 24, 4);
  await info.attach("presentation-step", { body: JSON.stringify({ presented, startFrame: frame, finalTime: await video.evaluate((v: HTMLVideoElement) => v.currentTime) }), contentType: "application/json" });
});

test("rapid same-frame edits always display the LAST drawing, not an earlier result", async ({ page }, info) => {
  const video = page.locator(".se-playerhost video"); await video.evaluate((v: HTMLVideoElement) => v.currentTime = 1.5);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.seeking && (v as any).lastPresentedTime >= 1.49)).toBe(true);
  const leftEdge = () => page.locator(".se-playerhost .libassjs-canvas").evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data; let left = Infinity;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 200 && data[i + 1] < 40 && data[i + 2] < 40 && data[i + 3] > 180) left = Math.min(left, i / 4 % canvas.width);
    return left / canvas.width * 384;
  });
  for (let iteration = 0; iteration < 10; iteration++) {
    const expected = iteration % 2 ? 150 : 250;
    await page.evaluate(iteration => {
      const h = (window as any).subHandle, text = h.getText(); (window as any).canvasFrameMessages = [];
      const drawing = (x: number) => `{\\an7\\pos(${x},10)\\bord0\\shad0\\1c&H0000FF&\\p1}m 0 0 l 12 0 12 12 0 12`;
      h.player.setSubtitleText(text.replace("Hello, world.", drawing(50 + iteration)), "earlier.ass");
      h.player.setSubtitleText(text.replace("Hello, world.", drawing(iteration % 2 ? 150 : 250)), "latest.ass");
    }, iteration);
    try { await expect.poll(async () => Math.abs(await leftEdge() - expected)).toBeLessThan(2); }
    finally { await info.attach(`same-frame-${iteration}`, { body: JSON.stringify({ expected, actual: await leftEdge(), frameTimes: await page.evaluate(() => (window as any).canvasFrameMessages) }), contentType: "application/json" }); }
  }
});
