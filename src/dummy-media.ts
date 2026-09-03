import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  canEncodeVideo,
  type VideoCodec,
} from "mediabunny";

export interface DummyMediaOptions {
  width: number;
  height: number;
  durationSeconds: number;
  frameRate?: number;
  color: string;
  label?: string;
}

export async function createDummyVideo(options: DummyMediaOptions): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(16, Math.round(options.width));
  canvas.height = Math.max(16, Math.round(options.height));
  const context = canvas.getContext("2d")!;
  context.fillStyle = options.color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (options.label) {
    context.fillStyle = "rgba(255,255,255,.82)";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `600 ${Math.max(16, Math.round(canvas.height / 18))}px system-ui`;
    context.fillText(options.label, canvas.width / 2, canvas.height / 2);
  }

  let codec: VideoCodec;
  let format: WebMOutputFormat | Mp4OutputFormat;
  let extension: string;
  let mime: string;
  if (await canEncodeVideo("vp8", { width: canvas.width, height: canvas.height })) {
    codec = "vp8";
    format = new WebMOutputFormat();
    extension = "webm";
    mime = "video/webm";
  } else if (await canEncodeVideo("avc", { width: canvas.width, height: canvas.height })) {
    codec = "avc";
    format = new Mp4OutputFormat({ fastStart: "in-memory" });
    extension = "mp4";
    mime = "video/mp4";
  } else {
    throw new Error("This browser has no WebCodecs video encoder for dummy video.");
  }
  const target = new BufferTarget();
  const output = new Output({ format, target });
  const source = new CanvasSource(canvas, { codec, bitrate: 160_000, keyFrameInterval: options.durationSeconds });
  output.addVideoTrack(source, { frameRate: Math.max(1, options.frameRate ?? 23.976), hasOnlyKeyPackets: true });
  await output.start();
  await source.add(0, Math.max(1, options.durationSeconds), { keyFrame: true });
  source.close();
  await output.finalize();
  if (!target.buffer) throw new Error("Dummy video encoder produced no output.");
  return new File([target.buffer], `dummy-${canvas.width}x${canvas.height}.${extension}`, { type: mime });
}
