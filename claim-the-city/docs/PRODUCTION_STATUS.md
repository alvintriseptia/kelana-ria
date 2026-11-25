# Production Status — Claim the City Promotional Film

## Milestone 4.1 Complete: Narrative Clarity Correction Review Ready (`99.67s` / `2,990f`)

> **Status:** Revised audiovisual review [`renders/KR_Campaign_NarrativeRefinement_V1.mp4`](../renders/KR_Campaign_NarrativeRefinement_V1.mp4) is rendered and verified. Paused awaiting project owner approval of the restored narrative before regenerating all Milestone 4.0 final delivery formats (`Master.mov`, `YouTube.mp4`, `Web.mp4`, `Web_720p.mp4`, updated `ID.srt`/`.vtt`). Existing Milestone 4.0 exports in `renders/final/` remain untouched.

| Area | Status | Notes |
| --- | --- | --- |
| Branch & project isolation | Complete | Exclusively on `campaign/claim-the-city-video`, inside `claim-the-city/`, all original `assets/` untouched, zero stock audio or renders staged/committed. |
| Milestone 4.0 Backups (`83.60s` / `2,508f`) | Preserved | Backed up `src/config/timeline.83.6s-m4.backup.ts`, `src/components/motion/CampaignSceneOverlays.83.6s-m4.backup.tsx`, `scripts/build_audio_mix.83.6s-m4.backup.py`, `docs/SOUND_DESIGN_CUE_SHEET.83.6s-m4.backup.md`, `assets/audio/mix/KR_ClaimTheCity_MasterMix_48k_83.6s_m4_backup.wav`, plus intact `renders/final/*`. |
| Revised Timeline (`KelanaRia-RoughCut`) | **Updated (`2,990f` / `99.67s`)** | Dynamically calculated from [`src/config/timeline.ts`](../src/config/timeline.ts) (`+16.07s` / `+482f` vs previous `83.60s` / `2,508f`) at `1920 × 1080`, `30 fps`. |
| Correction A (`S03_SH01` Game Objective) | Complete | Trim widened `2.00–7.10s` → **`0.60–7.70s`** (`+2.00s`), restoring animated paper-map opening, native paper rustle (`1.2–1.5s`), and full `0.75s` landing after Arga's *"Iya. Siapa yang dapat paling banyak."* Enhanced objective banner adds **`KUASAI ZONA TERBANYAK.`** + **`Tim dengan zona terbanyak saat waktu habis menang`**. |
| Correction B (`S05` GBK 7-Step Progression) | Complete | Restored `S05_SH01` (`0.00–6.90s`, `+2.90s` — Arga's *"Oh, disuruh nyari kode di tiga gate."*), `S05_SH02` (`0.00–6.70s`, `+4.20s` — *"B, F, sama H."* → *"Lah, ini udah H!"*), and `S05_SH04` (`0.40–7.50s`, `+5.00s` — fixes clipped *"sebelas"* and restores clue assembly before distinct `GELORA BUNG KARNO` claim). Synchronized Check-in (non-ownership) → Challenge Unlock → Gate H live tick → Challenge Complete → distinct Landmark Claim overlays without printing unverified numeric clues as factual signage. |
| Continuity Audit Fixes (`S04`, `S06`) | Complete | Restored `S06_SH01` Sari's setup *"Dari sini dapat nih."* (`1.30–6.90s`, `+1.10s`) with Bundaran HI photo proof re-locked to native shutter (`frameOffset={36}`); added clean `0.20–0.25s` vocal tails on `S04_SH01`, `S04_SH02`, `S04_SH04`, and `S06_SH03_V4` to eliminate abrupt cuts. All unrelated scenes (`S01`, `S02`, `S07`, `INT_MATCH_CONCLUSION`, `S08`, `S09`) preserved intact. |
| Resynchronized Audio Mix (`99.67s`) | Complete & Verified | Rebuilt `assets/audio/mix/KR_ClaimTheCity_MasterMix_48k.wav` via `scripts/build_audio_mix.py`: phrase-aligned 6-region `Funky Triplets` edit (exact 4-bar `B14→B10` repeat at `00:36.90`, Breakdown #1 on `JAWABAN SALAH` `00:59.23`, Peak Chorus on `01:13.20`, zero-drum Breakdown #2 across warung, native final button dead-on `SEGERA HADIR` `01:37.20`), dynamic J-cut/L-cut, and 23 onset-locked SFX cues (`docs/SOUND_DESIGN_CUE_SHEET.md`). Measured **`-14.58 LUFS` / `-1.16 dBTP`** (WAV) and **`-14.60 LUFS` / `-1.07 dBTP`** (MP4), `4.20 LU` LRA, `0` mid-film silence gaps. |
| Review Render (`KR_Campaign_NarrativeRefinement_V1.mp4`) | Exported & QA'd | `46.01 MiB`, `1920 × 1080`, `30 fps`, `2,990` frames (`99.67s`), H.264 High (`3.67 Mbps`, BT.709, `+faststart`), `192 kbps` FDK-AAC, `0` black frames, `npm run lint` & `npm run compositions` PASS. |

---

## Pending Work (Paused Awaiting Owner Review of `KR_Campaign_NarrativeRefinement_V1.mp4`)

1. **Owner Approval of Milestone 4.1 Narrative Revision:** Review `renders/KR_Campaign_NarrativeRefinement_V1.mp4` for conversational flow, GBK clarity, and overall `99.67s` pacing.
2. **Final Delivery Regeneration (After Approval):** Re-export `KR_ClaimTheCity_Master.mov`, `KR_ClaimTheCity_YouTube.mp4`, `KR_ClaimTheCity_Web.mp4`, `KR_ClaimTheCity_Web_720p.mp4`, update Indonesian subtitles (`subtitles/KR_ClaimTheCity_ID.{srt,vtt}`) to match the restored `99.67s` dialogue, and refresh `docs/FINAL_DELIVERY.md`.
3. **Pre-Release Clearances (Unchanged):** Confirm brand/artwork publication clearance (`assets/brands/README.md`), complete GBK/Sarinah on-site clue review (`assets/ui/manifest.json`), retain `assets/audio/LICENSE_RECORDS.md` for YouTube Content ID support (`team@mixkit.co`), and never embed `Funky Triplets` inside the Kelana Ria game app.
