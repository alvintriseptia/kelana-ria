import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

function cacheControlFor(pathname: string): string {
  if (pathname.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  if (
    pathname === "/" ||
    pathname === "/catalog" ||
    pathname === "/index.html" ||
    pathname === "/sw.js" ||
    pathname === "/manifest.webmanifest"
  ) {
    return "no-cache";
  }
  return "public, max-age=3600";
}

export function staticHandler(staticDir: string) {
  const rootDir = resolve(staticDir);

  return async function handleStatic(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (request.method !== "GET" && request.method !== "HEAD") return false;
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return false;

    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(url.pathname);
    } catch {
      return false;
    }
    if (decodedPath.includes("\0") || decodedPath.includes("\\")) return false;

    const relativePath = decodedPath === "/" || decodedPath === "/catalog" ? "/index.html" : decodedPath;
    if (relativePath.split("/").some((segment) => segment === "..")) return false;

    const candidate = resolve(rootDir, `.${relativePath}`);
    if (candidate !== rootDir && !candidate.startsWith(rootDir + sep)) return false;

    try {
      const info = await stat(candidate);
      if (!info.isFile()) return false;
      const body = request.method === "HEAD" ? undefined : await readFile(candidate);
      const mime = MIME_TYPES[extname(candidate).toLowerCase()] ?? "application/octet-stream";
      response.writeHead(200, {
        "Content-Type": mime,
        "Content-Length": info.size,
        "Cache-Control": cacheControlFor(decodedPath),
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      });
      response.end(body);
      return true;
    } catch {
      return false;
    }
  };
}
