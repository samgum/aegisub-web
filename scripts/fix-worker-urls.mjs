// TypeScript preserves `new URL("./x.worker.ts", import.meta.url)` in emitted JavaScript.
// Published output contains .worker.js, so scan the complete dist tree (transcription and
// vendored translation workers) and rewrite those entry points. fileURLToPath is required on
// Windows: URL.pathname turns D:/... into /D:/..., which Node resolves as D:\D:\....
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const workerUrl = /(new URL\(\s*["'][^"']*\.worker)\.ts(["'])/g;

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(path);
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;
    const source = readFileSync(path, "utf8");
    const output = source.replace(workerUrl, "$1.js$2");
    if (output !== source) {
      writeFileSync(path, output);
      console.log(`fixed worker URL in ${path.slice(root.length)}`);
    }
  }
}

walk(root);
