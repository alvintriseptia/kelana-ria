import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthUser } from "@kelana-ria/contracts";
import { clearCookie, credential, hasJsonBody, isObject, json, requestBody, setCredential } from "./http.js";
import type { authStore } from "./auth-store.js";
import type { EmailOtpAdapter } from "./email-adapter.js";

export const AUTH_SESSION_COOKIE = "kelana_session";
const GUEST_RULEBOOK_COOKIE = "kelana_rulebook";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

type AuthStore = ReturnType<typeof authStore>;

export type AuthHandlerOptions = {
  auth: AuthStore;
  emailAdapter: EmailOtpAdapter;
  now: () => number;
  secureCookie?: boolean;
  allowSandboxAuthOtp?: boolean;
  onAuthenticated?: (guestCredential: string, accountPrincipal: string, now: number) => boolean;
};

export function ensureAdmin(user: AuthUser | null, response: ServerResponse): user is AuthUser {
  if (!user) {
    json(response, 401, { ok: false, error: "auth-required" });
    return false;
  }
  if (user.role !== "admin") {
    json(response, 403, { ok: false, error: "admin-only" });
    return false;
  }
  return true;
}

export function authHandler(options: AuthHandlerOptions) {
  const {
    auth,
    emailAdapter,
    now,
    secureCookie = false,
    allowSandboxAuthOtp = false,
    onAuthenticated,
  } = options;

  function resolveUser(request: IncomingMessage, response?: ServerResponse, currentNow = now()): AuthUser | null {
    const token = credential(request, AUTH_SESSION_COOKIE);
    if (!token) return null;
    const session = auth.authenticate(token, currentNow);
    if (!session) return null;
    if (session.rolled && response && !response.headersSent) {
      setCredential(request, response, AUTH_SESSION_COOKIE, token, "/api", secureCookie, "Lax", SESSION_MAX_AGE_SECONDS);
    }
    return session.user;
  }

  async function handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const path = url.pathname;
    const ts = now();

    const managingAdmins = path === "/api/auth/admins";
    const admin = managingAdmins ? resolveUser(request, response, ts) : null;
    if (managingAdmins) {
      if (!ensureAdmin(admin, response)) return;
      if (request.method === "GET") {
        json(response, 200, { ok: true, admins: auth.listAdmins() });
        return;
      }
    }

    if (request.method === "GET" && path === "/api/auth/me") {
      const user = resolveUser(request, response, ts);
      json(response, 200, {
        authenticated: Boolean(user),
        user,
        allowSandboxOtp: Boolean(allowSandboxAuthOtp),
      });
      return;
    }

    if (request.method !== "POST") {
      json(response, 405, { error: "method-not-allowed" });
      return;
    }

    if (path === "/api/auth/logout") {
      const token = credential(request, AUTH_SESSION_COOKIE);
      if (token) auth.logout(token, ts);
      clearCookie(request, response, AUTH_SESSION_COOKIE, "/api", secureCookie, "Lax");
      json(response, 200, { ok: true });
      return;
    }

    if (!hasJsonBody(request)) {
      json(response, 415, { ok: false, error: "invalid-request" });
      return;
    }
    const raw = await requestBody(request, 16 * 1024);
    if (raw === undefined) {
      json(response, 413, { ok: false, error: "invalid-request" });
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      json(response, 400, { ok: false, error: "invalid-request" });
      return;
    }
    if (!isObject(body)) {
      json(response, 400, { ok: false, error: "invalid-request" });
      return;
    }

    if (admin) {
      const { action, email } = body;
      if ((action !== "grant" && action !== "revoke") || typeof email !== "string") {
        json(response, 400, { ok: false, error: "invalid-request" });
        return;
      }
      const updated = auth.updateAdmin(admin.userId, { action, email }, ts);
      if (updated.ok) json(response, 200, updated);
      else if (updated.error === "admin-only") json(response, 403, updated);
      else if (updated.error === "user-not-found") json(response, 404, updated);
      else json(response, 400, updated);
      return;
    }

    if (path === "/api/auth/request-otp") {
      const ipKey = request.socket?.remoteAddress || "local";
      const created = auth.requestOtp({ email: body.email, ipKey, now: ts });
      if (!created.ok) {
        const status = created.error === "otp-rate-limited" ? 429 : 400;
        const headers =
          status === 429 && created.retryAfterMs !== undefined
            ? { "Retry-After": String(Math.max(1, Math.ceil(created.retryAfterMs / 1000))) }
            : undefined;
        json(response, status, created, headers);
        return;
      }

      const delivered = await emailAdapter.sendOtp({
        toEmail: created.emailNormalized,
        code: created.code,
        challengeId: created.challengeId,
        expiresInMinutes: 10,
        at: ts,
      });
      if (!delivered.ok) {
        auth.cancelChallenge(created.challengeId, ipKey, ts);
        json(response, 503, { ok: false, error: delivered.error });
        return;
      }

      json(response, 200, {
        ok: true,
        challengeId: created.challengeId,
        expiresAt: created.expiresAt,
        resendAvailableAt: created.resendAvailableAt,
        ...(allowSandboxAuthOtp ? { sandboxCode: created.code } : {}),
      });
      return;
    }

    if (path === "/api/auth/verify-otp") {
      const verified = auth.verifyOtp({
        challengeId: body.challengeId,
        code: body.code,
        displayName: body.displayName,
        now: ts,
      });
      if (!verified.ok) {
        json(response, 400, verified);
        return;
      }

      setCredential(
        request,
        response,
        AUTH_SESSION_COOKIE,
        verified.token,
        "/api",
        secureCookie,
        "Lax",
        SESSION_MAX_AGE_SECONDS,
      );

      let migrated = false;
      const guestToken = credential(request, GUEST_RULEBOOK_COOKIE);
      if (guestToken && onAuthenticated) {
        migrated = onAuthenticated(guestToken, `user:${verified.user.userId}`, ts);
      }

      json(response, 200, {
        ok: true,
        user: verified.user,
        migrated,
      });
      return;
    }

    if (path === "/api/auth/profile") {
      const user = resolveUser(request, response, ts);
      if (!user) {
        json(response, 401, { ok: false, error: "auth-required" });
        return;
      }
      const updated = auth.updateDisplayName(user.userId, body.displayName, ts);
      json(response, updated.ok ? 200 : 400, updated);
      return;
    }

    json(response, 404, { error: "not-found" });
  }

  return Object.assign(handle, { resolveUser });
}
