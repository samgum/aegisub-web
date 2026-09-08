// Redistribute complete notices and exact, unmodified LGPL parser source together
// with the worker bundle. All paths are fixed generated output paths; no source deletion.
import { cpSync, mkdirSync } from "node:fs";
const out = "demo/public/audio-codecs";
mkdirSync(out, { recursive: true });
for (const [source, name] of [
  ["vendor/FLAC-NOTICE.txt", "NOTICE.txt"],
  ["vendor/LICENSE-AEGISUB-SPECTRUM.txt", "AEGISUB-SPECTRUM.txt"],
  ["vendor/COPYING.GPL-3.0", "COPYING.GPL"],
  ["node_modules/codec-parser/LICENSE", "COPYING.LESSER"],
  ["node_modules/@eshaz/web-worker/LICENSE", "APACHE-WEB-WORKER.txt"],
  ["node_modules/simple-yenc/LICENSE", "MIT-SIMPLE-YENC.txt"],
]) cpSync(source, `${out}/${name}`);
mkdirSync(`${out}/codec-parser`, { recursive: true });
for (const path of ["src", "index.js", "index.d.ts", "package.json", "README.md", "LICENSE"]) {
  cpSync(`node_modules/codec-parser/${path}`, `${out}/codec-parser/${path}`, { recursive: true });
}
console.log("Audio codec notices and unchanged parser source copied.");
