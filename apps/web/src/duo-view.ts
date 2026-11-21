import type { DuoRoom, DuoSeat, SoloChallenge, SoloPoint } from "@kelana-ria/contracts";
import { action, escapeText, schematicBoard, wib } from "./solo-view";

export const player = { host: "Pemain 1", guest: "Pemain 2" } as const;
const seats = ["host", "guest"] as const;

export function inviteUrl(code: string) {
  const url = new URL("/", location.origin);
  url.searchParams.set("play", "duo-claim");
  url.searchParams.set("room", code);
  return url;
}

type Feedback = { text: string; error?: boolean };

export function feedbackMarkup(feedback: Feedback | undefined) {
  return feedback ? `<p class="solo-feedback ${feedback.error ? "solo-feedback-error" : ""}">${escapeText(feedback.text)}</p>` : "";
}

export function entry(code: string, busy: boolean, feedback: Feedback | undefined) {
  return `<div class="solo-layout">
    <section class="solo-objective" aria-labelledby="duo-objective-heading">
      <h2 id="duo-objective-heading">Kuasai zona terbanyak</h2>
      <p>Berlomba mengklaim landmark di Jakarta. Klaim lebih banyak landmark di satu zona daripada lawan untuk menguasainya.</p>
      <p>Simulasi ini memakai edisi uji siap pakai. Kedua pemain bisa bermain dari lokasi mana saja.</p>
    </section>
    <section class="solo-ticket duo-entry" aria-labelledby="duo-room-heading">
      <h2 id="duo-room-heading" tabindex="-1">${code ? "Gabung ruang undangan" : "Main dengan teman"}</h2>
      ${feedbackMarkup(feedback)}
      ${code ? '<p>Konfirmasi kode untuk mengambil kursi Pemain 2.</p>'
        : `<p>Buat ruang dan undang satu teman, atau gabung dengan kode yang kamu terima.</p>
          <div class="solo-actions">${action("Buat ruang", "create", "primary", busy)}</div>`}
      <form id="duo-join">
        <label for="duo-invite-input">Kode undangan</label>
        <input id="duo-invite-input" data-focus="invite-input" name="code" type="text" value="${escapeText(code)}"
          minlength="8" maxlength="8" pattern="[0-9A-Fa-f]{8}" autocapitalize="characters" spellcheck="false" required>
        <button class="${code ? "primary" : "secondary"}" type="submit" data-focus="join" ${busy ? "disabled" : ""}>Gabung ruang</button>
      </form>
      ${code ? `<div class="solo-actions">${action("Ganti ruang", "new-room", "solo-back", busy)}</div>` : ""}
    </section>
  </div>`;
}

function seatMarkup(state: DuoRoom, seat: DuoSeat) {
  const member = state.seats[seat];
  const status = !member.joined ? "Menunggu teman" : member.ready ? "Siap" : "Belum siap";
  return `<li>
    <div><strong>${player[seat]}</strong><small>${seat === "host" ? "Tuan rumah" : "Tamu"}${seat === state.seat ? " · Kamu" : ""}</small></div>
    <span class="duo-seat-status" data-ready="${member.ready}">${status}</span>
  </li>`;
}

export function locationActions(busy: boolean, seeking: boolean, verified = false) {
  return `${seeking ? '<p role="status">Meminta lokasi perangkat…</p>' : ""}
    ${action("Check-in", "gps", verified ? "secondary" : "primary", busy)}
    ${action("Simulasikan lokasi di sini", "simulate", "secondary", busy)}`;
}

export function lobby(
  state: DuoRoom, now: number, startOpen: boolean, busy: boolean, seeking: boolean, feedback: Feedback | undefined,
) {
  const verified = (state.startVerifiedUntil ?? 0) > now;
  const ready = state.seats[state.seat].ready;
  const allReady = seats.every(seat => state.seats[seat].ready);
  return `<div class="solo-main-column">
      <section class="solo-objective" aria-labelledby="duo-objective-heading">
        <h2 id="duo-objective-heading" tabindex="-1">Kuasai zona terbanyak</h2>
        <p>Check-in di landmark dan jawab tantangannya. Jawaban benar pertama mengunci klaim. Zona dengan jumlah klaim yang sama tetap netral.</p>
        <p>Jika jumlah zona seri, pemain dengan lebih banyak landmark menang. Permainan selesai dalam <strong>${Math.round(state.edition.durationMs / 60_000)} menit</strong> atau saat semua landmark diklaim.</p>
        <p class="solo-edition">Edisi ${escapeText(state.edition.id)} · Berjalan kaki, MRT, KRL, dan Transjakarta. Perjalanan sungguhan memakai data seluler dan ongkos biasa.</p>
      </section>
      <section class="solo-ticket" aria-labelledby="duo-room-heading">
        <h2 id="duo-room-heading" tabindex="-1">Ruang tunggu</h2>
        <div class="duo-invite">
          <p>Kode undangan <strong class="duo-code">${escapeText(state.code)}</strong></p>
          ${state.seat === "host" ? `<a href="${escapeText(inviteUrl(state.code).href)}" data-focus="invite-link">Tautan undangan</a>
            ${action("Salin tautan", "copy")}` : ""}
        </div>
        <ul class="duo-seats" aria-label="Kursi pemain">${seats.map(seat => seatMarkup(state, seat)).join("")}</ul>
      </section>
      <section class="solo-ticket" id="duo-action" aria-labelledby="duo-action-heading">
        <span class="solo-start-label">Titik awal</span>
        <h2 id="duo-action-heading" tabindex="-1">${escapeText(state.edition.start.name)}</h2>
        <p>${verified ? "Check-in titik awal terverifikasi." : "Check-in di titik awal sebelum menyatakan siap."}
          ${state.seat === "host" ? "Hitung mundur dimulai setelah kedua pemain siap dan kamu menekan Mulai." : "Tuan rumah memulai ronde setelah kedua pemain siap."}</p>
        ${feedbackMarkup(feedback)}
        <div class="solo-actions">
          ${allReady && state.seat === "host" ? action("Mulai", "start", "primary", busy || !verified) : ""}
          ${verified && !ready ? action("Saya siap", "ready", "primary", busy) : ""}
          ${ready ? action("Batalkan siap", "unready", "secondary", busy) : ""}
          ${startOpen && !verified ? locationActions(busy, seeking)
            : !verified ? action("Check-in di titik awal", "open-start", "primary", busy) : ""}
        </div>
      </section>
    </div>`;
}

export function checkpointPanel(
  state: DuoRoom, point: SoloPoint | undefined, challenge: SoloChallenge | undefined, choiceId: string,
  now: number, busy: boolean, seeking: boolean, feedback: Feedback | undefined,
) {
  if (!point) return `<section class="solo-ticket solo-instructions" id="duo-action" aria-labelledby="duo-action-heading">
    <h2 id="duo-action-heading" tabindex="-1">Check-in dan klaim</h2>
    <p>Pilih landmark untuk membuka tantangan dengan check-in. Yang pertama menjawab benar mendapat klaim.</p>
    ${feedbackMarkup(feedback)}
  </section>`;

  const owner = state.owners[point.id];
  const freshVisit = state.visits[point.id] > now;
  const coolingDown = state.cooldowns[point.id] > now;
  return `<section class="solo-ticket" id="duo-action" aria-labelledby="duo-action-heading">
    <div class="solo-section-heading">
      <h2 id="duo-action-heading" tabindex="-1">${escapeText(point.name)}</h2>
      ${action("Tutup", "close-point", "solo-back")}
    </div>
    ${feedbackMarkup(feedback)}
    ${owner ? `<p>Diklaim ${player[owner]}. Pilih landmark lain untuk melanjutkan.</p>` : challenge ? `<form id="duo-challenge">
      <fieldset>
        <legend>${escapeText(challenge.prompt)}</legend>
        ${challenge.choices.map(choice => `<label class="solo-choice">
          <input type="radio" name="choice" value="${escapeText(choice.id)}" data-focus="choice-${escapeText(choice.id)}" ${choice.id === choiceId ? "checked" : ""} required>
          <span>${escapeText(choice.label)}</span>
        </label>`).join("")}
      </fieldset>
      ${coolingDown ? '<p data-cooldown></p>' : ""}
      ${!freshVisit ? "<p>Posisi perlu diverifikasi ulang. Kirim jawaban untuk meminta lokasi perangkat atau simulasikan lokasi sebelum mengirim.</p>" : ""}
      <button class="primary" type="submit" data-focus="answer" ${busy || coolingDown ? "disabled" : ""}>Kirim jawaban</button>
    </form>` : `<p>Lakukan check-in di ${escapeText(point.name)} untuk membuka tantangan.</p>`}
    ${!owner && (!challenge || !freshVisit) ? `<div class="solo-actions">${locationActions(busy, seeking, Boolean(challenge))}</div>` : ""}
  </section>`;
}

export function score(state: DuoRoom) {
  return `<dl class="solo-score">
    ${seats.map(seat => {
      const controlled = state.zones.filter(zone => zone.owner === seat).length;
      return `<div><dt>${player[seat]}${state.seat === seat ? ' <span class="duo-you">· Kamu</span>' : ""}</dt><dd>${controlled} <small>zona</small></dd>
        <dd class="duo-landmark-score">${state.landmarks[seat]} landmark</dd></div>`;
    }).join("")}
  </dl>`;
}

function ownership(owner: DuoSeat | undefined) {
  return owner ? `Diklaim ${player[owner]}` : undefined;
}

export function board(state: DuoRoom, selectedId: string | undefined, map: { shown: boolean; failed: boolean; url: string }) {
  const lobby = state.phase === "lobby";
  const active = state.phase === "active";
  return `<section class="solo-board" aria-labelledby="duo-board-heading">
    <div class="solo-section-heading">
      <h2 id="duo-board-heading" tabindex="-1">${active ? "Pilih landmark" : "Landmark di papan"}</h2>
      <button class="secondary" type="button" data-action="map" data-focus="map" aria-expanded="${map.shown}" aria-controls="duo-map">${map.shown ? "Tutup peta" : "Lihat peta"}</button>
    </div>
    <div id="duo-map" ${map.shown ? "" : "hidden"}>${!map.shown ? "" : map.failed
      ? `<p class="solo-map-notice" role="status">Peta tidak tersedia. Lanjutkan lewat daftar landmark.</p>${action("Muat ulang peta", "retry-map")}`
      : schematicBoard(state.edition, map.url, active, id => ownership(state.owners[id]))}</div>
    ${state.zones.map(zone => `<section class="solo-zone" aria-label="Zona ${escapeText(zone.name)}" data-zone="${escapeText(zone.name)}">
      <h3>${escapeText(zone.name)}${lobby ? "" : ` <small>${zone.owner ? `Dikuasai ${player[zone.owner]}` : "Netral"}</small>`}</h3>
      ${lobby ? "" : `<p class="duo-zone-count">Pemain 1: ${zone.host} · Pemain 2: ${zone.guest}</p>`}
      <ul>${state.edition.checkpoints.filter(point => point.zone === zone.name).map(point => {
        const id = escapeText(point.id);
        const name = escapeText(point.name);
        const owner = state.owners[point.id];
        return `<li class="solo-point" data-checkpoint="${id}" ${point.id === selectedId ? 'data-selected="true"' : ""}>
          <div class="solo-point-detail">
            ${active && !owner ? `<button type="button" data-action="point" data-point="${id}" data-focus="list-${id}" aria-controls="duo-action">${name}</button>` : `<strong>${name}</strong>`}
            <span>${escapeText(point.transit)}</span>
          </div>
          ${lobby ? "" : `<span class="solo-point-state">${ownership(owner) ?? (active && Object.hasOwn(state.visits, point.id) ? "Pernah check-in" : "Belum diklaim")}</span>`}
        </li>`;
      }).join("")}</ul>
    </section>`).join("")}
  </section>`;
}

export function result(state: DuoRoom, busy: boolean) {
  const winner = state.outcome?.winner;
  const reason = state.outcome?.reason;
  const canceled = reason === "canceled";
  const controls = (seat: DuoSeat) => state.zones.filter(zone => zone.owner === seat).length;
  const title = canceled ? "Ruang dibatalkan" : winner ? `Pemenang: ${player[winner]}` : "Seri";
  const ending = reason === "forfeit" ? `${winner === "host" ? player.guest : player.host} keluar dari ronde.`
    : reason === "all-claimed" ? "Semua landmark sudah diklaim."
      : reason === "time" ? "Waktu habis." : "Tuan rumah menutup ruang sebelum ronde dimulai.";
  const tiebreak = canceled || reason === "forfeit" ? "" : !winner
    ? " Jumlah zona dan landmark kedua pemain sama."
    : controls("host") === controls("guest")
      ? " Jumlah zona sama. Pemenang memegang lebih banyak landmark."
      : " Pemenang menguasai lebih banyak zona.";
  const names = new Map(state.edition.checkpoints.map(point => [point.id, point.name]));
  const finishedAt = state.events.at(-1)?.at;
  return `<div class="solo-result">
    <section class="solo-ticket" aria-labelledby="duo-result-heading">
      <h2 id="duo-result-heading" tabindex="-1">${title}</h2>
      <p>${ending}${tiebreak}</p>
      ${state.startedAt === null || finishedAt === undefined ? "" : `<p>Dimulai ${wib(state.startedAt)} · Berakhir ${wib(finishedAt)}</p>`}
      ${canceled ? "" : score(state)}
      ${action("Main lagi", "replay", "primary", busy)}
    </section>
    <section class="solo-recap" aria-labelledby="duo-recap-heading">
      <h2 id="duo-recap-heading">Riwayat permainan</h2>
      <ol>${state.events.map(event => {
        const label = event.type === "started" ? "Permainan dimulai"
          : event.type === "claimed" && event.seat && event.checkpointId
            ? `${player[event.seat]} mengklaim ${names.get(event.checkpointId) ?? "landmark"}`
            : event.type === "canceled" ? "Ruang dibatalkan" : "Permainan selesai";
        return `<li><time datetime="${new Date(event.at).toISOString()}">${wib(event.at)}</time><span>${escapeText(label)}</span></li>`;
      }).join("")}</ol>
    </section>
  </div>`;
}
