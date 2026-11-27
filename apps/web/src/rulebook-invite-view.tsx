import type { RulebookFormat } from "@kelana-ria/contracts";
import { formatHeroCardSvg } from "./format-art";
import { InlineAlert } from "./ui/InlineAlert";
import "./player-toast.css";
import "./rulebook-invite.css";

const inviteErrors = {
  missing: "Ruang tidak ditemukan. Minta Host mengirim tautan undangan yang baru.",
  full: "Ruang sudah penuh. Coba lagi jika ada tempat kosong, atau minta Host membuat ruang baru.",
  closed: "Ruang sudah ditutup untuk pemain baru. Minta Host mengundangmu ke ruang baru.",
  error: "Undangan belum bisa dibuka. Periksa koneksi, lalu coba lagi.",
};

export function RulebookInviteView({
  format,
  roomCode,
  title,
  state,
  playerName,
  joining = false,
  errorMessage,
  onNameChange,
  onConfirm,
  onRetry,
  onCancel,
}: {
  format: RulebookFormat;
  roomCode: string;
  title?: string;
  state: "loading" | "ready" | "missing" | "full" | "closed" | "error";
  playerName: string;
  joining?: boolean;
  errorMessage?: string;
  onNameChange: (name: string) => void;
  onConfirm: () => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const ready = state === "ready";
  const unavailable = !ready && state !== "loading";
  const message = errorMessage ?? (unavailable ? inviteErrors[state] : undefined);

  return (
    <section
      class="rulebook-invite"
      aria-labelledby="rulebook-invite-heading"
      data-testid="rulebook-invite"
      data-invite-state={state}
    >
      <h1 id="rulebook-invite-heading" tabIndex={-1}>Undangan Ruang</h1>
      <div class="rulebook-invite-room">
        <span
          class="rulebook-invite-art"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: formatHeroCardSvg(format) }}
        />
        <div class="rulebook-invite-details">
          <p>{format === "hide-and-seek" ? "Hide & Seek" : "Claim the City"}</p>
          {title && <h2>{title}</h2>}
          <p class="rulebook-invite-code">Kode ruang <code>{roomCode}</code></p>
        </div>
      </div>
      <p class="rulebook-invite-status" role="status">
        {state === "loading" ? "Memeriksa ruang…" : ready ? "Ruang terbuka untuk pemain baru." : null}
      </p>
      {message && <InlineAlert message={message} />}
      <form
        class="rulebook-invite-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && !joining) onConfirm();
        }}
      >
        {ready && (
          <label class="rulebook-invite-field">
            <span>Nama Pemain</span>
            <input
              id="rb-join-name"
              name="name"
              type="text"
              autocomplete="nickname"
              maxLength={32}
              placeholder="Mis. Dina"
              value={playerName}
              disabled={joining}
              onInput={(event) => onNameChange(event.currentTarget.value)}
            />
          </label>
        )}
        <div class="rulebook-invite-actions">
          <button
            type="button"
            class="secondary"
            data-action="cancel-invite"
            disabled={joining}
            onClick={onCancel}
          >
            {unavailable ? "Kembali ke Katalog" : "Batal"}
          </button>
          {ready && (
            <button
              id="rb-join-btn"
              type="submit"
              class="primary"
              data-action="join-room"
              disabled={joining}
            >
              {joining ? "Masuk…" : "Gabung Ruang"}
            </button>
          )}
          {unavailable && (
            <button type="button" class="primary" data-action="retry-invite" onClick={onRetry}>
              Coba Lagi
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
