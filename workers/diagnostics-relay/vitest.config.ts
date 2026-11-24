import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["workers/diagnostics-relay/src/**/*.test.ts"],
  },
});
