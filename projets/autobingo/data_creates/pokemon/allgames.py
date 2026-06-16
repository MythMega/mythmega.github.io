#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import csv
import json
from pathlib import Path
from datetime import datetime

RAW_DATA_FILE = "raw_data.json"
CSV_FOLDER = Path("./csv_regional_dexes")
LOG_FILE = "allgames_execution.log"

# ---------------------------------------------------------
# Logging helper
# ---------------------------------------------------------
def log(msg):
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(f"[{datetime.now()}] {msg}\n")
    print(msg)

# ---------------------------------------------------------
# Load raw_data.json
# ---------------------------------------------------------
def load_raw_data():
    with open(RAW_DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    # index by English name for fast lookup
    return {entry["Name_EN"].lower(): entry for entry in data}

# ---------------------------------------------------------
# Read a CSV (no headers)
# ---------------------------------------------------------
def read_csv(path):
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.reader(f)
        for line in reader:
            if len(line) < 2:
                continue
            index_raw, name_en = line[0].strip(), line[1].strip()
            # index_raw is like "ssia-1" → extract number after "-"
            try:
                index = int(index_raw.split("-")[-1])
            except:
                index = None
            rows.append((index, name_en))
    return rows

# ---------------------------------------------------------
# Build items from CSV + raw_data
# ---------------------------------------------------------
def build_items(csv_files, raw_data):
    items = []
    seen = set()
    missing = 0
    duplicates = 0

    for csv_file in csv_files:
        rows = read_csv(CSV_FOLDER / csv_file)
        for index, name_en in rows:
            key = name_en.lower()

            # Doublon ?
            if key in seen:
                duplicates += 1
                continue

            # 1) Recherche exacte
            if key in raw_data:
                rd = raw_data[key]

            else:
                # 2) Recherche par "contains"
                candidates = [
                    rd for en, rd in raw_data.items()
                    if key in en  # name_en contenu dans raw_data.Name_EN
                ]

                if len(candidates) > 0:
                    rd = candidates[0]
                    log(f"🔍 Correspondance approximative trouvée : '{name_en}' → '{rd['Name_EN']}'")
                else:
                    # 3) Rien trouvé
                    log(f"❌ Pokémon introuvable (exact + contains) : {name_en}")
                    missing += 1
                    continue

            # Ajout final
            items.append({
                "Index": index,
                "Name_EN": name_en,
                "Name_FR": rd["Name_FR"],
                "PictureMain": rd["Sprite"],
                "PictureAlt": rd["Sprite_Shiny"]
            })

            seen.add(key)

    return items, missing, duplicates

# ---------------------------------------------------------
# Write JSON output
# ---------------------------------------------------------
def write_json(filename, meta, items):
    out = {
        "Name": meta["Name"],
        "Category": meta["Category"],
        "Subcategory": meta["Subcategory"],
        "Items": items
    }
    with open("./output/" + filename, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

# ---------------------------------------------------------
# Definitions of all outputs
# ---------------------------------------------------------
OUTPUTS = [
    ("pla.json",
     {"Name": "Pokémon Legends : Arceus", "Category": "Pokemon", "Subcategory": "Pokémon Full Game"},
     ["pla.csv"]),

    ("sv_no_dlc.json",
     {"Name": "Pokémon Scarlet / Violet (no DLC)", "Category": "Pokemon", "Subcategory": "Pokémon Full Game"},
     ["sv_no_dlc.csv"]),

    ("sv_tealmask.json",
     {"Name": "Pokémon Scarlet / Violet : The Teal Mask (DLC Only)", "Category": "Pokemon", "Subcategory": "Pokémon Full Game"},
     ["sv_only_dlc_tealmask.csv"]),

    ("sv_indigodisk.json",
     {"Name": "Pokémon Scarlet / Violet : Indigo Disk (DLC Only)", "Category": "Pokemon", "Subcategory": "Pokémon Full Game"},
     ["sv_only_dlc_indigodisk.csv"]),

    ("sv_fullgame.json",
     {"Name": "Pokémon Scarlet / Violet : Full Game (Game + DLC)", "Category": "Pokemon", "Subcategory": "Pokémon Full Game"},
     ["sv_no_dlc.csv", "sv_only_dlc_tealmask.csv", "sv_only_dlc_indigodisk.csv"]),

    ("swsh_no_dlc.json",
     {"Name": "Pokémon Sword / Shield (no DLC)", "Category": "Pokemon", "Subcategory": "Pokémon Full Game"},
     ["swsh_no_dlc.csv"]),

    ("swsh_ia.json",
     {"Name": "Pokémon Sword / Shield : Isle of Armor (DLC Only)", "Category": "Pokemon", "Subcategory": "Pokémon Full Game"},
     ["swsh_only_dlc_ia.csv"]),

    ("swsh_tc.json",
     {"Name": "Pokémon Sword / Shield : Crown Toundra (DLC Only)", "Category": "Pokemon", "Subcategory": "Pokémon Full Game"},
     ["swsh_only_dlc_ct.csv"]),

    ("swsh_fullgame.json",
     {"Name": "Pokémon Sword / Shield : Full Game (Game + DLC)", "Category": "Pokemon", "Subcategory": "Pokémon Full Game"},
     ["swsh_no_dlc.csv", "swsh_only_dlc_ct.csv", "swsh_only_dlc_ia.csv"]),

    ("za_no_dlc.json",
     {"Name": "Pokémon Legends: Z-A (no DLC)", "Category": "Pokemon", "Subcategory": "Pokémon Full Game"},
     ["za_no_dlc.csv"]),

    ("za_dlc.json",
     {"Name": "Pokémon Legends: Z-A : Mega Dimension (DLC Only)", "Category": "Pokemon", "Subcategory": "Pokémon Full Game"},
     ["za_only_dlc.csv"]),

    ("za_fullgame.json",
     {"Name": "Pokémon Legends: Z-A : Full Game (Game + DLC)", "Category": "Pokemon", "Subcategory": "Pokémon Full Game"},
     ["za_no_dlc.csv", "za_only_dlc.csv"]),
]

# ---------------------------------------------------------
# Main
# ---------------------------------------------------------
def main():
    # reset log
    open(LOG_FILE, "w").close()

    log("===== DÉBUT DE L’EXÉCUTION =====")

    raw_data = load_raw_data()

    for filename, meta, csv_list in OUTPUTS:
        log(f"\n📄 Construction du JSON : {filename}")
        log(f"CSV utilisés : {', '.join(csv_list)}")

        items, missing, duplicates = build_items(csv_list, raw_data)

        write_json(filename, meta, items)

        log(f"✔ Total Pokémon : {len(items)}")
        log(f"⚠ Introuvables : {missing}")
        log(f"🔁 Doublons ignorés : {duplicates}")

    log("\n===== FIN DE L’EXÉCUTION =====")

if __name__ == "__main__":
    main()