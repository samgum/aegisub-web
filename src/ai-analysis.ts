export interface AIAnalysisSettings {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  model: string;
  targetLanguage: string;
  temperature: number;
  maxTokens: number;
  thinking: boolean;
  cache: boolean;
}

const KEY = "aegisub-web.ai-analysis.v1";
let sessionApiKey = "";
const responseCache = new Map<string, string>();
const PRESETS = [
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-pro" },
  { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "deepseek/deepseek-chat-v3.1" },
  { name: "Gemini OpenAI-compatible", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3-flash-preview" },
  { name: "Alibaba Cloud Bailian", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen3.5-plus" },
  { name: "OpenAI-compatible custom", baseUrl: "https://api.openai.com/v1", model: "gpt-5.2" },
];

export function getAIAnalysisSettings(): AIAnalysisSettings {
  const fallback: AIAnalysisSettings = { enabled: false, provider: PRESETS[4].name, baseUrl: PRESETS[4].baseUrl, model: PRESETS[4].model, targetLanguage: navigator.language.startsWith("zh") ? "Chinese" : "English", temperature: .2, maxTokens: 2000, thinking: false, cache: true };
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<AIAnalysisSettings> }; } catch { return fallback; }
}

function saveSettings(settings: AIAnalysisSettings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}

const STYLE_ID = "aegisub-web-ai-analysis-style";
function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.ai-back{position:fixed;inset:0;z-index:1800;background:rgba(0,0,0,.62);display:grid;place-items:center;padding:16px}.ai-modal{width:min(760px,100%);max-height:calc(100dvh - 32px);overflow:auto;background:var(--se-bg,#1d2025);color:var(--se-fg,#e9ebef);border:1px solid var(--se-border,#373b44);border-radius:12px}.ai-head,.ai-foot{display:flex;align-items:center;gap:8px;padding:11px 14px;background:var(--se-head,#24272d);border-bottom:1px solid var(--se-border,#373b44)}.ai-foot{border-top:1px solid var(--se-border,#373b44);border-bottom:0}.ai-head h2{font-size:15px;margin:0;flex:1}.ai-body{padding:14px;display:grid;gap:10px}.ai-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ai-body label{display:grid;gap:4px;font-size:11px;color:var(--se-muted,#9aa2ae)}.ai-body input,.ai-body select,.ai-body textarea{font:inherit;padding:7px;border:1px solid var(--se-border,#373b44);border-radius:6px;background:var(--se-bg,#1d2025);color:inherit}.ai-body textarea{min-height:260px;resize:vertical}.ai-source{padding:9px;border:1px solid var(--se-border,#373b44);border-radius:7px;white-space:pre-wrap}.ai-btn{font:inherit;padding:7px 11px;border:1px solid var(--se-border,#373b44);border-radius:7px;background:var(--se-head,#24272d);color:inherit;cursor:pointer}.ai-btn.primary{background:var(--se-accent,#2563eb);border-color:var(--se-accent,#2563eb);color:#fff}.ai-status{font-size:11px;color:var(--se-muted,#9aa2ae);margin-right:auto}@media(max-width:600px){.ai-back{padding:0}.ai-modal{height:100dvh;max-height:none;border-radius:0}.ai-grid{grid-template-columns:1fr}}
`;
  document.head.append(style);
}

function button(label: string, action: () => void, primary = false): HTMLButtonElement {
  const control = document.createElement("button"); control.className = `ai-btn${primary ? " primary" : ""}`; control.textContent = label; control.addEventListener("click", action); return control;
}

function shell(title: string): { body: HTMLDivElement; foot: HTMLDivElement; close(): void } {
  injectStyles();
  const back = document.createElement("div"); back.className = "ai-back";
  const modal = document.createElement("div"); modal.className = "ai-modal";
  const head = document.createElement("div"); head.className = "ai-head";
  const heading = document.createElement("h2"); heading.textContent = title;
  const body = document.createElement("div"); body.className = "ai-body";
  const foot = document.createElement("div"); foot.className = "ai-foot";
  const close = (): void => back.remove();
  head.append(heading, button("×", close)); modal.append(head, body, foot); back.append(modal); document.body.append(back);
  return { body, foot, close };
}

function labelled(label: string, input: HTMLElement): HTMLLabelElement {
  const row = document.createElement("label"); row.append(document.createTextNode(label), input); return row;
}

export function openAIAnalysisSettings(onSaved?: () => void): void {
  const ui = shell("AI Grammar Analysis Settings");
  const settings = getAIAnalysisSettings();
  const enabled = document.createElement("input"); enabled.type = "checkbox"; enabled.checked = settings.enabled;
  const provider = document.createElement("select"); for (const preset of PRESETS) provider.append(new Option(preset.name, preset.name)); provider.value = settings.provider;
  const baseUrl = document.createElement("input"); baseUrl.value = settings.baseUrl;
  const model = document.createElement("input"); model.value = settings.model;
  const apiKey = document.createElement("input"); apiKey.type = "password"; apiKey.value = sessionApiKey; apiKey.autocomplete = "off";
  const target = document.createElement("input"); target.value = settings.targetLanguage;
  const temperature = document.createElement("input"); temperature.type = "number"; temperature.step = ".1"; temperature.min = "0"; temperature.max = "2"; temperature.value = String(settings.temperature);
  const maxTokens = document.createElement("input"); maxTokens.type = "number"; maxTokens.min = "128"; maxTokens.max = "32000"; maxTokens.value = String(settings.maxTokens);
  const thinking = document.createElement("input"); thinking.type = "checkbox"; thinking.checked = settings.thinking;
  const cache = document.createElement("input"); cache.type = "checkbox"; cache.checked = settings.cache;
  provider.addEventListener("change", () => { const preset = PRESETS.find((item) => item.name === provider.value); if (preset) { baseUrl.value = preset.baseUrl; model.value = preset.model; } });
  const grid = document.createElement("div"); grid.className = "ai-grid";
  grid.append(labelled("Provider preset", provider), labelled("Base URL", baseUrl), labelled("Model", model), labelled("API key (memory only)", apiKey), labelled("Target language", target), labelled("Temperature", temperature), labelled("Max tokens", maxTokens));
  ui.body.append(labelled("Enable AI button", enabled), grid, labelled("Enable thinking/reasoning parameters", thinking), labelled("Cache identical results this session", cache));
  ui.foot.append(document.createElement("span"), button("Cancel", ui.close), button("Save", () => {
    sessionApiKey = apiKey.value;
    saveSettings({ enabled: enabled.checked, provider: provider.value, baseUrl: baseUrl.value.trim(), model: model.value.trim(), targetLanguage: target.value.trim(), temperature: Math.max(0, Math.min(2, Number(temperature.value))), maxTokens: Math.max(128, Number(maxTokens.value)), thinking: thinking.checked, cache: cache.checked });
    onSaved?.(); ui.close();
  }, true));
}

function completionsUrl(base: string): string {
  const clean = base.replace(/\/+$/, "");
  return clean.endsWith("/chat/completions") ? clean : `${clean}/chat/completions`;
}

export function openAIAnalysis(text: string): void {
  const ui = shell("AI Grammar Analysis");
  const source = document.createElement("div"); source.className = "ai-source"; source.textContent = text;
  const target = document.createElement("input"); target.value = getAIAnalysisSettings().targetLanguage;
  const result = document.createElement("textarea"); result.readOnly = true;
  const status = document.createElement("span"); status.className = "ai-status";
  ui.body.append(labelled("Target language", target), labelled("Source", source), labelled("Analysis", result));
  const analyze = async (): Promise<void> => {
    let settings = getAIAnalysisSettings();
    if (!settings.enabled || !sessionApiKey) { openAIAnalysisSettings(() => {}); status.textContent = "Enable AI and enter an API key, then Analyze again."; return; }
    settings = { ...settings, targetLanguage: target.value };
    const cacheKey = JSON.stringify([settings.baseUrl, settings.model, settings.targetLanguage, settings.thinking, text]);
    if (settings.cache && responseCache.has(cacheKey)) { result.value = responseCache.get(cacheKey)!; return; }
    status.textContent = "Analyzing…";
    try {
      const system = "You are a professional subtitle grammar and translation assistant. Analyze only the provided subtitle line. Ignore ASS override tags. Write every heading and explanation in the requested target language. Include source meaning, grammar structure, word and phrase notes, particles or function words, nuance and tone, subtitle-localization notes, recommended translation, and optional alternatives.";
      const body: Record<string, unknown> = { model: settings.model, messages: [{ role: "system", content: system }, { role: "user", content: `Target language: ${settings.targetLanguage}\nSubtitle text:\n${text}` }], temperature: settings.temperature, max_tokens: settings.maxTokens };
      if (settings.thinking) body.reasoning_effort = "low";
      const response = await fetch(completionsUrl(settings.baseUrl), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionApiKey}` }, body: JSON.stringify(body) });
      const payload = await response.json() as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || `HTTP ${response.status}`);
      result.value = payload.choices?.[0]?.message?.content ?? JSON.stringify(payload, null, 2);
      if (settings.cache) responseCache.set(cacheKey, result.value);
      status.textContent = "Done";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  };
  ui.foot.append(status, button("Settings", () => openAIAnalysisSettings()), button("Copy All", () => void navigator.clipboard?.writeText(result.value)), button("Analyze", () => void analyze(), true), button("Close", ui.close));
}
