import copy from "./locales/id.json" with { type: "json" };
import { mountLandingPage } from "./landing-page";
import { initPwaInstallCapture } from "./pwa-install";
import { mountRulebookCatalog } from "./rulebook-catalog";

export type { GameConfiguration } from "@kelana-ria/contracts";

initPwaInstallCapture();

const guide = document.querySelector<HTMLDialogElement>("#guide")!;
const setup = document.getElementById("setup")!;
const play = document.getElementById("play")!;
let unmountPlay: (() => void) | undefined;
let navigation = 0;
let routeEvents = new AbortController();
const practice = document.querySelector<HTMLDialogElement>("#edition-practice")!;

function navigateRoute(href: string) {
  history.pushState(null, "", href);
  void showRoute(true);
}

function returnToSetup() {
  history.replaceState(null, "", "/catalog");
  void showRoute(true);
}

function openRoom(format: "claim-the-city" | "hide-and-seek", code: string) {
  const query = new URLSearchParams({
    play: format === "hide-and-seek" ? "rulebook-seek" : "rulebook-claim",
    room: code,
  });
  history.pushState({ fromCatalog: true }, "", `/?${query}`);
  void showRoute();
}

function openStudio() {
  history.pushState({ fromChooser: true }, "", "/?play=rulebook-studio");
  void showRoute();
}

async function showRoute(focusHeading = false) {
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
      if (currentNavigation === navigation) {
        play.innerHTML = '<p role="alert">Ringkasan belum bisa dibuka. Muat ulang untuk mencoba lagi.</p><a href="/catalog">Kembali ke katalog</a>';
      }
    }
    return;
  }
  const mode = params.get("play");
  const rulebookSeek = mode === "rulebook-seek";
  const rulebookClaim = mode === "rulebook-claim";
  const rulebookStudio = mode === "rulebook-studio";
  const playing = rulebookSeek || rulebookClaim || rulebookStudio;
  if (!playing && params.has("play")) {
    params.delete("play");
    params.delete("room");
    url.pathname = "/catalog";
    history.replaceState(history.state, "", url);
  }
  setup.hidden = playing;
  play.hidden = !playing;
  if (!playing) {
    play.replaceChildren();
    const isCatalogPath =
      url.pathname === "/catalog" ||
      url.pathname === "/catalog/" ||
      params.has("edition");
    if (isCatalogPath) {
      unmountPlay = mountRulebookCatalog(setup, {
        navigate: navigateRoute,
        openRoom,
        async openPractice(edition, selectedMode) {
          const { mountEditionPractice } = await import("./edition-practice");
          if (currentNavigation === navigation && !practice.open) {
            mountEditionPractice(practice, edition, selectedMode, {
              onReady: () => {
                const primaryCta = setup.querySelector<HTMLButtonElement>(
                  '.cat-actions button.primary:not(:disabled)',
                );
                primaryCta?.focus({ preventScroll: true });
              },
            });
          }
        },
        openStudio,
      }, focusHeading);
    } else {
      unmountPlay = mountLandingPage(setup, {
        navigate: navigateRoute,
        openRoom,
        openStudio,
        openAbout: () => guide.showModal(),
      }, focusHeading);
    }
    return;
  }
  setup.replaceChildren();
  const format = rulebookSeek ? "Hide & Seek" : "Claim the City";
  document.title = rulebookStudio ? "Studio Kreator · Kelana Ria" : `${format} · Kelana Ria`;
  play.innerHTML = `<p class="catalog-loading" role="status">Membuka permainan…</p>`;
  try {
    const mount = rulebookSeek
      ? (await import("./rulebook-seek-play")).mountRulebookSeekPlay
      : rulebookClaim
        ? (await import("./rulebook-claim-play")).mountRulebookClaimPlay
        : (await import("./rulebook-studio")).mountRulebookStudio;
    if (currentNavigation === navigation) unmountPlay = mount(play, returnToSetup);
  } catch {
    if (currentNavigation !== navigation) return;
    play.innerHTML = `<h1>${rulebookStudio ? "Studio Kreator" : format}</h1>
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
  if (location.pathname !== "/" || location.search !== "" || location.hash !== "") {
    navigateRoute("/");
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
