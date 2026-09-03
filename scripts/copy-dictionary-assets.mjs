import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = join(root, "demo", "public", "dictionaries");
mkdirSync(output, { recursive: true });
for (const [source, target] of [["index.aff", "en.aff"], ["index.dic", "en.dic"]]) {
  const destination = join(output, target);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(root, "node_modules", "dictionary-en", source), destination);
}
console.log("spellcheck dictionary assets copied to demo/public/dictionaries/");
