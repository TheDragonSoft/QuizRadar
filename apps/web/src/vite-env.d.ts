/// <reference types="vite/client" />

/** Baked at build time by vite.config.ts from tooling/version.json. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
