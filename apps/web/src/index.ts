import copy from "./locales/id.json" with { type: "json" };
import { mountRulebookCatalog } from "./rulebook-catalog";

export type { GameConfiguration } from "@kelana-ria/contracts";

const guide = document.querySelector<HTMLDialogElement>("#guide")!;
const setup = document.getElementById("setup")!;
const play = document.getElementById("play")!;
let unmountPlay: (() => void) | undefined;
let navigation = 0;
let routeEvents = new AbortController();
const practice = document.querySelector<HTMLDialogElement>("#edition-practice")!;

function navigateCatalog(href: string) {
  history.pushState(null, "", href);
  void showRoute(true);
}

function returnToSetup() {
  if (history.state?.fromChooser) {
    history.back();
    return;
  }
  history.replaceState(null, "", "/");
  void showRoute(true);
}

async function showRoute(focusCatalog = false) {
  const currentNavigation = ++navigation;
  routeEvents.abort();
  routeEvents = new AbortController();
  unmountPlay?.();
  unmountPlay = undefined;
  if (practice.open) practice.close();
  const url = new URL(location.href);
  const params = url.searchParams;
  if (params.has("recap") || params.has("recaps") || params.has("shared")) {
    setup.hidden = true;
    play.hidden = false;
    const sharedId = params.get("shared");
    play.innerHTML = `<p role="status">${sharedId ? "Membuka ringkasan komunitas…" : "Membuka riwayat…"}</p>`;
    try {
      const { mountRulebookRecap } = await import("./rulebook-recap");
      if (currentNavigation === navigation) mountRulebookRecap(play, params.get("recap"), routeEvents.signal, sharedId);
    } catch {
      if (currentNavigation === navigation) play.innerHTML = '<p role="alert">Ringkasan belum bisa dibuka. Muat ulang untuk mencoba lagi.</p><a href="/">Kembali ke katalog</a>';
    }
    return;
  }
  const requestedSeek = params.get("play") === "hide-and-seek";
  const rawBoard = params.get("board");
  const validBoard = rawBoard === null || rawBoard === "compact" || rawBoard === "jakarta-wide";
  const unsupportedSeek = requestedSeek && (
    (params.has("players") && params.get("players") !== "2") ||
    !validBoard ||
    (params.has("format") && params.get("format") !== "hide-and-seek")
  );
  if (unsupportedSeek) {
    params.delete("play");
    params.delete("room");
    history.replaceState(null, "", url);
  } else if (requestedSeek) {
    params.set("players", "2");
    params.set("format", "hide-and-seek");
    params.set("board", rawBoard === "jakarta-wide" ? "jakarta-wide" : "compact");
    history.replaceState(history.state, "", url);
  }
  const mode = params.get("play");
  const seeking = mode === "hide-and-seek";
  const rulebookSeek = mode === "rulebook-seek";
  const rulebookClaim = mode === "rulebook-claim";
  const rulebookStudio = mode === "rulebook-studio";
  const playing =
    mode === "solo-claim" ||
    mode === "duo-claim" ||
    seeking ||
    mode === "creator-packs" ||
    rulebookSeek ||
    rulebookClaim ||
    rulebookStudio;
  if (!playing && params.has("play")) {
    params.delete("play");
    params.delete("room");
    history.replaceState(history.state, "", url);
  }
  setup.hidden = playing;
  play.hidden = !playing;
  if (!playing) {
    play.replaceChildren();
    unmountPlay = mountRulebookCatalog(setup, {
      navigate: navigateCatalog,
      openRoom: (format, code) => {
        const query = new URLSearchParams({
          play: format === "hide-and-seek" ? "rulebook-seek" : "rulebook-claim",
          room: code,
        });
        history.pushState({ fromCatalog: true }, "", `/?${query}`);
        void showRoute();
      },
      async openPractice(edition, mode) {
        const { mountEditionPractice } = await import("./edition-practice");
        if (currentNavigation === navigation && !practice.open) mountEditionPractice(practice, edition, mode);
      },
      openStudio: () => {
        history.pushState({ fromChooser: true }, "", "/?play=rulebook-studio");
        void showRoute();
      },
    }, focusCatalog);
    return;
  }
  setup.replaceChildren();
  const format = seeking || rulebookSeek ? "Hide & Seek" : "Claim the City";
  const boardLabel = params.get("board") === "jakarta-wide" ? "Jakarta (Wide)" : "Jakarta (Compact)";
  document.title =
    mode === "creator-packs"
      ? "Paket Kreator · Kelana Ria"
      : rulebookStudio
        ? "Studio Kreator · Kelana Ria"
        : `${format} · Kelana Ria`;
  const hasOwnShell = rulebookStudio || rulebookSeek || rulebookClaim;
  const heading = mode === "creator-packs"
    ? '<h1>Paket Kreator Jakarta</h1><p class="intro">Jakarta (Compact) · Claim the City · Tinjauan &amp; Katalog</p>'
    : hasOwnShell
      ? ""
      : `<h1 lang="en">${format}</h1><p class="intro">${boardLabel} · ${mode === "solo-claim" ? "Solo" : "Berdua"} · Gratis</p>`;
  play.innerHTML = `${heading}<p class="catalog-loading" role="status">Membuka permainan…</p>`;
  try {
    const mount = seeking ? (await import("./seek-play")).mountSeekPlay
      : rulebookSeek ? (await import("./rulebook-seek-play")).mountRulebookSeekPlay
      : rulebookClaim ? (await import("./rulebook-claim-play")).mountRulebookClaimPlay
      : rulebookStudio ? (await import("./rulebook-studio")).mountRulebookStudio
      : mode === "creator-packs" ? (await import("./pack-play")).mountPackPlay
      : mode === "duo-claim" ? (await import("./duo-play")).mountDuoPlay
      : (await import("./solo-play")).mountSoloPlay;
    if (currentNavigation === navigation) unmountPlay = mount(play, returnToSetup);
  } catch {
    if (currentNavigation !== navigation) return;
    const fallbackHeading = heading || `<h1>${rulebookStudio ? "Studio Kreator" : format}</h1>`;
    play.innerHTML = `${fallbackHeading}
      <p class="intro" role="alert">Permainan belum bisa dibuka. Periksa koneksi lalu coba lagi.</p>
      <button id="play-reload" class="secondary" type="button">Coba lagi</button>
      <button id="play-back" class="secondary" type="button">Kembali ke katalog</button>`;
    const { signal } = routeEvents;
    const retry = () => location.reload();
    play.querySelector<HTMLButtonElement>("#play-reload")!.addEventListener("click", retry, { signal });
    play.querySelector<HTMLButtonElement>("#play-back")!.addEventListener("click", returnToSetup, { signal });
    window.addEventListener("online", retry, { once: true, signal });
  }
}

for (const [key, value] of Object.entries(copy)) {
  document.querySelectorAll<HTMLElement>(`[data-copy="${key}"]`).forEach(el => { el.textContent = value; });
}
document.querySelector<HTMLAnchorElement>("a.brand")?.addEventListener("click", event => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (location.pathname !== "/" || location.search !== "") {
    navigateCatalog("/");
  } else {
    void showRoute(true);
  }
});
document.getElementById("guide-open")!.addEventListener("click", () => guide.showModal());
window.addEventListener("popstate", () => void showRoute());
void showRoute();
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(error => console.warn("PWA offline setup:", error));
  });
}
