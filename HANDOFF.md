# Handoff: Overhead Bin (luggage + Tetris puzzle game)

Read this file first. It replaces the history of a very long previous session.

## Paste this to start the new session

> Continue the `bins.html` prototype in this repo. Read `HANDOFF.md` first, then play-test fixes in the order it lists. Use the existing harness before and after each change. Work only on branch `claude/airplane-luggage-puzzle-5osasn`; never touch `main`, never open a PR unless I ask.

## What this is

A mobile-first puzzle game: you are a flight attendant packing passengers' luggage into overhead bins before the boarding line backs up. Theme is fixed: **luggage + Tetris, on an airplane**. Single HTML files, no build step, no dependencies, dark navy UI.

## State of the repo

| Where | What |
|---|---|
| `main` (live on GitHub Pages) | `index.html`: the original "Boarding Rush". A sweeping boarding front locks bin sections as it passes; 4 aircraft (CRJ-200, A320, 737-900ER, 777-300ER), 3 speed modes, stars, localStorage progress. Finished and polished. **Do not modify.** |
| branch `claude/airplane-luggage-puzzle-5osasn` | 3 commits ahead of `main`: |
| `1e7ea60` | `tools/playtest.mjs`: headless harness for `index.html` (paired-seed bots). |
| `a8b44a6` | Flight attendant who walks to the tapped bin, added to `index.html` on this branch only. **Experimental; it failed its gate** (see below). Not on `main`. |
| `0300430` | **`bins.html`: the new prototype, the current direction.** Plus `tools/playtest-bins.mjs`. |

## Why we changed direction

The sweeping-front design has one correct move per bag, so skill has nothing to improve. Measured with bots on identical seeded cabins (Steady speed): a one-rule greedy bot packs 93-100% and a "planner" bot is within 0 to 3 points of it. We built an attendant avatar hoping to create routing decisions; planner minus greedy on the A320 was -2.2 points (needed +10) and stayed within noise at every walk speed from 40 to 300 px/s, across 16 planner weightings. Cause: the front pushes the attendant, so the most urgent bin is also the nearest one (78-85% of greedy's picks on the single-aisle jets). Bags are also one-dimensional (1-3 sections), so there is no packing puzzle. Details are in commit `a8b44a6`'s message.

## The current design: `bins.html` (two-sided inventory Tetris)

- You face two overhead bins (stacked vertically on a phone), each a 6x3 grid.
- Bags are rotatable shapes: coat 1x1, tote 2x1, duffel 3x1, guitar 4x1, backpack 2x2, roller 2x3, an L. They drop with gravity at a chosen column.
- A tray shows the next 3 passengers' bags; take any one. A new passenger joins the line every 4.5 s, easing to 2.2 s. 10 waiting = flight delayed (loss). 45 passengers = win.
- A full bin latches automatically (+100), slides away, and a fresh one slides in. An early-latch button exists but each empty cell costs 15 points.
- 3 pink tags per flight remove a bag from the tray as an escape valve.
- Simulation is separated from rendering. Globals: `newGame(seed)`, `tick(dt)`, `canPlace`, `dropBag`, `latchBin`, `pinkTag`, `state`. Tuning constants are in the `TUNE` object near the top.

### Measured (20 seeds, bots act every 0.9 s)

| Arrival pace | Bot | Win | Score | Wasted cells |
|---|---|---|---|---|
| 4.5 to 2.2 s (shipped) | greedy | 100% | 995 | 21.5 |
| | lookahead | 100% | 1213 | 21.1 |
| 1.5 to 0.9 s (stress) | greedy | 55% | 1053 | 13.3 |
| | lookahead | 100% | 1197 | 18.7 |

Lookahead beats greedy (+219 score at the shipped pace; wins every game where greedy loses 45% under stress), which is the property the old design lacked. At the shipped pace both bots always win, so they cannot yet show where a human would struggle. Reproduce: `node tools/playtest-bins.mjs 20 [start end]`.

## Not verified (do these first)

1. **A human has not played it.** The pace and difficulty are untuned for people. Ask the owner to play and report feel before tuning further.
2. Real **touch** drag-and-drop (only mouse drags were tested), the pink-tag button, the early-latch button, the end screen, desktop and landscape layouts.

## Suggested next steps, in order

1. Fix anything the owner reports from playing it; verify the unverified items above in Playwright at 390x844 with `hasTouch`.
2. Tune arrival pace and `TUNE.limit` from the owner's feedback, using the harness to keep the greedy-vs-lookahead gap.
3. Add game feel: latch flash and slide, a clear "queue is filling" warning, drop animation, simple sound.
4. Port the aircraft as levels (CRJ: shallow bins and more pink-tag trouble; 777: a third centre bin) and the suitcase art from `index.html`'s `drawSuitcase`. Reuse the stars and localStorage pattern.
5. Only then decide whether to retire the sweep version on `main` and publish `bins.html` to Pages.

## How to work

- **Verify in a browser, not only the harness.** The harness skips rendering. Playwright is at `/opt/node22/lib/node_modules/playwright` (CommonJS; use `createRequire`), Chromium at `/opt/pw-browsers/chromium`. Pass `executablePath` explicitly; do not run `playwright install`.
- Keep `tick` free of the wall clock and all randomness behind the seeded PRNG so the harness keeps working.
- Commit messages end with the two attribution lines the session specifies. Push with `git push -u origin claude/airplane-luggage-puzzle-5osasn`.
- Pages deploys from `main` only. Nothing on this branch is public.

## Cost advice

The previous session was too long: every reply re-read the whole history. Keep this one short, use Sonnet for building, delegate large self-contained builds to a sub-agent with a written brief, and open a new session for each big step.
