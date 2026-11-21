import type { SoloCheckpoint, SoloSession } from "@kelana-ria/contracts";

export function escapeText(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

const jakartaTime = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

export function wib(timestamp: number) {
  return `${jakartaTime.format(timestamp)} WIB`;
}

export function remaining(milliseconds: number) {
  const seconds = Math.ceil(Math.max(0, milliseconds) / 1000);
  return [Math.floor(seconds / 60), seconds % 60].map(value => String(value).padStart(2, "0")).join(":");
}

export function action(label: string, id: string, style = "secondary", disabled = false) {
  return `<button class="${style}" type="button" data-action="${id}" data-focus="${id}" ${disabled ? "disabled" : ""}>${label}</button>`;
}

export function score(session: SoloSession) {
  const { targets } = session.edition;
  return `<dl class="solo-score">
    <div><dt>Landmark diklaim</dt><dd>${session.claimed.length}<small> / ${targets.landmarks}</small></dd></div>
    <div><dt>Zona dengan klaim</dt><dd>${session.zones.length}<small> / ${targets.zones}</small></dd></div>
  </dl>`;
}

export function checkpointList(session: SoloSession, selectedId: string | undefined) {
  const zones = new Map<string, SoloCheckpoint[]>();
  for (const point of session.edition.checkpoints) {
    const points = zones.get(point.zone) ?? [];
    points.push(point);
    zones.set(point.zone, points);
  }
  return Array.from(zones, ([zone, points]) => {
    const claimed = points.filter(point => session.claimed.includes(point.id)).length;
    return `<section class="solo-zone" aria-label="Zona ${escapeText(zone)}">
      <h3>${escapeText(zone)}${session.phase === "active" ? ` <small>${claimed} / ${points.length} diklaim</small>` : ""}</h3>
      <ul>${points.map(point => checkpointRow(point, session, selectedId)).join("")}</ul>
    </section>`;
  }).join("");
}

function checkpointRow(point: SoloCheckpoint, session: SoloSession, selectedId: string | undefined) {
  const id = escapeText(point.id);
  const name = escapeText(point.name);
  const claimed = session.claimed.includes(point.id);
  return `<li class="solo-point" ${point.id === selectedId ? 'data-selected="true"' : ""}>
    <div class="solo-point-detail">
      ${session.phase === "active" && !claimed
        ? `<button type="button" data-action="point" data-point="${id}" data-focus="list-${id}" aria-controls="solo-action">${name}</button>`
        : `<strong>${name}</strong>`}
      <span>${escapeText(point.transit)}</span>
    </div>
    ${session.phase === "active" ? `<span class="solo-point-state">${claimed ? "Diklaim" : Object.hasOwn(session.visits, point.id) ? "Pernah check-in" : "Belum diklaim"}</span>` : ""}
  </li>`;
}

export function schematic(session: SoloSession, imageUrl: string) {
  return schematicBoard(session.edition, imageUrl, session.phase === "active", id => session.claimed.includes(id) ? "Diklaim" : undefined);
}

export function schematicBoard(
  { start, checkpoints }: Pick<SoloSession["edition"], "start" | "checkpoints">,
  imageUrl: string,
  active: boolean,
  ownership: (checkpointId: string) => string | undefined,
) {
  return `<figure class="solo-figure">
    <div class="solo-map">
      <img src="${escapeText(imageUrl)}" width="800" height="540" alt="">
      ${[start, ...checkpoints].map((point, index) => {
        const id = escapeText(point.id);
        const name = escapeText(point.name);
        const startMarker = index === 0;
        const claimed = Boolean(ownership(point.id));
        const marker = `<span class="solo-pin ${startMarker ? "solo-pin-start" : ""} ${claimed ? "solo-pin-claimed" : ""}">${startMarker ? "A" : index}</span>`;
        const position = `style="--x:${Number(point.x)}%;--y:${Number(point.y)}%"`;
        return active && !startMarker && !claimed
          ? `<button class="solo-marker" type="button" ${position} data-action="point" data-point="${id}" data-focus="map-${id}" aria-label="${name} di peta">${marker}</button>`
          : `<span class="solo-marker" ${position} aria-hidden="true">${marker}</span>`;
      }).join("")}
    </div>
    <figcaption>Skema papan simulasi. Gunakan daftar untuk melihat nama landmark, zona, dan transit terdekat.</figcaption>
    <ol class="solo-map-key" aria-label="Keterangan penanda">
      <li><strong>A</strong> ${escapeText(start.name)} · Titik awal</li>
      ${checkpoints.map((point, index) => {
        const owner = ownership(point.id);
        return `<li><strong>${index + 1}</strong> ${escapeText(point.name)}${owner ? ` · ${escapeText(owner)}` : ""}</li>`;
      }).join("")}
    </ol>
  </figure>`;
}

export function result(session: SoloSession, feedbackHtml = "") {
  const final = session.events.at(-1);
  const exhausted = final?.type === "expired" && session.deadline !== null && final.at < session.deadline;
  const [title, reason] = session.phase === "won"
    ? ["Kamu menang", "Kedua target tercapai sebelum waktu habis."]
    : session.phase === "abandoned"
      ? ["Sesi dihentikan", "Kamu mengakhiri sesi lebih awal."]
      : exhausted
        ? ["Landmark habis", "Semua landmark sudah diklaim dan target belum tercapai."]
        : ["Waktu habis", "Kedua target belum tercapai saat sesi berakhir."];
  const names = new Map(session.edition.checkpoints.map(point => [point.id, point.name]));
  const recap = session.events.map(event => {
    const label = {
      started: "Permainan dimulai",
      claimed: `Diklaim: ${event.checkpointId ? names.get(event.checkpointId) ?? "Landmark" : "Landmark"}`,
      won: "Kedua target tercapai",
      expired: exhausted ? "Semua landmark telah diklaim" : "Batas waktu tercapai",
      abandoned: "Permainan dihentikan",
    }[event.type];
    return `<li><time datetime="${new Date(event.at).toISOString()}">${wib(event.at)}</time><span>${escapeText(label)}</span></li>`;
  });
  return `<div class="solo-result">
    <section class="solo-ticket" aria-labelledby="solo-result-heading">
      <h2 id="solo-result-heading" tabindex="-1">${title}</h2>
      <p>${reason}</p>
      ${score(session)}
      ${session.zones.length ? `<p>Zona dengan klaim · ${escapeText(session.zones.join(", "))}</p>` : ""}
      ${feedbackHtml}
      <div class="solo-actions">
        ${action("Main lagi", "replay", "primary")}
        ${action("Edisi lain", "fresh-edition", "secondary")}
      </div>
    </section>
    <section class="solo-recap" aria-labelledby="solo-recap-heading">
      <h2 id="solo-recap-heading">Riwayat permainan</h2>
      ${recap.length ? `<ol>${recap.join("")}</ol>` : "<p>Sesi belum dimulai.</p>"}
    </section>
  </div>`;
}
