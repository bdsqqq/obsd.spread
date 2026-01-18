import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    deps: {
      inline: [/^(?!obsidian)/],
    },
  },
  resolve: {
    alias: {
      obsidian: "/dev/null",
    },
  },
});
