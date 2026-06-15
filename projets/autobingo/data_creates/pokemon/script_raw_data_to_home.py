import json

# Fichiers
RAW_FILE = "raw_data.json"
OUTPUT_FILE = "pokemon_home.json"

def main():
    # Lecture du JSON source
    with open(RAW_FILE, "r", encoding="utf-8") as f:
        raw_data = json.load(f)

    # Structure finale
    output = {
        "Name": "PokeFull",
        "Category": "Pokemon",
        "Subcategory": "Dexes",
        "Items": []
    }

    # Transformation des items
    for entry in raw_data:
        item = {
            "Name_EN": entry.get("Name_EN"),
            "Name_FR": entry.get("Name_FR"),
            "PictureMain": entry.get("Sprite"),
            "PictureAlt": entry.get("Sprite_Shiny"),
            "Index": entry.get("Index")
        }
        output["Items"].append(item)

    # Écriture du fichier final
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"Fichier généré : {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
