// Laps, checkpoints and timing on the clockwise carriageway.
//
// The loop is cut into equal sectors. You only get credit for a sector by
// reaching it straight after the previous one, so cutting across the infield
// or reversing over the line doesn't count.
const SECTORS = 8;
const COUNTDOWN = 3; // seconds
const SEARCH_WINDOW = 80; // points either side of the last known position
const WRONG_WAY_DELAY = 1; // seconds of driving backwards before we say so

export class Race {
  constructor(carriageway, laps = 3) {
    this.c = carriageway;
    this.laps = laps;
    const n = carriageway.points.length;
    const [lx, lz] = carriageway.points[n - 1];
    const [fx, fz] = carriageway.points[0];
    this.length = carriageway.distance[n - 1] + Math.hypot(fx - lx, fz - lz);
    this.bestKey = `henday-best-lap-${Math.round(this.length / 100)}`;
    this.best = loadBest(this.bestKey);
    this.hud = {
      lap: document.getElementById('race-lap'),
      time: document.getElementById('race-time'),
      best: document.getElementById('race-best'),
      banner: document.getElementById('banner'),
    };
    this.reset();
  }

  reset() {
    this.state = 'countdown';
    this.clock = -COUNTDOWN; // race time; negative during the countdown
    this.lap = 1;
    this.sector = 0;
    this.lapStart = 0;
    this.lapTimes = [];
    this.index = 0;
    this.wrongWayFor = 0;
    this.message = null;
    this.render();
  }

  // Call after teleporting the car (R) so tracking searches the whole loop.
  relocate() {
    this.index = -1;
  }

  get frozen() {
    return this.state === 'countdown';
  }

  // pos: car position {x, z}; forward: unit vector {x, z}; speed: m/s.
  update(dt, pos, forward, speed) {
    this.clock += dt;
    if (this.state === 'countdown') {
      if (this.clock >= 0) {
        this.state = 'racing';
        this.flash('GO!', 1);
      }
      this.render();
      return;
    }

    this.index = this.nearestIndex(pos);
    this.trackSectors();
    this.trackWrongWay(dt, forward, speed);
    if (this.message && (this.message.until -= dt) <= 0) this.message = null;
    this.render();
  }

  nearestIndex({ x, z }) {
    const pts = this.c.points;
    const n = pts.length;
    const full = this.index < 0;
    const from = full ? 0 : this.index - SEARCH_WINDOW;
    const to = full ? n - 1 : this.index + SEARCH_WINDOW;
    let best = 0;
    let bestD = Infinity;
    for (let k = from; k <= to; k++) {
      const i = ((k % n) + n) % n;
      const d = (pts[i][0] - x) ** 2 + (pts[i][1] - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  trackSectors() {
    if (this.state !== 'racing') return;
    const sector = Math.floor((this.c.distance[this.index] / this.length) * SECTORS) % SECTORS;
    if (sector !== (this.sector + 1) % SECTORS) return;
    this.sector = sector;
    if (sector === 0) this.finishLap();
  }

  finishLap() {
    const time = this.clock - this.lapStart;
    this.lapTimes.push(time);
    this.lapStart = this.clock;
    const isBest = this.best === null || time < this.best;
    if (isBest) {
      this.best = time;
      saveBest(this.bestKey, time);
    }

    if (this.lap === this.laps) {
      this.state = 'finished';
      const total = this.lapTimes.reduce((a, b) => a + b, 0);
      this.flash(
        `FINISHED! ${formatTime(total)}<small>Best lap ${formatTime(Math.min(...this.lapTimes))} · Enter to race again</small>`,
        Infinity,
      );
      return;
    }
    this.lap++;
    this.flash(`${isBest ? 'NEW BEST LAP! ' : ''}${formatTime(time)}<small>Lap ${this.lap} of ${this.laps}</small>`, 2.5);
  }

  trackWrongWay(dt, forward, speed) {
    const tx = this.c.tangents[this.index * 2];
    const tz = this.c.tangents[this.index * 2 + 1];
    const backwards = forward.x * tx + forward.z * tz < -0.3 && Math.abs(speed) > 5;
    this.wrongWayFor = backwards ? this.wrongWayFor + dt : 0;
  }

  flash(html, seconds) {
    this.message = { html, until: seconds };
  }

  render() {
    const { lap, time, best, banner } = this.hud;
    lap.textContent = `Lap ${Math.min(this.lap, this.laps)}/${this.laps}`;
    time.textContent = formatTime(Math.max(0, this.state === 'finished' ? 0 : this.clock - this.lapStart));
    if (this.state === 'finished') time.textContent = formatTime(this.lapTimes.at(-1));
    best.textContent = this.best === null ? 'Best —' : `Best ${formatTime(this.best)}`;

    let html = '';
    if (this.state === 'countdown') html = String(Math.ceil(-this.clock));
    else if (this.wrongWayFor > WRONG_WAY_DELAY) html = 'WRONG WAY';
    else if (this.message) html = this.message.html;
    if (banner.innerHTML !== html) banner.innerHTML = html;
  }
}

export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

function loadBest(key) {
  try {
    const v = parseFloat(localStorage.getItem(key));
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function saveBest(key, time) {
  try {
    localStorage.setItem(key, String(time));
  } catch {
    // Private windows can block storage; the best lap just won't stick.
  }
}
