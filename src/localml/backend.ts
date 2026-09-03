// Vendored from hikashop-nicolas/localml (MIT), commit
// f05924cba88680afe79306e66bf223cfca672016. Kept local so Windows and Pages builds do
// not depend on npm's platform-sensitive Git-package preparation step.

export type DtypeSpec = string | Record<string, string>;

export type TranscribeProgress =
  | { stage: "download"; ratio: number; file?: string }
  | { stage: "translate"; ratio: number };

export interface TranslateModelInfo {
  id: string;
  label: string;
  sizeMb: number;
  descKey: string;
  scheme: "iso" | "flores";
  dtype: { webgpu: DtypeSpec; wasm: DtypeSpec };
}

export const TRANSLATE_MODELS: TranslateModelInfo[] = [
  {
    id: "Xenova/m2m100_418M",
    label: "M2M-100",
    sizeMb: 500,
    descKey: "mtDescM2m",
    scheme: "iso",
    dtype: { webgpu: "q8", wasm: "q8" },
  },
  {
    id: "Xenova/nllb-200-distilled-600M",
    label: "NLLB-200",
    sizeMb: 800,
    descKey: "mtDescNllb",
    scheme: "flores",
    dtype: { webgpu: "q8", wasm: "q8" },
  },
];

export const DEFAULT_TRANSLATE_MODEL = "Xenova/m2m100_418M";

export function translateModel(id: string): TranslateModelInfo | undefined {
  return TRANSLATE_MODELS.find((model) => model.id === id);
}

export const TRANSLATE_LANGS: { code: string; label: string; iso: string; flores: string }[] = [
  { code: "en", label: "English", iso: "en", flores: "eng_Latn" },
  { code: "fr", label: "Français", iso: "fr", flores: "fra_Latn" },
  { code: "ja", label: "日本語", iso: "ja", flores: "jpn_Jpan" },
  { code: "es", label: "Español", iso: "es", flores: "spa_Latn" },
  { code: "de", label: "Deutsch", iso: "de", flores: "deu_Latn" },
  { code: "it", label: "Italiano", iso: "it", flores: "ita_Latn" },
  { code: "pt", label: "Português", iso: "pt", flores: "por_Latn" },
  { code: "nl", label: "Nederlands", iso: "nl", flores: "nld_Latn" },
  { code: "ru", label: "Русский", iso: "ru", flores: "rus_Cyrl" },
  { code: "zh", label: "中文", iso: "zh", flores: "zho_Hans" },
  { code: "ko", label: "한국어", iso: "ko", flores: "kor_Hang" },
  { code: "ar", label: "العربية", iso: "ar", flores: "arb_Arab" },
];

export function mtLangCode(scheme: "iso" | "flores", common: string): string {
  const language = TRANSLATE_LANGS.find((item) => item.code === common);
  return language ? language[scheme] : common;
}
