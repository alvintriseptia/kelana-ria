import type { RoomActivityEvent, RoomActivityFeed, RoomActivityNotice } from "@kelana-ria/contracts";
import { escapeText } from "./escape-text";
import "./room-activity.css";

const alertMs = 7500;
const freshMs = 20_000;

type Viewer = { code: string; seatId: string; now: number; turnNumber?: number; outcome?: unknown };
type Cursor = { sequence: number; prompts: string[] };

function readCursor(key: string): Cursor | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const value = JSON.parse(raw) as Partial<Cursor>;
      if (Number.isSafeInteger(value.sequence) && Array.isArray(value.prompts)) return value as Cursor;
    }
  } catch { /* Storage can be unavailable in private browsing. */ }
  return undefined;
}

export type PositionFreshness = "fresh" | "aging" | "stale";

export function freshnessBucket(at: number, now: number): PositionFreshness {
  const ageMs = Math.max(0, now - at);
  if (ageMs < 30_000) return "fresh";
  if (ageMs <= 120_000) return "aging";
  return "stale";
}

export function formatRelativeAge(at: number, now: number, stalePrefix = false): string {
  const seconds = Math.floor(Math.max(0, now - at) / 1000);
  if (seconds < 10) return "Baru saja";
  if (seconds < 60) return `${seconds} dtk lalu`;
  const minutes = Math.floor(seconds / 60);
  const label = minutes < 60 ? `${minutes} mnt lalu` : `${Math.floor(minutes / 60)} jam lalu`;
  return stalePrefix && seconds > 120 ? `Terakhir dilihat ${label}` : label;
}

export function renderRoomActivity(feed: RoomActivityFeed, now?: number): string {
  const refNow = now ?? Date.now();
  return `<section aria-label="Aktivitas terbaru">
    <h2 tabindex="-1" data-activity-heading>Aktivitas terbaru</h2>
    ${feed.events.length ? `<ol class="room-activity-list">${feed.events.slice().reverse().map(event =>
    `<li data-activity-event="${event.sequence}"><span class="room-activity-text">${escapeText(event.text)}</span><time class="room-activity-age" data-activity-at="${event.at}">${escapeText(formatRelativeAge(event.at, refNow))}</time></li>`).join("")}</ol>`
    : "<p>Belum ada aktivitas.</p>"}
  </section>`;
}

export function createRoomActivityUi(
  signal: AbortSignal,
  open: (notice: RoomActivityNotice | "activity") => void,
  onLiveEvents?: (events: RoomActivityEvent[]) => void,
) {
  let key = "";
  let cursor: Cursor | undefined;
  let prompt: RoomActivityNotice | null = null;
  let brief: RoomActivityNotice | null = null;
  let briefTurn: number | undefined;
  let pendingAnnouncement = "";
  let displayKey = "";
  let dismissTimer: number | undefined;
  let host: HTMLElement | null = null;

  function display() {
    if (!host) return;
    const visible = prompt ?? brief;
    const next = visible ? JSON.stringify(visible) : "";
    if (next === displayKey && host.querySelector("[data-activity-message]")) return;
    let region = host.querySelector<HTMLElement>("[data-activity-announcement]");
    if (!region) {
      region = document.createElement("span");
      region.className = "sr-only";
      region.dataset.activityAnnouncement = "";
      region.setAttribute("role", "status");
      region.setAttribute("aria-atomic", "true");
      host.append(region);
    }
    let content = host.querySelector<HTMLElement>("[data-activity-message]");
    if (!content) {
      content = document.createElement("div");
      content.dataset.activityMessage = "";
      content.className = "room-activity-message";
      host.append(content);
    }
    if (visible) {
      content.innerHTML = `<span id="room-activity-copy"><span class="room-activity-mark" aria-hidden="true">${prompt ? "◆" : "◈"}</span> ${escapeText(visible.text)}</span>
        <button type="button" data-activity-open aria-describedby="room-activity-copy">${visible.id === "catch-up" ? "Aktivitas" : "Buka"}</button>
        ${prompt ? "" : '<button type="button" data-activity-dismiss aria-label="Tutup kabar permainan">×</button>'}`;
      content.dataset.noticeKind = visible.kind;
      content.dataset.noticeId = visible.id;
    } else {
      content.replaceChildren();
    }
    content.hidden = !visible;
    if (pendingAnnouncement || !visible) region.textContent = pendingAnnouncement;
    pendingAnnouncement = "";
    displayKey = next;
  }

  function clearBrief() {
    window.clearTimeout(dismissTimer);
    brief = null;
    briefTurn = undefined;
  }

  function present(event: RoomActivityNotice, turn?: number) {
    clearBrief();
    brief = event;
    briefTurn = turn;
    dismissTimer = window.setTimeout(() => {
      clearBrief();
      display();
    }, alertMs);
  }

  function chooseAlert(events: RoomActivityEvent[], viewer: Viewer) {
    const eligible = events.filter(event => event.alert && viewer.now - event.at <= freshMs &&
      (event.turn === undefined || event.turn === viewer.turnNumber));
    return eligible.at(-1);
  }

  function update(viewer?: Viewer, feed?: RoomActivityFeed) {
    const nextKey = viewer ? `kelana-room-activity:${viewer.code}:${viewer.seatId}` : "";
    const changedRoom = key !== nextKey;
    if (changedRoom) {
      clearBrief();
      prompt = null;
      pendingAnnouncement = "";
      key = nextKey;
      cursor = key ? readCursor(key) : undefined;
    }
    if (!viewer || !feed || (cursor && feed.sequence < cursor.sequence)) return;
    const previousSequence = cursor?.sequence ?? feed.sequence;
    const fresh = feed.events.filter(event => event.sequence > previousSequence);
    if (!changedRoom && fresh.length) {
      onLiveEvents?.(fresh.filter(event => viewer.now - event.at <= 8000 &&
        (event.turn === undefined || event.turn === viewer.turnNumber)));
    }
    const newPrompt = !viewer.outcome && feed.prompt && (feed.prompt.deadline === undefined || feed.prompt.deadline > viewer.now)
      ? feed.prompt : null;
    const seenPrompts = cursor?.prompts ?? [];
    const newPromptId = newPrompt && !seenPrompts.includes(newPrompt.id) ? newPrompt.id : "";
    const promptChanged = newPrompt?.id !== prompt?.id;
    prompt = newPrompt;
    if (viewer.outcome || (briefTurn !== undefined && briefTurn !== viewer.turnNumber) || promptChanged) clearBrief();

    if (!viewer.outcome && !prompt) {
      const alert = chooseAlert(fresh, viewer);
      if (fresh.length > 1 && (alert || fresh.some(event => viewer.now - event.at > freshMs))) {
        present({ id: "catch-up", kind: "round-start", panel: "board", text: "Ada beberapa perubahan. Lihat aktivitas terbaru." }, viewer.turnNumber);
      } else if (alert) {
        present(alert, alert.turn);
      }
      if (brief && (alert || brief.id === "catch-up" && fresh.length > 1)) pendingAnnouncement = brief.text;
    }
    if (newPromptId && prompt) pendingAnnouncement = prompt.text;
    if (feed.sequence !== cursor?.sequence || newPromptId) {
      cursor = { sequence: feed.sequence, prompts: newPromptId ? [...seenPrompts, newPromptId].slice(-24) : seenPrompts };
      try { localStorage.setItem(key, JSON.stringify(cursor)); } catch { /* Rendering still works without storage. */ }
    }
  }

  function mount(target: HTMLElement | null, belowMapResult = false) {
    if (host !== target) {
      host = target;
      displayKey = "";
      host?.addEventListener("click", event => {
        const button = (event.target as HTMLElement).closest("button");
        if (button?.hasAttribute("data-activity-open")) {
          const chosen = prompt ?? brief;
          if (chosen) {
            clearBrief();
            open(chosen.id === "catch-up" ? "activity" : chosen);
            display();
          }
        } else if (button?.hasAttribute("data-activity-dismiss")) {
          clearBrief();
          display();
        }
      }, { signal });
    }
    target?.toggleAttribute("data-below-result", belowMapResult);
    display();
  }

  signal.addEventListener("abort", clearBrief, { once: true });
  return { update, mount };
}
