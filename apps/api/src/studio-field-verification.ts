import type { StudioAiProvenance, StudioPointProvenance } from "@kelana-ria/contracts";

type Report = (code: string, path: string, message: string) => void;

function isVerificationDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function validateStudioPoint(point: StudioPointProvenance, path: string, kind: "landmark" | "poi" | "station", report: Report) {
  const proximity = point.gpsVerifiedProximityMeters;
  if (proximity !== undefined && (!Number.isFinite(proximity) || proximity < 0)) {
    report("invalid-verification-proximity", `${path}.gpsVerifiedProximityMeters`, "GPS proximity must be a finite non-negative distance.");
  }
  if (point.source !== "osm-curated") return;
  if (point.fieldVerified !== true || !isVerificationDate(point.fieldVerifiedAt)) {
    report(`unverified-osm-${kind}`, path, "Verify this OpenStreetMap location in the field and record the date.");
  }
  if (typeof point.fieldVerificationNote !== "string" || point.fieldVerificationNote.trim().length < 6) {
    report("osm-verification-note-required", `${path}.fieldVerificationNote`, "Add at least six characters of field verification notes.");
  }
}

export function validateStudioAiDraft(
  provenance: StudioAiProvenance | undefined,
  verified: boolean | undefined,
  verifiedAt: string | undefined,
  notes: string | undefined,
  path: string,
  kind: "challenge" | "photo-prompt",
  report: Report,
) {
  if (provenance === undefined) return;
  if (verified !== true || !isVerificationDate(verifiedAt)) {
    report(`unverified-ai-${kind}`, path, "Verify this AI-assisted draft in the field and record the date.");
  }
  const marker = typeof provenance?.draftNoteMarker === "string" ? provenance.draftNoteMarker.trim() : "";
  if (typeof notes !== "string" || notes.trim().length < 6 ||
      notes.toLowerCase().includes("[perlu cek lapangan]") ||
      (marker && notes.toLowerCase().includes(marker.toLowerCase()))) {
    report("unedited-ai-verification-notes", `${path}.verificationNotes`, "Replace draft notes with the actual field observations.");
  }
}
