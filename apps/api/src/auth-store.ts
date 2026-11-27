import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AdminAccountSummary, AuthAdminUpdateRequest, AuthAdminsReply, AuthRole, AuthUser } from "@kelana-ria/contracts";

export const OTP_TTL_MS = 10 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60_000;
export const OTP_RATE_WINDOW_MS = 15 * 60_000;
export const OTP_MAX_SENDS_PER_WINDOW = 5;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
const SESSION_ROLL_THRESHOLD_MS = 25 * 24 * 60 * 60_000;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashOtp(salt: string, code: string): string {
  return sha256Hex(`${salt}:${code}`);
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length < 5 || trimmed.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) return null;
  const [local, domain] = trimmed.split("@");
  if (!local || !domain || local.length > 64 || domain.includes("..")) return null;
  return trimmed;
}

export function normalizeDisplayName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 1 || cleaned.length > 32) return null;
  return cleaned;
}

function defaultDisplayNameFromEmail(emailNormalized: string): string {
  const local = emailNormalized.split("@")[0] ?? "Pemain";
  const cleaned = local
    .replace(/[^A-Za-z0-9._ -]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
  return cleaned || "Pemain";
}

type UserRow = {
  user_id: string;
  email_normalized: string;
  display_name: string;
  role: AuthRole;
  created_at: number;
  updated_at: number;
};

type ChallengeRow = {
  challenge_id: string;
  email_normalized: string;
  code_hash: string;
  salt: string;
  created_at: number;
  expires_at: number;
  attempts: number;
  consumed_at: number | null;
};

function rowToUser(row: UserRow): AuthUser {
  return {
    userId: row.user_id,
    email: row.email_normalized,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at,
  };
}

export function authStore(databasePath: string, options: { adminEmails?: string[] } = {}) {
  const adminEmails = new Set((options.adminEmails ?? []).map(normalizeEmail).filter(email => email !== null));
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath, { timeout: 5000 });
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA secure_delete = ON;
    PRAGMA foreign_keys = ON;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      email_normalized TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_sessions (
      session_id TEXT PRIMARY KEY,
      token_hash TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
      ON user_sessions (user_id);
    CREATE TABLE IF NOT EXISTS auth_otp_challenges (
      challenge_id TEXT PRIMARY KEY,
      email_normalized TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      consumed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_auth_otp_email_created
      ON auth_otp_challenges (email_normalized, created_at);
  `);

  transact(() => {
    const columns = db.prepare("PRAGMA table_info(users)").all();
    if (!columns.some(column => column.name === "role")) {
      db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
    }
    const promote = db.prepare("UPDATE users SET role = 'admin' WHERE email_normalized = ? AND role != 'admin'");
    for (const email of adminEmails) promote.run(email);
  });

  const ipSendLog = new Map<string, number[]>();

  const recentEmailChallengesStmt = db.prepare(
    "SELECT created_at FROM auth_otp_challenges WHERE email_normalized = ? AND created_at > ? ORDER BY created_at ASC",
  );
  const insertChallengeStmt = db.prepare(`
    INSERT INTO auth_otp_challenges (challenge_id, email_normalized, code_hash, salt, created_at, expires_at, attempts, consumed_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, NULL)
  `);
  const deleteChallengeStmt = db.prepare("DELETE FROM auth_otp_challenges WHERE challenge_id = ?");
  const getChallengeStmt = db.prepare(
    "SELECT challenge_id, email_normalized, code_hash, salt, created_at, expires_at, attempts, consumed_at FROM auth_otp_challenges WHERE challenge_id = ?",
  );
  const bumpAttemptsStmt = db.prepare(
    "UPDATE auth_otp_challenges SET attempts = attempts + 1 WHERE challenge_id = ? AND consumed_at IS NULL",
  );
  const consumeChallengeStmt = db.prepare(
    "UPDATE auth_otp_challenges SET consumed_at = ? WHERE challenge_id = ? AND consumed_at IS NULL",
  );

  const getUserByEmailStmt = db.prepare(
    "SELECT user_id, email_normalized, display_name, role, created_at, updated_at FROM users WHERE email_normalized = ?",
  );
  const getUserByIdStmt = db.prepare(
    "SELECT user_id, email_normalized, display_name, role, created_at, updated_at FROM users WHERE user_id = ?",
  );
  const insertUserStmt = db.prepare(`
    INSERT INTO users (user_id, email_normalized, display_name, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const updateUserDisplayNameStmt = db.prepare(
    "UPDATE users SET display_name = ?, updated_at = ? WHERE user_id = ?",
  );

  const updateUserRoleStmt = db.prepare("UPDATE users SET role = ?, updated_at = ? WHERE user_id = ?");
  const listAdminsStmt = db.prepare(`
    SELECT user_id, email_normalized, display_name, role, created_at, updated_at
    FROM users WHERE role = 'admin' ORDER BY email_normalized
  `);
  const countAdminsStmt = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'");

  const insertSessionStmt = db.prepare(`
    INSERT INTO user_sessions (session_id, token_hash, user_id, created_at, expires_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, NULL)
  `);
  const getSessionWithUserStmt = db.prepare(`
    SELECT s.session_id, s.expires_at, s.revoked_at,
           u.user_id, u.email_normalized, u.display_name, u.role, u.created_at, u.updated_at
    FROM user_sessions s
    JOIN users u ON u.user_id = s.user_id
    WHERE s.token_hash = ?
  `);
  const extendSessionStmt = db.prepare("UPDATE user_sessions SET expires_at = ? WHERE session_id = ?");
  const revokeSessionStmt = db.prepare(
    "UPDATE user_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
  );

  function transact<T>(fn: () => T): T {
    if (db.isTransaction) return fn();
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function pruneIpLog(ipKey: string, now: number): number[] {
    const cutoff = now - OTP_RATE_WINDOW_MS;
    const recent = (ipSendLog.get(ipKey) ?? []).filter((ts) => ts > cutoff);
    if (recent.length) ipSendLog.set(ipKey, recent);
    else ipSendLog.delete(ipKey);
    return recent;
  }

  function requestOtp(input: {
    email: unknown;
    ipKey: string;
    now: number;
  }):
    | {
        ok: true;
        challengeId: string;
        emailNormalized: string;
        code: string;
        expiresAt: number;
        resendAvailableAt: number;
      }
    | { ok: false; error: string; retryAfterMs?: number } {
    const emailNormalized = normalizeEmail(input.email);
    if (!emailNormalized) return { ok: false, error: "invalid-email" };
    const { ipKey, now } = input;

    return transact(() => {
      const emailRecent = (
        recentEmailChallengesStmt.all(emailNormalized, now - OTP_RATE_WINDOW_MS) as { created_at: number }[]
      ).map((r) => r.created_at);

      const lastEmailSend = emailRecent[emailRecent.length - 1];
      if (lastEmailSend !== undefined && now - lastEmailSend < OTP_RESEND_COOLDOWN_MS) {
        return {
          ok: false as const,
          error: "otp-rate-limited",
          retryAfterMs: OTP_RESEND_COOLDOWN_MS - (now - lastEmailSend),
        };
      }
      if (emailRecent.length >= OTP_MAX_SENDS_PER_WINDOW) {
        const oldest = emailRecent[0]!;
        return {
          ok: false as const,
          error: "otp-rate-limited",
          retryAfterMs: Math.max(1_000, OTP_RATE_WINDOW_MS - (now - oldest)),
        };
      }

      const ipRecent = pruneIpLog(ipKey, now);
      if (ipRecent.length >= OTP_MAX_SENDS_PER_WINDOW) {
        const oldest = ipRecent[0]!;
        return {
          ok: false as const,
          error: "otp-rate-limited",
          retryAfterMs: Math.max(1_000, OTP_RATE_WINDOW_MS - (now - oldest)),
        };
      }

      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const salt = randomBytes(16).toString("hex");
      const codeHash = hashOtp(salt, code);
      const challengeId = `otp_${randomBytes(12).toString("hex")}`;
      const expiresAt = now + OTP_TTL_MS;
      const resendAvailableAt = now + OTP_RESEND_COOLDOWN_MS;

      insertChallengeStmt.run(challengeId, emailNormalized, codeHash, salt, now, expiresAt);
      ipRecent.push(now);
      ipSendLog.set(ipKey, ipRecent);

      return {
        ok: true as const,
        challengeId,
        emailNormalized,
        code,
        expiresAt,
        resendAvailableAt,
      };
    });
  }

  function cancelChallenge(challengeId: string, ipKey?: string, createdAt?: number) {
    transact(() => {
      deleteChallengeStmt.run(challengeId);
    });
    if (ipKey && createdAt !== undefined) {
      const list = ipSendLog.get(ipKey);
      if (list) {
        const idx = list.lastIndexOf(createdAt);
        if (idx >= 0) list.splice(idx, 1);
      }
    }
  }

  function verifyOtp(input: {
    challengeId: unknown;
    code: unknown;
    displayName?: unknown;
    now: number;
  }):
    | { ok: true; user: AuthUser; token: string; expiresAt: number }
    | { ok: false; error: string; remainingAttempts?: number } {
    if (typeof input.challengeId !== "string" || !input.challengeId.trim()) {
      return { ok: false, error: "otp-invalid" };
    }
    const challengeId = input.challengeId.trim();
    const cleanedCode = typeof input.code === "string" ? input.code.replace(/[\s-]+/g, "") : "";
    const { now } = input;

    return transact(() => {
      const row = getChallengeStmt.get(challengeId) as ChallengeRow | undefined;
      if (!row || row.consumed_at !== null) {
        return { ok: false as const, error: "otp-invalid" };
      }
      if (now >= row.expires_at) {
        return { ok: false as const, error: "otp-expired" };
      }
      if (row.attempts >= OTP_MAX_ATTEMPTS) {
        return { ok: false as const, error: "otp-attempts-exceeded", remainingAttempts: 0 };
      }

      const validFormat = /^\d{6}$/.test(cleanedCode);
      const expectedBuf = Buffer.from(row.code_hash, "hex");
      const actualBuf = validFormat ? Buffer.from(hashOtp(row.salt, cleanedCode), "hex") : Buffer.alloc(expectedBuf.length);
      const matched = validFormat && expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);

      if (!matched) {
        bumpAttemptsStmt.run(row.challenge_id);
        const nextAttempts = row.attempts + 1;
        if (nextAttempts >= OTP_MAX_ATTEMPTS) {
          return { ok: false as const, error: "otp-attempts-exceeded", remainingAttempts: 0 };
        }
        return {
          ok: false as const,
          error: "otp-invalid",
          remainingAttempts: OTP_MAX_ATTEMPTS - nextAttempts,
        };
      }

      const consumed = consumeChallengeStmt.run(now, row.challenge_id);
      if (Number(consumed.changes) !== 1) {
        return { ok: false as const, error: "otp-invalid" };
      }

      const explicitName = input.displayName !== undefined ? normalizeDisplayName(input.displayName) : null;
      let userRow = getUserByEmailStmt.get(row.email_normalized) as UserRow | undefined;
      const pinned = adminEmails.has(row.email_normalized);
      if (!userRow) {
        const userId = `usr_${randomBytes(12).toString("hex")}`;
        const finalName = explicitName ?? defaultDisplayNameFromEmail(row.email_normalized);
        const role = pinned ? "admin" : "user";
        insertUserStmt.run(userId, row.email_normalized, finalName, role, now, now);
        userRow = {
          user_id: userId,
          email_normalized: row.email_normalized,
          display_name: finalName,
          role,
          created_at: now,
          updated_at: now,
        };
      } else if (explicitName && explicitName !== userRow.display_name) {
        updateUserDisplayNameStmt.run(explicitName, now, userRow.user_id);
        userRow = { ...userRow, display_name: explicitName, updated_at: now };
      }

      if (pinned && userRow.role !== "admin") {
        updateUserRoleStmt.run("admin", now, userRow.user_id);
        userRow.role = "admin";
      }

      const token = randomBytes(32).toString("base64url");
      const tokenHash = sha256Hex(token);
      const sessionId = `ses_${randomBytes(12).toString("hex")}`;
      const expiresAt = now + SESSION_TTL_MS;
      insertSessionStmt.run(sessionId, tokenHash, userRow.user_id, now, expiresAt);

      return {
        ok: true as const,
        user: rowToUser(userRow),
        token,
        expiresAt,
      };
    });
  }

  function authenticate(
    token: string,
    now: number,
  ): { user: AuthUser; sessionId: string; rolled: boolean } | null {
    if (!token) return null;
    const tokenHash = sha256Hex(token);
    const row = getSessionWithUserStmt.get(tokenHash) as
      | (UserRow & { session_id: string; expires_at: number; revoked_at: number | null })
      | undefined;
    if (!row || row.revoked_at !== null || now >= row.expires_at) return null;

    let rolled = false;
    if (row.expires_at - now < SESSION_ROLL_THRESHOLD_MS) {
      extendSessionStmt.run(now + SESSION_TTL_MS, row.session_id);
      rolled = true;
    }
    return {
      user: rowToUser(row),
      sessionId: row.session_id,
      rolled,
    };
  }

  function updateDisplayName(
    userId: string,
    rawDisplayName: unknown,
    now: number,
  ): { ok: true; user: AuthUser } | { ok: false; error: string } {
    const cleaned = normalizeDisplayName(rawDisplayName);
    if (!cleaned) return { ok: false, error: "invalid-display-name" };
    return transact(() => {
      const existing = getUserByIdStmt.get(userId) as UserRow | undefined;
      if (!existing) return { ok: false as const, error: "auth-required" };
      updateUserDisplayNameStmt.run(cleaned, now, userId);
      return {
        ok: true as const,
        user: rowToUser({ ...existing, display_name: cleaned, updated_at: now }),
      };
    });
  }

  function listAdmins(): AdminAccountSummary[] {
    return (listAdminsStmt.all() as UserRow[]).map(row => ({
      ...rowToUser(row),
      isEnvBootstrapped: adminEmails.has(row.email_normalized),
    }));
  }

  function updateAdmin(actorId: string, request: AuthAdminUpdateRequest, now: number): AuthAdminsReply {
    const email = normalizeEmail(request.email);
    if (!email) return { ok: false, error: "invalid-email" };

    return transact(() => {
      const actor = getUserByIdStmt.get(actorId) as UserRow | undefined;
      if (actor?.role !== "admin") return { ok: false, error: "admin-only" };

      const target = getUserByEmailStmt.get(email) as UserRow | undefined;
      if (!target) return { ok: false, error: "user-not-found" };
      if (request.action === "revoke" && target.role === "admin") {
        if (adminEmails.has(email)) return { ok: false, error: "env-bootstrapped-admin" };
        if (countAdminsStmt.get()?.count === 1) return { ok: false, error: "cannot-remove-last-admin" };
      }
      const role = request.action === "grant" ? "admin" : "user";
      if (role !== target.role) updateUserRoleStmt.run(role, now, target.user_id);
      return { ok: true, admins: listAdmins() };
    });
  }

  function logout(token: string, now: number): boolean {
    if (!token) return false;
    const result = revokeSessionStmt.run(now, sha256Hex(token));
    return Number(result.changes) > 0;
  }

  return {
    requestOtp,
    cancelChallenge,
    verifyOtp,
    authenticate,
    updateDisplayName,
    listAdmins,
    updateAdmin,
    logout,
    close() {
      db.close();
    },
  };
}
