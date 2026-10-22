// One three.js scene shared by all robots. Loaded after first paint; each robot's glb loads when picked.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const clean = (n) => THREE.PropertyBinding.sanitizeNodeName(n); // the loader renames nodes this way

export function start(canvas, { onHover, onSelect }) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch { return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a93a3, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2, 4, 3);
  scene.add(sun);

  // Page scroll stays the page's: wheel zooms only with ctrl/cmd (trackpad pinch sends ctrl).
  let controls;
  canvas.addEventListener("wheel", (e) => { controls.enableZoom = e.ctrlKey || e.metaKey; });
  controls = new OrbitControls(camera, canvas);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.autoRotate = false;
  canvas.style.touchAction = "pan-y"; // a vertical swipe on a phone still scrolls the page

  const render = () => renderer.render(scene, camera);
  controls.addEventListener("change", render);

  const base = new THREE.Color(0x9aa1ab);
  let root, loadId = 0;
  let parts = new Map(); // part id -> { name, meshes }
  let owner = new Map(); // mesh -> part id
  let tint = new Map(); // part id -> color name
  let hover = null, selected = null;

  const dispose = () => {
    if (!root) return;
    scene.remove(root);
    root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    root = null; parts = new Map(); owner = new Map();
  };

  const repaint = () => {
    const col = { bad: new THREE.Color(css("--bad")), accent: new THREE.Color(css("--accent")), go: new THREE.Color(css("--go")) };
    const glow = new THREE.Color(css("--accent"));
    for (const [id, p] of parts) {
      const c = tint.has(id) ? col[tint.get(id)] : base;
      const e = id === selected ? 0.55 : id === hover ? 0.3 : 0;
      p.meshes.forEach((m) => { m.material.color.copy(c); m.material.emissive.copy(glow).multiplyScalar(e); });
    }
    render();
  };

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    render();
  };
  new ResizeObserver(resize).observe(canvas);

  // Picking: hover on move, select on a click that was not a drag.
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const pick = (e) => {
    if (!root) return null;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    for (const hit of ray.intersectObject(root, true)) if (owner.has(hit.object)) return owner.get(hit.object);
    return null;
  };
  let queued = false;
  canvas.addEventListener("pointermove", (e) => {
    if (e.buttons || queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const id = pick(e);
      if (id !== hover) { hover = id; repaint(); }
      canvas.style.cursor = id ? "pointer" : "";
      const r = canvas.getBoundingClientRect();
      onHover(id ? parts.get(id).name : null, e.clientX - r.left, e.clientY - r.top);
    });
  });
  canvas.addEventListener("pointerleave", () => { if (hover) { hover = null; repaint(); } onHover(null); });
  let down;
  canvas.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    onSelect(pick(e));
  });

  return {
    async load(partList, url) {
      const mine = ++loadId;
      const gltf = await new GLTFLoader().loadAsync(url);
      if (mine !== loadId) return; // a newer pick won the race
      dispose();
      root = gltf.scene;
      if (gltf.asset?.extras?.lockwire?.up === "z") root.rotation.x = -Math.PI / 2; // starter scenes are z-up like their URDF
      root.traverse((o) => { if (o.isMesh) o.material = new THREE.MeshStandardMaterial({ color: base, roughness: 0.6, metalness: 0.1 }); });
      for (const p of partList) {
        const node = p.node && root.getObjectByName(clean(p.node)); // some parts have no node of their own
        if (!node) continue;
        const meshes = [];
        node.traverse((o) => { if (o.isMesh) { meshes.push(o); owner.set(o, p.id); } });
        parts.set(p.id, { name: p.name, meshes });
      }
      root.updateMatrixWorld(true); // after the z-up turn, before measuring
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3()).length();
      root.position.sub(box.getCenter(new THREE.Vector3()));
      scene.add(root);
      // Fit the whole robot: its bounding sphere at this field of view, with a small margin.
      resize(); // so the aspect below is the view's real shape
      const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
      const half = Math.min(vHalf, Math.atan(Math.tan(vHalf) * camera.aspect)); // narrower of the two angles
      const fit = (size / 2) / Math.sin(half) * 1.1;
      camera.position.copy(new THREE.Vector3(0.75, 0.55, 0.95).normalize().multiplyScalar(fit));
      controls.minDistance = size * 0.4;
      controls.maxDistance = size * 3;
      controls.target.set(0, 0, 0);
      controls.update();
      hover = selected = null;
      resize();
      repaint();
    },
    // tints: [partId, "bad"|"accent"|"go"][]; sel: selected part id or null
    paint(tints, sel) { tint = new Map(tints); selected = sel; repaint(); },
  };
}
