import { expect, test, type Page } from "@playwright/test";
function tone(rate = 48000, seconds = 1): Buffer {
  const frames = rate * seconds, b = Buffer.alloc(44 + frames * 2);
  b.write("RIFF"); b.writeUInt32LE(b.length - 8, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 12000 * i / rate) * 2000), 44 + i * 2);
  return b;
}
const command = (page: Page, name: string) => page.evaluate(name => (window as any).subHandle.runAegisubCommand(name), name);
const ready = (page: Page) => expect(page.locator(".se-timeline")).toHaveAttribute("data-spectrum-resolution", "samples");
const settings = async (page: Page, name: string, value: string) => { await command(page, "audio/options"); await page.getByRole("combobox", { name, exact: true }).selectOption(value); await page.getByRole("button", { name: "确定", exact: true }).click(); };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).spectrumWorkers = 0; const Original = Worker;
    window.Worker = class extends Original { constructor(url: string | URL, options?: WorkerOptions) { super(url, options); if (String(url).includes("spectrum.worker")) (window as any).spectrumWorkers++; } };
  });
  await page.goto("/"); await expect.poll(() => page.evaluate(() => !!(window as any).subHandle)).toBe(true);
  await page.locator("#file").setInputFiles({ name: "spectrum.srt", mimeType: "text/plain", buffer: Buffer.from("1\n00:00:00,000 --> 00:00:03,000\nNative spectrum reference\n") });
});

test("source-rate 12 kHz spectrum is visible at the native linear frequency position and ends with the audio", async ({ page }, info) => {
  await page.locator("#media-file").setInputFiles({ name: "12khz.wav", mimeType: "audio/wav", buffer: tone() });
  await command(page, "audio/view/spectrum"); await ready(page);
  await expect(page.locator(".se-timeline")).toHaveAttribute("data-spectrum-sample-rate", "48000");
  const peak = await page.evaluate(() => { const d = (window as any).subHandle.timeline.spectrum, column = d.pixelColumns[20], values = d.values.subarray(column * d.bins, (column + 1) * d.bins); return values.indexOf(Math.max(...values)) * d.parameters.sampleRate / d.parameters.fftSize; });
  expect(peak).toBe(12000);
  const inspect = () => page.locator(".se-timeline").evaluate((canvas: HTMLCanvasElement) => {
    const scale = canvas.width / canvas.getBoundingClientRect().width, top = Math.round(17 * scale), height = canvas.height - top;
    const context = canvas.getContext("2d")!, values = context.getImageData(Math.floor(20.5 * scale), top, 1, height).data;
    let best = 0, intensity = -1;
    for (let y = 2; y < height - 2; y++) { const i = y * 4, sum = values[i] + values[i + 1] + values[i + 2]; if (sum > intensity) { intensity = sum; best = y; } }
    const active = [...values.slice(best * 4, best * 4 + 3)];
    const after = [...context.getImageData(Math.floor(100.5 * scale), top + best, 1, 1).data.slice(0, 3)];
    return { position: best / height, active, after };
  });
  const linear = await inspect(); expect(Math.abs(linear.position - .4)).toBeLessThan(.015); expect(linear.active).not.toEqual(linear.after);
  expect(await page.evaluate(() => "decodedMono16k" in (window as any).subHandle)).toBe(false);
  const workers = await page.evaluate(() => (window as any).spectrumWorkers);
  await settings(page, "频率映射", "4"); await ready(page);
  expect((await inspect()).position).toBeLessThan(.13);
  expect(await page.evaluate(() => (window as any).spectrumWorkers)).toBe(workers);
  await page.screenshot({ path: info.outputPath("native-12khz-spectrum.png") });
});

test("quality and high-rate scaling work; gain, mapping and cached panning reuse FFT data", async ({ page }) => {
  await page.locator("#media-file").setInputFiles({ name: "96k.wav", mimeType: "audio/wav", buffer: tone(96000, 3) });
  await command(page, "audio/view/spectrum"); await ready(page);
  await expect(page.locator(".se-timeline")).toHaveAttribute("data-spectrum-fft-size", "2048");
  await settings(page, "频谱质量", "0"); await ready(page);
  await expect(page.locator(".se-timeline")).toHaveAttribute("data-spectrum-fft-size", "1024");
  const before = await page.evaluate(() => (window as any).spectrumWorkers);
  await page.getByLabel("波形纵向缩放", { exact: true }).evaluate((input: HTMLInputElement) => { input.value = "25"; input.dispatchEvent(new Event("input", { bubbles: true })); });
  await settings(page, "频谱配色", "Green"); await settings(page, "频率映射", "2");
  expect(await page.evaluate(() => (window as any).spectrumWorkers)).toBe(before);
  const slider = async (name: string, value: number) => page.getByLabel(name, { exact: true }).evaluate((input: HTMLInputElement, value) => { input.value = String(value); input.dispatchEvent(new Event("input", { bubbles: true })); }, value);
  await slider("音频横向缩放", 50); await slider("音频水平滚动", 0); await ready(page);
  const zoomed = await page.evaluate(() => (window as any).spectrumWorkers);
  await slider("音频水平滚动", 40); await ready(page);
  expect(await page.evaluate(() => (window as any).spectrumWorkers)).toBe(zoomed);
  await slider("音频水平滚动", 1200); await ready(page);
  const panned = await page.evaluate(() => (window as any).spectrumWorkers); expect(panned).toBeGreaterThan(zoomed);
  await slider("音频水平滚动", 0); await ready(page);
  expect(await page.evaluate(() => (window as any).spectrumWorkers)).toBe(panned);
  await page.evaluate(() => { const timeline = (window as any).subHandle.timeline; for (let i = 0; i < 30; i++) timeline.renderPlayhead(); });
  expect(await page.evaluate(() => (window as any).spectrumWorkers)).toBe(panned);
});

test("cancels pending spectrum work on mode/source changes and generates only a viewport for blank audio", async ({ page }) => {
  await command(page, "audio/open/noise");
  await page.getByLabel("音频横向缩放", { exact: true }).evaluate((input: HTMLInputElement) => { input.value = "-30"; input.dispatchEvent(new Event("input", { bubbles: true })); });
  await command(page, "audio/view/spectrum");
  await expect.poll(() => page.evaluate(() => (window as any).spectrumWorkers)).toBeGreaterThan(0);
  await command(page, "audio/view/waveform"); await command(page, "audio/open/blank"); await command(page, "audio/view/spectrum"); await ready(page);
  const values = await page.evaluate(() => { const d = (window as any).subHandle.timeline.spectrum; return { nonzero: d.values.some((v: number) => v !== 0), bytes: d.values.byteLength, samples: d.totalSamples }; });
  expect(values.nonzero).toBe(false); expect(values.bytes).toBeLessThan(3 * 1024 * 1024); expect(values.samples).toBe(44100 * 9000);
  await page.locator("#media-file").setInputFiles({ name: "replacement.wav", mimeType: "audio/wav", buffer: tone() }); await ready(page);
  await expect(page.locator(".se-timeline")).toHaveAttribute("data-spectrum-sample-rate", "48000");
  await command(page, "audio/close"); await expect(page.locator(".se-root")).toHaveAttribute("data-audio-source", "");
});
