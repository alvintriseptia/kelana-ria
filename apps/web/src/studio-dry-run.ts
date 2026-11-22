import type {
  ClaimChallengeItem,
  ClaimLeafChallengePayload,
  ClaimRulebookPack,
  GeoCoordinate,
  HideSeekRulebookPack,
  RulebookFormat,
} from "@kelana-ria/contracts";
import { escapeText } from "./solo-view";
import { isClaimStudioPack, type StudioStep, type StudioVersionRecord } from "./studio-types";

export type DryRunState = {
  seekAnchorId: string;
  seekSeekerPosId: string;
  seekClueKey: string;
  seekClueOutput: string;
  claimLandmarkId: string;
  claimTestOpen: boolean;
  claimShotTier: "standard" | "bold" | null;
  claimMultiStepIdx: 0 | 1;
  claimTestResult: string;
};

export type ValidationJumpTarget = {
  step: StudioStep;
  label: string;
  step2Tab?: "primary" | "secondary" | "start" | "boundary";
  seekSubTab?: "timers" | "book" | "deck";
  claimSubTab?: "session" | "challenges" | "deck";
  focusSelector?: string;
};

export function resolveValidationJump(path: string, format: RulebookFormat): ValidationJumpTarget {
  const p = path.toLowerCase();
  if (p.startsWith("meta")) {
    return { step: 1, label: "Tahap 1 · Info Paket", focusSelector: "#ed-meta-title" };
  }
  if (p.includes("hidingzoneradius") && format === "hide-and-seek") {
    return { step: 3, label: "Tahap 3 · Timer & Radius", seekSubTab: "timers", focusSelector: "#ed-zone" };
  }
  if (p.includes("boundary")) {
    return { step: 2, label: "Tahap 2 · Batas Area", step2Tab: "boundary" };
  }
  if (p.includes("startpoint")) {
    return { step: 2, label: "Tahap 2 · Titik Awal", step2Tab: "start" };
  }
  if (p.includes("poi")) {
    return { step: 2, label: "Tahap 2 · POI", step2Tab: "secondary" };
  }
  if (p.includes("station")) {
    return { step: 2, label: "Tahap 2 · Stasiun", step2Tab: "primary" };
  }
  if (p.includes("zone")) {
    return { step: 2, label: "Tahap 2 · Zona", step2Tab: "secondary" };
  }
  if (p.includes("landmark") && !p.includes("challenge")) {
    return { step: 2, label: "Tahap 2 · Landmark", step2Tab: "primary" };
  }
  if (format === "hide-and-seek") {
    if (p.includes("investigationbook") || p.includes("famil")) {
      return { step: 3, label: "Tahap 3 · Buku Petunjuk", seekSubTab: "book" };
    }
    if (p.includes("deck") || p.includes("card") || p.includes("curse")) {
      return { step: 3, label: "Tahap 3 · Dek & Kutukan", seekSubTab: "deck" };
    }
    return { step: 3, label: "Tahap 3 · Timer & Sesi", seekSubTab: "timers", focusSelector: "#ed-head" };
  }
  if (p.includes("challenge") || p.includes("backup")) {
    return { step: 3, label: "Tahap 3 · Tantangan", claimSubTab: "challenges" };
  }
  if (p.includes("deck") || p.includes("card")) {
    return { step: 3, label: "Tahap 3 · Dek Taktis", claimSubTab: "deck" };
  }
  return { step: 3, label: "Tahap 3 · Sesi & Skor", claimSubTab: "session", focusSelector: "#ed-claim-duration" };
}

function haversineMeters(a: GeoCoordinate, b: GeoCoordinate): number {
  const R = 6_371_000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

export function evaluateSeekDryRunClue(
  pack: HideSeekRulebookPack,
  record: StudioVersionRecord,
  state: DryRunState,
): string {
  const anchors = record.snapshot.stations.filter((s) => s.eligibleHidingAnchor);
  const hiderSt = anchors.find((s) => s.id === state.seekAnchorId) ?? anchors[0];
  if (!hiderSt) return "Tidak ada stasiun jangkar yang valid.";

  const seekerCoord: GeoCoordinate =
    state.seekSeekerPosId === "start"
      ? record.snapshot.startPoint
      : (record.snapshot.stations.find((s) => s.id === state.seekSeekerPosId) ?? record.snapshot.startPoint);
  const seekerLabel =
    state.seekSeekerPosId === "start"
      ? record.snapshot.startPoint.name
      : (record.snapshot.stations.find((s) => s.id === state.seekSeekerPosId)?.name ?? "Titik Awal");

  const [family, itemId] = state.seekClueKey.split(":");
  const dist = haversineMeters(hiderSt, seekerCoord);

  if (family === "radar") {
    const item = pack.investigationBook.families.radar?.items.find((i) => i.id === itemId);
    const r = item?.radiusMeters ?? 1000;
    const inside = dist <= r;
    return `Hasil Uji Radar (${item?.label ?? `${r}m`}): ${inside ? "YA — Di dalam radius" : "TIDAK — Di luar radius"} (jarak ${hiderSt.name} ↔ ${seekerLabel} = ${dist} m).`;
  }
  if (family === "thermometer") {
    const distFromStart = haversineMeters(hiderSt, record.snapshot.startPoint);
    const label = dist < distFromStart ? "LEBIH HANGAT (mendekat)" : dist > distFromStart ? "LEBIH DINGIN (menjauh)" : "SAMA DEKAT";
    return `Hasil Uji Termometer (${record.snapshot.startPoint.name} → ${seekerLabel}): ${label} (awal ${distFromStart} m → sekarang ${dist} m).`;
  }
  if (family === "matching") {
    const item = pack.investigationBook.families.matching?.items.find((i) => i.id === itemId);
    const seekerSt = record.snapshot.stations.find((s) => s.id === state.seekSeekerPosId) ?? anchors[0];
    const key = item?.attributeKey ?? "kecamatan";
    const hVal = hiderSt.attributes[key] ?? "-";
    const sVal = seekerSt.attributes[key] ?? "-";
    return `Hasil Uji Matching (${item?.label ?? key}): ${hVal === sVal ? "COCOK (Ya)" : "BERBEDA (Tidak)"} — Penyembunyi: ${hVal}, Pencari: ${sVal}.`;
  }
  if (family === "measuring") {
    const item = pack.investigationBook.families.measuring?.items.find((i) => i.id === itemId);
    const pois = record.snapshot.pois.filter((p) => !item?.poiCategory || p.category === item.poiCategory);
    if (pois.length === 0) return `Hasil Uji Measuring: Belum ada POI kategori ${item?.poiCategory ?? "-"}.`;
    const hDist = Math.min(...pois.map((p) => haversineMeters(hiderSt, p)));
    const sDist = Math.min(...pois.map((p) => haversineMeters(seekerCoord, p)));
    return `Hasil Uji Measuring (${item?.label ?? "POI"}): Penyembunyi ${hDist < sDist ? "LEBIH DEKAT" : "LEBIH JAUH"} ke POI (${hDist} m vs ${sDist} m).`;
  }
  if (family === "tentacles") {
    const item = pack.investigationBook.families.tentacles?.items.find((i) => i.id === itemId);
    const r = item?.radiusMeters ?? 1500;
    const pois = record.snapshot.pois.filter((p) => p.category === item?.poiCategory && haversineMeters(seekerCoord, p) <= r);
    if (dist > r || pois.length === 0) return `Hasil Uji Tentacles (${item?.label ?? "POI"}): Di luar jangkauan ${r} m (${dist} m).`;
    const nearest = pois.reduce((best, p) =>
      haversineMeters(hiderSt, p) < haversineMeters(hiderSt, best) ? p : best,
    );
    return `Hasil Uji Tentacles: POI terdekat dari penyembunyi adalah ${nearest.name} (${haversineMeters(hiderSt, nearest)} m).`;
  }
  return `Hasil Uji Foto: Penyembunyi mengirim foto dari sekitar ${hiderSt.name}.`;
}

function getActiveClaimChallenge(pack: ClaimRulebookPack, landmarkId: string): ClaimChallengeItem | null {
  if (landmarkId === "backup") return pack.challenges.backupPool[0] ?? null;
  const list = pack.challenges.landmarkChallenges[landmarkId];
  return list?.[0] ?? pack.challenges.backupPool[0] ?? null;
}

function resolveDryRunLeaf(
  chal: ClaimChallengeItem,
  state: DryRunState,
): ClaimLeafChallengePayload | null {
  const p = chal.payload;
  if (p.primitive === "call_your_shot") {
    if (!state.claimShotTier) return null;
    return state.claimShotTier === "bold" ? p.boldTask : p.standardTask;
  }
  if (p.primitive === "multi_step") {
    return p.steps[state.claimMultiStepIdx] ?? null;
  }
  return p;
}

export function evaluateClaimDryRunAnswer(
  pack: ClaimRulebookPack,
  state: DryRunState,
  root: HTMLElement,
): string {
  const chal = getActiveClaimChallenge(pack, state.claimLandmarkId);
  if (!chal) return "Belum ada tantangan untuk diuji.";
  const leaf = resolveDryRunLeaf(chal, state);
  if (!leaf) return "Pilih tingkat risiko (Standar atau Bold) terlebih dahulu.";

  if (leaf.primitive === "observation_mcq") {
    const picked = root.querySelector<HTMLInputElement>('input[name="dry-mcq"]:checked')?.value ?? "";
    const ok = picked === leaf.correctChoiceId;
    if (ok && chal.payload.primitive === "multi_step" && state.claimMultiStepIdx === 0) {
      state.claimMultiStepIdx = 1;
      return "✅ Langkah 1 benar! Lanjut ke Langkah 2.";
    }
    return ok ? "✅ Jawaban Benar! Landmark terkunci dalam simulasi." : `❌ Jawaban belum tepat (kunci: ${leaf.correctChoiceId}).`;
  }
  if (leaf.primitive === "observation_input") {
    const raw = (root.querySelector<HTMLInputElement>("#dry-input-val")?.value ?? "").trim();
    let ok = false;
    if (leaf.inputMode === "number" && leaf.numericRange) {
      const n = Number(raw);
      ok = Number.isFinite(n) && n >= leaf.numericRange.min && n <= leaf.numericRange.max;
    } else if (leaf.acceptedAnswers) {
      const norm = raw.toLowerCase();
      ok = leaf.acceptedAnswers.some((a) => a.trim().toLowerCase() === norm);
    }
    if (ok && chal.payload.primitive === "multi_step" && state.claimMultiStepIdx === 0) {
      state.claimMultiStepIdx = 1;
      return "✅ Langkah 1 benar! Lanjut ke Langkah 2.";
    }
    return ok ? "✅ Jawaban Benar! Landmark terkunci dalam simulasi." : "❌ Jawaban tidak cocok dengan kunci.";
  }
  if (leaf.primitive === "photo_proof" || leaf.primitive === "timed_micro_task") {
    if (chal.payload.primitive === "multi_step" && state.claimMultiStepIdx === 0) {
      state.claimMultiStepIdx = 1;
      return "✅ Langkah 1 (Foto/Timer) diterima! Lanjut ke Langkah 2.";
    }
    return "✅ Simulasi foto/tugas bertimer lulus dan mengunci landmark!";
  }
  return "✅ Simulasi selesai.";
}

export function renderInteractiveDryRunPanel(
  record: StudioVersionRecord,
  state: DryRunState,
): string {
  if (isClaimStudioPack(record.pack)) {
    const pack = record.pack;
    if (!state.claimLandmarkId && pack.geography.landmarks[0]) {
      state.claimLandmarkId = pack.geography.landmarks[0].id;
    }
    const chal = getActiveClaimChallenge(pack, state.claimLandmarkId);
    const leaf = chal ? resolveDryRunLeaf(chal, state) : null;
    const soloTarget = pack.session.soloTargets?.lockedLandmarks ?? 4;
    const minRouteMin = Math.round(
      pack.geography.landmarks
        .slice(0, soloTarget)
        .reduce((s, l) => s + (l.estimatedTravelFromStartMs ?? 600_000) + (l.estimatedChallengeMs ?? 240_000), 0) /
        60_000,
    );
    const durMin = Math.round(pack.session.durationMs / 60_000);

    return `<div class="rb-card" data-testid="interactive-dry-run">
      <h4>Simulasi Dry-Run Interaktif (Claim the City)</h4>
      <div class="rb-badges">
        <span class="rb-badge">Zona: ${pack.geography.zones.length}</span>
        <span class="rb-badge">Landmark: ${pack.geography.landmarks.length}</span>
        <span class="rb-badge">Est. Rute Solo: ~${minRouteMin} m / ${durMin} m</span>
      </div>
      <div class="rb-grid-2">
        <label class="rb-field"><span>Pilih Landmark untuk Uji Tantangan</span>
          <select id="dry-claim-landmark">
            ${pack.geography.landmarks
              .map(
                (l) => `<option value="${escapeText(l.id)}" ${state.claimLandmarkId === l.id ? "selected" : ""}>${escapeText(l.name)}</option>`,
              )
              .join("")}
            <option value="backup" ${state.claimLandmarkId === "backup" ? "selected" : ""}>Backup Pool</option>
          </select>
        </label>
      </div>
      <button type="button" class="secondary" data-dry-action="open-claim-test">${state.claimTestOpen ? "Muat Ulang Modal Uji" : "Buka Modal Uji Tantangan"}</button>

      ${
        state.claimTestOpen && chal
          ? `<div class="rb-card" data-testid="dry-claim-modal">
              <div class="rb-badges">
                <span class="rb-badge">${escapeText(chal.payload.primitive)}</span>
                ${chal.payload.primitive === "multi_step" ? `<span class="rb-badge">Langkah ${state.claimMultiStepIdx + 1}/2</span>` : ""}
              </div>
              <strong>${escapeText(chal.title)}</strong>
              ${
                chal.payload.primitive === "call_your_shot" && !state.claimShotTier
                  ? `<p>Tema: ${escapeText(chal.payload.theme)}</p>
                     <div class="rb-actions">
                       <button type="button" class="secondary" data-dry-action="dry-shot-tier" data-tier="standard">Uji Standar</button>
                       <button type="button" class="primary" data-dry-action="dry-shot-tier" data-tier="bold">Uji Bold</button>
                     </div>`
                  : leaf
                    ? leaf.primitive === "observation_mcq"
                      ? `<p>${escapeText(leaf.prompt)}</p>
                         <div class="rb-list">${leaf.choices
                           .map(
                             (c, i) => `<label><input type="radio" name="dry-mcq" value="${escapeText(c.id)}" ${i === 0 ? "checked" : ""}> ${escapeText(c.label)}</label>`,
                           )
                           .join("")}</div>
                         <button type="button" class="primary" data-dry-action="submit-claim-test">Uji Jawaban MCQ</button>`
                      : leaf.primitive === "observation_input"
                        ? `<p>${escapeText(leaf.prompt)}</p>
                           <label class="rb-field"><span>Jawaban Uji (${leaf.inputMode})</span><input id="dry-input-val" placeholder="Masukkan jawaban uji"></label>
                           <button type="button" class="primary" data-dry-action="submit-claim-test">Uji Jawaban</button>`
                        : `<p>${escapeText(leaf.prompt)}</p>
                           <button type="button" class="primary" data-dry-action="submit-claim-test">Simulasikan Bukti Foto / Timer</button>`
                    : ""
              }
              ${state.claimTestResult ? `<p role="status" data-testid="dry-claim-result">${escapeText(state.claimTestResult)}</p>` : ""}
            </div>`
          : ""
      }
    </div>`;
  }

  const pack = record.pack;
  const anchors = record.snapshot.stations.filter((s) => s.eligibleHidingAnchor);
  if (!state.seekAnchorId && anchors[0]) state.seekAnchorId = anchors[0].id;
  if (!state.seekSeekerPosId) state.seekSeekerPosId = "start";

  const clueOptions: { key: string; label: string }[] = [];
  for (const [fam, cfg] of Object.entries(pack.investigationBook.families)) {
    if (!cfg?.enabled) continue;
    for (const item of cfg.items) {
      clueOptions.push({ key: `${fam}:${item.id}`, label: `${fam.toUpperCase()} · ${item.label}` });
    }
  }
  if (!state.seekClueKey && clueOptions[0]) state.seekClueKey = clueOptions[0].key;

  const totalCards = pack.deck.cards.reduce((s, c) => s + c.copies, 0);
  const curseCount = pack.deck.cards.filter((c) => c.category === "curse").reduce((s, c) => s + c.copies, 0);

  return `<div class="rb-card" data-testid="interactive-dry-run">
    <h4>Simulasi Dry-Run Interaktif (Hide &amp; Seek)</h4>
    <div class="rb-badges">
      <span class="rb-badge">${anchors.length} jangkar aktif</span>
      <span class="rb-badge">${totalCards} total kartu (${curseCount} kutukan)</span>
      <span class="rb-badge">${clueOptions.length} petunjuk aktif</span>
    </div>
    <div class="rb-grid-2">
      <label class="rb-field"><span>Jangkar Sembunyi Uji (Hider)</span>
        <select id="dry-seek-anchor">
          ${anchors.map((s) => `<option value="${escapeText(s.id)}" ${state.seekAnchorId === s.id ? "selected" : ""}>${escapeText(s.name)}</option>`).join("")}
        </select>
      </label>
      <label class="rb-field"><span>Posisi Pencari Uji (Seeker)</span>
        <select id="dry-seek-pos">
          <option value="start" ${state.seekSeekerPosId === "start" ? "selected" : ""}>${escapeText(record.snapshot.startPoint.name)} (Titik Awal)</option>
          ${record.snapshot.stations.map((s) => `<option value="${escapeText(s.id)}" ${state.seekSeekerPosId === s.id ? "selected" : ""}>${escapeText(s.name)}</option>`).join("")}
        </select>
      </label>
      <label class="rb-field"><span>Pilih Petunjuk Uji</span>
        <select id="dry-seek-clue">
          ${clueOptions.map((c) => `<option value="${escapeText(c.key)}" ${state.seekClueKey === c.key ? "selected" : ""}>${escapeText(c.label)}</option>`).join("")}
        </select>
      </label>
    </div>
    <button type="button" class="primary" data-dry-action="run-seek-clue">Jalankan Uji Petunjuk</button>
    ${state.seekClueOutput ? `<p role="status" data-testid="dry-seek-result">${escapeText(state.seekClueOutput)}</p>` : ""}
  </div>`;
}
