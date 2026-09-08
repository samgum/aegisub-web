import { createMediaPlayer } from "mediaplay";

/** The pinned player's embedded option disables document hotkeys, but its loadeddata,
 * 600ms and 1500ms callbacks still focus .ot-media. An editor owns focus, not its decoder.
 * Scope the override to this disposable wrapper; never patch HTMLElement.prototype. */
export function createEmbeddedPlayer(...args: Parameters<typeof createMediaPlayer>): ReturnType<typeof createMediaPlayer> {
  const focused = document.activeElement;
  let disposed = false;
  const player = createMediaPlayer(args[0], args[1], { ...args[2], onError: message => { if (!disposed) args[2]?.onError?.(message); } });
  const destroy = player.destroy.bind(player);
  player.destroy = () => {
    if (disposed) return;
    disposed = true;
    const media = player.getMediaElement();
    if (media) {
      media.pause();
      media.removeAttribute("src");
      media.load(); // release native decoder/file handles, not merely the DOM wrapper
    }
    destroy();
  };
  const wrapper = args[0].querySelector<HTMLElement>(".ot-media");
  if (wrapper) {
    wrapper.focus = () => {};
    wrapper.removeAttribute("tabindex");
  }
  if (focused instanceof HTMLElement && focused.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
  return player;
}
