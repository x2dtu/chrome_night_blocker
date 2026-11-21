import { defineConfig } from "vitest/config";

export default defineConfig({
  define: { __DEV__: "true" },
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
  },
});
