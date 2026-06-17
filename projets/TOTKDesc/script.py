#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import csv
import json
from pathlib import Path
import unicodedata

CSV_FILE = "data.csv"
JSON_FILE = "all.json"

# Normalisation des noms anglais
def normalize(name):
    if not name:
        return ""
    name = name.lower().strip()
    name = name.replace("’", "'")
    name = unicodedata.normalize("NFKD", name)
    return name

# Lecture du compendium TOTK
def load_compendium():
    with open(JSON_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    comp = {}
    for entry in data.get("data", []):
        key = normalize(entry.get("name", ""))
        comp[key] = entry.get("image", None)

    return comp

# Lecture du CSV TOTK
def load_csv():
    rows = []
    with open(CSV_FILE, newline='', encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append({
                "category": row["category"].strip(),
                "name_en": row["item_name_en"].strip(),
                "name_fr": row["item_name_fr"].strip(),
                "index": row["item_id"].strip()
            })
    return rows

# Trouver l'image via compendium
def find_image(name_en, category, compendium):
    key = normalize(name_en)

    # 1) Match exact
    if key in compendium and compendium[key]:
        return compendium[key]

    # 2) Match contains
    for k, img in compendium.items():
        if key in k and img:
            return img

    # 3) Fallback handled later
    return None

# Génération d'un JSON
def write_json(filename, name, category, subcategory, items):
    out = {
        "Name": name,
        "Category": category,
        "Subcategory": subcategory,
        "Items": items
    }
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

def main():
    compendium = load_compendium()
    rows = load_csv()

    # Catégories autorisées dans le "all"
    allowed_for_all = {
        "Bows and Arrows",
        "Weapons",
        "Armor",
        "Shields",
        "Food",
        "Zonai Devices",
        "Key Items",
        "Materials"
    }

    # Catégories trouvées dans le CSV
    categories = sorted(set(r["category"] for r in rows))

    # Construction des items par catégorie
    items_by_category = {cat: [] for cat in categories}

    for r in rows:
        img = find_image(r["name_en"], r["category"], compendium)

        # Règle spéciale pour Armor et Zonai Devices
        if img is None and r["category"] in ["Armor", "Zonai Devices"]:
            img = f"./assets/category/zelda/totk/{r['category'].replace(' ', '_')}/{r['name_en'].replace(' ', '_')}.png"

        # Règle générale fallback
        if img is None:
            img = f"{r['category']}.png"

        item = {
            "Index": r["index"],
            "Name_EN": r["name_en"],
            "Name_FR": r["name_fr"],
            "PictureMain": img
        }

        items_by_category[r["category"]].append(item)

    # 1) JSON global (uniquement les catégories autorisées)
    all_items = []
    for cat, items in items_by_category.items():
        if cat in allowed_for_all:
            for it in items:

                # Règle spéciale : ignorer si fallback générique
                # sauf pour Armor et Zonai Devices
                if it["PictureMain"].endswith(".png") and cat not in ["Armor", "Zonai Devices"]:
                    continue

                all_items.append(it)

    write_json(
        "totk_all.json",
        "Zelda Tears Of the Kingdom - All items",
        "Zelda",
        "Zelda Tears Of the Kingdom",
        all_items
    )

    # 2) JSON par catégorie (y compris Shrine & Lightroot)
    for cat, items in items_by_category.items():
        filename = f"totk_{cat.replace(' ', '_').lower()}.json"
        write_json(
            filename,
            f"Zelda Tears Of the Kingdom - {cat}",
            "Zelda",
            "Zelda Tears Of the Kingdom",
            items
        )

    print("✔ Tous les JSON TOTK ont été générés.")

if __name__ == "__main__":
    main()
