// Overhead Bin: Boarding Rush — a two-sided packing/timing prototype.
// Player packs varying-size luggage into varying-size overhead bins
// before each passenger's patience (and the departure clock) run out.

const BIN_CAPACITIES = [3, 5, 4, 6, 3, 5];
const BAG_COLORS = ["#ff8a65", "#ffd54f", "#4fc3f7", "#81c784", "#ba68c8", "#f06292"];
const TOTAL_PASSENGERS = 22;
const START_CLOCK_SECONDS = 150;
const BASE_PATIENCE = 9;
const CELL_W = 34;
const CELL_H = 34;
const CELL_GAP = 4;
const BIN_GAP = 18;
const BIN_TOP = 40;

const canvas = document.getElementById("cabin");
const ctx = canvas.getContext("2d");

const clockEl = document.getElementById("clock");
const boardedEl = document.getElementById("boardedCount");
const gateCheckEl = document.getElementById("gateCheckCount");
const scoreEl = document.getElementById("score");
const patienceFillEl = document.getElementById("patienceFill");
const bagPreviewEl = document.getElementById("bagPreview");
const passengerLabelEl = document.getElementById("passengerLabel");
const gateCheckBtn = document.getElementById("gateCheckBtn");
const queueRowEl = document.getElementById("queueRow");
const overlayEl = document.getElementById("overlay");
const overlayTitleEl = document.getElementById("overlayTitle");
const overlayBodyEl = document.getElementById("overlayBody");
const restartBtn = document.getElementById("restartBtn");

let state;

function makeBins() {
  return BIN_CAPACITIES.map((cap) => ({
    capacity: cap,
    cells: new Array(cap).fill(null),
    flashUntil: 0,
    flashColor: null,
  }));
}

function randomPassenger(index) {
  const difficulty = index / TOTAL_PASSENGERS;
  const bagLen = 1 + Math.floor(Math.random() * (difficulty > 0.5 ? 3 : 2.5));
  return {
    id: index,
    bagLen: Math.min(bagLen, 3),
    bagColor: BAG_COLORS[Math.floor(Math.random() * BAG_COLORS.length)],
    patienceMax: Math.max(4.5, BASE_PATIENCE - difficulty * 3.5),
    patience: null,
    name: `Passenger ${index + 1}`,
  };
}

function newGame() {
  const queue = [];
  for (let i = 0; i < TOTAL_PASSENGERS; i++) queue.push(randomPassenger(i));

  state = {
    bins: makeBins(),
    queue,
    active: null,
    clock: START_CLOCK_SECONDS,
    boarded: 0,
    gateChecked: 0,
    score: 0,
    lastTick: performance.now(),
    over: false,
  };

  pullNextPassenger();
  overlayEl.classList.add("hidden");
  requestAnimationFrame(loop);
}

function pullNextPassenger() {
  if (state.queue.length === 0) {
    state.active = null;
    return;
  }
  const p = state.queue.shift();
  p.patience = p.patienceMax;
  state.active = p;
}

function contiguousFreeRun(bin, len) {
  let runStart = -1;
  let runLen = 0;
  for (let i = 0; i < bin.cells.length; i++) {
    if (bin.cells[i] === null) {
      if (runLen === 0) runStart = i;
      runLen++;
      if (runLen >= len) return runStart;
    } else {
      runLen = 0;
    }
  }
  return -1;
}

function tryPlaceInBin(binIndex) {
  if (!state.active || state.over) return;
  const bin = state.bins[binIndex];
  const start = contiguousFreeRun(bin, state.active.bagLen);

  if (start === -1) {
    bin.flashUntil = performance.now() + 300;
    bin.flashColor = "#ff6b6b";
    return;
  }

  for (let i = start; i < start + state.active.bagLen; i++) {
    bin.cells[i] = state.active.bagColor;
  }

  const patienceFrac = state.active.patience / state.active.patienceMax;
  state.score += 10 + Math.round(patienceFrac * 10);
  state.boarded += 1;
  bin.flashUntil = performance.now() + 250;
  bin.flashColor = "#4caf7d";

  pullNextPassenger();
}

function gateCheckActive(auto) {
  if (!state.active || state.over) return;
  state.gateChecked += 1;
  state.score += auto ? 0 : 2;
  state.clock -= auto ? 9 : 5;
  pullNextPassenger();
}

function tick(dtSeconds) {
  state.clock -= dtSeconds;

  if (state.active) {
    state.active.patience -= dtSeconds;
    if (state.active.patience <= 0) {
      gateCheckActive(true);
    }
  }

  if (state.clock <= 0 && !state.over) {
    endGame(false);
    return;
  }

  if (!state.active && state.queue.length === 0 && !state.over) {
    endGame(true);
  }
}

function endGame(won) {
  state.over = true;
  overlayEl.classList.remove("hidden");
  if (won) {
    overlayTitleEl.textContent = "Doors closed on time!";
    overlayBodyEl.textContent =
      `Boarded ${state.boarded}, gate-checked ${state.gateChecked}. Final score: ${state.score}.`;
  } else {
    overlayTitleEl.textContent = "Flight delayed";
    overlayBodyEl.textContent =
      `The departure clock hit zero with ${state.queue.length + (state.active ? 1 : 0)} passengers still boarding. Score: ${state.score}.`;
  }
}

function binLayoutX(index) {
  let x = 20;
  for (let i = 0; i < index; i++) {
    x += BIN_CAPACITIES[i] * (CELL_W + CELL_GAP) + BIN_GAP;
  }
  return x;
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  state.bins.forEach((bin, idx) => {
    const x = binLayoutX(idx);
    const width = bin.capacity * (CELL_W + CELL_GAP) - CELL_GAP + 16;
    const height = CELL_H + 40;

    const flashing = performance.now() < bin.flashUntil;
    ctx.fillStyle = flashing ? bin.flashColor + "33" : "#1c2733";
    ctx.strokeStyle = flashing ? bin.flashColor : "#2f3f56";
    ctx.lineWidth = 2;
    roundRect(ctx, x - 8, BIN_TOP - 8, width, height, 10);
    ctx.fill();
    ctx.stroke();

    bin.cells.forEach((cell, ci) => {
      const cx = x + ci * (CELL_W + CELL_GAP);
      const cy = BIN_TOP + 22;
      ctx.fillStyle = cell || "#2a3646";
      roundRect(ctx, cx, cy, CELL_W, CELL_H, 5);
      ctx.fill();
    });

    ctx.fillStyle = "#8fa2bd";
    ctx.font = "11px sans-serif";
    ctx.fillText(`Bin ${idx + 1}`, x, BIN_TOP + 8);
  });

  // aisle strip
  ctx.fillStyle = "#101823";
  ctx.fillRect(0, BIN_TOP + 100, canvas.width, canvas.height - BIN_TOP - 100);
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function updateHUD() {
  const clockSecs = Math.max(0, Math.ceil(state.clock));
  const mm = String(Math.floor(clockSecs / 60)).padStart(2, "0");
  const ss = String(clockSecs % 60).padStart(2, "0");
  clockEl.textContent = `${mm}:${ss}`;
  clockEl.classList.toggle("warn", clockSecs <= 20);

  boardedEl.textContent = state.boarded;
  gateCheckEl.textContent = state.gateChecked;
  scoreEl.textContent = state.score;

  if (state.active) {
    const frac = Math.max(0, state.active.patience / state.active.patienceMax);
    patienceFillEl.style.width = `${frac * 100}%`;
    patienceFillEl.style.background = frac < 0.3 ? "#ff6b6b" : frac < 0.6 ? "#ffb74d" : "#4caf7d";
    bagPreviewEl.style.width = `${20 + state.active.bagLen * 24}px`;
    bagPreviewEl.style.background = state.active.bagColor;
    passengerLabelEl.textContent = `${state.active.name}: bag size ${state.active.bagLen}. Click a bin to stow it.`;
    gateCheckBtn.disabled = false;
  } else {
    patienceFillEl.style.width = "0%";
    bagPreviewEl.style.background = "#3a4a63";
    passengerLabelEl.textContent = state.over ? "" : "Boarding complete.";
    gateCheckBtn.disabled = true;
  }

  queueRowEl.innerHTML = "";
  state.queue.slice(0, 12).forEach((p) => {
    const el = document.createElement("div");
    el.className = "queueBag";
    el.style.width = `${16 + p.bagLen * 18}px`;
    el.style.background = p.bagColor;
    queueRowEl.appendChild(el);
  });
}

function loop(now) {
  if (!state.over) {
    const dt = (now - state.lastTick) / 1000;
    state.lastTick = now;
    tick(dt);
  }
  draw();
  updateHUD();
  if (!state.over) requestAnimationFrame(loop);
}

canvas.addEventListener("click", (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  if (y < BIN_TOP - 8 || y > BIN_TOP + 100) return;

  state.bins.forEach((bin, idx) => {
    const bx = binLayoutX(idx) - 8;
    const width = bin.capacity * (CELL_W + CELL_GAP) - CELL_GAP + 16;
    if (x >= bx && x <= bx + width) {
      tryPlaceInBin(idx);
    }
  });
});

gateCheckBtn.addEventListener("click", () => gateCheckActive(false));
restartBtn.addEventListener("click", newGame);

newGame();
