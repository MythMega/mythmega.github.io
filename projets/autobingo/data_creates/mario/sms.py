#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import csv
import json
from pathlib import Path

CSV_PATH = "sms_shinesprite.csv"

OUTPUTS = [
    {
        "filename": "sms_allshine.json",
        "meta": {"Name": "SMS - All Shine (Including Blue Coins)", "Category": "Mario", "Subcategory": "Super Mario Sunshine"},
        "filter": lambda row: True
    },
    {
        "filename": "sms_allshine_without_bc.json",
        "meta": {"Name": "SMS - All Shine BlueCoinless", "Category": "Mario", "Subcategory": "Super Mario Sunshine"},
        "filter": lambda row: row["Index"] <= 96
    },
    {
        "filename": "sms_mainlevels.json",
        "meta": {"Name": "SMS - Main Levels Shine", "Category": "Mario", "Subcategory": "Super Mario Sunshine"},
        "filter": lambda row: row["Index"] <= 77
    },
    {
        "filename": "sms_coinless.json",
        "meta": {"Name": "SMS - Main Stars Coinless (no 100, no red)", "Category": "Mario", "Subcategory": "Super Mario Sunshine"},
        "filter": lambda row: (
            row["Index"] <= 77
            and ("pièces" not in row["name_fr"].lower())
            and ("pièce" not in row["name_fr"].lower())
            and ("coin" not in row["name_en"].lower())
            and ("coins" not in row["name_en"].lower())
            and ("red" not in row["name_en"].lower())
            and ("rouge" not in row["name_fr"].lower())
        )
    },
    {
        "filename": "sms_100coinless.json",
        "meta": {"Name": "SMS - Main Stars 100Coinless", "Category": "Mario", "Subcategory": "Super Mario Sunshine"},
        "filter": lambda row: (
            row["Index"] <= 77
            and ("100" not in row["name_fr"].lower())
            and ("100" not in row["name_en"].lower())
        )
    },
    {
        "filename": "sms_delfino.json",
        "meta": {"Name": "SMS - Delfino Shine", "Category": "Mario", "Subcategory": "Super Mario Sunshine"},
        "filter": lambda row: 78 <= row["Index"] <= 96
    }
]

def read_csv(path):
    rows = []
    with open(path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for r in reader:
            try:
                idx = int(r.get("index") or r.get("Index") or 0)
            except ValueError:
                idx = 0
            rows.append({
                "Index": idx,
                "name_fr": (r.get("name_fr") or "").strip(),
                "name_en": (r.get("name_en") or "").strip()
            })
    return rows

def make_item(row):
    return {
        "Index": row["Index"],
        "Name_FR": row["name_fr"],
        "Name_EN": row["name_en"],
        "PictureMain": f"./assets/category/mario/sms/{row['Index']}.png"
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
        filtered.sort(key=lambda x: x["Index"])
        write_json(spec["filename"], spec["meta"], filtered)
        print(f"Écrit {spec['filename']} ({len(filtered)} items)")

if __name__ == "__main__":
    main()
