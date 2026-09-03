const CACHE = "aegisub-web-shell-v9";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    const html = await fetch("./index.html", { cache: "no-store" }).then((response) => response.text());
    const linked = [...html.matchAll(/(?:src|href)="\.\/([^"#?]+)"/g)].map((match) => `./${match[1]}`);
    const manifest = await fetch("./asset-manifest.json", { cache: "no-store" }).then((response) => response.json());
    const files = new Set(linked);
    const visited = new Set();
    const visit = (key) => {
      if (visited.has(key)) return;
      visited.add(key);
      const item = manifest[key];
      if (!item) return;
      if (item.file) files.add(`./${item.file}`);
      for (const value of item.css || []) files.add(`./${value}`);
      for (const value of item.assets || []) files.add(`./${value}`);
      for (const dependency of item.imports || []) visit(dependency);
    };
    for (const [key, item] of Object.entries(manifest)) if (item.isEntry) visit(key);
    files.add("./asset-manifest.json");
    await cache.addAll([...files]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("aegisub-web-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  const url = new URL(event.request.url);
  // Media files are local Blob/File objects and never belong in Cache Storage. Fetch any
  // same-origin media response without HTTP/Service Worker caching as an additional guard.
  if (event.request.destination === "audio" || event.request.destination === "video") {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }
  const immutable = /\/(?:assets|aegisub-icons)\//.test(url.pathname)
    || /\/(?:icon(?:-\d+)?\.(?:svg|png)|asset-manifest\.json)$/.test(url.pathname);
  if (immutable) {
    event.respondWith((async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(event.request, response.clone());
      }
      return response;
    })());
    return;
  }
  const network = fetch(event.request);
  event.waitUntil(
    network.then(async (response) => {
      if (!response.ok) return;
      const cache = await caches.open(CACHE);
      await cache.put(event.request, response.clone());
    }).catch(() => undefined),
  );
  event.respondWith(
    network
      .catch(async () => (await caches.match(event.request)) || (event.request.mode === "navigate" ? caches.match("./index.html") : undefined)),
  );
});
