// Interaction formulas adapted from Aegisub visual_tool_rotatez/rotatexy/scale.cpp.
// Copyright (c) 2011, Thomas Goyne <plorkyeran@aegisub.org>
// Permission to use, copy, modify, and distribute this software for any purpose with or
// without fee is hereby granted, provided that the above copyright notice and this
// permission notice appear in all copies. THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR
// DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES
// OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL,
// DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
// OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS
// ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

import type { Cue, SubtitleDoc } from "./cue";
import { getPlayRes } from "./formats/ass";

export type VisualTransformMode = "rotate-z" | "rotate-xy" | "scale";
export type Point = { x: number; y: number };
export type VisualState = { position: Point; origin: Point; rx: number; ry: number; rz: number; sx: number; sy: number };
export type VisualTags = Record<string, string>;

/** Split only top-level tags; an animated \t(...\frz...) is one token, not a static frz. */
function tokens(block: string): { raw: string; name: string }[] {
  const starts = [0];
  let depth = 0;
  for (let i = 0; i < block.length; i++) {
    if (block[i] === "(") depth++;
    else if (block[i] === ")") depth = Math.max(0, depth - 1);
    else if (block[i] === "\\" && depth === 0 && i > 0) starts.push(i);
  }
  return starts.map((start, i) => {
    const raw = block.slice(start, starts[i + 1]);
    const name = raw.match(/^\\(fscx|fscy|frx|fry|frz|fax|fay|move|pos|org|iclip|clip|an|fr|a)(?=[\d\s(+.-]|$)/)?.[1] ?? "";
    return { raw, name };
  });
}

export function setVisualTags(text: string, updates: VisualTags): string {
  if (!Object.keys(updates).length) return text;
  const first = text.match(/^\{([^}]*)\}/);
  const aliases: Record<string, string> = { frz: "fr", pos: "move", move: "pos", clip: "iclip", iclip: "clip" };
  const removed = new Set(Object.keys(updates).flatMap(key => [key, aliases[key]].filter(Boolean)));
  const addition = Object.entries(updates).map(([tag, value]) => `\\${tag}${value}`).join("");
  if (!first || !first[1].includes("\\")) return `{${addition}}${text}`;
  const retained = tokens(first[1]).filter(token => !removed.has(token.name)).map(token => token.raw).join("");
  return `{${retained}${addition}}${text.slice(first[0].length)}`;
}

export function visualState(doc: SubtitleDoc, cue: Cue): VisualState {
  const tags = [...cue.text.matchAll(/\{([^}]*)\}/g)].flatMap(match => tokens(match[1]));
  const value = (name: string) => tags.find(tag => tag.name === name)?.raw.slice(name.length + 1).trim();
  const number = (name: string, fallback: number): number => {
    const raw = value(name);
    const parsed = raw === undefined || raw === "" ? NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const pair = (name: string): Point | undefined => {
    const raw = value(name)?.match(/^\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/);
    return raw ? { x: Number(raw[1]), y: Number(raw[2]) } : undefined;
  };
  const style = doc.styles?.find(style => style.name === (cue.assFields?.Style ?? "Default"));
  const field = (name: string, fallback: number) => {
    const parsed = Number(style?.fields[name] ?? fallback);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const margin = (name: string) => Number(cue.assFields?.[name]) || field(name, 10);
  const resolution = getPlayRes(doc);
  const oldAlignment: Record<number, number> = { 1: 1, 2: 2, 3: 3, 5: 7, 6: 8, 7: 9, 9: 4, 10: 5, 11: 6 };
  const align = number("an", oldAlignment[number("a", 0)] ?? field("Alignment", 2));
  const hor = (align - 1) % 3, vert = Math.floor((align - 1) / 3);
  const position = pair("pos") ?? pair("move") ?? {
    x: hor === 0 ? margin("MarginL") : hor === 2 ? resolution.x - margin("MarginR") : (resolution.x + margin("MarginL") - margin("MarginR")) / 2,
    y: vert === 0 ? resolution.y - margin("MarginV") : vert === 2 ? margin("MarginV") : resolution.y / 2,
  };
  return { position, origin: pair("org") ?? position,
    rx: number("frx", 0), ry: number("fry", 0), rz: number("frz", number("fr", field("Angle", 0))),
    sx: number("fscx", field("ScaleX", 100)), sy: number("fscy", field("ScaleY", 100)),
  };
}

export function transformDrag(mode: VisualTransformMode, initial: VisualState, start: Point, current: Point, origin: Point,
  modifiers: { ctrl: boolean; shift: boolean; alt: boolean }): VisualTags {
  const wrap = (value: number) => (value % 360 + 360) % 360;
  const angle = (value: number) => String(Number(wrap(modifiers.ctrl ? Math.round(value / 30) * 30 : value).toPrecision(4)));
  let dx = current.x - start.x, dy = current.y - start.y;
  if (modifiers.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
  if (mode === "rotate-z") {
    const startAngle = Math.atan2(start.y - origin.y, start.x - origin.x);
    const endAngle = Math.atan2(current.y - origin.y, current.x - origin.x);
    return { frz: angle(initial.rz + (startAngle - endAngle) * 180 / Math.PI) };
  }
  if (mode === "rotate-xy") return { frx: angle(initial.rx - dy * 2), fry: angle(initial.ry + dx * 2) };
  dy = -dy;
  if (modifiers.alt) {
    if (Math.abs(dx) > Math.abs(dy)) dy = dx * (initial.sx ? initial.sy / initial.sx : 1);
    else dx = dy * (initial.sy ? initial.sx / initial.sy : 1);
  }
  const scale = (value: number) => String(Math.trunc(modifiers.ctrl ? Math.round(Math.max(0, value) / 25) * 25 : Math.max(0, value)));
  return { fscx: scale(initial.sx + dx * 1.25), fscy: scale(initial.sy + dy * 1.25) };
}
