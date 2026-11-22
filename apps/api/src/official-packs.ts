import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { ClaimRulebookPack, GeoSnapshot, HideSeekRulebookPack } from "@kelana-ria/contracts";
import { validateClaimRulebook } from "./claim-engine/claim-rulebook-validator.js";
import { validateHideSeekRulebook } from "./seek-engine/rulebook-validator.js";

export type LoadedOfficialSeekPack = {
  pack: HideSeekRulebookPack;
  snapshot: GeoSnapshot;
};

export type LoadedOfficialClaimPack = {
  pack: ClaimRulebookPack;
  snapshot: GeoSnapshot;
};

const defaultPacksDir = fileURLToPath(new URL("../packs/official", import.meta.url));

export function loadOfficialSeekPacks(packsDir = defaultPacksDir): LoadedOfficialSeekPack[] {
  const entries = readdirSync(packsDir)
    .filter((file) => file.endsWith(".pack.json"))
    .sort();
  const loaded: LoadedOfficialSeekPack[] = [];

  for (const packFile of entries) {
    const rawPack = JSON.parse(readFileSync(path.join(packsDir, packFile), "utf8")) as HideSeekRulebookPack;
    if (rawPack?.meta?.format !== "hide-and-seek") continue;
    const baseName = packFile.replace(/\.pack\.json$/, "");
    const geoPath = path.join(packsDir, `${baseName}.geo.json`);
    const snapshot = JSON.parse(readFileSync(geoPath, "utf8")) as GeoSnapshot;
    const validation = validateHideSeekRulebook(rawPack, snapshot);
    if (!validation.ok) {
      throw new Error(
        `Official pack "${packFile}" failed validation: ${validation.errors.map((e) => `${e.code}:${e.path}`).join(", ")}`,
      );
    }
    loaded.push({ pack: rawPack, snapshot });
  }
  return loaded;
}

export function loadOfficialClaimPacks(packsDir = defaultPacksDir): LoadedOfficialClaimPack[] {
  const entries = readdirSync(packsDir)
    .filter((file) => file.endsWith(".pack.json"))
    .sort();
  const loaded: LoadedOfficialClaimPack[] = [];

  for (const packFile of entries) {
    const rawPack = JSON.parse(readFileSync(path.join(packsDir, packFile), "utf8")) as ClaimRulebookPack;
    if (rawPack?.meta?.format !== "claim-the-city") continue;
    const baseName = packFile.replace(/\.pack\.json$/, "");
    const geoPath = path.join(packsDir, `${baseName}.geo.json`);
    const snapshot = JSON.parse(readFileSync(geoPath, "utf8")) as GeoSnapshot;
    const validation = validateClaimRulebook(rawPack, snapshot);
    if (!validation.ok) {
      throw new Error(
        `Official Claim pack "${packFile}" failed validation: ${validation.errors.map((e) => `${e.code}:${e.path}`).join(", ")}`,
      );
    }
    loaded.push({ pack: rawPack, snapshot });
  }
  return loaded;
}
