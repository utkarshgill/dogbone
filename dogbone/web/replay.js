import {animate, angleBetween, ease, mix} from "./motion.js";

function artwork([pads, strokes]) {
  const copper = new Path2D(), drills = new Path2D();
  for (const [x, y, w, h, angle, radius, circle, dw, dh] of pads) {
    const transform = new DOMMatrix().translate(x, y).rotate(-angle);
    const pad = new Path2D();
    if (circle) pad.ellipse(0, 0, w / 2, h / 2, 0, 0, 2 * Math.PI);
    else pad.roundRect(-w / 2, -h / 2, w, h, radius);
    copper.addPath(pad, transform);
    if (dw) {
      const drill = new Path2D();
      drill.ellipse(0, 0, dw / 2, dh / 2, 0, 0, 2 * Math.PI);
      drills.addPath(drill, transform);
    }
  }
  return {copper, drills, silk: new Path2D(strokes)};
}

export async function openReplay(dialog) {
  const response = await fetch("/replay.json");
  if (!response.ok || response.status === 204) throw new Error("Replay unavailable");
  const {stages, geometry, parts} = await response.json();
  if (stages.length < 2) throw new Error("Replay needs at least two placements");
  const shapes = geometry.map(artwork);
  const canvas = dialog.querySelector("canvas"), ctx = canvas.getContext("2d");
  const play = dialog.querySelector("[data-play]");
  const previous = dialog.querySelector("[data-prev]");
  const next = dialog.querySelector("[data-next]");
  const exportButton = dialog.querySelector("[data-export]");
  const scrub = dialog.querySelector("input");
  const caption = dialog.querySelector("output");
  const base = 1.2, span = 4, tail = 1.4;
  const duration = base + span * (stages.length - 1) + tail;
  scrub.max = duration;
  const stops = stages.map((_, i) => i ? base + span * i : 0);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const recording = new AbortController();
  let time = 0, cancel;

  function drawFrame(ctx, w, h, seconds) {
    const stage = Math.max(0, Math.min(stages.length - 2, Math.floor((seconds - base) / span)));
    const elapsed = (seconds - base) / span - stage;
    const [name, commit, firstCenter, firstOutline] = stages[stage];
    const [nextName, nextCommit, nextCenter, nextOutline] = stages[stage + 1];
    const transition = ease(elapsed);
    ctx.save();
    ctx.fillStyle = "#0e1513";
    ctx.fillRect(0, 0, w, h);
    const scale = Math.min(w, h) / 90;
    const cx = mix(firstCenter[0], nextCenter[0], transition);
    const cy = mix(firstCenter[1], nextCenter[1], transition);
    ctx.translate(w / 2 - cx * scale, h / 2 - cy * scale);
    ctx.scale(scale, scale);

    const outline = nextOutline.length ? nextOutline : firstOutline;
    ctx.beginPath();
    for (const [x, y, u, v] of outline) {
      ctx.moveTo(x, y);
      ctx.lineTo(u, v);
    }
    if (outline.length) {
      const xmin = Math.min(...outline.flatMap(([x, , u]) => [x, u]));
      const ymin = Math.min(...outline.flatMap(([, y, , v]) => [y, v]));
      const xmax = Math.max(...outline.flatMap(([x, , u]) => [x, u]));
      const ymax = Math.max(...outline.flatMap(([, y, , v]) => [y, v]));
      ctx.globalAlpha = firstOutline.length ? 1 : ease((transition - .7) / .3);
      ctx.fillStyle = "#1e322b";
      ctx.fillRect(xmin, ymin, xmax - xmin, ymax - ymin);
      ctx.strokeStyle = "#719381";
      ctx.lineWidth = 0.12;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = "#536d61";
    for (let x = Math.floor((cx - w / 2 / scale) / 2) * 2; x < cx + w / 2 / scale; x += 2) {
      for (let y = Math.floor((cy - h / 2 / scale) / 2) * 2; y < cy + h / 2 / scale; y += 2) {
        ctx.fillRect(x - .06, y - .06, .12, .12);
      }
    }
    for (const [ref, group, shape, poses] of parts) {
      const from = poses[stage], to = poses[stage + 1];
      const delay = stage === 0 ? (ref === "U3" ? 0 : (group + 1) * .032) :
        stage === 1 && group >= 4 ? (group - 4) * .065 : 0;
      const t = ease((elapsed - delay) / .68);
      const {copper, drills, silk} = shapes[shape];
      ctx.save();
      ctx.translate(mix(from[0], to[0], t), mix(from[1], to[1], t));
      ctx.rotate(-angleBetween(from[2], to[2], t) * Math.PI / 180);
      ctx.strokeStyle = "#b4c6a7";
      ctx.lineWidth = 0.11;
      ctx.stroke(silk);
      ctx.fillStyle = t > .03 && t < .97 && from.some((n, i) => n !== to[i]) ? "#efa47b" : "#cf7857";
      ctx.fill(copper);
      ctx.fillStyle = "#071210";
      ctx.fill(drills);
      ctx.restore();
    }
    ctx.restore();
    return elapsed > .01 ? nextName + " · " + nextCommit : name + " · " + commit;
  }

  function paint() {
    const w = canvas.clientWidth, h = canvas.clientHeight, density = Math.min(devicePixelRatio, 2);
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * density) || canvas.height !== Math.round(h * density)) {
      canvas.width = Math.round(w * density);
      canvas.height = Math.round(h * density);
    }
    ctx.setTransform(density, 0, 0, density, 0, 0);
    caption.value = drawFrame(ctx, w, h, time);
  }

  function pause() {
    cancel?.();
    cancel = null;
    play.textContent = time >= duration ? "Replay" : "Play";
  }
  function seek(seconds) {
    time = seconds;
    scrub.value = time;
    previous.disabled = time <= .02;
    next.disabled = time >= stops.at(-1) - .02;
    paint();
  }
  function start() {
    const from = time >= duration ? 0 : time;
    play.textContent = "Pause";
    cancel = animate(1000 * (duration - from), p => seek(mix(from, duration, p)), pause);
  }
  function step(to) {
    if (to === undefined) return;
    pause();
    const from = time;
    cancel = animate(850, p => seek(mix(from, to, p)), pause, reduced);
  }
  play.onclick = () => cancel ? pause() : start();
  previous.onclick = () => step(stops.findLast(stop => stop < time - .02));
  next.onclick = () => step(stops.find(stop => stop > time + .02));
  scrub.oninput = () => {
    pause();
    seek(scrub.valueAsNumber);
  };
  exportButton.disabled = !window.MediaRecorder || !canvas.captureStream;
  exportButton.onclick = async () => {
    exportButton.disabled = true;
    exportButton.textContent = "Exporting…";
    try {
      const {exportVideo} = await import("./video.js");
      await exportVideo(drawFrame, duration, recording.signal, p => {
        exportButton.textContent = "Exporting " + Math.round(p * 100) + "%";
      });
      if (!recording.signal.aborted) exportButton.textContent = "Export video";
    } catch (error) {
      console.error(error);
      if (!recording.signal.aborted) exportButton.textContent = "Retry export";
    } finally {
      if (!recording.signal.aborted) exportButton.disabled = false;
    }
  };
  const resize = new ResizeObserver(paint);
  dialog.addEventListener("close", () => {
    recording.abort();
    pause();
    resize.disconnect();
  }, {once: true});
  dialog.querySelector("#replay-title").textContent = "Placement replay";
  exportButton.textContent = "Export video";
  play.textContent = "Play";
  dialog.showModal();
  resize.observe(canvas);
  seek(0);
  if (!reduced) start();
}
