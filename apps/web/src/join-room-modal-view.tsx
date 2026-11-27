import type { AuthMeReply, RulebookFormat } from "@kelana-ria/contracts";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { resolveDefaultPlayerName, saveRememberedGuestName } from "./guest-name";
import { fetchApiJson, resolvePlayerError, type PlayerErrorTone } from "./player-errors";
import { Dialog } from "./ui/Dialog";
import { mountPreactOverlay } from "./ui/mount";

export type OpenJoinRoomModalOptions = {
  signal: AbortSignal;
  authState: AuthMeReply | null;
  onJoined: (format: RulebookFormat, roomCode: string) => void;
};

const toneIcons: Record<PlayerErrorTone, string> = {
  warn: "▲",
  error: "◆",
  info: "●",
};

function JoinRoomModal({
  authState,
  parentSignal,
  onJoined,
  onClose,
}: {
  authState: AuthMeReply | null;
  parentSignal: AbortSignal;
  onJoined: (format: RulebookFormat, roomCode: string) => void;
  onClose: (restoreFocus?: boolean) => void;
}) {
  const codeDraft = useSignal("");
  const nameDraft = useSignal(resolveDefaultPlayerName(authState?.user?.displayName, ""));
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
      nameDraft.value.trim() || resolveDefaultPlayerName(authState?.user?.displayName, "Pemain");
    joining.value = true;
    modalError.value = null;

    const requestAbort = new AbortController();
    submitAbortRef.current = requestAbort;
    const onParentAbort = () => requestAbort.abort();
    parentSignal.addEventListener("abort", onParentAbort, { once: true });

    try {
      const { ok, status, data } = await fetchApiJson<{
        ok?: boolean;
        format?: RulebookFormat;
        roomCode?: string;
        error?: string;
      }>("/api/rulebooks", {
        signal: requestAbort.signal,
        body: { type: "join-room", roomCode: normalizedCode, name: chosenName },
      });
      if (requestAbort.signal.aborted) return;
      if (!ok || !data.ok || !data.format) {
        const resolved = resolvePlayerError(
          { error: data.error ?? "room-not-found", status },
          { surface: "lobby", action: "join-room", target: normalizedCode },
        );
        modalError.value = { message: resolved.message, tone: resolved.tone };
        return;
      }
      if (!authState?.authenticated) saveRememberedGuestName(chosenName);
      const targetCode = data.roomCode ?? normalizedCode;
      onClose(false);
      onJoined(data.format, targetCode);
    } catch (error) {
      if (!requestAbort.signal.aborted) {
        const resolved = resolvePlayerError(error, {
          surface: "lobby",
          action: "join-room",
          target: normalizedCode,
        });
        modalError.value = { message: resolved.message, tone: resolved.tone };
      }
    } finally {
      parentSignal.removeEventListener("abort", onParentAbort);
      if (!requestAbort.signal.aborted) {
        joining.value = false;
        codeInputRef.current?.focus({ preventScroll: true });
      }
    }
  }

  const err = modalError.value;
  return (
    <Dialog
      titleId="cat-join-title"
      title="Gabung Ruang"
      testId="join-room-modal"
      closeLabel="Tutup dialog gabung ruang"
      closeDisabled={joining.value}
      onClose={() => onClose(true)}
    >
      <p class="cat-modal-note">
        Masukkan kode undangan Claim the City (RC-…) atau Hide &amp; Seek (RB-…) dari Host.
      </p>
      {err && (
        <p
          class={`pt-inline-alert pt-inline-alert--${err.tone}`}
          role="alert"
          aria-atomic="true"
          data-testid="join-modal-alert"
        >
          <span class="pt-inline-alert-mark" aria-hidden="true">
            {toneIcons[err.tone]}
          </span>
          <span>{err.message}</span>
        </p>
      )}
      <form class="cat-modal-form" data-join-form onSubmit={(event) => void handleSubmit(event)}>
        <label class="cat-modal-field">
          <span>Kode Ruang</span>
          <input
            ref={codeInputRef}
            id="cat-join-code"
            class="cat-modal-code-input"
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
        <label class="cat-modal-field">
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
        <div class="cat-modal-actions">
          <button
            type="button"
            class="secondary"
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

export function openJoinRoomModalView(options: OpenJoinRoomModalOptions): () => void {
  return mountPreactOverlay(
    (close) => (
      <JoinRoomModal
        authState={options.authState}
        parentSignal={options.signal}
        onJoined={options.onJoined}
        onClose={close}
      />
    ),
    { signal: options.signal },
  );
}
