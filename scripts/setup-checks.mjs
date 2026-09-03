#!/usr/bin/env node
// Create the independent-reader Python environment on Windows, macOS, or Linux.
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const candidates = process.platform === "win32"
  ? [["py", ["-3"]], ["python", []], ["python3", []]]
  : [["python3", []], ["python", []]];
const selected = candidates.find(([command, prefix]) =>
  spawnSync(command, [...prefix, "--version"], { stdio: "ignore" }).status === 0,
);
if (!selected) throw new Error("Python 3 was not found on PATH.");

const [command, prefix] = selected;
execFileSync(command, [...prefix, "-m", "venv", join(root, ".cache", "py")], { stdio: "inherit" });
const python = process.platform === "win32"
  ? join(root, ".cache", "py", "Scripts", "python.exe")
  : join(root, ".cache", "py", "bin", "python");
execFileSync(python, ["-m", "pip", "install", "--quiet", "pysubs2"], { stdio: "inherit" });
