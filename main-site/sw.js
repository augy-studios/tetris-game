// Bump on every deploy that changes anything this worker serves. The browser
// compares this file byte for byte, so an unchanged version means nobody is
// ever offered the update.
const VERSION = "2026-09-25.1";

const CACHE = `tetris-${VERSION}`;
// Kept across versions: the font does not change when the site does.
const FONT_CACHE = "tetris-fonts";

// Must match the stylesheet link in index.html exactly.
const FONT_CSS = "https://fonts.googleapis.com/css2?family=Jua&display=swap";
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

const ASSETS = [
  "/",
  "/style.css",
  "/script.js",
  "/js/app.js",
  "/js/theme.js",
  "/js/ui.js",
  "/js/icons.js",
  "/js/update.js",
  "/js/api.js",
  "/js/settings.js",
  "/js/leaderboard.js",
  "/js/ranked.js",
  "/manifest.json",
  "/favicon.ico",
  "/XTT-192.png",
  "/XTT-512.png",
  "/XTT-main.png",
];

/* -- Install: cache the shell, then wait -- */

// No skipWaiting() here. A new worker waits until somebody presses Reload on
// the update bar; see the message handler below.
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        ASSETS.map(async (path) => {
          // cache: "reload" so a new version never precaches yesterday's file
          // out of the HTTP cache.
          const response = await fetch(new Request(path, { cache: "reload" }));
          if (!response.ok) throw new Error(`precache ${path}: ${response.status}`);
          await cache.put(path, await unredirect(response));
        })
      );
      await precacheFont();
    })()
  );
});

/* -- Activate: clean old caches -- */

// No clients.claim() here either: claiming on activation would do silently
// what the update bar exists to ask about.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("tetris-") && k !== CACHE && k !== FONT_CACHE)
            .map((k) => caches.delete(k))
        )
      )
  );
});

/* -- Update bar -- */

self.addEventListener("message", (event) => {
  const type = typeof event.data === "string" ? event.data : event.data?.type;

  // The only place either of these is ever called.
  if (type === "skip-waiting") {
    event.waitUntil(self.skipWaiting().then(() => self.clients.claim()));
  }
});

/* -- Fetch: strategy per route -- */

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    // API: straight to the network, never cached.
    if (url.pathname.startsWith("/api/")) return;

    if (request.mode === "navigate") {
      event.respondWith(navigate(request, url));
      return;
    }

    event.respondWith(cacheFirst(request, CACHE));
    return;
  }

  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request, FONT_CACHE));
    return;
  }

  // Analytics and ads: left to the browser. Caching them would serve stale
  // tags forever, and offline they fail quietly on their own.
});

/* -- Strategies -- */

// The page is the precached shell, so it always matches the precached
// scripts and styles it was built with. Anything else tries the network and
// falls back to the game when offline.
async function navigate(request, url) {
  if (url.pathname === "/" || url.pathname === "/index" || url.pathname === "/index.html") {
    const shell = await caches.match("/", { cacheName: CACHE });
    if (shell) return shell;
  }

  try {
    return await fetch(request);
  } catch {
    return (await caches.match("/", { cacheName: CACHE })) || Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  // ignoreVary: Google's font CSS varies on request headers the page and the
  // worker do not send identically.
  const cached = await caches.match(request, { cacheName, ignoreVary: true });
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // A stylesheet link without crossorigin makes the font CSS request opaque;
    // it is still worth keeping, or the font is gone offline.
    if (response.ok || response.type === "opaque") {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

/* -- Helpers -- */

// Jua's CSS lists a hundred-odd Korean subsets the page never draws. Cache the
// CSS and its latin files up front so the font works offline from the first
// visit; anything else is picked up by cacheFirst if it is ever asked for.
async function precacheFont() {
  try {
    const cache = await caches.open(FONT_CACHE);
    const response = await fetch(FONT_CSS, { mode: "cors" });
    if (!response.ok) return;

    const css = await response.clone().text();
    await cache.put(FONT_CSS, response);

    const files = [...css.matchAll(/\/\*\s*latin\s*\*\/\s*@font-face\s*{[^}]*?url\(([^)]+)\)/g)].map((m) => m[1]);
    await Promise.all(
      files.map(async (file) => {
        const font = await fetch(file, { mode: "cors" });
        if (font.ok) await cache.put(file, font);
      })
    );
  } catch {
    // Offline during install, or fonts blocked. The page falls back to the
    // system sans-serif, and installing the rest must not fail over it.
  }
}

// A redirected response cannot answer a navigation. A host that redirects
// "/" somewhere would otherwise break the offline shell, so keep only the body.
async function unredirect(response) {
  if (!response.redirected) return response;
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
