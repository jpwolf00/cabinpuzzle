# Handoff: Overhead Bin (luggage + Tetris puzzle game)

Read this file first. It replaces the history of a very long previous session.

## Paste this to start the new session

> Continue the `bins.html` prototype in this repo. Read `HANDOFF.md` first, then play-test fixes in the order it lists. Use the existing harness before and after each change. Work only on the branch the session assigns; never touch `main`, never open a PR unless I ask.

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

## The current design: `bins.html` (inventory Tetris inside a cabin, four aircraft)

The owner liked the two-bin Tetris but missed the aisle and the aircraft progression, so both were folded back in (branch `claude/focused-feynman-rvyfts`).

- **Bins are a finite run down the fuselage.** Each side of the aircraft has a fixed number of bins, nose to tail. A full bin latches (+100) and the next bin aft slides in. Latching early wastes space you cannot get back; run out of bins with bags left and no pink tags and the flight fails ("Out of bin space").
- **The aisle sits between the bins.** Passengers walk in from the door and queue in it; the first three are the tray. If the line backs up to the door (the aircraft's `limit`), the flight is delayed.
- **A whole-aircraft map** at the top shows every bin: gold = latched full, grey = latched with waste, blue outline = in use.
- **Aircraft are levels** (`PLANES` array near the top; everything per-level is data there):

| Aircraft | Bins on screen | Bins on the plane | Passengers | New bag shapes |
|---|---|---|---|---|
| CRJ-200 | 1 (5x2) | 8 | 18 | coat, tote, duffel, backpack, L |
| A320 | 2 (6x3) | 5 + 5 | 45 | roller, guitar |
| 737-900ER | 2 (6x3) | 8 + 8 | 70 | T-shape, faster line |
| 777-300ER | 3 (6x3, 8x3 centre, 6x3), two aisles | 7 + 7 + 7 | 100 | S-shape, fastest line |

- Win = 1 star; 2 and 3 stars are score thresholds per aircraft (`stars`). Winning unlocks the next aircraft. Progress is in localStorage under `overheadbin.bins.v1`.
- Simulation is still separate from rendering. Globals: `newGame(seed, planeIndex)`, `tick(dt)`, `canPlace`, `dropBag`, `latchBin`, `pinkTag`, `binOpen`, `starsFor`, `state`, `PLANES`, `TUNE` (points only; pace lives on each plane).

### Measured (20 seeds, bots act every 0.9 s)

| Aircraft | Greedy score | Lookahead score | Gap | Bins used |
|---|---|---|---|---|
| CRJ-200 | 416 | 425 | +9 (training level, by design) | 3.6 of 8 |
| A320 | 995 | 1213 | +219 (identical to the pre-change prototype) | 5.8 of 10 |
| 737-900ER | 1539 | 1900 | +361 | 11.7 of 16 |
| 777-300ER | 2388 | 2734 | +347 | 14.7 of 21 |

Both bots win every flight at the shipped pace, so the bots still cannot show where a human struggles. With 6 bins per side the 777 ran out of space in 3 of 20 games for both bots, which is why it has 7. Star thresholds sit just under the greedy and lookahead averages. Reproduce: `node tools/playtest-bins.mjs 20 [paceScale]`.

## Not verified (do these first)

1. **A human has not played it.** Pace, bin counts and star thresholds are bot-derived guesses.
2. On a short phone screen the 777's cells shrink to about 32 px (three bins stacked). Touch drag and tap-to-drop were verified in Playwright on the CRJ only; check the 777 by hand.
3. Desktop and landscape layouts.

## Suggested next steps, in order

1. Fix anything the owner reports from playing it.
2. Tune pace, `limit`, bin `count` and `stars` per aircraft from that feedback, keeping the greedy-vs-lookahead gap.
3. Game feel: drop animation, a stronger "aisle is filling" warning, simple sound, a walk-aft transition when a bin latches.
4. Port the suitcase art from `index.html`'s `drawSuitcase`.
5. Only then decide whether to retire the sweep version on `main` and publish `bins.html` to Pages.

## How to work

- **Verify in a browser, not only the harness.** The harness skips rendering. Playwright is at `/opt/node22/lib/node_modules/playwright` (CommonJS; use `createRequire`), Chromium at `/opt/pw-browsers/chromium`. Pass `executablePath` explicitly; do not run `playwright install`.
- Keep `tick` free of the wall clock and all randomness behind the seeded PRNG so the harness keeps working.
- Commit messages end with the two attribution lines the session specifies. Push with `git push -u origin <session branch>`.
- Pages deploys from `main` only. Nothing on this branch is public.

## Cost advice

The previous session was too long: every reply re-read the whole history. Keep this one short, use Sonnet for building, delegate large self-contained builds to a sub-agent with a written brief, and open a new session for each big step.
