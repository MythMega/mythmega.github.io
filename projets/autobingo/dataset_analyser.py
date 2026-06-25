import os
import json

ROOT_DIR = "./data"
OUTPUT_FILE = "datasets.json"

REQUIRED_FIELDS = ["Name", "Category", "Subcategory"]

def is_valid_dataset(json_data):
    """Vérifie que le JSON contient les champs obligatoires."""
    return all(field in json_data for field in REQUIRED_FIELDS)

def normalize_flags(value):
    """
    Retourne une liste de flags selon la règle :
    - si la valeur est None ou une liste vide -> []
    - si la valeur est une liste non vide -> la même liste (éléments convertis en str)
    - sinon -> [str(value)]
    """
    if value is None:
        return []
    if isinstance(value, list):
        # si liste vide -> []
        if len(value) == 0:
            return []
        # normaliser les éléments en string
        return [str(x) for x in value]
    # autre type (string, int, bool, ...) -> mettre en liste
    return [str(value)]

def main():
    datasets = []

    # Parcours récursif du dossier ./data
    for root, dirs, files in os.walk(ROOT_DIR):
        for file in files:
            if not file.endswith(".json"):
                continue

            full_path = os.path.join(root, file)
            relative_path = os.path.relpath(full_path, ".")

            try:
                with open(full_path, "r", encoding="utf-8") as f:
                    data = json.load(f)

                if not isinstance(data, dict):
                    continue

                quantizable = data.get("Quantizable") is True

                if is_valid_dataset(data):
                    raw_flags = data.get("Flags", None)
                    flags_list = normalize_flags(raw_flags)

                    datasets.append({
                        "Name": data["Name"],
                        "Category": data["Category"],
                        "Subcategory": data["Subcategory"],
                        "Location": "./" + relative_path.replace("\\", "/"),
                        "Quantizable": quantizable,
                        "Flags": flags_list
                    })

            except Exception as e:
                print(f"⚠️ Erreur lecture {full_path}: {e}")

    # Tri : Category → Subcategory → Name
    datasets.sort(key=lambda x: (x["Category"], x["Subcategory"], x["Name"]))

    # Écriture du fichier final
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(datasets, f, indent=2, ensure_ascii=False)

    print(f"✔ {OUTPUT_FILE} généré avec {len(datasets)} entrées.")

if __name__ == "__main__":
    main()
