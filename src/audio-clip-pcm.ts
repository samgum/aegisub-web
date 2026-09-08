// Conversion and WAV layout follow samgum/Aegisub dc2a5b4,
// libaegisub/audio/provider.cpp and provider_convert.cpp.
// Copyright (c) 2014, Thomas Goyne <plorkyeran@aegisub.org>
// Permission to use, copy, modify, and distribute this software for any
// purpose with or without fee is hereby granted, provided that the above
// copyright notice and this permission notice appear in all copies.
// THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
// WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
// MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
// ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
// WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
// ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
// OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

import { assTimeMilliseconds, type Cue } from "./cue";

export interface AudioClipRange { startMs: number; endMs: number }

/** Export the saved selection's bounding interval, including gaps between lines.
 * Pending audio markers and playback volume/speed are deliberately not inputs. */
export function selectedAudioClipRange(cues: readonly Cue[], ids: ReadonlySet<string>, ass: boolean): AudioClipRange | null {
  let startMs = Infinity, endMs = 0;
  for (const cue of cues) if (ids.has(cue.id)) {
    startMs = Math.min(startMs, cue.startMs); endMs = Math.max(endMs, cue.endMs);
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  const time = ass ? assTimeMilliseconds : (value: number) => Math.max(0, Math.round(value));
  return { startMs: time(startMs), endMs: time(endMs) };
}

export function clipSampleRange(range: AudioClipRange, rate: number, total: number): { start: number; end: number } {
  if (!Number.isSafeInteger(rate) || rate <= 0 || !Number.isSafeInteger(total) || total < 0
    || !Number.isFinite(range.startMs) || !Number.isFinite(range.endMs)) throw new Error("音频采样率或截取范围无效。");
  const sample = (ms: number) => Math.min(total, Math.ceil(Math.max(0, ms) * rate / 1000));
  const start = sample(range.startMs);
  return { start, end: Math.max(start, sample(range.endMs)) };
}

export function monoWavHeader(rate: number, count: number): Uint8Array<ArrayBuffer> {
  if (!Number.isSafeInteger(count) || count < 0 || count * 2 > 0xffffffff - 36) {
    throw new Error("音频片段超过 WAV 的 4 GiB 上限，请缩短选中时间段。");
  }
  if (!Number.isSafeInteger(rate) || rate <= 0 || rate * 2 > 0xffffffff) throw new Error("音频采样率无效。");
  const header = new Uint8Array(44), view = new DataView(header.buffer);
  const ascii = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) header[offset + i] = text.charCodeAt(i); };
  ascii(0, "RIFF"); view.setUint32(4, 36 + count * 2, true); ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, "data"); view.setUint32(40, count * 2, true);
  return header;
}

export function floatToPcm16(value: number): number {
  if (Number.isNaN(value)) return 0;
  value = Math.max(-1, Math.min(1, value));
  return Math.trunc(value < 0 ? value * 32768 - .5 : value * 32767 + .5);
}

/** Read raw PCM instead of round-tripping integer samples through a library's
 * asymmetric normalized float conversion. Wider integers keep their high 16 bits. */
export function pcm16Reader(codec: string): { bytes: number; read(view: DataView, offset: number): number } | null {
  const match = /^pcm-([suf])(8|16|24|32|64)(be)?$/.exec(codec);
  if (!match) return null;
  const bytes = Number(match[2]) / 8, little = !match[3];
  if (match[1] === "f" && (bytes === 4 || bytes === 8)) {
    return { bytes, read: (view, offset) => floatToPcm16(bytes === 4 ? view.getFloat32(offset, little) : view.getFloat64(offset, little)) };
  }
  if (bytes === 1) return { bytes, read: (view, offset) => (match[1] === "u" ? view.getUint8(offset) - 128 : view.getInt8(offset)) * 256 };
  if (match[1] === "s" && bytes >= 2) return { bytes, read: (view, offset) => view.getInt16(offset + (little ? bytes - 2 : 0), little) };
  return null;
}

export function downmixPcm16(view: DataView, channels: number, frames: number, read: (view: DataView, offset: number) => number, bytes: number, planar = false): Int16Array {
  const mono = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) sum += read(view, (planar ? channel * frames + i : i * channels + channel) * bytes);
    mono[i] = Math.trunc(sum / channels);
  }
  return mono;
}

/** Incremental native mono provider conversion. Only one source sample of lookahead
 * and a 64 KiB output block stay in JS; completed output is stored as immutable Blobs. */
export class PcmClipWriter {
  readonly factor: number;
  readonly rate: number;
  readonly start: number;
  readonly end: number;
  readonly readStart: number;
  readonly readEnd: number;
  private cursor: number;
  private previous: number | null = null;
  private parts: BlobPart[];
  private bytes = new Uint8Array(65536);
  private view = new DataView(this.bytes.buffer);
  private used = 0;
  private written = 0;
  private pair: Int16Array;

  constructor(sourceRate: number, totalFrames: number, range: AudioClipRange) {
    clipSampleRange(range, sourceRate, totalFrames);
    let factor = 1;
    while (sourceRate * factor < 32000) factor *= 2;
    this.factor = factor; this.rate = sourceRate * factor;
    const { start, end } = clipSampleRange(range, this.rate, totalFrames * factor);
    this.start = start; this.end = end;
    this.parts = [monoWavHeader(this.rate, end - start)];
    this.readStart = Math.floor(start / factor);
    this.readEnd = end === start ? this.readStart : Math.min(totalFrames, Math.floor((end - 1) / factor) + 1 + (factor > 1 ? 1 : 0));
    this.cursor = this.readStart; this.pair = new Int16Array(factor + 1);
  }

  get progress(): number { return this.end === this.start ? 1 : this.written / (this.end - this.start); }

  append(position: number, samples: Int16Array): void {
    // Packet timestamps may overlap, or include leading/trailing codec padding.
    // Missing timeline samples are silence; already consumed samples are never repeated.
    const gapEnd = Math.min(position, this.readEnd);
    while (this.cursor < gapEnd) this.feed(0);
    const end = Math.min(this.readEnd, position + samples.length);
    while (this.cursor < end) this.feed(samples[this.cursor - position]);
  }

  private feed(value: number): void {
    if (this.factor === 1) this.write(this.cursor, value);
    else if (this.previous !== null) this.writePair(this.cursor - 1, this.previous, value);
    this.previous = value; this.cursor++;
  }

  private writePair(index: number, left: number, right: number): void {
    const values = this.pair; values[0] = left; values[this.factor] = right;
    // Repeated doubling truncates every intermediate midpoint toward zero, not
    // just the final result of a single linear interpolation at the target rate.
    for (let stride = this.factor; stride > 1; stride /= 2) {
      for (let i = 0; i < this.factor; i += stride) values[i + stride / 2] = Math.trunc((values[i] + values[i + stride]) / 2);
    }
    for (let i = 0; i < this.factor; i++) this.write(index * this.factor + i, values[i]);
  }

  private write(index: number, value: number): void {
    if (index < this.start || index >= this.end) return;
    this.view.setInt16(this.used, value, true); this.used += 2; this.written++;
    if (this.used === this.bytes.length) this.flush();
  }

  private flush(): void {
    if (!this.used) return;
    this.parts.push(new Blob([this.bytes.subarray(0, this.used)]));
    this.used = 0;
  }

  finish(): Blob {
    while (this.cursor < this.readEnd) this.feed(0);
    if (this.factor > 1 && this.previous !== null) this.writePair(this.cursor - 1, this.previous, 0);
    this.flush();
    if (this.written !== this.end - this.start) throw new Error("音频片段采样数量不符，未保存不完整文件。");
    const blob = new Blob(this.parts, { type: "audio/wav" }); this.parts = [];
    return blob;
  }
}
