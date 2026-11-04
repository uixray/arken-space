import type { FastifyInstance } from "fastify";
import { realpath, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, isAbsolute, join, relative } from "node:path";
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8",
};
export async function registerLocalHostWeb(
  app: FastifyInstance,
  directory: string,
) {
  const root = await realpath(directory);
  if (!(await stat(join(root, "index.html"))).isFile())
    throw new Error("LOCAL_WEB_BUNDLE_MISSING");
  app.setNotFoundHandler(async (request, reply) => {
    if (!["GET", "HEAD"].includes(request.method))
      return reply.code(404).send({ error: "NOT_FOUND" });
    let pathname: string;
    try {
      pathname = decodeURIComponent(request.url.split("?", 1)[0]!);
    } catch {
      return reply.code(400).send({ error: "INVALID_PATH" });
    }
    if (
      /^\/(?:api|socket\.io|healthz|media)(?:\/|$)/.test(pathname) ||
      /[\\\0]/.test(pathname) ||
      pathname.split("/").some((part) => part === "..")
    )
      return reply.code(404).send({ error: "NOT_FOUND" });
    const extension = extname(pathname).toLowerCase();
    const spa =
      !extension && Boolean(request.headers.accept?.includes("text/html"));
    if (!spa && !types[extension])
      return reply.code(404).send({ error: "NOT_FOUND" });
    try {
      const path = await realpath(
        spa
          ? join(root, "index.html")
          : join(root, pathname.replace(/^\/+/, "")),
      );
      const inside = relative(root, path);
      if (
        inside.startsWith("..") ||
        isAbsolute(inside) ||
        !(await stat(path)).isFile()
      )
        return reply.code(404).send({ error: "NOT_FOUND" });
      reply.header(
        "Cache-Control",
        spa || extension === ".html" ? "no-store" : "public, max-age=3600",
      );
      reply.header("X-Content-Type-Options", "nosniff");
      return reply
        .type(types[spa ? ".html" : extension]!)
        .send(createReadStream(path));
    } catch {
      return reply.code(404).send({ error: "NOT_FOUND" });
    }
  });
}
