import { createMediaPlayer } from "mediaplay";

/** The pinned player's embedded option disables document hotkeys, but its loadeddata,
 * 600ms and 1500ms callbacks still focus .ot-media. An editor owns focus, not its decoder.
 * Scope the override to this disposable wrapper; never patch HTMLElement.prototype. */
export function createEmbeddedPlayer(...args: Parameters<typeof createMediaPlayer>): ReturnType<typeof createMediaPlayer> {
  const focused = document.activeElement;
  const player = createMediaPlayer(...args);
  const wrapper = args[0].querySelector<HTMLElement>(".ot-media");
  if (wrapper) {
    wrapper.focus = () => {};
    wrapper.removeAttribute("tabindex");
  }
  if (focused instanceof HTMLElement && focused.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
  return player;
}
