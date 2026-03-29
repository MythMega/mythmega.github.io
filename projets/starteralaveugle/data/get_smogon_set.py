#!/usr/bin/env python3
# coding: utf-8
"""
Enrich data_converted.json with Smogon sets from multiple gen files.
Creates data.json and notfound.txt listing Pokémon not found in any provided Smogon files.
Usage:
  py get_smogon_set_multi.py [smogon_file1.json smogon_file2.json ...]
If no args provided, uses default SMOGON_PATHS.
"""

import json
import re
import sys
from pathlib import Path

# --- Config par défaut ---
DATA_RAW_PATH = Path("./data_converted.json")
DEFAULT_SMOGON_PATHS = [
    Path("./gen9.json"),
    Path("./gen8.json"),
    Path("./gen7.json"),
    Path("./gen6.json"),
    Path("./gen5.json"),
    Path("./gen4.json"),
]
OUTPUT_PATH = Path("./data.json")
NOTFOUND_PATH = Path("./notfound.txt")

# --- Helpers ---
def load_json(path: Path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_json(obj, path: Path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)

def save_notfound(list_names, path: Path):
    # unique, tri alphabétique, une ligne par nom (vide si aucun)
    unique = sorted(set(list_names), key=lambda s: (s is None, s or ""))
    with open(path, "w", encoding="utf-8") as f:
        for name in unique:
            f.write((name or "<unknown>") + "\n")

def choose_first(x):
    if x is None:
        return None
    if isinstance(x, list):
        return x[0] if x else None
    return x

def normalize_key(s):
    if not isinstance(s, str):
        return s
    s2 = s.strip().lower()
    s2 = re.sub(r"[^a-z0-9]", "", s2)
    return s2

def build_evs_line(evs):
    if not evs:
        return None
    if isinstance(evs, list):
        evs = evs[0] if evs else {}
    if not isinstance(evs, dict):
        return None
    order = [("hp", "HP"), ("atk", "Atk"), ("def", "Def"), ("spa", "SpA"), ("spd", "SpD"), ("spe", "Spe")]
    parts = []
    for key, label in order:
        val = evs.get(key)
        if val is None:
            alt_map = {"spa": ["spa", "sp_atk", "spe_atk"], "spd": ["spd", "sp_def", "spe_def"], "spe": ["spe", "vit", "speed"]}
            if key in alt_map:
                for alt in alt_map[key]:
                    if alt in evs:
                        val = evs.get(alt)
                        break
        if isinstance(val, list):
            val = val[0] if val else None
        if val is not None and int(val) != 0:
            parts.append(f"{int(val)} {label}")
    if not parts:
        return None
    return "EVs: " + " / ".join(parts)

def build_ivs_line(ivs):
    if not ivs:
        return None
    if isinstance(ivs, list):
        ivs = ivs[0] if ivs else {}
    if not isinstance(ivs, dict):
        return None
    parts = []
    label_map = {"hp":"HP","atk":"Atk","def":"Def","spa":"SpA","spd":"SpD","spe":"Spe"}
    for k, label in label_map.items():
        if k in ivs:
            v = ivs[k]
            if isinstance(v, list):
                v = v[0] if v else None
            if v is not None:
                parts.append(f"{int(v)} {label}")
    if not parts:
        return None
    return "IVs: " + " / ".join(parts)

def format_moves(moves):
    if not moves:
        return []
    out = []
    for m in moves:
        if isinstance(m, list):
            choice = m[0] if m else None
            if choice:
                out.append(choice)
        else:
            out.append(m)
    return out

def extract_gen_label_from_filename(path: Path):
    name = path.stem
    m = re.search(r"([A-Za-z]+)(\d+)", name)
    if m:
        digits = m.group(2)
        return f"Gen-{digits}"
    return name.capitalize()

def build_showdown_block(pokemon_name, set_data):
    lines = []
    item = choose_first(set_data.get("item"))
    if item:
        lines.append(f"{pokemon_name} @ {item}")
    else:
        lines.append(f"{pokemon_name}")
    ability = choose_first(set_data.get("ability"))
    if ability:
        lines.append(f"Ability: {ability}")
    level = set_data.get("level")
    if level:
        lines.append(f"Level: {level}")
    teratypes = choose_first(set_data.get("teratypes") or set_data.get("teratype"))
    if teratypes:
        lines.append(f"Tera Type: {teratypes}")
    evs_line = build_evs_line(set_data.get("evs"))
    if evs_line:
        lines.append(evs_line)
    nature = set_data.get("nature")
    if nature:
        nature_choice = choose_first(nature)
        if nature_choice:
            lines.append(f"{nature_choice} Nature")
    ivs_line = build_ivs_line(set_data.get("ivs"))
    if ivs_line:
        lines.append(ivs_line)
    moves = set_data.get("moves") or []
    moves_formatted = format_moves(moves)
    for mv in moves_formatted:
        lines.append(f"- {mv}")
    return "\n".join(lines)

def build_name_index(smogon):
    idx = {}
    for key in smogon.keys():
        nk = normalize_key(key)
        idx.setdefault(nk, []).append(key)
    return idx

def find_smogon_entry_in_data(smogon, english_name):
    if not english_name:
        return None
    if english_name in smogon:
        return smogon[english_name]
    title = english_name.title()
    if title in smogon:
        return smogon[title]
    nk = normalize_key(english_name)
    idx = build_name_index(smogon)
    candidates = idx.get(nk)
    if candidates:
        return smogon[candidates[0]]
    alt = re.sub(r"[\s\-']", "", english_name)
    if alt in smogon:
        return smogon[alt]
    alt2 = normalize_key(alt)
    candidates = idx.get(alt2)
    if candidates:
        return smogon[candidates[0]]
    return None

def enrich(data_raw, smogon_files):
    enriched = []
    not_found_all = []
    # Preload smogon JSONs into list of tuples (data, gen_label)
    smogon_loaded = []
    for p in smogon_files:
        if not p.exists():
            print(f"Warning: Smogon file not found: {p} (skipped)")
            continue
        try:
            data = load_json(p)
            gen_label = extract_gen_label_from_filename(p)
            smogon_loaded.append((data, gen_label))
        except Exception as e:
            print(f"Error loading {p}: {e}")
    for entry in data_raw:
        e = dict(entry)
        e_sets = []
        en_name = entry.get("name", {}).get("en")
        found = False
        for smogon_data, gen_label in smogon_loaded:
            smogon_entry = find_smogon_entry_in_data(smogon_data, en_name)
            if not smogon_entry:
                continue
            # found in this gen file
            for tier, sets_dict in smogon_entry.items():
                if not isinstance(sets_dict, dict):
                    continue
                for set_name, set_data in sets_dict.items():
                    display_name = f"{set_name} {tier.upper()} [{gen_label}]"
                    sd_block = build_showdown_block(en_name or entry.get("name", {}).get("fr", "Pokémon"), set_data)
                    e_sets.append({"Name": display_name, "Set": sd_block})
            found = True
            break  # stop at first gen where we found sets
        if not found:
            e["Sets"] = []
            not_found_all.append(en_name or "<unknown>")
        else:
            e["Sets"] = e_sets
        enriched.append(e)
    return enriched, not_found_all

def main():
    # allow passing smogon files as CLI args
    smogon_paths = [Path(p) for p in sys.argv[1:]] if len(sys.argv) > 1 else DEFAULT_SMOGON_PATHS
    print("Working dir:", Path.cwd())
    print("Using Smogon files (in order):", [str(p) for p in smogon_paths])
    if not DATA_RAW_PATH.exists():
        print(f"Error: {DATA_RAW_PATH} not found.")
        return
    data_raw = load_json(DATA_RAW_PATH)
    enriched, not_found = enrich(data_raw, smogon_paths)
    save_json(enriched, OUTPUT_PATH)
    save_notfound(not_found, NOTFOUND_PATH)
    print(f"Enriched data written to {OUTPUT_PATH}")
    print(f"Pokémon not found written to {NOTFOUND_PATH} ({len(set(not_found))} unique entries)")
    if not_found:
        print("Exemples:", sorted(set(not_found))[:10])

if __name__ == "__main__":
    main()
