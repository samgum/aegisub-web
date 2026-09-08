export function styleElement<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", cls = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.textContent = text; node.className = cls; return node;
}
export function styleButton(text: string, action: () => void): HTMLButtonElement {
  const button = styleElement("button", text); button.type = "button"; button.addEventListener("click", action); return button;
}
export function styleGroup(title: string): HTMLFieldSetElement {
  const group = styleElement("fieldset"); group.append(styleElement("legend", title)); return group;
}
export function styleDialog(title: string, kind: string) {
  if (!document.getElementById("native-style-dialog-css")) {
    const css = styleElement("style"); css.id = "native-style-dialog-css";
    css.textContent = `
.as-dialog{color-scheme:light;box-sizing:border-box;border:1px solid #969da5;border-radius:3px;background:#f0f0f0;color:#171717;padding:0;width:min(800px,96vw);max-width:96vw;max-height:94dvh;font:13px "Segoe UI","Microsoft YaHei",sans-serif;box-shadow:0 12px 40px #0005}
.as-dialog::backdrop{background:#0004}.as-dialog *{box-sizing:border-box}.as-head{display:flex;align-items:center;justify-content:space-between;padding:7px 12px;background:linear-gradient(#fff,#e5e9ed);border-bottom:1px solid #b2b8bf}.as-head h2{font-family:inherit;font-size:14px;font-weight:600;margin:0}.as-head button{min-width:28px;padding:2px 7px}
.as-body{overflow:auto;max-height:calc(94dvh - 100px);padding:10px;display:grid;gap:9px}.as-foot{display:flex;gap:8px;justify-content:flex-end;padding:8px 12px;border-top:1px solid #c0c3c6}.as-dialog button{font:inherit;color:inherit;background:linear-gradient(#fff,#e6e6e6);border:1px solid #aab0b6;border-radius:2px;padding:5px 12px;min-height:28px;cursor:pointer}.as-dialog button:hover{border-color:#3889c9;background:#e5f1fb}.as-dialog button:disabled{opacity:.45;cursor:default}.as-dialog :focus-visible{outline:2px solid #328ed1;outline-offset:1px}
.as-dialog fieldset{border:1px solid #b7bec5;border-radius:2px;min-width:0;padding:8px;display:flex;gap:8px;flex-wrap:wrap;align-content:start}.as-dialog legend{padding:0 4px}.as-dialog label{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}.as-dialog input,.as-dialog select{font:inherit;color:#171717;border:1px solid #a7adb4;background:white;border-radius:1px;min-height:26px;padding:3px 5px;width:100%;min-width:0}.as-dialog input[type=color]{padding:1px;height:28px}.as-dialog input[type=checkbox],.as-dialog input[type=radio]{width:auto;min-height:0;accent-color:#3384ba}.as-dialog .as-check{flex-direction:row;align-items:center;flex:none}.as-columns{display:grid;grid-template-columns:1fr 1fr;gap:9px}.as-stack{display:grid;align-content:start;gap:9px;min-width:0}.as-colours{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))}.as-align{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;width:105px}.as-align label{flex-direction:row;align-items:center;justify-content:center}.as-preview{display:block;width:100%;height:110px;background:#607080;border:1px solid #929aa3}.as-status{color:#9f240e;min-height:16px;margin:0}.as-status:empty{display:none}.as-list{height:250px;min-height:160px}.as-actions{display:flex;flex-wrap:wrap;gap:5px;width:100%}.as-actions button{flex:1;padding:5px 8px}.as-library{display:flex;gap:7px;align-items:center}.as-library select{flex:1}.as-library input{flex:1}.as-library button{white-space:nowrap}.as-move{display:flex;gap:4px;flex-wrap:wrap;width:100%}.as-move button{flex:1;padding:3px 5px}
@media(pointer:coarse){.as-dialog button,.as-dialog input,.as-dialog select{min-height:36px}.as-dialog input[type=radio],.as-dialog input[type=checkbox]{min-height:18px;width:18px}.as-align{width:140px}.as-list{min-height:180px}}
@media(max-width:600px){.as-dialog{max-width:100vw;width:100vw;max-height:100dvh;border-radius:0}.as-body{max-height:calc(100dvh - 110px)}.as-columns{grid-template-columns:1fr}.as-colours{grid-template-columns:repeat(2,minmax(0,1fr))}.as-library{flex-wrap:wrap}.as-list{height:180px}}
`;
    document.head.append(css);
  }
  const dialog = styleElement("dialog", "", `as-dialog ${kind}`); dialog.setAttribute("aria-label", title);
  const head = styleElement("header", "", "as-head"); const body = styleElement("div", "", "as-body"); const foot = styleElement("footer", "", "as-foot");
  const close = () => dialog.close();
  head.append(styleElement("h2", title), styleButton("关闭", close)); dialog.append(head, body, foot); document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true }); dialog.showModal();
  return { dialog, body, foot, close };
}
