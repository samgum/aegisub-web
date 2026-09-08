declare module "@jellyfin/libass-wasm" {
  export default class SubtitlesOctopus {
    constructor(options: { canvas: HTMLCanvasElement; subContent: string; workerUrl: string; fallbackFont: string; fonts: string[]; onReady?(): void; onError?(error: unknown): void; targetFps?: number });
    lastRenderTime: number;
    worker: Worker | null;
    setCurrentTime(seconds: number): void;
    setIsPaused(paused: boolean, seconds: number): void;
    setTrack(text: string): void;
    resize(width: number, height: number): void;
    dispose(): void;
  }
}
