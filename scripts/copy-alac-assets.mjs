import { cpSync, mkdirSync, rmSync } from "node:fs";

const output = "demo/public/alac";
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const name of ["aurora-alac-0.1.0.js", "LICENSE-AURORA-MIT.txt", "LICENSE-ALAC-APACHE-2.0.txt"]) {
  cpSync(`vendor/${name}`, `${output}/${name}`);
}
console.log("Aurora/alac.js fallback copied to demo/public/alac/");
