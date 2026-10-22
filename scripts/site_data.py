"""Regenerate src/data/demo.json and src/data/robots/*.json (+ public/robots/*.glb) from real
runs of the published lockwire package.

Run: uv run --with lockwire==0.2.3 python scripts/site_data.py
Check only (exit 1 on drift): add --check
"""

import json
import re
import struct
import subprocess
import sys
import tempfile
from importlib.metadata import version
from pathlib import Path

from ruamel.yaml import YAML

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "data" / "demo.json"
ROBOTS = ["drone", "arm", "quadruped"]
RAIL = "rail.supply-5v"
BEC = "https://www.castlecreations.com/en/cc-bec-pro-010-0004-01"
# The fix: the same three commands a user would type (see the README's X500 correction).
FIX = [
    ["add", "rail", "lockwire.yaml", "--id", "rail.bec-5v", "--voltage", "5 V", "--capacity", "65 W",
     "--source", BEC, "--witness", "lockwire-site", "--note", "Castle CC BEC Pro set to 5 V; 65 W = 5 V x 13 A at 4S"],
    ["add", "device", "lockwire.yaml", "--id", "dev.bec", "--family", "fam.power-converter.bec",
     "--model", "mdl.power-converter.castle-cc-bec-pro", "--mass", "29 g", "--owner", "power-integration",
     "--source", BEC, "--witness", "lockwire-site"],
    ["declare", "lockwire.yaml", "devices/dev.onboard-computer/power/rail", "rail.bec-5v",
     "--source", "own regulator for the computer", "--witness", "lockwire-site"],
]


def lw(cwd, *args):
    return subprocess.run(["lockwire", *args], cwd=cwd, capture_output=True, text=True)


def check(cwd):
    lw(cwd, "check", "--json", "run.json")
    run = json.loads((cwd / "run.json").read_text())
    return {
        "verdict": run["verdict"],
        "exit_code": run["exit_code"],
        "headline": run["headline"],
        "counts": run["counts"],
        "violations": [
            {k: f[k] for k in ("quantity", "observed", "expected", "delta", "dependent")}
            for f in run["findings"]
            if f["severity"] == "violation"
        ],
    }


def rail_loads(cwd):
    """Each device's nominal draw on the 5 V supply rail, straight from the lockfile."""
    doc = YAML(typ="safe").load((cwd / "lockwire.yaml").read_text())
    rails = {r["id"]: r for r in doc["topology"]["rails"]}
    feeds = {RAIL} | {r["id"] for r in rails.values() if r.get("upstream") == RAIL}
    loads = [
        {"device": d["id"], "model": d["model"], "watts": d["power"]["draw"]["value"]}
        for d in doc["devices"]
        if d.get("power", {}).get("rail") in feeds and d["power"].get("draw")
    ]
    return {"capacity_w": rails[RAIL]["capacity"]["value"], "loads": loads}


def build():
    with tempfile.TemporaryDirectory() as tmp:
        cwd = Path(tmp)
        lw(cwd, "start", "--example", "drone")
        before = {"check": check(cwd), "rail": rail_loads(cwd)}
        for cmd in FIX:
            if lw(cwd, *cmd).returncode != 0:
                sys.exit(f"fix step failed: lockwire {' '.join(cmd[:2])}")
        after = {"check": check(cwd), "rail": rail_loads(cwd)}
    return {
        "source": f"lockwire {version('lockwire')} from PyPI, `lockwire start --example drone`",
        "plan": before,
        "fix_commands": [" ".join(["lockwire", *c[:4]]) + " ..." for c in FIX],
        "fixed": after,
    }


# ---- starter robots: three robots x five app modes ------------------------------------------

BRANDS = {"pixhawk": "Pixhawk", "holybro": "Holybro", "waveshare": "Waveshare", "jetson": "Jetson"}
ACRONYMS = {"gnss", "esc", "imu", "gps", "can", "uart", "usb", "i2c", "pm", "bec", "cpu"}


def humanise(slug):
    """'dev.motor.motor-1' -> 'Motor 1'; 'rail.supply-5v' -> 'Supply 5v'. Words come from the ids."""
    segs = [w for w in re.sub(r"^(dev|rail|bus|bud)\.", "", slug).split(".") if w]
    if len(segs) > 1 and segs[-1].startswith(segs[-2]):
        segs = segs[-1:]
    words = " ".join(segs).replace("-", " ").replace("_", " ").split()
    # Acronyms and part codes stay in capitals: GNSS, ESC, PM02, IST8310, 6C.
    words = [w.upper() if w in ACRONYMS or any(c.isdigit() for c in w) and len(w) > 1 else w for w in words]
    text = " ".join(BRANDS.get(w, w) for w in words)
    return text[:1].upper() + text[1:]


def qty(q):
    return f"{q['value']:g} {q['unit']}"


def glb_nodes(path):
    b = path.read_bytes()
    n = struct.unpack("<I", b[12:16])[0]
    return {x.get("name") for x in json.loads(b[20:20 + n])["nodes"]}


def robot(example):
    pkg = Path(sys.modules["lockwire"].__file__).parent / "examples" / example
    starter = json.loads((pkg / "starter.json").read_text())
    with tempfile.TemporaryDirectory() as tmp:
        cwd = Path(tmp)
        lw(cwd, "start", "--example", example)
        run_p = lw(cwd, "check", "--json", "run.json")
        plan_p = lw(cwd, "plan", "lockwire.yaml", "lockwire.plan.yaml", "--json", "plan.json")
        run = json.loads((cwd / "run.json").read_text())
        plan = json.loads((cwd / "plan.json").read_text())
        doc = YAML(typ="safe").load((cwd / "lockwire.yaml").read_text())
        system = lw(cwd, "describe").stdout
        nodes = glb_nodes(pkg / "scene.glb")
    cli_line = next(l for l in plan_p.stdout.splitlines() if re.match(r"(NO-GO|GO|NOT SCORED|REFUSED)", l))
    del run_p

    devices = doc["devices"]
    name = {d["id"]: humanise(d["id"]) for d in devices}
    rails = {r["id"]: r for r in doc["topology"]["rails"]}
    name.update({rid: f"{humanise(rid)} rail" for rid in rails})

    def plain(text):
        text = re.sub(r"\s*\(D\d+[^)]*\)", "", text)  # internal ruling ids like "(D79)"; keeps part names such as D435
        return re.sub(r"'?\b((?:dev|rail)\.[\w.-]+\w)'?", lambda m: name.get(m[1], m[1]), text)

    def names(ids, cap=3):
        ids = [name.get(i, i) for i in ids]
        return ", ".join(ids[:cap]) + (f" and {len(ids) - cap} more" if len(ids) > cap else "")

    def on_rail(ids):
        """Devices a rail id stands for; device ids pass through."""
        out = []
        for i in ids:
            out += [d["id"] for d in devices if d.get("power", {}).get("rail") == i] if i in rails else [i]
        return sorted(set(out))

    parts = []
    for d in devices:
        src = (d.get("provenance") or {}).get("source")
        phys, pw = d.get("physical", {}), d.get("power", {})
        facts = [{"label": "Mass", "value": qty(phys["mass"]) if phys.get("mass") else "not declared", "source": src if phys.get("mass") else None}]
        if pw.get("draw"):
            facts.append({"label": "Draw", "value": qty(pw["draw"]), "source": src})
        if pw.get("modes"):
            facts.append({"label": "Power modes", "value": ", ".join(f"{m['name']} {qty(m['draw'])}" for m in pw["modes"]), "source": src})
        if pw.get("rail"):
            facts.append({"label": "Rail", "value": name[pw["rail"]], "source": (rails[pw["rail"]].get("provenance") or {}).get("source")})
        if d.get("identity", {}).get("bus_ref"):
            facts.append({"label": "Bus", "value": humanise(d["identity"]["bus_ref"]), "source": src})
        parts.append({"id": d["id"], "name": name[d["id"]], "node": d["id"] if d["id"] in nodes else None, "facts": facts})
    unmassed = [d["id"] for d in devices if not d.get("physical", {}).get("mass")]

    def mode(title, verdict, headline, lines, highlight, source):
        return {"title": title, "verdict": verdict, "headline": headline, "lines": [plain(l) for l in lines[:6]],
                "highlight": sorted(set(highlight)), "source": source}

    # design: the parts on the model, what is known about mass and balance
    cg = run["forces"]["cg"]
    mt = run["forces"]["mass_total"]
    design_lines = [f"{len(devices)} parts placed on the 3D model", f"{len(devices) - len(unmassed)} of {len(devices)} have a declared mass"]
    if mt.get("value") is not None:
        design_lines.append(f"Mass declared so far: {mt['value']:.3g} {mt['unit']}" + (", incomplete" if unmassed else ""))
    if cg.get("value") is None:
        design_lines.append("Centre of gravity: not worked out until every part has a mass")
    design = mode("Design", None, f"{len(devices)} parts, {len(unmassed)} without a declared mass", design_lines, unmassed,
                  "lockwire check --json run.json (forces) and the lockfile's devices")

    # declare: every value carries a source; the gaps are what is still unset
    sourced = sum(1 for p in parts for f in p["facts"] if f["source"])
    unset = [f for f in run["findings"] if f["severity"] == "not_scored" and f["quantity"].startswith("devices/")]
    declare_lines = [f"{sourced} values declared, each with its source"]
    declare_lines += [f"{name.get(f['quantity'].split('/')[1], '')}: {f['observed']}" for f in unset[:5]]
    declare = mode("Declare", None, f"{sourced} sourced values, {len(unset)} still unset", declare_lines,
                   [f["quantity"].split("/")[1] for f in unset], "the lockfile (lockwire start --example " + example + ") and lockwire check --json run.json")

    # check: record-level findings
    viol = [f for f in run["findings"] if f["severity"] == "violation"]
    warn = [f for f in run["findings"] if f["severity"] == "warning"]
    ns = [f for f in run["findings"] if f["severity"] == "not_scored"]
    check_lines = [f"{names(f['dependent'].split(', ')) if f['dependent'] else f['quantity']}: observed {f['observed']}, expected {f['expected']}, over by {f['delta']}" for f in viol]
    check_lines += [re.sub(r"^(\d+) massless frames.*", lambda m: f"{m[1]} {'frame' if m[1] == '1' else 'frames'} without mass (normal for sensor and mount frames)", f["observed"]) for f in warn]
    check_lines.append(f"{len(ns)} {'check' if len(ns) == 1 else 'checks'} not scored (nothing declared to compare)")
    check = mode("Check", run["verdict"], run["headline"], check_lines,
                 [d for f in viol for d in (f["dependent"] or "").split(", ") if d], "lockwire check --json run.json")

    # plan: the starter's own plan checked before anything runs
    byp = {f["quantity"]: f for f in plan["findings"]}
    plan_lines = []
    for i, st in enumerate(plan["steps"], 1):
        kind = st["path"].split("/")[3].replace("_", " ")
        f = byp.get(st["path"])
        plan_lines.append(f"Step {i}, {kind}: {st['status'].lower() if st['status'] != 'FAIL' else 'fails'}" + (f". Observed {f['observed']}, expected {f['expected']}" if f else ""))
    plan_hi = [d for f in plan["findings"] for d in on_rail((f["dependent"] or "").split(", ")) if d]
    planm = mode("Plan", plan["verdict"], cli_line, plan_lines, plan_hi, "lockwire plan lockwire.yaml lockwire.plan.yaml --json plan.json")

    # docs: the generated reference; power tree is the part a visitor can read at a glance
    tree = [l.strip().removeprefix("- ") for l in system.split("## Power tree")[1].split("##")[0].splitlines() if "load " in l] if "## Power tree" in system else []
    docs_loads = [re.search(r"load (\S+):", l)[1] for l in tree]
    docs_lines = [re.sub(r"load (\S+): ", lambda m: f"{name.get(m[1], m[1])} draws ", l) for l in tree] if tree else [
        f"{plain(r['id'])}: {qty(r['voltage'])}, capacity {qty(r['capacity'])}" for r in rails.values() if r.get("capacity") and r.get("voltage")]
    docs = mode("Docs", None, f"A reference sheet for each of the {len(devices)} parts, written from the lockfile", docs_lines,
                docs_loads or [d["id"] for d in devices if d.get("power")], "lockwire describe lockwire.yaml")

    return {
        "id": example, "title": starter["title"], "based_on": starter["based_on"], "licence": starter["licence"],
        "source": f"lockwire {version('lockwire')} from PyPI, `lockwire start --example {example}`",
        "glb": f"/robots/{example}.glb", "parts": parts,
        "modes": {"design": design, "declare": declare, "check": check, "plan": planm, "docs": docs},
    }, (pkg / "scene.glb").read_bytes()


if __name__ == "__main__":
    import lockwire  # noqa: F401  (needed for the examples path)

    files = {OUT: (json.dumps(build(), indent=2) + "\n").encode()}
    for ex in ROBOTS:
        data, glb = robot(ex)
        files[ROOT / "src" / "data" / "robots" / f"{ex}.json"] = (json.dumps(data, indent=2) + "\n").encode()
        files[ROOT / "public" / "robots" / f"{ex}.glb"] = glb
    if "--check" in sys.argv:
        bad = [p.name for p, b in files.items() if not p.exists() or p.read_bytes() != b]
        if bad:
            sys.exit(f"{', '.join(bad)} drifted from a fresh run; rerun scripts/site_data.py")
        print(f"all {len(files)} data files match a fresh run")
    else:
        for p, b in files.items():
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(b)
        print(f"wrote {len(files)} files")
