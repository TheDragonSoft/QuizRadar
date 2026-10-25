const u = "5.0.0-alpha.1", o = "quizradar-v5.0.0-alpha.1", c = `${o}-shell`, l = `${o}-cross-origin`, d = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/radar.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
  "/wasm/quizradar_wasm.js",
  "/wasm/quizradar_wasm_bg.wasm"
], s = self;
s.addEventListener("install", (t) => {
  t.waitUntil(
    caches.open(c).then((n) => n.addAll(d)).then(() => s.skipWaiting())
  );
});
s.addEventListener("activate", (t) => {
  t.waitUntil(
    caches.keys().then(
      (n) => Promise.all(
        n.filter(
          (e) => e.startsWith("quizradar-") && e !== c && e !== l
        ).map((e) => caches.delete(e))
      )
    ).then(() => s.clients.claim())
  );
});
s.addEventListener("fetch", (t) => {
  const n = new URL(t.request.url);
  if (n.pathname.startsWith("/api/") || n.hostname.includes("googleapis.com")) {
    t.respondWith(
      fetch(t.request).catch(
        () => new Response(
          JSON.stringify({
            error: "Offline — QuizRadar is in local mode",
            version: u
          }),
          {
            status: 503,
            statusText: "Service Unavailable",
            headers: { "Content-Type": "application/json" }
          }
        )
      )
    );
    return;
  }
  if (n.origin !== s.location.origin) {
    t.respondWith(
      caches.match(t.request).then((e) => e || fetch(t.request).then((i) => {
        if (i.ok) {
          const a = i.clone();
          caches.open(l).then((r) => r.put(t.request, a));
        }
        return i;
      }))
    );
    return;
  }
  t.respondWith(
    caches.match(t.request).then((e) => {
      const i = fetch(t.request).then((a) => {
        if (a.ok) {
          const r = a.clone();
          caches.open(c).then((h) => h.put(t.request, r));
        }
        return a;
      }).catch(async () => {
        if (t.request.mode === "navigate") {
          const a = await caches.match("/index.html");
          if (a) return a;
        }
        return e || new Response(JSON.stringify({ error: "Offline — QuizRadar is in local mode" }), {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "Content-Type": "application/json" }
        });
      });
      return e || i;
    })
  );
});
