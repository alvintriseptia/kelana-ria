import { escapeText } from "./escape-text";
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
