import * as THREE from "three";
import { GLTFLoader } from "./vendor/GLTFLoader.js";
import { mergeGeometries } from "./utils/BufferGeometryUtils.js";
import {animate, ease} from "./motion.js";

function studioEnvironment(renderer) {
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(0x545962);
  const panel = new THREE.PlaneGeometry(5, 4);
  for (const [x, y, z, intensity] of [[-3, 4, 0, 2.8], [4, 2, 3, 1.8], [0, 2, -4, 1.4]]) {
    const light = new THREE.Mesh(panel, new THREE.MeshBasicMaterial({color: new THREE.Color().setScalar(intensity)}));
    light.position.set(x, y, z);
    light.lookAt(0, 0, 0);
    studio.add(light);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(studio, .12);
  pmrem.dispose();
  panel.dispose();
  studio.children.forEach(light => light.material.dispose());
  return environment;
}

function batchStaticModel(source, excluded) {
  source.updateMatrixWorld(true);
  const batches = new Map();
  const originalGeometry = new Set();
  source.traverse(mesh => {
    if (!mesh.isMesh || excluded?.has(mesh)) return;
    const geometry = mesh.geometry;
    const attributes = Object.keys(geometry.attributes).sort().join(",");
    const key = `${mesh.material.uuid}/${attributes}/${Boolean(geometry.index)}`;
    if (!batches.has(key)) batches.set(key, {material: mesh.material, geometry: []});
    batches.get(key).geometry.push(geometry.clone().applyMatrix4(mesh.matrixWorld));
    originalGeometry.add(geometry);
  });
  const result = new THREE.Group();
  for (const batch of batches.values()) {
    const joined = mergeGeometries(batch.geometry);
    if (joined) {
      result.add(new THREE.Mesh(joined, batch.material));
      batch.geometry.forEach(geometry => geometry.dispose());
    } else {
      batch.geometry.forEach(geometry => result.add(new THREE.Mesh(geometry, batch.material)));
    }
  }
  originalGeometry.forEach(geometry => geometry.dispose());
  return result;
}

export function createBoardView(canvas) {
  const renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, .001, 10);
  const environment = studioEnvironment(renderer);
  scene.environment = environment.texture;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x74849a, .75));
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(-1, 2, 1);
  scene.add(key);

  const orbit = new THREE.Spherical(.25, .67, .24);
  let model, distance = .25, radius = .06;
  let modelBounds = new Map();
  let poses = new Map(), moving = new Map(), cancelMotion;
  let afterDraw = () => {};
  const raycast = new THREE.Raycaster();

  function draw() {
    if (canvas.hidden) return;
    const {clientWidth: width, clientHeight: height} = canvas;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    camera.position.setFromSpherical(orbit);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    afterDraw();
  }

  function fit() {
    const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
    const aspect = canvas.clientHeight ? canvas.clientWidth / canvas.clientHeight : 1;
    const horizontal = Math.atan(Math.tan(vertical) * aspect);
    distance = 1.1 * radius / Math.sin(Math.min(vertical, horizontal));
    orbit.set(distance, .67, .24);
    draw();
  }

  new ResizeObserver(() => {
    if (!canvas.clientWidth || !canvas.clientHeight) return;
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    draw();
  }).observe(canvas);

  canvas.addEventListener("pointerdown", event => canvas.setPointerCapture(event.pointerId));
  canvas.addEventListener("pointermove", event => {
    if (!canvas.hasPointerCapture(event.pointerId)) return;
    orbit.theta -= event.movementX * .008;
    orbit.phi = THREE.MathUtils.clamp(orbit.phi - event.movementY * .008, .05, Math.PI - .05);
    draw();
  });
  canvas.addEventListener("wheel", event => {
    event.preventDefault();
    orbit.radius = THREE.MathUtils.clamp(orbit.radius * Math.exp(event.deltaY / 520), .35 * distance, 4 * distance);
    draw();
  }, {passive: false});

  async function replace(data) {
    const {scene: source} = await new GLTFLoader().parseAsync(data, "");
    cancelMotion?.();
    const prior = poses;
    poses = new Map();
    moving = new Map();
    modelBounds = new Map();
    const excluded = new Set();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    source.updateMatrixWorld(true);
    source.traverse(node => {
      if (!/^[A-Za-z]+\d+[A-Za-z0-9_-]*$/.test(node.name)) return;
      const box = new THREE.Box3().setFromObject(node);
      if (!box.isEmpty()) modelBounds.set(node.name, box);
      const position = new THREE.Vector3(), rotation = new THREE.Quaternion();
      node.matrixWorld.decompose(position, rotation, new THREE.Vector3());
      const to = {position, rotation};
      poses.set(node.name, to);
      const from = prior.get(node.name);
      if (reduced || !from || (position.distanceToSquared(from.position) < 1e-16 && rotation.angleTo(from.rotation) < 1e-5)) return;
      const artwork = batchStaticModel(node);
      const pivot = new THREE.Group();
      artwork.position.copy(position).negate();
      pivot.position.copy(position);
      pivot.add(artwork);
      moving.set(node.name, {pivot, from, to, inverse: rotation.clone().invert()});
      node.traverse(child => excluded.add(child));
    });
    const next = batchStaticModel(source, excluded);
    for (const {pivot} of moving.values()) next.add(pivot);
    const bounds = new THREE.Box3().setFromObject(next);
    const center = bounds.getCenter(new THREE.Vector3());
    next.position.sub(center);
    for (const box of modelBounds.values()) box.translate(next.position);
    radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
    const first = !model;
    if (model) {
      scene.remove(model);
      model.traverse(part => {
        part.geometry?.dispose();
        for (const material of [].concat(part.material || [])) material.dispose();
      });
    }
    scene.add(next);
    model = next;
    if (first) fit();
    else if (!moving.size) draw();
    else {
      const frame = progress => {
        const t = ease(progress);
        for (const [ref, {pivot, from, to, inverse}] of moving) {
          pivot.position.lerpVectors(from.position, to.position, t);
          const rotation = new THREE.Quaternion().slerpQuaternions(from.rotation, to.rotation, t);
          pivot.quaternion.multiplyQuaternions(rotation, inverse);
          poses.set(ref, {position: pivot.position.clone(), rotation});
        }
        draw();
      };
      frame(0);
      cancelMotion = animate(480, frame, () => { moving.clear(); });
    }
  }

  function bounds(part) {
    if (modelBounds.has(part.ref)) {
      const box = modelBounds.get(part.ref);
      const move = moving.get(part.ref);
      if (!move) return box;
      const {pivot, to} = move;
      pivot.updateMatrix();
      return box.clone().translate(to.position.clone().add(model.position).negate())
        .applyMatrix4(pivot.matrix).translate(model.position);
    }
    // Some footprints, such as mounting holes, have no STEP model.
    const [x,y,w,h] = part.bounds.map(mm => mm / 1000);
    return new THREE.Box3(
      new THREE.Vector3(x, .0014, y),
      new THREE.Vector3(x+w, .0018, y+h),
    ).translate(model.position);
  }

  function pick(clientX, clientY, parts) {
    if (!model || canvas.hidden) return null;
    const rect = canvas.getBoundingClientRect();
    raycast.setFromCamera(new THREE.Vector2(
      2*(clientX-rect.left)/rect.width-1, 1-2*(clientY-rect.top)/rect.height,
    ), camera);
    let nearest = Infinity, selected = null;
    const point = new THREE.Vector3();
    for (const part of parts) {
      if (!raycast.ray.intersectBox(bounds(part), point)) continue;
      const distance = point.distanceToSquared(raycast.ray.origin);
      if (distance < nearest) {
        nearest = distance;
        selected = part;
      }
    }
    return selected;
  }

  function locate(part) {
    if (!model) return null;
    const box = bounds(part);
    const screen = new THREE.Box2();
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const point = new THREE.Vector3(x,y,z).project(camera);
          if (point.z < -1 || point.z > 1) return null;
          screen.expandByPoint(new THREE.Vector2((point.x+1)*50,(1-point.y)*50));
        }
      }
    }
    return [screen.min.x, screen.min.y, screen.max.x-screen.min.x, screen.max.y-screen.min.y];
  }

  return {fit, draw, replace, pick, locate, onDraw: callback => { afterDraw = callback; }};
}
