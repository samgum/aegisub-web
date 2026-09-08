import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

test("native video keeps one active AV transport and caches waveform painting", async ({ page }, info) => {
  await page.goto("/"); await expect.poll(() => page.evaluate(() => !!(window as any).subHandle)).toBe(true);
  await page.locator("#file").setInputFiles("test-corpus/base.ass");
  await page.locator("#media-file").setInputFiles("test-corpus/tiny-timing.mp4");
  const root = page.locator(".se-root"), video = page.locator(".se-playerhost video");
  await expect(root).toHaveAttribute("data-video-decoder", "native");
  await expect(video).toHaveAttribute("preload", "auto");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => page.evaluate(() => !!(window as any).subHandle.audio.element)).toBe(true);
  await expect.poll(() => page.evaluate(() => !!(window as any).subHandle.wavePeaks)).toBe(true);
  await page.evaluate(() => {
    const h = (window as any).subHandle; (window as any).performanceProbe = { repaint: 0, cursor: 0 };
    const full = h.timeline.render.bind(h.timeline), cursor = h.timeline.renderPlayhead.bind(h.timeline);
    h.timeline.render = () => { (window as any).performanceProbe.repaint++; full(); };
    h.timeline.renderPlayhead = () => { (window as any).performanceProbe.cursor++; cursor(); };
  });
  await video.evaluate((v: HTMLVideoElement) => v.play());
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(1.5);
  const result = await page.evaluate(() => {
    const h = (window as any).subHandle;
    return { ...(window as any).performanceProbe, hiddenPaused: h.audio.element.paused, muted: h.video.muted };
  });
  expect(result.hiddenPaused).toBe(true); expect(result.muted).toBe(false);
  expect(result.cursor).toBeGreaterThan(10); expect(result.repaint).toBeLessThan(result.cursor / 2);
  await info.attach("native-transport", { body: JSON.stringify(result), contentType: "application/json" });
  for (let i = 0; i < 8; i++) await video.evaluate((v: HTMLVideoElement) => { void v.play().catch(() => {}); v.pause(); });
  await expect(page.locator(".se-wave-status")).not.toContainText("interrupted");
  // Font/subtitle imports must retain the exact native element and its paused position.
  await video.evaluate((v: HTMLVideoElement) => { v.currentTime = 2; (window as any).savedVideo = v; });
  await page.locator("#file").setInputFiles("test-corpus/base.ass");
  expect(await video.evaluate(v => v === (window as any).savedVideo)).toBe(true);
  await page.evaluate(() => (window as any).subHandle.runAegisubCommand("video/close"));
  await expect(video).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).savedVideo.getAttribute("src"))).toBeNull();
});

test("4K playback uses disk-backed input and display-sized subtitles", async ({ page }, info) => {
  const fixture = process.env.AEGISUB_4K_FIXTURE;
  test.skip(!fixture || !existsSync(fixture), "Optional real 4K benchmark: set AEGISUB_4K_FIXTURE to a 4K H.264/AAC fixture");
  test.slow();
  await page.goto("/"); await expect.poll(() => page.evaluate(() => !!(window as any).subHandle)).toBe(true);
  await page.evaluate(() => {
    (window as any).wholeFileReads = 0;
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function() { (window as any).wholeFileReads++; return read.call(this); };
  });
  await page.locator("#file").setInputFiles("test-corpus/base.ass");
  await page.locator("#media-file").setInputFiles({ name: "benchmark-4k.mp4", mimeType: "video/mp4", buffer: readFileSync(fixture!) });
  const video = page.locator(".se-playerhost video"), root = page.locator(".se-root");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(3840);
  // The fixture's resolution differs from the script; explicitly retain the script dimensions.
  const ignore = page.getByRole("button", { name: /^(Ignore|忽略)$/ }); await expect(ignore).toBeVisible(); await ignore.click();
  await expect(root).toHaveAttribute("data-waveform-decoder", "worker-ready", { timeout: 30000 });
  await video.evaluate((v: HTMLVideoElement) => { v.currentTime = 0; });
  await video.evaluate((v: HTMLVideoElement) => v.play());
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 15000 }).toBeGreaterThan(4);
  await video.evaluate((v: HTMLVideoElement) => v.pause());
  const result = await page.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>(".se-playerhost video")!, canvas = document.querySelector<HTMLCanvasElement>(".se-playerhost .libassjs-canvas")!;
    const quality = v.getVideoPlaybackQuality();
    return { width: v.videoWidth, height: v.videoHeight, time: v.currentTime, wholeFileReads: (window as any).wholeFileReads, canvas: [canvas.width, canvas.height], totalFrames: quality.totalVideoFrames, droppedFrames: quality.droppedVideoFrames, hiddenPaused: (window as any).subHandle.audio.element.paused };
  });
  expect(result.wholeFileReads).toBe(0); expect(result.hiddenPaused).toBe(true); expect(result.canvas[1]).toBeLessThanOrEqual(1080); expect(result.totalFrames).toBeGreaterThan(90);
  await info.attach("4k-playback-quality", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
  await page.screenshot({ path: info.outputPath("4k-video.png") });
  const baseline = await page.evaluate(async () => {
    const editorVideo = document.querySelector<HTMLVideoElement>(".se-playerhost video")!;
    const plain = document.createElement("video"); plain.src = editorVideo.src; plain.muted = true; plain.style.cssText = "position:fixed;inset:0;width:618px;height:347px;z-index:99999"; document.body.append(plain);
    await plain.play();
    await new Promise<void>(resolve => { const check = () => { if (plain.currentTime >= 5) { plain.removeEventListener("timeupdate", check); resolve(); } }; plain.addEventListener("timeupdate", check); });
    plain.pause(); const q = plain.getVideoPlaybackQuality(); const result = { time: plain.currentTime, totalFrames: q.totalVideoFrames, droppedFrames: q.droppedVideoFrames };
    plain.removeAttribute("src"); plain.load(); plain.remove(); return result;
  });
  await info.attach("4k-native-baseline", { body: JSON.stringify(baseline, null, 2), contentType: "application/json" });
  expect(result.droppedFrames / result.totalFrames).toBeLessThanOrEqual(baseline.droppedFrames / baseline.totalFrames + .05);
});
