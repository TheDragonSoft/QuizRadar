import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "./index.css";
import App from "./App";
import { useAppStore } from "./state/store";

// Dev/test affordance: the Playwright harness and DevRig seed store state
// through this handle. Dev builds only — the production bundle never exposes it.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__QUIZRADAR_STORE__ = useAppStore;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Register service worker in browser environments
if (typeof window !== "undefined" && "serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    const swUrl = new URL("sw.js", window.location.href).href;
    navigator.serviceWorker.register(swUrl).catch((err) => {
      console.warn("Service Worker registration failed:", err);
    });
  });
}
