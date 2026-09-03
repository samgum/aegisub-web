import { type SubtitleDoc } from "./cue";
import {
  DEFAULT_FIX_COMMON,
  DEFAULT_LYRICS_SCROLL,
  DEFAULT_TEXT_CLEANUP,
  annotateFurigana,
  checkPairedPunctuation,
  cleanupSubtitleText,
  convertChinese,
  estimateOverflow,
  embedAssAttachment,
  fixCommonErrors,
  generateLyricsScroll,
  listAssAttachments,
  parseKeyframeTimes,
  resampleAssDocument,
  removeAssAttachment,
  snapToKeyframes,
  stitchAdjacentTimings,
  type ToolScope,
} from "./aegisub-tools";
import { listAutomationExtensions, removeAutomationExtension, runAutomationExtension, saveAutomationExtension } from "./automation";
import { runLuaAutomation } from "./lua-automation";

export interface AegisubToolboxHost {
  getDoc(): SubtitleDoc;
  getSelectedIds(): ReadonlySet<string>;
  applyDoc(doc: SubtitleDoc, message: string): void;
  selectCue(id: string): void;
  runAegisubCommand(command: string): boolean;
}

interface LocalFontData {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  blob(): Promise<Blob>;
}

const STYLE_ID = "aegisub-web-toolbox-style";
const CSS = `
.aw-tool-back{position:fixed;inset:0;z-index:1500;background:rgba(0,0,0,.34);display:flex;align-items:center;justify-content:center;padding:18px}
.aw-toolbox{width:min(1020px,100%);height:min(760px,calc(100dvh - 36px));overflow:hidden;display:grid;grid-template-columns:210px 1fr;grid-template-rows:auto 1fr auto;background:var(--se-bg,#fff);color:var(--se-fg,#151515);border:1px solid #777;border-radius:2px;box-shadow:0 8px 30px rgba(0,0,0,.38)}
.aw-tool-head{grid-column:1/-1;display:flex;align-items:center;gap:12px;padding:7px 9px;border-bottom:1px solid var(--se-border,#aaa);background:var(--se-head,#ededed)}
.aw-tool-head h2{font-size:16px;margin:0;flex:1}.aw-tool-head p{font-size:11px;color:var(--se-muted,#9aa0ac);margin:0}
.aw-tool-nav{padding:10px;border-right:1px solid var(--se-border,#343740);display:flex;flex-direction:column;gap:4px;background:color-mix(in srgb,var(--se-head,#22252b) 68%,transparent)}
.aw-tool-nav button{font:inherit;text-align:left;color:inherit;background:transparent;border:1px solid transparent;border-radius:1px;padding:7px 8px;cursor:pointer}.aw-tool-nav button:hover{background:#e3f0ff;border-color:#9bb8d4}.aw-tool-nav button.on{background:#d7eaff;border-color:#7fa7cf;color:#111}
.aw-tool-main{overflow:auto;padding:16px}.aw-tool-page{display:none}.aw-tool-page.on{display:block}.aw-tool-page>h3{font-size:15px;margin:0 0 12px}
.aw-card{border:1px solid var(--se-border,#aaa);border-radius:1px;padding:10px;margin:0 0 10px;background:var(--se-bg,#fff)}.aw-card h4{font-size:13px;margin:0 0 5px}.aw-card>p{font-size:11px;line-height:1.45;color:var(--se-muted,#555b63);margin:0 0 10px}
.aw-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 12px}.aw-grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}.aw-field{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--se-muted,#9aa0ac)}.aw-check{display:flex;align-items:flex-start;gap:7px;font-size:12px}.aw-check input{margin-top:2px}
.aw-toolbox input[type=text],.aw-toolbox input[type=number],.aw-toolbox input[type=file],.aw-toolbox select,.aw-toolbox textarea{box-sizing:border-box;width:100%;font:inherit;font-size:12px;color:var(--se-fg,#151515);background:var(--se-bg,#fff);border:1px solid var(--se-border,#aaa);border-radius:1px;padding:5px 6px}.aw-toolbox textarea{min-height:130px;resize:vertical;font-family:ui-monospace,Consolas,monospace}
.aw-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:11px}.aw-btn{font:inherit;font-size:12px;padding:5px 10px;border:1px solid #999;border-radius:1px;background:linear-gradient(#fff,#e5e5e5);color:inherit;cursor:pointer}.aw-btn:hover{border-color:#6d91b8;background:#e3f0ff}.aw-btn.primary{background:#dbeaff;border-color:#6d91b8;color:#111}.aw-btn:disabled{opacity:.5;cursor:default}
.aw-status{font-size:11px;color:var(--se-muted,#9aa0ac);min-height:16px}.aw-results{margin-top:10px;display:flex;flex-direction:column;gap:5px;max-height:220px;overflow:auto}.aw-result{font:inherit;font-size:11px;text-align:left;color:inherit;background:transparent;border:1px solid var(--se-border,#343740);border-radius:6px;padding:7px 9px;cursor:pointer}.aw-result:hover{border-color:var(--se-accent,#5b9dff)}
.aw-tool-foot{grid-column:1/-1;padding:10px 14px;border-top:1px solid var(--se-border,#343740);display:flex;align-items:center;gap:8px}.aw-tool-foot .aw-status{flex:1}
@media(max-width:700px){.aw-tool-back{padding:0}.aw-toolbox{height:100dvh;border-radius:0;border:0;grid-template-columns:1fr;grid-template-rows:auto auto 1fr auto}.aw-tool-head p{display:none}.aw-tool-nav{border-right:0;border-bottom:1px solid var(--se-border,#343740);flex-direction:row;overflow-x:auto;padding:7px}.aw-tool-nav button{white-space:nowrap;padding:7px 9px}.aw-grid,.aw-grid.two{grid-template-columns:1fr}.aw-tool-main{padding:12px}}
`;

function injectCss(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function button(label: string, action: () => void | Promise<void>, primary = false): HTMLButtonElement {
  const control = node("button", `aw-btn${primary ? " primary" : ""}`, label);
  control.type = "button";
  control.addEventListener("click", () => void action());
  return control;
}

function checkbox(label: string, checked: boolean): { row: HTMLLabelElement; input: HTMLInputElement } {
  const row = node("label", "aw-check");
  const input = node("input");
  input.type = "checkbox";
  input.checked = checked;
  row.append(input, document.createTextNode(label));
  return { row, input };
}

function numberField(label: string, value: number, min = 0, max = 100000): { label: HTMLLabelElement; input: HTMLInputElement } {
  const field = node("label", "aw-field");
  field.append(document.createTextNode(label));
  const input = node("input");
  input.type = "number";
  input.value = String(value);
  input.min = String(min);
  input.max = String(max);
  field.append(input);
  return { label: field, input };
}

function card(title: string, description: string): HTMLDivElement {
  const result = node("div", "aw-card");
  result.append(node("h4", "", title), node("p", "", description));
  return result;
}

function scopeControl(host: AegisubToolboxHost): { label: HTMLLabelElement; value(): ToolScope | undefined } {
  const label = node("label", "aw-field");
  label.append(document.createTextNode("范围 / Scope"));
  const select = node("select");
  select.append(new Option("全部非注释行 / All dialogue", "all"));
  const selected = new Option(`选中行 / Selected (${host.getSelectedIds().size})`, "selected");
  selected.disabled = host.getSelectedIds().size === 0;
  select.append(selected);
  label.append(select);
  return {
    label,
    value: () => select.value === "selected" ? { selectedIds: new Set(host.getSelectedIds()) } : undefined,
  };
}

function reportCounts(value: Record<string, number>): string {
  return Object.entries(value).filter(([, count]) => count > 0).map(([key, count]) => `${key}: ${count}`).join(" · ") || "没有需要修改的内容 / Nothing to change";
}

export type AegisubToolPage = "qa" | "timing" | "language" | "ass" | "automation";

export function openAegisubToolbox(host: AegisubToolboxHost, initialPage: AegisubToolPage = "qa"): void {
  injectCss();
  const back = node("div", "aw-tool-back");
  const modal = node("div", "aw-toolbox");
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Aegisub tools");
  back.append(modal);

  const head = node("header", "aw-tool-head");
  const titleWrap = node("div");
  titleWrap.append(node("h2", "", "工具 / Tools"));
  const closeTop = button("关闭 / Close", () => close());
  head.append(titleWrap, closeTop);

  const nav = node("nav", "aw-tool-nav");
  const main = node("main", "aw-tool-main");
  const footer = node("footer", "aw-tool-foot");
  footer.append(node("span"), button("完成 / Done", () => close(), true));
  modal.append(head, nav, main, footer);

  const pages: { key: AegisubToolPage; label: string; page: HTMLElement }[] = [];
  const addPage = (key: AegisubToolPage, label: string, heading: string): HTMLElement => {
    const page = node("section", "aw-tool-page");
    page.dataset.page = key;
    page.append(node("h3", "", heading));
    main.append(page);
    pages.push({ key, label, page });
    return page;
  };

  const qa = addPage("qa", "检查与修复", "检查与修复 / Quality & repair");
  const timing = addPage("timing", "时间轴", "时间轴 / Timing");
  const language = addPage("language", "文字与语言", "文字与语言 / Text & language");
  const ass = addPage("ass", "ASS 与歌词", "ASS 与歌词 / ASS & lyrics");
  const automation = addPage("automation", "自动化扩展", "自动化扩展 / Automation");

  let active: AegisubToolPage = initialPage;
  const show = (key: AegisubToolPage): void => {
    active = key;
    for (const item of pages) item.page.classList.toggle("on", item.key === key);
    for (const control of nav.querySelectorAll("button")) control.classList.toggle("on", (control as HTMLElement).dataset.page === key);
  };
  for (const item of pages) {
    const control = node("button", "", item.label);
    control.type = "button";
    control.dataset.page = item.key;
    control.addEventListener("click", () => show(item.key));
    nav.append(control);
  }

  // Quality: common fixes.
  const fixCard = card("修复常见错误 / Fix common errors", "与桌面版 SGMY 工具一致：每项独立启用，阈值可调。注释行不会被修改。");
  const fixScope = scopeControl(host);
  const overlap = checkbox("裁掉重叠时间 / Trim overlaps", DEFAULT_FIX_COMMON.overlaps);
  const gaps = checkbox("建立最小间隔 / Fix short gaps", DEFAULT_FIX_COMMON.shortGaps);
  const short = checkbox("延长过短字幕 / Extend short durations", DEFAULT_FIX_COMMON.shortDurations);
  const long = checkbox("缩短过长字幕 / Trim long durations", DEFAULT_FIX_COMMON.longDurations);
  const empty = checkbox("删除空白行 / Remove empty lines", DEFAULT_FIX_COMMON.removeEmpty);
  const trailing = checkbox("移除末尾空白 / Strip trailing whitespace", DEFAULT_FIX_COMMON.trimTrailingWhitespace);
  const gapMs = numberField("最小间隔 ms", DEFAULT_FIX_COMMON.minGapMs, 0, 2000);
  const minDuration = numberField("最短时长 ms", DEFAULT_FIX_COMMON.minDurationMs, 100, 10000);
  const maxDuration = numberField("最长时长 ms", DEFAULT_FIX_COMMON.maxDurationMs, 1000, 60000);
  const fixChecks = node("div", "aw-grid two");
  fixChecks.append(overlap.row, gaps.row, short.row, long.row, empty.row, trailing.row);
  const fixFields = node("div", "aw-grid");
  fixFields.append(fixScope.label, gapMs.label, minDuration.label, maxDuration.label);
  const fixStatus = node("span", "aw-status");
  const fixActions = node("div", "aw-actions");
  fixActions.append(button("执行修复 / Apply", () => {
    const result = fixCommonErrors(host.getDoc(), {
      overlaps: overlap.input.checked,
      shortGaps: gaps.input.checked,
      shortDurations: short.input.checked,
      longDurations: long.input.checked,
      removeEmpty: empty.input.checked,
      trimTrailingWhitespace: trailing.input.checked,
      minGapMs: Number(gapMs.input.value),
      minDurationMs: Number(minDuration.input.value),
      maxDurationMs: Number(maxDuration.input.value),
    }, fixScope.value());
    const message = reportCounts(result.report as unknown as Record<string, number>);
    host.applyDoc(result.doc, message);
    fixStatus.textContent = message;
  }, true), fixStatus);
  fixCard.append(fixChecks, fixFields, fixActions);
  qa.append(fixCard);

  const pairCard = card("标点与溢出检查 / Punctuation & overflow", "检查成对标点，并按脚本分辨率、样式字号与边距估算横向溢出。结果可点击跳转。");
  const pairScope = scopeControl(host);
  const results = node("div", "aw-results");
  const pairStatus = node("span", "aw-status");
  const pairActions = node("div", "aw-actions");
  pairActions.append(pairScope.label, button("检查 / Scan", () => {
    results.textContent = "";
    const punctuation = checkPairedPunctuation(host.getDoc(), pairScope.value());
    const overflow = estimateOverflow(host.getDoc()).filter((issue) => !pairScope.value()?.selectedIds || pairScope.value()?.selectedIds?.has(issue.cueId));
    for (const issue of punctuation) {
      const row = node("button", "aw-result", `#${issue.cueIndex + 1} · ${issue.message}`);
      row.type = "button";
      row.addEventListener("click", () => host.selectCue(issue.cueId));
      results.append(row);
    }
    for (const issue of overflow) {
      const row = node("button", "aw-result", `#${issue.cueIndex + 1} · estimated ${Math.round(issue.estimatedWidth)}px > ${Math.round(issue.availableWidth)}px`);
      row.type = "button";
      row.addEventListener("click", () => host.selectCue(issue.cueId));
      results.append(row);
    }
    pairStatus.textContent = `${punctuation.length} punctuation · ${overflow.length} overflow`;
  }), pairStatus);
  pairCard.append(pairActions, results);
  qa.append(pairCard);

  // Timing tools.
  const stitchCard = card("拼接相邻时间 / Stitch timings", "当相邻字幕的边界距离在阈值内时，将结束与开始对齐到中点。");
  const stitchScope = scopeControl(host);
  const stitchDistance = numberField("最大距离 ms", 150, 0, 2000);
  const stitchStatus = node("span", "aw-status");
  const stitchActions = node("div", "aw-actions");
  stitchActions.append(stitchScope.label, stitchDistance.label, button("拼接 / Stitch", () => {
    const result = stitchAdjacentTimings(host.getDoc(), Number(stitchDistance.input.value), stitchScope.value());
    const message = `stitched: ${result.report.stitched}`;
    host.applyDoc(result.doc, message);
    stitchStatus.textContent = message;
  }, true), stitchStatus);
  stitchCard.append(stitchActions);
  timing.append(stitchCard);

  const keyCard = card("关键帧吸附 / Snap to keyframes", "导入 Aegisub keyframes v1 或 timecodes v2 文本，将开始/结束吸附到阈值内最近帧。");
  const keyScope = scopeControl(host);
  const keyFile = node("input");
  keyFile.type = "file";
  keyFile.accept = ".txt,.log,.keyframes";
  const keyFps = numberField("FPS", 23.976, 1, 240);
  keyFps.input.step = "0.001";
  const keyThreshold = numberField("吸附阈值 ms", 120, 0, 2000);
  const keyStatus = node("span", "aw-status");
  const keyFields = node("div", "aw-grid");
  const keyFileLabel = node("label", "aw-field");
  keyFileLabel.append(document.createTextNode("关键帧文件"), keyFile);
  keyFields.append(keyScope.label, keyFileLabel, keyFps.label, keyThreshold.label);
  const keyActions = node("div", "aw-actions");
  keyActions.append(button("导入并吸附 / Import & snap", async () => {
    const file = keyFile.files?.[0];
    if (!file) {
      keyStatus.textContent = "请选择关键帧文件 / Choose a keyframe file";
      return;
    }
    const times = parseKeyframeTimes(await file.text(), Number(keyFps.input.value));
    const result = snapToKeyframes(host.getDoc(), times, Number(keyThreshold.input.value), keyScope.value());
    const message = `${times.length} keyframes · starts ${result.snappedStarts} · ends ${result.snappedEnds}`;
    host.applyDoc(result.doc, message);
    keyStatus.textContent = message;
  }, true), keyStatus);
  keyCard.append(keyFields, keyActions);
  timing.append(keyCard);

  // Text and language tools.
  const cleanupCard = card("字幕文字清理 / Text cleanup", "保留 ASS 覆盖标签和 VTT/HTML 标签，只修改可见文字。");
  const cleanupScope = scopeControl(host);
  const commas = checkbox("全角逗号转空格 / Fullwidth commas", DEFAULT_TEXT_CLEANUP.replaceFullwidthCommas);
  const periods = checkbox("清理全角句号 / Fullwidth periods", DEFAULT_TEXT_CLEANUP.cleanFullwidthPeriods);
  const quotes = checkbox("弯引号转直引号 / Smart quotes", DEFAULT_TEXT_CLEANUP.replaceSmartQuotes);
  const spaces = checkbox("合并连续空格 / Double spaces", DEFAULT_TEXT_CLEANUP.collapseDoubleSpaces);
  const cleanupChecks = node("div", "aw-grid two");
  cleanupChecks.append(commas.row, periods.row, quotes.row, spaces.row);
  const cleanupStatus = node("span", "aw-status");
  const cleanupActions = node("div", "aw-actions");
  cleanupActions.append(cleanupScope.label, button("清理 / Clean", () => {
    const result = cleanupSubtitleText(host.getDoc(), {
      replaceFullwidthCommas: commas.input.checked,
      cleanFullwidthPeriods: periods.input.checked,
      replaceSmartQuotes: quotes.input.checked,
      collapseDoubleSpaces: spaces.input.checked,
    }, cleanupScope.value());
    const message = reportCounts(result.report as unknown as Record<string, number>);
    host.applyDoc(result.doc, message);
    cleanupStatus.textContent = message;
  }, true), cleanupStatus);
  cleanupCard.append(cleanupChecks, cleanupActions);
  language.append(cleanupCard);

  const chineseCard = card("简繁转换 / Chinese conversion", "使用浏览器内置打包的 OpenCC 词典，只转换可见文字，不上传内容。");
  const chineseScope = scopeControl(host);
  const directionLabel = node("label", "aw-field");
  directionLabel.append(document.createTextNode("方向 / Direction"));
  const direction = node("select");
  direction.append(new Option("转为繁体 / To Traditional", "traditional"), new Option("转为简体 / To Simplified", "simplified"));
  directionLabel.append(direction);
  const chineseStatus = node("span", "aw-status");
  const chineseActions = node("div", "aw-actions");
  chineseActions.append(chineseScope.label, directionLabel, button("转换 / Convert", async () => {
    chineseStatus.textContent = "转换中… / Converting…";
    try {
      const result = await convertChinese(host.getDoc(), direction.value as "simplified" | "traditional", chineseScope.value());
      const message = `changed lines: ${result.changedLines}`;
      host.applyDoc(result.doc, message);
      chineseStatus.textContent = message;
    } catch (error) {
      chineseStatus.textContent = error instanceof Error ? error.message : String(error);
    }
  }, true), chineseStatus);
  chineseCard.append(chineseActions);
  language.append(chineseCard);

  const furiganaCard = card("日语注音 / Japanese furigana", "输入“汉字=读音”，为每个匹配词生成独立、可继续拖动编辑的 libass 兼容 ASS 注音事件。原字幕文字保持不变。");
  const furiganaScope = scopeControl(host);
  const readingsLabel = node("label", "aw-field");
  readingsLabel.append(document.createTextNode("词语与读音（每行一条）"));
  const readings = node("textarea");
  readings.placeholder = "東京=とうきょう\n音楽=おんがく";
  readingsLabel.append(readings);
  const placementLabel = node("label", "aw-field");
  placementLabel.append(document.createTextNode("位置 / Placement"));
  const placement = node("select");
  placement.append(new Option("上方 / Above", "above"), new Option("下方 / Below", "below"));
  placementLabel.append(placement);
  const furiganaSize = numberField("读音字号比例 %", 50, 20, 100);
  const replaceFurigana = checkbox("先移除已有 Aegisub Web 注音 / Replace existing generated ruby", true);
  const furiganaFields = node("div", "aw-grid");
  furiganaFields.append(furiganaScope.label, placementLabel, furiganaSize.label);
  const furiganaStatus = node("span", "aw-status");
  const furiganaActions = node("div", "aw-actions");
  furiganaActions.append(button("生成注音 / Annotate", () => {
    const entries = readings.value.split(/\r?\n/).map((line) => {
      const separator = line.indexOf("=");
      return separator < 0 ? { base: "", reading: "" } : { base: line.slice(0, separator), reading: line.slice(separator + 1) };
    }).filter((entry) => entry.base.trim() && entry.reading.trim());
    if (!entries.length) {
      furiganaStatus.textContent = "请输入至少一条“汉字=读音” / Add at least one mapping";
      return;
    }
    const result = annotateFurigana(host.getDoc(), {
      entries,
      above: placement.value === "above",
      sizePercent: Number(furiganaSize.input.value),
      removeExisting: replaceFurigana.input.checked,
    }, furiganaScope.value());
    const message = `furigana annotations: ${result.annotations}`;
    host.applyDoc(result.doc, message);
    furiganaStatus.textContent = message;
  }, true), furiganaStatus);
  furiganaCard.append(readingsLabel, furiganaFields, replaceFurigana.row, furiganaActions);
  language.append(furiganaCard);

  // ASS tools.
  const attachmentCard = card("附件与字体收集 / Attachments & fonts", "列出 ASS 内嵌附件；可上传字体，或在支持 Local Font Access 的 Chromium 浏览器中收集当前样式实际使用的本机字体。Safari/Firefox 使用上传方式。");
  const attachmentFiles = node("input");
  attachmentFiles.type = "file";
  attachmentFiles.multiple = true;
  attachmentFiles.accept = ".ttf,.otf,.ttc,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2";
  const attachmentStatus = node("span", "aw-status");
  const attachmentResults = node("div", "aw-results");
  const refreshAttachments = (): void => {
    attachmentResults.textContent = "";
    const attachments = listAssAttachments(host.getDoc());
    if (!attachments.length) attachmentResults.append(node("div", "aw-status", "没有内嵌附件 / No embedded attachments"));
    for (const attachment of attachments) {
      const row = node("div", "aw-result");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "8px";
      const label = node("span", "", `${attachment.kind === "font" ? "Font" : "Graphic"} · ${attachment.name} · ~${Math.max(1, Math.round(attachment.approximateBytes / 1024))} KiB`);
      label.style.flex = "1";
      const remove = button("移除 / Remove", () => {
        const doc = removeAssAttachment(host.getDoc(), attachment.name, attachment.kind);
        host.applyDoc(doc, `removed attachment: ${attachment.name}`);
        refreshAttachments();
      });
      row.append(label, remove);
      attachmentResults.append(row);
    }
  };
  const embedFiles = async (files: { name: string; blob: Blob }[]): Promise<void> => {
    let doc = host.getDoc();
    let embedded = 0;
    for (const file of files) {
      if (file.blob.size > 64 * 1024 * 1024) continue;
      doc = embedAssAttachment(doc, file.name, new Uint8Array(await file.blob.arrayBuffer()), "font");
      embedded += 1;
    }
    if (embedded) host.applyDoc(doc, `embedded fonts: ${embedded}`);
    attachmentStatus.textContent = embedded ? `embedded fonts: ${embedded}` : "没有可嵌入字体 / No fonts embedded";
    refreshAttachments();
  };
  const attachmentActions = node("div", "aw-actions");
  attachmentActions.append(attachmentFiles, button("嵌入所选字体 / Embed files", async () => {
    await embedFiles([...(attachmentFiles.files ?? [])].map((file) => ({ name: file.name, blob: file })));
    attachmentFiles.value = "";
  }, true), button("收集已用本机字体 / Collect used local fonts", async () => {
    const query = (window as unknown as { queryLocalFonts?: () => Promise<LocalFontData[]> }).queryLocalFonts;
    if (!query) {
      attachmentStatus.textContent = "当前浏览器不支持本机字体访问，请手动选择字体文件。";
      return;
    }
    attachmentStatus.textContent = "正在请求本机字体权限…";
    try {
      const fonts = await query.call(window);
      const used = new Set((host.getDoc().styles ?? []).map((style) => (style.fields.Fontname ?? "").trim().toLowerCase()).filter(Boolean));
      const chosen = fonts.filter((font) => used.has(font.family.trim().toLowerCase()));
      const unique = new Map<string, LocalFontData>();
      for (const font of chosen) unique.set(font.postscriptName || font.fullName, font);
      await embedFiles(await Promise.all([...unique.values()].map(async (font) => ({
        name: `${(font.postscriptName || font.fullName).replace(/[^\p{L}\p{N}_.-]+/gu, "_")}.ttf`,
        blob: await font.blob(),
      }))));
    } catch (error) {
      attachmentStatus.textContent = error instanceof Error ? error.message : String(error);
    }
  }), attachmentStatus);
  attachmentCard.append(attachmentActions, attachmentResults);
  ass.append(attachmentCard);
  refreshAttachments();

  const resampleCard = card("重采样分辨率 / Resample resolution", "缩放 PlayRes、样式字号/边距/描边以及 pos、move、clip 等坐标。非 ASS 文档会先转换为 ASS。");
  const width = numberField("宽 / Width", 1920, 16, 16384);
  const height = numberField("高 / Height", 1080, 16, 16384);
  const resampleStatus = node("span", "aw-status");
  const resampleFields = node("div", "aw-grid two");
  resampleFields.append(width.label, height.label);
  const resampleActions = node("div", "aw-actions");
  resampleActions.append(button("重采样 / Resample", () => {
    const result = resampleAssDocument(host.getDoc(), Number(width.input.value), Number(height.input.value));
    const message = `${result.from.x}×${result.from.y} → ${result.to.x}×${result.to.y}`;
    host.applyDoc(result.doc, message);
    resampleStatus.textContent = message;
  }, true), resampleStatus);
  resampleCard.append(resampleFields, resampleActions);
  ass.append(resampleCard);

  const lyricsCard = card("滚动歌词生成器 / Lyrics scroll generator", "按现有字幕时间生成音乐播放器式 ASS 堆叠滚动项目；会替换当前轨道中的事件，请使用撤销恢复。");
  const lyricWidth = numberField("宽", DEFAULT_LYRICS_SCROLL.width, 16, 16384);
  const lyricHeight = numberField("高", DEFAULT_LYRICS_SCROLL.height, 16, 16384);
  const lyricY = numberField("当前行 Y", DEFAULT_LYRICS_SCROLL.currentY, 0, 16384);
  const lyricGap = numberField("行距", DEFAULT_LYRICS_SCROLL.lineGap, 1, 1000);
  const lyricBefore = numberField("上方行数", DEFAULT_LYRICS_SCROLL.before, 0, 10);
  const lyricAfter = numberField("下方行数", DEFAULT_LYRICS_SCROLL.after, 0, 10);
  const lyricTransition = numberField("滚动过渡 ms", DEFAULT_LYRICS_SCROLL.transitionMs, 0, 5000);
  const lyricCurrentSize = numberField("当前字号", DEFAULT_LYRICS_SCROLL.currentFontSize, 1, 1000);
  const lyricOtherSize = numberField("其他字号", DEFAULT_LYRICS_SCROLL.otherFontSize, 1, 1000);
  const lyricFields = node("div", "aw-grid");
  lyricFields.append(lyricWidth.label, lyricHeight.label, lyricY.label, lyricGap.label, lyricBefore.label, lyricAfter.label, lyricTransition.label, lyricCurrentSize.label, lyricOtherSize.label);
  const lyricStatus = node("span", "aw-status");
  const lyricActions = node("div", "aw-actions");
  lyricActions.append(button("生成滚动项目 / Generate", () => {
    const doc = generateLyricsScroll(host.getDoc(), {
      width: Number(lyricWidth.input.value), height: Number(lyricHeight.input.value), currentY: Number(lyricY.input.value),
      lineGap: Number(lyricGap.input.value), before: Number(lyricBefore.input.value), after: Number(lyricAfter.input.value),
      transitionMs: Number(lyricTransition.input.value), currentFontSize: Number(lyricCurrentSize.input.value), otherFontSize: Number(lyricOtherSize.input.value),
    });
    const message = `generated events: ${doc.cues.length}`;
    host.applyDoc(doc, message);
    lyricStatus.textContent = message;
  }, true), lyricStatus);
  lyricsCard.append(lyricFields, lyricActions);
  ass.append(lyricsCard);

  // Automation extension bridge.
  const extensionCard = card("JavaScript 自动化桥 / JavaScript automation bridge", "浏览器不能直接运行桌面版 LuaJIT/Automation 4 脚本。这里提供隔离 Worker 扩展：显式选择本地 .js 文件后运行，15 秒超时并校验返回文档。");
  const extensionFile = node("input");
  extensionFile.type = "file";
  extensionFile.accept = ".js,.aegisub-web.js,.lua";
  const extensionStatus = node("span", "aw-status");
  const saveExtension = checkbox("保存到本机扩展库 / Save in local registry", true);
  const autoloadExtension = checkbox("标记为自动加载 / Autoload", false);
  const extensionList = node("div", "aw-results");
  const refreshExtensionList = (): void => {
    extensionList.textContent = "";
    const stored = listAutomationExtensions();
    if (!stored.length) extensionList.append(node("div", "aw-status", "没有已保存扩展 / No saved extensions"));
    for (const extension of stored) {
      const row = node("div", "aw-result");
      row.style.display = "flex";
      row.style.gap = "8px";
      const label = node("span", "", `${extension.autoload ? "Auto · " : ""}${extension.name}`);
      label.style.flex = "1";
      const runStored = button("Run", async () => {
        if (extension.language === "lua") host.applyDoc(await runLuaAutomation(extension.code, host.getDoc(), [...host.getSelectedIds()], null).done, `Lua Automation ${extension.name} completed`);
        else {
          const result = await runAutomationExtension(extension.code, host.getDoc());
          host.applyDoc(result.doc, result.message ?? `Extension ${extension.name} completed`);
        }
      });
      const removeStored = button("Remove", () => { removeAutomationExtension(extension.name); refreshExtensionList(); });
      row.append(label, runStored, removeStored);
      extensionList.append(row);
    }
  };
  const extensionActions = node("div", "aw-actions");
  extensionActions.append(extensionFile, button("运行扩展 / Run extension", async () => {
    const file = extensionFile.files?.[0];
    if (!file) {
      extensionStatus.textContent = "请选择扩展文件 / Choose an extension file";
      return;
    }
    extensionStatus.textContent = "运行中… / Running…";
    try {
      const code = await file.text();
      const language = /\.lua$/i.test(file.name) ? "lua" : "javascript";
      if (saveExtension.input.checked) saveAutomationExtension({ name: file.name, code, autoload: autoloadExtension.input.checked, language, updatedAt: Date.now() });
      if (language === "lua") {
        const doc = await runLuaAutomation(code, host.getDoc(), [...host.getSelectedIds()], null).done;
        host.applyDoc(doc, `Lua Automation ${file.name} completed`);
        extensionStatus.textContent = "Lua Automation completed";
      } else {
        const result = await runAutomationExtension(code, host.getDoc());
        host.applyDoc(result.doc, result.message ?? `Extension ${file.name} completed`);
        extensionStatus.textContent = result.message ?? "完成 / Done";
      }
      refreshExtensionList();
    } catch (error) {
      extensionStatus.textContent = error instanceof Error ? error.message : String(error);
    }
  }, true), extensionStatus);
  extensionCard.append(saveExtension.row, autoloadExtension.row, extensionActions, extensionList);
  automation.append(extensionCard);
  refreshExtensionList();

  const apiCard = card("扩展 API", "扩展使用 CommonJS 形式导出 run(doc, api)，必须返回 SubtitleDoc 或 { doc, message }。扩展在 Worker 中运行，无法访问页面 DOM。");
  const example = node("textarea");
  example.readOnly = true;
  example.value = `module.exports.run = (doc, api) => {\n  for (const cue of doc.cues) {\n    if (cue.assKind !== "Comment") cue.text = cue.text.trim();\n  }\n  return { doc, message: "Trimmed all dialogue lines" };\n};`;
  apiCard.append(example);
  automation.append(apiCard);

  const close = (): void => {
    document.removeEventListener("keydown", onKeydown, true);
    back.remove();
  };
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };
  document.addEventListener("keydown", onKeydown, true);
  back.addEventListener("mousedown", (event) => {
    if (event.target === back) close();
  });
  document.body.append(back);
  show(active);
  closeTop.focus();
}
