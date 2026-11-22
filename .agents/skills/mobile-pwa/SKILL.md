---
name: mobile-pwa
description: Use for installability, mobile screens, map and list interactions, performance budgets, or first-time-player usability checks.
---

# Verify the phone experience

Start with the decision a player must make on this screen. Show the objective before requesting location. Use the initial Jakarta copy conventions from PRD section 8. Give each active screen a clear primary action and name the checkpoint for check-in. Keep a text action for each map action and distinguish ownership and ties with words or shapes.

Design every screen—including Creator Studio and `Panduan`—like a tactile mobile game rather than a text-heavy web form:
- Prefer illustrated SVG/WebP visual assets, card previews, compact icon chips, and visual state indicators over long explanatory paragraphs.
- Keep zero horizontal overflow (`document.documentElement.scrollWidth <= window.innerWidth`) across all `390x844` phone states, forms, drawers, and dialogs.
- Mount MapLibre GL JS once per active map view and update GeoJSON sources/markers in-place (`setData()` / marker diffing) so interactive clicks, filter toggles, and form edits never tear down or flicker the map canvas.
- Teach rules through bite-sized interactive tutorial steps and playable visual mini-demos instead of dense prose blocks.

For the shell issue, define a reproducible cold-load mobile profile. Record browser version, viewport, network and CPU throttling, build revision and cache state. Capture at least three runs and report median LCP, CLS and initial transferred JavaScript bytes. Inspect the request trace for the map renderer before the map opens. Check the manifest, installability and ordinary browser launch. Commit the measurement command and initial budgets with the shell.

For a UI PR, run the committed mobile browser tests and budget check documented by the shell. Report the exact commands, profile and results. Until that harness exists, establishing it belongs to the shell issue. On map features, interrupt tile requests and exercise the equivalent list. Deny location and retry, reconnect after a pending action, navigate by keyboard, and check screen-reader announcements for phase or score changes. Include a phone-size screenshot or trace for the affected path.

For comprehension evidence, observe a first-time player explain the objective, choose a checkpoint and explain a result. Record what happened before offering help. File observed confusion with the screen and task. Label simulated movement and link field observations separately.
