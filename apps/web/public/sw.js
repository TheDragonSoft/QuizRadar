const W = "5.8.0", m = "quizradar-v5.8.0", p = `${m}-shell`, g = `${m}-cross-origin`, y = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/radar.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./wasm/quizradar_wasm.js",
  "./wasm/quizradar_wasm_bg.wasm"
], E = "./index.html", b = `${m.replace(/-v[0-9].*$/, "")}-`;
function U(e) {
  return y.map((s) => new URL(s, e).href);
}
function C(e) {
  return new URL(E, e).href;
}
function L(e) {
  return new URL("./api/", e).pathname;
}
async function S(e, s) {
  return e.match(s, { ignoreVary: !0 });
}
async function R(e, s, a = {}) {
  const r = [], c = [];
  await Promise.all(
    s.map(async (t) => {
      var i;
      try {
        await e.add(t), r.push(t);
      } catch (o) {
        const u = {
          url: t,
          error: o instanceof Error ? o.message : String(o)
        };
        c.push(u), (i = a.onFailure) == null || i.call(a, u);
      }
    })
  );
  const n = a.shell;
  return {
    cached: r,
    failed: c,
    shellCached: n === void 0 ? !0 : r.includes(n)
  };
}
function _(e, s) {
  const a = new URL(s), r = /* @__PURE__ */ new Set(), c = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let n;
  for (; (n = c.exec(e)) !== null; ) {
    const t = n[1];
    if (!t || t.startsWith("data:") || t.startsWith("#")) continue;
    let i;
    try {
      i = new URL(t, s);
    } catch {
      continue;
    }
    i.origin === a.origin && r.add(i.href);
  }
  return [...r];
}
function q(e, s) {
  const a = [
    /\bfrom\s*["']([^"']+)["']/g,
    // import { x } from "./chunk.js"
    /\bimport\s*["']([^"']+)["']/g,
    // import "./chunk.js"
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
    // import("./chunk.js")
  ], r = /* @__PURE__ */ new Set();
  for (const c of a)
    for (const n of e.matchAll(c)) {
      const t = n[1];
      if (!(!t.startsWith("./") && !t.startsWith("../")))
        try {
          r.add(new URL(t, s).href);
        } catch {
        }
    }
  return [...r];
}
async function A(e, s, a = {}) {
  const r = [], c = [], n = /* @__PURE__ */ new Set();
  let t = [...s];
  for (; t.length > 0; ) {
    const i = t.filter((l) => !n.has(l));
    for (const l of i) n.add(l);
    const o = await R(e, i, { onFailure: a.onFailure });
    r.push(...o.cached), c.push(...o.failed);
    const u = [];
    for (const l of o.cached) {
      if (!l.endsWith(".js")) continue;
      const f = await e.match(l);
      if (!f) continue;
      const d = await f.text();
      for (const w of q(d, l))
        n.has(w) || u.push(w);
    }
    t = u;
  }
  return { cached: r, failed: c, shellCached: !0 };
}
async function x(e, s, a = {}) {
  const r = a.onFailure ?? P, c = e.location.href, n = await s.open(a.cacheName ?? p), t = C(c), i = await R(n, U(c), { shell: t, onFailure: r }), o = await n.match(t);
  if (o) {
    const u = await o.text(), l = _(u, t).filter(
      (d) => !i.cached.includes(d)
    ), f = await A(n, l, { onFailure: r });
    i.cached.push(...f.cached), i.failed.push(...f.failed);
  }
  if (!i.shellCached)
    throw new Error(
      `[QuizRadar SW] The app shell (${t}) could not be cached — this build cannot serve the app offline.`
    );
  return await e.skipWaiting(), i;
}
function P(e) {
  console.warn(`[QuizRadar SW] Could not precache ${e.url}: ${e.error}`);
}
function k() {
  if (typeof self > "u") return null;
  const e = self;
  return typeof e.registration > "u" || typeof e.skipWaiting != "function" ? null : e;
}
const h = k();
h && (h.addEventListener("install", (e) => {
  e.waitUntil(x(h, caches));
}), h.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(
      (s) => Promise.all(
        s.filter(
          (a) => a.startsWith(b) && a !== p && a !== g
        ).map((a) => caches.delete(a))
      )
    ).then(() => h.clients.claim())
  );
}), h.addEventListener("fetch", (e) => {
  const s = new URL(e.request.url), a = h.location.href;
  if (s.pathname.startsWith(L(a)) || s.hostname.includes("googleapis.com")) {
    e.respondWith(
      fetch(e.request).catch(
        () => new Response(
          JSON.stringify({
            error: "Offline — QuizRadar is in local mode",
            version: W
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
  if (s.origin !== h.location.origin) {
    e.respondWith(
      caches.match(e.request).then((r) => r || fetch(e.request).then((c) => {
        if (c.ok) {
          const n = c.clone();
          caches.open(g).then((t) => t.put(e.request, n));
        }
        return c;
      }))
    );
    return;
  }
  e.respondWith(
    S(caches, e.request).then((r) => {
      const c = fetch(e.request).then((n) => {
        if (n.ok) {
          const t = n.clone();
          caches.open(p).then((i) => i.put(e.request, t));
        }
        return n;
      }).catch(async () => {
        if (e.request.mode === "navigate") {
          const n = await S(caches, C(a));
          if (n) return n;
        }
        return r || new Response(JSON.stringify({ error: "Offline — QuizRadar is in local mode" }), {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "Content-Type": "application/json" }
        });
      });
      return r || c;
    })
  );
}));
