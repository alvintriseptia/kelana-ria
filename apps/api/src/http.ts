import type { IncomingMessage, ServerResponse } from "node:http";
import { TLSSocket } from "node:tls";
import type { LocationFix } from "@kelana-ria/contracts";

const maxBodyBytes = 16 * 1024;

export function credential(request: IncomingMessage, cookieName: string) {
  const match = request.headers.cookie?.match(new RegExp(`(?:^|;\\s*)${cookieName}=([A-Za-z0-9_-]{43})(?:;|$)`));
  return match?.[1];
}

export function setCredential(request: IncomingMessage, response: ServerResponse, name: string, token: string, path: string, secureCookie: boolean) {
  const secure = secureCookie || request.socket instanceof TLSSocket;
  response.setHeader("Set-Cookie", `${name}=${token}; Path=${path}; HttpOnly; SameSite=Strict; Max-Age=2592000${secure ? "; Secure" : ""}`);
}

export function json(response: ServerResponse, status: number, content: object) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(content));
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
}

export type LobbyAction = { actionId: string } & (
  | { type: "create" }
  | { type: "join"; code: string; passId?: string }
);

export function parseLobbyAction(value: unknown, allowPass = false): LobbyAction | undefined {
  if (!isObject(value) || !isId(value.actionId)) return undefined;
  const { type, actionId, code, passId } = value;
  if (type === "create") return { type, actionId };
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

export async function requestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false }) as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      request.resume();
      return undefined;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
