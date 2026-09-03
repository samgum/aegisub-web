import { type AssStyle, type Cue, type SubtitleDoc, newCueId } from "./cue";

type LuaEntry = Record<string, unknown>;

function styleToLua(style: AssStyle): LuaEntry {
  const fields = style.fields;
  return {
    class: "style", _web_name: style.name, name: style.name, fontname: fields.Fontname, fontsize: Number(fields.Fontsize),
    color1: fields.PrimaryColour, color2: fields.SecondaryColour, color3: fields.OutlineColour, color4: fields.BackColour,
    bold: Number(fields.Bold) !== 0, italic: Number(fields.Italic) !== 0, underline: Number(fields.Underline) !== 0,
    strikeout: Number(fields.StrikeOut) !== 0, scale_x: Number(fields.ScaleX), scale_y: Number(fields.ScaleY),
    spacing: Number(fields.Spacing), angle: Number(fields.Angle), borderstyle: Number(fields.BorderStyle),
    outline: Number(fields.Outline), shadow: Number(fields.Shadow), align: Number(fields.Alignment),
    margin_l: Number(fields.MarginL), margin_r: Number(fields.MarginR), margin_t: Number(fields.MarginV), margin_b: Number(fields.MarginV), encoding: Number(fields.Encoding),
  };
}

function cueToLua(cue: Cue): LuaEntry {
  return { class: "dialogue", _web_id: cue.id, comment: cue.assKind === "Comment", layer: Number(cue.assFields?.Layer ?? 0), start_time: cue.startMs, end_time: cue.endMs, style: cue.assFields?.Style ?? "Default", actor: cue.assFields?.Name ?? "", margin_l: Number(cue.assFields?.MarginL ?? 0), margin_r: Number(cue.assFields?.MarginR ?? 0), margin_t: Number(cue.assFields?.MarginV ?? 0), margin_b: Number(cue.assFields?.MarginV ?? 0), effect: cue.assFields?.Effect ?? "", text: cue.text };
}

function fromLuaEntries(source: SubtitleDoc, entries: LuaEntry[]): SubtitleDoc {
  const doc = structuredClone(source);
  const original = new Map(source.cues.map((cue) => [cue.id, cue]));
  doc.styles = entries.filter((entry) => entry.class === "style").map((entry) => {
    const previous = (source.styles ?? []).find((style) => style.name === entry._web_name) ?? { name: String(entry.name ?? "Default"), fields: {} };
    const fields = { ...previous.fields };
    const assign = (key: string, value: unknown): void => { if (value != null) fields[key] = String(value); };
    assign("Fontname", entry.fontname); assign("Fontsize", entry.fontsize); assign("PrimaryColour", entry.color1); assign("SecondaryColour", entry.color2); assign("OutlineColour", entry.color3); assign("BackColour", entry.color4);
    fields.Bold = entry.bold ? "-1" : "0"; fields.Italic = entry.italic ? "-1" : "0"; fields.Underline = entry.underline ? "-1" : "0"; fields.StrikeOut = entry.strikeout ? "-1" : "0";
    assign("ScaleX", entry.scale_x); assign("ScaleY", entry.scale_y); assign("Spacing", entry.spacing); assign("Angle", entry.angle); assign("BorderStyle", entry.borderstyle); assign("Outline", entry.outline); assign("Shadow", entry.shadow); assign("Alignment", entry.align); assign("MarginL", entry.margin_l); assign("MarginR", entry.margin_r); assign("MarginV", entry.margin_b ?? entry.margin_t); assign("Encoding", entry.encoding);
    return { ...previous, name: String(entry.name ?? previous.name), fields };
  });
  doc.cues = entries.filter((entry) => entry.class === "dialogue").map((entry) => {
    const id = typeof entry._web_id === "string" && original.has(entry._web_id) ? entry._web_id : newCueId();
    const previous = original.get(id);
    return { ...(previous ? structuredClone(previous) : { id, startMs: 0, endMs: 1000, text: "" }), id, startMs: Number(entry.start_time ?? 0), endMs: Number(entry.end_time ?? 1000), text: String(entry.text ?? ""), assKind: entry.comment ? "Comment" : "Dialogue", assFields: { ...(previous?.assFields ?? {}), Layer: String(entry.layer ?? 0), Style: String(entry.style ?? "Default"), Name: String(entry.actor ?? ""), MarginL: String(entry.margin_l ?? 0), MarginR: String(entry.margin_r ?? 0), MarginV: String(entry.margin_b ?? entry.margin_t ?? 0), Effect: String(entry.effect ?? "") } } as Cue;
  });
  return doc;
}

export function runLuaAutomation(code: string, doc: SubtitleDoc, selectedIds: readonly string[], activeId: string | null, timeoutMs = 15_000): { done: Promise<SubtitleDoc>; cancel(): void } {
  const worker = new Worker(new URL("./lua-automation.worker.ts", import.meta.url), { type: "module" });
  const styleCount = doc.styles?.length ?? 0;
  const entries = [...(doc.styles ?? []).map(styleToLua), ...doc.cues.map(cueToLua)];
  const selection = doc.cues.map((cue, index) => selectedIds.includes(cue.id) ? styleCount + index + 1 : -1).filter((index) => index > 0);
  const activeIndex = Math.max(1, styleCount + doc.cues.findIndex((cue) => cue.id === activeId) + 1);
  let cancel = (): void => {};
  const done = new Promise<SubtitleDoc>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      worker.terminate();
      action();
    };
    const timer = window.setTimeout(() => finish(() => reject(new Error("Lua Automation timed out."))), timeoutMs);
    cancel = () => finish(() => reject(new Error("Lua Automation cancelled.")));
    worker.onmessage = (event: MessageEvent) => {
      finish(() => {
        if (!event.data?.ok) reject(new Error(event.data?.error || "Lua Automation failed"));
        else resolve(fromLuaEntries(doc, event.data.entries));
      });
    };
    worker.onerror = (event) => finish(() => reject(new Error(event.message || "Lua worker failed")));
  });
  worker.postMessage({ code, entries, selection, active: activeIndex });
  return { done, cancel: () => cancel() };
}
