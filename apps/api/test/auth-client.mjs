import assert from "node:assert/strict";

export const TEST_ADMIN = { userId: "test-admin", email: "admin@kelana.test", displayName: "Admin Uji" };

export function makeClient(baseUrl) {
  const cookies = new Map();
  function mergeCookies(res) {
    const rawList = typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie")]
        : [];
    for (const raw of rawList) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!value || /Max-Age=0/i.test(raw)) cookies.delete(name);
      else cookies.set(name, value);
    }
    return rawList;
  }
  function cookieHeader() {
    return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  return {
    get cookies() {
      return new Map(cookies);
    },
    async get(path, extraHeaders = {}) {
      const hdr = cookieHeader();
      const res = await fetch(`${baseUrl}${path}`, {
        headers: { ...(hdr ? { cookie: hdr } : {}), ...extraHeaders },
      });
      const setCookies = mergeCookies(res);
      return { status: res.status, headers: res.headers, setCookies, body: await res.json() };
    },
    async post(path, body, extraHeaders = {}) {
      const hdr = cookieHeader();
      const res = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(hdr ? { cookie: hdr } : {}),
          ...extraHeaders,
        },
        body: JSON.stringify(body),
      });
      const setCookies = mergeCookies(res);
      return { status: res.status, headers: res.headers, setCookies, body: await res.json() };
    },
  };
}

export async function signInWithSandboxOtp(client, email, displayName) {
  const req = await client.post("/api/auth/request-otp", { email });
  assert.equal(req.status, 200, JSON.stringify(req.body));
  assert.match(req.body.sandboxCode, /^\d{6}$/);
  const ver = await client.post("/api/auth/verify-otp", {
    challengeId: req.body.challengeId,
    code: req.body.sandboxCode,
    ...(displayName ? { displayName } : {}),
  });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  return ver;
}
