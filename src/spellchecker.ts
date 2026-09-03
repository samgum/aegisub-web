import { type Cue, type SubtitleDoc } from "./cue";
import type nspellType from "nspell";

type Spell = ReturnType<typeof nspellType>;
export interface SpellcheckerHost {
  getDoc(): SubtitleDoc;
  selectedCueId(): string | null;
  updateCue(id: string, text: string): void;
  selectCue(id: string): void;
}

type Occurrence = { cue: Cue; start: number; end: number; word: string };
const PERSONAL_KEY = "aegisub-web.personal-dictionary.en";
const STYLE_ID = "aegisub-web-spellchecker-style";

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style"); style.id = STYLE_ID;
  style.textContent = `
.sp-back{position:fixed;inset:0;z-index:1800;background:rgba(0,0,0,.62);display:grid;place-items:center;padding:16px}.sp-modal{width:min(700px,100%);max-height:calc(100dvh - 32px);overflow:auto;background:var(--se-bg,#1d2025);color:var(--se-fg,#e9ebef);border:1px solid var(--se-border,#373b44);border-radius:12px}.sp-head,.sp-foot{display:flex;align-items:center;gap:8px;padding:11px 14px;background:var(--se-head,#24272d);border-bottom:1px solid var(--se-border,#373b44)}.sp-foot{border-top:1px solid var(--se-border,#373b44);border-bottom:0;flex-wrap:wrap}.sp-head h2{font-size:15px;margin:0;flex:1}.sp-body{padding:14px;display:grid;grid-template-columns:1fr auto;gap:12px}.sp-main{display:grid;gap:8px}.sp-actions{display:flex;flex-direction:column;gap:6px}.sp-row{display:grid;grid-template-columns:130px 1fr;align-items:center;gap:8px;font-size:12px}.sp-modal input,.sp-modal select{font:inherit;padding:7px;border:1px solid var(--se-border,#373b44);border-radius:6px;background:var(--se-bg,#1d2025);color:inherit}.sp-suggestions{min-height:170px}.sp-btn{font:inherit;padding:7px 10px;border:1px solid var(--se-border,#373b44);border-radius:6px;background:var(--se-head,#24272d);color:inherit;cursor:pointer}.sp-status{font-size:11px;color:var(--se-muted,#9aa2ae);margin-right:auto}@media(max-width:600px){.sp-back{padding:0}.sp-modal{height:100dvh;max-height:none;border-radius:0}.sp-body{grid-template-columns:1fr}.sp-actions{display:grid;grid-template-columns:1fr 1fr}}
`;
  document.head.append(style);
}

function occurrences(doc: SubtitleDoc, skipComments: boolean, skipUppercase: boolean): Occurrence[] {
  const result: Occurrence[] = [];
  for (const cue of doc.cues) {
    if (skipComments && cue.assKind === "Comment") continue;
    const protectedRanges = [...cue.text.matchAll(/\{[^}]*\}/g)].map((match) => [match.index ?? 0, (match.index ?? 0) + match[0].length]);
    for (const match of cue.text.matchAll(/[\p{L}][\p{L}'’\-]*/gu)) {
      const start = match.index ?? 0;
      if (protectedRanges.some(([from, to]) => start >= from && start < to)) continue;
      const word = match[0];
      if (skipUppercase && word === word.toLocaleUpperCase()) continue;
      result.push({ cue, start, end: start + word.length, word });
    }
  }
  return result;
}

async function builtInEnglish(): Promise<Spell> {
  const [{ default: nspell }, aff, dic] = await Promise.all([
    import("nspell"),
    fetch(new URL("dictionaries/en.aff", document.baseURI)).then((response) => response.text()),
    fetch(new URL("dictionaries/en.dic", document.baseURI)).then((response) => response.text()),
  ]);
  const spell = nspell({ aff, dic });
  const personal = localStorage.getItem(PERSONAL_KEY);
  if (personal) spell.personal(personal);
  return spell;
}

export async function openSpellchecker(host: SpellcheckerHost): Promise<void> {
  injectStyles();
  let spell = await builtInEnglish();
  const back = document.createElement("div"); back.className = "sp-back";
  const modal = document.createElement("div"); modal.className = "sp-modal";
  const head = document.createElement("div"); head.className = "sp-head";
  const title = document.createElement("h2"); title.textContent = "Spell Checker / 拼写检查";
  const close = document.createElement("button"); close.className = "sp-btn"; close.textContent = "×"; close.addEventListener("click", () => back.remove());
  head.append(title, close);
  const body = document.createElement("div"); body.className = "sp-body";
  const main = document.createElement("div"); main.className = "sp-main";
  const actions = document.createElement("div"); actions.className = "sp-actions";
  body.append(main, actions);
  const foot = document.createElement("div"); foot.className = "sp-foot";
  modal.append(head, body, foot); back.append(modal); document.body.append(back);

  const original = document.createElement("input"); original.readOnly = true;
  const replacement = document.createElement("input");
  const suggestions = document.createElement("select"); suggestions.className = "sp-suggestions"; suggestions.size = 8;
  const skipComments = document.createElement("input"); skipComments.type = "checkbox"; skipComments.checked = true;
  const skipUpper = document.createElement("input"); skipUpper.type = "checkbox"; skipUpper.checked = true;
  const language = document.createElement("select"); language.append(new Option("English (bundled)", "en"), new Option("Custom Hunspell files…", "custom"));
  const row = (label: string, input: HTMLElement): HTMLLabelElement => { const value = document.createElement("label"); value.className = "sp-row"; value.append(document.createTextNode(label), input); return value; };
  main.append(row("Misspelled word", original), row("Replace with", replacement), row("Suggestions", suggestions), row("Language", language), row("Skip comments", skipComments), row("Ignore UPPERCASE", skipUpper));
  const status = document.createElement("span"); status.className = "sp-status"; foot.append(status);
  let ignore = new Set<string>();
  const replaceAll = new Map<string, string>();
  let current: Occurrence | null = null;
  let cursor = 0;

  const refreshSuggestion = (): void => {
    suggestions.textContent = "";
    if (!current) return;
    const values = spell.suggest(current.word).slice(0, 30);
    for (const value of values) suggestions.append(new Option(value, value));
    replacement.value = values[0] ?? current.word;
  };
  suggestions.addEventListener("change", () => { replacement.value = suggestions.value; });
  const findNext = (): void => {
    const list = occurrences(host.getDoc(), skipComments.checked, skipUpper.checked);
    for (let attempt = 0; attempt < list.length; attempt += 1) {
      const occurrence = list[(cursor + attempt) % list.length];
      if (ignore.has(occurrence.word) || spell.correct(occurrence.word)) continue;
      const automatic = replaceAll.get(occurrence.word);
      if (automatic) {
        const text = `${occurrence.cue.text.slice(0, occurrence.start)}${automatic}${occurrence.cue.text.slice(occurrence.end)}`;
        host.updateCue(occurrence.cue.id, text); cursor = (cursor + attempt + 1) % Math.max(1, list.length); continue;
      }
      current = occurrence; cursor = (cursor + attempt + 1) % Math.max(1, list.length); original.value = occurrence.word; host.selectCue(occurrence.cue.id); refreshSuggestion(); status.textContent = `Line ${host.getDoc().cues.indexOf(occurrence.cue) + 1}`; return;
    }
    current = null; original.value = replacement.value = ""; suggestions.textContent = ""; status.textContent = "Spell checking complete.";
  };
  const replace = (): void => {
    if (!current) return;
    const cue = host.getDoc().cues.find((item) => item.id === current!.cue.id); if (!cue) return;
    host.updateCue(cue.id, `${cue.text.slice(0, current.start)}${replacement.value}${cue.text.slice(current.end)}`); findNext();
  };
  const action = (label: string, handler: () => void): void => { const button = document.createElement("button"); button.className = "sp-btn"; button.textContent = label; button.addEventListener("click", handler); actions.append(button); };
  action("Replace", replace); action("Replace all", () => { if (current) replaceAll.set(current.word, replacement.value); replace(); }); action("Ignore", findNext); action("Ignore all", () => { if (current) ignore.add(current.word); findNext(); });
  action("Add to dictionary", () => { if (current) { spell.add(current.word); const words = `${localStorage.getItem(PERSONAL_KEY) ?? ""}\n${current.word}`.trim(); localStorage.setItem(PERSONAL_KEY, words); } findNext(); });
  action("Remove from dictionary", () => { if (replacement.value) spell.remove(replacement.value); findNext(); });
  language.addEventListener("change", () => {
    if (language.value !== "custom") return;
    const affInput = document.createElement("input"); affInput.type = "file"; affInput.accept = ".aff";
    affInput.addEventListener("change", () => {
      const aff = affInput.files?.[0]; if (!aff) return;
      const dicInput = document.createElement("input"); dicInput.type = "file"; dicInput.accept = ".dic";
      dicInput.addEventListener("change", async () => {
        const dic = dicInput.files?.[0]; if (!dic) return;
        const { default: nspell } = await import("nspell"); spell = nspell({ aff: await aff.text(), dic: await dic.text() }); ignore = new Set(); cursor = 0; findNext();
      });
      dicInput.click();
    });
    affInput.click();
  });
  findNext();
}
