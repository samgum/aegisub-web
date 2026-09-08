/** Replacing an ASS track resets libass's change detection. If the replacement has
 * no visible event at the paused time, wasm-blend otherwise emits no frame and leaves
 * old pixels on the host canvas. Force exactly this replacement render, not every tick.
 * Fail closed when the pinned worker changes so an upgrade must review the adapter. */
export function patchOctopusTrackRender(source) {
  const start = source.indexOf("self.setTrack=function(content){");
  const end = source.indexOf("};self.freeTrack=", start);
  if (start < 0 || end < start) throw new Error("Pinned libass worker setTrack boundary changed; review track replacement rendering.");
  const body = source.slice(start, end), call = "self.getRenderMethod()()";
  if (body.split(call).length !== 2) throw new Error("Pinned libass worker setTrack render call changed; review the force-render adapter.");
  return source.slice(0, start) + body.replace(call, "self.getRenderMethod()(true)") + source.slice(end);
}
