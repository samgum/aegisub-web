// Shared style-editor host and script-properties dialog. The style editor uses an
// isolated draft; Apply/OK commit, Cancel discards unapplied changes.

import type { SubtitleDoc } from "./cue";
import { makeDefaultStyle, uniqueStyleName } from "./formats/ass";
import { t } from "./i18n";

export interface StylesEditorHost {
  getDoc(): SubtitleDoc;
  onChange(): void; // the style was edited/added/removed
  onRenameStyle(from: string, to: string): void; // update cues referencing the style
}

let stylesCssInjected = false;
function injectStylesCss(): void {
  if (stylesCssInjected) return;
  stylesCssInjected = true;
  const css = `
.se-modal-back{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;}
.se-modal{background:var(--se-bg,#1c1d21);color:var(--se-fg,#e6e7ea);border:1px solid var(--se-border,#33353b);border-radius:10px;
  width:min(560px,94vw);max-height:88vh;display:flex;flex-direction:column;font-family:system-ui,sans-serif;font-size:13px;}
.se-modal-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--se-border,#33353b);}
.se-modal-head h3{margin:0;font-size:14px;flex:1 1 auto;}
.se-modal-body{overflow:auto;padding:14px;display:flex;flex-wrap:wrap;gap:14px;}
.se-modal-body label{display:flex;flex-direction:column;gap:4px;font-size:10px;color:var(--se-muted,#9aa0aa);
  text-transform:uppercase;letter-spacing:.03em;white-space:nowrap;}
.se-modal-body .se-f-name{flex:1 1 100%;}
.se-modal-body .se-f-font{flex:1 1 200px;}
.se-modal-body .se-f-size{flex:0 0 80px;}
.se-modal-body .se-f-align{flex:0 0 160px;}
.se-modal-body .se-f-margin{flex:0 0 72px;}
.se-modal-body input[type=text],.se-modal-body input[type=number],.se-modal-body select{
  font:inherit;padding:5px 7px;border:1px solid var(--se-border,#33353b);border-radius:6px;
  background:var(--se-head,#25272c);color:var(--se-fg,#e6e7ea);width:100%;box-sizing:border-box;}
.se-modal-body input[type=color]{width:40px;height:28px;padding:0;border:1px solid var(--se-border,#33353b);border-radius:6px;background:none;cursor:pointer;}
.se-sgroup{flex:1 1 100%;border:1px solid var(--se-border,#33353b);border-radius:8px;padding:10px 12px;display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;}
.se-sglabel{flex:1 1 100%;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--se-muted,#9aa0aa);}
.se-scgroup{display:flex;align-items:center;gap:6px;padding:4px 8px;border:1px solid var(--se-border,#33353b);border-radius:7px;}
.se-scglabel{font-size:10px;text-transform:uppercase;letter-spacing:.03em;color:var(--se-muted,#9aa0aa);white-space:nowrap;}
.se-scgroup .se-alpha{width:56px;}
.se-scgroup .se-widthfield{width:52px;font:inherit;padding:4px 6px;border:1px solid var(--se-border,#33353b);border-radius:6px;background:var(--se-head,#25272c);color:var(--se-fg,#e6e7ea);}
.se-scgroup select{width:auto;}
.se-colours,.se-toggles{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;}
.se-toggles button{font:600 13px system-ui;width:34px;height:30px;border:1px solid var(--se-border,#33353b);border-radius:6px;background:var(--se-head,#25272c);color:var(--se-fg,#e6e7ea);cursor:pointer;}
.se-toggles button.on{background:var(--se-accent,#2563eb);border-color:var(--se-accent,#2563eb);color:#fff;}
.se-toggles .se-t-i{font-style:italic;} .se-toggles .se-t-u{text-decoration:underline;} .se-toggles .se-t-s{text-decoration:line-through;}
.se-modal-foot{padding:10px 14px;border-top:1px solid var(--se-border,#33353b);display:flex;gap:8px;align-items:center;}
.se-modal-foot .se-spacer{flex:1 1 auto;}
.se-modal .se-btnp{font:inherit;padding:6px 13px;border:1px solid var(--se-border,#33353b);border-radius:6px;background:var(--se-head,#25272c);color:var(--se-fg,#e6e7ea);cursor:pointer;}
.se-modal .se-btnp:hover{border-color:var(--se-accent,#2563eb);}
.se-modal .se-btnp.danger:hover{border-color:#e5484d;color:#e5484d;}
`;
  const s = document.createElement("style");
  s.textContent = css;
  document.head.appendChild(s);
}

export { openNativeStyleEditor as openStyleEditor } from "./native-style-editor";

// --- Script properties (Script Info fields) ------------------------------------------

function getScriptField(info: string, key: string): string {
  return info.match(new RegExp(`^\\s*${key}\\s*:\\s*(.*)$`, "im"))?.[1]?.trim() ?? "";
}
function setScriptField(info: string, key: string, value: string, eol: string): string {
  const re = new RegExp(`^(\\s*${key}\\s*:).*$`, "im");
  if (re.test(info)) return info.replace(re, `$1 ${value}`);
  // Insert after the [Script Info] header (or at the top).
  const lines = info.split(/\r?\n/);
  const at = lines.findIndex((l) => /^\[script info\]/i.test(l.trim()));
  lines.splice(at >= 0 ? at + 1 : 0, 0, `${key}: ${value}`);
  return lines.join(eol);
}

export function openScriptProperties(host: { getDoc(): SubtitleDoc; onChange(): void }): void {
  injectStylesCss();
  const doc = host.getDoc();

  const back = document.createElement("div");
  back.className = "se-modal-back";
  const modal = document.createElement("div");
  modal.className = "se-modal";
  back.appendChild(modal);
  const head = document.createElement("div");
  head.className = "se-modal-head";
  const h3 = document.createElement("h3");
  h3.textContent = t("scriptProps");
  const closeBtn = document.createElement("button");
  closeBtn.className = "se-btnp";
  closeBtn.textContent = t("close");
  head.append(h3, closeBtn);
  const body = document.createElement("div");
  body.className = "se-modal-body";
  modal.append(head, body);
  document.body.appendChild(back);
  const close = () => back.remove();
  closeBtn.addEventListener("click", close);
  back.addEventListener("click", (e) => {
    if (e.target === back) close();
  });

  const set = (key: string, value: string) => {
    doc.assScriptInfo = setScriptField(doc.assScriptInfo ?? "[Script Info]", key, value, doc.eol);
    host.onChange();
  };
  const info = () => doc.assScriptInfo ?? "";

  const textField = (label: string, cls: string, key: string): HTMLElement => {
    const wrap = document.createElement("label");
    wrap.className = cls;
    wrap.textContent = label;
    const input = document.createElement("input");
    input.type = cls === "se-f-size" ? "number" : "text";
    input.value = getScriptField(info(), key);
    input.addEventListener("change", () => set(key, input.value));
    wrap.appendChild(input);
    return wrap;
  };
  const selectField = (label: string, key: string, opts: [string, string][], fallback: string): HTMLElement => {
    const wrap = document.createElement("label");
    wrap.className = "se-f-align";
    wrap.textContent = label;
    const sel = document.createElement("select");
    for (const [v, lbl] of opts) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = lbl;
      sel.appendChild(o);
    }
    sel.value = getScriptField(info(), key) || fallback;
    sel.addEventListener("change", () => set(key, sel.value));
    wrap.appendChild(sel);
    return wrap;
  };

  body.append(
    textField(t("scriptTitle"), "se-f-name", "Title"),
    textField(t("playResX"), "se-f-size", "PlayResX"),
    textField(t("playResY"), "se-f-size", "PlayResY"),
    selectField(t("wrapStyle"), "WrapStyle", [["0", "0"], ["1", "1"], ["2", "2"], ["3", "3"]], "0"),
    selectField(t("scaledBorder"), "ScaledBorderAndShadow", [["yes", "yes"], ["no", "no"]], "yes"),
  );
}

// Re-exported so hosts can build a style and open its editor.
export { makeDefaultStyle, uniqueStyleName };
