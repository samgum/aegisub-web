// Existing synthetic fixtures, decoded by independent FFmpeg. Browsers check the
// exported range against these actual samples, not just a RIFF signature or a download.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../test-corpus/", import.meta.url));
const ffmpeg = process.env.FFMPEG ?? "ffmpeg", ffprobe = process.env.FFPROBE ?? "ffprobe";
execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=733:sample_rate=48000", "-t", "0.8", "-c:a", "ac3", "-b:a", "192k", `${root}audio-clip-ac3.mka`]);
const files = ["tiny.wav", "tiny.flac", "tiny.opus", "tiny.ogg", "tiny-alac.m4a", "tiny-aac.m4a", "tiny.aiff", "tiny.caf", "audio-clip-ac3.mka"];
for (const depth of [16, 24]) {
  const pcm = Buffer.alloc(65536 * depth / 8), name = `audio-clip-depth${depth}.flac`;
  for (let i = 0; i < 65536; i++) {
    const value = depth === 16 ? i - 32768 : (i - 32768) * 256 + i % 256;
    for (let byte = 0; byte < depth / 8; byte++) pcm[i * depth / 8 + byte] = value >> (byte * 8);
  }
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", `s${depth}le`, "-ar", depth === 16 ? "48000" : "96000", "-ac", "1", "-i", "pipe:0", "-c:a", "flac", root + name], { input: pcm });
  files.push(name);
}
for (const [extension, codec] of [["opus", "libopus"], ["ogg", "libvorbis"], ["m4a", "aac"], ["mka", "ac3"]]) {
  const name = `audio-clip-middle.${extension}`;
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "aevalsrc=0.12*sin(2*PI*(191*t+173*t*t)):s=48000:d=4", "-c:a", codec, "-b:a", "128k", root + name]);
  files.push(name);
}
const result = [];
for (const name of files) {
  const info = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate,channels,codec_name", "-of", "json", root + name], { encoding: "utf8" })).streams[0];
  if (info.channels !== 1) throw new Error("This oracle requires mono fixtures; multi-channel native conversion has independent PCM fixtures.");
  const data = execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", root + name, "-map", "0:a:0", "-f", "s16le", "-c:a", "pcm_s16le", "-"], { maxBuffer: 10 * 1024 * 1024 });
  const rate = Number(info.sample_rate), startMs = name.includes("middle") ? 3001 : 100, endMs = name.includes("middle") ? 3141 : 500;
  const start = Math.ceil(startMs * rate / 1000), count = Math.ceil(endMs * rate / 1000) - start;
  const points = Array.from({ length: 31 }, (_, i) => { const offset = Math.floor((count - 1) * i / 30); return [offset, data.readInt16LE((start + offset) * 2)]; });
  result.push({ name, codec: info.codec_name, rate, startMs, endMs, count, points });
}
writeFileSync(root + "audio-clip-oracle.json", JSON.stringify(result, null, 2) + "\n");
console.log(`Independent FFmpeg audio-clip references written for ${result.length} codecs/containers.`);
