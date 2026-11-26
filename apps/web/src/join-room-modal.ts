import type { AuthMeReply, RulebookFormat } from "@kelana-ria/contracts";
import { escapeText } from "./escape-text";
import { resolveDefaultPlayerName, saveRememberedGuestName } from "./guest-name";
import { fetchApiJson, resolvePlayerError, type PlayerErrorTone } from "./player-errors";
import { renderInlineAlert } from "./player-toast";

export type OpenJoinRoomModalOptions = {
  signal: AbortSignal;
  authState: AuthMeReply | null;
  onJoined: (format: RulebookFormat, roomCode: string) => void;
};

export function openJoinRoomModal(options: OpenJoinRoomModalOptions): void {
  const modalAbort = new AbortController();
  const onParentAbort = () => modalAbort.abort();
  options.signal.addEventListener("abort", onParentAbort, { once: true });
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const backdrop = document.createElement("div");
  backdrop.className = "cat-modal-backdrop";
  backdrop.dataset.testid = "join-room-modal";

  let codeDraft = "";
  let nameDraft = resolveDefaultPlayerName(options.authState?.user?.displayName, "");
  let joining = false;
  let modalError: { message: string; tone: PlayerErrorTone } | null = null;

  function close(restoreFocus = true) {
    if (modalAbort.signal.aborted) return;
    options.signal.removeEventListener("abort", onParentAbort);
    modalAbort.abort();
    backdrop.remove();
    if (restoreFocus && previousFocus?.isConnected) {
      previousFocus.focus({ preventScroll: true });
    }
  }

  function renderModal() {
    if (modalAbort.signal.aborted) return;
    backdrop.innerHTML = `<section class="cat-modal" role="dialog" aria-modal="true" aria-labelledby="cat-join-title">
      <div class="cat-modal-head">
        <h2 id="cat-join-title">Gabung Ruang</h2>
        <button type="button" class="secondary cat-modal-close" data-join-btn="close" aria-label="Tutup dialog gabung ruang" ${joining ? "disabled" : ""}>×</button>
      </div>
      <p class="cat-modal-note">Masukkan kode undangan Claim the City (RC-…) atau Hide &amp; Seek (RB-…) dari Host.</p>
      ${modalError ? renderInlineAlert(modalError.message, modalError.tone, 'data-testid="join-modal-alert"') : ""}
      <form class="cat-modal-form" data-join-form>
        <label class="cat-modal-field">
          <span>Kode Ruang</span>
          <input id="cat-join-code" class="cat-modal-code-input" name="roomCode" type="text" autocomplete="off" placeholder="RC-XXXXXX atau RB-XXXXXX" value="${escapeText(codeDraft)}" required ${joining ? "disabled" : ""}>
        </label>
        <label class="cat-modal-field">
          <span>Nama Pemain</span>
          <input id="cat-join-name" name="name" type="text" maxlength="32" placeholder="Mis. Dina" value="${escapeText(nameDraft)}" ${joining ? "disabled" : ""}>
        </label>
        <div class="cat-modal-actions">
          <button type="button" class="secondary" data-join-btn="close" ${joining ? "disabled" : ""}>Batal</button>
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
      renderModal();
      backdrop.querySelector<HTMLInputElement>("#cat-join-code")?.focus({ preventScroll: true });
      return;
    }
    const chosenName = nameDraft.trim() || resolveDefaultPlayerName(options.authState?.user?.displayName, "Pemain");
    joining = true;
    modalError = null;
    renderModal();
    try {
      const { ok, status, data } = await fetchApiJson<{
        ok?: boolean;
        format?: RulebookFormat;
        roomCode?: string;
        error?: string;
      }>("/api/rulebooks", {
        signal: modalAbort.signal,
        body: { type: "join-room", roomCode: normalizedCode, name: chosenName },
      });
      if (modalAbort.signal.aborted) return;
      if (!ok || !data.ok || !data.format) {
        const resolved = resolvePlayerError(
          { error: data.error ?? "room-not-found", status },
          { surface: "lobby", action: "join-room", target: normalizedCode },
        );
        modalError = { message: resolved.message, tone: resolved.tone };
        return;
      }
      if (!options.authState?.authenticated) saveRememberedGuestName(chosenName);
      const targetCode = data.roomCode ?? normalizedCode;
      close(false);
      options.onJoined(data.format, targetCode);
    } catch (error) {
      if (!modalAbort.signal.aborted) {
        const resolved = resolvePlayerError(error, { surface: "lobby", action: "join-room", target: normalizedCode });
        modalError = { message: resolved.message, tone: resolved.tone };
      }
    } finally {
      if (!modalAbort.signal.aborted) {
        joining = false;
        renderModal();
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
  }, { signal: modalAbort.signal });

  backdrop.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!joining) void submitJoin();
  }, { signal: modalAbort.signal });

  backdrop.addEventListener("click", (event) => {
    const target = event.target;
    if (target === backdrop && !joining) return close(true);
    if (!(target instanceof Element)) return;
    if (target.closest('[data-join-btn="close"]') && !joining) close(true);
  }, { signal: modalAbort.signal });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !joining) {
      event.preventDefault();
      close(true);
    }
  }, { signal: modalAbort.signal });

  renderModal();
  document.body.appendChild(backdrop);
  backdrop.querySelector<HTMLInputElement>("#cat-join-code")?.focus({ preventScroll: true });
}
