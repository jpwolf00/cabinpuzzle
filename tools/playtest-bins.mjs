// Bot playtest for bins.html. Usage: node tools/playtest-bins.mjs [seeds=20] [start end]
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(path.join(here, '..', 'bins.html')).href;
const N = +(process.argv[2] || 20);
const tune = process.argv[3] ? { start: +process.argv[3], end: +process.argv[4] } : null;

const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
await page.goto(url);

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

async function run(bot, seed) {
  return page.evaluate(({ bot, seed, tune }) => {
    if (tune) { TUNE.start = tune.start; TUNE.end = tune.end; }
    newGame(seed);
    const occ = b => b.grid.map(r => r.map(v => !!v));
    function land(o, sh, col) {
      const w = shapeW(sh), h = shapeH(sh);
      if (col + w > COLS || h > ROWS) return -1;
      const free = y => sh.every(p => p[0] + y < ROWS && !o[p[0] + y][p[1] + col]);
      if (!free(0)) return -1;
      let y = 0; while (free(y + 1)) y++;
      return y;
    }
    function apply(o, sh, col, y) { const n = o.map(r => r.slice()); sh.forEach(p => n[p[0] + y][p[1] + col] = true); return n; }
    function holes(o) { let n = 0; for (let c = 0; c < COLS; c++) { let seen = false; for (let r = 0; r < ROWS; r++) { if (o[r][c]) seen = true; else if (seen) n++; } } return n; }
    function bump(o) {
      const h = []; for (let c = 0; c < COLS; c++) { let t = ROWS; for (let r = 0; r < ROWS; r++) if (o[r][c]) { t = r; break; } h.push(ROWS - t); }
      let s = 0; for (let c = 1; c < COLS; c++) s += Math.abs(h[c] - h[c - 1]); return s;
    }
    const full = o => o.every(r => r.every(v => v));
    function moves(slot, occs) {
      const bag = state.tray[slot], out = [];
      if (!bag) return out;
      for (let rot = 0; rot < 4; rot++) {
        const sh = shapeFor(bag.type, rot);
        for (let bin = 0; bin < 2; bin++) {
          if (state.bins[bin].closing > 0) continue;
          for (let col = 0; col < COLS; col++) {
            const y = land(occs[bin], sh, col);
            if (y >= 0) out.push({ slot, rot, bin, col, y, sh, o: apply(occs[bin], sh, col, y) });
          }
        }
      }
      return out;
    }
    function anyFit(slot, occs) { return moves(slot, occs).length > 0; }
    function stuck(occs) {
      // no tray bag fits either bin; latch fullest bin if no tags
      if (state.tray.some((_, i) => anyFit(i, occs))) return;
      if (state.tags > 0) return;
      const open = [0, 1].filter(i => state.bins[i].closing <= 0);
      if (!open.length) return;
      open.sort((a, b) => occs[a].flat().filter(Boolean).length - occs[b].flat().filter(Boolean).length);
      latchBin(open[open.length - 1]);
    }
    function actGreedy() {
      if (!state.tray.length) return;
      const occs = state.bins.map(occ);
      const ms = moves(0, occs);
      if (!ms.length) {
        if (state.bins.some(b => b.closing > 0)) return;
        if (state.tags > 0) { pinkTag(0); return; }
        stuck(occs); return;
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
      if (state.bins.some(b => b.closing > 0)) return;
      if (state.tags > 0) { // gate-check the biggest bag
        let bi = 0; state.tray.forEach((b, i) => { if (BAGS[b.type].cells.length > BAGS[state.tray[bi].type].cells.length) bi = i; });
        pinkTag(bi); return;
      }
      stuck(occs);
    }
    const act = bot === 'greedy' ? actGreedy : actLook;
    let t = 0, next = 0.9, guard = 0;
    while (!state.over && !state.won && guard++ < 60 * 600) {
      tick(1 / 60); t += 1 / 60;
      if (t >= next) { next += 0.9; act(); }
    }
    return { won: state.won, boarded: state.boarded, latched: state.latched, wasted: state.wasted, score: state.score, tune: [TUNE.start, TUNE.end] };
  }, { bot, seed, tune });
}

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const res = { greedy: [], look: [] };
for (let s = 1; s <= N; s++) for (const b of ['greedy', 'look']) res[b].push(await run(b, s));
const row = (name, r) => `${name.padEnd(10)} win ${(100 * mean(r.map(x => +x.won))).toFixed(0).padStart(3)}%  boarded ${mean(r.map(x => x.boarded)).toFixed(1).padStart(5)}  latched ${mean(r.map(x => x.latched)).toFixed(2).padStart(5)}  wasted ${mean(r.map(x => x.wasted)).toFixed(1).padStart(5)}  score ${mean(r.map(x => x.score)).toFixed(0).padStart(5)}`;
console.log(`seeds=${N} arrival ramp ${res.greedy[0].tune[0]}s -> ${res.greedy[0].tune[1]}s`);
console.log(row('greedy', res.greedy));
console.log(row('lookahead', res.look));
const dS = mean(res.look.map((x, i) => x.score - res.greedy[i].score));
const dW = mean(res.look.map((x, i) => x.wasted - res.greedy[i].wasted));
console.log(`paired diff (lookahead - greedy): score ${dS.toFixed(1)}  wasted cells ${dW.toFixed(2)}`);
if (errs.length) console.log('PAGE ERRORS', errs);
await browser.close();
