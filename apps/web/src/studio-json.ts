import type { GeoSnapshot } from "@kelana-ria/contracts";
import type { StudioPack, StudioVersionRecord } from "./studio-types";

export type StudioJsonBundle = {
  pack: StudioPack;
  snapshot: GeoSnapshot;
};

export function serializeStudioBundle(record: StudioVersionRecord): string {
  const bundle: StudioJsonBundle = {
    pack: record.pack,
    snapshot: record.snapshot,
  };
  return JSON.stringify(bundle, null, 2);
}

export function triggerStudioBundleDownload(record: StudioVersionRecord): void {
  const content = serializeStudioBundle(record);
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${record.packId}-v${record.version}.rulebook.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function parseStudioBundleJson(
  rawText: string,
  expectedFormat: "hide-and-seek" | "claim-the-city",
): { ok: true; bundle: StudioJsonBundle } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: false, error: "JSON tidak valid. Periksa tanda kurung dan koma." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Format bundel JSON harus berupa objek { pack, snapshot }." };
  }
  const obj = parsed as Record<string, unknown>;
  if (!obj.pack || typeof obj.pack !== "object" || !obj.snapshot || typeof obj.snapshot !== "object") {
    return { ok: false, error: "Bundel JSON wajib memiliki properti 'pack' dan 'snapshot'." };
  }
  const pack = structuredClone(obj.pack) as StudioPack;
  const snapshot = structuredClone(obj.snapshot) as GeoSnapshot;
  if (!pack.meta || typeof pack.meta.packId !== "string" || !pack.meta.packId.trim()) {
    return { ok: false, error: "pack.meta.packId wajib diisi." };
  }
  if (pack.meta.format !== expectedFormat) {
    return {
      ok: false,
      error: `Format pack JSON (${String(pack.meta.format)}) tidak cocok dengan format Studio aktif (${expectedFormat}).`,
    };
  }
  // Enforce community authorship invariant on import.
  pack.meta.isOfficial = false;
  return { ok: true, bundle: { pack, snapshot } };
}
