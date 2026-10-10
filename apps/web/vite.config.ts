import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { publicCiFontFallback } from "./font-build-profile";

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      name: "public-ci-font-fallback",
      enforce: "pre",
      transform(source, id) {
        return publicCiFontFallback(source, id, mode);
      },
    },
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:4100", changeOrigin: true },
      "/healthz": { target: "http://localhost:4100", changeOrigin: true },
      "/socket.io": { target: "ws://localhost:4100", ws: true },
    },
  },
  // Dist is served as public static content. Do not publish source maps that
  // embed original client source (including development-only modules).
  build: { target: "es2022", sourcemap: false },
}));
