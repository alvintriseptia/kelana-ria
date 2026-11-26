import "./pwa-install.css";

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms?: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
  prompt(): Promise<void>;
}

const DISMISSED_STORAGE_KEY = "kelana-pwa-install-dismissed";

let initialized = false;
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // Keep listeners isolated.
    }
  }
}

export function isStandaloneMode(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  return Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

export function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIosDevice =
    /iPad|iPhone|iPod/i.test(ua) ||
    (/Macintosh/i.test(ua) && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1);
  if (!isIosDevice) return false;
  const isOtherIosBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(ua);
  const isSafariEngine = /WebKit/i.test(ua) && /Safari/i.test(ua);
  return isSafariEngine && !isOtherIosBrowser;
}

export function isPwaInstallDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissPwaInstallPrompt(): void {
  try {
    localStorage.setItem(DISMISSED_STORAGE_KEY, "1");
  } catch {
    // Ignore storage failures in restricted contexts.
  }
  notifyListeners();
}

export function initPwaInstallCapture(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  window.addEventListener("beforeinstallprompt", (event) => {
    const installEvent = event as BeforeInstallPromptEvent;
    if (typeof installEvent.prompt !== "function") return;
    event.preventDefault();
    deferredPrompt = installEvent;
    notifyListeners();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notifyListeners();
  });

  window.matchMedia?.("(display-mode: standalone)").addEventListener?.("change", () => {
    notifyListeners();
  });
}

type InstallPromptMode = "native" | "ios" | "none";

function currentPromptMode(): InstallPromptMode {
  if (isStandaloneMode() || isPwaInstallDismissed()) return "none";
  if (deferredPrompt) return "native";
  if (isIosSafari()) return "ios";
  return "none";
}

let activeIosDialogClose: (() => void) | null = null;

export function openIosInstallGuideDialog(): void {
  activeIosDialogClose?.();

  const abort = new AbortController();
  const { signal } = abort;
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const backdrop = document.createElement("div");
  backdrop.className = "pwa-dialog-backdrop";
  backdrop.dataset.testid = "pwa-ios-dialog";

  function close(restoreFocus = true) {
    if (signal.aborted) return;
    abort.abort();
    backdrop.remove();
    if (activeIosDialogClose === close) activeIosDialogClose = null;
    if (restoreFocus && previousFocus?.isConnected) {
      previousFocus.focus({ preventScroll: true });
    }
  }
  activeIosDialogClose = () => close(false);

  backdrop.innerHTML = `<section class="pwa-dialog" role="dialog" aria-modal="true" aria-labelledby="pwa-ios-title">
    <div class="pwa-dialog-head">
      <div class="pwa-dialog-brand">
        <img src="/icons/icon-192.png" width="32" height="32" alt="">
        <h2 id="pwa-ios-title">Pasang di iPhone</h2>
      </div>
      <button type="button" class="secondary pwa-dialog-close" data-ios-btn="close" aria-label="Tutup panduan pasang di iPhone">×</button>
    </div>
    <p class="pwa-dialog-lead">Simpan Kelana Ria ke Layar Utama supaya langsung masuk ke Katalog seperti aplikasi penuh.</p>
    <ol class="pwa-ios-steps">
      <li class="pwa-ios-step">
        <span class="pwa-ios-ico" aria-hidden="true">
          <svg viewBox="0 0 28 28"><rect x="5" y="11" width="18" height="13" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 4v11M9.5 8.5 14 4l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        <div>
          <strong>1. Ketuk ikon Bagikan</strong>
          <span>Buka tombol Bagikan di bilah bawah Safari.</span>
        </div>
      </li>
      <li class="pwa-ios-step">
        <span class="pwa-ios-ico" aria-hidden="true">
          <svg viewBox="0 0 28 28"><rect x="4" y="4" width="20" height="20" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 9v10M9 14h10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
        </span>
        <div>
          <strong>2. Pilih Tambah ke Layar Utama</strong>
          <span>Gulir menu lalu ketuk <em>Tambah</em> di kanan atas.</span>
        </div>
      </li>
    </ol>
    <div class="pwa-dialog-actions">
      <button type="button" class="secondary" data-ios-btn="dismiss" data-testid="pwa-ios-dismiss">Jangan tampilkan lagi</button>
      <button type="button" class="primary" data-ios-btn="close" data-testid="pwa-ios-done">Mengerti</button>
    </div>
  </section>`;

  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) return close(true);
    const btn = (event.target as Element | null)?.closest<HTMLButtonElement>("[data-ios-btn]");
    if (!btn) return;
    if (btn.dataset.iosBtn === "dismiss") {
      dismissPwaInstallPrompt();
      close(false);
    } else if (btn.dataset.iosBtn === "close") {
      close(true);
    }
  }, { signal });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    }
  }, { signal });

  document.body.appendChild(backdrop);
  backdrop.querySelector<HTMLButtonElement>('[data-ios-btn="close"]')?.focus({ preventScroll: true });
}

export function mountPwaInstallPrompt(container: HTMLElement, signal: AbortSignal): void {
  initPwaInstallCapture();
  let prompting = false;

  function render() {
    if (signal.aborted) return;
    const mode = currentPromptMode();
    if (mode === "none") {
      container.hidden = true;
      container.replaceChildren();
      return;
    }
    container.hidden = false;
    const isNative = mode === "native";
    container.innerHTML = `<aside class="pwa-banner" aria-label="Pasang aplikasi Kelana Ria" data-testid="pwa-install-banner" data-install-mode="${mode}">
      <div class="pwa-banner-info">
        <img src="/icons/icon-192.png" width="32" height="32" alt="">
        <div class="pwa-banner-copy">
          <strong>Pasang Kelana Ria</strong>
          <span>${isNative ? "Buka katalog cepat langsung dari layar utama." : "Tambahkan ke Layar Utama untuk layar penuh."}</span>
        </div>
      </div>
      <div class="pwa-banner-actions">
        <button type="button" class="secondary pwa-banner-cta" data-pwa-action="${isNative ? "install" : "ios-guide"}" data-testid="${isNative ? "pwa-install-trigger" : "pwa-ios-trigger"}" ${prompting ? "disabled" : ""}>${isNative ? "Pasang Aplikasi" : "Pasang di iPhone"}</button>
        <button type="button" class="secondary pwa-banner-dismiss" data-pwa-action="dismiss" data-testid="pwa-install-dismiss" aria-label="Tutup ajakan pasang aplikasi">×</button>
      </div>
    </aside>`;
  }

  container.addEventListener("click", (event) => {
    const btn = (event.target as Element | null)?.closest<HTMLButtonElement>("[data-pwa-action]");
    if (!btn || prompting) return;
    const action = btn.dataset.pwaAction;
    if (action === "dismiss") {
      dismissPwaInstallPrompt();
      return;
    }
    if (action === "ios-guide") {
      openIosInstallGuideDialog();
      return;
    }
    if (action === "install" && deferredPrompt) {
      const promptEvent = deferredPrompt;
      prompting = true;
      render();
      void (async () => {
        try {
          await promptEvent.prompt();
          await promptEvent.userChoice;
        } catch {
          // Ignore rejected or already-consumed install prompts.
        } finally {
          deferredPrompt = null;
          prompting = false;
          notifyListeners();
        }
      })();
    }
  }, { signal });

  listeners.add(render);
  signal.addEventListener("abort", () => {
    listeners.delete(render);
  }, { once: true });

  render();
}
