import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    __ARKEN_CLIENT_REVISION__: JSON.stringify(
      /^[0-9a-f]{40}$/.test(process.env.BUILD_REVISION ?? "")
        ? process.env.BUILD_REVISION
        : process.env.NODE_ENV === "production"
          ? "unknown"
          : "development",
    ),
  },
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
});
