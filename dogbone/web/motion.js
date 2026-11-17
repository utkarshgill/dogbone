export const mix = (a, b, t) => a + (b - a) * t;
export const clamp = t => Math.max(0, Math.min(1, t));
export const ease = t => {
  t = clamp(t);
  return t * t * (3 - 2 * t);
};
export const angleBetween = (from, to, t) => from + (((to - from + 180) % 360 + 360) % 360 - 180) * t;

export function animate(duration, draw, done = () => {}, reduced = false) {
  const start = performance.now();
  let frame;
  function tick(now) {
    const progress = reduced ? 1 : clamp((now - start) / duration);
    draw(progress);
    if (progress < 1) frame = requestAnimationFrame(tick);
    else done();
  }
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}
