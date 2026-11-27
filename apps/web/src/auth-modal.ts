import type {
  AuthMeReply,
  AuthProfileReply,
  AuthRequestOtpReply,
  AuthUser,
  AuthVerifyOtpReply,
} from "@kelana-ria/contracts";
import { escapeText } from "./escape-text";
import { fetchApiJson, resolvePlayerError, type PlayerErrorTone } from "./player-errors";
import { createPlayerToast, renderInlineAlert } from "./player-toast";
import "./auth-modal.css";

type AuthListener = (auth: AuthMeReply) => void;

let cachedAuth: AuthMeReply | null = null;
const listeners = new Set<AuthListener>();

function emitAuth(next: AuthMeReply) {
  cachedAuth = next;
  for (const listener of [...listeners]) {
    try {
      listener(next);
    } catch {
      // Isolate listener errors.
    }
  }
}

export function getCachedAuth(): AuthMeReply | null {
  return cachedAuth;
}

export function hydrateAuthFromCatalog(auth?: AuthMeReply): AuthMeReply | null {
  if (!auth || typeof auth.authenticated !== "boolean") return cachedAuth;
  cachedAuth = auth;
  return cachedAuth;
}

export async function fetchAuthMe(signal?: AbortSignal): Promise<AuthMeReply> {
  const { ok, data } = await fetchApiJson<AuthMeReply>("/api/auth/me", { signal });
  if (ok && typeof data.authenticated === "boolean") {
    emitAuth(data);
    return data;
  }
  const fallback: AuthMeReply = cachedAuth ?? { authenticated: false, user: null, allowSandboxOtp: false };
  return fallback;
}

export function onAuthChange(listener: AuthListener, signal?: AbortSignal): () => void {
  listeners.add(listener);
  const remove = () => {
    listeners.delete(listener);
  };
  signal?.addEventListener("abort", remove, { once: true });
  return remove;
}

function userInitial(user: AuthUser): string {
  const src = (user.displayName || user.email || "P").trim();
  return (src[0] ?? "P").toUpperCase();
}

export function renderAccountChip(auth: AuthMeReply | null): string {
  if (auth?.authenticated && auth.user) {
    return `<button type="button" class="secondary auth-chip auth-chip--signed" data-auth-action="open-account" data-testid="auth-chip-account" aria-label="Akun ${escapeText(auth.user.displayName)}">
      <span class="auth-avatar" aria-hidden="true">${escapeText(userInitial(auth.user))}</span>
      <span class="auth-chip-name">${escapeText(auth.user.displayName)}</span>
    </button>`;
  }
  return `<button type="button" class="secondary auth-chip" data-auth-action="open-auth" data-testid="auth-chip-signin">Masuk</button>`;
}

export type OpenAuthModalOptions = {
  reason?: string;
  mode?: "signin" | "account";
  ownedCount?: number;
  onSignedIn?: (user: AuthUser) => void;
  onAuthUpdated?: (auth: AuthMeReply) => void;
  onClose?: () => void;
};

let activeCloseModal: (() => void) | null = null;

export function closeAuthModal() {
  activeCloseModal?.();
}

export function openAuthModal(options: OpenAuthModalOptions = {}) {
  activeCloseModal?.();

  const modalAbort = new AbortController();
  const { signal } = modalAbort;
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const toast = createPlayerToast({ signal, layout: "page" });

  const container = document.createElement("div");
  container.className = "auth-backdrop";
  container.dataset.testid = "auth-modal";
  document.body.appendChild(container);

  let step: "email" | "otp" = "email";
  let emailDraft = "";
  let otpDraft = "";
  let nameDraft = "";
  let challengeId = "";
  let sandboxCode = "";
  let resendAvailableAt = 0;
  let busy = false;
  let inlineError: { message: string; tone: PlayerErrorTone } | null = null;
  let accountNameDraft = cachedAuth?.user?.displayName ?? "";
  let mode: "signin" | "account" = options.mode === "account" && cachedAuth?.authenticated ? "account" : "signin";
  let countdownTimer: number | undefined;

  const defaultReason =
    "Masuk dengan email agar paket berbayar, riwayat pertandingan, dan draf Studio tersimpan di semua perangkat.";

  function close(restoreFocus = true) {
    if (signal.aborted) return;
    if (countdownTimer !== undefined) window.clearInterval(countdownTimer);
    modalAbort.abort();
    container.remove();
    if (activeCloseModal === close) activeCloseModal = null;
    options.onClose?.();
    if (restoreFocus && previousFocus?.isConnected) {
      previousFocus.focus({ preventScroll: true });
    }
  }
  activeCloseModal = () => close(false);

  function remainingResendSeconds(): number {
    return Math.max(0, Math.ceil((resendAvailableAt - Date.now()) / 1000));
  }

  function syncCountdown() {
    const btn = container.querySelector<HTMLButtonElement>('[data-auth-btn="resend"]');
    if (!btn) return;
    const sec = remainingResendSeconds();
    if (sec > 0) {
      btn.disabled = true;
      btn.textContent = `Kirim ulang (${sec} dtk)`;
    } else {
      btn.disabled = busy;
      btn.textContent = "Kirim ulang kode";
    }
  }

  function ensureCountdown() {
    if (countdownTimer !== undefined) window.clearInterval(countdownTimer);
    countdownTimer = window.setInterval(syncCountdown, 500);
  }

  function showAuthError(input: unknown, action: string) {
    const resolved = resolvePlayerError(input, { surface: "auth", action });
    if (resolved.placement === "inline-field" || resolved.placement === "inline-screen") {
      inlineError = { message: resolved.message, tone: resolved.tone };
      toast.clear();
    } else {
      inlineError = null;
      toast.resetDedupe();
      toast.show(resolved);
    }
  }

  function render() {
    if (signal.aborted) return;
    const alertHtml = inlineError
      ? renderInlineAlert(inlineError.message, inlineError.tone, 'data-testid="auth-inline-alert"')
      : "";

    if (mode === "account" && cachedAuth?.authenticated && cachedAuth.user) {
      const user = cachedAuth.user;
      const owned = options.ownedCount ?? 0;
      container.innerHTML = `<section class="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
        <div class="auth-head">
          <h2 id="auth-modal-title">Akun Kelana Ria</h2>
          <button type="button" class="secondary auth-close" data-auth-btn="close" aria-label="Tutup dialog akun" ${busy ? "disabled" : ""}>×</button>
        </div>
        <div class="auth-account-card">
          <span class="auth-account-avatar" aria-hidden="true">${escapeText(userInitial(user))}</span>
          <div class="auth-account-meta">
            <strong>${escapeText(user.displayName)}</strong>
            <small>${escapeText(user.email)}</small>
          </div>
          ${user.role === "admin" ? '<span class="auth-role-badge" data-testid="auth-admin-badge">Admin</span>' : ""}
        </div>
        <span class="auth-stat-pill" data-testid="auth-owned-count">✓ ${owned} paket dimiliki</span>
        ${alertHtml}
        <form class="auth-form" data-auth-form="profile">
          <label class="auth-field">
            <span>Nama tampilan</span>
            <input id="auth-profile-name" name="displayName" type="text" maxlength="32" value="${escapeText(accountNameDraft)}" required ${busy ? "disabled" : ""}>
          </label>
          <div class="auth-actions">
            <button type="submit" class="primary" data-testid="auth-save-profile" ${busy ? "disabled" : ""}>${busy ? "Menyimpan…" : "Simpan Nama"}</button>
          </div>
        </form>
        <button type="button" class="secondary auth-logout-btn" data-auth-btn="logout" data-testid="auth-logout" ${busy ? "disabled" : ""}>Keluar</button>
      </section>`;
      return;
    }

    const sec = remainingResendSeconds();
    const allowSandbox = Boolean(cachedAuth?.allowSandboxOtp);

    container.innerHTML = `<section class="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
      <div class="auth-head">
        <h2 id="auth-modal-title">Masuk dengan Email</h2>
        <button type="button" class="secondary auth-close" data-auth-btn="close" aria-label="Tutup dialog masuk" ${busy ? "disabled" : ""}>×</button>
      </div>
      <div class="auth-step-pills" aria-hidden="true">
        <span class="auth-step-pill ${step === "email" ? "auth-step-pill--active" : ""}">1. Email</span>
        <span class="auth-step-pill ${step === "otp" ? "auth-step-pill--active" : ""}">2. Kode 6 Digit</span>
      </div>
      <p class="auth-reason">${escapeText(options.reason || defaultReason)}</p>
      ${alertHtml}
      ${
        step === "email"
          ? `<form class="auth-form" data-auth-form="request-otp">
              <label class="auth-field">
                <span>Alamat email</span>
                <input id="auth-email-input" name="email" type="email" autocomplete="email" placeholder="nama@email.com" value="${escapeText(emailDraft)}" required ${busy ? "disabled" : ""}>
              </label>
              <div class="auth-actions">
                <button type="button" class="secondary" data-auth-btn="close" ${busy ? "disabled" : ""}>Nanti saja</button>
                <button type="submit" class="primary" data-testid="auth-send-otp" ${busy ? "disabled" : ""}>${busy ? "Mengirim…" : "Kirim Kode 6 Digit"}</button>
              </div>
            </form>`
          : `<div class="auth-dest-row">
              <span class="auth-dest-email">${escapeText(emailDraft)}</span>
              <button type="button" class="auth-link-btn" data-auth-btn="change-email" ${busy ? "disabled" : ""}>Ganti email</button>
            </div>
            ${
              allowSandbox && sandboxCode
                ? `<div class="auth-sandbox-hint" data-testid="auth-sandbox-hint">
                    <span>Uji masuk (Sandbox) · Kode: <code data-testid="auth-sandbox-code">${escapeText(sandboxCode)}</code></span>
                    <button type="button" class="secondary" data-auth-btn="fill-sandbox" ${busy ? "disabled" : ""}>Pakai kode</button>
                  </div>`
                : ""
            }
            <form class="auth-form" data-auth-form="verify-otp">
              <label class="auth-field">
                <span>Kode 6 digit</span>
                <input id="auth-otp-input" class="auth-otp-input" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" placeholder="000000" value="${escapeText(otpDraft)}" required ${busy ? "disabled" : ""}>
              </label>
              <label class="auth-field">
                <span>Nama tampilan (opsional)</span>
                <input id="auth-name-input" name="displayName" type="text" maxlength="32" placeholder="Mis. Dina" value="${escapeText(nameDraft)}" ${busy ? "disabled" : ""}>
              </label>
              <div class="auth-actions">
                <button type="button" class="secondary" data-auth-btn="resend" ${busy || sec > 0 ? "disabled" : ""}>${sec > 0 ? `Kirim ulang (${sec} dtk)` : "Kirim ulang kode"}</button>
                <button type="submit" class="primary" data-testid="auth-verify-otp" ${busy ? "disabled" : ""}>${busy ? "Memverifikasi…" : "Masuk"}</button>
              </div>
            </form>`
      }
    </section>`;
  }

  async function requestOtp(isResend = false) {
    const email = emailDraft.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      showAuthError("invalid-email", "request-otp");
      render();
      container.querySelector<HTMLInputElement>("#auth-email-input")?.focus({ preventScroll: true });
      return;
    }
    busy = true;
    inlineError = null;
    render();
    try {
      const { ok, status, data } = await fetchApiJson<AuthRequestOtpReply>("/api/auth/request-otp", {
        signal,
        body: { email },
      });
      if (signal.aborted) return;
      if (!ok || !data.ok) {
        const errCode = !data.ok && data.error ? data.error : "email-delivery-failed";
        if (!data.ok && data.retryAfterMs) {
          resendAvailableAt = Date.now() + data.retryAfterMs;
          ensureCountdown();
        }
        showAuthError({ error: errCode, status }, "request-otp");
        return;
      }
      challengeId = data.challengeId;
      sandboxCode = data.sandboxCode ?? "";
      resendAvailableAt = data.resendAvailableAt;
      if (data.sandboxCode && cachedAuth) {
        cachedAuth = { ...cachedAuth, allowSandboxOtp: true };
      } else if (data.sandboxCode && !cachedAuth) {
        cachedAuth = { authenticated: false, user: null, allowSandboxOtp: true };
      }
      step = "otp";
      otpDraft = "";
      ensureCountdown();
      if (isResend) {
        toast.resetDedupe();
        toast.show({
          message: "Kode 6 digit baru sudah dikirim ke emailmu.",
          tone: "info",
          dedupeKey: "auth:resend:ok",
        });
      }
    } catch (error) {
      if (!signal.aborted) showAuthError(error, "request-otp");
    } finally {
      if (!signal.aborted) {
        busy = false;
        render();
        if (step === "otp") {
          container.querySelector<HTMLInputElement>("#auth-otp-input")?.focus({ preventScroll: true });
        } else {
          container.querySelector<HTMLInputElement>("#auth-email-input")?.focus({ preventScroll: true });
        }
      }
    }
  }

  async function verifyOtp() {
    const code = otpDraft.replace(/\D+/g, "").slice(0, 6);
    if (code.length !== 6) {
      showAuthError("otp-invalid", "verify-otp");
      render();
      container.querySelector<HTMLInputElement>("#auth-otp-input")?.focus({ preventScroll: true });
      return;
    }
    busy = true;
    inlineError = null;
    render();
    try {
      const displayName = nameDraft.trim();
      const { ok, status, data } = await fetchApiJson<AuthVerifyOtpReply>("/api/auth/verify-otp", {
        signal,
        body: { challengeId, code, ...(displayName ? { displayName } : {}) },
      });
      if (signal.aborted) return;
      if (!ok || !data.ok) {
        const errCode = !data.ok && data.error ? data.error : "otp-invalid";
        showAuthError({ error: errCode, status }, "verify-otp");
        return;
      }
      const nextAuth: AuthMeReply = {
        authenticated: true,
        user: data.user,
        allowSandboxOtp: Boolean(cachedAuth?.allowSandboxOtp),
      };
      emitAuth(nextAuth);
      options.onAuthUpdated?.(nextAuth);
      const signedInCb = options.onSignedIn;
      close(false);
      signedInCb?.(data.user);
    } catch (error) {
      if (!signal.aborted) showAuthError(error, "verify-otp");
    } finally {
      if (!signal.aborted) {
        busy = false;
        render();
        container.querySelector<HTMLInputElement>("#auth-otp-input")?.focus({ preventScroll: true });
      }
    }
  }

  async function saveProfile() {
    const displayName = accountNameDraft.trim();
    if (!displayName || displayName.length > 32) {
      showAuthError("invalid-display-name", "profile");
      render();
      container.querySelector<HTMLInputElement>("#auth-profile-name")?.focus({ preventScroll: true });
      return;
    }
    busy = true;
    inlineError = null;
    render();
    try {
      const { ok, status, data } = await fetchApiJson<AuthProfileReply>("/api/auth/profile", {
        signal,
        body: { displayName },
      });
      if (signal.aborted) return;
      if (!ok || !data.ok) {
        showAuthError({ error: !data.ok ? data.error : "server-error", status }, "profile");
        return;
      }
      const nextAuth: AuthMeReply = {
        authenticated: true,
        user: data.user,
        allowSandboxOtp: Boolean(cachedAuth?.allowSandboxOtp),
      };
      accountNameDraft = data.user.displayName;
      emitAuth(nextAuth);
      options.onAuthUpdated?.(nextAuth);
      toast.resetDedupe();
      toast.show({
        message: "Nama tampilan diperbarui.",
        tone: "info",
        dedupeKey: "auth:profile:saved",
      });
    } catch (error) {
      if (!signal.aborted) showAuthError(error, "profile");
    } finally {
      if (!signal.aborted) {
        busy = false;
        render();
      }
    }
  }

  async function logout() {
    busy = true;
    inlineError = null;
    render();
    try {
      await fetchApiJson<{ ok?: boolean }>("/api/auth/logout", { signal, body: {} });
      if (signal.aborted) return;
      const nextAuth: AuthMeReply = {
        authenticated: false,
        user: null,
        allowSandboxOtp: Boolean(cachedAuth?.allowSandboxOtp),
      };
      emitAuth(nextAuth);
      options.onAuthUpdated?.(nextAuth);
      close(true);
    } catch (error) {
      if (!signal.aborted) {
        showAuthError(error, "logout");
        busy = false;
        render();
      }
    }
  }

  container.addEventListener(
    "input",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.id === "auth-email-input") emailDraft = target.value;
      if (target.id === "auth-otp-input") {
        const digits = target.value.replace(/\D+/g, "").slice(0, 6);
        otpDraft = digits;
        if (target.value !== digits) target.value = digits;
      }
      if (target.id === "auth-name-input") nameDraft = target.value;
      if (target.id === "auth-profile-name") accountNameDraft = target.value;
    },
    { signal },
  );

  container.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      event.preventDefault();
      if (busy) return;
      const kind = form.dataset.authForm;
      if (kind === "request-otp") void requestOtp(false);
      else if (kind === "verify-otp") void verifyOtp();
      else if (kind === "profile") void saveProfile();
    },
    { signal },
  );

  container.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target === container && !busy) {
        close(true);
        return;
      }
      const btn = target.closest<HTMLButtonElement>("[data-auth-btn]");
      if (!btn || busy) return;
      const action = btn.dataset.authBtn;
      if (action === "close") close(true);
      else if (action === "change-email") {
        step = "email";
        otpDraft = "";
        sandboxCode = "";
        inlineError = null;
        render();
        container.querySelector<HTMLInputElement>("#auth-email-input")?.focus({ preventScroll: true });
      } else if (action === "fill-sandbox" && sandboxCode) {
        otpDraft = sandboxCode;
        render();
        container.querySelector<HTMLInputElement>("#auth-otp-input")?.focus({ preventScroll: true });
      } else if (action === "resend") {
        void requestOtp(true);
      } else if (action === "logout") {
        void logout();
      }
    },
    { signal },
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        close(true);
      }
    },
    { signal },
  );

  render();
  if (mode === "account") {
    container.querySelector<HTMLInputElement>("#auth-profile-name")?.focus({ preventScroll: true });
  } else {
    container.querySelector<HTMLInputElement>("#auth-email-input")?.focus({ preventScroll: true });
  }
  if (!cachedAuth) {
    void fetchAuthMe(signal).then((fresh) => {
      if (signal.aborted) return;
      if (fresh.authenticated && fresh.user && options.mode === "account") {
        mode = "account";
        accountNameDraft = fresh.user.displayName;
        render();
      }
    });
  }
}
