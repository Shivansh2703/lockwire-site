// The demo: the real drone model, coloured by the step. Text and numbers are already in the HTML.
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Steps: tabs and "next" buttons switch panels; works without the 3D view.
const tabs = [...document.querySelectorAll("[data-step]")];
const panels = [...document.querySelectorAll("[data-panel]")];
let paint = () => {};
function show(step) {
  tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.step === step)));
  panels.forEach((p) => (p.hidden = p.dataset.panel !== step));
  paint(step);
}
tabs.forEach((t) => t.addEventListener("click", () => show(t.dataset.step)));
document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => show(b.dataset.go)));

// The check bar fills on load so the overload reads as it happens.
const bar = document.querySelector("[data-bar]");
if (bar && !still) {
  bar.classList.add("start");
  requestAnimationFrame(() => requestAnimationFrame(() => bar.classList.remove("start")));
}

document.getElementById("copy")?.addEventListener("click", (e) => {
  const b = e.currentTarget;
  navigator.clipboard?.writeText(b.dataset.text).then(() => (b.textContent = "Copied"), () => {});
});

// The 3D robot loads after the page is readable; until then (or without WebGL) the app screenshot shows.
const current = () => document.querySelector('[aria-selected="true"]')?.dataset.step ?? "check";
const load3d = () => import("./robot3d.js").then((m) => { paint = m.start(document.getElementById("robot"), still, current) ?? paint; });
("requestIdleCallback" in window ? requestIdleCallback : setTimeout)(load3d);
