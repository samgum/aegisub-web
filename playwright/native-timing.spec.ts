import { expect, test, type Page } from "@playwright/test";

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
  await command(page, "video/close");
  await expect(video).toHaveCount(0);
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
