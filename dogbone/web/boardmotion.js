import {animate, ease, mix} from "./motion.js";

const ns = "http://www.w3.org/2000/svg";
const tags = new Set(["svg", "g", "path", "circle", "ellipse", "line", "rect", "polygon", "polyline", "text", "tspan"]);
const coordinates = new Set(["x", "y", "cx", "cy", "x1", "y1", "x2", "y2", "points", "d", "transform"]);
const attributes = new Set([...coordinates, "viewBox", "width", "height", "r", "rx", "ry", "style",
  "textLength", "lengthAdjust", "text-anchor", "opacity", "font-size", "font-family", "stroke-opacity"]);
const number = /-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?/gi;
const parameters = {M: "xy", L: "xy", T: "xy", H: "x", V: "y", C: "xyxyxy", S: "xyxy", Q: "xyxy", A: "_____xy", Z: ""};

function interpolate(before, after, axes) {
  const a = [...before.matchAll(number)], b = [...after.matchAll(number)];
  if (!a.length || a.length !== b.length || a.length !== axes.length ||
      before.replace(number, "#") !== after.replace(number, "#")) return null;
  const deltas = {};
  for (let i = 0; i < a.length; i++) {
    const axis = axes[i], delta = Number(b[i][0]) - Number(a[i][0]);
    if (axis === "_" && delta) return null;
    deltas[axis] ??= delta;
    if (Math.abs(delta - deltas[axis]) > .00021) return null;
  }
  return t => {
    let i = 0;
    return after.replace(number, value => {
      const start = Number(a[i++][0]), end = Number(value);
      return start === end ? value : mix(start, end, t).toFixed(5);
    });
  };
}

function axisOrder(key, value) {
  if (key === "d") {
    const axes = [];
    for (const command of value.matchAll(/([A-Z])([^A-Z]*)/g)) {
      const order = parameters[command[1]];
      const count = [...command[2].matchAll(number)].length;
      if (order === undefined || (count && (!order.length || count % order.length))) return [];
      for (let i = 0; i < count; i++) axes.push(order[i % order.length]);
    }
    return axes;
  }
  if (key === "points") return Array.from(value.matchAll(number), (_, i) => i % 2 ? "y" : "x");
  if (key === "transform") {
    if (value.startsWith("rotate(")) return ["_", "x", "y"];
    if (value.startsWith("translate(")) return ["x", "y", "_", "_"].slice(0, [...value.matchAll(number)].length);
    return [];
  }
  return [key.includes("x") ? "x" : "y"];
}

function matchingPlot(previous, target, changes) {
  if (previous.localName !== target.localName || !tags.has(target.localName)) return null;
  if (target.localName === "text" && previous.textContent !== target.textContent) return null;
  const node = document.createElementNS(ns, target.localName);
  for (const {name, value} of target.attributes) {
    if (!attributes.has(name) || !/^[\w\s#;:.,%()+-]*$/.test(value) || /url\s*\(/i.test(value)) continue;
    const prior = previous.getAttribute(name);
    if (prior !== value) {
      const sample = prior !== null && coordinates.has(name) && interpolate(prior, value, axisOrder(name, value));
      if (!sample) return null;
      changes.push(t => node.setAttribute(name, sample(t)));
    }
    node.setAttribute(name, value);
  }
  if (target.localName === "text" || target.localName === "tspan") node.textContent = target.textContent;
  const children = item => [...item.children].filter(child => !["title", "desc"].includes(child.localName));
  const a = children(previous), b = children(target);
  if (a.length !== b.length) return null;
  for (let i = 0; i < a.length; i++) {
    const child = matchingPlot(a[i], b[i], changes);
    if (!child) return null;
    node.append(child);
  }
  return node;
}

export function createBoardMotion(container) {
  let current, animated, cancel;
  function stop() {
    cancel?.();
    animated?.remove();
    animated = cancel = null;
    container.classList.remove("animating");
  }
  return (target, shouldAnimate) => {
    const from = animated || current;
    current = target;
    if (!shouldAnimate || !from || matchMedia("(prefers-reduced-motion: reduce)").matches ||
        from.getAttribute("viewBox") !== target.getAttribute("viewBox")) {
      stop();
      return;
    }
    const changes = [];
    const next = matchingPlot(from, target, changes);
    stop();
    if (!next || !changes.length) return;
    next.dataset.motion = "";
    next.setAttribute("aria-hidden", "true");
    animated = next;
    container.prepend(next);
    container.classList.add("animating");
    const draw = progress => {
      const t = ease(progress);
      changes.forEach(change => change(t));
    };
    draw(0);
    cancel = animate(480, draw, stop);
  };
}
