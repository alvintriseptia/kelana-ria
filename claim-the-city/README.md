# Kelana Ria — Claim the City Promotional Film

Self-contained Remotion (`4.0.547`) post-production workspace for the **Claim the City** landscape (`1920 × 1080`, `30 fps`) promotional film on branch `campaign/claim-the-city-video`.

## Asset Serving

Original media assets remain untouched in [`../assets/`](../assets/) and are served directly via `Config.setPublicDir("../assets")` in [`remotion.config.ts`](./remotion.config.ts) with zero media duplication.

## Registered Compositions

> **Note:** Remotion `4.0.547` only permits letters, numbers, and hyphens (`-`) in composition IDs (underscores are disallowed at runtime and by ESLint).

| Composition ID | Resolution / FPS | Duration | Purpose |
| --- | --- | --- | --- |
| `KelanaRia-RoughCut` | `1920 × 1080` · `30 fps` | `83.60s` (`2,508f`) | **Locked** campaign timeline integrated with Milestone 2 Jakarta Playground motion graphics and Milestone 3.3 mastered 48 kHz audio mix (`useMasterAudioMix: true`), driven by [`src/config/timeline.ts`](./src/config/timeline.ts). |
| `KR-MotionDesign-Test-S07-SH02` | `1920 × 1080` · `30 fps` | `6.50s` (`195f`) | Approved Milestone 1.2 standalone sequential prototype (`S07_SH02` `0.30s–6.80s`). Original V1 preserved at `src/compositions/MotionDesignTestS07SH02.v1.backup.tsx`. |
| `KR-ClaimTheCity-Thumbnail` | `1920 × 1080` | Still | Milestone 4.0 YouTube & website poster thumbnail rendered from [`src/components/CampaignThumbnail.tsx`](./src/components/CampaignThumbnail.tsx). |

## Owner & Producer Commands

Run all commands from inside `claim-the-city/`:

```bash
# 1. Install dependencies (first time only)
npm ci

# 2. Launch interactive Remotion Studio preview
npm run studio
# (Use the left sidebar under "Claim-the-City" to switch between
#  "KelanaRia-RoughCut", "KR-MotionDesign-Test-S07-SH02", and "KR-ClaimTheCity-Thumbnail".)

# 3. Validate TypeScript, ESLint, and registered compositions
npm run lint
npm run compositions

# 4. Rebuild the deterministic 48 kHz / 24-bit mastered audio mix
npm run audio:mix
# Output (gitignored): ../assets/audio/mix/KR_ClaimTheCity_MasterMix_48k.wav

# 5. Render the 1920x1080 campaign thumbnail still
npm run render:thumbnail
# Output: renders/final/KR_ClaimTheCity_Thumbnail.jpg

# 6. Encode YouTube, Web (1080p CRF 25), and Web 720p companion directly from Master.mov
npm run encode:deliveries
# Outputs: renders/final/KR_ClaimTheCity_{YouTube,Web,Web_720p}.mp4

# 7. Run independent ffprobe, faststart, loudness, silence & black-frame QA
npm run qa:deliveries

# 8. Legacy review scripts (preserved for reference)
npm run render:campaign
npm run render:prototype
```

## Editing the Locked Timeline

Source trims (`trimStartSec`, `trimEndSec`), interlude durations (`durationSec`), and per-clip audio gain (`volume`) remain locked in [`src/config/timeline.ts`](./src/config/timeline.ts). Start frames and total composition length recalculate automatically if later approved edits occur.

## Production Documentation

- [`docs/FINAL_DELIVERY.md`](./docs/FINAL_DELIVERY.md) — Milestone 4.0 final delivery specs, independent loudness/QA verification, subtitles, licensing, website/YouTube guides & release blockers
- [`docs/PRODUCTION_STATUS.md`](./docs/PRODUCTION_STATUS.md) — Current production & release-gate status
- [`docs/CREATIVE_DIRECTION.md`](./docs/CREATIVE_DIRECTION.md) — Urban Playfulness visual direction & brand tokens
- [`docs/STORYBOARD.md`](./docs/STORYBOARD.md) — Locked 83.60s 9-scene campaign timeline
- [`docs/AUDIO_DIRECTION.md`](./docs/AUDIO_DIRECTION.md) — Milestone 3.1 music direction, independent FFmpeg/PCM audio audit & music spotting
- [`docs/SOUND_DESIGN_CUE_SHEET.md`](./docs/SOUND_DESIGN_CUE_SHEET.md) — Frame-accurate Milestone 3.1 sound effects spotting & preserved native audio map
- [`docs/AUDIO_ASSET_REQUIREMENTS.md`](./docs/AUDIO_ASSET_REQUIREMENTS.md) — Practical music & tactile SFX shopping list, WAV specs & licensing requirements
- [`docs/AUDIO_ASSET_MANIFEST.md`](./docs/AUDIO_ASSET_MANIFEST.md) — Milestone 3.2 acquired audio inventory, objective `Funky Triplets` analysis, composite SFX recipes & ear-check list
- [`../assets/audio/LICENSE_RECORDS.md`](../assets/audio/LICENSE_RECORDS.md) — Verified Mixkit license terms & provenance records (raw stock audio excluded from Git)
- [`docs/GAMEPLAY_RULES.md`](./docs/GAMEPLAY_RULES.md) — Corrected v3 gameplay rules & field-verification notes
- [`docs/ASSET_MANIFEST.md`](./docs/ASSET_MANIFEST.md) — Verified media inventory, Shot-ID mapping, audio & UI audit
