import { expect, test, type Page } from "@playwright/test";

const doc = (page: Page) => page.evaluate(() => (window as any).subHandle.getDoc());
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const live = new Set<Worker>(); (window as any).stylePreviewWorkers = live;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) { super(url, options); live.add(this); }
      terminate() { live.delete(this); super.terminate(); }
    };
  });
  await page.goto("/"); await expect.poll(() => page.evaluate(() => !!(window as any).subHandle)).toBe(true);
  await page.locator("#file").setInputFiles("test-corpus/base.ass");
  await page.evaluate(() => (window as any).subHandle.runAegisubCommand("tool/style/manager"));
});
test("multi-field Apply survives host cloning; rename, cancel, and new-style cancellation", async ({ page }, info) => {
  const manager = page.getByRole("dialog", { name: "样式管理器", exact: true });
  const script = manager.locator("fieldset").filter({ has: page.getByRole("listbox", { name: "当前脚本样式" }) });
  const original = (await doc(page)).styles[0];
  await script.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "样式编辑", exact: true });
  await editor.locator('[data-style-field="Fontsize"]').fill("75");
  expect((await doc(page)).styles[0].fields.Fontsize).toBe(original.fields.Fontsize);
  await editor.getByRole("button", { name: "应用", exact: true }).click();
  expect((await doc(page)).styles[0].fields.Fontsize).toBe("75");
  await editor.locator('[data-style-field="MarginL"]').fill("1055");
  await editor.getByRole("textbox", { name: "样式名称", exact: true }).fill("翻译新版");
  await editor.getByRole("button", { name: "应用", exact: true }).click();
  expect((await doc(page)).styles[0]).toMatchObject({ name: "翻译新版", fields: { Fontsize: "75", MarginL: "1055" } });
  expect((await doc(page)).cues.filter((c: any) => c.assFields?.Style === original.name)).toHaveLength(0);
  await editor.locator('[data-style-field="MarginL"]').fill("999");
  await page.screenshot({ path: info.outputPath("style-editor.png") });
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  expect((await doc(page)).styles[0].fields.MarginL).toBe("1055");
  const count = (await doc(page)).styles.length;
  await script.getByRole("button", { name: "新建", exact: true }).click();
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  expect((await doc(page)).styles).toHaveLength(count);
  await expect.poll(() => page.evaluate(() => (window as any).stylePreviewWorkers.size)).toBe(0);
  await page.screenshot({ path: info.outputPath("style-manager.png") });
  const bounds = await manager.boundingBox(); expect(bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test("style library copies persist across reopen and render an ASS preview", async ({ page }, info) => {
  const manager = page.getByRole("dialog", { name: "样式管理器", exact: true });
  await manager.getByRole("button", { name: "← 复制到样式库", exact: true }).click();
  const name = (await doc(page)).styles[0].name;
  await expect(manager.getByRole("listbox", { name: "样式库样式" }).locator("option")).toHaveText([name]);
  await manager.getByRole("button", { name: "关闭", exact: true }).last().click();
  await page.evaluate(() => (window as any).subHandle.runAegisubCommand("tool/style/manager"));
  await expect(manager.getByRole("listbox", { name: "样式库样式" }).locator("option")).toHaveText([name]);
  await manager.locator("fieldset").filter({ has: page.getByRole("listbox", { name: "样式库样式" }) }).getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "样式编辑", exact: true });
  await editor.locator('[data-style-field="Fontsize"]').fill("32");
  await editor.getByRole("textbox", { name: "预览文字" }).fill("Aegisub");
  await expect.poll(() => editor.locator("canvas").evaluate((c: HTMLCanvasElement) => c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data.filter((x, i) => i % 4 === 3 && x > 100).length)).toBeGreaterThan(100);
  await page.screenshot({ path: info.outputPath("style-preview.png") });
  await editor.getByRole("button", { name: "确定", exact: true }).click();
  expect((await doc(page)).styles[0].fields.Fontsize).not.toBe("32");
  page.once("dialog", dialog => dialog.accept()); await manager.getByRole("button", { name: "复制到当前脚本 →", exact: true }).click();
  expect((await doc(page)).styles[0].fields.Fontsize).toBe("32");
});
