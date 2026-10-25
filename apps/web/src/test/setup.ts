import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Ensure mock localStorage exists in Node/jsdom environments
if (typeof window !== "undefined") {
  const memoryStore = new Map<string, string>();
  const mockStorage: Storage = {
    getItem: (key: string) => memoryStore.get(key) ?? null,
    setItem: (key: string, val: string) => memoryStore.set(key, String(val)),
    removeItem: (key: string) => {
      memoryStore.delete(key);
    },
    clear: () => memoryStore.clear(),
    get length() {
      return memoryStore.size;
    },
    key: (index: number) => Array.from(memoryStore.keys())[index] ?? null,
  };

  try {
    if (!window.localStorage) {
      Object.defineProperty(window, "localStorage", {
        value: mockStorage,
        writable: true,
      });
    }
  } catch {
    // ignore
  }

  window.matchMedia =
    window.matchMedia ||
    function (query: string) {
      return {
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      };
    };
}

afterEach(() => {
  cleanup();
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.clear();
    }
  } catch {
    // ignore
  }
});
