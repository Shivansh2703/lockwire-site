// Demo: robot picker, seven modes, 3D view. The first paint (Drone, Check) is already in the HTML.
import { hit } from "./hits.js";

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

// Ask box (present only when the site was built with PUBLIC_ASSISTANT_URL). Answers go in via textContent.
const ask = $("[data-ask]");
const askOut = ask && $("[data-ask-out]", ask);
let askHistory = [];
let askRobot = state.robot;
async function sendAsk(q) {
  q = q.trim();
  if (!q || ask.dataset.busy) return;
  hit("ask");
  ask.dataset.busy = "1";
  const btn = $("button[type=submit]", ask);
  btn.disabled = true;
  askOut.textContent = "Thinking\u2026";
  const robot = state.robot;
  let text;
  try {
    const r = await fetch(ask.dataset.url.replace(/\/$/, "") + "/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ robot, mode: state.mode, question: q, history: askHistory.slice(-6) }),
      signal: AbortSignal.timeout(30000),
    });
    const j = await r.json().catch(() => ({}));
    text = j.answer ?? j.message ?? "Something went wrong. Try again.";
    if (j.answer && robot === state.robot) askHistory = [...askHistory, { role: "user", content: q }, { role: "assistant", content: j.answer }].slice(-6);
  } catch {
    text = "Couldn't reach the assistant. Try again in a moment.";
  }
  if (robot === state.robot) askOut.textContent = text;
  delete ask.dataset.busy;
  btn.disabled = false;
}
if (ask) {
  ask.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("input", ask);
    const q = input.value;
    input.value = "";
    sendAsk(q);
  });
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const tone = (v) => (v === "NO-GO" ? "bad" : v === "GO" ? "go" : "muted");
const isNum = (s) => /^[\d.+-]/.test(s);

let detailsOpen = false;

function panelHTML() {
  const m = data.modes[state.mode];
  const hi = new Set(m?.highlight ?? []);
  const body = m
    ? `<div class="demo-verdict-row">${m.verdict && !(state.mode === "check" && data.robot.catch) ? `<span class="demo-verdict ${tone(m.verdict)}">${esc(m.verdict)}</span>` : ""}${m.label ? `<span class="demo-rec">Lockwire Pro · ${esc(m.label.toLowerCase())}</span>` : ""}</div>
       <h3 class="demo-headline">${esc(m.headline)}</h3>
       <details class="demo-more"${detailsOpen || state.mode === "docs" ? " open" : ""}><summary>Details</summary>
       <ul class="demo-lines">${m.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
       <p class="demo-src"><code>${esc(m.source)}</code></p>`
    : `<p class="demo-wait">Simulated run for this robot is on the way.</p>`;
  const parts = data.robot.parts.map((p) => `<li><button type="button" data-part="${esc(p.id)}" aria-pressed="${p.id === state.part}" class="${hi.has(p.id) ? "hl" : ""}">${esc(p.name)}</button></li>`).join("");
  return m ? `${body}<ul class="demo-parts">${parts}</ul></details>` : body;
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
  detailsOpen = !!$(".demo-more", panel)?.open;
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
  const c = data.robot.catch, box = $("[data-catch]");
  if (box) {
    box.hidden = !c || state.mode !== "check";
    if (c) {
      $("[data-catch-title]", box).textContent = c.title;
      $("[data-catch-needed]", box).textContent = c.needed;
      $("[data-catch-avail]", box).textContent = c.available;
      $("[data-catch-over]", box).textContent = c.over;
    }
  }
  paint3d();
  if (state.robot !== askRobot) { askRobot = state.robot; askHistory = []; if (askOut) askOut.textContent = ""; }
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
  hit("robot_" + id);
  $$("[data-robot-btn]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.robotBtn === id)));
  data = await load(id);
  if (state.robot !== id) return; // clicked again meanwhile
  render();
  pick3d();
}

async function setMode(m) {
  state.mode = m;
  hit("mode_" + m);
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
  if (t.dataset.q) { sendAsk(t.dataset.q); return; }
  if (t.dataset.robotBtn && t.dataset.robotBtn !== state.robot) await setRobot(t.dataset.robotBtn);
  else if (t.dataset.modeBtn) await setMode(t.dataset.modeBtn);
  else if (t.dataset.step) await setMode(MODES[(MODES.indexOf(state.mode) + Number(t.dataset.step) + MODES.length) % MODES.length]);
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
