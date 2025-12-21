const canvas = document.getElementById("table");
const ctx = canvas.getContext("2d");

const angleEl = document.getElementById("angle");
const powerEl = document.getElementById("power");
const angleVal = document.getElementById("angleVal");
const powerVal = document.getElementById("powerVal");
const playBtn = document.getElementById("playBtn");
const serverOut = document.getElementById("serverOut");
const resetBtn = document.getElementById("resetBtn");

function syncUI() {
  angleVal.textContent = angleEl.value;
  powerVal.textContent = powerEl.value;
}
angleEl.addEventListener("input", syncUI);
powerEl.addEventListener("input", syncUI);
syncUI();

// -------------------- Drawing helpers --------------------
const TABLE = {
  inset: 28,
  cushion: 10,
};

function tableBounds() {
  const x0 = TABLE.inset + TABLE.cushion;
  const y0 = TABLE.inset + TABLE.cushion;
  const x1 = canvas.width - TABLE.inset - TABLE.cushion;
  const y1 = canvas.height - TABLE.inset - TABLE.cushion;
  return { x0, y0, x1, y1 };
}

// -------------------- Physics constants (define first!) --------------------
const N_BALLS = 37;
const BALL_R = 10;

// ✅ pockets תלויים ב-BALL_R, אז POCKET_R חייב להיות אחרי BALL_R
const POCKET_R = Math.round(BALL_R * 2.4); // ≈ 24

const pockets = [
  { x: 28, y: 28, r: POCKET_R },
  { x: canvas.width / 2, y: 28, r: POCKET_R },
  { x: canvas.width - 28, y: 28, r: POCKET_R },
  { x: 28, y: canvas.height - 28, r: POCKET_R },
  { x: canvas.width / 2, y: canvas.height - 28, r: POCKET_R },
  { x: canvas.width - 28, y: canvas.height - 28, r: POCKET_R },
];

const POCKET_SUCK_RANGE = 70;
const POCKET_SUCK_STRENGTH = 0.14;
const POCKET_CAPTURE = 1.25;
const pocketSound = new Audio("/static/pop.wav");
pocketSound.volume = 0.4;

// תנועה/פיזיקה
const RESTITUTION = 0.98;
const BALL_RESTITUTION = 0.98;
const MAX_SPEED = 14;

const CONSTANT_SPEED = true;
const TARGET_SPEED = 3.5;
const ZERO_CUTOFF = 0.05;

const MIN_SPEED = 0.03;
const AUTO_KEEP_MOVING = true;
const WAKE_SPEED = 0.12;
const NUDGE = 0.35;
const NUDGE_SPREAD = 0.6;

// -------------------- State --------------------
let balls = [];
let running = false;
let breakShotDone = false;
let lastTime = null;
let gameOver = false;

// -------------------- Drawing --------------------
function resetGame() {
  running = false;
  lastTime = null;
  gameOver = false;
  createBalls();   // מאפס גם breakShotDone אם יש לך שם breakShotDone=false
  drawAll();
  showRemaining();
}
resetBtn.addEventListener("click", resetGame);

function drawTable() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // מסגרת
  ctx.lineWidth = 18;
  ctx.strokeStyle = "#4b2f14";
  ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

  // בד
  ctx.fillStyle = "#0b5a3e";
  ctx.fillRect(28, 28, canvas.width - 56, canvas.height - 56);

  // כיסים
  ctx.fillStyle = "#111";
  for (const p of pockets) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBall(b) {
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
  ctx.fillStyle = ballColor(b);

  ctx.fill();

  if (!b.cue) {
    ctx.fillStyle = "#000";
    ctx.font = "12px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(b.n, b.x, b.y);
  }
}
function drawGameOverOverlay() {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#fff";
  ctx.font = "bold 46px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("כל הכבוד! 🎉", canvas.width / 2, canvas.height / 2 - 18);

  ctx.font = "22px system-ui";
  ctx.fillText("נשארו 6 כדורים", canvas.width / 2, canvas.height / 2 + 28);

  ctx.font = "16px system-ui";
  ctx.fillText("לחץ 🔄 איפוס כדי להתחיל מחדש", canvas.width / 2, canvas.height / 2 + 58);
  ctx.restore();
}

function drawAll() {
  drawTable();
  for (const b of balls) {
    if (b.alive) drawBall(b);
  }
  if (gameOver) drawGameOverOverlay();

}
function ballColor(b) {
  if (b.cue) return "#f5f5f5"; // לבן

  if (b.n <= 10) return "#4da6ff";     // כחול
  if (b.n <= 20) return "#4caf50";     // ירוק
  if (b.n <= 30) return "#ff9800";     // כתום
  return "#e53935";                    // אדום
}

// -------------------- Helpers --------------------
function clampSpeed(b) {
  const s = Math.hypot(b.vx, b.vy);
  if (s > MAX_SPEED) {
    const k = MAX_SPEED / s;
    b.vx *= k;
    b.vy *= k;
  }
}

function aliveNumberedBalls() {
  return balls.filter(b => b.alive && !b.cue);
}

function showRemaining() {
  const remaining = aliveNumberedBalls().map(b => b.n).sort((a, b) => a - b);
  serverOut.textContent = JSON.stringify(
    {
      remaining_count: remaining.length,
      remaining_numbers: remaining,
    },
    null,
    2
  );
}

function allNearlyStopped() {
  for (const b of balls) {
    if (!b.alive) continue;
    const s = Math.hypot(b.vx, b.vy);
    if (s > MIN_SPEED) return false;
  }
  return true;
}

// -------------------- Setup balls --------------------
function createBalls() {
  balls = [];
  breakShotDone = false; // ✅ חשוב

  const { x0, y0, x1, y1 } = tableBounds();

  const cols = 7;
  const gap = BALL_R * 2 + 6;
  let i = 0;

  const startX = x0 + (x1 - x0) * 0.60;
  const startY = y0 + 40;

  for (let n = 1; n <= N_BALLS; n++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    balls.push({
      n,
      x: startX + col * gap,
      y: startY + row * gap,
      r: BALL_R,
      vx: 0,
      vy: 0,
      alive: true,
    });
    i++;
  }

  // cue ball
  balls.unshift({
    n: 0,
    x: x0 + (x1 - x0) * 0.25,
    y: (y0 + y1) / 2,
    r: BALL_R,
    vx: 0,
    vy: 0,
    alive: true,
    cue: true,
  });

  running = false;
  lastTime = null;
  showRemaining();
}

// -------------------- Collisions & pockets --------------------
function wallCollide(b) {
  const { x0, y0, x1, y1 } = tableBounds();

  if (b.x - b.r < x0) {
    b.x = x0 + b.r;
    b.vx = -b.vx * RESTITUTION;
  } else if (b.x + b.r > x1) {
    b.x = x1 - b.r;
    b.vx = -b.vx * RESTITUTION;
  }

  if (b.y - b.r < y0) {
    b.y = y0 + b.r;
    b.vy = -b.vy * RESTITUTION;
  } else if (b.y + b.r > y1) {
    b.y = y1 - b.r;
    b.vy = -b.vy * RESTITUTION;
  }
}

function resolveBallCollision(a, b) {
  if (!a.alive || !b.alive) return;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const minDist = a.r + b.r;

  if (dist === 0 || dist >= minDist) return;

  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = minDist - dist;

  a.x -= nx * overlap * 0.5;
  a.y -= ny * overlap * 0.5;
  b.x += nx * overlap * 0.5;
  b.y += ny * overlap * 0.5;

  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const velAlongNormal = rvx * nx + rvy * ny;

  if (velAlongNormal > 0) return;

  const e = BALL_RESTITUTION;
  const j = -((1 + e) * velAlongNormal) / 2;

  const impX = j * nx;
  const impY = j * ny;

  a.vx -= impX;
  a.vy -= impY;
  b.vx += impX;
  b.vy += impY;

  clampSpeed(a);
  clampSpeed(b);
}

function checkPocket(b) {
  for (const p of pockets) {
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    const d = Math.hypot(dx, dy);

    // suction
    if (d < POCKET_SUCK_RANGE && d > 0.001) {
      const nx = dx / d;
      const ny = dy / d;
      const t = 1 - d / POCKET_SUCK_RANGE;
      const pull = POCKET_SUCK_STRENGTH * (0.4 + 0.6 * t);

      b.vx += nx * pull;
      b.vy += ny * pull;
    }

    // capture
    if (d < p.r + b.r * POCKET_CAPTURE) {
      b.alive = false;
      b.vx = 0;
      b.vy = 0;
      pocketSound.currentTime = 0;
      pocketSound.play().catch(() => {});

      return true;
    }
  }
  return false;
}

// -------------------- Movement modes --------------------
function keepConstantSpeed() {
  if (!CONSTANT_SPEED) return;

  for (const b of balls) {
    if (!b.alive) continue;

    const s = Math.hypot(b.vx, b.vy);

    if (s < ZERO_CUTOFF) {
      const ang = Math.random() * Math.PI * 2;
      b.vx = Math.cos(ang) * TARGET_SPEED;
      b.vy = Math.sin(ang) * TARGET_SPEED;
      continue;
    }

    const k = TARGET_SPEED / s;
    b.vx *= k;
    b.vy *= k;
  }
}

function nudgeBallsIfNeeded() {
  if (!AUTO_KEEP_MOVING) return;
  if (aliveNumberedBalls().length <= 6) return;
  if (!allNearlyStopped()) return;

  for (const b of balls) {
    if (!b.alive) continue;
    const s = Math.hypot(b.vx, b.vy);
    if (s < WAKE_SPEED) {
      const ang = Math.random() * Math.PI * 2;
      b.vx += Math.cos(ang) * (NUDGE * (0.7 + Math.random() * NUDGE_SPREAD));
      b.vy += Math.sin(ang) * (NUDGE * (0.7 + Math.random() * NUDGE_SPREAD));
      clampSpeed(b);
    }
  }
}

// -------------------- Update loop --------------------
function update(dt) {
  for (const b of balls) {
    if (!b.alive) continue;

    b.x += b.vx * dt;
    b.y += b.vy * dt;

    wallCollide(b);
    checkPocket(b);
  }

  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      resolveBallCollision(balls[i], balls[j]);
    }
  }

  keepConstantSpeed();
  nudgeBallsIfNeeded();

  if (aliveNumberedBalls().length <= 6) {
    running = false;
    gameOver = true;
    showRemaining();
  }
}


function loop(ts) {
  if (!running) {
    drawAll();
    return;
  }

  if (lastTime == null) lastTime = ts;
  const elapsed = ts - lastTime;
  lastTime = ts;

  const dt = Math.min(2.0, elapsed / 16.67);

  update(dt);
  drawAll();
  showRemaining();

  requestAnimationFrame(loop);
}

// -------------------- Controls --------------------
function strikeFromUI() {
    if (gameOver) {
  resetGame();
}

  if (breakShotDone) return;

  const angleDeg = Number(angleEl.value);
  const power = Number(powerEl.value);

  const cue = balls.find(b => b.cue);
  if (!cue || !cue.alive) return;

  const rad = (angleDeg * Math.PI) / 180;
  const speed = (power / 100) * 24;

  cue.vx = Math.cos(rad) * speed;
  cue.vy = -Math.sin(rad) * speed;

  running = true;
  breakShotDone = true;

  lastTime = null;
  requestAnimationFrame(loop);
}

playBtn.addEventListener("click", strikeFromUI);

// start
createBalls();
drawAll();
showRemaining();
