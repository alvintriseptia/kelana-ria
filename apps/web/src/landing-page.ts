import type {
  ActiveRulebookRoomPhase,
  ActiveRulebookRoomSummary,
  AuthMeReply,
  RulebookFormat,
} from "@kelana-ria/contracts";
import { dismissActiveRoom, readStoredActiveRoom } from "./active-room-storage";
import { fetchAuthMe, getCachedAuth, onAuthChange, openAuthModal, renderAccountChip } from "./auth-modal";
import { escapeText } from "./escape-text";
import { formatHeroCardSvg } from "./format-art";
import { openJoinRoomModal } from "./join-room-modal";
import { mountPwaInstallPrompt } from "./pwa-install";
import { getCachedDemoVideoYoutubeId, resolveDemoVideoYoutubeId } from "./runtime-config";
import claimDemoPoster from "./assets/claim-demo-poster.webp";
import jakartaCover from "./assets/jakarta.webp";
import "./landing-page.css";

export type LandingPageOptions = {
  navigate: (href: string) => void;
  openRoom: (format: RulebookFormat, code: string) => void;
  openStudio: () => void;
  openAbout: () => void;
};

const formatNames: Record<RulebookFormat, string> = {
  "claim-the-city": "Claim the City",
  "hide-and-seek": "Hide & Seek",
};

const resumePhaseLabels: Record<ActiveRulebookRoomPhase, string> = {
  lobby: "Ruang Tunggu",
  active: "Ronde Aktif",
  head_start: "Waktu Sembunyi",
  seeking: "Fase Cari",
  endgame: "Endgame",
  regroup: "Berkumpul Kembali",
};

function cleanTitle(title: string, format: RulebookFormat): string {
  const separator = ` · ${formatNames[format]}`;
  const index = title.lastIndexOf(separator);
  const suffix = title.slice(index + separator.length);
  return index > 0 && (suffix === "" || /^ \([^)]+\)$/.test(suffix))
    ? title.slice(0, index) + suffix
    : title;
}

function renderLandingResumeBanner(room: ActiveRulebookRoomSummary): string {
  const title = cleanTitle(room.title, room.format);
  const meta = [
    `v${room.version}`,
    room.format === "claim-the-city"
      ? room.role === "solo"
        ? "Solo"
        : "Grup"
      : room.turnNumber && room.totalPlannedTurns
        ? `Giliran ${room.turnNumber}/${room.totalPlannedTurns}`
        : "",
    room.role === "hider" ? "Penyembunyi" : room.role === "seeker" ? "Pencari" : "",
    room.role !== "solo" && room.playerCount && room.maxPlayers ? `${room.playerCount}/${room.maxPlayers} pemain` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return `<section class="cat-resume lp-resume" aria-label="Permainan sedang berlangsung" data-testid="resume-room-banner" data-landing-resume data-room-code="${escapeText(room.roomCode)}" data-format="${room.format}">
    <div class="cat-resume-head">
      <div class="cat-resume-badges">
        <span class="cat-resume-format ${room.format}"><span aria-hidden="true">${room.format === "claim-the-city" ? "◆" : "◎"}</span> ${escapeText(formatNames[room.format])}</span>
        <span class="cat-resume-badge">Ruang ${escapeText(room.roomCode)}</span>
        <span class="cat-resume-badge">${escapeText(resumePhaseLabels[room.phase])}</span>
      </div>
      <button type="button" class="secondary cat-resume-dismiss" data-lp-action="dismiss-resume" data-room-code="${escapeText(room.roomCode)}" aria-label="Tutup sesi ${escapeText(room.roomCode)}">Tutup</button>
    </div>
    <div class="cat-resume-body">
      <div class="cat-resume-copy">
        <h2>${escapeText(title)}</h2>
        <p>${escapeText(meta)}</p>
      </div>
      <button type="button" class="primary cat-resume-cta" data-lp-action="resume-room" data-room-code="${escapeText(room.roomCode)}" data-format="${room.format}">Lanjutkan Permainan</button>
    </div>
  </section>`;
}

const STEP_SVGS = [
  `<svg class="lp-step-art" viewBox="0 0 88 56" aria-hidden="true">
    <rect width="88" height="56" rx="10" fill="#e5f2e5"/>
    <path d="M12 42c14-14 26-2 40-16 8-8 16-10 24-10" fill="none" stroke="#104a40" stroke-width="2.4" stroke-dasharray="4 3" stroke-linecap="round"/>
    <circle cx="18" cy="39" r="5" fill="#fffef7" stroke="#153d34" stroke-width="2"/>
    <path d="M62 34s9-8.8 9-15.5a9 9 0 1 0-18 0C53 25.2 62 34 62 34Z" fill="#ffce55" stroke="#153d34" stroke-width="2"/>
    <circle cx="62" cy="18.5" r="3.2" fill="#153d34"/>
  </svg>`,
  `<svg class="lp-step-art" viewBox="0 0 88 56" aria-hidden="true">
    <rect width="88" height="56" rx="10" fill="#eef4fa"/>
    <circle cx="30" cy="28" r="16" fill="#0f766e" fill-opacity=".14" stroke="#0f766e" stroke-width="1.8" stroke-dasharray="3 2.5"/>
    <circle cx="30" cy="28" r="7" fill="#fff" stroke="#0f766e" stroke-width="1.8"/>
    <circle cx="30" cy="28" r="2.8" fill="#153d34"/>
    <rect x="49" y="13" width="28" height="30" rx="6" fill="#fffef7" stroke="#153d34" stroke-width="1.8"/>
    <path d="M55 23h16M55 30h11" stroke="#153d34" stroke-width="2" stroke-linecap="round"/>
    <circle cx="71" cy="35" r="5" fill="#d9f181" stroke="#153d34" stroke-width="1.5"/>
    <path d="m68.8 35 1.5 1.6 3-3.2" fill="none" stroke="#153d34" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  `<svg class="lp-step-art" viewBox="0 0 88 56" aria-hidden="true">
    <rect width="88" height="56" rx="10" fill="#fef7e2"/>
    <rect x="16" y="13" width="26" height="33" rx="6" fill="#075c54" stroke="#153d34" stroke-width="1.8" transform="rotate(-8 29 29)"/>
    <rect x="33" y="10" width="26" height="34" rx="6" fill="#ffce55" stroke="#153d34" stroke-width="1.8"/>
    <rect x="49" y="14" width="25" height="32" rx="6" fill="#d9f181" stroke="#153d34" stroke-width="1.8" transform="rotate(8 61 30)"/>
    <path d="M46 19l2.4 5 5.4.7-4 3.8 1 5.4-4.8-2.6-4.8 2.6 1-5.4-4-3.8 5.4-.7Z" fill="#153d34"/>
  </svg>`,
];

const STUDIO_ART_SVG = `<svg class="lp-studio-art" viewBox="0 0 96 72" aria-hidden="true">
  <rect width="96" height="72" rx="12" fill="#e5f2e5"/>
  <path d="M12 52 34 22l22 14 28-20" fill="none" stroke="#104a40" stroke-width="2.2" stroke-dasharray="4 3"/>
  <rect x="18" y="14" width="58" height="44" rx="8" fill="none" stroke="#87aa9b" stroke-width="1.5" stroke-dasharray="3 3"/>
  <circle cx="34" cy="22" r="6" fill="#ffce55" stroke="#153d34" stroke-width="2"/>
  <circle cx="56" cy="36" r="6" fill="#d9f181" stroke="#153d34" stroke-width="2"/>
  <circle cx="76" cy="20" r="6" fill="#075c54" stroke="#153d34" stroke-width="2"/>
  <circle cx="34" cy="22" r="2" fill="#153d34"/>
  <circle cx="56" cy="36" r="2" fill="#153d34"/>
  <circle cx="76" cy="20" r="2" fill="#fff"/>
</svg>`;

const HERO_OVERLAY_SVG = `<svg class="lp-hero-pins" viewBox="0 0 320 120" aria-hidden="true">
  <path d="M42 86 C 95 44, 152 94, 212 46 C 242 24, 272 36, 290 54" fill="none" stroke="#ffce55" stroke-width="2.5" stroke-dasharray="6 5" stroke-linecap="round" opacity=".9"/>
  <g transform="translate(42 86)">
    <circle r="7" fill="#d9f181" stroke="#153d34" stroke-width="2.2"/>
    <circle r="2.5" fill="#153d34"/>
  </g>
  <g transform="translate(212 46)">
    <circle r="8" fill="#ffce55" stroke="#153d34" stroke-width="2.2"/>
    <circle r="2.8" fill="#153d34"/>
  </g>
  <g transform="translate(286 52)">
    <circle r="6" fill="#b7e5f1" stroke="#153d34" stroke-width="2.2"/>
    <circle r="2.2" fill="#153d34"/>
  </g>
</svg>`;

export function mountLandingPage(
  root: HTMLElement,
  options: LandingPageOptions,
  focusHeading = false,
): () => void {
  const lifetime = new AbortController();
  const { signal } = lifetime;

  let authState: AuthMeReply | null = getCachedAuth();
  let activeRoom: ActiveRulebookRoomSummary | undefined = readStoredActiveRoom();
  let demoVideoId: string | null = getCachedDemoVideoYoutubeId();
  let demoPlaying = false;
  let online = typeof navigator === "undefined" ? true : navigator.onLine;

  const mastSlot = document.getElementById("mast-slot");
  const guideButton = document.getElementById("guide-open");

  if (guideButton) guideButton.hidden = true;
  document.title = "Kelana Ria · Permainan Jelajah Kota Nyata";

  function renderTopBarSlot() {
    if (signal.aborted || !mastSlot) return;
    mastSlot.innerHTML = `<a class="mast-nav-link" href="/catalog" data-landing-nav="catalog" data-testid="landing-top-catalog">Katalog</a>${renderAccountChip(authState)}`;
  }

  function renderResumeSlot() {
    const slot = root.querySelector<HTMLElement>("[data-lp-resume-slot]");
    if (!slot || signal.aborted) return;
    if (!activeRoom) {
      slot.hidden = true;
      slot.replaceChildren();
      return;
    }
    slot.hidden = false;
    slot.innerHTML = renderLandingResumeBanner(activeRoom);
  }

  function renderDemoSlot() {
    const slot = root.querySelector<HTMLElement>("[data-lp-demo-slot]");
    if (!slot || signal.aborted) return;
    if (!demoVideoId) {
      slot.hidden = true;
      slot.replaceChildren();
      return;
    }
    slot.hidden = false;
    if (demoPlaying && online) {
      const embedUrl = `https://www.youtube-nocookie.com/embed/${demoVideoId}?autoplay=1&rel=0&playsinline=1`;
      const watchUrl = `https://www.youtube.com/watch?v=${demoVideoId}`;
      slot.innerHTML = `<section class="lp-demo" aria-label="Video demo Claim the City" data-testid="landing-demo-video" data-demo-state="playing">
        <div class="lp-demo-frame">
          <iframe
            class="lp-demo-iframe"
            src="${embedUrl}"
            title="Demo Permainan Claim the City · Kelana Ria"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen
          ></iframe>
        </div>
        <div class="lp-demo-foot">
          <span class="lp-demo-caption"><span class="lp-demo-dot" aria-hidden="true">◆</span> Demo Permainan · Claim the City</span>
          <a class="lp-demo-ext" href="${watchUrl}" target="_blank" rel="noopener noreferrer" data-testid="landing-demo-youtube-link">Buka di YouTube <span aria-hidden="true">↗</span></a>
        </div>
      </section>`;
      return;
    }

    const offlineNotice = !online
      ? `<div class="lp-demo-offline" role="status" data-testid="landing-demo-offline">
          <span class="lp-demo-offline-badge">Luring</span>
          <span>Video demo membutuhkan koneksi internet</span>
        </div>`
      : "";

    slot.innerHTML = `<section class="lp-demo" aria-label="Video demo Claim the City" data-testid="landing-demo-video" data-demo-state="${online ? "poster" : "offline"}">
      <div class="lp-demo-frame">
        <img
          class="lp-demo-poster"
          src="${claimDemoPoster}"
          width="1024"
          height="576"
          alt="Cuplikan demo permainan Claim the City di Jakarta"
        >
        ${
          online
            ? `<button type="button" class="lp-demo-trigger" data-lp-action="play-demo" data-testid="landing-demo-play" aria-label="Putar video demo Claim the City">
                <span class="lp-demo-play-btn" aria-hidden="true">▶</span>
                <span class="lp-demo-label">
                  <strong>Lihat Demo · Claim the City</strong>
                  <span class="lp-demo-duration">01:23</span>
                </span>
              </button>`
            : `<div class="lp-demo-overlay-static">
                <span class="lp-demo-label">
                  <strong>Lihat Demo · Claim the City</strong>
                  <span class="lp-demo-duration">01:23</span>
                </span>
              </div>`
        }
      </div>
      ${offlineNotice}
    </section>`;
  }

  function renderPage() {
    root.innerHTML = `<div class="lp-shell" data-testid="landing-page">
      <div class="lp-resume-slot" data-lp-resume-slot hidden></div>

      <section class="lp-hero" aria-labelledby="lp-hero-title">
        <div class="lp-hero-media">
          <img src="${jakartaCover}" width="800" height="550" alt="Ilustrasi Monas, langit cerah, dan kereta MRT Jakarta">
          ${HERO_OVERLAY_SVG}
          <span class="lp-hero-pill"><span aria-hidden="true">◆</span> Jakarta · Permainan Kota Nyata</span>
        </div>
        <div class="lp-hero-body">
          <h1 id="lp-hero-title">Ubah Jakarta jadi papan permainan nyata</h1>
          <p class="lp-hero-sub">Jelajahi lokasi sungguhan, pecahkan misi &amp; petunjuk, dan adu strategi langsung di kota.</p>
          <div class="lp-hero-actions">
            <a class="primary lp-cta-primary" href="/catalog" data-landing-nav="catalog" data-testid="landing-choose-game">
              <span>Pilih Permainan</span>
              <span class="lp-cta-arrow" aria-hidden="true">→</span>
            </a>
            <button type="button" class="secondary lp-cta-secondary" data-lp-action="open-join" data-testid="landing-join-code">Gabung dengan Kode</button>
          </div>
        </div>
      </section>

      <div class="lp-demo-slot" data-lp-demo-slot hidden></div>
      <div class="pwa-install-slot" data-pwa-install-slot hidden></div>

      <section class="lp-section" aria-labelledby="lp-steps-title">
        <div class="lp-section-head">
          <h2 id="lp-steps-title">Cara Bermain</h2>
          <span class="lp-section-tag">3 Langkah</span>
        </div>
        <ol class="lp-steps-grid">
          <li class="lp-step-card">
            ${STEP_SVGS[0]}
            <div class="lp-step-copy">
              <h3>1. Jelajahi Kota Nyata</h3>
              <p>Datangi landmark atau stasiun sungguhan di peta.</p>
            </div>
          </li>
          <li class="lp-step-card">
            ${STEP_SVGS[1]}
            <div class="lp-step-copy">
              <h3>2. Selesaikan Misi &amp; Petunjuk</h3>
              <p>Tuntaskan tantangan lokasi atau lacak lawan lewat radar.</p>
            </div>
          </li>
          <li class="lp-step-card">
            ${STEP_SVGS[2]}
            <div class="lp-step-copy">
              <h3>3. Mainkan Kartu Aksi</h3>
              <p>Kunci zona lebih kuat atau balikkan keadaan ronde.</p>
            </div>
          </li>
        </ol>
      </section>

      <section class="lp-section" aria-labelledby="lp-formats-title">
        <div class="lp-section-head">
          <h2 id="lp-formats-title">Dua Format Permainan</h2>
        </div>
        <div class="lp-formats-grid">
          <article class="lp-format-card lp-format-card--claim">
            <div class="lp-format-head">
              <span class="cat-mark claim-the-city" aria-hidden="true">◆</span>
              <h3>Claim the City</h3>
            </div>
            <div class="lp-format-art">${formatHeroCardSvg("claim-the-city")}</div>
            <p class="lp-format-desc">Rebut &amp; kunci landmark nyata untuk kuasai zona kota.</p>
            <div class="lp-format-tags">
              <span>Solo / Grup</span>
              <span>Tim Dinamis</span>
              <span>Klaim Zona</span>
            </div>
            <a class="secondary lp-format-cta" href="/catalog#catalog-claim-the-city" data-landing-nav="catalog-claim" data-testid="landing-format-claim">Lihat Edisi <span aria-hidden="true">›</span></a>
          </article>

          <article class="lp-format-card lp-format-card--seek">
            <div class="lp-format-head">
              <span class="cat-mark hide-and-seek" aria-hidden="true">◎</span>
              <h3>Hide &amp; Seek</h3>
            </div>
            <div class="lp-format-art">${formatHeroCardSvg("hide-and-seek")}</div>
            <p class="lp-format-desc">Sembunyi di stasiun transit; pencari melacak lewat radar &amp; petunjuk.</p>
            <div class="lp-format-tags">
              <span>2–6 Pemain</span>
              <span>Transit &amp; Radar</span>
              <span>Giliran Bergantian</span>
            </div>
            <a class="secondary lp-format-cta" href="/catalog#catalog-hide-and-seek" data-landing-nav="catalog-seek" data-testid="landing-format-seek">Lihat Edisi <span aria-hidden="true">›</span></a>
          </article>
        </div>
      </section>

      <section class="lp-studio" aria-labelledby="lp-studio-title">
        ${STUDIO_ART_SVG}
        <div class="lp-studio-copy">
          <span class="lp-studio-badge">Studio Kreator</span>
          <h2 id="lp-studio-title">Punya rute seru di kotamu?</h2>
          <p>Rancang edisimu sendiri di Studio Kreator dan mainkan bareng teman atau komunitas.</p>
          <button type="button" class="secondary lp-studio-cta" data-lp-action="open-studio" data-testid="landing-open-studio">Buka Studio Kreator</button>
        </div>
      </section>

      <footer class="lp-footer">
        <a href="/catalog" data-landing-nav="catalog">Katalog</a>
        <a href="/?recaps=1" data-landing-nav="recaps">Riwayat</a>
        <button type="button" class="secondary lp-about-btn" data-lp-action="about">Tentang</button>
      </footer>
    </div>`;

    renderTopBarSlot();
    renderResumeSlot();
    renderDemoSlot();

    const pwaSlot = root.querySelector<HTMLElement>("[data-pwa-install-slot]");
    if (pwaSlot) mountPwaInstallPrompt(pwaSlot, signal);

    if (focusHeading) {
      const heading = root.querySelector<HTMLElement>("h1");
      if (heading) {
        heading.tabIndex = -1;
        heading.focus();
      }
    }
  }

  function handleSharedClick(event: Event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const authBtn = target.closest<HTMLButtonElement>("[data-auth-action]");
    if (authBtn) {
      const authAction = authBtn.dataset.authAction;
      if (authAction === "open-account" && authState?.authenticated) {
        openAuthModal({ mode: "account" });
      } else {
        openAuthModal();
      }
      return;
    }

    const navLink = target.closest<HTMLAnchorElement>("[data-landing-nav]");
    if (navLink && event instanceof MouseEvent && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      options.navigate(navLink.href);
      return;
    }

    const actionBtn = target.closest<HTMLButtonElement>("[data-lp-action]");
    const action = actionBtn?.dataset.lpAction;
    if (!action) return;

    if (action === "open-join") {
      openJoinRoomModal({
        signal,
        authState,
        onJoined: options.openRoom,
      });
      return;
    }
    if (action === "open-studio") {
      options.openStudio();
      return;
    }
    if (action === "about") {
      options.openAbout();
      return;
    }
    if (action === "play-demo") {
      online = typeof navigator === "undefined" ? true : navigator.onLine;
      if (!online || !demoVideoId) {
        demoPlaying = false;
        renderDemoSlot();
        return;
      }
      demoPlaying = true;
      renderDemoSlot();
      return;
    }
    if (action === "resume-room") {
      const code = actionBtn?.dataset.roomCode ?? activeRoom?.roomCode;
      const fmt = (actionBtn?.dataset.format as RulebookFormat | undefined) ?? activeRoom?.format;
      if (code && (fmt === "claim-the-city" || fmt === "hide-and-seek")) {
        options.openRoom(fmt, code);
      }
      return;
    }
    if (action === "dismiss-resume") {
      const code = actionBtn?.dataset.roomCode ?? activeRoom?.roomCode;
      if (code) {
        dismissActiveRoom(code);
        activeRoom = readStoredActiveRoom();
        renderResumeSlot();
      }
    }
  }

  root.addEventListener("click", handleSharedClick, { signal });
  mastSlot?.addEventListener("click", handleSharedClick, { signal });

  onAuthChange((next) => {
    authState = next;
    renderTopBarSlot();
  }, signal);

  window.addEventListener("offline", () => {
    online = false;
    if (demoPlaying) demoPlaying = false;
    renderDemoSlot();
  }, { signal });

  window.addEventListener("online", () => {
    online = true;
    renderDemoSlot();
  }, { signal });

  renderPage();

  void resolveDemoVideoYoutubeId(signal).then((resolved) => {
    if (signal.aborted) return;
    if (resolved !== demoVideoId) {
      demoVideoId = resolved;
      if (!demoVideoId) demoPlaying = false;
      renderDemoSlot();
    }
  });

  if (online) {
    void fetchAuthMe(signal).then((next) => {
      if (signal.aborted) return;
      authState = next;
      renderTopBarSlot();
    }).catch(() => {
      // Quietly keep default Masuk chip if unreachable.
    });
  }

  return () => {
    lifetime.abort();
    if (mastSlot) mastSlot.replaceChildren();
    if (guideButton) guideButton.hidden = false;
  };
}
