# Kelana Ria gameplay concept

A clickable practice board for the active Claim the City and Hide & Seek screens. It uses the fictional Kota Arunika edition, the game’s palette, DM Sans, Barlow Condensed, and the existing question and reward illustrations. All geography, events, and timing are simulated in the page.

## Open the prototype

From the repository root, install the workspace with the Node version in `.nvmrc` and serve the repository on localhost.

```sh
npm ci
python3 -m http.server 8080 --bind 127.0.0.1
```

- [Claim the City practice board](http://127.0.0.1:8080/docs/qa/gameplay-concept/)
- [Hide & Seek practice board, Pencari](http://127.0.0.1:8080/docs/qa/gameplay-concept/?mode=seek)
- [Hide & Seek practice board, Penyembunyi with a pending question](http://127.0.0.1:8080/docs/qa/gameplay-concept/?mode=seek&role=hider)

Use **Tantangan** to check in and answer, **Kartu** to keep a reward and choose its target, and **Skor** to see the confirmed zone totals. For Hide & Seek, send a Radar question, choose **Lihat sebagai Penyembunyi** in the More menu, answer and keep a card, then switch back to see the confirmed deduction. **Menu lainnya** also offers rejection, reconnection, map failure and reward-expiry simulations. **Escape** folds the current sheet or closes the More menu. The **Kurangi gerak** switch and the system preference both disable decorative motion.

## Visual references

- [Claim boards, challenge and reward at 390 × 844](evidence/claim-comparison.webp)
- [Seek Radar preview, private answer and reward at 390 × 844](evidence/seek-comparison.webp)
- [Pending, retry, reconnect, list fallback, confirmed deduction and expiry at 390 × 844](evidence/recovery.webp)
- [Compact screens and reduced motion at 320 × 640](evidence/compact.webp)
- [Player MapLibre basemap and token comparisons](map-evidence.md) with Jakarta Claim and Bandung Seek fixtures.

The comparison frames pair the current Jakarta QA sessions at commit `dff31ef` with equivalent steps in the synthetic practice edition. The map stays visible behind focused controls in both modes. The concept moves the objective and progress into a fixed band, keeps the action and its context together, uses a single primary button, and distinguishes board states with shapes and words. The Claim card offer shows a separate selection and confirmation. In Seek, dashed Radar is a draft, a muted circle waits for an answer, and hatching marks a confirmed exclusion. The private answer, code, and reward stay with Penyembunyi. [Motion contract](../../../.agents/skills/mobile-pwa/game-ui.md#active-gameplay-concept)

## Reproduce the visual checks

```sh
npm run build
npx --no-install playwright install --with-deps --no-shell chromium
node docs/qa/gameplay-concept/check.mjs http://127.0.0.1:8080
npm run qa:rulebook-claim --workspace @kelana-ria/web
npm run qa:rulebook-seek --workspace @kelana-ria/web
npm run qa --workspace @kelana-ria/web
python3 -m unittest discover -s factory -v
```

The concept test writes screenshots to `apps/web/qa-results/gameplay-concept/`. It exercises keyboard and tap, 44 px hit targets, text contrast, safe areas with simulated 44/34 px insets, preserved board DOM, role privacy, reduced motion and recovery. The baseline Seek frames come from `qa:rulebook-seek`. The baseline Claim frames were captured from the same catalog and solo QA flow as `qa:rulebook-claim`, at landmark selection, after check-in, and when the reward opened, at 390 × 844 with animation disabled. The concept uses a static SVG illustration and browser-local state, so the production MapLibre and gameplay behavior are verified through the existing app suites.
