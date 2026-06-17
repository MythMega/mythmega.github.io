import json
import re
from pathlib import Path

INPUT_FILE = "totk_weapons.old.json"
OUTPUT_FILE = "totk_weapons.json"
LICENCE_FOLDER = "zelda"
GAME_FOLDER = "totk"
SUBCAT_FOLDER = "Weapon"

# ---------------------------------------------------------------------------
# Liste des Index autorisés.
# - Si cette liste contient ".all", alors TOUS les items seront modifiés.
# - Sinon, seuls les items dont l'Index est présent dans cette liste seront modifiés.
# - Tous les items, modifiés ou non, seront présents dans le JSON final.
# ---------------------------------------------------------------------------
ALLOWED_INDEXES = ["Weapon_Lsword_001","Weapon_Lsword_002","Weapon_Lsword_003","Weapon_Lsword_047","Weapon_Lsword_059","Weapon_Lsword_106","Weapon_Lsword_112","Weapon_Lsword_113","Weapon_Lsword_147","Weapon_Spear_001","Weapon_Spear_002","Weapon_Spear_003","Weapon_Spear_022","Weapon_Spear_025","Weapon_Spear_047","Weapon_Spear_106","Weapon_Spear_112","Weapon_Spear_113","Weapon_Spear_125","Weapon_Spear_147","Weapon_Sword_001","Weapon_Sword_002","Weapon_Sword_003","Weapon_Sword_025","Weapon_Sword_047","Weapon_Sword_070_Broken","Weapon_Sword_106","Weapon_Sword_112","Weapon_Sword_113","Weapon_Sword_125","Weapon_Sword_147"]

def normalize_filename(name_en: str) -> str:
    # Remplace espace, apostrophe ASCII ('), apostrophe typographique (’), et guillemet (")
    return re.sub(r"[ '\"]|’", "_", name_en)


def main():
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    items = data.get("Items", [])

    treat_all = ".all" in ALLOWED_INDEXES
    seen = set()
    cleaned_items = []

    for item in items:
        index = item.get("Index")

        # Ignore les doublons
        if index in seen:
            continue
        seen.add(index)

        # Si l'item doit être modifié
        if treat_all or index in ALLOWED_INDEXES:
            filename = normalize_filename(item["Name_EN"]) + ".png"
            item["PictureMain"] = f"./assets/category/{LICENCE_FOLDER}/{GAME_FOLDER}/{SUBCAT_FOLDER}/{filename}"

        # Dans tous les cas, on ajoute l'item au JSON final
        cleaned_items.append(item)

    # Reconstruction du JSON final
    output = {
        "Name": data.get("Name"),
        "Category": data.get("Category"),
        "Subcategory": data.get("Subcategory"),
        "Items": cleaned_items
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"JSON nettoyé écrit dans {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
