import type { ClaimChallengeItem, StudioPointProvenance } from "@kelana-ria/contracts";
import { isClaimStudioPack, type StudioVersionRecord } from "./studio-types";

export const studioDate = () => new Date().toISOString().slice(0, 10);

export function validFieldNote(note: string, draftMarker = "[PERLU CEK LAPANGAN]") {
  const copy = note.trim().toLowerCase();
  return copy.length >= 6 && !copy.includes("[perlu cek lapangan]") &&
    (!draftMarker.trim() || !copy.includes(draftMarker.trim().toLowerCase()));
}

function verifiedDate(date?: string) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const value = Date.parse(date);
  return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === date;
}

type FieldEvidence = {
  group: "osm" | "ai" | "challenge";
  name: string;
  path: string;
  verified: boolean;
  note: string;
  date?: string;
  meters?: number;
  sourceLabel?: string;
};

export function studioFieldEvidence({ pack, snapshot }: StudioVersionRecord): FieldEvidence[] {
  const evidence: FieldEvidence[] = [];
  const point = (item: StudioPointProvenance & { name: string }, path: string) => {
    if (item.source !== "osm-curated") return;
    const note = item.fieldVerificationNote ?? "";
    const date = item.fieldVerifiedAt;
    evidence.push({
      group: "osm", name: item.name, path, note, date,
      meters: item.gpsVerifiedProximityMeters,
      verified: Boolean(item.fieldVerified && verifiedDate(date) && note.trim().length >= 6),
    });
  };
  const challenge = (item: ClaimChallengeItem, path: string) => {
    evidence.push({
      group: item.aiProvenance ? "ai" : "challenge", name: item.title, path,
      note: item.verificationNotes, date: item.reviewedAt,
      sourceLabel: item.aiProvenance?.mode === "template-fallback" ? "Templat simulasi" : "Ide AI",
      verified: Boolean(item.reviewed && verifiedDate(item.reviewedAt) &&
        validFieldNote(item.verificationNotes, item.aiProvenance?.draftNoteMarker)),
    });
  };
  snapshot.pois.forEach((item, index) => point(item, `snapshot.pois[${index}]`));
  snapshot.stations.forEach((item, index) => point(item, `snapshot.stations[${index}]`));
  if (isClaimStudioPack(pack)) {
    pack.geography.landmarks.forEach((item, index) => point(item, `geography.landmarks[${index}]`));
    pack.challenges.backupPool.forEach((item, index) => challenge(item, `challenges.backupPool[${index}]`));
    pack.challenges.challengeHandPool?.forEach((item, index) => challenge(item, `challenges.challengeHandPool[${index}]`));
    for (const [landmarkId, items] of Object.entries(pack.challenges.landmarkChallenges)) {
      items.forEach((item, index) => challenge(item, `challenges.landmarkChallenges.${landmarkId}[${index}]`));
    }
  } else {
    pack.investigationBook.families.photo?.items.forEach((item, index) => {
      if (!item.aiProvenance) return;
      const note = item.verificationNotes ?? "";
      evidence.push({
        group: "ai", name: item.label, path: `investigationBook.families.photo.items[${index}]`,
        note, date: item.fieldVerifiedAt,
        sourceLabel: item.aiProvenance.mode === "template-fallback" ? "Templat simulasi" : "Ide AI",
        verified: Boolean(item.fieldVerified && verifiedDate(item.fieldVerifiedAt) &&
          validFieldNote(note, item.aiProvenance.draftNoteMarker)),
      });
    });
  }
  return evidence;
}

function progress(items: FieldEvidence[], label: string) {
  return `${label} · ${items.filter(item => item.verified).length}/${items.length} terverifikasi`;
}

export function StudioFieldChecklist({ record }: { record: StudioVersionRecord }) {
  const evidence = studioFieldEvidence(record);
  const pending = evidence.filter(item => !item.verified);
  return <section class="studio-evidence" aria-label="Checklist Verifikasi Lapangan">
    <h4>Checklist Verifikasi Lapangan</h4>
    <div class="rb-badges">
      <span class="rb-badge">{progress(evidence.filter(item => item.group === "osm"), "Lokasi OSM")}</span>
      <span class="rb-badge">{progress(evidence.filter(item => item.group === "ai"), "Ide AI")}</span>
      {evidence.some(item => item.group === "challenge") &&
        <span class="rb-badge">{progress(evidence.filter(item => item.group === "challenge"), "Tantangan lainnya")}</span>}
    </div>
    {pending.length ? <>
      <p>Selesaikan pemeriksaan berikut sebelum mengajukan paket untuk tinjauan.</p>
      <ul class="rb-list">{pending.map(item => <li key={item.path}>
        <strong>{item.name}</strong>
        <button type="button" class="secondary" data-jump-path={item.path} data-field-verification
          aria-label={`Cek & Verifikasi ${item.name}`}>Cek &amp; Verifikasi →</button>
      </li>)}</ul>
    </> : <p>{evidence.length ? "Semua pemeriksaan lapangan selesai." : "Belum ada item yang memerlukan cek lapangan."}</p>}
  </section>;
}

export function StudioReviewerProvenance({ record }: { record: StudioVersionRecord }) {
  const items = studioFieldEvidence(record).filter(item => item.group !== "challenge");
  const osmCount = items.filter(item => item.group === "osm").length;
  if (!items.length) return null;
  return <details class="studio-evidence">
    <summary><span>Ringkasan Sumber &amp; Verifikasi</span>
      <span class="rb-badges">
        <span class="rb-badge">{osmCount} titik OSM · {items.length - osmCount} ide AI</span>
        <span class="rb-badge">{items.every(item => item.verified) ? "Semua terverifikasi kreator" : "Ada pemeriksaan tertunda"}</span>
      </span>
    </summary>
    <ul class="rb-list">{items.map(item => <li key={item.path}>
      <strong>{item.name}</strong>
      <small>{item.group === "osm" ? "OpenStreetMap" : item.sourceLabel} · {item.date || "Belum terverifikasi"}</small>
      {item.note && <p>{item.note}</p>}
      {typeof item.meters === "number" && <span class="rb-badge">GPS · {item.meters} m</span>}
    </li>)}</ul>
  </details>;
}

export const renderStudioChecklist = (record: StudioVersionRecord) => <StudioFieldChecklist record={record} />;
export const renderStudioProvenance = (record: StudioVersionRecord) => <StudioReviewerProvenance record={record} />;
