import type { AssStyle, SubtitleDoc } from "./cue";
import type { StylesEditorHost } from "./styles-editor";
import { assColorToHex, hexToAssColor, makeDefaultStyle, embeddedFontNames, defaultAssParts } from "./formats/ass";
import { parseSubtitles, serializeSubtitles } from "./formats";
import { parseEmbeddedFonts } from "./fonts";
import { bundledPreviewFonts } from "./preview-fonts";
import { CanvasAssRenderer } from "./canvas-ass-renderer";
import { styleDialog, styleElement as el, styleButton as button, styleGroup as group } from "./style-dialog-ui";

/** Resolve by name in the CURRENT document for every Apply, never by a stale object. */
export function applyStyleDraft(doc: SubtitleDoc, sourceName: string | null, draft: AssStyle): void {
  const name = draft.name.trim();
  if (!name || /[,\r\n]/.test(name)) throw new Error("样式名称不能为空，也不能包含逗号或换行。");
  const styles = doc.styles ?? [];
  if (styles.some(s => s.name === name && s.name !== sourceName)) throw new Error(`样式“${name}”已存在。`);
  const index = sourceName === null ? -1 : styles.findIndex(s => s.name === sourceName);
  if (sourceName !== null && index < 0) throw new Error("原样式已被删除，请重新打开样式编辑器。");
  const next = structuredClone(draft); next.name = name;
  if (index < 0) styles.push(next); else styles[index] = next;
  doc.styles = styles;
  if (sourceName !== null && sourceName !== name) for (const cue of doc.cues) if (cue.assFields?.Style === sourceName) cue.assFields.Style = name;
}

export function openNativeStyleEditor(host: StylesEditorHost, original: AssStyle): void {
  const draft = structuredClone(original);
  let sourceName: string | null = host.getDoc().styles?.some(s => s.name === original.name) ? original.name : null;
  const ui = styleDialog("样式编辑", "as-style-editor"), status = el("p", "", "as-status"); status.setAttribute("role", "status");
  const columns = el("div", "", "as-columns"), left = el("div", "", "as-stack"), right = el("div", "", "as-stack"); columns.append(left, right);
  const nameGroup = group("样式名称"); const nameInput = el("input"); nameInput.value = draft.name; nameInput.setAttribute("aria-label", "样式名称"); nameGroup.append(nameInput);
  ui.body.append(nameGroup, columns, status);
  const fontGroup = group("字体"), colors = group("颜色"), margins = group("边距"), alignment = group("对齐方式"), outline = group("边框"), other = group("其他"), preview = group("预览");
  colors.className = "as-colours"; left.append(fontGroup, colors, outline); right.append(margins, alignment, other, preview);
  const canvas = el("canvas", "", "as-preview"); canvas.width = 480; canvas.height = 160;
  const previewText = el("input"); previewText.value = "字幕样式预览 Aegisub"; previewText.setAttribute("aria-label", "预览文字");
  const background = el("input"); background.type = "color"; background.value = "#607080"; background.setAttribute("aria-label", "预览背景颜色"); background.style.width = "48px";
  preview.append(canvas, previewText, background);
  const embedded = parseEmbeddedFonts(serializeSubtitles(host.getDoc())).filter(font => font.bytes.length).map(font => URL.createObjectURL(new Blob([font.bytes as BlobPart], { type: font.mime })));
  let fontSignature = "", timer = 0;
  const renderer = new CanvasAssRenderer(canvas, embedded, message => { status.textContent = message; });
  const render = () => {
    const sample = structuredClone(draft); sample.name = "Default";
    // Native SubtitlesPreview centres a sample and zeroes its margins without changing the style.
    Object.assign(sample.fields, { Alignment: "5", MarginL: "0", MarginR: "0", MarginV: "0" });
    const rect = canvas.getBoundingClientRect(); const width = Math.max(1, Math.round(rect.width)), height = Math.max(1, Math.round(rect.height));
    const parts = defaultAssParts("\n");
    const doc = parseSubtitles(parts.scriptInfo.replace(/^PlayResX:.*$/m, `PlayResX: ${width}`).replace(/^PlayResY:.*$/m, `PlayResY: ${height}`) + parts.tail, "preview.ass");
    doc.styles = [sample]; doc.cues = [{ id: "preview", startMs: 0, endMs: 10000, text: `{\\q2}${previewText.value.replace(/\r?\n/g, "\\N")}`, assFields: { Style: "Default" } }];
    const fonts = bundledPreviewFonts(doc); const signature = JSON.stringify(fonts);
    if (signature !== fontSignature) { fontSignature = signature; renderer.setFonts([...embedded, ...fonts.map(file => new URL(`octopus/${file}`, document.baseURI).toString())]); }
    renderer.resize(width * Math.min(2, devicePixelRatio || 1), height * Math.min(2, devicePixelRatio || 1)); renderer.setText(serializeSubtitles(doc)); renderer.renderAt(.1, true);
  };
  const changed = () => { clearTimeout(timer); timer = window.setTimeout(render, 60); };
  const observer = new ResizeObserver(changed); observer.observe(canvas);
  ui.dialog.addEventListener("close", () => { clearTimeout(timer); observer.disconnect(); renderer.dispose(); embedded.forEach(url => URL.revokeObjectURL(url)); }, { once: true });
  const field = (parent: HTMLElement, title: string, key: string, type = "number", min?: number, max?: number): HTMLInputElement => {
    const label = el("label", title), input = el("input"); input.type = type; input.dataset.styleField = key;
    input.value = draft.fields[key] ?? makeDefaultStyle("Default").fields[key] ?? ""; input.step = "any";
    if (min !== undefined) input.min = String(min); if (max !== undefined) input.max = String(max);
    input.addEventListener("input", () => { draft.fields[key] = input.value; changed(); }); label.append(input); parent.append(label); return input;
  };
  const font = field(fontGroup, "字体名称", "Fontname", "text"), size = field(fontGroup, "字号", "Fontsize", "number", .1); size.parentElement!.style.maxWidth = "85px";
  const fontlist = el("datalist"); fontlist.id = `as-fonts-${crypto.randomUUID()}`; font.setAttribute("list", fontlist.id);
  for (const name of new Set(["Arial", "Source Han Sans CN Regular", "Source Han Sans CN Medium", "Source Han Sans CN Heavy", ...embeddedFontNames(host.getDoc()), ...(host.getDoc().styles ?? []).map(s => s.fields.Fontname)])) if (name) { const option = el("option"); option.value = name; fontlist.append(option); }
  fontGroup.append(fontlist);
  const toggles = el("div", "", "as-actions"); fontGroup.append(toggles);
  for (const [title, key] of [["粗体", "Bold"], ["斜体", "Italic"], ["下划线", "Underline"], ["删除线", "StrikeOut"]]) {
    const label = el("label", "", "as-check"), input = el("input"); input.type = "checkbox"; input.checked = Number(draft.fields[key]) !== 0; input.dataset.styleField = key;
    input.addEventListener("change", () => { draft.fields[key] = input.checked ? "-1" : "0"; changed(); }); label.append(input, document.createTextNode(title)); toggles.append(label);
  }
  for (const [title, key] of [["主要颜色", "PrimaryColour"], ["次要颜色", "SecondaryColour"], ["边框颜色", "OutlineColour"], ["阴影颜色", "BackColour"]]) {
    const label = el("label", title), color = el("input"), alpha = el("input"), initial = assColorToHex(draft.fields[key]);
    color.type = "color"; color.value = initial.hex; color.dataset.styleField = key; alpha.type = "number"; alpha.min = "0"; alpha.max = "255"; alpha.value = String(parseInt(initial.alpha, 16)); alpha.setAttribute("aria-label", `${title}透明度`); alpha.title = "透明度：0 不透明，255 完全透明";
    const write = () => { draft.fields[key] = hexToAssColor(color.value, Math.max(0, Math.min(255, Number(alpha.value))).toString(16).padStart(2, "0")); changed(); };
    color.addEventListener("input", write); alpha.addEventListener("input", write); label.append(color, alpha); colors.append(label);
  }
  field(outline, "边框宽度", "Outline", "number", 0); field(outline, "阴影距离", "Shadow", "number", 0);
  const opaque = el("input"); opaque.type = "checkbox"; opaque.checked = draft.fields.BorderStyle === "3"; opaque.dataset.styleField = "BorderStyle";
  const opaqueLabel = el("label", "", "as-check"); opaqueLabel.append(opaque, document.createTextNode("不透明底框")); outline.append(opaqueLabel);
  opaque.addEventListener("change", () => { draft.fields.BorderStyle = opaque.checked ? "3" : "1"; changed(); });
  for (const [title, key] of [["左", "MarginL"], ["右", "MarginR"], ["垂直", "MarginV"]]) field(margins, title, key, "number", 0);
  const grid = el("div", "", "as-align"); alignment.append(grid); const radioName = crypto.randomUUID();
  for (const n of [7, 8, 9, 4, 5, 6, 1, 2, 3]) {
    const label = el("label"), radio = el("input"); radio.type = "radio"; radio.name = radioName; radio.value = String(n); radio.checked = draft.fields.Alignment === radio.value;
    radio.setAttribute("aria-label", `对齐 ${n}`); radio.addEventListener("change", () => { if (radio.checked) draft.fields.Alignment = radio.value; changed(); }); label.append(radio, document.createTextNode(String(n))); grid.append(label);
  }
  for (const [title, key] of [["缩放 X %", "ScaleX"], ["缩放 Y %", "ScaleY"], ["字间距", "Spacing"], ["旋转角度", "Angle"]]) { const input = field(other, title, key); input.parentElement!.style.flex = "1 1 40%"; }
  const encodingLabel = el("label", "字符集"), encoding = el("select"); encoding.dataset.styleField = "Encoding"; encodingLabel.style.flex = "1 1 100%";
  const charsets = new Map([["1", "默认"], ["0", "ANSI"], ["77", "Mac"], ["128", "日语 Shift-JIS"], ["129", "韩语 Hangul"], ["130", "韩语 Johab"], ["134", "简体中文 GB2312"], ["136", "繁体中文 Big5"], ["161", "希腊语"], ["162", "土耳其语"], ["163", "越南语"], ["177", "希伯来语"], ["178", "阿拉伯语"], ["186", "波罗的海语"], ["204", "俄语"], ["222", "泰语"], ["238", "东欧"], ["255", "OEM"]]);
  const current = draft.fields.Encoding ?? "1"; if (!charsets.has(current)) charsets.set(current, current);
  for (const [value, label] of charsets) { const option = el("option", `${value} — ${label}`); option.value = value; encoding.append(option); }
  encoding.value = current; encoding.addEventListener("change", () => { draft.fields.Encoding = encoding.value; changed(); }); encodingLabel.append(encoding); other.append(encodingLabel);
  previewText.addEventListener("input", changed); background.addEventListener("input", () => canvas.style.background = background.value);
  nameInput.addEventListener("input", () => draft.name = nameInput.value);
  const apply = () => {
    try {
      for (const input of ui.body.querySelectorAll<HTMLInputElement>("input")) if (!input.reportValidity()) return false;
      applyStyleDraft(host.getDoc(), sourceName, draft); sourceName = draft.name.trim(); draft.name = sourceName; nameInput.value = sourceName;
      host.onChange(); status.textContent = ""; return true;
    } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); return false; }
  };
  ui.foot.append(button("确定", () => { if (apply()) ui.close(); }), button("取消", ui.close), button("应用", () => { apply(); }));
  changed(); nameInput.focus(); nameInput.select();
}
