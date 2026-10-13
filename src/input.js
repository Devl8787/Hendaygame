const keys = new Set();

window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

const down = (...codes) => codes.some((c) => keys.has(c));

export function readInput() {
  return {
    throttle: down('KeyW', 'ArrowUp'),
    brake: down('KeyS', 'ArrowDown'),
    steer: (down('KeyA', 'ArrowLeft') ? 1 : 0) - (down('KeyD', 'ArrowRight') ? 1 : 0),
    handbrake: down('Space'),
  };
}

// Fires once per key press, for toggles like reset and camera.
export function onPress(code, fn) {
  window.addEventListener('keydown', (e) => {
    if (e.code === code && !e.repeat) fn();
  });
}
