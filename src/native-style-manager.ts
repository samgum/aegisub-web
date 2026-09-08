import type { AssStyle, SubtitleDoc } from "./cue";
import type { DialogHost } from "./aegisub-dialogs";
import { parseSubtitles, serializeSubtitles } from "./formats";
import { makeDefaultStyle, uniqueStyleName, defaultAssParts } from "./formats/ass";
import { openNativeStyleEditor } from "./native-style-editor";
import { styleDialog, styleElement as el, styleButton as button, styleGroup as group } from "./style-dialog-ui";

const STORAGE_KEY = "aegisub-web.style-libraries.v1";
export function validStyleLibrary(value: unknown): value is AssStyle[] {
  return Array.isArray(value) && value.every(style => style && typeof style.name === "string" && !!style.name.trim() && !/[,\r\n]/.test(style.name)
    && style.fields && typeof style.fields === "object" && !Array.isArray(style.fields) && Object.values(style.fields).every(v => typeof v === "string"))
    && new Set(value.map(style => style.name)).size === value.length;
}
function libraryDocument(styles: AssStyle[]): SubtitleDoc {
  const parts = defaultAssParts("\n");
  const doc = parseSubtitles(parts.scriptInfo + parts.tail, "styles.ass"); doc.styles = styles; return doc;
}
export function parseStyleLibrary(text: string, filename: string): AssStyle[] {
  let result: unknown;
  if (/\.json$/i.test(filename)) result = JSON.parse(text);
  else {
    const parts = defaultAssParts("\n");
    const source = /\[Events\]/i.test(text) ? text : /\[V4\+? Styles\]/i.test(text) ? `${text}\n${parts.tail}` : `${parts.scriptInfo}\n${text}\n${parts.tail}`;
    result = parseSubtitles(source, filename.replace(/\.sty$/i, ".ass")).styles;
  }
  if (!validStyleLibrary(result) || !result.length) throw new Error("文件中没有有效样式；现有样式未被修改。");
  return result;
}

export function openNativeStyleManager(host: DialogHost): void {
  const ui = styleDialog("样式管理器", "as-style-manager"), status = el("p", "", "as-status"); status.setAttribute("role", "status");
  let libraries = new Map<string, AssStyle[]>([["Default", []]]);
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      const entries = Object.entries(saved).filter(([name, styles]) => !!name.trim() && validStyleLibrary(styles)) as [string, AssStyle[]][];
      if (entries.length) libraries = new Map(entries);
    }
  } catch { status.textContent = "无法读取已保存的样式库。现有字幕未被修改。"; }
  let libraryName = libraries.keys().next().value!;
  const catalogue = group("可用样式库"), catalogueRow = el("div", "", "as-library"), selectLibrary = el("select"), libraryInput = el("input");
  selectLibrary.setAttribute("aria-label", "可用样式库"); libraryInput.placeholder = "新样式库名称"; libraryInput.setAttribute("aria-label", "新样式库名称");
  const persist = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(libraries))); status.textContent = ""; } catch { status.textContent = "样式库保存失败，请导出备份后再关闭。"; } };
  const renderCatalogue = () => { selectLibrary.replaceChildren(); for (const name of libraries.keys()) { const option = el("option", name); option.value = name; selectLibrary.append(option); } selectLibrary.value = libraryName; };
  catalogueRow.append(selectLibrary, libraryInput, button("新建库", () => {
    const name = libraryInput.value.trim(); if (!name || libraries.has(name)) { status.textContent = "请输入不重复的样式库名称。"; return; }
    libraries.set(name, []); libraryName = name; libraryInput.value = ""; persist(); renderCatalogue(); render();
  }), button("删除库", () => {
    if (!confirm(`删除样式库“${libraryName}”？当前脚本中的样式不会删除。`)) return;
    libraries.delete(libraryName); if (!libraries.size) libraries.set("Default", []); libraryName = libraries.keys().next().value!;
    persist(); renderCatalogue(); render();
  })); catalogue.append(catalogueRow);
  const columns = el("div", "", "as-columns"); ui.body.append(catalogue, columns, status);
  type Side = "library" | "script";
  const lists = {} as Record<Side, HTMLSelectElement>;
  const getStyles = (side: Side): AssStyle[] => side === "script" ? host.getDoc().styles ?? [] : libraries.get(libraryName)!;
  const selected = (side: Side) => [...lists[side].selectedOptions].map(option => option.value);
  const getDoc = (side: Side) => side === "script" ? host.getDoc() : libraryDocument(getStyles(side));
  const commit = (side: Side, doc: SubtitleDoc) => {
    if (side === "script") host.applyDoc(doc, "样式已更新");
    else { libraries.set(libraryName, doc.styles ?? []); persist(); }
    render();
  };
  const render = () => {
    for (const side of ["library", "script"] as const) {
      const list = lists[side]; if (!list) continue;
      const names = selected(side); list.replaceChildren();
      for (const style of getStyles(side)) { const option = el("option", style.name); option.value = style.name; option.selected = names.includes(style.name); list.append(option); }
      if (!list.selectedOptions.length && list.options.length) list.options[0].selected = true;
    }
  };
  const edit = (side: Side, kind: "edit" | "new" | "copy") => {
    const doc = getDoc(side), current = doc.styles?.find(s => s.name === selected(side)[0]);
    if (kind !== "new" && !current) return;
    const draft = kind === "edit" ? current! : kind === "copy" ? { ...structuredClone(current!), name: uniqueStyleName(doc, `${current!.name} 副本`) } : makeDefaultStyle(uniqueStyleName(doc, "Default"));
    // The storage draft stays local; current-script Apply must re-read the host after it clones.
    let storageDoc = doc;
    openNativeStyleEditor({ getDoc: () => side === "script" ? host.getDoc() : storageDoc,
      onChange: () => { commit(side, side === "script" ? host.getDoc() : storageDoc); if (side === "library") storageDoc = structuredClone(getDoc(side)); },
      onRenameStyle: () => {},
    }, draft);
  };
  const move = (side: Side, direction: "top" | "up" | "down" | "bottom" | "sort") => {
    const doc = structuredClone(getDoc(side)), styles = doc.styles ?? [], names = new Set(selected(side));
    if (direction === "sort") styles.sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
    else if (direction === "top" || direction === "bottom") {
      const picked = styles.filter(s => names.has(s.name)), rest = styles.filter(s => !names.has(s.name));
      doc.styles = direction === "top" ? [...picked, ...rest] : [...rest, ...picked];
    } else if (direction === "up") { for (let i = 1; i < styles.length; i++) if (names.has(styles[i].name) && !names.has(styles[i - 1].name)) [styles[i - 1], styles[i]] = [styles[i], styles[i - 1]]; }
    else { for (let i = styles.length - 2; i >= 0; i--) if (names.has(styles[i].name) && !names.has(styles[i + 1].name)) [styles[i + 1], styles[i]] = [styles[i], styles[i + 1]]; }
    commit(side, doc);
  };
  const copyAcross = (source: Side) => {
    const target: Side = source === "library" ? "script" : "library", doc = structuredClone(getDoc(target)), names = new Set(selected(source)); doc.styles ??= [];
    const copies = getStyles(source).filter(s => names.has(s.name));
    const collisions = copies.filter(s => doc.styles!.some(existing => existing.name === s.name));
    if (collisions.length && !confirm(`目标已有同名样式：${collisions.map(s => s.name).join("、")}。覆盖这些样式？`)) return;
    for (const style of copies) { const index = doc.styles.findIndex(s => s.name === style.name); if (index < 0) doc.styles.push(structuredClone(style)); else doc.styles[index] = structuredClone(style); }
    commit(target, doc);
  };
  for (const side of ["library", "script"] as const) {
    const panel = group(side === "script" ? "当前脚本" : "样式库"), list = el("select", "", "as-list"); list.multiple = true; list.size = 12; list.setAttribute("aria-label", side === "script" ? "当前脚本样式" : "样式库样式"); lists[side] = list;
    list.addEventListener("dblclick", () => edit(side, "edit")); list.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); edit(side, "edit"); } });
    const reorder = el("div", "", "as-move"); for (const [label, direction] of [["置顶", "top"], ["上移", "up"], ["下移", "down"], ["置底", "bottom"], ["排序", "sort"]] as const) reorder.append(button(label, () => move(side, direction)));
    const actions = el("div", "", "as-actions"); actions.append(button("新建", () => edit(side, "new")), button("编辑", () => edit(side, "edit")), button("复制", () => edit(side, "copy")), button("删除", () => {
      const names = new Set(selected(side)); if (!names.size) return;
      const used = side === "script" ? host.getDoc().cues.filter(cue => names.has(cue.assFields?.Style ?? "Default")).length : 0;
      if (!confirm(`删除所选 ${names.size} 个样式？${used ? `当前有 ${used} 行引用这些样式；字幕行将保留。` : ""}`)) return;
      const doc = structuredClone(getDoc(side)); doc.styles = doc.styles?.filter(style => !names.has(style.name)); commit(side, doc);
    }));
    panel.append(list, reorder, button(side === "library" ? "复制到当前脚本 →" : "← 复制到样式库", () => copyAcross(side)), actions);
    const input = el("input"); input.type = "file"; input.accept = ".ass,.ssa,.sty,.json"; input.hidden = true;
    input.addEventListener("change", async () => {
      const file = input.files?.[0]; if (!file) return;
      try {
        if (file.size > 16 * 1024 * 1024) throw new Error("样式库文件超过 16 MiB。");
        const text = await file.text();
        const styles = parseStyleLibrary(text, file.name);
        const doc = structuredClone(getDoc(side)); doc.styles ??= [];
        for (const style of styles) { const copy = structuredClone(style); copy.name = uniqueStyleName(doc, copy.name); doc.styles.push(copy); }
        commit(side, doc); status.textContent = "";
      } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
      finally { input.value = ""; }
    });
    const fileActions = el("div", "", "as-actions"); fileActions.append(button("从文件导入…", () => input.click()), button("导出…", () => host.download(`${side === "library" ? libraryName : "script-styles"}.ass`, [serializeSubtitles(libraryDocument(getStyles(side)))], "text/plain;charset=utf-8")), input); panel.append(fileActions); columns.append(panel);
  }
  selectLibrary.addEventListener("change", () => { libraryName = selectLibrary.value; render(); }); ui.foot.append(button("关闭", ui.close)); renderCatalogue(); render();
}
