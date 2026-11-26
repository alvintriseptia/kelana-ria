import { createHash } from "node:crypto";

export type EmailOtpProviderMode = "http-transactional" | "recorded-sandbox" | "unconfigured";

export type RedactedEmailOtpEvent = {
  mode: EmailOtpProviderMode;
  challengeId: string;
  recipientDomain: string;
  recipientHash: string;
  status: "sent" | "failed";
  httpStatus: number | null;
  redacted: true;
  at: number;
};

export type SendEmailOtpInput = {
  toEmail: string;
  code: string;
  challengeId: string;
  expiresInMinutes: number;
  at: number;
};

export interface EmailOtpAdapter {
  readonly mode: EmailOtpProviderMode;
  readonly events: readonly RedactedEmailOtpEvent[];
  sendOtp(input: SendEmailOtpInput): Promise<{ ok: true } | { ok: false; error: string }>;
}

export interface RecordedEmailOtpAdapter extends EmailOtpAdapter {
  readonly mode: "recorded-sandbox";
  lastCodeFor(email: string): string | undefined;
  sentCount(): number;
  setFailNext(fail: boolean): void;
  clear(): void;
}

function recipientMetadata(email: string): { recipientDomain: string; recipientHash: string } {
  const normalized = email.trim().toLowerCase();
  const atIndex = normalized.lastIndexOf("@");
  const recipientDomain = atIndex >= 0 ? normalized.slice(atIndex + 1) : "unknown";
  const recipientHash = createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  return { recipientDomain, recipientHash };
}

export function createHttpEmailOtpAdapter({
  apiKey,
  fromEmail,
  apiBaseUrl = "https://api.resend.com",
  fetchImpl = fetch,
}: {
  apiKey: string;
  fromEmail: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}): EmailOtpAdapter {
  const events: RedactedEmailOtpEvent[] = [];
  const baseUrl = apiBaseUrl.replace(/\/+$/, "");

  return {
    mode: "http-transactional",
    events,
    async sendOtp(input: SendEmailOtpInput): Promise<{ ok: true } | { ok: false; error: string }> {
      const meta = recipientMetadata(input.toEmail);
      const text = [
        `Kode masuk Kelana Ria kamu: ${input.code}`,
        "",
        `Kode ini berlaku selama ${input.expiresInMinutes} menit dan hanya dapat digunakan satu kali.`,
        "Jangan bagikan kode ini kepada siapa pun.",
      ].join("\n");
      const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#111827">
        <p style="font-size:14px;color:#4b5563;margin:0 0 8px">Kelana Ria</p>
        <h1 style="font-size:20px;margin:0 0 16px">Kode Masuk 6 Digit</h1>
        <p style="font-size:32px;font-weight:800;letter-spacing:0.25em;background:#f3f4f6;padding:14px 18px;border-radius:12px;text-align:center;margin:0 0 16px">${input.code}</p>
        <p style="font-size:14px;color:#374151;margin:0">Berlaku ${input.expiresInMinutes} menit, sekali pakai. Jangan bagikan kode ini kepada siapa pun.</p>
      </div>`;

      try {
        const res = await fetchImpl(`${baseUrl}/emails`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromEmail,
            to: [input.toEmail],
            subject: "Kode Masuk Kelana Ria",
            text,
            html,
          }),
        });
        if (!res.ok) {
          events.push({
            mode: "http-transactional",
            challengeId: input.challengeId,
            ...meta,
            status: "failed",
            httpStatus: res.status,
            redacted: true,
            at: input.at,
          });
          return { ok: false, error: "email-delivery-failed" };
        }
        events.push({
          mode: "http-transactional",
          challengeId: input.challengeId,
          ...meta,
          status: "sent",
          httpStatus: res.status,
          redacted: true,
          at: input.at,
        });
        return { ok: true };
      } catch {
        events.push({
          mode: "http-transactional",
          challengeId: input.challengeId,
          ...meta,
          status: "failed",
          httpStatus: null,
          redacted: true,
          at: input.at,
        });
        return { ok: false, error: "email-delivery-failed" };
      }
    },
  };
}

export function createRecordedEmailOtpAdapter(): RecordedEmailOtpAdapter {
  const events: RedactedEmailOtpEvent[] = [];
  const latestByEmail = new Map<string, string>();
  let totalSent = 0;
  let shouldFail = false;

  return {
    mode: "recorded-sandbox",
    events,
    async sendOtp(input: SendEmailOtpInput): Promise<{ ok: true } | { ok: false; error: string }> {
      const meta = recipientMetadata(input.toEmail);
      if (shouldFail) {
        shouldFail = false;
        events.push({
          mode: "recorded-sandbox",
          challengeId: input.challengeId,
          ...meta,
          status: "failed",
          httpStatus: 503,
          redacted: true,
          at: input.at,
        });
        return { ok: false, error: "email-delivery-failed" };
      }
      latestByEmail.set(input.toEmail.trim().toLowerCase(), input.code);
      totalSent += 1;
      events.push({
        mode: "recorded-sandbox",
        challengeId: input.challengeId,
        ...meta,
        status: "sent",
        httpStatus: 200,
        redacted: true,
        at: input.at,
      });
      return { ok: true };
    },
    lastCodeFor(email: string) {
      return latestByEmail.get(email.trim().toLowerCase());
    },
    sentCount() {
      return totalSent;
    },
    setFailNext(fail: boolean) {
      shouldFail = fail;
    },
    clear() {
      latestByEmail.clear();
      events.length = 0;
      totalSent = 0;
      shouldFail = false;
    },
  };
}

export function createUnconfiguredEmailOtpAdapter(): EmailOtpAdapter {
  const events: RedactedEmailOtpEvent[] = [];
  return {
    mode: "unconfigured",
    events,
    async sendOtp(input: SendEmailOtpInput): Promise<{ ok: true } | { ok: false; error: string }> {
      events.push({
        mode: "unconfigured",
        challengeId: input.challengeId,
        ...recipientMetadata(input.toEmail),
        status: "failed",
        httpStatus: null,
        redacted: true,
        at: input.at,
      });
      return { ok: false, error: "email-delivery-failed" };
    },
  };
}

export function createEmailOtpAdapterFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options?: { allowSandboxFallback?: boolean },
): EmailOtpAdapter {
  const apiKey = env.EMAIL_API_KEY?.trim();
  const fromEmail = env.EMAIL_FROM?.trim();
  const apiBaseUrl = env.EMAIL_API_BASE_URL?.trim();
  if (apiKey && fromEmail) {
    return createHttpEmailOtpAdapter({
      apiKey,
      fromEmail,
      ...(apiBaseUrl ? { apiBaseUrl } : {}),
    });
  }
  if (options?.allowSandboxFallback) {
    return createRecordedEmailOtpAdapter();
  }
  return createUnconfiguredEmailOtpAdapter();
}
