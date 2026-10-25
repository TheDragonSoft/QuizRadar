#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vitePath = pathToFileURL(
  path.join(repoRoot, "apps/web/node_modules/vite/dist/node/index.js"),
).href;
const { build } = await import(vitePath);

await build({
  root: path.join(repoRoot, "apps/web"),
  build: {
    emptyOutDir: false,
    outDir: "public",
    lib: {
      entry: "src/sw.ts",
      formats: ["es"],
      fileName: () => "sw.js",
    },
    rollupOptions: {
      output: {
        entryFileNames: "sw.js",
      },
    },
  },
  configFile: false,
});
console.log("Service Worker compiled to apps/web/public/sw.js");
