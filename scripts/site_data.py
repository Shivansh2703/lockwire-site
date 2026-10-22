"""Regenerate src/data/demo.json from real runs of the published lockwire package.

Run: uv run --with lockwire==0.2.3 python scripts/site_data.py
Check only (exit 1 on drift): add --check
"""

import json
import subprocess
import sys
import tempfile
from importlib.metadata import version
from pathlib import Path

from ruamel.yaml import YAML

OUT = Path(__file__).resolve().parent.parent / "src" / "data" / "demo.json"
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


if __name__ == "__main__":
    data = build()
    text = json.dumps(data, indent=2) + "\n"
    if "--check" in sys.argv:
        old = OUT.read_text() if OUT.exists() else ""
        if old != text:
            sys.exit("demo.json drifted from a fresh run; rerun scripts/site_data.py")
        print("demo.json matches a fresh run")
    else:
        OUT.write_text(text)
        print(f"wrote {OUT}")
