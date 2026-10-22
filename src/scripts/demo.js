// Demo: robot picker, seven modes, 3D view. The first paint (Drone, Check) is already in the HTML.
const root = document.querySelector("[data-demo]");
const $ = (s, el = root) => el.querySelector(s);
const $$ = (s, el = root) => [...el.querySelectorAll(s)];
const MODES = ["design", "declare", "check", "plan", "test", "run", "docs"];

const robotFiles = import.meta.glob("../data/robots/*.json");
const runFiles = import.meta.glob("../data/runs/*.json"); // may be empty until the recordings land
const cache = {};
async function load(id) {
  if (!cache[id]) {
    const robot = (await robotFiles[`../data/robots/${id}.json`]()).default;
    const run = runFiles[`../data/runs/${id}.json`] ? (await runFiles[`../data/runs/${id}.json`]()).default : null;
    cache[id] = { robot, modes: { ...robot.modes, ...(run ?? {}) }, hasRun: !!run };
  }
  return cache[id];
}

const state = { robot: "drone", mode: "check", part: null };
let data = null; // loaded data for state.robot; null until first interaction
let view3d = null;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const tone = (v) => (v === "NO-GO" ? "bad" : v === "GO" ? "go" : "muted");
const isNum = (s) => /^[\d.+-]/.test(s);

function panelHTML() {
  const m = data.modes[state.mode];
  const hi = new Set(m?.highlight ?? []);
  const body = m
    ? `<div class="demo-verdict-row">${m.verdict ? `<span class="demo-verdict ${tone(m.verdict)}">${esc(m.verdict)}</span>` : ""}${m.label ? `<span class="demo-rec">${esc(m.label)}</span>` : ""}</div>
       <h3 class="demo-headline">${esc(m.headline)}</h3>
       <ul class="demo-lines">${m.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
       <p class="demo-src"><code>${esc(m.source)}</code></p>`
    : `<p class="demo-wait">Simulated run for this robot is on the way.</p>`;
  const parts = data.robot.parts.map((p) => `<li><button type="button" data-part="${esc(p.id)}" aria-pressed="${p.id === state.part}" class="${hi.has(p.id) ? "hl" : ""}">${esc(p.name)}</button></li>`).join("");
  return `${body}<h4 class="demo-sub">Parts</h4><ul class="demo-parts">${parts}</ul>`;
}

function cardHTML(p) {
  const facts = p.facts.length
    ? p.facts.map((f) => `<dt>${esc(f.label)}</dt><dd><span class="${isNum(f.value) ? "n" : ""}">${esc(f.value)}</span>${f.source ? `<span class="from">${esc(f.source)}</span>` : ""}</dd>`).join("")
    : "<dt>Facts</dt><dd>none on record</dd>";
  return `<header><h4>${esc(p.name)}</h4><button type="button" data-close aria-label="Close">Close</button></header><dl>${facts}</dl>`;
}

function paint3d() {
  const m = data.modes[state.mode];
  const color = m?.verdict === "NO-GO" ? "bad" : "accent";
  view3d?.paint((m?.highlight ?? []).map((id) => [id, color]), state.part);
}

function render() {
  const panel = $("[data-panel]");
  panel.innerHTML = panelHTML();
  panel.dataset.tone = tone(data.modes[state.mode]?.verdict);
  panel.setAttribute("aria-labelledby", `demo-tab-${state.mode}`);
  $$("[data-mode-btn]").forEach((b) => {
    const on = b.dataset.modeBtn === state.mode;
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
  });
  $$("[data-robot-btn]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.robotBtn === state.robot)));
  const part = data.robot.parts.find((p) => p.id === state.part);
  const card = $("[data-card]");
  card.hidden = !part;
  if (part) card.innerHTML = cardHTML(part);
  $("[data-view]").classList.toggle("has-card", !!part);
  const credit = $(".demo-credit");
  const r = data.robot;
  credit.innerHTML = `${esc(r.title)}: based on ${esc(r.based_on)} (${esc(r.licence)}). Numbers come from <code>${esc(r.source)}</code>.`;
  paint3d();
}

async function pick3d() {
  if (!view3d) return;
  const d = data;
  try {
    await view3d.load(d.robot.parts, d.robot.glb);
    if (d === data) { $("[data-view]").classList.add("is-3d"); paint3d(); }
  } catch { /* the screenshot stays */ }
}

async function setRobot(id) {
  state.robot = id; state.part = null;
  $$("[data-robot-btn]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.robotBtn === id)));
  data = await load(id);
  if (state.robot !== id) return; // clicked again meanwhile
  render();
  pick3d();
}

async function setMode(m) {
  state.mode = m;
  data ??= await load(state.robot);
  render();
}

function select(id) {
  state.part = id && id !== state.part ? id : null;
  render();
}

// The page is static until the first interaction; one click handler for everything.
root.addEventListener("click", async (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.dataset.robotBtn && t.dataset.robotBtn !== state.robot) await setRobot(t.dataset.robotBtn);
  else if (t.dataset.modeBtn) await setMode(t.dataset.modeBtn);
  else if (t.dataset.part) { data ??= await load(state.robot); select(t.dataset.part); }
  else if (t.hasAttribute("data-close")) select(null);
});

$(".demo-tabs").addEventListener("keydown", (e) => {
  const i = MODES.indexOf(state.mode);
  const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: MODES.length - 1 }[e.key];
  if (j === undefined) return;
  e.preventDefault();
  const next = MODES[(j + MODES.length) % MODES.length];
  setMode(next).then(() => $(`#demo-tab-${next}`).focus());
});
root.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.part) select(null); });

// 3D after first paint; without WebGL (or on failure) the screenshot stays.
async function start3d() {
  const { start } = await import("./robot3d.js");
  const tip = $("[data-tip]");
  view3d = start($("[data-canvas]"), {
    onHover(name, x, y) {
      tip.hidden = !name;
      if (name) { tip.textContent = name; tip.style.left = x + "px"; tip.style.top = y + "px"; }
    },
    async onSelect(id) { data ??= await load(state.robot); select(id); },
  });
  if (!view3d) return;
  data ??= await load(state.robot);
  pick3d();
}
("requestIdleCallback" in window ? requestIdleCallback : setTimeout)(start3d);
