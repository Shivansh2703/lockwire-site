// The real drone model, coloured by the step. Loaded after first paint.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const OVERLOAD = ["dev.onboard-computer", "dev.depth-camera", "dev.telemetry-radio", "rail.supply-5v", "rail.telemetry-port-5v"];
const clean = (names) => names.map((n) => THREE.PropertyBinding.sanitizeNodeName(n)); // the loader renames nodes this way
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function start(canvas, still, current) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch { return null; }
  document.documentElement.classList.add("js-3d");
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a93a3, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  const controls = new OrbitControls(camera, canvas);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.autoRotate = !still;
  controls.autoRotateSpeed = 0.8;

  const base = new THREE.Color(0x9aa1ab);
  const mats = new Map(); // group name -> materials under it
  new GLTFLoader().load("/drone.glb", (gltf) => {
    const root = gltf.scene;
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.material = new THREE.MeshStandardMaterial({ color: base, roughness: 0.6, metalness: 0.1 });
      for (let p = o; p; p = p.parent) if (p.name) (mats.get(p.name) ?? mats.set(p.name, []).get(p.name)).push(o.material);
    });
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3()).length();
    root.position.sub(box.getCenter(new THREE.Vector3()));
    scene.add(root);
    camera.position.set(size * 0.75, size * 0.55, size * 0.95);
    camera.lookAt(0, 0, 0);
    paint(current());
  });

  const paint = (step) => {
    const red = new THREE.Color(css("--bad")), blue = new THREE.Color(css("--accent")), green = new THREE.Color(css("--go"));
    for (const list of mats.values()) list.forEach((m) => m.color.copy(base));
    const tint = (names, c) => names.forEach((n) => mats.get(n)?.forEach((m) => m.color.copy(c)));
    if (step === "plan") tint(clean(OVERLOAD), blue);
    if (step === "check") tint(clean(OVERLOAD), red);
    if (step === "fix") tint(clean(["dev.onboard-computer"]), green);
    // test: no tint, the test data is another quadrotor's public log, not this drone
  };

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas);
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
  return paint;
}
