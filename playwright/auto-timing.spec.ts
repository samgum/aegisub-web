import { expect, test, type Page } from "@playwright/test";

const command = (page: Page, name: string) => page.evaluate(name => (window as any).subHandle.runAegisubCommand(name), name);
const doc = (page: Page) => page.evaluate(() => (window as any).subHandle.getDoc());
async function moveToTime(page: Page, seconds: number) {
  const box = (await page.locator(".se-timeline").boundingBox())!;
  const x = await page.evaluate(seconds => { const t = (window as any).subHandle.timeline; return (seconds - t.scrollSec) * t.pxPerSec; }, seconds);
  await page.mouse.move(box.x + x, box.y + 60);
}
async function endClick(page: Page, seconds: number) { await moveToTime(page, seconds); await page.mouse.down({ button: "right" }); await page.mouse.up({ button: "right" }); }
test.beforeEach(async ({ page }) => {
  await page.goto("/"); await expect.poll(() => page.evaluate(() => !!(window as any).subHandle)).toBe(true);
  await page.locator("#file").setInputFiles("test-corpus/base.ass"); await command(page, "audio/open/blank");
  await page.evaluate(() => { localStorage.setItem("aegisub-web.audio-snap", "false"); localStorage.setItem("aegisub-web.audio-autoscroll", "false"); });
});

test("auto-commit changes the saved document DURING drag and merges long/repeated gestures", async ({ page }, info) => {
  test.skip(/android|ipad|iphone/.test(info.project.name), "desktop secondary-button sequence");
  await page.locator(".se-detail textarea").fill("Separate text undo");
  await page.locator('[data-audio-option="audio-autocommit"]').click();
  await moveToTime(page, 2.2); await page.mouse.down({ button: "right" });
  expect((await doc(page)).cues[0].endMs).toBe(2200); await expect(page.locator(".se-root")).toHaveAttribute("data-timing-pending", "false");
  await moveToTime(page, 2.4); expect((await doc(page)).cues[0].endMs).toBe(2400);
  await page.waitForTimeout(650); // explicitly cross the old 500ms typing debounce boundary
  await moveToTime(page, 2.6); await page.mouse.up({ button: "right" });
  await endClick(page, 2.8); expect((await doc(page)).cues[0].endMs).toBe(2800);
  await command(page, "edit/undo"); expect((await doc(page)).cues[0]).toMatchObject({ endMs: 3000, text: "Separate text undo" });
  await command(page, "edit/undo"); expect((await doc(page)).cues[0].text).toBe("Hello, world.");
  await command(page, "edit/redo"); await command(page, "edit/redo"); expect((await doc(page)).cues[0].endMs).toBe(2800);
});

test("save and active-line changes split automatic undo groups", async ({ page }, info) => {
  test.skip(/android|ipad|iphone/.test(info.project.name), "desktop secondary-button sequence");
  await page.locator('[data-audio-option="audio-autocommit"]').click(); await endClick(page, 2.4);
  await Promise.all([page.waitForEvent("download"), page.locator("#save").click()]);
  await endClick(page, 2.8); await command(page, "edit/undo"); expect((await doc(page)).cues[0].endMs).toBe(2400);
  await page.locator(".se-row").nth(1).click(); await endClick(page, 5.6);
  await command(page, "edit/undo"); expect((await doc(page)).cues[1].endMs).toBe(6000); expect((await doc(page)).cues[0].endMs).toBe(2400);
});

test("auto-commit repaints real ASS during the gesture without moving the paused video", async ({ page }, info) => {
  test.skip(/android|ipad|iphone/.test(info.project.name), "desktop secondary-button preview oracle");
  await page.locator("#media-file").setInputFiles("test-corpus/tiny-timing.mp4");
  const video = page.locator(".se-playerhost video"); await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  await video.evaluate((v: HTMLVideoElement) => v.currentTime = 1.5); await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.seeking)).toBe(false);
  const painted = () => page.locator(".se-playerhost .libassjs-canvas").evaluate((canvas: HTMLCanvasElement) => canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data.filter((a, i) => i % 4 === 3 && a > 100).length);
  await expect.poll(painted).toBeGreaterThan(20); await page.locator('[data-audio-option="audio-autocommit"]').click();
  await moveToTime(page, 1.3); await page.mouse.down({ button: "right" });
  expect((await doc(page)).cues[0].endMs).toBe(1300); await expect.poll(painted).toBe(0);
  await moveToTime(page, 2.1); await expect.poll(painted).toBeGreaterThan(20);
  expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(1.5, 3);
  await page.mouse.up({ button: "right" }); await command(page, "edit/undo"); expect((await doc(page)).cues[0].endMs).toBe(3000);
});

test("detail metadata controls retain live cue objects after automatic timing edits", async ({ page }, info) => {
  test.skip(/android|ipad|iphone/.test(info.project.name), "desktop secondary-button sequence");
  await page.locator('[data-audio-option="audio-autocommit"]').click(); await endClick(page, 2.4);
  const actor = page.locator(".se-actorfield input"); await actor.fill("Singer"); await actor.press("Tab");
  expect((await doc(page)).cues[0]).toMatchObject({ endMs: 2400, assFields: { Name: "Singer" } });
  await command(page, "edit/undo"); expect((await doc(page)).cues[0].endMs).toBe(2400); expect((await doc(page)).cues[0].assFields.Name).not.toBe("Singer");
  await command(page, "edit/undo"); expect((await doc(page)).cues[0].endMs).toBe(3000);
});

test("multi-line automatic timing restores the entire selection on undo", async ({ page }, info) => {
  test.skip(/android|ipad|iphone/.test(info.project.name), "desktop extended selection and marker sequence");
  await page.locator('[data-audio-option="audio-autocommit"]').click();
  await page.locator(".se-row").nth(1).click({ modifiers: [info.project.name === "macos-webkit" ? "Meta" : "Control"] });
  const selection = await page.evaluate(() => (window as any).subHandle.selectedCueIds()); expect(selection).toHaveLength(2);
  await endClick(page, 5.4); expect((await doc(page)).cues.slice(0, 2).map((cue: any) => cue.endMs)).toEqual([5400, 5400]);
  await command(page, "edit/undo"); expect((await doc(page)).cues.slice(0, 2).map((cue: any) => cue.endMs)).toEqual([3000, 6000]);
  expect((await page.evaluate(() => (window as any).subHandle.selectedCueIds())).sort()).toEqual(selection.sort());
});

test("ASS edit times and duration use native centiseconds while SRT keeps milliseconds", async ({ page }, info) => {
  if (/android|ipad|iphone/.test(info.project.name)) await page.getByRole("tab", { name: "字幕", exact: true }).click();
  await page.evaluate(() => { const h = (window as any).subHandle; h.updateCue(h.getDoc().cues[0].id, { startMs: 1004, endMs: 2006 }); });
  const fields = page.locator(".se-times:first-child > .se-field > input");
  await expect(fields.nth(0)).toHaveValue("0:00:01.00"); await expect(fields.nth(1)).toHaveValue("0:00:02.01"); await expect(fields.nth(2)).toHaveValue("0:00:01.01");
  await fields.nth(2).fill("0:00:02.35"); await fields.nth(2).press("Tab"); expect((await doc(page)).cues[0].endMs).toBe(3350);
  await page.locator("#file").setInputFiles({ name: "milliseconds.srt", mimeType: "text/plain", buffer: Buffer.from("1\n00:00:01,004 --> 00:00:02,006\nPrecision\n") });
  await expect(fields.nth(0)).toHaveValue("00:00:01,004"); await expect(fields.nth(1)).toHaveValue("00:00:02,006"); await expect(fields.nth(2)).toHaveValue("1.002");
});
