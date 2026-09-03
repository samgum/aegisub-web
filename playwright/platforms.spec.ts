import { expect, test } from "@playwright/test";

async function expectMediaPlayback(media: import("@playwright/test").Locator, projectName: string, minTime: number): Promise<void> {
  void projectName;
  await expect.poll(() => media.evaluate((node) => (node as HTMLMediaElement).currentTime)).toBeGreaterThan(minTime);
}

test("opens and edits a real ASS project in the platform workspace", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.locator("#file").setInputFiles("test-corpus/base.ass");
  await expect(page.locator(".se-row")).toHaveCount(6);
  await expect(page.locator(".se-text").filter({ hasText: "Hello, world." })).toBeVisible();
  await expect(page.locator('.quickbar img[src*="aegisub-icons/"]').first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("纯前端");
  await expect(page.locator("body")).not.toContainText("仅在此设备处理");
  const expectedMenus = testInfo.project.name === "macos-webkit"
    ? ["文件", "编辑", "视图", "字幕", "时间轴", "视频", "音频", "自动化", "工具", "窗口", "帮助"]
    : ["文件", "编辑", "字幕", "时间轴", "视频", "音频", "自动化", "工具", "视图", "帮助"];
  await expect(page.locator(".menu-button:visible")).toHaveText(expectedMenus);
  await page.getByRole("button", { name: "字幕", exact: true }).click();
  await expect(page.locator("#menu-subtitle")).toBeVisible();
  await expect(page.locator("#menu-subtitle")).toContainText("样式管理器");
  await expect(page.locator("#menu-subtitle")).toContainText("合并（保留首行）");
  await expect(page.locator("#menu-subtitle")).toContainText("所选按样式排序");
  await page.keyboard.press("Escape");

  const mobileProject = /android|ipad|iphone/.test(testInfo.project.name);
  if (mobileProject) {
    await expect(page.locator('.se-root[data-mobile-pane="subtitles"]')).toBeVisible();
    await expect(page.locator(".se-pane-switch")).toBeVisible();
  } else {
    await expect(page.locator(".se-pane-switch")).toBeHidden();
  }

  const value = `Edited on ${testInfo.project.name}`;
  await page.locator(".se-row").first().click();
  await page.locator(".se-detail textarea").fill(value);
  await expect(page.locator(".se-detail textarea")).toHaveValue(value);
  const text = await page.evaluate(() => (window as unknown as { subHandle: { getText(): string } }).subHandle.getText());
  expect(text).toContain(value);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#save").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.(ass|ssa|srt|vtt)$/i);

  if (mobileProject) {
    await page.getByRole("tab", { name: "视频" }).click();
    await expect(page.locator('.se-root[data-mobile-pane="video"] .se-right')).toBeVisible();
    await page.getByRole("tab", { name: "字幕" }).click();
    await expect(page.locator(".se-detail textarea")).toHaveValue(value);
  } else {
    const video = await page.locator(".se-right").boundingBox();
    const audio = await page.locator(".se-timeline-wrap").boundingBox();
    const grid = await page.locator(".se-scroll").boundingBox();
    expect(video).not.toBeNull();
    expect(audio).not.toBeNull();
    expect(grid).not.toBeNull();
    expect(video!.x).toBeLessThan(audio!.x);
    expect(grid!.width).toBeGreaterThan(1200);
  }
});

test("uses platform keyboard shortcuts in the subtitle grid", async ({ page }, testInfo) => {
  test.skip(/android|ipad|iphone/.test(testInfo.project.name), "hardware keyboard is optional on touch projects");
  await page.goto("/");
  await page.locator("#file").setInputFiles("test-corpus/base.ass");
  await page.locator(".se-row").first().click();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".se-row").nth(1)).toHaveClass(/sel/);
  const saveKey = testInfo.project.name === "macos-webkit" ? "Meta+S" : "Control+S";
  const [download] = await Promise.all([page.waitForEvent("download"), page.keyboard.press(saveKey)]);
  expect(download.suggestedFilename()).toMatch(/\.ass$/i);
});

test("undoes a literal ASS line break like ordinary text", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.locator("#file").setInputFiles("test-corpus/base.ass");
  const textarea = page.locator(".se-detail textarea");
  await textarea.focus();
  await textarea.press("End");
  const before = await textarea.inputValue();
  await textarea.press("Shift+Enter");
  await expect(textarea).toHaveValue(`${before}\\N`);
  await textarea.press(/macos|ipad|iphone/.test(testInfo.project.name) ? "Meta+z" : "Control+z");
  await expect(textarea).toHaveValue(before);
  await expect.poll(() => page.evaluate(() => (window as unknown as { subHandle: { getDoc(): { cues: { text: string }[] } } }).subHandle.getDoc().cues[0].text)).toBe(before);
});

test("supports touch selection and timing edits", async ({ page }, testInfo) => {
  test.skip(!/android|ipad|iphone/.test(testInfo.project.name), "touch workflow belongs to mobile projects");
  await page.goto("/");
  await page.locator("#file").setInputFiles("test-corpus/base.ass");
  const row = await page.locator(".se-row").nth(1).boundingBox();
  expect(row).not.toBeNull();
  await page.touchscreen.tap(row!.x + row!.width / 2, row!.y + row!.height / 2);
  await expect(page.locator(".se-detail textarea")).toHaveValue("Two lines here\\Nand a second line");
  const start = page.locator(".se-times .se-field input").first();
  const field = await start.boundingBox();
  expect(field).not.toBeNull();
  await page.touchscreen.tap(field!.x + field!.width / 2, field!.y + field!.height / 2);
  await start.fill("00:00:05.000");
  await start.blur();
  const startMs = await page.evaluate(() => (window as unknown as { subHandle: { getDoc(): { cues: { startMs: number }[] } } }).subHandle.getDoc().cues[1].startMs);
  expect(startMs).toBe(5000);

  await page.locator("#media-file").setInputFiles("test-corpus/tiny-timing.mp4");
  await page.getByRole("tab", { name: "视频" }).click();
  const host = page.locator(".se-playerhost");
  await expect(host).toBeVisible();
  const box = await host.boundingBox();
  expect(box).not.toBeNull();
  const cy = box!.y + box!.height / 2;
  await host.dispatchEvent("pointerdown", { pointerId: 11, pointerType: "touch", clientX: box!.x + box!.width / 2 - 40, clientY: cy });
  await host.dispatchEvent("pointerdown", { pointerId: 12, pointerType: "touch", clientX: box!.x + box!.width / 2 + 40, clientY: cy });
  await host.dispatchEvent("pointermove", { pointerId: 11, pointerType: "touch", clientX: box!.x + box!.width / 2 - 80, clientY: cy });
  await host.dispatchEvent("pointermove", { pointerId: 12, pointerType: "touch", clientX: box!.x + box!.width / 2 + 80, clientY: cy });
  await expect(page.locator(".se-video-zoom")).not.toHaveText("100%");
  await host.dispatchEvent("pointerup", { pointerId: 11, pointerType: "touch", clientX: box!.x, clientY: cy });
  await host.dispatchEvent("pointerup", { pointerId: 12, pointerType: "touch", clientX: box!.x, clientY: cy });
});

test("handles installed-app file launch and offline reload", async ({ page, context }, testInfo) => {
  const failedRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on("requestfailed", (request) => failedRequests.push(`${request.url()} :: ${request.failure()?.errorText ?? "failed"}`));
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, "launchQueue", {
      configurable: true,
      value: {
        setConsumer(consumer: (params: unknown) => Promise<void> | void) {
          (window as unknown as { __launchConsumer?: (params: unknown) => Promise<void> | void }).__launchConsumer = consumer;
        },
      },
    });
  });
  await page.goto("/?pwa-test=1");
  await page.evaluate(async () => {
    const source = "1\n00:00:01,000 --> 00:00:03,000\nLaunched subtitle\n";
    const file = new File([source], "launched.srt", { type: "text/plain" });
    const consumer = (window as unknown as { __launchConsumer?: (params: unknown) => Promise<void> | void }).__launchConsumer;
    await consumer?.({ files: [{ getFile: async () => file }] });
  });
  await expect(page.locator("#filename")).toContainText("launched.srt");
  await expect(page.locator(".se-row")).toHaveCount(1);

  await page.evaluate(async () => {
    const samples = 1600;
    const bytes = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(bytes);
    const ascii = (offset: number, value: string) => { for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index)); };
    ascii(0, "RIFF"); view.setUint32(4, 36 + samples * 2, true); ascii(8, "WAVE"); ascii(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    ascii(36, "data"); view.setUint32(40, samples * 2, true);
    const file = new File([bytes], "launched.wav", { type: "audio/wav" });
    const consumer = (window as unknown as { __launchConsumer?: (params: unknown) => Promise<void> | void }).__launchConsumer;
    await consumer?.({ files: [{ getFile: async () => file }] });
  });
  await expect(page.locator('.se-root[data-media-name="launched.wav"]')).toBeVisible();
  await expect(page.locator(".se-playerhost audio")).toBeAttached();

  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect(page.locator(".se-root")).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.waitForTimeout(500);
  const cachedPaths = await page.evaluate(async () => {
    const cache = await caches.open("aegisub-web-shell-v9");
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  });
  expect(cachedPaths.some((path) => path.endsWith("/index.html") || path.endsWith("/aegisub-web/"))).toBe(true);
  expect(cachedPaths.some((path) => /\/assets\/index-[^/]+\.js$/.test(path))).toBe(true);
  if (!testInfo.project.name.includes("webkit")) {
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    if (await page.locator(".se-root").count() === 0) console.log({ failedRequests, pageErrors, cachedPaths });
    await expect(page.locator(".se-root")).toBeVisible();
    await context.setOffline(false);
  }
});

test("writes subtitles through the Chromium file-system path", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "windows-chromium", "direct file writing is a Chromium desktop path");
  await page.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: async () => ({
        createWritable: async () => ({
          write: async (value: Blob | string) => {
            (window as unknown as { __writtenSubtitle?: string }).__writtenSubtitle = typeof value === "string" ? value : await value.text();
          },
          close: async () => { (window as unknown as { __writerClosed?: boolean }).__writerClosed = true; },
        }),
      }),
    });
  });
  await page.goto("/");
  await page.locator("#file").setInputFiles("test-corpus/base.ass");
  await page.locator(".se-detail textarea").fill("Direct writer result");
  await page.evaluate(() => (window as unknown as { subHandle: { runAegisubCommand(command: string): boolean } }).subHandle.runAegisubCommand("subtitle/save/as"));
  await expect.poll(() => page.evaluate(() => (window as unknown as { __writtenSubtitle?: string }).__writtenSubtitle ?? "")).toContain("Direct writer result");
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __writerClosed?: boolean }).__writerClosed))).toBe(true);
});

test("keeps media while opening subtitles and reproduces desktop timing interactions", async ({ page }, testInfo) => {
  test.skip(/android|ipad|iphone/.test(testInfo.project.name), "desktop mouse workflow");
  await page.goto("/");
  await page.locator("#media-file").setInputFiles("test-corpus/tiny-timing.mp4");
  const video = page.locator(".se-playerhost video");
  await expect(video).toBeVisible();
  await video.evaluate((element) => { element.dataset.identity = "preserved"; });
  await page.locator("#file").setInputFiles("test-corpus/base.ass");
  await expect(video).toHaveAttribute("data-identity", "preserved");
  await expect(video).not.toHaveAttribute("controls", "");
  await expect(page.locator(".se-listhead .se-style")).toHaveText("Style");
  await expect(page.locator(".se-listhead .se-dur")).toHaveCount(0);

  await page.locator(".se-video-controls button").first().click();
  await expect.poll(() => video.evaluate((element) => !element.paused)).toBe(true);
  await page.locator(".se-row").nth(1).click();
  await expect.poll(() => video.evaluate((element) => element.paused)).toBe(true);
  await expect.poll(() => video.evaluate((element) => Math.round(element.currentTime * 1000))).toBe(4000);

  const before = await page.evaluate(() => (window as unknown as { subHandle: { getDoc(): { cues: { startMs: number; endMs: number; text: string }[] }; runAegisubCommand(command: string): boolean } }).subHandle.getDoc().cues.length);
  await page.evaluate(() => (window as unknown as { subHandle: { runAegisubCommand(command: string): boolean } }).subHandle.runAegisubCommand("edit/line/duplicate"));
  const duplicated = await page.evaluate(() => {
    const cues = (window as unknown as { subHandle: { getDoc(): { cues: { startMs: number; endMs: number; text: string }[] } } }).subHandle.getDoc().cues;
    return { count: cues.length, original: cues[1], copy: cues[2] };
  });
  expect(duplicated.count).toBe(before + 1);
  expect([duplicated.copy.startMs, duplicated.copy.endMs, duplicated.copy.text]).toEqual([
    duplicated.original.startMs, duplicated.original.endMs, duplicated.original.text,
  ]);

  const host = await page.locator(".se-playerhost").boundingBox();
  const stageBefore = await page.locator(".ot-media-stage").boundingBox();
  expect(host).not.toBeNull();
  expect(stageBefore).not.toBeNull();
  expect(stageBefore!.width).toBeLessThanOrEqual(host!.width + 1);
  expect(stageBefore!.height).toBeLessThanOrEqual(host!.height + 1);
  await page.mouse.move(host!.x + host!.width / 2, host!.y + host!.height / 2);
  await page.mouse.wheel(0, -320);
  await expect(page.locator(".se-video-zoom")).not.toHaveText("100%");

  await page.locator(".se-row").first().click();
  const canvas = await page.locator(".se-timeline").boundingBox();
  expect(canvas).not.toBeNull();
  await page.mouse.click(canvas!.x + canvas!.width * .2, canvas!.y + canvas!.height * .6, { button: "left" });
  await page.mouse.click(canvas!.x + canvas!.width * .8, canvas!.y + canvas!.height * .6, { button: "right" });
  const retimed = await page.evaluate(() => (window as unknown as { subHandle: { getDoc(): { cues: { startMs: number; endMs: number }[] } } }).subHandle.getDoc().cues[0]);
  expect(retimed.startMs).toBeGreaterThan(1500);
  expect(retimed.startMs).toBeLessThan(2500);
  expect(retimed.endMs).toBeGreaterThan(7500);
  expect(retimed.endMs).toBeLessThan(8500);
});

test("plays WAV, FLAC, Opus, Vorbis, MP3, AAC, AIFF and CAF through the common audio workspace", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto("/");
  const fixtures = ["tiny.wav", "tiny.flac", "tiny.opus", "tiny.ogg", "tiny.mp3", "tiny-aac.m4a", "tiny.aiff", "tiny.caf"];
  for (const filename of fixtures) {
    await page.locator("#media-file").setInputFiles(`test-corpus/${filename}`);
    await expect.poll(() => page.locator(".se-root").getAttribute("data-media-name")).toBe(filename);
    await expect(page.locator(".se-root")).not.toHaveAttribute("data-media-loading", "true");
    const audio = page.locator(".se-playerhost audio").first();
    await expect(audio).toBeAttached();
    await expect.poll(() => audio.evaluate((element) => element.duration)).toBeGreaterThan(.5);
    expect(await audio.evaluate((element) => element.controls)).toBe(false);
    if (/android|ipad|iphone/.test(testInfo.project.name)) await page.getByRole("tab", { name: "视频" }).click();
    await page.locator(".se-video-controls button").first().click();
    await expectMediaPlayback(audio, testInfo.project.name, .04);
  }
});

test("decodes ALAC audio and does not retain local media blobs across refresh", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto("/?pwa-test=1");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await page.locator("#media-file").setInputFiles("test-corpus/tiny-alac.m4a");
  await expect(page.locator('.se-root[data-audio-fallback="alac-ready"]')).toBeVisible({ timeout: 120_000 });
  const audio = page.locator(".se-playerhost audio").first();
  await expect(audio).toBeAttached();
  expect(await audio.evaluate((element) => element.controls)).toBe(false);
  if (/android|ipad|iphone/.test(testInfo.project.name)) await page.getByRole("tab", { name: "视频" }).click();
  await page.locator(".se-video-controls button").first().click();
  await expectMediaPlayback(audio, testInfo.project.name, .1);
  const oldBlobUrl = await audio.evaluate((element) => element.currentSrc);
  await page.reload();
  const oldBlobStillReadable = await page.evaluate(async (url) => {
    try { return (await fetch(url)).ok; } catch { return false; }
  }, oldBlobUrl);
  expect(oldBlobStillReadable).toBe(false);

  const cached = await page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) paths.push(new URL(request.url).pathname);
    }
    return paths;
  });
  expect(cached.some((path) => /\.(?:aac|aif|aiff|alac|caf|flac|m4a|mov|mp3|oga|ogg|opus|wav)$/.test(path))).toBe(false);
});

test("creates a configured blank video instead of a placeholder command", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "windows-chromium", "WebCodecs encoder smoke path");
  await page.goto("/");
  await page.locator('.quickbar [data-aegisub-command="video/open/dummy"]').click();
  const numbers = page.locator('.ad-modal input[type="number"]');
  await numbers.nth(0).fill("320");
  await numbers.nth(1).fill("180");
  await numbers.nth(2).fill("2");
  await numbers.nth(3).fill("24");
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page.locator('.se-root[data-dummy-status="ready"]')).toBeVisible({ timeout: 30_000 });
  const video = page.locator(".se-playerhost video");
  await expect.poll(() => video.evaluate((element) => element.duration)).toBe(2);
  expect(await video.evaluate((element) => [element.videoWidth, element.videoHeight, element.controls])).toEqual([320, 180, false]);
});

test("renders CJK glyphs and timed ASS effects at the selected frame", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "windows-chromium", "one libass engine regression is representative");
  test.setTimeout(60_000);
  const ass = `[Script Info]\nScriptType: v4.00+\nPlayResX: 384\nPlayResY: 288\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: CJK,Source Han Sans CN Medium,48,&H00FFFFFF,&H0000FFFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,1,5,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:04.00,CJK,,0,0,0,,{\\an5\\pos(192,144)\\fad(1000,1000)}中文特效预览\nDialogue: 0,0:00:04.00,0:00:08.00,CJK,,0,0,0,,{\\an5\\move(45,144,339,144,0,3000)}移动测试\nDialogue: 0,0:00:08.00,0:00:10.00,CJK,,0,0,0,,{\\an5\\pos(192,144)\\clip(50,80,334,208)\\t(0,1600,\\fscx160)}{\\k50}卡{\\k50}拉{\\k50}OK\n`;
  await page.goto("/");
  await page.locator("#file").setInputFiles({ name: "cjk-effects.ass", mimeType: "text/plain", buffer: Buffer.from(ass) });
  await page.locator("#media-file").setInputFiles("test-corpus/tiny-timing.mp4");
  await expect(page.locator('.se-root[data-bundled-preview-fonts="2"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".se-font-warning")).toHaveCount(0);
  await expect(page.locator(".libassjs-canvas-parent canvas")).toHaveCount(1, { timeout: 30_000 });

  const sampleFrame = async (seconds: number): Promise<{ alpha: number; centroidX: number; spanX: number }> => {
    await page.locator(".se-video-scrubber").evaluate((node, milliseconds) => {
      const input = node as HTMLInputElement;
      input.value = String(milliseconds);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, Math.round(seconds * 1000));
    await page.waitForTimeout(450);
    return page.locator(".libassjs-canvas-parent canvas").evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      let alpha = 0;
      let weightedX = 0;
      let minX = canvas.width;
      let maxX = -1;
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const value = pixels[(y * canvas.width + x) * 4 + 3]!;
          alpha += value;
          weightedX += x * value;
          if (value) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
        }
      }
      return { alpha, centroidX: weightedX / Math.max(1, alpha), spanX: Math.max(0, maxX - minX + 1) };
    });
  };

  // The canvas exists before the 8 MB CJK font files finish preloading. Warm the renderer
  // on a fully opaque frame so a slow CI/network run never mistakes "font still loading"
  // for an invisible subtitle or a broken effect.
  await expect.poll(async () => (await sampleFrame(1.5)).alpha, { timeout: 30_000 }).toBeGreaterThan(0);
  const fadeStart = await sampleFrame(.1);
  const fadeSolid = await sampleFrame(1.5);
  expect(fadeSolid.alpha).toBeGreaterThan(fadeStart.alpha * 3);
  const moveLeft = await sampleFrame(4.3);
  const moveRight = await sampleFrame(6.6);
  expect(moveRight.centroidX).toBeGreaterThan(moveLeft.centroidX + 150);
  const transformStart = await sampleFrame(8.1);
  const transformEnd = await sampleFrame(9.6);
  expect(transformStart.alpha).toBeGreaterThan(0);
  expect(transformEnd.spanX).toBeGreaterThan(transformStart.spanX * 1.25);
});

test("routes upstream grid, video and edit-box hotkey contexts", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "windows-chromium", "representative focused-control routing");
  await page.goto("/");
  await page.locator("#file").setInputFiles("test-corpus/base.ass");
  await page.locator("#media-file").setInputFiles("test-corpus/tiny-timing.mp4");
  const video = page.locator(".se-playerhost video");
  await expect(video).toBeVisible();
  await page.locator(".se-row").first().click();
  const initial = await video.evaluate((element) => element.currentTime);
  await page.locator(".se-inner").press("ArrowRight");
  await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeGreaterThan(initial);

  // With video loaded, visual-tool keys remain available from the grid or shell toolbar
  // (but never steal letters from a text field or the focused audio timeline). This is the
  // real S/D/F/G workflow, not an idealized test which focuses a hidden <video> first.
  await page.locator("#open-media").focus();
  await page.keyboard.press("s");
  await expect(page.locator('.se-root[data-video-tool="video/tool/drag"]')).toBeVisible();
  await expect(page.locator(".se-posoverlay")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.locator("#open-media").focus();
  await page.keyboard.press("d");
  await expect(page.locator('.se-root[data-video-tool="video/tool/rotate/z"]')).toBeVisible();
  await expect(page.locator('.se-video-tool.on[data-video-tool="video/tool/rotate/z"]')).toBeVisible();
  await expect(page.locator(".se-xform")).toBeVisible();
  await page.locator("#open-media").focus();
  await page.keyboard.press("f");
  await expect(page.locator('.se-root[data-video-tool="video/tool/rotate/xy"]')).toBeVisible();
  await expect(page.locator('.se-video-tool.on[data-video-tool="video/tool/rotate/xy"]')).toBeVisible();
  await expect(page.locator(".se-xform")).toBeVisible();
  await page.locator("#open-media").focus();
  await page.keyboard.press("g");
  await expect(page.locator('.se-root[data-video-tool="video/tool/scale"]')).toBeVisible();
  await expect(page.locator('.se-video-tool.on[data-video-tool="video/tool/scale"]')).toBeVisible();
  await expect(page.locator(".se-xform")).toBeVisible();

  const textarea = page.locator(".se-detail textarea");
  await textarea.focus();
  const count = await page.evaluate(() => (window as unknown as { subHandle: { getDoc(): { cues: unknown[] } } }).subHandle.getDoc().cues.length);
  await textarea.press("Control+d");
  await expect.poll(() => page.evaluate(() => (window as unknown as { subHandle: { getDoc(): { cues: unknown[] } } }).subHandle.getDoc().cues.length)).toBe(count + 1);
  const selectedBeforeEnter = await page.evaluate(() => (window as unknown as { subHandle: { selectedCueId(): string | null } }).subHandle.selectedCueId());
  await textarea.press("Enter");
  await expect.poll(() => page.evaluate(() => (window as unknown as { subHandle: { selectedCueId(): string | null } }).subHandle.selectedCueId())).not.toBe(selectedBeforeEnter);

  await page.locator("#open-media").focus();
  await page.keyboard.press("Control+n");
  await expect(page.locator("#filename")).toContainText("untitled.ass");
});
