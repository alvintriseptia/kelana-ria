export type AuthRole = "user" | "admin";

export type AuthUser = {
  userId: string;
  email: string;
  displayName: string;
  role: AuthRole;
  createdAt: number;
};

export type AdminAccountSummary = AuthUser & {
  isEnvBootstrapped: boolean;
};

export type AuthAdminsReply =
  | { ok: true; admins: AdminAccountSummary[] }
  | { ok: false; error: string };

export type AuthAdminUpdateRequest = {
  action: "grant" | "revoke";
  email: string;
};

export type AuthMeReply = {
  authenticated: boolean;
  user: AuthUser | null;
  allowSandboxOtp: boolean;
};

export type AuthRequestOtpReply =
  | {
      ok: true;
      challengeId: string;
      expiresAt: number;
      resendAvailableAt: number;
      sandboxCode?: string;
    }
  | {
      ok: false;
      error: string;
      retryAfterMs?: number;
    };

export type AuthVerifyOtpReply =
  | {
      ok: true;
      user: AuthUser;
      migrated: boolean;
    }
  | {
      ok: false;
      error: string;
      remainingAttempts?: number;
    };

export type AuthProfileReply =
  | {
      ok: true;
      user: AuthUser;
    }
  | {
      ok: false;
      error: string;
    };

export type AuthLogoutReply = {
  ok: true;
};
