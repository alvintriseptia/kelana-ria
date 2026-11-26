import type { RulebookFormat } from "@kelana-ria/contracts";
import { escapeText } from "./escape-text";
import { resolveDefaultPlayerName, saveRememberedGuestName } from "./guest-name";
import { fetchApiJson, resolvePlayerError, type PlayerErrorTone } from "./player-errors";
import { renderInlineAlert } from "./player-toast";
import { renderQrSvg } from "./qr-svg";
import "./lobby-ui.css";

export type TeamVisual = {
  index: number;
  label: string;
  shape: string;
  accent: string;
  bg: string;
  border: string;
};

const TEAM_PALETTE: Omit<TeamVisual, "index" | "label">[] = [
  { shape: "◆", accent: "#104a40", bg: "#eaf5ec", border: "#104a40" },
  { shape: "●", accent: "#9f2a3d", bg: "#fdf0f2", border: "#9f2a3d" },
  { shape: "▲", accent: "#284596", bg: "#eef2fd", border: "#284596" },
  { shape: "■", accent: "#8d5208", bg: "#fdf6e8", border: "#8d5208" },
  { shape: "★", accent: "#6d2f84", bg: "#f7effb", border: "#6d2f84" },
  { shape: "⬢", accent: "#0b6472", bg: "#eaf7f9", border: "#0b6472" },
];

export function teamVisual(index: number): TeamVisual {
  const palette = TEAM_PALETTE[index % TEAM_PALETTE.length];
  return {
    index,
    label: `Tim ${index + 1}`,
    ...palette,
  };
}

export function canUseWebShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export function renderLobbyInviteCard(options: {
  roomCode: string;
  inviteUrl: string;
  copiedCode: boolean;
  copiedLink: boolean;
}): string {
  const shareSupported = canUseWebShare();
  const shareLabel = options.copiedLink
    ? "✓ Tautan Tersalin"
    : shareSupported
      ? "Bagikan Undangan"
      : "Salin Tautan";
  return `<section class="lobby-invite-card" aria-label="Undang teman ke ruang" data-testid="lobby-invite-card">
    <div class="lobby-invite-top">
      <div class="lobby-invite-code-wrap">
        <span class="lobby-invite-label">Kode Ruang</span>
        <code class="lobby-invite-code" data-testid="lobby-room-code">${escapeText(options.roomCode)}</code>
      </div>
      <button type="button" class="secondary" data-lobby-action="copy-code" data-testid="copy-room-code">
        ${options.copiedCode ? "✓ Tersalin" : "Salin Kode"}
      </button>
    </div>
    <div class="lobby-invite-actions">
      <button type="button" class="primary" data-lobby-action="share-invite" data-testid="share-invite-btn">${shareLabel}</button>
      <button type="button" class="secondary" data-lobby-action="show-qr" data-testid="show-qr-btn">Tampilkan QR</button>
    </div>
    <div class="lobby-invite-url-row">
      <a class="lobby-invite-url" href="${escapeText(options.inviteUrl)}" data-testid="invite-link">${escapeText(options.inviteUrl)}</a>
    </div>
  </section>`;
}

export function renderCanceledRoomCard(options: { roomCode: string; title: string }): string {
  return `<section class="rb-shell" aria-label="Ruang dibatalkan">
    <div class="rb-card lobby-canceled-card" data-testid="canceled-room-card">
      <div class="rb-badges">
        <span class="rb-badge">Kode: ${escapeText(options.roomCode)}</span>
        <span class="rb-badge rb-badge-danger">Dibatalkan</span>
      </div>
      <h2>Host membatalkan ruang ini</h2>
      <p>Lobi untuk <strong>${escapeText(options.title)}</strong> sudah ditutup oleh Host. Kamu bisa kembali ke katalog untuk membuat ruang baru atau bergabung ke ruang lain.</p>
      <div class="rb-actions">
        <button type="button" class="primary" data-nav="catalog">Kembali ke Katalog</button>
      </div>
    </div>
  </section>`;
}

let activeDialogClose: (() => void) | null = null;

export function closeLobbyDialog(): void {
  activeDialogClose?.();
}

export function openQrModal(options: { roomCode: string; inviteUrl: string; title: string }): void {
  activeDialogClose?.();
  const abort = new AbortController();
  const { signal } = abort;
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const backdrop = document.createElement("div");
  backdrop.className = "lobby-dialog-backdrop";
  backdrop.dataset.testid = "qr-modal";

  let copied = false;
  const qrSvg = renderQrSvg(options.inviteUrl, `Kode QR untuk ruang ${options.roomCode}`);

  function close() {
    if (signal.aborted) return;
    abort.abort();
    backdrop.remove();
    if (activeDialogClose === close) activeDialogClose = null;
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }
  activeDialogClose = close;

  function render() {
    backdrop.innerHTML = `<section class="lobby-dialog" role="dialog" aria-modal="true" aria-labelledby="qr-modal-title">
      <div class="lobby-dialog-head">
        <h2 id="qr-modal-title">Pindai QR untuk Gabung</h2>
        <button type="button" class="secondary lobby-icon-btn" data-dialog-btn="close" aria-label="Tutup dialog QR">×</button>
      </div>
      <p class="lobby-dialog-body">Arahkan kamera ponsel teman ke kode QR ini untuk langsung masuk ke <strong>${escapeText(options.title)}</strong>.</p>
      <div class="lobby-qr-box">
        ${qrSvg}
        <code class="lobby-invite-code">${escapeText(options.roomCode)}</code>
      </div>
      <div class="lobby-dialog-actions">
        <button type="button" class="secondary" data-dialog-btn="copy">${copied ? "✓ Tautan Tersalin" : "Salin Tautan"}</button>
        <button type="button" class="primary" data-dialog-btn="close">Tutup</button>
      </div>
    </section>`;
  }

  backdrop.addEventListener("click", (event) => {
    const target = event.target;
    if (target === backdrop) return close();
    if (!(target instanceof Element)) return;
    const btn = target.closest<HTMLButtonElement>("[data-dialog-btn]");
    if (!btn) return;
    if (btn.dataset.dialogBtn === "close") close();
    else if (btn.dataset.dialogBtn === "copy") {
      void copyToClipboard(options.inviteUrl).then((ok) => {
        if (signal.aborted || !ok) return;
        copied = true;
        render();
      });
    }
  }, { signal });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }, { signal });

  render();
  document.body.appendChild(backdrop);
  backdrop.querySelector<HTMLButtonElement>('[data-dialog-btn="close"]')?.focus({ preventScroll: true });
}

export function openConfirmDialog(options: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}): void {
  activeDialogClose?.();
  const abort = new AbortController();
  const { signal } = abort;
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const backdrop = document.createElement("div");
  backdrop.className = "lobby-dialog-backdrop";
  backdrop.dataset.testid = "confirm-dialog";

  function close(restoreFocus = true) {
    if (signal.aborted) return;
    abort.abort();
    backdrop.remove();
    if (activeDialogClose === close) activeDialogClose = null;
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }
  activeDialogClose = () => close(false);

  backdrop.innerHTML = `<section class="lobby-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
    <div class="lobby-dialog-head">
      <h2 id="confirm-dialog-title">${escapeText(options.title)}</h2>
      <button type="button" class="secondary lobby-icon-btn" data-confirm-btn="cancel" aria-label="Tutup konfirmasi">×</button>
    </div>
    <p class="lobby-dialog-body">${escapeText(options.body)}</p>
    <div class="lobby-dialog-actions">
      <button type="button" class="secondary" data-confirm-btn="cancel">${escapeText(options.cancelLabel ?? "Batal")}</button>
      <button type="button" class="primary ${options.danger ? "lobby-danger-btn--solid" : ""}" data-confirm-btn="confirm" data-testid="confirm-dialog-submit">${escapeText(options.confirmLabel)}</button>
    </div>
  </section>`;

  backdrop.addEventListener("click", (event) => {
    const target = event.target;
    if (target === backdrop) return close(true);
    if (!(target instanceof Element)) return;
    const btn = target.closest<HTMLButtonElement>("[data-confirm-btn]");
    if (!btn) return;
    if (btn.dataset.confirmBtn === "cancel") close(true);
    else if (btn.dataset.confirmBtn === "confirm") {
      close(false);
      options.onConfirm();
    }
  }, { signal });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    }
  }, { signal });

  document.body.appendChild(backdrop);
  backdrop.querySelector<HTMLButtonElement>('[data-confirm-btn="cancel"]')?.focus({ preventScroll: true });
}

export function renderPostMatchActions(opts: {
  roomCode: string;
  packId: string;
  version: number;
  started: boolean;
  canPlayAgain: boolean;
  busy?: boolean;
}): string {
  const disabledAttr = opts.busy ? " disabled" : "";
  const recapLink = opts.started
    ? `<a class="cat-link" href="/?recap=${encodeURIComponent(opts.roomCode)}" data-testid="postmatch-recap-link">Buka ringkasan</a>`
    : "";
  const packHref = `/catalog?edition=${encodeURIComponent(opts.packId)}&version=${encodeURIComponent(String(opts.version))}`;

  if (opts.canPlayAgain) {
    return `<div class="postmatch-actions" data-testid="postmatch-actions">
      <button type="button" class="sg-main" data-action="play-again" data-testid="postmatch-play-again"${disabledAttr}>Main Lagi</button>
      <div class="postmatch-secondary-row">
        ${recapLink}
        <button type="button" class="secondary" data-nav="catalog" data-testid="postmatch-back-catalog"${disabledAttr}>Kembali ke Katalog</button>
      </div>
    </div>`;
  }

  return `<div class="postmatch-actions" data-testid="postmatch-actions">
    <button type="button" class="sg-main" data-action="join-new-room" data-testid="postmatch-join-new-room"${disabledAttr}>Gabung Ruang Baru</button>
    <div class="postmatch-secondary-row">
      <a class="cat-link" href="${escapeText(packHref)}" data-testid="postmatch-view-pack">Lihat Paket Ini</a>
      ${recapLink}
      <button type="button" class="secondary" data-nav="catalog" data-testid="postmatch-back-catalog"${disabledAttr}>Kembali ke Katalog</button>
    </div>
  </div>`;
}

export function openQuickJoinRoomDialog(options: {
  authenticatedDisplayName?: string | null;
  authenticated?: boolean;
  onJoined: (format: RulebookFormat, roomCode: string) => void;
}): void {
  activeDialogClose?.();
  const abort = new AbortController();
  const { signal } = abort;
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const backdrop = document.createElement("div");
  backdrop.className = "lobby-dialog-backdrop";
  backdrop.dataset.testid = "join-room-modal";

  let codeDraft = "";
  let nameDraft = resolveDefaultPlayerName(options.authenticatedDisplayName, "");
  let joining = false;
  let modalError: { message: string; tone: PlayerErrorTone } | null = null;

  function close(restoreFocus = true) {
    if (signal.aborted) return;
    abort.abort();
    backdrop.remove();
    if (activeDialogClose === close) activeDialogClose = null;
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }
  activeDialogClose = () => close(false);

  function render() {
    if (signal.aborted) return;
    backdrop.innerHTML = `<section class="lobby-dialog" role="dialog" aria-modal="true" aria-labelledby="quick-join-title">
      <div class="lobby-dialog-head">
        <h2 id="quick-join-title">Gabung Ruang Baru</h2>
        <button type="button" class="secondary lobby-icon-btn" data-quick-join-btn="close" aria-label="Tutup dialog gabung ruang" ${joining ? "disabled" : ""}>×</button>
      </div>
      <p class="lobby-dialog-body">Masukkan kode undangan baru dari Host (RC-… atau RB-…).</p>
      ${modalError ? renderInlineAlert(modalError.message, modalError.tone, 'data-testid="join-modal-alert"') : ""}
      <form class="lobby-rename-form" data-quick-join-form>
        <label class="rb-field" style="width:100%">
          <span>Kode Ruang</span>
          <input id="cat-join-code" name="roomCode" type="text" autocomplete="off" placeholder="RC-XXXXXX atau RB-XXXXXX" value="${escapeText(codeDraft)}" required ${joining ? "disabled" : ""}>
        </label>
        <label class="rb-field" style="width:100%">
          <span>Nama Pemain</span>
          <input id="cat-join-name" name="name" type="text" maxlength="32" placeholder="Mis. Dina" value="${escapeText(nameDraft)}" ${joining ? "disabled" : ""}>
        </label>
        <div class="lobby-dialog-actions" style="width:100%">
          <button type="button" class="secondary" data-quick-join-btn="close" ${joining ? "disabled" : ""}>Batal</button>
          <button type="submit" class="primary" data-testid="join-modal-submit" ${joining ? "disabled" : ""}>${joining ? "Masuk…" : "Gabung Ruang"}</button>
        </div>
      </form>
    </section>`;
  }

  async function submitJoin() {
    const normalizedCode = codeDraft.trim().replace(/\s+/g, "").toUpperCase();
    codeDraft = normalizedCode;
    if (!normalizedCode) {
      const resolved = resolvePlayerError("join-code-required", { surface: "lobby", action: "join-room" });
      modalError = { message: resolved.message, tone: resolved.tone };
      render();
      backdrop.querySelector<HTMLInputElement>("#cat-join-code")?.focus({ preventScroll: true });
      return;
    }
    const chosenName = nameDraft.trim() || resolveDefaultPlayerName(options.authenticatedDisplayName, "Pemain");
    joining = true;
    modalError = null;
    render();
    try {
      const { ok, status, data } = await fetchApiJson<{
        ok?: boolean;
        format?: RulebookFormat;
        roomCode?: string;
        error?: string;
      }>("/api/rulebooks", {
        signal,
        body: { type: "join-room", roomCode: normalizedCode, name: chosenName },
      });
      if (signal.aborted) return;
      if (!ok || !data.ok || !data.format) {
        const resolved = resolvePlayerError(
          { error: data.error ?? "room-not-found", status },
          { surface: "lobby", action: "join-room", target: normalizedCode },
        );
        modalError = { message: resolved.message, tone: resolved.tone };
        return;
      }
      if (!options.authenticated) saveRememberedGuestName(chosenName);
      const targetCode = data.roomCode ?? normalizedCode;
      close(false);
      options.onJoined(data.format, targetCode);
    } catch (error) {
      if (!signal.aborted) {
        const resolved = resolvePlayerError(error, { surface: "lobby", action: "join-room", target: normalizedCode });
        modalError = { message: resolved.message, tone: resolved.tone };
      }
    } finally {
      if (!signal.aborted) {
        joining = false;
        render();
        backdrop.querySelector<HTMLInputElement>("#cat-join-code")?.focus({ preventScroll: true });
      }
    }
  }

  backdrop.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.id === "cat-join-code") {
      const cleaned = target.value.replace(/\s+/g, "").toUpperCase();
      codeDraft = cleaned;
      if (target.value !== cleaned) target.value = cleaned;
    } else if (target.id === "cat-join-name") {
      nameDraft = target.value;
    }
  }, { signal });

  backdrop.addEventListener("submit", (event) => {
    const form = (event.target as HTMLElement | null)?.closest("[data-quick-join-form]");
    if (!form) return;
    event.preventDefault();
    if (!joining) void submitJoin();
  }, { signal });

  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop && !joining) return close(true);
    const btn = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("[data-quick-join-btn]");
    if (btn?.dataset.quickJoinBtn === "close" && !joining) close(true);
  }, { signal });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !joining) {
      event.preventDefault();
      close(true);
    }
  }, { signal });

  render();
  document.body.appendChild(backdrop);
  backdrop.querySelector<HTMLInputElement>("#cat-join-code")?.focus({ preventScroll: true });
}

