/** Bump this revision when the generated worker adapter changes. A stable worker path
 * alone may reuse a previous GitHub Pages/HTTP cache even after the application updates. */
export function assWorkerUrl(): string {
  return new URL("octopus/subtitles-octopus-worker.js?v=track-replace-1", document.baseURI).toString();
}
