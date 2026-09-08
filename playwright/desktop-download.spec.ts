import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("desktop download stays visible and opens the moving latest-release link without losing edits", async ({ page, context }, info) => {
  await page.goto("/"); await expect.poll(() => page.evaluate(() => !!(window as any).subHandle)).toBe(true);
  await page.locator("#file").setInputFiles({ name: "带有很长名称的字幕文件-保留编辑内容-测试.ass", mimeType: "text/plain", buffer: readFileSync("test-corpus/base.ass") });
  await page.locator(".se-row").first().click(); await page.locator(".se-detail textarea").fill("尚未保存的字幕编辑");
  const link = page.getByRole("link", { name: "下载桌面端", exact: true });
  await expect(link).toBeVisible(); await expect(link).toHaveAttribute("href", "https://github.com/samgum/Aegisub/releases/latest");
  await expect(link).toHaveAttribute("target", "_blank"); await expect(link).toHaveAttribute("rel", /noopener/);
  const box = (await link.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(box.y + box.height).toBeLessThanOrEqual(65);
  // A fixture isolates browser navigation from GitHub availability. The actual public
  // /releases/latest redirect is verified separately against the repository endpoint.
  await context.route("https://github.com/samgum/Aegisub/releases/latest", route => route.fulfill({ status: 200, contentType: "text/html", body: "<title>Release navigation fixture</title>" }));
  const [popup] = await Promise.all([page.waitForEvent("popup"), link.click()]);
  await expect(popup).toHaveURL("https://github.com/samgum/Aegisub/releases/latest");
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await expect(page.locator(".se-detail textarea")).toHaveValue("尚未保存的字幕编辑");
  await popup.close(); await page.screenshot({ path: info.outputPath("desktop-download.png") });
});
