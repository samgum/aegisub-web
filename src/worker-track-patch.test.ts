import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { patchOctopusTrackRender } from "../scripts/patch-octopus-track.mjs";
it("forces only the replacement-track render in the actual pinned worker", () => {
  const source = readFileSync("node_modules/@jellyfin/libass-wasm/dist/js/subtitles-octopus-worker.js", "utf8");
  const patched = patchOctopusTrackRender(source);
  const at = source.indexOf("self.getRenderMethod()()", source.indexOf("self.setTrack=function(content){"));
  expect(patched).toBe(source.slice(0, at) + "self.getRenderMethod()(true)" + source.slice(at + "self.getRenderMethod()()".length));
  expect(() => patchOctopusTrackRender("incompatible worker")).toThrow("boundary changed");
});
