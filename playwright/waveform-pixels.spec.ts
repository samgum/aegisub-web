import { expect, test, type Page } from "@playwright/test";

function wav(channels: number, frames: number, sample: (frame: number, channel: number) => number): Buffer {
  const buffer = Buffer.alloc(44 + frames * channels * 2);
  buffer.write("RIFF"); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8); buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(channels, 22); buffer.writeUInt32LE(48000, 24); buffer.writeUInt32LE(96000 * channels, 28);
  buffer.writeUInt16LE(channels * 2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36); buffer.writeUInt32LE(buffer.length - 44, 40);
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) buffer.writeInt16LE(sample(i, c), 44 + (i * channels + c) * 2);
  return buffer;
}
const range = (page: Page, name: string, value: number) => page.getByLabel(name, { exact: true }).evaluate((el: HTMLInputElement, v) => { el.value = String(v); el.dispatchEvent(new Event("input", { bubbles: true })); }, value);
const ready = async (page: Page) => { await expect(page.locator(".se-root")).toHaveAttribute("data-waveform-decoder", "worker-ready"); await expect(page.locator(".se-timeline")).toHaveAttribute("data-waveform-resolution", "samples"); };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).waveWorkers = 0;
    const Original = Worker;
    window.Worker = class extends Original { constructor(url: string | URL, options?: WorkerOptions) { super(url, options); if (String(url).includes("waveform-extractor.worker")) (window as any).waveWorkers++; } };
  });
  await page.goto("/"); await expect.poll(() => page.evaluate(() => !!(window as any).subHandle)).toBe(true);
  await page.locator("#file").setInputFiles({ name: "wave.srt", mimeType: "text/plain", buffer: Buffer.from("1\n00:00:00,000 --> 00:00:03,000\nWaveform reference\n") });
});

test("PCM cancellation and signed peaks are visible, not mirrored into fabricated audio", async ({ page }, info) => {
  const buffer = wav(2, 144000, (i, c) => i < 48000 ? (c ? -20000 : 20000) : i < 96000 ? (c ? 8000 : 24000) : (c ? -8000 : -24000));
  await page.locator("#media-file").setInputFiles({ name: "signed-stereo.wav", mimeType: "audio/wav", buffer });
  await ready(page);
  expect(await page.evaluate(() => {
    const d = (window as any).subHandle.timeline.waveformPixels;
    return [d.minima[25], d.maxima[25], d.minima[75], d.maxima[75], d.minima[125], d.maxima[125]];
  })).toEqual([0, 0, 0, 16000 / 32768, -16000 / 32768, 0]);
  const pixels = await page.locator(".se-timeline").evaluate((canvas: HTMLCanvasElement) => {
    const dpr = canvas.width / canvas.getBoundingClientRect().width, h = canvas.height / dpr;
    const half = Math.floor((h - 16) / 2), mid = 16 + half;
    const read = (x: number, y: number) => [...canvas.getContext("2d")!.getImageData(Math.floor((x + .5) * dpr), Math.floor(y * dpr), 1, 1).data];
    return { blankTop: read(25, mid - half * .25), blankBottom: read(25, mid + half * .25), positiveTop: read(75, mid - half * .25), positiveBottom: read(75, mid + half * .25), negativeTop: read(125, mid - half * .25), negativeBottom: read(125, mid + half * .25) };
  });
  expect(pixels.positiveTop).not.toEqual(pixels.blankTop); expect(pixels.positiveBottom).toEqual(pixels.blankBottom);
  expect(pixels.negativeTop).toEqual(pixels.blankTop); expect(pixels.negativeBottom).not.toEqual(pixels.blankBottom);
  await page.screenshot({ path: info.outputPath("native-signed-waveform.png") });
});

test("high zoom resolves individual sample peaks, mean style works, and cached cursor/gain redraws do not decode again", async ({ page }) => {
  await page.locator("#media-file").setInputFiles({ name: "impulses.wav", mimeType: "audio/wav", buffer: wav(1, 144000, i => i === 513 ? 32767 : i === 700 ? -20000 : 0) });
  await ready(page); await range(page, "音频横向缩放", 50); await range(page, "音频水平滚动", 0);
  await expect.poll(() => page.evaluate(() => (window as any).subHandle.timeline.waveformPixels?.viewport.pixelsPerSecond)).toBe(675);
  await ready(page);
  const data = await page.evaluate(() => { const d = (window as any).subHandle.timeline.waveformPixels; return { positive: [...d.maxima.slice(0, 15)], negative: [...d.minima.slice(0, 15)] }; });
  expect(data.positive.filter(v => v !== 0)).toEqual([32767 / 32768]); expect(data.positive[7]).toBe(32767 / 32768);
  expect(data.negative.filter(v => v !== 0)).toEqual([-20000 / 32768]); expect(data.negative[9]).toBe(-20000 / 32768);
  const before = await page.evaluate(() => (window as any).waveWorkers);
  await page.evaluate(() => { const timeline = (window as any).subHandle.timeline; for (let i = 0; i < 50; i++) timeline.renderPlayhead(); timeline.render(); });
  await range(page, "波形纵向缩放", 75);
  expect(await page.evaluate(() => (window as any).waveWorkers)).toBe(before);
  const meanInk = () => page.locator(".se-timeline").evaluate((canvas: HTMLCanvasElement) => {
    const dpr = canvas.width / canvas.getBoundingClientRect().width;
    const middle = 16 + Math.floor((canvas.height / dpr - 16) / 2);
    return [...canvas.getContext("2d")!.getImageData(Math.floor(7.5 * dpr), Math.floor((middle - 2) * dpr), 1, 1).data];
  });
  const beforeMean = await meanInk();
  await page.evaluate(() => (window as any).subHandle.runAegisubCommand("audio/options"));
  await page.getByRole("combobox", { name: "波形样式", exact: true }).selectOption("1"); await page.getByRole("button", { name: "确定", exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem("aegisub-web.audio-waveform-style"))).toBe("1");
  await expect.poll(meanInk).not.toEqual(beforeMean);
  expect(await page.evaluate(() => (window as any).waveWorkers)).toBe(before);
  await range(page, "音频水平滚动", 40); await ready(page);
  expect(await page.evaluate(() => (window as any).waveWorkers)).toBe(before);
  await range(page, "音频水平滚动", 1200); await ready(page);
  const afterPan = await page.evaluate(() => (window as any).waveWorkers); expect(afterPan).toBeGreaterThan(before);
  await range(page, "音频水平滚动", 0); await ready(page);
  expect(await page.evaluate(() => (window as any).waveWorkers)).toBe(afterPan);
  expect(await page.evaluate(() => (window as any).subHandle.timeline.waveformPixels.maxima[7])).toBe(32767 / 32768);
});

test("replacing a source during pixel decoding cannot restore the old peaks", async ({ page }) => {
  await page.locator("#media-file").setInputFiles({ name: "loud.wav", mimeType: "audio/wav", buffer: wav(1, 48000 * 4, () => 30000) });
  await ready(page); await range(page, "音频横向缩放", 50);
  await page.locator("#media-file").setInputFiles({ name: "silent.wav", mimeType: "audio/wav", buffer: wav(1, 48000, () => 0) });
  await ready(page);
  expect(await page.evaluate(() => { const d = (window as any).subHandle.timeline.waveformPixels; return d.minima.some((v: number) => v !== 0) || d.maxima.some((v: number) => v !== 0); })).toBe(false);
});
