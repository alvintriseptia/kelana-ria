import type { RulebookFormat } from "@kelana-ria/contracts";
import { render } from "preact";
import { getCachedAuth } from "./auth-modal";
import { readRememberedGuestName, saveRememberedGuestName } from "./guest-name";
import { fetchApiJson } from "./player-errors";
import { RulebookInviteView } from "./rulebook-invite-view";

type InviteResponse = {
  status?: "open" | "member" | "full" | "closed";
  format?: RulebookFormat;
  title?: string;
  error?: string;
};

type InviteRoute = {
  roomCode: string;
  format: RulebookFormat;
  open: (format: RulebookFormat, roomCode: string) => void;
  cancel: () => void;
};

export function mountRulebookInvite(root: HTMLElement, route: InviteRoute) {
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const roomCode = route.roomCode.trim().replace(/\s+/g, "").toUpperCase();
  let format = route.format;
  let title: string | undefined;
  let state: "loading" | "ready" | "missing" | "full" | "closed" | "error" = "loading";
  let joining = false;
  let errorMessage: string | undefined;
  const cachedAuth = getCachedAuth();
  let playerName = cachedAuth?.user?.displayName ?? readRememberedGuestName();

  function paint() {
    if (signal.aborted) return;
    render(<RulebookInviteView
      format={format}
      roomCode={roomCode}
      title={title}
      state={state}
      playerName={playerName}
      joining={joining}
      errorMessage={errorMessage}
      onNameChange={name => { playerName = name; paint(); }}
      onConfirm={() => void join()}
      onRetry={() => void readInvite()}
      onCancel={route.cancel}
    />, root);
  }

  async function readInvite() {
    errorMessage = undefined;
    state = "loading";
    paint();
    if (!roomCode) {
      state = "missing";
      paint();
      return;
    }
    try {
      const { ok, status, data } = await fetchApiJson<InviteResponse>(
        `/api/rulebooks/rooms/${encodeURIComponent(roomCode)}/invite`,
        { signal, cache: "no-store" },
      );
      if (signal.aborted) return;
      if (ok && (data.format === "hide-and-seek" || data.format === "claim-the-city")) {
        format = data.format;
        if (data.status === "member") {
          route.open(format, roomCode);
          return;
        }
        title = data.title;
        state = data.status === "open" ? "ready"
          : data.status === "full" || data.status === "closed" ? data.status : "error";
      } else {
        state = status === 404 || data.error === "room-not-found" ? "missing" : "error";
      }
    } catch {
      state = "error";
    }
    paint();
  }

  async function join() {
    if (joining || state !== "ready" || signal.aborted) return;
    joining = true;
    errorMessage = undefined;
    paint();
    const name = playerName.trim();
    try {
      const { ok, data } = await fetchApiJson<{ ok?: boolean; error?: string; format?: RulebookFormat }>(
        "/api/rulebooks", { signal, body: { type: "join-room", roomCode, ...(name ? { name } : {}) } },
      );
      if (signal.aborted) return;
      if (ok && data.ok) {
        if (name && !cachedAuth?.authenticated) saveRememberedGuestName(name);
        route.open(data.format ?? format, roomCode);
        return;
      }
      if (data.error === "room-full" || data.error === "room-not-found" || data.error === "room-already-started") {
        await readInvite();
        return;
      }
      errorMessage = "Belum bisa bergabung. Periksa nama pemain dan coba lagi.";
    } catch {
      errorMessage = "Koneksi terputus. Coba gabung lagi untuk memeriksa kursimu.";
    } finally {
      joining = false;
      paint();
    }
  }

  root.replaceChildren();
  void readInvite();
  root.querySelector<HTMLElement>("#rulebook-invite-heading")?.focus();
  return () => {
    lifetime.abort();
    render(null, root);
  };
}
