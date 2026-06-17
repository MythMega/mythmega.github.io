#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import csv
import json
from pathlib import Path

CSV_FILE = "oot_items_translated.csv"
OUTPUT_FILE = "oot_items.json"

def read_csv(path):
    items = []
    with open(path, newline='', encoding='utf-8') as f:
        reader = csv.reader(f)

        # Ignorer la première ligne (en-têtes)
        next(reader, None)

        for row in reader:
            if len(row) < 4:
                continue

            index = int(row[0].strip())
            name_fr = row[1].strip()
            name_en = row[2].strip()
            imgsrc = row[3].strip()

            items.append({
                "Index": index,
                "Name_FR": name_fr,
                "Name_EN": name_en,
                "PictureMain": imgsrc
            })

    return items

def write_json(path, items):
    data = {
        "Name": "Zelda Ocarina Of Time - Key items",
        "Category": "Zelda",
        "Subcategory": "Zelda Ocarina Of Time",
        "Items": items
    }

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def main():
    csv_path = Path(CSV_FILE)
    if not csv_path.exists():
        print(f"CSV introuvable : {CSV_FILE}")
        return

    items = read_csv(csv_path)
    items.sort(key=lambda x: x["Index"])

    write_json(OUTPUT_FILE, items)
    print(f"✔ JSON généré : {OUTPUT_FILE} ({len(items)} items)")

if __name__ == "__main__":
    main()
