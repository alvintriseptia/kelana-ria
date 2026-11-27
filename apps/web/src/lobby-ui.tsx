import type { LocationFix, RulebookFormat } from "@kelana-ria/contracts";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { escapeText } from "./escape-text";
import { resolveDefaultPlayerName, saveRememberedGuestName } from "./guest-name";
import type { LiveLocationStatus } from "./live-location";
import { fetchApiJson, resolvePlayerError, type PlayerErrorTone } from "./player-errors";
import { renderQrSvg } from "./qr-svg";
import { Dialog } from "./ui/Dialog";
import { InlineAlert } from "./ui/InlineAlert";
import { mountPreactOverlay } from "./ui/mount";
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

export function LobbyInviteCard({
  roomCode,
  inviteUrl,
  copiedCode,
  copiedLink,
  onCopyCode,
  onShareInvite,
  onShowQr,
}: {
  roomCode: string;
  inviteUrl: string;
  copiedCode: boolean;
  copiedLink: boolean;
  onCopyCode: () => void;
  onShareInvite: () => void;
  onShowQr: () => void;
}) {
  const shareSupported = canUseWebShare();
  const shareLabel = copiedLink
    ? "✓ Tautan Tersalin"
    : shareSupported
      ? "Bagikan Undangan"
      : "Salin Tautan";

  return (
    <section
      class="lobby-invite-card"
      aria-label="Undang teman ke ruang"
      data-testid="lobby-invite-card"
    >
      <div class="lobby-invite-top">
        <div class="lobby-invite-code-wrap">
          <span class="lobby-invite-label">Kode Ruang</span>
          <code class="lobby-invite-code" data-testid="lobby-room-code">
            {roomCode}
          </code>
        </div>
        <button
          type="button"
          class="secondary"
          data-lobby-action="copy-code"
          data-testid="copy-room-code"
          onClick={onCopyCode}
        >
          {copiedCode ? "✓ Tersalin" : "Salin Kode"}
        </button>
      </div>
      <div class="lobby-invite-actions">
        <button
          type="button"
          class="primary"
          data-lobby-action="share-invite"
          data-testid="share-invite-btn"
          onClick={onShareInvite}
        >
          {shareLabel}
        </button>
        <button
          type="button"
          class="secondary"
          data-lobby-action="show-qr"
          data-testid="show-qr-btn"
          onClick={onShowQr}
        >
          Tampilkan QR
        </button>
      </div>
      <div class="lobby-invite-url-row">
        <a class="lobby-invite-url" href={inviteUrl} data-testid="invite-link">
          {inviteUrl}
        </a>
      </div>
    </section>
  );
}

export function CanceledRoomCard({
  roomCode,
  title,
  onBackToCatalog,
}: {
  roomCode: string;
  title: string;
  onBackToCatalog: () => void;
}) {
  return (
    <section class="rb-shell" aria-label="Ruang dibatalkan">
      <div class="rb-card lobby-canceled-card" data-testid="canceled-room-card">
        <div class="rb-badges">
          <span class="rb-badge">Kode: {roomCode}</span>
          <span class="rb-badge rb-badge-danger">Dibatalkan</span>
        </div>
        <h2>Host membatalkan ruang ini</h2>
        <p>
          Lobi untuk <strong>{title}</strong> sudah ditutup oleh Host. Kamu bisa kembali ke katalog
          untuk membuat ruang baru atau bergabung ke ruang lain.
        </p>
        <div class="rb-actions">
          <button type="button" class="primary" data-nav="catalog" onClick={onBackToCatalog}>
            Kembali ke Katalog
          </button>
        </div>
      </div>
    </section>
  );
}

export function PostMatchActions({
  roomCode,
  packId,
  version,
  started,
  canPlayAgain,
  busy = false,
  onPlayAgain,
  onJoinNewRoom,
  onBackToCatalog,
}: {
  roomCode: string;
  packId: string;
  version: number;
  started: boolean;
  canPlayAgain: boolean;
  busy?: boolean;
  onPlayAgain: () => void;
  onJoinNewRoom: () => void;
  onBackToCatalog: () => void;
}) {
  const recapHref = `/?recap=${encodeURIComponent(roomCode)}`;
  const packHref = `/catalog?edition=${encodeURIComponent(packId)}&version=${encodeURIComponent(String(version))}`;

  if (canPlayAgain) {
    return (
      <div class="postmatch-actions" data-testid="postmatch-actions">
        <button
          type="button"
          class="sg-main"
          data-action="play-again"
          data-testid="postmatch-play-again"
          disabled={busy}
          onClick={onPlayAgain}
        >
          Main Lagi
        </button>
        <div class="postmatch-secondary-row">
          {started && (
            <a class="cat-link" href={recapHref} data-testid="postmatch-recap-link">
              Buka ringkasan
            </a>
          )}
          <button
            type="button"
            class="secondary"
            data-nav="catalog"
            data-testid="postmatch-back-catalog"
            disabled={busy}
            onClick={onBackToCatalog}
          >
            Kembali ke Katalog
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="postmatch-actions" data-testid="postmatch-actions">
      <button
        type="button"
        class="sg-main"
        data-action="join-new-room"
        data-testid="postmatch-join-new-room"
        disabled={busy}
        onClick={onJoinNewRoom}
      >
        Gabung Ruang Baru
      </button>
      <div class="postmatch-secondary-row">
        <a class="cat-link" href={packHref} data-testid="postmatch-view-pack">
          Lihat Paket Ini
        </a>
        {started && (
          <a class="cat-link" href={recapHref} data-testid="postmatch-recap-link">
            Buka ringkasan
          </a>
        )}
        <button
          type="button"
          class="secondary"
          data-nav="catalog"
          data-testid="postmatch-back-catalog"
          disabled={busy}
          onClick={onBackToCatalog}
        >
          Kembali ke Katalog
        </button>
      </div>
    </div>
  );
}

export function OutdoorReadinessStrip({
  fix,
  status,
  onEnableLocation,
}: {
  fix: LocationFix | null;
  status: LiveLocationStatus;
  onEnableLocation: () => void;
}) {
  const ready = Boolean(fix) || status === "watching";
  return (
    <section class="qg-readiness" aria-label="Kesiapan Lapangan" data-testid="lobby-readiness-strip">
      <div class="qg-readiness-head">
        <span class="qg-readiness-eyebrow">Kesiapan Lapangan</span>
      </div>
      <div class="qg-readiness-items">
        <div class="qg-readiness-row">
          <span class="qg-readiness-label">
            <span aria-hidden="true">📍</span> Lokasi GPS
          </span>
          {ready ? (
            <span
              class="qg-readiness-pill"
              data-testid="readiness-gps-status"
              data-gps-ready="true"
              data-gps-state="ready"
            >
              Siap ✓
            </span>
          ) : status === "requesting" ? (
            <span
              class="qg-readiness-pill"
              data-testid="readiness-gps-status"
              data-gps-ready="false"
              data-gps-state="requesting"
              role="status"
            >
              Mencari…
            </span>
          ) : status === "denied" ? (
            <div class="qg-header-tools">
              <span
                class="qg-readiness-pill"
                data-testid="readiness-gps-status"
                data-gps-ready="false"
                data-gps-state="denied"
              >
                Ditolak
              </span>
              <button
                type="button"
                class="qg-readiness-btn"
                data-loc-action="enable-live-location"
                data-testid="readiness-gps-btn"
                onClick={onEnableLocation}
              >
                Coba Lagi
              </button>
            </div>
          ) : status === "unavailable" ? (
            <span
              class="qg-readiness-pill"
              data-testid="readiness-gps-status"
              data-gps-ready="false"
              data-gps-state="unavailable"
            >
              Tidak tersedia
            </span>
          ) : (
            <button
              type="button"
              class="qg-readiness-btn"
              data-loc-action="enable-live-location"
              data-testid="readiness-gps-btn"
              onClick={onEnableLocation}
            >
              Aktifkan Lokasi
            </button>
          )}
        </div>
        <div class="qg-readiness-row">
          <span class="qg-readiness-label">
            <span aria-hidden="true">📷</span> Kamera
          </span>
          <span class="qg-readiness-tip">Foto bukti memakai kamera belakang saat bermain</span>
        </div>
      </div>
    </section>
  );
}

// String-render wrappers kept solely until #183 (Claim) and #184 (Hide & Seek) migrate to Preact.
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

let activeDialogClose: (() => void) | null = null;

export function closeLobbyDialog(): void {
  activeDialogClose?.();
  activeDialogClose = null;
}

function QrModalView({
  roomCode,
  inviteUrl,
  title,
  onClose,
}: {
  roomCode: string;
  inviteUrl: string;
  title: string;
  onClose: () => void;
}) {
  const copied = useSignal(false);
  const qrBoxRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (qrBoxRef.current) {
      qrBoxRef.current.innerHTML = renderQrSvg(inviteUrl, `Kode QR untuk ruang ${roomCode}`);
    }
    closeBtnRef.current?.focus({ preventScroll: true });
  }, [inviteUrl, roomCode]);

  return (
    <Dialog
      titleId="qr-modal-title"
      title="Pindai QR untuk Gabung"
      testId="qr-modal"
      closeLabel="Tutup dialog QR"
      backdropClassName="lobby-dialog-backdrop"
      dialogClassName="lobby-dialog"
      headClassName="lobby-dialog-head"
      closeButtonClassName="secondary lobby-icon-btn"
      onClose={onClose}
    >
      <p class="lobby-dialog-body">
        Arahkan kamera ponsel teman ke kode QR ini untuk langsung masuk ke <strong>{title}</strong>.
      </p>
      <div class="lobby-qr-box">
        <div ref={qrBoxRef} />
        <code class="lobby-invite-code">{roomCode}</code>
      </div>
      <div class="lobby-dialog-actions">
        <button
          type="button"
          class="secondary"
          data-dialog-btn="copy"
          onClick={() => {
            void copyToClipboard(inviteUrl).then((ok) => {
              if (ok) copied.value = true;
            });
          }}
        >
          {copied.value ? "✓ Tautan Tersalin" : "Salin Tautan"}
        </button>
        <button
          ref={closeBtnRef}
          type="button"
          class="primary"
          data-dialog-btn="close"
          onClick={onClose}
        >
          Tutup
        </button>
      </div>
    </Dialog>
  );
}

export function openQrModal(options: { roomCode: string; inviteUrl: string; title: string }): void {
  closeLobbyDialog();
  const cleanup = mountPreactOverlay((close) => (
    <QrModalView
      roomCode={options.roomCode}
      inviteUrl={options.inviteUrl}
      title={options.title}
      onClose={() => {
        if (activeDialogClose === cleanup) activeDialogClose = null;
        close(true);
      }}
    />
  ));
  activeDialogClose = cleanup;
}

function ConfirmDialogView({
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    cancelRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <Dialog
      titleId="confirm-dialog-title"
      title={title}
      testId="confirm-dialog"
      closeLabel="Tutup konfirmasi"
      backdropClassName="lobby-dialog-backdrop"
      dialogClassName="lobby-dialog"
      headClassName="lobby-dialog-head"
      closeButtonClassName="secondary lobby-icon-btn"
      onClose={onCancel}
    >
      <p class="lobby-dialog-body">{body}</p>
      <div class="lobby-dialog-actions">
        <button
          ref={cancelRef}
          type="button"
          class="secondary"
          data-confirm-btn="cancel"
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          class={`primary ${danger ? "lobby-danger-btn--solid" : ""}`}
          data-confirm-btn="confirm"
          data-testid="confirm-dialog-submit"
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

export function openConfirmDialog(options: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}): void {
  closeLobbyDialog();
  const cleanup = mountPreactOverlay((close) => (
    <ConfirmDialogView
      title={options.title}
      body={options.body}
      confirmLabel={options.confirmLabel}
      cancelLabel={options.cancelLabel ?? "Batal"}
      danger={Boolean(options.danger)}
      onCancel={() => {
        if (activeDialogClose === cleanup) activeDialogClose = null;
        close(true);
      }}
      onConfirm={() => {
        if (activeDialogClose === cleanup) activeDialogClose = null;
        close(false);
        options.onConfirm();
      }}
    />
  ));
  activeDialogClose = cleanup;
}

function QuickJoinRoomDialogView({
  authenticatedDisplayName,
  authenticated,
  onJoined,
  onClose,
}: {
  authenticatedDisplayName?: string | null;
  authenticated?: boolean;
  onJoined: (format: RulebookFormat, roomCode: string) => void;
  onClose: (restoreFocus?: boolean) => void;
}) {
  const codeDraft = useSignal("");
  const nameDraft = useSignal(resolveDefaultPlayerName(authenticatedDisplayName, ""));
  const joining = useSignal(false);
  const modalError = useSignal<{ message: string; tone: PlayerErrorTone } | null>(null);
  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const submitAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    codeInputRef.current?.focus({ preventScroll: true });
    return () => {
      submitAbortRef.current?.abort();
    };
  }, []);

  async function handleSubmit(event: Event) {
    event.preventDefault();
    if (joining.value) return;
    const normalizedCode = codeDraft.value.trim().replace(/\s+/g, "").toUpperCase();
    codeDraft.value = normalizedCode;
    if (!normalizedCode) {
      const resolved = resolvePlayerError("join-code-required", {
        surface: "lobby",
        action: "join-room",
      });
      modalError.value = { message: resolved.message, tone: resolved.tone };
      codeInputRef.current?.focus({ preventScroll: true });
      return;
    }
    const chosenName =
      nameDraft.value.trim() || resolveDefaultPlayerName(authenticatedDisplayName, "Pemain");
    joining.value = true;
    modalError.value = null;
    const abort = new AbortController();
    submitAbortRef.current = abort;
    try {
      const { ok, status, data } = await fetchApiJson<{
        ok?: boolean;
        format?: RulebookFormat;
        roomCode?: string;
        error?: string;
      }>("/api/rulebooks", {
        signal: abort.signal,
        body: { type: "join-room", roomCode: normalizedCode, name: chosenName },
      });
      if (abort.signal.aborted) return;
      if (!ok || !data.ok || !data.format) {
        const resolved = resolvePlayerError(
          { error: data.error ?? "room-not-found", status },
          { surface: "lobby", action: "join-room", target: normalizedCode },
        );
        modalError.value = { message: resolved.message, tone: resolved.tone };
        return;
      }
      if (!authenticated) saveRememberedGuestName(chosenName);
      const targetCode = data.roomCode ?? normalizedCode;
      onClose(false);
      onJoined(data.format, targetCode);
    } catch (error) {
      if (!abort.signal.aborted) {
        const resolved = resolvePlayerError(error, {
          surface: "lobby",
          action: "join-room",
          target: normalizedCode,
        });
        modalError.value = { message: resolved.message, tone: resolved.tone };
      }
    } finally {
      if (!abort.signal.aborted) {
        joining.value = false;
        codeInputRef.current?.focus({ preventScroll: true });
      }
    }
  }

  return (
    <Dialog
      titleId="quick-join-title"
      title="Gabung Ruang Baru"
      testId="join-room-modal"
      closeLabel="Tutup dialog gabung ruang"
      closeDisabled={joining.value}
      backdropClassName="lobby-dialog-backdrop"
      dialogClassName="lobby-dialog"
      headClassName="lobby-dialog-head"
      closeButtonClassName="secondary lobby-icon-btn"
      onClose={() => onClose(true)}
    >
      <p class="lobby-dialog-body">Masukkan kode undangan baru dari Host (RC-… atau RB-…).</p>
      {modalError.value && (
        <InlineAlert
          message={modalError.value.message}
          tone={modalError.value.tone}
          testId="join-modal-alert"
        />
      )}
      <form
        class="lobby-rename-form"
        data-quick-join-form
        onSubmit={(event) => void handleSubmit(event)}
      >
        <label class="rb-field" style={{ width: "100%" }}>
          <span>Kode Ruang</span>
          <input
            ref={codeInputRef}
            id="cat-join-code"
            name="roomCode"
            type="text"
            autocomplete="off"
            placeholder="RC-XXXXXX atau RB-XXXXXX"
            value={codeDraft.value}
            required
            disabled={joining.value}
            onInput={(event) => {
              const input = event.currentTarget;
              const cleaned = input.value.replace(/\s+/g, "").toUpperCase();
              codeDraft.value = cleaned;
              if (input.value !== cleaned) input.value = cleaned;
            }}
          />
        </label>
        <label class="rb-field" style={{ width: "100%" }}>
          <span>Nama Pemain</span>
          <input
            id="cat-join-name"
            name="name"
            type="text"
            maxLength={32}
            placeholder="Mis. Dina"
            value={nameDraft.value}
            disabled={joining.value}
            onInput={(event) => {
              nameDraft.value = event.currentTarget.value;
            }}
          />
        </label>
        <div class="lobby-dialog-actions" style={{ width: "100%" }}>
          <button
            type="button"
            class="secondary"
            data-quick-join-btn="close"
            disabled={joining.value}
            onClick={() => onClose(true)}
          >
            Batal
          </button>
          <button
            type="submit"
            class="primary"
            data-testid="join-modal-submit"
            disabled={joining.value}
          >
            {joining.value ? "Masuk…" : "Gabung Ruang"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function openQuickJoinRoomDialog(options: {
  authenticatedDisplayName?: string | null;
  authenticated?: boolean;
  onJoined: (format: RulebookFormat, roomCode: string) => void;
}): void {
  closeLobbyDialog();
  const cleanup = mountPreactOverlay((close) => (
    <QuickJoinRoomDialogView
      authenticatedDisplayName={options.authenticatedDisplayName}
      authenticated={options.authenticated}
      onJoined={options.onJoined}
      onClose={(restore) => {
        if (activeDialogClose === cleanup) activeDialogClose = null;
        close(restore);
      }}
    />
  ));
  activeDialogClose = cleanup;
}
