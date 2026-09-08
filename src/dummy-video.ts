import { VirtualPlaybackClock, type PlaybackClock } from "./playback-clock";
import { convertDoc, parseSubtitles, serializeSubtitles } from "./formats";
import { CanvasAssRenderer } from "./canvas-ass-renderer";
import { dummyFrameSeconds } from "./presentation-time";

export interface DummyVideoOptions {
  width: number; height: number; frames: number; frameRate: number; color: string; checkerboard: boolean;
}
export type DummyVideoElement = HTMLCanvasElement & PlaybackClock & {
  readonly readyState: number; readonly seeking: boolean;
  readonly videoWidth: number; readonly videoHeight: number;
  controls: boolean; muted: boolean; preservesPitch: boolean;
};
export function parseDummyFrameRate(value: string): number | null {
  const parts = value.trim().split("/").map(part => part.trim());
  if (parts.length > 2 || !parts.length) return null;
  if (parts.length === 2 && parts.some(part => !/^\d+$/.test(part) || Number(part) > 2147483647)) return null;
  if (parts.length === 1 && !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(parts[0])) return null;
  const fps = Number(parts[0]) / (parts[1] === undefined ? 1 : Number(parts[1]));
  return Number.isFinite(fps) && fps > 0 ? fps : null;
}
export function checkerboardAlternate(hex: string): string {
  const rgb = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const maximum = Math.max(...rgb), minimum = Math.min(...rgb), delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  let hue = delta ? maximum === rgb[0] ? ((rgb[1] - rgb[2]) / delta + 6) % 6 : maximum === rgb[1] ? (rgb[2] - rgb[0]) / delta + 2 : (rgb[0] - rgb[1]) / delta + 4 : 0;
  hue /= 6;
  // Native dummy provider offsets an 8-bit HSL lightness by 24, darkening near white.
  const l = Math.round(lightness * 255), nextL = (l > 231 ? l - 24 : l + 24) / 255;
  const chroma = (1 - Math.abs(2 * nextL - 1)) * saturation;
  const x = chroma * (1 - Math.abs(hue * 6 % 2 - 1)), m = nextL - chroma / 2;
  const color = hue < 1 / 6 ? [chroma, x, 0] : hue < 2 / 6 ? [x, chroma, 0] : hue < 3 / 6 ? [0, chroma, x] : hue < 4 / 6 ? [0, x, chroma] : hue < 5 / 6 ? [x, 0, chroma] : [chroma, 0, x];
  return `#${color.map(c => Math.round((c + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** Canvas-backed native-style dummy provider: no media encoder, encoded Blob or <video>.
 * Only one background image is allocated, regardless of the virtual frame count. */
export function createDummyVideoPlayer(host: HTMLElement, options: DummyVideoOptions, initialFonts: string[], onError: (message: string) => void) {
  const clock = new VirtualPlaybackClock(options.frames / options.frameRate);
  const wrapper = document.createElement("div"); wrapper.className = "ot-media se-dummy-player";
  Object.assign(wrapper.style, { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" });
  const stage = document.createElement("div"); stage.className = "ot-media-stage"; stage.style.position = "relative";
  const canvas = document.createElement("canvas") as DummyVideoElement;
  canvas.className = "se-dummy-video"; canvas.width = options.width; canvas.height = options.height;
  canvas.dataset.provider = "dummy"; canvas.tabIndex = 0;
  const context = canvas.getContext("2d")!;
  context.fillStyle = options.color; context.fillRect(0, 0, canvas.width, canvas.height);
  if (options.checkerboard) {
    context.fillStyle = checkerboardAlternate(options.color);
    for (let y = 0; y < canvas.height; y += 8) for (let x = 0; x < canvas.width; x += 8) if (((x / 8) & 1) !== ((y / 8) & 1)) context.fillRect(x, y, 8, 8);
  }
  for (const property of ["duration", "paused", "ended", "seeking"] as const) Object.defineProperty(canvas, property, { get: () => clock[property] });
  for (const property of ["currentTime", "playbackRate"] as const) Object.defineProperty(canvas, property, { get: () => clock[property], set: (value: number) => { clock[property] = value; } });
  Object.defineProperties(canvas, { readyState: { value: 4 }, videoWidth: { get: () => canvas.width }, videoHeight: { get: () => canvas.height } });
  canvas.controls = false; canvas.muted = true; canvas.preservesPitch = true;
  canvas.play = () => clock.play(); canvas.pause = () => clock.pause();
  for (const event of ["timeupdate", "play", "playing", "pause", "seeking", "seeked", "ratechange", "ended"]) clock.addEventListener(event, () => canvas.dispatchEvent(new Event(event)));
  const subtitles = document.createElement("canvas"); subtitles.width = options.width; subtitles.height = options.height;
  subtitles.className = "libassjs-canvas";
  Object.assign(subtitles.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none" });
  const subtitleParent = document.createElement("div"); subtitleParent.className = "libassjs-canvas-parent";
  Object.assign(subtitleParent.style, { position: "absolute", inset: "0", pointerEvents: "none" });
  subtitleParent.append(subtitles); stage.append(canvas, subtitleParent); wrapper.append(stage); host.append(wrapper);
  const renderer = new CanvasAssRenderer(subtitles, initialFonts, message => onError(`字幕预览：${message}`));
  let disposed = false;
  const render = () => {
    if (!disposed) renderer.renderAt(dummyFrameSeconds(clock.currentTime, options.frameRate, options.frames), clock.paused);
  };
  for (const event of ["timeupdate", "seeked"]) clock.addEventListener(event, render);
  return {
    getMediaElement: () => canvas,
    getPresentedTime: () => Math.max(0, Math.min(options.frames - 1, Math.floor(clock.currentTime * options.frameRate + 1e-7))) / options.frameRate,
    getBytes: () => undefined,
    setSubtitleText(text: string, filename: string) {
      if (disposed) return;
      render(); renderer.setText(/\.(ass|ssa)$/i.test(filename) ? text : serializeSubtitles(convertDoc(parseSubtitles(text, filename), "ass")));
    },
    setSubtitleFonts(next: string[]) { renderer.setFonts(next); },
    focus: () => canvas.focus(),
    destroy() { disposed = true; clock.dispose(); void renderer.dispose(); canvas.width = 0; canvas.height = 0; wrapper.remove(); },
  };
}
