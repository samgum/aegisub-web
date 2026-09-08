import { CanvasAssRenderer } from "./canvas-ass-renderer";
import { convertDoc, parseSubtitles, serializeSubtitles } from "./formats";

/** Native browser decoding/AV sync, with an independent display-sized subtitle layer.
 * No full-file read, second video decoder or background embedded-track scan. */
export function createNativeVideoPlayer(host: HTMLElement, file: File, fonts: string[], onError: (message: string) => void) {
  const wrapper = document.createElement("div"); wrapper.className = "ot-media se-native-player";
  Object.assign(wrapper.style, { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" });
  const stage = document.createElement("div"); stage.className = "ot-media-stage"; stage.style.position = "relative";
  const video = document.createElement("video");
  // Safari leaves preload=metadata at HAVE_METADATA with no decoded preview frame.
  // Ask the native decoder for frame data; this is still a disk-backed Blob URL, not
  // an application-owned whole-file ArrayBuffer or a second playback pipeline.
  video.playsInline = true; video.preload = "auto"; video.controls = false;
  const url = URL.createObjectURL(file); video.src = url;
  const parent = document.createElement("div"); parent.className = "libassjs-canvas-parent";
  Object.assign(parent.style, { position: "absolute", inset: "0", pointerEvents: "none" });
  const canvas = document.createElement("canvas"); canvas.className = "libassjs-canvas";
  Object.assign(canvas.style, { width: "100%", height: "100%", display: "block" });
  parent.append(canvas); stage.append(video, parent); wrapper.append(stage); host.append(wrapper);
  const renderer = new CanvasAssRenderer(canvas, fonts, onError);
  let disposed = false, callback = 0, raf = 0;
  const resize = () => {
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const scale = Math.min(devicePixelRatio || 1, 1080 / rect.height, (video.videoWidth || rect.width) / rect.width);
    renderer.resize(rect.width * scale, rect.height * scale);
  };
  const frame: VideoFrameRequestCallback = (_now, metadata) => {
    if (disposed) return;
    renderer.renderAt(metadata.mediaTime);
    callback = video.requestVideoFrameCallback(frame);
  };
  const fallback = () => { if (!disposed && !video.paused) { renderer.renderAt(video.currentTime); raf = requestAnimationFrame(fallback); } };
  const play = () => { if (!video.requestVideoFrameCallback) { cancelAnimationFrame(raf); raf = requestAnimationFrame(fallback); } };
  const seeked = () => renderer.renderAt(video.currentTime, true);
  video.addEventListener("play", play); video.addEventListener("seeked", seeked); video.addEventListener("pause", seeked);
  video.addEventListener("loadedmetadata", resize);
  video.addEventListener("error", () => { if (!disposed) onError(`浏览器无法解码此视频（${video.error?.code ?? "未知"}）。可在视频菜单中选择兼容解码。`); });
  if (video.requestVideoFrameCallback) callback = video.requestVideoFrameCallback(frame);
  const observer = new ResizeObserver(resize); observer.observe(stage);
  return {
    getMediaElement: () => video,
    getBytes: () => undefined,
    setSubtitleText(text: string, filename: string) {
      renderer.setText(/\.(ass|ssa)$/i.test(filename) ? text : serializeSubtitles(convertDoc(parseSubtitles(text, filename), "ass")));
      renderer.renderAt(video.currentTime, video.paused);
    },
    setSubtitleFonts: (next: string[]) => renderer.setFonts(next),
    focus: () => video.focus(),
    destroy() {
      disposed = true; observer.disconnect(); cancelAnimationFrame(raf);
      if (callback && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(callback);
      video.pause(); video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url);
      renderer.dispose(); wrapper.remove();
    },
  };
}
