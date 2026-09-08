import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const oracle = JSON.parse(readFileSync("test-corpus/audio-clip-oracle.json", "utf8")) as { name: string; codec: string; rate: number; startMs: number; endMs: number; count: number; points: [number, number][] }[];
const command = (page: Page, name: string) => page.evaluate(name => (window as any).subHandle.runAegisubCommand(name), name);
async function downloadClip(page: Page): Promise<Buffer> {
  const downloading = page.waitForEvent("download");
  // Observe a failed worker immediately, before its toast disappears. A 30-second
  // download timeout alone hides the actual decoder error on remote platform CI.
  const failure = page.waitForFunction(() => document.querySelector<HTMLElement>(".se-root")?.dataset.audioExport === "error")
    .then(async () => { throw new Error(`Audio export failed: ${await page.locator(".se-toast").textContent()}`); });
  const completed = Promise.race([downloading, failure]);
  await command(page, "audio/save/clip");
  const download = await completed;
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(Buffer.from(chunk));
  await expect(page.locator(".se-audio-export")).toHaveCount(0);
  return Buffer.concat(chunks);
}
function stereoWav(rate: number, seconds: number): Buffer {
  const frames = rate * seconds, buffer = Buffer.alloc(44 + frames * 4);
  buffer.write("RIFF"); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 4, 28); buffer.writeUInt16LE(4, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) { buffer.writeInt16LE((i * 137) % 65536 - 32768, 44 + i * 4); buffer.writeInt16LE((i * 263 + 99) % 65536 - 32768, 46 + i * 4); }
  return buffer;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/"); await expect.poll(() => page.evaluate(() => !!(window as any).subHandle)).toBe(true);
});

test("exports noncontiguous saved rows as one range, without applying pending timing, gain or playback speed", async ({ page }, info) => {
  await page.locator("#file").setInputFiles({ name: "clip.srt", mimeType: "text/plain", buffer: Buffer.from("1\n00:00:00,011 --> 00:00:00,071\nFirst\n\n2\n00:00:00,100 --> 00:00:00,180\nNot selected\n\n3\n00:00:00,210 --> 00:00:00,231\nLast\n") });
  const input = stereoWav(48000, 1);
  await page.locator("#media-file").setInputFiles({ name: "stereo.wav", mimeType: "audio/wav", buffer: input });
  await expect.poll(() => page.evaluate(() => !!(window as any).subHandle.audio.analysisBlob)).toBe(true);
  if (/android|ipad|iphone/.test(info.project.name)) {
    // Selection mechanics have separate touch coverage. Here hold the exact same
    // noncontiguous selection while exercising the real browser export command.
    await page.evaluate(() => { const h = (window as any).subHandle, cues = h.getDoc().cues; h.setSelection([cues[0].id, cues[2].id], cues[2].id); });
  } else {
    await page.locator(".se-row").first().click();
    await page.locator(".se-row").nth(2).click({ modifiers: [info.project.name === "macos-webkit" ? "Meta" : "Control"] });
  }
  const before = await page.evaluate(() => {
    const h = (window as any).subHandle;
    h.timingDraft.set(h.getDoc().cues[2], 210, 900); h.audio.setGain(.125); h.setPlaybackRate(2);
    return { doc: h.getDoc(), selected: [...h.selectedIds], time: h.audio.currentTime };
  });
  const wav = await downloadClip(page);
  const first = Math.ceil(11 * 48000 / 1000), end = Math.ceil(231 * 48000 / 1000);
  expect(wav.readUInt16LE(22)).toBe(1); expect(wav.readUInt32LE(24)).toBe(48000); expect(wav.readUInt32LE(40)).toBe((end - first) * 2);
  let mismatches = 0;
  for (let i = first; i < end; i++) if (wav.readInt16LE(44 + (i - first) * 2) !== Math.trunc((input.readInt16LE(44 + i * 4) + input.readInt16LE(46 + i * 4)) / 2)) mismatches++;
  expect(mismatches).toBe(0);
  expect(await page.evaluate(() => { const h = (window as any).subHandle; return { doc: h.getDoc(), selected: [...h.selectedIds], time: h.audio.currentTime }; })).toEqual(before);
  expect(await page.evaluate(() => (window as any).subHandle.timingDraft.pending)).toBe(true);
  expect(await page.evaluate(() => (window as any).subHandle.decodedMono16k)).toBeNull();
});

test("44.1 kHz export starts at ceil(sample), and beyond EOF yields an empty valid WAV", async ({ page }) => {
  const input = stereoWav(44100, 1);
  await page.locator("#file").setInputFiles({ name: "clip.srt", mimeType: "text/plain", buffer: Buffer.from("1\n00:00:00,001 --> 00:00:00,002\nSample boundary\n") });
  await page.locator("#media-file").setInputFiles({ name: "stereo.wav", mimeType: "audio/wav", buffer: input });
  const wav = await downloadClip(page);
  expect(wav.length).toBe(44 + 44 * 2);
  expect(wav.readInt16LE(44)).toBe(Math.trunc((input.readInt16LE(44 + 45 * 4) + input.readInt16LE(46 + 45 * 4)) / 2));
  await page.locator("#file").setInputFiles({ name: "after.srt", mimeType: "text/plain", buffer: Buffer.from("1\n00:00:03,000 --> 00:00:04,000\nPast EOF\n") });
  const empty = await downloadClip(page); expect(empty.length).toBe(44); expect(empty.readUInt32LE(40)).toBe(0);
});

for (const fixture of oracle) test(`exports ${fixture.name} at source rate against independently decoded FFmpeg samples`, async ({ page }) => {
  const time = (ms: number) => `00:00:${Math.floor(ms / 1000).toString().padStart(2, "0")},${(ms % 1000).toString().padStart(3, "0")}`;
  await page.locator("#file").setInputFiles({ name: "clip.srt", mimeType: "text/plain", buffer: Buffer.from(`1\n${time(fixture.startMs)} --> ${time(fixture.endMs)}\nCodec reference\n`) });
  await page.locator("#media-file").setInputFiles(`test-corpus/${fixture.name}`);
  await expect.poll(() => page.evaluate(() => { const h = (window as any).subHandle; return !!h.audio.analysisBlob && !h.root.querySelector('.se-audio-player')?.hasAttribute('data-loading'); })).toBe(true);
  // Aurora conversion finishes before publishing its WAV analysisBlob.
  if (/alac|aiff|caf/.test(fixture.name)) await expect.poll(() => page.evaluate(() => (window as any).subHandle.audio.analysisBlob?.type)).toBe("audio/wav");
  const wav = await downloadClip(page);
  expect(wav.readUInt32LE(24)).toBe(fixture.rate); expect(wav.readUInt16LE(22)).toBe(1); expect(wav.readUInt16LE(34)).toBe(16);
  expect(wav.readUInt32LE(40)).toBe(fixture.count * 2);
  // FFmpeg and WebCodecs float->S16 rounding can differ by one; codec implementations
  // may differ slightly too. The points include exact first/last sample and phase.
  const errors = fixture.points.map(([offset, expected]) => Math.abs(wav.readInt16LE(44 + offset * 2) - expected));
  expect(Math.max(...errors)).toBeLessThanOrEqual(/opus|aac|vorbis|ac3/.test(fixture.codec) ? 3 : 1);
});

test("cancel and source replacement discard an in-flight export, not its waveform or subtitle edits", async ({ page }) => {
  await page.locator("#file").setInputFiles({ name: "long.srt", mimeType: "text/plain", buffer: Buffer.from("1\n00:00:00,000 --> 02:30:00,000\nPreserve this\n") });
  await command(page, "audio/open/noise");
  const downloads: unknown[] = []; page.on("download", download => downloads.push(download));
  await command(page, "audio/save/clip");
  const bar = page.locator(".se-audio-export"); await expect(bar).toBeVisible();
  const box = (await bar.getByRole("button", { name: "取消", exact: true }).boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await bar.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.locator(".se-root")).toHaveAttribute("data-audio-export", "cancelled");
  await command(page, "audio/save/clip"); await command(page, "audio/open/blank");
  await expect(page.locator(".se-root")).toHaveAttribute("data-audio-export", "cancelled");
  await expect(bar).toHaveCount(0); expect(downloads).toHaveLength(0);
  expect(await page.evaluate(() => (window as any).subHandle.getDoc().cues[0].text)).toBe("Preserve this");
  await expect(page.locator(".se-root")).toHaveAttribute("data-audio-source", "blank");
});
