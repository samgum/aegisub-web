import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { embedAssAttachment } from "../src/aegisub-tools";
import { parseSubtitles, serializeSubtitles } from "../src/formats";

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
