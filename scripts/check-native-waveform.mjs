import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

mkdirSync(".cache", { recursive: true });
let binary = process.env.NATIVE_WAVEFORM_ORACLE;
if (!binary) {
  binary = ".cache/native-waveform-oracle";
  execFileSync(process.env.CXX ?? "c++", ["-std=c++17", "-O2", "scripts/native-waveform-oracle.cpp", "-o", binary], { stdio: "inherit" });
}
const actual = JSON.parse(execFileSync(binary, { encoding: "utf8" }));
const path = "test-corpus/native-waveform-oracle.json";
if (process.argv.includes("--write")) writeFileSync(path, JSON.stringify(actual) + "\n");
else assert.deepEqual(actual, JSON.parse(readFileSync(path, "utf8")));
console.log(`Native C++ waveform oracle: ${actual.length} cases match.`);
