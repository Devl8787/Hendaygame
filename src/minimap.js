// North-up map of the whole track in the corner, with a dot for the car.
const SIZE = 200;
const PADDING = 12;

export class Minimap {
  constructor(track) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'minimap';
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = this.canvas.height = SIZE * dpr;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.scale(dpr, dpr);
    document.getElementById('hud').appendChild(this.canvas);

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const c of track.carriageways) {
      for (const [x, z] of c.points) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
    }
    const scale = (SIZE - PADDING * 2) / Math.max(maxX - minX, maxZ - minZ, 1);
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    this.toMap = (x, z) => [SIZE / 2 + (x - cx) * scale, SIZE / 2 + (z - cz) * scale];

    // Draw the road once, then copy it each frame under the car dot.
    this.background = document.createElement('canvas');
    this.background.width = this.background.height = SIZE * dpr;
    const bg = this.background.getContext('2d');
    bg.scale(dpr, dpr);
    bg.lineWidth = 3;
    bg.lineJoin = 'round';
    bg.strokeStyle = '#e8e8e8';
    for (const c of track.carriageways) {
      bg.beginPath();
      c.points.forEach(([x, z], i) => {
        if (i % 10) return; // every 30 m is plenty at this size
        const [mx, my] = this.toMap(x, z);
        if (i === 0) bg.moveTo(mx, my);
        else bg.lineTo(mx, my);
      });
      if (c.closed) bg.closePath();
      bg.stroke();
    }
  }

  draw(x, z) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = 'rgba(20, 30, 40, 0.55)';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(this.background, 0, 0, SIZE, SIZE);
    const [mx, my] = this.toMap(x, z);
    ctx.fillStyle = '#ff3040';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(mx, my, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}
