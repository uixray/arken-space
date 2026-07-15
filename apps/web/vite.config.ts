import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:4100", changeOrigin: true },
      "/healthz": { target: "http://localhost:4100", changeOrigin: true },
      "/socket.io": { target: "ws://localhost:4100", ws: true },
    },
  },
  build: { target: "es2022", sourcemap: true },
});
