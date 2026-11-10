import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  envDir: "../../",
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://localhost:8787"
    }
  },
  test: {
    environment: "jsdom",
    exclude: ["**/node_modules/**", "**/dist/**"],
  }
});
