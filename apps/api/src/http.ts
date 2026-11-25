import type { IncomingMessage, ServerResponse } from "node:http";
import { TLSSocket } from "node:tls";
import { gzipSync } from "node:zlib";
import type { GameBoard, LocationFix } from "@kelana-ria/contracts";

const maxBodyBytes = 16 * 1024;
const gzipMinBytes = 1024;

function acceptsGzip(request?: IncomingMessage): boolean {
  const header = request?.headers?.["accept-encoding"];
  const raw = Array.isArray(header) ? header.join(",") : header ?? "";
  return /(?:^|[\s,])gzip(?:;q=(?!0(?:\.0+)?(?:\s*,|\s*$))[\d.]+)?(?:\s*,|\s*$)/i.test(raw);
}

export function isGameBoard(value: unknown): value is GameBoard {
  return value === "compact" || value === "jakarta-wide";
}

export function credential(request: IncomingMessage, cookieName: string) {
  const match = request.headers.cookie?.match(new RegExp(`(?:^|;\\s*)${cookieName}=([A-Za-z0-9_-]{43})(?:;|$)`));
  return match?.[1];
}

export function setCredential(request: IncomingMessage, response: ServerResponse, name: string, token: string, path: string, secureCookie: boolean) {
  const secure = secureCookie || request.socket instanceof TLSSocket;
  response.setHeader("Set-Cookie", `${name}=${token}; Path=${path}; HttpOnly; SameSite=Strict; Max-Age=2592000${secure ? "; Secure" : ""}`);
}

export function json(
  response: ServerResponse,
  status: number,
  content: object,
  extraHeaders?: Record<string, string | number>,
) {
  const payload = Buffer.from(JSON.stringify(content), "utf8");
  const headers: Record<string, string | number> = {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  };
  if (payload.length > gzipMinBytes && acceptsGzip(response.req)) {
    const compressed = gzipSync(payload);
    headers["Content-Encoding"] = "gzip";
    headers["Content-Length"] = compressed.length;
    headers["Vary"] = headers["Vary"] ? `${headers["Vary"]}, Accept-Encoding` : "Accept-Encoding";
    response.writeHead(status, headers);
    response.end(compressed);
    return;
  }
  headers["Content-Length"] = payload.length;
  response.writeHead(status, headers);
  response.end(payload);
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
}

export type LobbyAction = { actionId: string } & (
  | { type: "create"; board?: GameBoard }
  | { type: "join"; code: string; passId?: string }
);

export function parseLobbyAction(value: unknown, allowPass = false): LobbyAction | undefined {
  if (!isObject(value) || !isId(value.actionId)) return undefined;
  const { type, actionId, code, passId, board } = value;
  if (type === "create") {
    if (board !== undefined && !isGameBoard(board)) return undefined;
    return board ? { type, actionId, board } : { type, actionId };
  }
  if (type === "join" && typeof code === "string" && /^[0-9a-f]{8}$/i.test(code)) {
    if (passId !== undefined && (!allowPass || !isId(passId))) return undefined;
    return passId
      ? { type, actionId, code: code.toUpperCase(), passId }
      : { type, actionId, code: code.toUpperCase() };
  }
  return undefined;
}

export function isFix(value: unknown): value is LocationFix {
  return isObject(value) && ["latitude", "longitude", "accuracy", "timestamp"].every((key) =>
    typeof value[key] === "number" && Number.isFinite(value[key]));
}

export function hasJsonBody(request: IncomingMessage) {
  return /^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "");
}

export async function requestBody(request: IncomingMessage, limit = maxBodyBytes) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false }) as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) {
      request.resume();
      return undefined;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
