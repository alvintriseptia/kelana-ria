# AGENTS.md — Kelana Ria: Claim the City Promotional Video

This file scopes instructions exclusively to the Remotion promotional film workspace in `claim-the-city/` on branch `campaign/claim-the-city-video`.

## Git & Repository Isolation (Mandatory)

- **Active branch must be:** `campaign/claim-the-city-video`. Stop and report if on any other branch.
- **Never** modify `main`, merge into `main` or `campaign/claim-the-city`, create PRs, deploy, force-push, or rewrite history.
- **Never** modify original media files under `../assets/` or remove previously tracked files without explicit owner approval.
- Keep large renders (`renders/`, `out/`) ignored via `.gitignore`.

## Remotion 4.0.547 Conventions

- Use the installed Remotion skills in `.agents/skills/remotion-*`.
- **Asset serving:** `remotion.config.ts` sets `Config.setPublicDir("../assets")`. Reference media via `staticFile("footage/...")`, `staticFile("ui/...")`, `staticFile("photos/...")`, `staticFile("brands/...")` through `src/config/assets.ts`. Do not duplicate media files into `claim-the-city/`.
- **Media components:** Use `<Video>` and `<Audio>` from `@remotion/media` (pass `objectFit="cover"` directly as a prop, not inside `style`). Use `<Img>` from `remotion`.
- **Composition IDs:** Remotion 4.0.547 rejects underscores (`_`) in `<Composition id>`. Always use hyphens:
  - `KelanaRia-RoughCut`
  - `KR-MotionDesign-Test-S07-SH02`
- **Determinism:** Drive all motion strictly with `useCurrentFrame()` and `interpolate()` (`Easing.bezier` / `Easing.spring`). No CSS transitions/animations or unseeded randomness.
- **Fonts:** Load local SIL OFL 1.1 WOFF2 fonts via `useBrandFonts()` (`@remotion/fonts` + `useDelayRender()`). Keep `../assets/brands/licenses/` intact.

## Authoritative Campaign Rules & Visual Guardrails

Read `docs/CREATIVE_DIRECTION.md`, `docs/GAMEPLAY_RULES.md`, `docs/STORYBOARD.md`, and `docs/ASSET_MANIFEST.md` before modifying scenes.

1. **Urban Playfulness (Raw Jakarta + Jakarta Playground + Weekend Memories):** Preserve live-action footage naturally; use warm printed-paper editorial graphics (`#F7F6ED`, `#153D34`, `#FFCE55`, `#075C54`, `#F4D572`) — never cyberpunk neon, glassmorphism, or generic HUD panels.
2. **Corrected v3 Gameplay Rules:**
   - Check-in unlocks a challenge; it never grants ownership.
   - Unclaimed landmarks stay unclaimed on failure (`Yellow` never owns `Sarinah`).
   - Primary score is **`Zona dikuasai`** (never unlabeled point totals).
   - **Poin Ganda** only doubles weight (`1 → 2`) on an already-claimed landmark; during `KR_S07_SH02` it is available in inventory and **not activated**.
   - Never display `KR_UI_MAP_SARINAH.png` before Sarinah is claimed and Poin Ganda is activated.
3. **Clean Assets & Attribution:**
   - Never display simulation developer disclaimers (`KR_UI_SARINAH_GREEN_DETAIL.png`, `KR_UI_GBK_SUCCESS.png`, `KR_COMPONENT_INVITATION.png`).
   - Always preserve map attribution (`OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors`) whenever map imagery is shown.
4. **Editable Timeline:** All rough-cut cuts, trims, and per-clip audio gains belong in `src/config/timeline.ts` so timing edits do not require rewriting React components.

## Validation Commands

```bash
npm run lint                  # ESLint + TypeScript check (must pass cleanly)
npm run compositions          # Verify registered compositions & durations
npm run render:prototype:stills
npm run render:prototype
```
