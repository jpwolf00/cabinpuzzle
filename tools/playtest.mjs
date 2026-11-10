#!/usr/bin/env node
// Headless playtest harness for Boarding Rush.
//
// Loads index.html in Chromium, stubs requestAnimationFrame so the real loop
// never runs, then drives the game's own functions (startLevel, tick,
// handleBinTap, gateCheck) at simulated speed with scripted bots. Nothing is
// re-implemented here: the bots read `state` and call the game's input
// functions, so the numbers reflect the actual game logic.
//
// Usage:
//   node tools/playtest.mjs [--runs 10] [--speed medium] [--levels 0,1,2,3]
//                           [--bots greedy,planner,casual] [--out results.json]
//
// Each (level, run) pair seeds Math.random identically for every bot, so all
// bots play the same cabin and the same bag queue. Compare bots with the paired
// "gap" column, which is far less noisy than comparing two independent means.
//
// Bots
//   greedy   One rule: stow in the fitting bin the front will seal soonest.
//            Ignores walking distance and whether it can get there in time.
//   planner  Scores each fitting bin by seconds-until-its-run-seals plus 1.5x
//            walk seconds plus 2x spare sections in the run (lower is better),
//            skips bins it cannot reach before they seal, and pink-tags a bag
//            when nothing is reachable. Weights are fixed, not tuned per result.
//   casual   Greedy's rule with a slower 1.1 s of think time per action.
//
// Bots never latch bins and never use the hold slot: the success metric is
// packed percentage, and latching only affects score.

import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p); } catch { /* try the next location */ }
  }
  throw new Error('playwright not found (npm i -g playwright, or run where it is installed)');
}

function parseArgs(argv) {
  const o = { runs: 10, speed: 'medium', levels: '0,1,2,3', bots: 'greedy,planner,casual', out: '', faSpeed: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs') o.runs = +argv[++i];
    else if (a === '--speed') o.speed = argv[++i];
    else if (a === '--levels') o.levels = argv[++i];
    else if (a === '--bots') o.bots = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--fa-speed') o.faSpeed = argv[++i];
    else throw new Error('unknown argument ' + a);
  }
  return o;
}

const opts = parseArgs(process.argv.slice(2));
const here = path.dirname(fileURLToPath(import.meta.url));
const pageUrl = pathToFileURL(path.resolve(here, '..', 'index.html')).href;

const { chromium } = loadPlaywright();
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 430, height: 880 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.addInitScript(() => {
  window.requestAnimationFrame = () => 0;
  localStorage.setItem('cabinpuzzle.progress', JSON.stringify({ unlocked: 9 }));
});
await page.goto(pageUrl);
await page.waitForTimeout(300);

const results = await page.evaluate(({ opts }) => {
  const DT = 1 / 60;
  const BOTS = {
    greedy:  { think: 0.7, plan: false },
    planner: { think: 0.7, plan: true },
    casual:  { think: 1.1, plan: false },
  };

  // Small deterministic PRNG so every bot sees the same cabin and queue.
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // --- reading the game's state, without relying on helper functions that
  // --- may change shape between versions ---------------------------------

  // Reachable free runs in a bin: [{ start, len }].
  function freeRuns(bin) {
    const runs = [];
    let start = -1, len = 0;
    for (let i = 0; i < bin.cells.length; i++) {
      const free = bin.cells[i] === null && !cellLocked(bin, i);
      if (free) { if (len === 0) start = i; len++; }
      else { if (len) runs.push({ start, len }); len = 0; }
    }
    if (len) runs.push({ start, len });
    return runs;
  }

  // Best-fit run for a bag: shortest run that holds it, ties toward the aft end.
  function bestRun(bin, size) {
    let best = null;
    for (const r of freeRuns(bin)) {
      if (r.len < size) continue;
      if (!best || r.len < best.len || (r.len === best.len && r.start > best.start)) best = r;
    }
    return best;
  }

  // Seconds until the front passes cabin coordinate y, integrating the game's
  // speed ramp (speed = k * (1 + 1.5 p), p = progress through the cabin).
  function secondsUntil(y) {
    const { cabinTop, cabinBottom } = state.cabin;
    const span = cabinBottom - cabinTop;
    const p0 = Math.max(0, (state.sweepY - cabinTop) / span);
    const p1 = Math.max(p0, Math.min(1, (y - cabinTop) / span));
    return (state.sweepSeconds / 1.5) * Math.log((1 + 1.5 * p1) / (1 + 1.5 * p0));
  }

  function walkSeconds(bin) {
    if (typeof FA === 'undefined' || !state.fa) return 0;   // game without an attendant
    return Math.abs(state.fa.y - (bin.y + bin.height / 2)) / FA.speed;
  }

  // --- bots ----------------------------------------------------------------

  let clock = 0;
  function advance(seconds) {
    let n = Math.max(1, Math.round(seconds / DT));
    while (n-- > 0 && !state.over) { tick(DT); clock += DT; }
  }

  // Issue a tap on a bin, then wait out any walk the game makes us do.
  let walkTime = 0;
  function tapBin(bin) {
    handleBinTap(bin);
    let guard = 0;
    while (state.fa && state.fa.walking && !state.over && guard++ < 20000) {
      tick(DT); clock += DT; walkTime += DT;
    }
  }

  function act(bot) {
    const cur = state.current;
    if (!cur) return;
    if (cur.revealed) { gateCheck(); return; }

    const size = cur.size;
    const cands = [];
    for (const bin of state.cabin.bins) {
      if (bin.closed || binFullyPassed(bin)) continue;
      const run = bestRun(bin, size);
      if (run) cands.push({ bin, run });
    }
    if (!cands.length) { gateCheck(); return; }

    if (!bot.plan) {
      // Greedy / casual: the bin the front will seal soonest, regardless of
      // distance or whether we can get there in time.
      cands.sort((a, b) => (a.bin.y + a.bin.height) - (b.bin.y + b.bin.height));
      tapBin(cands[0].bin);
      return;
    }

    let best = null, bestScore = Infinity;
    for (const c of cands) {
      const T = secondsUntil(cellY(c.bin, c.run.start) + CELL_H);
      const W = walkSeconds(c.bin);
      if (T - W < 0.3) continue;                 // would seal before we arrive
      const slack = c.run.len - size;
      const score = T + 1.5 * W + 2 * slack;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    if (!best) { gateCheck(); return; }
    tapBin(best.bin);
  }

  function runOne(levelIndex, botName, seed) {
    Math.random = mulberry32(seed);
    speedMode = opts.speed;
    startLevel(levelIndex);
    if (opts.faSpeed && typeof FA !== 'undefined') FA.speed = +opts.faSpeed;
    const bot = BOTS[botName];
    clock = 0; walkTime = 0;
    let nextAct = 0, guard = 0;
    while (!state.over && guard++ < 2000000) {
      if (state.holdT > 0) { tick(DT); clock += DT; continue; }
      if (clock >= nextAct) { act(bot); nextAct = clock + bot.think; }
      else { tick(DT); clock += DT; }
    }
    const filled = state.cabin.bins.reduce((n, b) => n + b.cells.filter((c) => c !== null).length, 0);
    const packed = (filled / state.totalSections) * 100;
    return {
      packed, stowed: state.stowed, pink: state.oversizedHandled,
      sealed: state.sealed || 0, secs: clock, walk: walkTime,
      pass: packed >= state.spec.targetPacked,
    };
  }

  const levels = opts.levels.split(',').map(Number);
  const botNames = opts.bots.split(',');
  const out = [];
  for (const li of levels) {
    const row = { level: li, plane: FLEET[li].name, target: FLEET[li].targetPacked, bots: {} };
    const perBot = {};
    for (const b of botNames) {
      perBot[b] = [];
      for (let r = 0; r < opts.runs; r++) perBot[b].push(runOne(li, b, li * 1000 + r + 1));
    }
    for (const b of botNames) {
      const rs = perBot[b];
      const mean = (k) => rs.reduce((a, x) => a + x[k], 0) / rs.length;
      const m = mean('packed');
      const sd = Math.sqrt(rs.reduce((a, x) => a + (x.packed - m) ** 2, 0) / rs.length);
      row.bots[b] = {
        packed: m, sd, stowed: mean('stowed'), pink: mean('pink'), sealed: mean('sealed'),
        secs: mean('secs'), walk: mean('walk'),
        passRate: rs.filter((x) => x.pass).length / rs.length,
        runs: rs.map((x) => x.packed),
      };
    }
    // paired gap: planner minus greedy on identical cabins
    if (perBot.planner && perBot.greedy) {
      const d = perBot.planner.map((x, i) => x.packed - perBot.greedy[i].packed);
      const dm = d.reduce((a, x) => a + x, 0) / d.length;
      const dsd = Math.sqrt(d.reduce((a, x) => a + (x - dm) ** 2, 0) / d.length);
      row.gap = { mean: dm, sd: dsd, wins: d.filter((x) => x > 0).length, n: d.length };
    }
    out.push(row);
  }
  return out;
}, { opts });

const f1 = (x) => x.toFixed(1);
console.log(`speed=${opts.speed}  runs=${opts.runs}  page=${path.basename(pageUrl)}`);
console.log('plane          bot       packed  sd    stowed pink sealed  secs walk  pass   target');
for (const r of results) {
  for (const [b, s] of Object.entries(r.bots)) {
    console.log(
      r.plane.padEnd(14), b.padEnd(8),
      (f1(s.packed) + '%').padStart(7), f1(s.sd).padStart(5),
      f1(s.stowed).padStart(7), f1(s.pink).padStart(4), f1(s.sealed).padStart(6),
      String(Math.round(s.secs)).padStart(5), String(Math.round(s.walk)).padStart(4),
      (Math.round(s.passRate * 100) + '%').padStart(5), (r.target + '%').padStart(7));
  }
  if (r.gap) {
    console.log(`  paired gap (planner - greedy): ${f1(r.gap.mean)} pts  sd ${f1(r.gap.sd)}  planner won ${r.gap.wins}/${r.gap.n}`);
  }
}
if (pageErrors.length) console.log('PAGE ERRORS', JSON.stringify(pageErrors.slice(0, 3)));
if (opts.out) writeFileSync(opts.out, JSON.stringify({ opts, results }, null, 2));
await browser.close();
