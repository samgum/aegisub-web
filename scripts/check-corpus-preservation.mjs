// Run regeneration in a fresh output directory and prove it preserves unrelated
// native/media fixtures. Never point a destructive test at the source workspace.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

mkdirSync(".cache", { recursive: true });
const output = mkdtempSync(join(resolve(".cache"), "corpus-preservation-"));
for (const name of ["native-waveform-oracle.json", "tiny.flac"]) copyFileSync(`test-corpus/${name}`, join(output, name));
writeFileSync(join(output, "hand-authored.keep"), "This is not owned by the subtitle generator.");
execFileSync(process.execPath, ["scripts/gen-corpus.mjs", "--no-validate", "--output", output], { stdio: "inherit" });
for (const name of ["native-waveform-oracle.json", "tiny.flac"]) assert.deepEqual(readFileSync(join(output, name)), readFileSync(`test-corpus/${name}`));
assert.equal(readFileSync(join(output, "hand-authored.keep"), "utf8"), "This is not owned by the subtitle generator.");
assert.equal(JSON.parse(readFileSync(join(output, "manifest.json"), "utf8")).length, 32);
console.log("Corpus regeneration preserves native, media and hand-authored fixtures.");
