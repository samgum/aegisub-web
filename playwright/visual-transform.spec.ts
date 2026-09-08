import { expect, test, type Page } from "@playwright/test";

const original = "{\\an5\\pos(192,144)\\t(0,1000,\\blur4)}中文测试";
async function savedText(page: Page) { return page.evaluate(() => (window as any).subHandle.getDoc().cues[0].text); }
test.beforeEach(async ({ page }, info) => {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => !!(window as any).subHandle)).toBe(true);
  await page.locator("#file").setInputFiles("test-corpus/base.ass");
  await page.locator(".se-detail textarea").fill(original);
  await page.locator("#media-file").setInputFiles("test-corpus/tiny-timing.mp4");
  await expect.poll(() => page.locator(".se-playerhost video").evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
  if (/android|ipad|iphone/.test(info.project.name)) await page.getByRole("tab", { name: "字幕" }).click();
  await page.locator(".se-row").first().click();
  if (/android|ipad|iphone/.test(info.project.name)) await page.getByRole("tab", { name: "视频" }).click();
});

test("G scales on the video, previews without saving, commits once and is undoable", async ({ page }, info) => {
  test.skip(/android|ipad|iphone/.test(info.project.name), "desktop keyboard workflow");
  const renderedWidth = () => page.locator(".libassjs-canvas-parent canvas").evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width, right = -1;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (pixels[(y * canvas.width + x) * 4 + 3] > 30) { left = Math.min(left, x); right = Math.max(right, x); }
    return Math.max(0, right - left + 1);
  });
  await expect.poll(renderedWidth).toBeGreaterThan(20);
  const initialWidth = await renderedWidth();
  await page.locator(".se-playerhost video").focus();
  await page.keyboard.press("g");
  const overlay = page.locator('[data-visual-transform="scale"]');
  await expect(overlay).toBeVisible();
  const box = (await overlay.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 40, y - 20, { steps: 5 });
  expect(await savedText(page)).toBe(original);
  await expect.poll(renderedWidth).toBeGreaterThan(initialWidth * 1.25);
  await page.mouse.up();
  expect(await savedText(page)).toContain("\\fscx150\\fscy125");
  expect(await savedText(page)).toContain("\\t(0,1000,\\blur4)");
  await page.screenshot({ path: info.outputPath("scale-preview.png") });
  await page.keyboard.press(info.project.name === "macos-webkit" ? "Meta+z" : "Control+z");
  expect(await savedText(page)).toBe(original);
  await expect.poll(renderedWidth).toBeLessThanOrEqual(initialWidth + 2);
});

test("D rotates around the origin and F changes XY angles with native pixel increments", async ({ page }, info) => {
  test.skip(/android|ipad|iphone/.test(info.project.name), "desktop keyboard workflow");
  const video = page.locator(".se-playerhost video");
  await video.focus(); await page.keyboard.press("d");
  const overlay = page.locator('[data-visual-transform="rotate-z"]');
  const origin = overlay.locator(".se-visual-origin-hit");
  const center = (await origin.boundingBox())!;
  const x = center.x + center.width / 2, y = center.y + center.height / 2;
  await page.keyboard.down("Control");
  await page.mouse.move(x + 60, y); await page.mouse.down(); await page.mouse.move(x, y - 60, { steps: 5 }); await page.mouse.up();
  await page.keyboard.up("Control");
  expect(await savedText(page)).toContain("\\frz90");
  await page.keyboard.press("f");
  await expect(page.locator('[data-visual-transform="rotate-xy"]')).toBeVisible();
  await page.mouse.move(x + 60, y); await page.mouse.down(); await page.mouse.move(x + 75, y - 10, { steps: 3 }); await page.mouse.up();
  expect(await savedText(page)).toContain("\\frx20\\fry30");
  expect(await savedText(page)).toContain("\\frz90");
});

test("Escape cancels an in-progress transform without touching document or original animation", async ({ page }, info) => {
  test.skip(/android|ipad|iphone/.test(info.project.name), "desktop keyboard workflow");
  await page.locator(".se-playerhost video").focus(); await page.keyboard.press("g");
  const box = (await page.locator('[data-visual-transform="scale"]').boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 50, y - 25, { steps: 4 });
  await page.keyboard.press("Escape"); await page.mouse.up();
  expect(await savedText(page)).toBe(original);
  await expect(page.locator(".se-visual-readout")).toHaveText("X 100% · Y 100%");
});

test("phone touch drag scales subtitles and keeps the text editor reachable", async ({ page }, info) => {
  test.skip(info.project.name !== "android-chromium", "touch-event protocol test; iOS physical input remains separately required");
  await page.locator('.se-video-tool[data-video-tool="video/tool/scale"]').tap();
  const box = (await page.locator('[data-visual-transform="scale"]').boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + 40, y: y - 20 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally { await session.detach(); }
  expect(await savedText(page)).toContain("\\fscx150\\fscy125");
  await page.getByRole("tab", { name: "字幕" }).click();
  await expect(page.locator(".se-detail textarea")).toBeVisible();
  await expect(page.locator(".se-detail textarea")).toHaveValue(await savedText(page));
});
