import json
import os

# Fichiers source
DATASETS = [
    ("armor", "Dataset-armor.json"),
    ("goods", "Dataset-goods.json"),
    ("weapon", "Dataset-weapon.json")
]

def transform_entry(entry):
    """Transforme un item Elden Ring selon les règles demandées."""
    return {
        "Index": entry.get("ID"),
        "Name_FR": entry.get("NameFR"),
        "Name_EN": entry.get("NameEN"),
        "PictureMain": "https://raw.githubusercontent.com/MythMega/mythmega.github.io/refs/heads/master/projets/ERGussr/" + entry.get("PictureURL")
        # Pas de Sprite_Shiny
    }

def main():
    all_items = []

    # Lecture et transformation de chaque dataset
    for dataset_name, filename in DATASETS:
        if not os.path.exists(filename):
            print(f"⚠️ Fichier introuvable : {filename}")
            continue

        with open(filename, "r", encoding="utf-8") as f:
            data = json.load(f)

        transformed = [transform_entry(entry) for entry in data]

        # Ajout au fichier global
        all_items.extend(transformed)

        # Création du fichier par dataset
        output_dataset = {
            "Name": f"Elden Ring {dataset_name.capitalize()}",
            "Category": "Elden Ring",
            "Subcategory": "Main & DLC",
            "Items": transformed
        }

        out_name = f"eldenring_{dataset_name}.json"
        with open(out_name, "w", encoding="utf-8") as f:
            json.dump(output_dataset, f, indent=2, ensure_ascii=False)

        print(f"Fichier généré : {out_name}")

    # Création du fichier global
    output_full = {
        "Name": "Elden Ring Full",
        "Category": "Elden Ring",
        "Subcategory": "Main & DLC",
        "Items": all_items
    }

    with open("eldenring_full.json", "w", encoding="utf-8") as f:
        json.dump(output_full, f, indent=2, ensure_ascii=False)

    print("Fichier généré : eldenring_full.json")

if __name__ == "__main__":
    main()
