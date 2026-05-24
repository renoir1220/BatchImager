import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "**/.worktrees/**"],
    globals: true,
    setupFiles: ["src/test/setupTests.ts"]
  }
});
