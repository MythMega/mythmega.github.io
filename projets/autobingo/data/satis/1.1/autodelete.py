import os
import json

# Dossier contenant les fichiers JSON
FOLDER = "./"   # à adapter si besoin

# Nom du fichier contenant les IDs à supprimer
DELETE_FILE = "to_autodelete.txt"

def load_ids_to_delete(path):
    ids = set()
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.isdigit():
                ids.add(int(line))
    return ids

def process_json_file(filepath, ids_to_delete):
    # Nouveau nom : <nom>.old
    old_filepath = filepath + ".old"
    os.rename(filepath, old_filepath)

    # Lecture du JSON original
    with open(old_filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Filtrage des items
    original_count = len(data.get("Items", []))
    data["Items"] = [
        item for item in data.get("Items", [])
        if item.get("Index") not in ids_to_delete
    ]
    removed_count = original_count - len(data["Items"])

    # Réécriture du fichier sous son nom d’origine
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"{os.path.basename(filepath)} : {removed_count} item(s) supprimé(s)")

def main():
    # Charger les IDs à supprimer
    delete_path = os.path.join(FOLDER, DELETE_FILE)
    if not os.path.exists(delete_path):
        print("❌ Fichier to_autodelete.txt introuvable")
        return

    ids_to_delete = load_ids_to_delete(delete_path)
    print(f"IDs à supprimer : {ids_to_delete}")

    # Parcourir les fichiers JSON du dossier
    for filename in os.listdir(FOLDER):
        if filename.endswith(".json") and filename != DELETE_FILE:
            filepath = os.path.join(FOLDER, filename)
            process_json_file(filepath, ids_to_delete)

    print("✔ Traitement terminé")

if __name__ == "__main__":
    main()
