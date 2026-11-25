# Creative Direction — Urban Playfulness

## Core Campaign Message

**Rediscovery, not discovery.**

The four friends already know Jakarta. They are not tourists discovering sights for the first time — Kelana Ria turns familiar streets, public transit, and landmarks into a shared competitive playground, ending in genuine weekend friendship.

- **Brand tagline:** `Mainkan kotamu.`
- **Closing CTA:** `SEGERA HADIR`
- **Language:** Natural, casual Jakarta Indonesian.
- **Format:** Landscape 16:9 (`1920 × 1080`, `30 fps`) for the Kelana Ria website and YouTube.
- **Restrictions:** Do not invent release dates, app-store badges, public availability claims, supported city lists, or narration.

---

## Three Visual Pillars

### 1. Raw Jakarta (`assets/references/KR_style_Raw_Jakarta.png`)
The live-action foundation.
- Authentic everyday Jakarta streets, public transit (TransJakarta & MRT), and warung warmth.
- Neutral natural lighting, observational consumer-camera framing, and believable imperfections.
- Preserve source footage intact: no aggressive cinematic grading, artificial golden-hour washes, extreme contrast, or synthetic visual enhancement.

### 2. Jakarta Playground (`assets/references/KR_style_Jakarta_Playground.png`)
The motion-graphics language of gameplay, geography, and tactical decisions.
- Warm printed-paper tactile surfaces (`#F7F6ED`, `#FFFEF7`), crisp forest-ink rules (`#153D34`), hard offset print shadows (`6px 6px 0px #153D34`), bold condensed display typography (`Barlow Condensed 700`), and clean utility copy (`DM Sans`).
- Playful board-game cues: terracotta notice banners (`#FBECDC` / `#B65C35`), rubber-stamp status badges (`BELUM DIKLAIM`), animated hand-drawn dashed map routes, yellow highlighter sweeps (`#FFCE55`), and distinct team color coding (`#075C54` Green Team, `#F4D572` / `#3C2D06` Yellow Team).
- **Avoid:** Cyberpunk/neon HUDs, glassmorphism, floating SaaS dashboards, generic gradients, decorative particles, and unmotivated bouncy springs.

### 3. Weekend Memories (`assets/references/- KR_style_Weekend_Memories.png`)
The emotional resolution (Scene 08).
- Crisp candid photographic prints framed on warm `#F7F6ED` paper with subtle stacked-print composition.
- Preserve every photograph's original aspect ratio (`4:3` for `KR_PH01–04`, `16:9` for `KR_S08_PH01`) and never crop faces.
- **Avoid:** Exaggerated vintage film-burn filters, fake timestamps, or heavy scrapbook clipart clutter.

---

## Graphic Presentation Approaches

1. **Approach A — Actual UI over Footage:** Isolated v3 components placed strictly in negative space (e.g., right tunnel corridor in `KR_S07_SH02`), never covering character faces, key gestures, or physical smartphones.
2. **Approach B — Editorial Graphic Interludes:** Dedicated Jakarta Playground compositions for missing shot bridges, passage of time, standings shifts, and the 9-step Sarinah tactical turnaround.
3. **Approach C — Full Application Screens:** Reserved sparingly for moments where complete mobile context genuinely aids comprehension; never display simulation-only developer notes or localhost URLs.

---

## Brand Palette & Typography Tokens (`src/config/brand.ts`)

| Token | Hex | Source |
| --- | --- | --- |
| Paper | `#F7F6ED` | `style.css` |
| Card | `#FFFEF7` | `style.css` |
| Ink / Deep Ink | `#153D34` / `#122F29` | `style.css` / `rulebook-seek-play.css` |
| Muted / Line | `#52675C` / `#C4CEBB` | `style.css` |
| Brand Yellow | `#FFCE55` | `style.css` & logo PNGs |
| Green Team | `#075C54` bg / `#FFFFFF` text | `rulebook-claim-play.css` |
| Yellow Team | `#F4D572` bg / `#3C2D06` text | `rulebook-claim-play.css` |
| Notice Accent | `#B65C35` on `#FBECDC` | `rulebook-claim-play.css` |
| Lime Accent | `#D9F181` | `rulebook-catalog.css` |

- **Display / Wordmark:** `Barlow Condensed` 700 (`barlow-condensed-latin-700-normal.woff2`, SIL OFL 1.1). Wordmark lockup uses `line-height: 1`, `letter-spacing: -0.035em`.
- **Body / UI Labels:** `DM Sans` variable 100–1000 (`dm-sans-latin-wght-normal.woff2`, SIL OFL 1.1).
