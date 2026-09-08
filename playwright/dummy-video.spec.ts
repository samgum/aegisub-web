import { expect, test, type Page } from "@playwright/test";

async function create(page: Page, frames = "480", fps = "24000/1001", pattern = false) {
  await page.locator('.quickbar [data-aegisub-command="video/open/dummy"]').click();
  await page.getByLabel("宽度", { exact: true }).fill("384");
  await page.getByLabel("高度", { exact: true }).fill("288");
  await page.getByLabel("帧率", { exact: true }).fill(fps);
  await page.getByLabel("时长（帧）", { exact: true }).fill(frames);
  await page.getByLabel("背景颜色", { exact: true }).fill("#808080");
  await page.getByLabel("棋盘格", { exact: true }).setChecked(pattern);
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator(".se-dummy-video")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "VideoEncoder", { configurable: true, value: undefined });
    Object.defineProperty(window, "AudioEncoder", { configurable: true, value: undefined });
  });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => !!(window as any).subHandle)).toBe(true);
  await page.locator("#file").setInputFiles("test-corpus/base.ass");
});

test("dummy video needs no encoder and has a seekable fractional-rate clock", async ({ page }, info) => {
  await create(page);
  const surface = page.locator(".se-dummy-video");
  expect(await surface.evaluate((c: any) => c.duration)).toBeCloseTo(20.02, 5);
  await expect(page.locator(".se-playerhost video")).toHaveCount(0);
  await page.evaluate(() => (window as any).subHandle.runAegisubCommand("video/frame/next"));
  expect(await surface.evaluate((c: any) => c.currentTime)).toBeCloseTo(1001 / 24000, 5);
  await page.locator(".se-video-controls button").first().click();
  await expect.poll(() => surface.evaluate((c: any) => c.currentTime)).toBeGreaterThan(.15);
  await page.evaluate(() => (window as any).subHandle.runAegisubCommand("video/stop"));
  expect(await surface.evaluate((c: any) => c.paused)).toBe(true);
  await page.screenshot({ path: info.outputPath("dummy-workspace.png") });
});

test("native eight-pixel checkerboard uses one background image even for millions of frames", async ({ page }) => {
  await create(page, "36000000", "1000", true);
  const pixels = await page.locator(".se-dummy-video").evaluate((c: HTMLCanvasElement) => {
    const context = c.getContext("2d")!;
    return [context.getImageData(0, 0, 1, 1).data[0], context.getImageData(8, 0, 1, 1).data[0], context.getImageData(8, 8, 1, 1).data[0], c.width, c.height];
  });
  expect(pixels).toEqual([128, 152, 128, 384, 288]);
  await expect(page.locator(".se-root")).toHaveAttribute("data-video-frames", "36000000");
  await page.evaluate(() => (window as any).subHandle.runAegisubCommand("video/close"));
  await expect(page.locator(".se-dummy-video")).toHaveCount(0);
});

test("ASS preview responds to seeking on dummy video and stays editable", async ({ page }, info) => {
  await page.locator(".se-detail textarea").fill("{\\an5\\pos(192,144)\\fad(500,0)}中文预览");
  await create(page, "240", "24");
  const surface = page.locator(".se-dummy-video"), canvas = page.locator(".libassjs-canvas-parent canvas");
  const alpha = () => canvas.evaluate((c: HTMLCanvasElement) => {
    const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let sum = 0; for (let i = 3; i < data.length; i += 4) sum += data[i]; return sum;
  });
  await surface.evaluate((c: any) => { c.currentTime = 1.75; });
  await expect.poll(alpha).toBeGreaterThan(1000);
  const full = await alpha();
  await surface.evaluate((c: any) => { c.currentTime = 1; });
  await expect.poll(alpha).toBeLessThan(full * .2);
  if (/android|ipad|iphone/.test(info.project.name)) await page.getByRole("tab", { name: "字幕" }).click();
  await page.locator(".se-detail textarea").fill("字幕仍可编辑");
  expect(await page.evaluate(() => (window as any).subHandle.getDoc().cues[0].text)).toBe("字幕仍可编辑");
});

test("blank and noise audio are independent procedural sources, and noise actually reaches Web Audio", async ({ page }) => {
  await create(page);
  await page.evaluate(() => (window as any).subHandle.runAegisubCommand("audio/open/noise"));
  await expect(page.locator(".se-root")).toHaveAttribute("data-audio-source", "noise");
  await expect(page.locator(".se-dummy-video")).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).subHandle.audio.duration)).toBe(9000);
  await page.locator('.se-audio-controls button[aria-label="播放选择"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).subHandle.audio.synthetic.level())).toBeGreaterThan(.02);
  await expect.poll(() => page.evaluate(() => (window as any).subHandle.audio.currentTime)).toBeGreaterThan(1.05);
  await page.locator('.se-audio-controls button[aria-label="停止"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).subHandle.audio.synthetic.context.state)).toBe("suspended");
  const [download] = await Promise.all([page.waitForEvent("download"), page.evaluate(() => (window as any).subHandle.runAegisubCommand("audio/save/clip"))]);
  const stream = await download.createReadStream(), chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const wav = Buffer.concat(chunks);
  expect(wav.toString("ascii", 0, 4)).toBe("RIFF"); expect(wav.readUInt32LE(24)).toBe(44100);
  expect(wav.readUInt16LE(22)).toBe(1); expect(wav.readUInt16LE(34)).toBe(16);
  await page.evaluate(() => (window as any).subHandle.runAegisubCommand("audio/open/blank"));
  await expect(page.locator(".se-root")).toHaveAttribute("data-audio-source", "blank");
  expect(await page.evaluate(() => (window as any).subHandle.audio.synthetic.level())).toBe(0);
  await page.evaluate(() => (window as any).subHandle.runAegisubCommand("audio/view/spectrum"));
  await expect(page.locator(".se-timeline")).toHaveAttribute("data-audio-view", "spectrum");
  expect(await page.evaluate(() => (window as any).subHandle.spectrumData.values.some((v: number) => v !== 0))).toBe(false);
  await page.evaluate(async () => {
    const editor = (window as any).subHandle;
    editor.runAegisubCommand("audio/play/selection"); editor.runAegisubCommand("audio/stop");
    await new Promise(requestAnimationFrame);
  });
  expect(await page.evaluate(() => (window as any).subHandle.audio.element.paused)).toBe(true);
  await page.evaluate(() => (window as any).subHandle.runAegisubCommand("audio/close"));
  await expect(page.locator(".se-root")).toHaveAttribute("data-audio-source", "");
  await expect(page.locator(".se-dummy-video")).toHaveCount(1);
});
