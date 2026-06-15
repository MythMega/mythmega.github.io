#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import csv
import json
from pathlib import Path

CSV_PATH = "sm64_stars.csv"

OUTPUTS = [
    {
        "filename": "sm64_allstars.json",
        "meta": {"Name": "SM64 - All Stars", "Category": "Mario", "Subcategory": "Super Mario 64"},
        "filter": lambda row: True
    },
    {
        "filename": "sm64_main_without_100c.json",
        "meta": {"Name": "SM64 - Main Stars 100Coinless", "Category": "Mario", "Subcategory": "Super Mario 64"},
        "filter": lambda row: (row["Index"] <= 105) and ("100" not in row["name_fr"].lower()) and ("100" not in row["name_en"].lower())
    },
    {
        "filename": "sm64_mainlevels.json",
        "meta": {"Name": "SM64 - Main Levels Stars", "Category": "Mario", "Subcategory": "Super Mario 64"},
        "filter": lambda row: row["Index"] <= 105
    },
    {
        "filename": "sm64_coinless.json",
        "meta": {"Name": "SM64 - Main Stars Coinless (no 100, no red)", "Category": "Mario", "Subcategory": "Super Mario 64"},
        # Exclut les étoiles "100" et celles contenant "pièces" (FR) ou "coin"/"coins"/"red"/"rouge" (EN/FR)
        "filter": lambda row: (
            row["Index"] <= 105
            and ("100" not in row["name_fr"].lower())
            and ("100" not in row["name_en"].lower())
            and ("pièces" not in row["name_fr"].lower())
            and ("pièce" not in row["name_fr"].lower())
            and ("coin" not in row["name_en"].lower())
            and ("coins" not in row["name_en"].lower())
            and ("red" not in row["name_en"].lower())
            and ("rouge" not in row["name_fr"].lower())
        )
    },
    {
        "filename": "sm64_1stfloor.json",
        "meta": {"Name": "SM64 - 1st Floor", "Category": "Mario", "Subcategory": "Super Mario 64"},
        "filter": lambda row: (row["Index"] <= 28) or (row["Index"] == 118)
    }
]

def read_csv(path):
    rows = []
    with open(path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for r in reader:
            try:
                idx = int(r.get("index") or r.get("Index") or r.get("id") or 0)
            except ValueError:
                idx = 0
            rows.append({
                "Index": idx,
                "name_fr": (r.get("name_fr") or r.get("name_fr".lower()) or r.get("name_fr".upper()) or r.get("name_fr".capitalize()) or r.get("name_fr") or "").strip(),
                "name_en": (r.get("name_en") or "").strip()
            })
    return rows

def make_item(row):
    return {
        "Index": row["Index"],
        "Name_FR": row["name_fr"],
        "Name_EN": row["name_en"],
        "PictureMain": f"./assets/category/mario/sm64/{row['Index']}.png"
    }

def write_json(path, meta, items):
    out = {
        "Name": meta["Name"],
        "Category": meta["Category"],
        "Subcategory": meta["Subcategory"],
        "Items": items
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

def main():
    csv_path = Path(CSV_PATH)
    if not csv_path.exists():
        print(f"CSV introuvable: {csv_path}")
        return

    rows = read_csv(csv_path)

    for spec in OUTPUTS:
        filtered = [make_item(r) for r in rows if spec["filter"](r)]
        # trier par Index croissant pour stabilité
        filtered.sort(key=lambda x: x["Index"])
        write_json(spec["filename"], spec["meta"], filtered)
        print(f"Écrit {spec['filename']} ({len(filtered)} items)")

if __name__ == "__main__":
    main()
