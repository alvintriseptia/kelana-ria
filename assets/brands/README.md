# Kelana Ria brand assets

Remotion handoff from `campaign/claim-the-city` at commit `3cd9547`.
The logo images, illustrations, fonts, and license notices are byte-for-byte
copies. Source references preserve the app's original definitions.

## Logo and wordmark

| Asset | Original usage |
| --- | --- |
| `logos/icon-192.png` | Standard logo symbol used in the masthead, favicon, and Apple touch icon. |
| `logos/icon-512.png` | Higher-resolution version of the standard symbol from the PWA manifest. |
| `logos/maskable-192.png`, `logos/maskable-512.png` | PWA maskable variants with their original safe-area padding. |
| `source-reference/masthead-lockup.html` | Original primary lockup markup from `apps/web/index.html`. It pairs the 38 × 38 symbol with the live text “Kelana Ria”. |

The repository supplies the wordmark as live text and provides one logo colorway.
There are no standalone logo or wordmark SVGs and no separate light or dark
logo files. The maskable files are icon-format variants. The lockup uses
Barlow Condensed 700, a line height of 1, and letter spacing of `-.035em`.
The app uses 32 px text and an 11 px gap, with 28 px text and a 32 px
symbol on narrow screens. The original wordmark inherits shell ink.

## Colors

| Source | Tokens |
| --- | --- |
| Shell and masthead · `style.css` | Paper `#F7F6ED`, card `#FFFEF7`, ink `#153D34`, muted `#52675C`, line `#C4CEBB`, yellow `#FFCE55` |
| Logo artwork · original PNGs | Dominant yellow `#FFCE55` and dark green `#133E35` |
| Catalog · `rulebook-catalog.css` | Forest `#104A40`, mint `#E5F2E5`, line `#87AA9B`, lime `#D9F181` |
| Game UI · `rulebook-seek-play.css` | Ink `#122F29`, teal `#075C54`, sky `#BCE7F0`, cloud `#F6FBF7`, leaf `#C5EE69`, edge `#8CAB9D` |
| Claim team treatments · `rulebook-claim-play.css` | Green background `#075C54` with `#FFFFFF` text. Yellow background `#F4D572` with `#3C2D06` text. |

## Typography

| Typeface | App role | Included file |
| --- | --- | --- |
| Barlow Condensed 700, normal | Wordmark, headings, and display numbers | `fonts/barlow-condensed-latin-700-normal.woff2` |
| DM Sans, normal variable weight 100–1000 | Body copy, labels, and controls | `fonts/dm-sans-latin-wght-normal.woff2` |

The files are the exact Latin WOFF2 faces referenced by the app, sourced from
its installed Fontsource 5.3.0 dependencies. The original `@font-face`
definitions and fallback stack are in `source-reference/style.css`.
Both fonts are under SIL Open Font License 1.1. Keep the corresponding
copyright and license notices in `licenses/` when redistributing the fonts.
The license also sets conditions for modified fonts, reserved names, and
standalone sales.

## Patterns and illustrations

| Asset | Original usage |
| --- | --- |
| `artwork/jakarta.webp` | Jakarta cover artwork used in the catalog and practice photo example. |
| `artwork/solo-schematic.webp` | Schematic game board illustration for Solo, Duo, and Hide & Seek. |
| `artwork/seek-questions.webp` | Original question card artwork atlas. |
| `artwork/seek-rewards.webp` | Original reward and tactical card artwork atlas. Poin Ganda uses the middle cell of the second row, as defined by `.cg-art-double`. |
| `source-reference/rulebook-seek-play.css` | Original card-back stripe pattern under `.sg-offer-back` and atlas positioning. |
| `source-reference/edition-practice.css` | Original practice-board pattern and card-back stripes under `.ep-board` and `.ep-card-back`. |
| `source-reference/rulebook-catalog.css` | Original catalog cover stripe fallback. |
| `source-reference/studio-assets.ts` | Original inline SVG illustrations and icons from Creator Studio, preserved in their source form. |

The original atlases remain intact. The source references document the layout
used by the app. The HTML file is a source excerpt for the lockup.

## Artwork and release rights

The repository does not include a standalone redistribution license or a
complete rights record for the logo and artwork. The inclusion of those
files in this campaign handoff does not grant reuse rights. Confirm their
provenance and publication clearance with the project owner before external
distribution. The artwork package excludes external map tiles, third-party
game assets, and campaign concept screenshots. If a later composition uses
map imagery, retain the provider and data credits applicable to that imagery.
