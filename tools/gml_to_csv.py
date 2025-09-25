# FILE: gml_to_csv.py
"""
IndoorGML (.gml/.xml) -> CSV + JSON per floor
Additions:
  --as-floor N          : force all parsed states/transitions onto floor N
  --id-pattern REGEX    : override ID pattern (must have 2 groups: floor, id)
  --desc-floor-key KEY  : JSON key in <gml:description> to read floor (default: floor)
  --debug-states        : print first 10 parsed states for troubleshooting
Keeps:
  -i/--gml, -j/--jsondir, -c/--csvdir, -f/--floors, -y/--force,
  --allow-missing, --remap SRC:DST(,SRC:DST...)
"""

from __future__ import annotations
import argparse, csv, json, math, re, zipfile
from pathlib import Path
import xml.etree.ElementTree as ET
from typing import Dict, List, Tuple, Optional, Set

# ---------------- XML helpers ----------------
def iter_local(root: ET.Element, local: str):
    q = f"}}{local}"
    for el in root.iter():
        if isinstance(el.tag, str) and (el.tag == local or el.tag.endswith(q)):
            yield el

def find_first_local(parent: ET.Element, local: str) -> Optional[ET.Element]:
    for el in iter_local(parent, local):
        return el
    return None

def text(el: Optional[ET.Element]) -> str:
    return (el.text or "").strip() if el is not None else ""

def fnum(s: str, d: float = 0.0) -> float:
    try:
        return float(s)
    except Exception:
        return float(d)

def euclid(a: Dict, b: Dict) -> float:
    return math.hypot(a["x"] - b["x"], a["y"] - b["y"])

# --------------- Core parse ---------------
class Config:
    def __init__(self, id_pattern: str, desc_floor_key: str, default_floor: int, as_floor: Optional[int], debug: bool):
        self.id_re = re.compile(id_pattern)
        self.desc_floor_key = desc_floor_key
        self.default_floor = int(default_floor)
        self.as_floor = int(as_floor) if as_floor is not None else None
        self.debug = debug

    def parse_state_id(self, gid: str) -> Tuple[Optional[int], Optional[str]]:
        m = self.id_re.match(gid or "")
        if not m:
            return None, None
        fl_raw = m.group(1)
        try:
            fl = int(fl_raw)
        except Exception:
            # tolerate non-integer floors in pattern
            try:
                fl = int(float(fl_raw))
            except Exception:
                fl = None
        return fl, m.group(2)

def load_root(path: Path) -> ET.Element:
    try:
        return ET.parse(path).getroot()
    except ET.ParseError as e:
        raise SystemExit(f"[XML parse error] {e}\n  file: {path}")

def collect_graph(root: ET.Element, cfg: Config):
    nodes_by_floor: Dict[int, Dict[str, Dict]] = {}
    edges_by_floor: Dict[int, List[Dict]] = {}

    debug_rows = []

    # ---- States
    for st in iter_local(root, "State"):
        gid = st.get("{http://www.opengis.net/gml/3.2}id") or st.get("gml:id") or st.get("id") or ""
        fl_from_id, nid_guess = cfg.parse_state_id(gid)

        name = text(find_first_local(st, "name")) or (nid_guess or "")
        desc = text(find_first_local(st, "description"))

        meta = {}
        if desc:
            try:
                meta = json.loads(desc)
            except Exception:
                meta = {}

        # Determine floor (priority order)
        if cfg.as_floor is not None:
            floor = cfg.as_floor
        elif cfg.desc_floor_key in meta:
            try:
                floor = int(meta[cfg.desc_floor_key])
            except Exception:
                try:
                    floor = int(float(meta[cfg.desc_floor_key]))
                except Exception:
                    floor = cfg.default_floor
        elif fl_from_id is not None:
            floor = int(fl_from_id)
        else:
            floor = cfg.default_floor

        # Coordinates (search any descendant gml:pos)
        pos_el = find_first_local(st, "pos")
        coords = text(pos_el).split() if pos_el is not None else []
        x = fnum(coords[0], 0.0) if len(coords) >= 1 else 0.0
        y = fnum(coords[1], 0.0) if len(coords) >= 2 else 0.0

        nid = (nid_guess or name or f"N{x:.0f}_{y:.0f}").strip() or f"N{len(nodes_by_floor.get(floor, {}))+1:03d}"
        ntype = str(meta.get("type", "room"))

        nodes_by_floor.setdefault(floor, {})[nid] = {
            "x": x,
            "y": y,
            "name": name or nid,
            "type": ntype,
            "floor": floor,
        }

        if cfg.debug and len(debug_rows) < 10:
            debug_rows.append((gid, floor, nid, x, y))

    if cfg.debug:
        print("[DEBUG] First parsed states (up to 10):")
        for row in debug_rows:
            print(f"  id={row[0]!r} -> floor={row[1]} nid={row[2]} pos=({row[3]}, {row[4]})")

    # ---- Transitions
    for tr in iter_local(root, "Transition"):
        hrefs: List[str] = []
        for c in iter_local(tr, "connects"):
            h = c.get("{http://www.w3.org/1999/xlink}href") or c.get("xlink:href") or c.get("href") or ""
            if h:
                hrefs.append(h.replace("#", ""))
        if len(hrefs) < 2:
            continue

        a_f, a_id = cfg.parse_state_id(hrefs[0])
        b_f, b_id = cfg.parse_state_id(hrefs[1])
        if not a_id or not b_id:
            continue

        # Floor inference for edges follows same priority; if forced, both use as_floor
        if cfg.as_floor is not None:
            fa = fb = cfg.as_floor
        else:
            fa = int(a_f if a_f is not None else cfg.default_floor)
            fb = int(b_f if b_f is not None else cfg.default_floor)

        if fa != fb:
            # keep only same-floor transitions in per-floor output
            continue

        a_node = nodes_by_floor.get(fa, {}).get(a_id)
        b_node = nodes_by_floor.get(fb, {}).get(b_id)
        if not a_node or not b_node:
            continue

        edges_by_floor.setdefault(fa, []).append(
            {"from": a_id, "to": b_id, "weight": round(euclid(a_node, b_node), 3)}
        )

    return nodes_by_floor, edges_by_floor

# ---------------- IO ----------------
def dump_json(path: Path, obj, force: bool):
    if path.exists() and not force:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")

def dump_csv(path: Path, headers: List[str], rows: List[List], force: bool):
    if path.exists() and not force:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(headers)
        w.writerows(rows)

def write_per_floor(floors, nodes_by_floor, edges_by_floor, jsondir: Path, csvdir: Path, force: bool):
    summary = []
    for fl in sorted(floors):
        nodes = nodes_by_floor.get(fl, {})
        edges = edges_by_floor.get(fl, [])

        dump_json(jsondir / f"nodes_floor{fl}.json", {"nodes": nodes}, force)
        dump_json(jsondir / f"edges_floor{fl}.json", {"edges": edges}, force)
        dump_json(
            jsondir / f"graph_floor{fl}.json",
            {"floor": fl, "nodes": [{"id": k, **v} for k, v in nodes.items()], "edges": edges},
            force,
        )

        n_csv = csvdir / f"nodes_floor{fl}.csv"
        e_csv = csvdir / f"edges_floor{fl}.csv"
        dump_csv(
            n_csv,
            ["id", "x", "y", "name", "type", "floor"],
            [[nid, n["x"], n["y"], n["name"], n["type"], n["floor"]] for nid, n in nodes.items()],
            force,
        )
        dump_csv(
            e_csv,
            ["from", "to", "weight"],
            [[e["from"], e["to"], e["weight"]] for e in edges],
            force,
        )

        zpath = csvdir / f"floor{fl}_graph_csv.zip"
        if force and zpath.exists():
            zpath.unlink()
        if not zpath.exists():
            with zipfile.ZipFile(zpath, "w", compression=zipfile.ZIP_DEFLATED) as z:
                z.write(n_csv, arcname=n_csv.name)
                z.write(e_csv, arcname=e_csv.name)

        summary.append(
            {"floor": fl, "nodes": len(nodes), "edges": len(edges), "jsondir": str(jsondir), "csvzip": str(zpath)}
        )
    return summary

# --------------- Options ---------------
def parse_floor_arg(floors_arg: str) -> Set[int]:
    res: Set[int] = set()
    if floors_arg.strip().lower() == "all":
        return set()  # special: will replace with found floors later
    for tok in re.split(r"[,\s]+", floors_arg.strip()):
        if not tok:
            continue
        try:
            res.add(int(tok))
        except ValueError:
            raise SystemExit(f"Invalid floor token: {tok!r}")
    return res

def parse_remap(s: Optional[str]) -> Dict[int, int]:
    m = {}
    if not s:
        return m
    for pair in re.split(r"[,\s]+", s.strip()):
        if not pair:
            continue
        try:
            src, dst = pair.split(":")
            m[int(src)] = int(dst)
        except Exception:
            raise SystemExit(f"Invalid --remap entry: {pair!r} (use SRC:DST, e.g., 3:4)")
    return m

def build_parser():
    ap = argparse.ArgumentParser(description="IndoorGML -> CSV+JSON per floor")
    ap.add_argument("input", nargs="?", help="Path to input .gml/.xml")
    ap.add_argument("-i", "--gml", dest="gml", help="Path to input .gml/.xml")
    ap.add_argument("-j", "--jsondir", default="out_json", help="Output folder for JSON")
    ap.add_argument("-c", "--csvdir", default="out_csv", help="Output folder for CSV/ZIP")
    ap.add_argument("-f", "--floors", default="all", help="Comma list or 'all'")
    ap.add_argument("-d", "--default-floor", type=int, default=1, help="Fallback floor number")
    ap.add_argument("-y", "--force", action="store_true", help="Overwrite outputs")
    ap.add_argument("--allow-missing", action="store_true", help="Write empty outputs for requested-but-missing floors")
    ap.add_argument("--remap", default="", help="Floor remap after parse. Example: '3:4,1:1'")
    # NEW:
    ap.add_argument("--as-floor", type=int, default=None, help="Force all parsed states/transitions to this floor")
    ap.add_argument("--id-pattern", default=r"^state_(\d+)_([A-Za-z0-9._-]+)$",
                    help=r"Regex with two groups (floor,id). Example: '^f(\d+)_([A-Za-z0-9._-]+)$'")
    ap.add_argument("--desc-floor-key", default="floor", help="Key name in JSON description for floor (default: floor)")
    ap.add_argument("--debug-states", action="store_true", help="Print first 10 parsed states (id,floor,pos)")
    return ap

# --------------- Main ---------------
def main():
    ap = build_parser()
    args = ap.parse_args()

    gml_arg = args.input or args.gml
    if not gml_arg:
        ap.print_help()
        raise SystemExit("\n[ERROR] Missing input .gml/.xml (use positional or -i/--gml)")

    in_path = Path(gml_arg)
    if not in_path.is_absolute():
        in_path = (Path.cwd() / in_path).resolve()
    jsondir = Path(args.jsondir).resolve()
    csvdir = Path(args.csvdir).resolve()

    print(f"[CWD ] {Path.cwd().resolve()}")
    print(f"[INPUT] {in_path}")
    print(f"[OUT  ] JSON={jsondir}  CSV={csvdir}")
    print(f"[ARGS ] floors={args.floors} default_floor={args.default_floor} force={args.force}")
    print(f"[EXTRA] as_floor={args.as_floor} id_pattern={args.id_pattern!r} desc_floor_key={args.desc_floor_key}")

    if not in_path.exists():
        raise SystemExit(f"[Input not found] {in_path}")

    cfg = Config(
        id_pattern=args.id_pattern,
        desc_floor_key=args.desc_floor_key,
        default_floor=args.default_floor,
        as_floor=args.as_floor,
        debug=args.debug_states,
    )

    root = load_root(in_path)
    nodes_by_floor, edges_by_floor = collect_graph(root, cfg)

    # optional remap
    remap = parse_remap(args.remap)
    if remap:
        new_nodes: Dict[int, Dict[str, Dict]] = {}
        new_edges: Dict[int, List[Dict]] = {}
        for src_floor, nodes in nodes_by_floor.items():
            dst_floor = remap.get(src_floor, src_floor)
            for nid, n in nodes.items():
                n2 = dict(n); n2["floor"] = dst_floor
                new_nodes.setdefault(dst_floor, {})[nid] = n2
        for src_floor, edges in edges_by_floor.items():
            dst_floor = remap.get(src_floor, src_floor)
            for e in edges:
                new_edges.setdefault(dst_floor, []).append(dict(e))
        nodes_by_floor, edges_by_floor = new_nodes, new_edges

    found_floors = set(nodes_by_floor.keys()) | set(edges_by_floor.keys())

    req = parse_floor_arg(args.floors)
    if not req:  # 'all'
        req = set(found_floors)

    missing = req - found_floors
    if missing and not args.allow_missing:
        raise SystemExit(f"No data for requested floors. Available: {sorted(found_floors)}")
    for fl in missing:
        nodes_by_floor.setdefault(fl, {})
        edges_by_floor.setdefault(fl, [])

    summary = write_per_floor(req, nodes_by_floor, edges_by_floor, jsondir, csvdir, args.force)

    print("==> Done")
    for s in sorted(summary, key=lambda d: d["floor"]):
        print(f"[Floor {s['floor']}] Nodes: {s['nodes']}, Edges: {s['edges']}")
        print(f"  JSON out : {s['jsondir']}")
        print(f"  CSV  zip : {s['csvzip']}")

if __name__ == "__main__":
    main()
