import csv
import json

INPUT_FILE = "./game_info.csv"
OUTPUT_FILE = "./cats.json"

def extract_categories():
    categories = []

    with open(INPUT_FILE, newline='', encoding="utf-8") as csvfile:
        reader = csv.DictReader(csvfile)
        for row in reader:
            name = row.get("name")
            if name:
                categories.append(name)

    # enlever les doublons + trier
    categories = sorted(set(categories))
    return categories

if __name__ == "__main__":
    cats = extract_categories()

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(cats, f, ensure_ascii=False, indent=2)

    print(f"Fichier généré : {OUTPUT_FILE}")
    print(f"Nombre de catégories : {len(cats)}")
