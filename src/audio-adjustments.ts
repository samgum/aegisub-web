import { audioFlag, audioGain, audioNumber, audioZoomFactor } from "./audio-options";
import { nativeIcon } from "./icons";
import { styleDialog, styleElement as el, styleButton as button, styleGroup } from "./style-dialog-ui";

export class AudioAdjustments {
  readonly root = document.createElement("div");
  private zoom: HTMLInputElement;
  private amplitude: HTMLInputElement;
  private volume: HTMLInputElement;
  private link: HTMLButtonElement;
  constructor(private callbacks: { zoom(level: number): void; amplitude(gain: number): void; volume(gain: number): void }) {
    this.root.className = "se-audio-adjustments";
    const slider = (short: string, label: string, key: string, value: number, min: number, max: number, action: (value: number) => void) => {
      const wrap = document.createElement("label"); wrap.append(document.createTextNode(short)); wrap.title = label;
      const input = document.createElement("input"); input.type = "range"; input.min = String(min); input.max = String(max); input.step = "1"; input.value = String(value);
      input.setAttribute("aria-label", label); input.dataset.audioAdjustment = key;
      input.addEventListener("input", () => { localStorage.setItem(`aegisub-web.audio-${key}`, key === "volume" ? String(Math.max(1, Number(input.value))) : input.value); action(Number(input.value)); this.sync(); });
      wrap.append(input); this.root.append(wrap); return input;
    };
    this.zoom = slider("宽", "音频横向缩放", "zoom-horizontal", audioNumber("zoom-horizontal", 0, -30, 50), -30, 50, callbacks.zoom);
    this.amplitude = slider("高", "波形纵向缩放", "zoom-vertical", audioNumber("zoom-vertical", 50, 1, 100), 1, 100, () => this.apply());
    this.volume = slider("音", "音频音量", "volume", audioNumber("volume", 50, 0, 100), 0, 100, () => this.apply());
    this.link = button("", () => this.toggleLink()); this.link.innerHTML = nativeIcon("toggle_audio_link"); this.link.title = "联动波形增益与音量"; this.link.setAttribute("aria-label", this.link.title); this.link.dataset.audioOption = "audio-vertical-link";
    this.root.append(this.link); this.sync();
  }
  setZoom(level: number): void { this.zoom.value = String(level); this.sync(); }
  toggleLink(): void { localStorage.setItem("aegisub-web.audio-vertical-link", String(!audioFlag("vertical-link"))); this.apply(); }
  apply(): void {
    if (audioFlag("vertical-link")) this.volume.value = this.amplitude.value;
    this.callbacks.amplitude(audioGain(Number(this.amplitude.value)));
    this.callbacks.volume(audioGain(Number(this.volume.value))); this.sync();
  }
  private sync(): void {
    const linked = audioFlag("vertical-link"); if (linked) this.volume.value = this.amplitude.value;
    this.volume.disabled = linked; this.link.classList.toggle("on", linked); this.link.setAttribute("aria-pressed", String(linked));
    this.zoom.setAttribute("aria-valuetext", `${audioZoomFactor(Number(this.zoom.value))}%`);
    this.amplitude.setAttribute("aria-valuetext", `${audioGain(Number(this.amplitude.value)).toFixed(3)} 倍`);
    this.volume.setAttribute("aria-valuetext", `${audioGain(Number(this.volume.value)).toFixed(3)} 倍`);
  }
}

export function openAudioTimingOptions(onChange: () => void): void {
  const ui = styleDialog("音频打轴设置", "as-audio-options"), options = styleGroup("鼠标与标记");
  const flags: [string, HTMLInputElement][] = [], numbers: [string, HTMLInputElement | HTMLSelectElement][] = [];
  for (const [key, title, fallback] of [["snap", "启用标记吸附（Shift 临时反转）", true], ["drag-timing", "远处左键拖动创建新时间范围", true], ["wheel-zoom", "滚轮默认缩放（Ctrl / Command 反转）", false], ["show-keyframes", "显示并吸附关键帧", true], ["show-video-position", "显示并吸附视频位置", true], ["inactive-comments", "显示非选中注释行", false]] as const) {
    const input = el("input"); input.type = "checkbox"; input.checked = audioFlag(key, fallback); const label = el("label", "", "as-check"); label.style.flex = "1 1 100%"; label.append(input, document.createTextNode(title)); options.append(label); flags.push([key, input]);
  }
  for (const [key, title] of [["snap-distance", "吸附距离（像素）"], ["drag-sensitivity", "标记拖动范围（像素）"]]) {
    const input = el("input"); input.type = "number"; input.min = "0"; input.max = "100"; input.value = String(audioNumber(key, 8, 0, 100)); const label = el("label", title); label.append(input); options.append(label); numbers.push([key, input]);
  }
  const mode = el("select"); for (const [value, title] of [[0, "不显示"], [1, "仅上一行"], [2, "上一行和下一行"], [3, "所有非选中行"]] as const) mode.append(new Option(title, String(value)));
  mode.value = String(audioNumber("inactive-lines", 3, 0, 3)); const label = el("label", "非选中行显示"); label.append(mode); options.append(label); numbers.push(["inactive-lines", mode]);
  const waveform = el("select"); waveform.append(new Option("最大值", "0"), new Option("最大值＋平均值", "1"));
  waveform.value = String(audioNumber("waveform-style", 0, 0, 1)); const waveformLabel = el("label", "波形样式"); waveformLabel.append(waveform); numbers.push(["waveform-style", waveform]);
  const display = styleGroup("波形显示"); display.append(waveformLabel);
  ui.body.append(options, display); ui.foot.append(button("确定", () => {
    if (numbers.some(([, input]) => !input.reportValidity())) return;
    flags.forEach(([key, input]) => localStorage.setItem(`aegisub-web.audio-${key}`, String(input.checked)));
    numbers.forEach(([key, input]) => localStorage.setItem(`aegisub-web.audio-${key}`, input.value)); onChange(); ui.close();
  }), button("取消", ui.close));
}
