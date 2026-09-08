import type { MediaPlayerHandle } from "mediaplay";
import { createEmbeddedPlayer } from "./embedded-player";
import type { PlaybackClock } from "./playback-clock";
import { DummyAudioSource, type DummyAudioKind } from "./dummy-audio";
import { decodeAuroraAudioToWav, fileHasAlac } from "./alac";
import { MediaGain } from "./media-gain";

export function isAudioFile(file: File): boolean {
  return file.type.startsWith("audio/") || /\.(?:aac|aif|aiff|alac|caf|flac|m4a|mp3|oga|ogg|opus|wav|w64|mka|ac3|eac3|dts|ape|wma)$/i.test(file.name);
}

const audioMime: Record<string, string> = {
  wav: "audio/wav", flac: "audio/flac", opus: "audio/ogg", ogg: "audio/ogg", oga: "audio/ogg",
  mp3: "audio/mpeg", aac: "audio/aac", m4a: "audio/mp4", alac: "audio/mp4",
  caf: "audio/x-caf", aif: "audio/aiff", aiff: "audio/aiff",
};

/** Owns the audio file independently of the video preview, as Aegisub's AudioController does.
 * Closing/replacing a video must never destroy this source or its waveform input. */
export class AudioWorkspace {
  file: File | null = null;
  analysisBlob: Blob | null = null;
  element: (PlaybackClock & { preservesPitch: boolean }) | null = null;
  synthetic: DummyAudioSource | null = null;
  fromVideo = false;
  private separateVideoAudio = false;
  private linkedVideo: PlaybackClock | null = null;
  private transportGeneration = 0;
  private player: MediaPlayerHandle | null = null;
  private generation = 0;
  private cancelRange: (() => void) | null = null;
  private followingVideo = false;
  private unbindVideo: (() => void) | null = null;
  private output = new MediaGain();
  private gain = 1;

  constructor(private host: HTMLElement, private callbacks: {
    changed(reason?: string): void;
    error(message: string): void;
    progress(message: string): void;
  }) {}

  get duration(): number { return Number.isFinite(this.element?.duration) ? this.element!.duration : 0; }
  get currentTime(): number { return this.followingVideo && this.usesNativeVideoAudio ? this.linkedVideo?.currentTime ?? 0 : this.element?.currentTime ?? 0; }
  get playing(): boolean { return this.followingVideo && this.usesNativeVideoAudio ? !this.linkedVideo?.paused : this.element ? !this.element.paused : false; }
  get usesNativeVideoAudio(): boolean { return this.fromVideo && !this.separateVideoAudio; }
  get muteVideo(): boolean { return !!this.element && !this.usesNativeVideoAudio; }

  setGain(gain: number): void {
    this.gain = gain; this.output.setGain(gain); this.synthetic?.setGain(gain);
    if (this.playing || (this.linkedVideo && !this.linkedVideo.paused)) this.prepareOutput();
  }
  prepareOutput(): void {
    try {
      if (this.element instanceof HTMLMediaElement) this.output.prepare(this.element);
      if (this.usesNativeVideoAudio && this.linkedVideo instanceof HTMLMediaElement) this.output.prepare(this.linkedVideo);
    } catch (error) { this.callbacks.error(error instanceof Error ? error.message : String(error)); }
  }

  async load(file: File, fromVideo = false): Promise<boolean> {
    this.close();
    const generation = this.generation;
    this.file = file;
    this.analysisBlob = file;
    this.fromVideo = fromVideo;
    this.host.dataset.loading = "true";
    this.host.dataset.filename = file.name;
    this.callbacks.changed();
    try {
      let knownAudioCodec: string | null = null;
      if (!isAudioFile(file)) {
        // A video-only source is valid video, not a failed audio decode. Probe metadata
        // before constructing an audio element that would otherwise report a codec error.
        const { Input, BlobSource, ALL_FORMATS } = await import("mediabunny");
        const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
        let hasAudio = true;
        try { const track = await input.getPrimaryAudioTrack(); hasAudio = !!track; knownAudioCodec = await track?.getCodec() ?? null; }
        catch { /* Let the native/legacy player try containers this demuxer cannot inspect. */ }
        finally { input.dispose(); }
        if (generation !== this.generation) return false;
        if (!hasAudio) { this.close(); this.callbacks.progress("视频没有音频轨。"); return false; }
      }
      const extension = file.name.split(".").pop()!.toLowerCase();
      let blob: Blob = file;
      // An audio element can read the audio track of MP4/WebM without decoding a second
      // video preview. Non-native containers still use mediaplay's existing codec path.
      let mime = audioMime[extension] ?? (/webm/i.test(file.type) ? "audio/webm" : isAudioFile(file) ? file.type : "audio/mp4");
      const alac = !knownAudioCodec && /^(?:alac|m4a|mp4|mov|caf)$/.test(extension) && await fileHasAlac(file);
      if (generation !== this.generation) return false;
      if (/^(?:aif|aiff|caf)$/.test(extension) || alac) {
        this.host.dataset.fallback = `${alac ? "alac" : "aurora"}-loading`;
        this.callbacks.changed();
        blob = await decodeAuroraAudioToWav(file, (ratio) => {
          if (generation === this.generation) this.callbacks.progress(`正在解码音频… ${Math.round(ratio * 100)}%`);
        });
        mime = "audio/wav";
        if (generation !== this.generation) return false;
        this.host.dataset.fallback = `${alac ? "alac" : "aurora"}-ready`;
      }
      if (generation !== this.generation) return false;
      this.analysisBlob = blob;
      this.separateVideoAudio = blob !== file;
      this.player = createEmbeddedPlayer(this.host, { blob, mime, filename: file.name }, {
        embedded: true,
        onError: (message) => { if (generation === this.generation) this.callbacks.error(message); },
      });
      const media = this.player.getMediaElement() ?? null;
      this.element = media;
      if (media) {
        media.controls = false;
        media.setAttribute("playsinline", "");
        for (const event of ["play", "pause", "ended", "timeupdate", "loadedmetadata", "seeked"]) {
          media.addEventListener(event, () => {
            if (generation === this.generation) this.callbacks.changed(event);
          });
        }
      }
      delete this.host.dataset.loading;
      this.callbacks.changed();
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.close();
      this.callbacks.error(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  openSynthetic(kind: DummyAudioKind): void {
    this.close();
    const generation = this.generation;
    const source = new DummyAudioSource(kind, message => { if (generation === this.generation) this.callbacks.error(message); });
    this.synthetic = source; this.element = source;
    source.setGain(this.gain);
    this.host.dataset.filename = source.name;
    this.host.dataset.sourceKind = kind;
    for (const event of ["play", "pause", "ended", "timeupdate", "seeked"]) source.addEventListener(event, () => { if (generation === this.generation) this.callbacks.changed(event); });
    this.callbacks.changed();
  }

  /** Video transport owns its own position; audio follows only during video playback.
   * Audio-only audition deliberately leaves the displayed video frame paused. */
  bindVideo(video: PlaybackClock | null): void {
    if (this.linkedVideo instanceof HTMLMediaElement && this.linkedVideo !== video) this.output.release(this.linkedVideo);
    this.unbindVideo?.();
    this.unbindVideo = null;
    this.followingVideo = false;
    this.linkedVideo = video;
    if (!video) return;
    const sync = (): void => {
      const audio = this.element;
      if (!audio || !this.followingVideo) return;
      if (this.usesNativeVideoAudio) { this.callbacks.changed("timeupdate"); return; }
      audio.playbackRate = video.playbackRate;
      if (Math.abs(audio.currentTime - video.currentTime) > .12) this.seek(video.currentTime);
    };
    const play = (): void => {
      this.stop();
      this.prepareOutput();
      this.followingVideo = true;
      if (this.usesNativeVideoAudio) { this.callbacks.changed("play"); return; }
      this.seek(video.currentTime);
      sync();
      const request = this.transportGeneration, element = this.element;
      void element?.play().catch((e: Error) => { if (request === this.transportGeneration && element === this.element) this.callbacks.error(e.message); });
    };
    const pause = (): void => { if (this.followingVideo) this.stop(); };
    video.addEventListener("play", play);
    video.addEventListener("pause", pause);
    video.addEventListener("seeked", sync);
    video.addEventListener("ratechange", sync);
    video.addEventListener("timeupdate", sync);
    this.unbindVideo = () => {
      pause();
      video.removeEventListener("play", play);
      video.removeEventListener("pause", pause);
      video.removeEventListener("seeked", sync);
      video.removeEventListener("ratechange", sync);
      video.removeEventListener("timeupdate", sync);
    };
    if (!video.paused) play();
  }

  seek(seconds: number): void {
    // Some native WAV demuxers reject seeking exactly past the last PCM sample. A cue
    // beyond a shorter independent audio file should park at its end, not invalidate it.
    if (this.element) this.element.currentTime = Math.max(0, Math.min(seconds, this.duration ? Math.max(0, this.duration - .001) : seconds));
  }

  play(startMs: number, end: number | (() => number)): void {
    this.stop();
    const audio = this.element;
    if (!audio) return;
    this.prepareOutput();
    this.seek(startMs / 1000);
    let raf = 0;
    let timer = 0;
    let cancelled = false;
    const check = (): void => {
      if (cancelled) return;
      const remaining = (typeof end === "function" ? end() : end) / 1000 - audio.currentTime;
      if (remaining <= 0 || audio.ended) { this.stop(); return; }
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      raf = requestAnimationFrame(check);
      timer = window.setTimeout(check, Math.min(50, Math.max(1, remaining * 1000 / audio.playbackRate)));
    };
    this.cancelRange = () => { cancelled = true; cancelAnimationFrame(raf); clearTimeout(timer); };
    void audio.play().then(check).catch((error: Error) => {
      if (cancelled) return;
      this.stop();
      this.callbacks.error(error.message);
    });
  }

  stop(): void {
    this.transportGeneration++;
    if (this.followingVideo && this.usesNativeVideoAudio && this.linkedVideo) this.seek(this.linkedVideo.currentTime);
    this.followingVideo = false;
    this.cancelRange?.();
    this.cancelRange = null;
    this.element?.pause();
    this.output.pauseIfIdle();
    this.callbacks.changed("pause");
  }

  close(): void {
    this.generation += 1;
    this.stop();
    if (this.element instanceof HTMLMediaElement) this.output.release(this.element);
    this.player?.destroy();
    this.player = null;
    this.synthetic?.dispose(); this.synthetic = null;
    this.element = null;
    this.file = null;
    this.analysisBlob = null;
    this.fromVideo = false;
    this.separateVideoAudio = false;
    this.host.replaceChildren();
    delete this.host.dataset.filename;
    delete this.host.dataset.loading;
    delete this.host.dataset.fallback;
    delete this.host.dataset.sourceKind;
    this.callbacks.changed();
  }

  destroy(): void { this.bindVideo(null); this.close(); this.output.dispose(); this.host.remove(); }
}
