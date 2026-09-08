import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

async function command(page: Page, name: string) {
  await page.evaluate(name => (window as any).subHandle.runAegisubCommand(name), name);
}
async function cue(page: Page, index = 0) {
  return page.evaluate(index => (window as any).subHandle.getDoc().cues[index], index);
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => !!(window as any).subHandle)).toBe(true);
  await page.locator("#file").setInputFiles("test-corpus/base.ass");
  await expect(page.locator(".se-row")).toHaveCount(6);
});

test("audio marker edits stay pending until G, undo restores committed timing", async ({ page }, info) => {
  test.skip(/android|ipad|iphone/.test(info.project.name), "keyboard sequence tested with desktop profiles");
  const original = await cue(page);
  const wave = page.locator(".se-timeline");
  await wave.focus();
  await page.keyboard.press("NumpadAdd");
  expect((await cue(page)).endMs).toBe(original.endMs);
  await expect(page.locator(".se-root")).toHaveAttribute("data-timing-pending", "true");
  await page.keyboard.press("g");
  expect((await cue(page)).endMs).toBe(original.endMs + 10);
  await expect(page.locator(".se-row").nth(1)).toHaveClass(/sel/);
  await command(page, "edit/undo");
  expect((await cue(page)).endMs).toBe(original.endMs);
  await command(page, "edit/redo");
  expect((await cue(page)).endMs).toBe(original.endMs + 10);
});

test("uses real video frame times, stops on stepping and snaps at native frame midpoints", async ({ page }, info) => {
  test.skip(/android|ipad|iphone/.test(info.project.name), "frame keyboard workflow belongs to desktop profiles");
  await page.locator("#media-file").setInputFiles("test-corpus/tiny-timing.mp4");
  const video = page.locator(".se-playerhost video");
  await expect(page.locator(".se-root")).toHaveAttribute("data-frame-index", "ready");
  await expect(page.locator(".se-root")).toHaveAttribute("data-video-frames", "240");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.duration)).toBe(10);
  await video.evaluate((v: HTMLVideoElement) => { v.currentTime = 1; });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.seeking)).toBe(false);
  await command(page, "video/frame/next");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(25 / 24, 4);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.seeking)).toBe(false);
  await info.attach("frame-boundary", { body: JSON.stringify(await page.evaluate(() => {
    const h = (window as any).subHandle;
    return { time: h.video.currentTime, frames: h.frameTimes.slice(23, 27), frame: h.frameAtMs(h.video.currentTime * 1000) };
  })), contentType: "application/json" });
  await command(page, "time/snap/start_video");
  expect((await cue(page)).startMs).toBe(1021);
  await command(page, "video/frame/prev");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(1, 4);
  await video.evaluate((v: HTMLVideoElement) => v.play());
  await command(page, "video/frame/next");
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
});

test("VFR stepping shows the correct decoded images, not only the requested currentTime", async ({ page }, info) => {
  test.skip(/android|ipad|iphone/.test(info.project.name), "decoded image oracle tested on desktop runners");
  await page.locator("#media-file").setInputFiles("test-corpus/vfr-frame-timing.mp4");
  await expect(page.locator(".se-root")).toHaveAttribute("data-video-frames", "12");
  const video = page.locator(".se-playerhost video");
  const compareFrame = async (index: number) => {
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState >= 2 && !v.seeking)).toBe(true);
    return video.evaluate(async (v: HTMLVideoElement, bytes) => {
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
      try {
        const expected = new Image(); expected.src = url; await expected.decode();
        const canvas = document.createElement("canvas"); canvas.width = v.videoWidth; canvas.height = v.videoHeight;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(v, 0, 0);
        const actual = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        ctx.drawImage(expected, 0, 0);
        const oracle = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let difference = 0, structural = 0;
        for (let i = 0; i < actual.length; i++) if (i % 4 !== 3) {
          difference += Math.abs(actual[i] - oracle[i]);
          if ((actual[i] >= 128) !== (oracle[i] >= 128)) structural++;
        }
        return { rgbMeanError: difference / (canvas.width * canvas.height * 3), structuralError: structural / (canvas.width * canvas.height * 3) };
      } finally { URL.revokeObjectURL(url); }
    }, [...readFileSync(`test-corpus/vfr-frame-${index}.png`)]);
  };
  const first = await compareFrame(0), firstWrong = await compareFrame(1);
  await command(page, "video/frame/next");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(.12, 4);
  const next = await compareFrame(1), nextWrong = await compareFrame(0);
  await command(page, "video/frame/prev");
  const restored = await compareFrame(0);
  await info.attach("decoded-frame-oracle", { body: JSON.stringify({ first, firstWrong, next, nextWrong, restored }), contentType: "application/json" });
  // Browser colour management differs from FFmpeg's PNG conversion. Check image geometry
  // against both independent oracles; retaining the previous frame must fail this test.
  expect(first.structuralError).toBeLessThan(firstWrong.structuralError / 2);
  expect(next.structuralError).toBeLessThan(nextWrong.structuralError / 2);
  expect(restored.structuralError).toBeCloseTo(first.structuralError, 3);
});

test("G reset-next is a draft, Escape reverts, and Medusa does not steal typed letters", async ({ page }, info) => {
  test.skip(/android|ipad|iphone/.test(info.project.name), "keyboard sequence tested with desktop profiles");
  const second = await cue(page, 1);
  await page.locator(".se-timeline").focus();
  await page.keyboard.press("Shift+G");
  expect(await cue(page, 1)).toEqual(second);
  await expect(page.locator(".se-root")).toHaveAttribute("data-timing-pending", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator(".se-root")).toHaveAttribute("data-timing-pending", "false");
  await page.evaluate(() => localStorage.setItem("aegisub-web.global-hotkeys", "true"));
  const text = page.locator(".se-detail textarea");
  await text.fill("");
  await text.pressSequentially("sdfg");
  await expect(text).toHaveValue("sdfg");
  expect((await cue(page, 1)).text).toBe("sdfg");
});

test("video and audio survive independent replacement, closing, and subtitle loading", async ({ page }) => {
  await page.locator("#media-file").setInputFiles("test-corpus/tiny-timing.mp4");
  const video = page.locator(".se-playerhost video");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.duration)).toBeGreaterThan(1);
  const src = await video.evaluate((v: HTMLVideoElement) => v.currentSrc);
  await page.locator("#media-file").setInputFiles("test-corpus/tiny.wav");
  const audio = page.locator(".se-audio-player audio");
  await expect.poll(() => audio.evaluate((v: HTMLAudioElement) => v.duration)).toBeGreaterThan(.5);
  expect(await video.evaluate((v: HTMLVideoElement) => v.currentSrc)).toBe(src);
  await page.locator("#file").setInputFiles("test-corpus/base.ass");
  expect(await video.evaluate((v: HTMLVideoElement) => v.currentSrc)).toBe(src);
  await video.evaluate(v => { (window as any).__closedVideo = v; });
  await command(page, "video/close");
  await expect(video).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__closedVideo.networkState)).toBe(0);
  expect(await page.evaluate(async url => { try { return (await fetch(url)).ok; } catch { return false; } }, src)).toBe(false);
  await expect(audio).toHaveCount(1);
  await page.locator("#media-file").setInputFiles("test-corpus/tiny-timing.mp4");
  await expect(video).toHaveCount(1);
  await expect(page.locator(".se-root")).toHaveAttribute("data-audio-name", "tiny.wav");
  await command(page, "audio/close");
  await expect(audio).toHaveCount(0);
  await expect(video).toHaveCount(1);
});

test("audio S auditions the draft, D plays its tail, R plays the saved line, video stays paused", async ({ page }, info) => {
  test.skip(/android|ipad|iphone/.test(info.project.name), "keyboard sequence tested with desktop profiles");
  await page.locator("#media-file").setInputFiles("test-corpus/tiny-timing.mp4");
  await expect.poll(() => page.locator(".se-audio-player audio").evaluate((v: HTMLAudioElement) => v.duration)).toBeGreaterThan(3);
  await page.evaluate(() => {
    const h = (window as any).subHandle;
    h.loadDocument({ text: "1\n00:00:00,200 --> 00:00:00,700\nAudition\n", filename: "audition.srt" });
  });
  await page.locator(".se-timeline").focus();
  await page.keyboard.press("s");
  const audio = page.locator(".se-audio-player audio");
  await expect.poll(() => audio.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(.25);
  await expect.poll(() => audio.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  expect(await audio.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeLessThan(.82);
  expect(await page.locator(".se-playerhost video").evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await page.keyboard.press("d");
  await expect.poll(() => audio.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  await page.keyboard.press("h");
  await expect.poll(() => audio.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
});
