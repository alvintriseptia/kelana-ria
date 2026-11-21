import type { DuoSeat } from "@kelana-ria/contracts";
import { action, escapeText } from "./solo-view";

export const player: Record<DuoSeat, string> = { host: "Pemain 1", guest: "Pemain 2" };
export const seats = ["host", "guest"] as const;
export const roomCodePattern = /^[0-9A-F]{8}$/;

export type EntryAction = { type: "create" } | { type: "join"; code: string; passId?: string };
export type EntryRequest = EntryAction & { actionId: string };
export type Feedback = { text: string; error?: boolean };

export function inviteUrl(mode: string, code: string) {
  const url = new URL("/", location.origin);
  url.searchParams.set("play", mode);
  url.searchParams.set("room", code);
  return url;
}

export function pendingEntry(key: string, allowPass = false) {
  return {
    read(roomCode: string): EntryRequest | undefined {
      try {
        const saved = JSON.parse(sessionStorage.getItem(key) ?? "null");
        const request = saved?.request;
        if (saved?.roomCode !== roomCode || typeof request?.actionId !== "string" || !/^[0-9a-f-]{36}$/.test(request.actionId)) return;
        const { actionId, type } = request;
        if (type === "create") return { actionId, type };
        if (type === "join" && typeof request.code === "string" && roomCodePattern.test(request.code)) {
          return allowPass && typeof request.passId === "string" && request.passId
            ? { actionId, type, code: request.code, passId: request.passId }
            : { actionId, type, code: request.code };
        }
      } catch {
        // Browsers can restrict session storage. The current page can still retry in memory.
      }
    },
    remember(entry?: { roomCode: string; request: EntryRequest }) {
      try {
        if (entry) sessionStorage.setItem(key, JSON.stringify(entry));
        else sessionStorage.removeItem(key);
      } catch {
        // The request remains available in memory if storage is unavailable.
      }
    },
  };
}

export function roomTransport<Reply extends { error?: string }, Request extends { actionId: string }>(apiPath: string, lockName: string) {
  let established = false;

  async function fetchReply(path: string, signal: AbortSignal, body?: Request): Promise<Reply> {
    const response = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
    const reply: Reply = await response.json();
    if (!response.ok && !reply.error) throw new Error(`HTTP ${response.status}`);
    return reply;
  }

  async function credential(signal: AbortSignal) {
    if (established) return;
    const read = () => fetchReply(apiPath, signal);
    const reply = navigator.locks ? await navigator.locks.request(lockName, { signal }, read) : await read();
    if (reply.error) throw new Error(reply.error);
    established = true;
  }

  async function request(path: string, signal: AbortSignal, body?: Request) {
    await credential(signal);
    let reply = await fetchReply(path, signal, body);
    if (reply.error === "session-required") {
      established = false;
      await credential(signal);
      reply = await fetchReply(path, signal, body);
    }
    return reply;
  }

  return { credential, request };
}

export function feedbackMarkup(feedback: Feedback | undefined) {
  return feedback ? `<p class="solo-feedback ${feedback.error ? "solo-feedback-error" : ""}">${escapeText(feedback.text)}</p>` : "";
}

export function inviteMarkup(code: string, host: boolean, mode: string) {
  return `<div class="duo-invite">
    <p>Kode undangan <strong class="duo-code">${escapeText(code)}</strong></p>
    ${host ? `<a href="${escapeText(inviteUrl(mode, code).href)}" data-focus="invite-link">Tautan undangan</a>
      ${action("Salin tautan", "copy")}` : ""}
  </div>`;
}

export function roomEntry(prefix: string, code: string, busy: boolean, feedback: Feedback | undefined, objective: string) {
  return `<div class="solo-layout">
    ${objective}
    <section class="solo-ticket duo-entry" aria-labelledby="${prefix}-room-heading">
      <h2 id="${prefix}-room-heading" tabindex="-1">${code ? "Gabung ruang undangan" : "Main dengan teman"}</h2>
      ${feedbackMarkup(feedback)}
      ${code ? '<p>Konfirmasi kode untuk mengambil kursi Pemain 2.</p>'
        : `<p>Buat ruang dan undang satu teman, atau gabung dengan kode yang kamu terima.</p>
          <div class="solo-actions">${action("Buat ruang", "create", "primary", busy)}</div>`}
      <form id="${prefix}-join" class="multiplayer-join">
        <label for="${prefix}-invite-input">Kode undangan</label>
        <input id="${prefix}-invite-input" data-focus="invite-input" name="code" type="text" value="${escapeText(code)}"
          minlength="8" maxlength="8" pattern="[0-9A-Fa-f]{8}" autocapitalize="characters" spellcheck="false" required>
        <button class="${code ? "primary" : "secondary"}" type="submit" data-focus="join" ${busy ? "disabled" : ""}>Gabung ruang</button>
      </form>
      ${code ? `<div class="solo-actions">${action("Ganti ruang", "new-room", "solo-back", busy)}</div>` : ""}
    </section>
  </div>`;
}
