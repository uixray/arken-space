import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const prototypeRoot = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(prototypeRoot, "../..");

export default {
  root: prototypeRoot,
  resolve: {
    alias: {
      konva: resolve(repositoryRoot, "apps/web/node_modules/konva"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.TERRAIN_STAMP_PORT ?? 14244),
    strictPort: true,
  },
  build: {
    outDir: resolve(prototypeRoot, "dist"),
    emptyOutDir: true,
    target: "es2022",
  },
};
