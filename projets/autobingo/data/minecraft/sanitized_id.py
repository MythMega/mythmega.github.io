import json
import os

REFERENCE_FILE = "mc26.3.q-full.json"

def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def main():
    # Vérifier que le fichier de référence existe
    if not os.path.exists(REFERENCE_FILE):
        print(f"Fichier de référence introuvable : {REFERENCE_FILE}")
        return

    # Charger le fichier de référence
    ref_data = load_json(REFERENCE_FILE)

    # Construire un mapping PictureMain → Index
    picture_to_id = {}
    for item in ref_data.get("Items", []):
        pic = item.get("PictureMain")
        idx = item.get("Index")
        if pic and idx:
            picture_to_id[pic] = idx

    print(f"Items référencés : {len(picture_to_id)}")

    # Parcourir tous les fichiers JSON du dossier
    for filename in os.listdir("."):
        if not filename.endswith(".json"):
            continue
        if filename == REFERENCE_FILE:
            continue

        data = load_json(filename)
        modified = 0

        for item in data.get("Items", []):
            pic = item.get("PictureMain")
            if pic in picture_to_id:
                correct_id = picture_to_id[pic]
                if item.get("Index") != correct_id:
                    item["Index"] = correct_id
                    modified += 1

        # Sauvegarder si modifié
        if modified > 0:
            save_json(filename, data)

        print(f"{filename} → {modified} ID modifiés")

if __name__ == "__main__":
    main()
