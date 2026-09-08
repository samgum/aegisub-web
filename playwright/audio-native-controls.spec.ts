import { expect, test, type Page } from "@playwright/test";

const command = (page: Page, name: string) => page.evaluate(name => (window as any).subHandle.runAegisubCommand(name), name);
const range = (page: Page) => page.evaluate(() => (window as any).subHandle.audioSelection());
const saved = (page: Page) => page.evaluate(() => (window as any).subHandle.getDoc().cues[0]);
async function slider(page: Page, name: string, value: number) {
  await page.getByRole("slider", { name, exact: true }).evaluate((input: HTMLInputElement, value) => { input.value = String(value); input.dispatchEvent(new Event("input", { bubbles: true })); }, value);
}
async function clickTime(page: Page, seconds: number, shift = false) {
  const wave = page.locator(".se-timeline"), box = (await wave.boundingBox())!;
  const x = await page.evaluate(seconds => { const timeline = (window as any).subHandle.timeline; return (seconds - timeline.scrollSec) * timeline.pxPerSec; }, seconds);
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.click(box.x + x, box.y + 60, { button: "right" });
  if (shift) await page.keyboard.up("Shift");
}
test.beforeEach(async ({ page }) => {
  await page.goto("/"); await expect.poll(() => page.evaluate(() => !!(window as any).subHandle)).toBe(true);
  await page.locator("#file").setInputFiles("test-corpus/base.ass"); await command(page, "audio/open/blank");
});

test("default snapping, Shift inversion, pending-draft cancellation and one-step commit undo", async ({ page }, info) => {
  test.skip(/android|ipad|iphone/.test(info.project.name), "secondary-button keyboard workflow; touch controls have separate coverage");
  await clickTime(page, 3.9); expect((await range(page)).endMs).toBe(4000); expect((await saved(page)).endMs).toBe(3000);
  await clickTime(page, 3.9, true); expect((await range(page)).endMs).toBe(3900);
  const wave = page.locator(".se-timeline"), box = (await wave.boundingBox())!;
  await page.mouse.move(box.x + 260, box.y + 60); await page.mouse.down({ button: "right" });
  await page.mouse.move(box.x + 280, box.y + 60); await page.keyboard.press("Escape"); await page.mouse.up({ button: "right" });
  expect((await range(page)).endMs).toBe(3900); expect((await saved(page)).endMs).toBe(3000);
  await page.keyboard.press("g"); expect((await saved(page)).endMs).toBe(3900);
  await command(page, "edit/undo"); expect((await saved(page)).endMs).toBe(3000);
  await page.evaluate(() => { (window as any).subHandle.selectCueById((window as any).subHandle.getDoc().cues[0].id); localStorage.setItem("aegisub-web.audio-snap", "false"); });
  await clickTime(page, 3.9); expect((await range(page)).endMs).toBe(3900);
  await clickTime(page, 3.9, true); expect((await range(page)).endMs).toBe(4000);
});

test("ruler drag scrolls; dragging a marker outside scrolls after the native delay", async ({ page }, info) => {
  test.skip(/android|ipad|iphone/.test(info.project.name), "desktop pointer capture path");
  const wave = page.locator(".se-timeline"), box = (await wave.boundingBox())!;
  await page.mouse.move(box.x + 300, box.y + 8); await page.mouse.down(); await page.mouse.move(box.x + 200, box.y + 8); await page.mouse.up();
  expect(await page.evaluate(() => (window as any).subHandle.timeline.scrollSec)).toBeCloseTo(2, 4);
  expect((await saved(page)).startMs).toBe(1000);
  await page.getByRole("slider", { name: "音频水平滚动" }).evaluate((input: HTMLInputElement) => { input.value = "0"; input.dispatchEvent(new Event("input")); });
  await page.mouse.move(box.x + 75, box.y + 60); await page.mouse.down();
  await page.mouse.move(box.x + box.width + 25, box.y + 60);
  await expect.poll(() => page.evaluate(() => (window as any).subHandle.timeline.scrollSec)).toBeGreaterThan(0);
  await page.keyboard.press("Escape"); await page.mouse.up(); expect((await saved(page)).endMs).toBe(3000);
});

test("wheel pans by default, Ctrl zooms using native levels, and sliders stay synchronized", async ({ page }, info) => {
  if (/android|ipad|iphone/.test(info.project.name)) {
    await slider(page, "音频横向缩放", 2);
  } else {
    const box = (await page.locator(".se-timeline").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 60); await page.mouse.wheel(0, 100);
    await expect.poll(() => page.evaluate(() => (window as any).subHandle.timeline.scrollSec)).toBe(2);
    expect(await page.evaluate(() => (window as any).subHandle.timeline.pxPerSec)).toBe(50);
    await page.keyboard.down("Control"); await page.mouse.wheel(0, -200); await page.keyboard.up("Control");
  }
  await expect(page.getByRole("slider", { name: "音频横向缩放" })).toHaveValue("2");
  expect(await page.evaluate(() => (window as any).subHandle.timeline.pxPerSec)).toBe(75);
  await page.screenshot({ path: info.outputPath("audio-controls.png") });
});

test("linked amplitude and volume change the actual generated audio signal", async ({ page }, info) => {
  await command(page, "audio/open/noise");
  const volume = page.getByRole("slider", { name: "音频音量", exact: true }); await expect(volume).toBeDisabled();
  await page.locator(".se-audio-controls").getByRole("button", { name: "播放当前行", exact: true }).click();
  await command(page, "audio/play/to_end");
  const rms = () => page.evaluate(() => (window as any).subHandle.audio.synthetic.level());
  await expect.poll(rms).toBeGreaterThan(.02); const original = await rms();
  await slider(page, "波形纵向缩放", 25); await expect(volume).toHaveValue("25");
  await expect.poll(rms).toBeLessThan(original * .2); const quiet = await rms(); expect(quiet).toBeGreaterThan(original * .06);
  expect(await page.evaluate(() => (window as any).subHandle.timeline.amplitude)).toBe(.125);
  await page.getByRole("button", { name: "联动波形增益与音量", exact: true }).click(); await expect(volume).toBeEnabled();
  await slider(page, "音频音量", 50); await expect.poll(rms).toBeGreaterThan(original * .75);
  expect(await page.evaluate(() => (window as any).subHandle.timeline.amplitude)).toBe(.125);
  await info.attach("actual-gain", { body: JSON.stringify({ original, quiet, restored: await rms() }), contentType: "application/json" });
});

test("keyframes and video frame edges snap at native frame midpoints; middle drag seeks video", async ({ page }, info) => {
  test.skip(/android|ipad|iphone/.test(info.project.name), "desktop frame marker mouse workflow");
  await page.locator("#media-file").setInputFiles("test-corpus/tiny-timing.mp4");
  const video = page.locator(".se-playerhost video"); await expect(page.locator(".se-root")).toHaveAttribute("data-frame-index", "ready");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => { const h = (window as any).subHandle; h.keyframesMs = [2000]; h.video.currentTime = 5; h.timeline.render(); });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.seeking)).toBe(false);
  await clickTime(page, 1.9); expect((await range(page)).endMs).toBe(1979);
  await page.evaluate(() => { localStorage.setItem("aegisub-web.audio-show-keyframes", "false"); (window as any).subHandle.video.currentTime = 2; });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.seeking)).toBe(false);
  await clickTime(page, 2.04); expect((await range(page)).endMs).toBe(2021);
  const box = (await page.locator(".se-timeline").boundingBox())!;
  await page.mouse.move(box.x + 175, box.y + 60); await page.mouse.down({ button: "middle" }); await page.mouse.move(box.x + 200, box.y + 60); await page.mouse.up({ button: "middle" });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(4, 3); expect((await saved(page)).endMs).toBe(3000);
});

test("file audio uses actual Web Audio gain and releases its output nodes", async ({ page }, info) => {
  const rate = 48000, count = rate * 6, buffer = Buffer.alloc(44 + count * 2);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36); buffer.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) buffer.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / rate) * 1600), 44 + i * 2);
  await page.locator("#media-file").setInputFiles({ name: "gain-reference.wav", mimeType: "audio/wav", buffer });
  await expect.poll(() => page.evaluate(() => (window as any).subHandle.audio.duration)).toBe(6);
  await page.getByRole("button", { name: "联动波形增益与音量", exact: true }).click(); await slider(page, "音频音量", 25);
  await page.locator(".se-audio-controls").getByRole("button", { name: "播放当前行", exact: true }).click(); await command(page, "audio/play/to_end");
  const rms = () => page.evaluate(() => { const audio = (window as any).subHandle.audio; return audio.output.level(audio.element); });
  await expect.poll(rms).toBeGreaterThan(.002); const quiet = await rms();
  await slider(page, "音频音量", 50); await expect.poll(rms).toBeGreaterThan(.02); const normal = await rms();
  expect(normal / quiet).toBeGreaterThan(6); expect(normal / quiet).toBeLessThan(10);
  await info.attach("native-file-gain", { body: JSON.stringify({ quiet, normal, ratio: normal / quiet }), contentType: "application/json" });
  await command(page, "audio/close"); expect(await page.evaluate(() => (window as any).subHandle.audio.output.active.size)).toBe(0);
});
