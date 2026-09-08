import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { embedAssAttachment } from "../src/aegisub-tools";
import { parseSubtitles, serializeSubtitles } from "../src/formats";

test("plain subtitle formats load CJK fallback and render distinct Chinese glyphs on virtual video", async ({ page }, info) => {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => !!(window as any).subHandle)).toBe(true);
  await page.locator("#file").setInputFiles({ name: "plain.srt", mimeType: "text/plain", buffer: Buffer.from("1\n00:00:00,000 --> 00:00:05,000\n甲甲\n") });
  await page.locator('.quickbar [data-aegisub-command="video/open/dummy"]').click();
  await page.getByLabel("宽度", { exact: true }).fill("384"); await page.getByLabel("高度", { exact: true }).fill("288");
  await page.getByLabel("帧率", { exact: true }).fill("24"); await page.getByLabel("时长（帧）", { exact: true }).fill("240");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  const fingerprint = () => page.locator(".libassjs-canvas-parent canvas").evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 0, count = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 100) { hash = (Math.imul(hash, 31) + i) >>> 0; count++; }
    return { hash, count };
  });
  await expect.poll(async () => (await fingerprint()).count).toBeGreaterThan(100);
  const first = await fingerprint();
  if (/android|ipad|iphone/.test(info.project.name)) await page.getByRole("tab", { name: "字幕", exact: true }).click();
  await page.locator(".se-detail textarea").fill("乙乙");
  if (/android|ipad|iphone/.test(info.project.name)) await page.getByRole("tab", { name: "视频", exact: true }).click();
  // Two missing CJK characters render the same pair of tofu boxes. A font count
  // or nonzero alpha would incorrectly pass that regression; require different ink.
  await expect.poll(async () => { const value = await fingerprint(); return value.count > 100 && value.hash !== first.hash; }).toBe(true);
  await expect(page.locator(".se-root")).toHaveAttribute("data-bundled-preview-fonts", "1");
  await page.locator("#file").setInputFiles({ name: "plain.vtt", mimeType: "text/vtt", buffer: Buffer.from("WEBVTT\n\n00:00:00.000 --> 00:00:05.000\n中文\n") });
  await expect(page.locator(".se-root")).toHaveAttribute("data-bundled-preview-fonts", "1");
  await expect(page.locator(".se-dummy-video")).toHaveCount(1);
});

test("loads a CJK font when Chinese and inline font names are introduced after video", async ({ page }, info) => {
  test.skip(info.project.name !== "windows-chromium", "font-pool reload and glyph regression");
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => !!(window as any).subHandle)).toBe(true);
  const english = readFileSync("test-corpus/base.ass", "utf8").replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, "x");
  await page.locator("#file").setInputFiles({ name: "english.ass", mimeType: "text/plain", buffer: Buffer.from(english) });
  await page.locator("#media-file").setInputFiles("test-corpus/tiny-timing.mp4");
  const root = page.locator(".se-root");
  await expect(root).toHaveAttribute("data-bundled-preview-fonts", "0");
  await expect.poll(() => page.locator(".se-playerhost video").evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  await page.locator(".se-row").first().click();
  await page.locator(".se-detail textarea").fill("{\\an5\\fnSource Han Sans CN Medium}中文测试");
  await expect(root).toHaveAttribute("data-bundled-preview-fonts", "2");
  await expect.poll(() => page.locator(".se-playerhost video").evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(1, 3);
  expect(await page.locator(".se-playerhost video").evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await expect(page.locator(".se-detail textarea")).toBeFocused();
  await expect(page.locator(".se-font-warning")).not.toContainText("Source Han Sans CN Medium");
  await expect.poll(() => page.locator(".libassjs-canvas-parent canvas").evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels.filter((value, index) => index % 4 === 3 && value > 100).length;
  })).toBeGreaterThan(100);
  await page.locator(".se-detail textarea").fill("{\\fnSource Han Sans CN Bold}中文");
  await expect(page.locator(".se-font-warning")).toContainText("Source Han Sans CN Bold");
  await expect(root).toHaveAttribute("data-media-name", "tiny-timing.mp4");
});

test("disposes registered font faces when the preview closes", async ({ page }, info) => {
  test.skip(info.project.name !== "windows-chromium", "owned FontFace lifecycle regression");
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => !!(window as any).subHandle)).toBe(true);
  const baseline = await page.evaluate(() => document.fonts.size);
  const font = readFileSync("node_modules/@jellyfin/libass-wasm/dist/js/default.woff2");
  const doc = embedAssAttachment(parseSubtitles(readFileSync("test-corpus/base.ass", "utf8"), "base.ass"), "TestEmbedded.woff2", font, "font");
  await page.locator("#file").setInputFiles({ name: "embedded.ass", mimeType: "text/plain", buffer: Buffer.from(serializeSubtitles(doc)) });
  await page.locator("#media-file").setInputFiles("test-corpus/tiny-timing.mp4");
  await expect.poll(() => page.evaluate(() => document.fonts.size)).toBeGreaterThan(baseline);
  await page.evaluate(() => (window as any).subHandle.runAegisubCommand("video/close"));
  await expect.poll(() => page.evaluate(() => document.fonts.size)).toBe(baseline);
  await expect(page.locator(".se-root")).toHaveAttribute("data-preview-fonts", "0");
});
