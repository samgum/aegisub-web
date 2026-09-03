export function openVideoDetails(file: File, media: HTMLMediaElement, frameRate: number): void {
  if (!document.getElementById("aegisub-web-video-details-style")) {
    const style = document.createElement("style"); style.id = "aegisub-web-video-details-style";
    style.textContent = `.ad-back{position:fixed;inset:0;z-index:1650;background:rgba(0,0,0,.58);display:grid;place-items:center;padding:16px}.ad-modal{width:min(650px,100%);background:var(--se-bg,#1d2025);color:var(--se-fg,#e9ebef);border:1px solid var(--se-border,#373b44);border-radius:12px}.ad-head{display:flex;align-items:center;gap:8px;padding:11px 14px;background:var(--se-head,#24272d);border-bottom:1px solid var(--se-border,#373b44)}.ad-head h2{font-size:15px;margin:0;flex:1}.ad-body{padding:14px}.ad-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ad-field{display:grid;gap:5px;font-size:11px;color:var(--se-muted,#9aa2ae)}.ad-field input{font:inherit;padding:7px;border:1px solid var(--se-border,#373b44);border-radius:6px;background:var(--se-bg,#1d2025);color:inherit}.ad-btn{font:inherit;padding:7px 11px;border:1px solid var(--se-border,#373b44);border-radius:7px;background:var(--se-head,#24272d);color:inherit;cursor:pointer}`;
    document.head.append(style);
  }
  const video = media as HTMLVideoElement;
  const width = video.videoWidth || 0;
  const height = video.videoHeight || 0;
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const divisor = width && height ? gcd(width, height) : 1;
  const duration = Number.isFinite(media.duration) ? media.duration : 0;
  const fields: [string, string][] = [
    ["File name", file.name], ["MIME type", file.type || "unknown"], ["File size", `${(file.size / 1024 / 1024).toFixed(2)} MiB`],
    ["FPS", frameRate.toFixed(3)], ["Resolution", width && height ? `${width}×${height} (${width / divisor}:${height / divisor})` : "unknown"],
    ["Length", `${Math.round(duration * frameRate)} frames (${duration.toFixed(3)} s)`], ["Decoder", "Browser HTMLMediaElement + mediaplay/WebCodecs"],
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
    const dialog = document.createElement("dialog"); dialog.className = "shell-dialog";
    const heading = document.createElement("h2"); heading.textContent = "Resolution mismatch";
    const text = document.createElement("p"); text.textContent = `Video: ${video.x}×${video.y} · Script: ${script.x}×${script.y}`;
    const select = document.createElement("select");
    for (const [value, label] of [["set", "Set script resolution to video"], ["stretch", "Resample (stretch)"], ["add-borders", "Resample (add borders)"], ["remove-borders", "Resample (remove borders)"], ["ignore", "Ignore"]] as const) select.append(new Option(label, value));
    const apply = document.createElement("button"); apply.textContent = "Apply";
    const cancel = document.createElement("button"); cancel.textContent = "Ignore";
    const finish = (choice: ResolutionMismatchChoice): void => { resolve(choice); dialog.close(); dialog.remove(); };
    apply.addEventListener("click", () => finish(select.value as ResolutionMismatchChoice)); cancel.addEventListener("click", () => finish("ignore"));
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish("ignore"); });
    dialog.append(heading, text, select, apply, cancel); document.body.append(dialog); dialog.showModal();
  });
}
