import * as THREE from "three";
import { GLTFLoader } from "./vendor/GLTFLoader.js";
import { mergeGeometries } from "./utils/BufferGeometryUtils.js";

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

function batchStaticModel(source) {
  source.updateMatrixWorld(true);
  const batches = new Map();
  const originalGeometry = new Set();
  source.traverse(mesh => {
    if (!mesh.isMesh) return;
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

  function draw() {
    if (canvas.hidden) return;
    const {clientWidth: width, clientHeight: height} = canvas;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    camera.position.setFromSpherical(orbit);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
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
    const next = batchStaticModel(source);
    const bounds = new THREE.Box3().setFromObject(next);
    const center = bounds.getCenter(new THREE.Vector3());
    next.position.sub(center);
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
    else draw();
  }

  return {fit, draw, replace};
}
