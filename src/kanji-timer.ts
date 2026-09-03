import { type Cue, type SubtitleDoc } from "./cue";
import { parseKaraokeSyllables, type KaraokeSyllable } from "./aegisub-operations";

export interface KanjiTimerHost {
  getDoc(): SubtitleDoc;
  updateCue(id: string, text: string): void;
  selectCue(id: string): void;
}

type Match = { source: KaraokeSyllable[]; destination: string };

const STYLE_ID = "aegisub-web-kanji-style";
function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.kt-back{position:fixed;inset:0;z-index:1750;background:rgba(0,0,0,.62);display:grid;place-items:center;padding:16px}.kt-modal{width:min(900px,100%);max-height:calc(100dvh - 32px);overflow:auto;background:var(--se-bg,#1d2025);color:var(--se-fg,#e9ebef);border:1px solid var(--se-border,#373b44);border-radius:12px}.kt-head,.kt-foot{display:flex;align-items:center;gap:8px;padding:11px 14px;background:var(--se-head,#24272d);border-bottom:1px solid var(--se-border,#373b44)}.kt-foot{border-top:1px solid var(--se-border,#373b44);border-bottom:0;flex-wrap:wrap}.kt-head h2{font-size:15px;margin:0;flex:1}.kt-body{padding:14px;display:grid;gap:12px}.kt-styles{display:grid;grid-template-columns:1fr 1fr;gap:10px}.kt-body select{font:inherit;padding:7px;border:1px solid var(--se-border,#373b44);border-radius:6px;background:var(--se-bg,#1d2025);color:inherit}.kt-match{display:grid;gap:8px;padding:12px;border:1px solid var(--se-border,#373b44);border-radius:8px}.kt-line{display:flex;gap:4px;flex-wrap:wrap;min-height:42px}.kt-token{padding:5px 7px;border-radius:5px;background:var(--se-head,#24272d);border:1px solid var(--se-border,#373b44)}.kt-token.current{background:var(--se-accent,#2563eb);color:#fff}.kt-token.done{opacity:.5}.kt-btn{font:inherit;padding:7px 10px;border:1px solid var(--se-border,#373b44);border-radius:6px;background:var(--se-head,#24272d);color:inherit;cursor:pointer}.kt-btn.primary{background:var(--se-accent,#2563eb);border-color:var(--se-accent,#2563eb);color:#fff}.kt-status{font-size:11px;color:var(--se-muted,#9aa2ae);margin-right:auto}@media(max-width:600px){.kt-back{padding:0}.kt-modal{height:100dvh;max-height:none;border-radius:0}.kt-styles{grid-template-columns:1fr}}
`;
  document.head.append(style);
}

const graphemes = (text: string): string[] => {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: "grapheme" }) => { segment(value: string): Iterable<{ segment: string }> } }).Segmenter;
  return Segmenter ? [...new Segmenter("ja", { granularity: "grapheme" }).segment(text)].map((item) => item.segment) : [...text];
};

export function openKanjiTimer(host: KanjiTimerHost): void {
  injectStyles();
  const back = document.createElement("div"); back.className = "kt-back";
  const modal = document.createElement("div"); modal.className = "kt-modal";
  const head = document.createElement("div"); head.className = "kt-head";
  const title = document.createElement("h2"); title.textContent = "Kanji Timer / 汉字计时器";
  const close = document.createElement("button"); close.className = "kt-btn"; close.textContent = "×";
  head.append(title, close);
  const body = document.createElement("div"); body.className = "kt-body";
  const foot = document.createElement("div"); foot.className = "kt-foot";
  modal.append(head, body, foot); back.append(modal); document.body.append(back);
  const finish = (): void => back.remove(); close.addEventListener("click", finish);

  const styleNames = (host.getDoc().styles ?? []).map((style) => style.name);
  const sourceStyle = document.createElement("select");
  const destinationStyle = document.createElement("select");
  for (const name of styleNames) { sourceStyle.append(new Option(`Source: ${name}`, name)); destinationStyle.append(new Option(`Destination: ${name}`, name)); }
  if (styleNames.length > 1) destinationStyle.selectedIndex = 1;
  const styles = document.createElement("div"); styles.className = "kt-styles"; styles.append(sourceStyle, destinationStyle);
  const interpolate = document.createElement("label");
  const interpolateInput = document.createElement("input"); interpolateInput.type = "checkbox"; interpolateInput.checked = true;
  interpolate.append(interpolateInput, document.createTextNode(" Attempt to interpolate matches"));
  const matchBox = document.createElement("div"); matchBox.className = "kt-match";
  const sourceLine = document.createElement("div"); sourceLine.className = "kt-line";
  const destinationLine = document.createElement("div"); destinationLine.className = "kt-line";
  matchBox.append(sourceLine, destinationLine);
  body.append(styles, interpolate, matchBox);

  let sources: Cue[] = [];
  let destinations: Cue[] = [];
  let lineIndex = 0;
  let syllables: KaraokeSyllable[] = [];
  let destinationChars: string[] = [];
  let sourceIndex = 0;
  let destinationIndex = 0;
  let sourceLength = 1;
  let destinationLength = 1;
  let matches: Match[] = [];
  const status = document.createElement("span"); status.className = "kt-status";

  const render = (): void => {
    sourceLine.textContent = ""; destinationLine.textContent = "";
    syllables.forEach((syllable, index) => {
      const token = document.createElement("span"); token.className = `kt-token${index < sourceIndex ? " done" : index < sourceIndex + sourceLength ? " current" : ""}`; token.textContent = `${syllable.text} (${syllable.durationCs})`; sourceLine.append(token);
    });
    destinationChars.forEach((character, index) => {
      const token = document.createElement("span"); token.className = `kt-token${index < destinationIndex ? " done" : index < destinationIndex + destinationLength ? " current" : ""}`; token.textContent = character; destinationLine.append(token);
    });
    status.textContent = sources[lineIndex] && destinations[lineIndex] ? `${lineIndex + 1}/${Math.min(sources.length, destinations.length)} · source left ${syllables.length - sourceIndex} · destination left ${destinationChars.length - destinationIndex}` : "Choose styles and Start";
  };
  const resetLine = (): void => {
    const source = sources[lineIndex]; const destination = destinations[lineIndex];
    if (!source || !destination) { syllables = []; destinationChars = []; render(); return; }
    syllables = parseKaraokeSyllables(source.text);
    destinationChars = graphemes(destination.text.replace(/\{[^}]*\}/g, "").replace(/\\N/g, " "));
    sourceIndex = destinationIndex = 0; sourceLength = destinationLength = 1; matches = [];
    host.selectCue(destination.id);
    if (interpolateInput.checked && syllables.length && destinationChars.length) {
      sourceLength = 1;
      destinationLength = Math.max(1, Math.round(destinationChars.length / syllables.length));
    }
    render();
  };
  const start = (): void => {
    if (sourceStyle.value === destinationStyle.value) { status.textContent = "Source and destination styles must differ."; return; }
    sources = host.getDoc().cues.filter((cue) => cue.assFields?.Style === sourceStyle.value && parseKaraokeSyllables(cue.text).length);
    destinations = host.getDoc().cues.filter((cue) => cue.assFields?.Style === destinationStyle.value);
    lineIndex = 0; resetLine();
  };
  const link = (): void => {
    if (!syllables.length || sourceIndex >= syllables.length || destinationIndex >= destinationChars.length) return;
    const src = syllables.slice(sourceIndex, sourceIndex + sourceLength);
    const dst = destinationChars.slice(destinationIndex, destinationIndex + destinationLength).join("");
    if (!src.length && !dst) return;
    matches.push({ source: src, destination: dst });
    sourceIndex += src.length; destinationIndex += destinationLength;
    sourceLength = Math.min(1, syllables.length - sourceIndex); destinationLength = Math.min(1, destinationChars.length - destinationIndex);
    if (interpolateInput.checked && syllables.length - sourceIndex > 0) destinationLength = Math.max(1, Math.round((destinationChars.length - destinationIndex) / (syllables.length - sourceIndex)));
    render();
  };
  const unlink = (): void => {
    const match = matches.pop(); if (!match) return;
    sourceIndex -= match.source.length; destinationIndex -= graphemes(match.destination).length;
    sourceLength = match.source.length; destinationLength = graphemes(match.destination).length; render();
  };
  const accept = (): void => {
    while (sourceIndex < syllables.length && destinationIndex < destinationChars.length) link();
    if (sourceIndex < syllables.length) {
      matches.push({ source: syllables.slice(sourceIndex), destination: "" });
      sourceIndex = syllables.length;
    }
    if (destinationIndex < destinationChars.length) {
      const tail = destinationChars.slice(destinationIndex).join("");
      if (matches.length) matches[matches.length - 1].destination += tail;
      destinationIndex = destinationChars.length;
    }
    const destination = destinations[lineIndex]; if (!destination) return;
    const text = matches.map((match) => `{\\k${match.source.reduce((sum, syllable) => sum + syllable.durationCs, 0)}}${match.destination}`).join("");
    host.updateCue(destination.id, text);
    lineIndex += 1; resetLine();
  };
  const control = (label: string, action: () => void, primary = false): HTMLButtonElement => {
    const button = document.createElement("button"); button.className = `kt-btn${primary ? " primary" : ""}`; button.textContent = label; button.addEventListener("click", action); return button;
  };
  foot.append(status, control("Start", start), control("Link", link), control("Unlink", unlink), control("Source +", () => { sourceLength = Math.min(syllables.length - sourceIndex, sourceLength + 1); render(); }), control("Source −", () => { sourceLength = Math.max(0, sourceLength - 1); render(); }), control("Dest +", () => { destinationLength = Math.min(destinationChars.length - destinationIndex, destinationLength + 1); render(); }), control("Dest −", () => { destinationLength = Math.max(0, destinationLength - 1); render(); }), control("Back line", () => { lineIndex = Math.max(0, lineIndex - 1); resetLine(); }), control("Accept line", accept, true));
  back.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight") { destinationLength = Math.min(destinationChars.length - destinationIndex, destinationLength + 1); render(); }
    if (event.key === "ArrowLeft") { destinationLength = Math.max(0, destinationLength - 1); render(); }
    if (event.key === "ArrowUp") { sourceLength = Math.min(syllables.length - sourceIndex, sourceLength + 1); render(); }
    if (event.key === "ArrowDown") { sourceLength = Math.max(0, sourceLength - 1); render(); }
    if (event.key === "Enter") link();
    if (event.key === "Backspace") unlink();
  });
  render();
}
