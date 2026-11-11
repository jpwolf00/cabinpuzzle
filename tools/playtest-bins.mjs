// Bot playtest for bins.html, one row pair per aircraft.
// Usage: node tools/playtest-bins.mjs [seeds=20] [paceScale=1]
//   paceScale multiplies every aircraft's arrival interval (0.5 = passengers arrive twice as fast).
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(path.join(here, '..', 'bins.html')).href;
const N = +(process.argv[2] || 20);
const pace = +(process.argv[3] || 1);

const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
await page.goto(url);
if (pace !== 1) await page.evaluate(k => PLANES.forEach(p => { p.start *= k; p.end *= k; }), pace);
const planes = await page.evaluate(() => PLANES.map(p => ({ name: p.name, start: p.start, end: p.end, stars: p.stars })));

function findChromium() {
  const fs = require('node:fs');
  const base = '/opt/pw-browsers';
  for (const d of fs.readdirSync(base)) {
    for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-headless-shell-linux64/chrome-headless-shell']) {
      const p = path.join(base, d, sub); if (fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

async function run(bot, seed, plane) {
  return page.evaluate(({ bot, seed, plane }) => {
    newGame(seed, plane);
    const occ = b => b.grid.map(r => r.map(v => !!v));
    function land(o, sh, col) {
      const R = o.length, C = R ? o[0].length : 0, w = shapeW(sh), h = shapeH(sh);
      if (col + w > C || h > R) return -1;
      const free = y => sh.every(p => p[0] + y < R && !o[p[0] + y][p[1] + col]);
      if (!free(0)) return -1;
      let y = 0; while (free(y + 1)) y++;
      return y;
    }
    function apply(o, sh, col, y) { const n = o.map(r => r.slice()); sh.forEach(p => n[p[0] + y][p[1] + col] = true); return n; }
    function holes(o) { let n = 0; for (let c = 0; c < o[0].length; c++) { let seen = false; for (let r = 0; r < o.length; r++) { if (o[r][c]) seen = true; else if (seen) n++; } } return n; }
    function bump(o) {
      const R = o.length, h = [];
      for (let c = 0; c < o[0].length; c++) { let t = R; for (let r = 0; r < R; r++) if (o[r][c]) { t = r; break; } h.push(R - t); }
      let s = 0; for (let c = 1; c < h.length; c++) s += Math.abs(h[c] - h[c - 1]); return s;
    }
    const full = o => o.every(r => r.every(v => v));
    const openBins = () => state.bins.map((_, i) => i).filter(binOpen);
    function moves(slot, occs) {
      const bag = state.tray[slot], out = [];
      if (!bag) return out;
      for (let rot = 0; rot < 4; rot++) {
        const sh = shapeFor(bag.type, rot);
        for (const bin of openBins()) {
          for (let col = 0; col < state.bins[bin].cols; col++) {
            const y = land(occs[bin], sh, col);
            if (y >= 0) out.push({ slot, rot, bin, col, y, sh, o: apply(occs[bin], sh, col, y) });
          }
        }
      }
      return out;
    }
    function anyFit(slot, occs) { return moves(slot, occs).length > 0; }
    function stuck(occs, onlyFront) {
      // nothing the bot is willing to stow fits and no tags: latch the fullest open bin to move aft
      if (!onlyFront && state.tray.some((_, i) => anyFit(i, occs))) return;
      if (state.tags > 0) return;
      const open = openBins();
      if (!open.length) return;
      const filled = i => occs[i].flat().filter(Boolean).length / (occs[i].length * occs[i][0].length);
      open.sort((a, b) => filled(a) - filled(b));
      latchBin(open[open.length - 1]);
    }
    const busy = () => state.bins.some(b => b.closing > 0);
    function actGreedy() {
      if (!state.tray.length) return;
      const occs = state.bins.map(occ);
      const ms = moves(0, occs);
      if (!ms.length) {
        if (busy()) return;
        if (state.tags > 0) { pinkTag(0); return; }
        stuck(occs, true); return;
      }
      let best = null, bs = 1e9;
      for (const m of ms) { const s = holes(m.o) * 100 - m.y * 2 + m.col * 0.01 + m.bin * 0.001; if (s < bs) { bs = s; best = m; } }
      dropBag(0, best.rot, best.bin, best.col);
    }
    function actLook() {
      if (!state.tray.length) return;
      const occs = state.bins.map(occ);
      let best = null, bs = -1e9;
      for (let slot = 0; slot < state.tray.length; slot++) {
        for (const m of moves(slot, occs)) {
          const no = occs.slice(); no[m.bin] = m.o;
          let fits = 0;
          for (let j = 0; j < state.tray.length; j++) if (j !== slot && anyFit(j, no)) fits++;
          const s = -12 * holes(m.o) - 2 * bump(m.o) + (full(m.o) ? 80 : 0) + 6 * fits + m.y * 0.5 + m.sh.length * 0.5;
          if (s > bs) { bs = s; best = m; }
        }
      }
      if (best) { dropBag(best.slot, best.rot, best.bin, best.col); return; }
      if (busy()) return;
      if (state.tags > 0) { // gate-check the biggest bag
        let bi = 0; state.tray.forEach((b, i) => { if (BAGS[b.type].cells.length > BAGS[state.tray[bi].type].cells.length) bi = i; });
        pinkTag(bi); return;
      }
      stuck(occs);
    }
    const act = bot === 'greedy' ? actGreedy : actLook;
    let t = 0, next = 0.9, guard = 0;
    while (!state.over && !state.won && guard++ < 60 * 900) {
      tick(1 / 60); t += 1 / 60;
      if (t >= next) { next += 0.9; act(); }
    }
    const used = state.sides.reduce((a, s) => a + s.hist.length, 0), all = state.sides.reduce((a, s) => a + s.count, 0);
    return { won: state.won, reason: state.reason, hung: !state.over && !state.won, boarded: state.boarded, used, all,
      wasted: state.wasted, score: state.score, stars: starsFor(state) };
  }, { bot, seed, plane });
}

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const row = (name, r) => `  ${name.padEnd(10)} win ${(100 * mean(r.map(x => +x.won))).toFixed(0).padStart(3)}%` +
  `  (lost: queue ${r.filter(x => x.reason === 'queue').length}, space ${r.filter(x => x.reason === 'space').length}, hung ${r.filter(x => x.hung).length})` +
  `  bins ${mean(r.map(x => x.used)).toFixed(1)}/${r[0].all}  wasted ${mean(r.map(x => x.wasted)).toFixed(1).padStart(5)}` +
  `  score ${mean(r.map(x => x.score)).toFixed(0).padStart(5)}  stars ${mean(r.map(x => x.stars)).toFixed(2)}`;
console.log(`seeds=${N} paceScale=${pace}`);
for (let p = 0; p < planes.length; p++) {
  const res = { greedy: [], look: [] };
  for (let s = 1; s <= N; s++) for (const b of ['greedy', 'look']) res[b].push(await run(b, s, p));
  console.log(`${planes[p].name}  arrivals ${planes[p].start.toFixed(2)}s -> ${planes[p].end.toFixed(2)}s  stars at ${planes[p].stars.join(' / ')}`);
  console.log(row('greedy', res.greedy));
  console.log(row('lookahead', res.look));
  console.log(`  paired diff (lookahead - greedy): score ${mean(res.look.map((x, i) => x.score - res.greedy[i].score)).toFixed(1)}`);
}
if (errs.length) console.log('PAGE ERRORS', errs);
await browser.close();
