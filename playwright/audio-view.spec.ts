import { expect, test, type Page } from "@playwright/test";

const view = (page: Page) => page.evaluate(() => {
  const editor = (window as any).subHandle;
  return { left: editor.timeline.scrollSec, scale: editor.timeline.pxPerSec, gridFollow: editor.followPlayback };
});
async function selectRow(page: Page, index: number, mobile: boolean) {
  if (mobile) await page.getByRole("tab", { name: "字幕" }).click();
  await page.locator(".se-row").nth(index).click();
  if (mobile) await page.getByRole("tab", { name: "音频" }).click();
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => !!(window as any).subHandle)).toBe(true);
  await page.locator("#file").setInputFiles("test-corpus/base.ass");
  await page.evaluate(() => (window as any).subHandle.runAegisubCommand("audio/open/blank"));
});

test("A/F scroll 128 pixels at native base zoom and after wheel zoom", async ({ page }) => {
  const canvas = page.locator(".se-timeline");
  await canvas.focus();
  expect((await view(page)).scale).toBe(50);
  await page.keyboard.press("f");
  const first = await view(page);
  expect(first.left * first.scale).toBeCloseTo(128, 5);
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -200);
  await expect.poll(async () => (await view(page)).scale).toBeGreaterThan(50);
  const zoomed = await view(page);
  await page.keyboard.press("f");
  const after = await view(page);
  expect((after.left - zoomed.left) * after.scale).toBeCloseTo(128, 5);
  await page.keyboard.press("a");
  expect((await view(page)).left).toBeCloseTo(zoomed.left, 5);
  await page.evaluate(() => (window as any).subHandle.runAegisubCommand("audio/view/waveform"));
  expect((await view(page)).scale).toBeCloseTo(zoomed.scale, 5);
});

test("audio auto-scroll is independent of grid follow and keeps the selected range visible", async ({ page }, info) => {
  const mobile = /android|ipad|iphone/.test(info.project.name);
  const before = await view(page);
  const button = page.locator('[data-audio-option="audio-autoscroll"]');
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await button.click();
  await selectRow(page, 5, mobile);
  expect((await view(page)).left).toBe(before.left);
  expect((await view(page)).gridFollow).toBe(before.gridFollow);
  await button.click();
  await selectRow(page, 0, mobile); await selectRow(page, 5, mobile);
  expect((await view(page)).left).toBeGreaterThan(3000);
  expect((await view(page)).scale).toBe(50);
  expect((await view(page)).gridFollow).toBe(before.gridFollow);
});

test("V adds the native 350ms lead-out and respects an explicit zero", async ({ page }) => {
  await page.locator(".se-timeline").focus();
  const end = await page.evaluate(() => (window as any).subHandle.getDoc().cues[0].endMs);
  await page.keyboard.press("v");
  expect(await page.evaluate(() => (window as any).subHandle.audioSelection().endMs)).toBe(end + 350);
  await page.evaluate(() => localStorage.setItem("aegisub-web.lead-out", "0"));
  await page.keyboard.press("v");
  expect(await page.evaluate(() => (window as any).subHandle.audioSelection().endMs)).toBe(end + 350);
  await page.keyboard.press("g");
  expect(await page.evaluate(() => (window as any).subHandle.getDoc().cues[0].endMs)).toBe(end + 350);
});

test("dialogue waveform draws timing markers rather than raw subtitle tags and text", async ({ page }, info) => {
  await page.evaluate(() => (window as any).subHandle.runAegisubCommand("audio/open/noise"));
  const labels = await page.evaluate(() => {
    const timeline = (window as any).subHandle.timeline;
    const context = timeline.canvas.getContext("2d"), original = context.fillText, calls: string[] = [];
    context.fillText = function(text: string, ...args: any[]) { calls.push(text); return original.call(this, text, ...args); };
    try { timeline.render(); } finally { context.fillText = original; }
    return calls;
  });
  expect(labels.length).toBeGreaterThan(0); // ruler is still drawn
  expect(labels.some(label => /Hello|Two lines|\\\\/.test(label))).toBe(false);
  await page.screenshot({ path: info.outputPath("audio-workspace.png") });
});
