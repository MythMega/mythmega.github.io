import json
import os

RAW_FILE = "raw_data.json"

def main():
    # Lecture du fichier source
    with open(RAW_FILE, "r", encoding="utf-8") as f:
        raw_data = json.load(f)

    # Regroupement par série
    series_map = {}

    for entry in raw_data:
        serie = entry.get("Serie", "").lower()

        if serie not in series_map:
            series_map[serie] = []

        item = {
            "Name_EN": entry.get("Name_EN"),
            "Name_FR": entry.get("Name_FR"),
            "PictureMain": entry.get("Sprite"),
            "PictureAlt": entry.get("Sprite_Shiny"),
            "Index": entry.get("Index")
        }

        series_map[serie].append(item)

    # Création des fichiers par série
    for serie, items in series_map.items():
        output = {
            "Name": f"Pokémon {serie.capitalize()}",
            "Category": "Pokemon",
            "Subcategory": "Generation Dex",
            "Items": items
        }

        filename = f"pokemon_{serie}.json"

        with open(filename, "w", encoding="utf-8") as f:
            json.dump(output, f, indent=2, ensure_ascii=False)

        print(f"Fichier généré : {filename}")

if __name__ == "__main__":
    main()
