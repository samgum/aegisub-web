import { type Cue, type SubtitleDoc } from "./cue";

export interface AssistantHandle {
  kind: "styling" | "translation";
  commit(): void;
  preview(): void;
  next(): void;
  prev(): void;
  insertOriginal(): void;
  close(): void;
}

export interface AssistantHost {
  getDoc(): SubtitleDoc;
  selectedCueId(): string | null;
  updateCue(id: string, patch: Partial<Cue>): void;
  selectCue(id: string): void;
  runCommand?(command: string): void;
}

const STYLE_ID = "aegisub-web-assistant-style";
function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.aa-back{position:fixed;inset:0;z-index:1700;background:rgba(0,0,0,.6);display:grid;place-items:center;padding:16px}
.aa-modal{width:min(720px,100%);max-height:calc(100dvh - 32px);overflow:auto;background:var(--se-bg,#1d2025);color:var(--se-fg,#e9ebef);border:1px solid var(--se-border,#373b44);border-radius:12px;box-shadow:0 24px 70px rgba(0,0,0,.45)}
.aa-head,.aa-foot{display:flex;align-items:center;gap:8px;padding:11px 14px;background:var(--se-head,#24272d);border-bottom:1px solid var(--se-border,#373b44)}.aa-foot{border-top:1px solid var(--se-border,#373b44);border-bottom:0;flex-wrap:wrap}
.aa-head h2{font-size:15px;margin:0;flex:1}.aa-body{padding:14px;display:grid;gap:12px}.aa-body label{display:grid;gap:5px;font-size:11px;color:var(--se-muted,#9aa2ae)}
.aa-body textarea{min-height:120px;resize:vertical}.aa-body textarea,.aa-body select{font:inherit;padding:8px;border:1px solid var(--se-border,#373b44);border-radius:7px;background:var(--se-bg,#1d2025);color:var(--se-fg,#e9ebef)}
.aa-original{padding:10px;border:1px solid var(--se-border,#373b44);border-radius:7px;white-space:pre-wrap;min-height:54px}.aa-btn{font:inherit;padding:7px 11px;border:1px solid var(--se-border,#373b44);border-radius:7px;background:var(--se-head,#24272d);color:inherit;cursor:pointer}.aa-btn.primary{background:var(--se-accent,#2563eb);border-color:var(--se-accent,#2563eb);color:#fff}.aa-count{font-size:11px;color:var(--se-muted,#9aa2ae);margin-right:auto}
@media(max-width:600px){.aa-back{padding:0}.aa-modal{height:100dvh;max-height:none;border-radius:0}.aa-body textarea{min-height:180px}}
`;
  document.head.append(style);
}

function button(label: string, action: () => void, primary = false): HTMLButtonElement {
  const control = document.createElement("button");
  control.type = "button";
  control.className = `aa-btn${primary ? " primary" : ""}`;
  control.textContent = label;
  control.addEventListener("click", action);
  return control;
}

function shell(title: string): { back: HTMLDivElement; modal: HTMLDivElement; body: HTMLDivElement; foot: HTMLDivElement; close: () => void } {
  injectStyles();
  const back = document.createElement("div");
  back.className = "aa-back";
  const modal = document.createElement("div");
  modal.className = "aa-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  const head = document.createElement("div");
  head.className = "aa-head";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const body = document.createElement("div");
  body.className = "aa-body";
  const foot = document.createElement("div");
  foot.className = "aa-foot";
  const close = (): void => back.remove();
  head.append(heading, button("×", close));
  modal.append(head, body, foot);
  back.append(modal);
  back.addEventListener("mousedown", (event) => { if (event.target === back) close(); });
  document.body.append(back);
  return { back, modal, body, foot, close };
}

function initialIndex(cues: Cue[], id: string | null): number {
  const found = cues.findIndex((cue) => cue.id === id);
  return found >= 0 ? found : 0;
}

export function openTranslationAssistant(host: AssistantHost): AssistantHandle {
  const ui = shell("Translation Assistant / 翻译助手");
  const original = document.createElement("div");
  original.className = "aa-original";
  const textarea = document.createElement("textarea");
  const originalLabel = document.createElement("label");
  originalLabel.textContent = "Original / 原文";
  originalLabel.append(original);
  const translationLabel = document.createElement("label");
  translationLabel.textContent = "Translation / 译文";
  translationLabel.append(textarea);
  ui.body.append(originalLabel, translationLabel);
  const count = document.createElement("span");
  count.className = "aa-count";
  let index = initialIndex(host.getDoc().cues, host.selectedCueId());
  const sourceById = new Map(host.getDoc().cues.map((cue) => [cue.id, cue.text]));
  const render = (): void => {
    const cues = host.getDoc().cues;
    index = Math.max(0, Math.min(cues.length - 1, index));
    const cue = cues[index];
    if (!cue) return;
    original.textContent = sourceById.get(cue.id) ?? cue.text;
    textarea.value = cue.text;
    count.textContent = `${index + 1} / ${cues.length}`;
    host.selectCue(cue.id);
    textarea.focus();
  };
  const preview = (): void => {
    const cue = host.getDoc().cues[index];
    if (cue) host.updateCue(cue.id, { text: textarea.value });
  };
  const next = (): void => { preview(); index += 1; render(); };
  const prev = (): void => { preview(); index -= 1; render(); };
  const insertOriginal = (): void => {
    const cue = host.getDoc().cues[index];
    if (!cue) return;
    const source = sourceById.get(cue.id) ?? "";
    const start = textarea.selectionStart;
    textarea.setRangeText(source, start, textarea.selectionEnd, "end");
  };
  ui.modal.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); next(); }
    else if (event.key === "PageDown") { event.preventDefault(); next(); }
    else if (event.key === "PageUp") { event.preventDefault(); prev(); }
    else if (event.key === "Insert") { event.preventDefault(); insertOriginal(); }
    else if (event.key === "F8") { event.preventDefault(); preview(); }
    else if (event.key === "Home") { event.preventDefault(); host.runCommand?.("video/play/line"); }
    else if (event.key === "End") { event.preventDefault(); host.runCommand?.("audio/play/selection"); }
  });
  ui.foot.append(count, button("← Previous", prev), button("Insert original", insertOriginal), button("Preview", preview), button("Accept + Next", next, true));
  render();
  return { kind: "translation", commit: next, preview, next, prev, insertOriginal, close: ui.close };
}

export function openStylingAssistant(host: AssistantHost): AssistantHandle {
  const ui = shell("Styling Assistant / 样式助手");
  const original = document.createElement("div");
  original.className = "aa-original";
  const styleSelect = document.createElement("select");
  const textLabel = document.createElement("label");
  textLabel.textContent = "Line / 字幕行";
  textLabel.append(original);
  const styleLabel = document.createElement("label");
  styleLabel.textContent = "Style / 样式";
  styleLabel.append(styleSelect);
  ui.body.append(textLabel, styleLabel);
  const count = document.createElement("span");
  count.className = "aa-count";
  let index = initialIndex(host.getDoc().cues, host.selectedCueId());
  for (const style of host.getDoc().styles ?? []) styleSelect.append(new Option(style.name, style.name));
  const render = (): void => {
    const cues = host.getDoc().cues;
    index = Math.max(0, Math.min(cues.length - 1, index));
    const cue = cues[index];
    if (!cue) return;
    original.textContent = cue.text;
    styleSelect.value = cue.assFields?.Style ?? styleSelect.options[0]?.value ?? "Default";
    count.textContent = `${index + 1} / ${cues.length}`;
    host.selectCue(cue.id);
    styleSelect.focus();
  };
  const preview = (): void => {
    const cue = host.getDoc().cues[index];
    if (cue) host.updateCue(cue.id, { assFields: { ...(cue.assFields ?? {}), Style: styleSelect.value } });
  };
  const next = (): void => { preview(); index += 1; render(); };
  const prev = (): void => { preview(); index -= 1; render(); };
  ui.modal.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Enter") { event.preventDefault(); next(); }
    else if (event.key === "PageDown") { event.preventDefault(); next(); }
    else if (event.key === "PageUp") { event.preventDefault(); prev(); }
    else if (event.key === "F8") { event.preventDefault(); preview(); }
    else if (event.key === "Home") { event.preventDefault(); host.runCommand?.("video/play/line"); }
    else if (event.key === "End") { event.preventDefault(); host.runCommand?.("audio/play/selection"); }
  });
  ui.foot.append(count, button("← Previous", prev), button("Preview", preview), button("Accept + Next", next, true));
  render();
  return { kind: "styling", commit: next, preview, next, prev, insertOriginal: () => {}, close: ui.close };
}
