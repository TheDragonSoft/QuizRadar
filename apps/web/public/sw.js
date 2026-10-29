const u = "5.0.0", o = "quizradar-v5.0.0", c = `${o}-shell`, l = `${o}-cross-origin`, d = [
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
], a = self;
a.addEventListener("install", (t) => {
  t.waitUntil(
    caches.open(c).then((s) => s.addAll(d)).then(() => a.skipWaiting())
  );
});
a.addEventListener("activate", (t) => {
  t.waitUntil(
    caches.keys().then(
      (s) => Promise.all(
        s.filter(
          (e) => e.startsWith("quizradar-") && e !== c && e !== l
        ).map((e) => caches.delete(e))
      )
    ).then(() => a.clients.claim())
  );
});
a.addEventListener("fetch", (t) => {
  const s = new URL(t.request.url);
  if (s.pathname.startsWith("/api/") || s.hostname.includes("googleapis.com")) {
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
  if (s.origin !== a.location.origin) {
    t.respondWith(
      caches.match(t.request).then((e) => e || fetch(t.request).then((i) => {
        if (i.ok) {
          const n = i.clone();
          caches.open(l).then((r) => r.put(t.request, n));
        }
        return i;
      }))
    );
    return;
  }
  t.respondWith(
    caches.match(t.request).then((e) => {
      const i = fetch(t.request).then((n) => {
        if (n.ok) {
          const r = n.clone();
          caches.open(c).then((h) => h.put(t.request, r));
        }
        return n;
      }).catch(async () => {
        if (t.request.mode === "navigate") {
          const n = await caches.match("/index.html");
          if (n) return n;
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
