import { styleDialog, styleButton } from "./style-dialog-ui";

export function openVideoDetails(file: Pick<File, "name" | "type" | "size">, media: { duration: number; videoWidth?: number; videoHeight?: number }, frameRate: number): void {
  if (!document.getElementById("aegisub-web-video-details-style")) {
    const style = document.createElement("style"); style.id = "aegisub-web-video-details-style";
    style.textContent = `.ad-back{position:fixed;inset:0;z-index:1650;background:rgba(0,0,0,.58);display:grid;place-items:center;padding:16px}.ad-modal{width:min(650px,100%);background:var(--se-bg,#1d2025);color:var(--se-fg,#e9ebef);border:1px solid var(--se-border,#373b44);border-radius:12px}.ad-head{display:flex;align-items:center;gap:8px;padding:11px 14px;background:var(--se-head,#24272d);border-bottom:1px solid var(--se-border,#373b44)}.ad-head h2{font-size:15px;margin:0;flex:1}.ad-body{padding:14px}.ad-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ad-field{display:grid;gap:5px;font-size:11px;color:var(--se-muted,#9aa2ae)}.ad-field input{font:inherit;padding:7px;border:1px solid var(--se-border,#373b44);border-radius:6px;background:var(--se-bg,#1d2025);color:inherit}.ad-btn{font:inherit;padding:7px 11px;border:1px solid var(--se-border,#373b44);border-radius:7px;background:var(--se-head,#24272d);color:inherit;cursor:pointer}`;
    document.head.append(style);
  }
  const video = media;
  const width = video.videoWidth || 0;
  const height = video.videoHeight || 0;
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const divisor = width && height ? gcd(width, height) : 1;
  const duration = Number.isFinite(media.duration) ? media.duration : 0;
  const fields: [string, string][] = [
    ["File name", file.name], ["MIME type", file.type || "unknown"], ["File size", `${(file.size / 1024 / 1024).toFixed(2)} MiB`],
    ["FPS", frameRate.toFixed(3)], ["Resolution", width && height ? `${width}×${height} (${width / divisor}:${height / divisor})` : "unknown"],
    ["Length", `${Math.round(duration * frameRate)} frames (${duration.toFixed(3)} s)`], ["Decoder", file.type === "virtual/canvas" ? "Canvas / virtual frame clock" : "Browser HTMLMediaElement + mediaplay/WebCodecs"],
  ];
  const back = document.createElement("div"); back.className = "ad-back";
  const modal = document.createElement("div"); modal.className = "ad-modal";
  const head = document.createElement("div"); head.className = "ad-head";
  const title = document.createElement("h2"); title.textContent = "Video Details";
  const close = document.createElement("button"); close.className = "ad-btn"; close.textContent = "×"; close.addEventListener("click", () => back.remove());
  head.append(title, close);
  const body = document.createElement("div"); body.className = "ad-body";
  const grid = document.createElement("div"); grid.className = "ad-grid";
  for (const [name, value] of fields) {
    const label = document.createElement("label"); label.className = "ad-field"; label.textContent = name;
    const input = document.createElement("input"); input.readOnly = true; input.value = value; label.append(input); grid.append(label);
  }
  body.append(grid); modal.append(head, body); back.append(modal); document.body.append(back);
}

export type ResolutionMismatchChoice = "ignore" | "set" | "stretch" | "add-borders" | "remove-borders";

export function openResolutionMismatchDialog(script: { x: number; y: number }, video: { x: number; y: number }): Promise<ResolutionMismatchChoice> {
  return new Promise((resolve) => {
    const ui = styleDialog("分辨率不匹配", "as-resolution-dialog");
    const text = document.createElement("p"); text.textContent = `视频：${video.x}×${video.y} · 字幕脚本：${script.x}×${script.y}`;
    const select = document.createElement("select");
    select.setAttribute("aria-label", "分辨率处理方式");
    for (const [value, label] of [["set", "将脚本分辨率设为视频分辨率"], ["stretch", "重采样（拉伸）"], ["add-borders", "重采样（增加黑边）"], ["remove-borders", "重采样（裁去黑边）"], ["ignore", "保持脚本不变"]] as const) select.append(new Option(label, value));
    const finish = (choice: ResolutionMismatchChoice): void => { resolve(choice); ui.close(); };
    ui.dialog.addEventListener("close", () => resolve("ignore"), { once: true });
    ui.body.append(text, select); ui.foot.append(styleButton("应用", () => finish(select.value as ResolutionMismatchChoice)), styleButton("忽略", () => finish("ignore")));
  });
}
