import json
import os

FILES = [
    "Dataset-accessories.json",
    "Dataset-armor.json",
    "Dataset-goods.json",
    "Dataset-magic.json",
    "Dataset-weapon.json"
]

def split_desc(desc):
    """
    Split au premier '\n'. Retourne (partie1, partie2)
    Si pas de '\n', partie2 = "".
    """
    if not desc:
        return "", ""
    parts = desc.split("\n", 1)
    if len(parts) == 1:
        return parts[0].strip(), ""
    return parts[0].strip(), parts[1].strip()

def process_file(path):
    print(f"Processing {path}...")

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    modified = False

    for item in data:
        # FR
        if item.get("Desc1FR", "").strip() == "":
            d1, d2 = split_desc(item.get("Desc2FR", ""))
            item["Desc1FR"] = d1
            item["Desc2FR"] = d2
            modified = True

        # EN
        if item.get("Desc1EN", "").strip() == "":
            d1, d2 = split_desc(item.get("Desc2EN", ""))
            item["Desc1EN"] = d1
            item["Desc2EN"] = d2
            modified = True

    if modified:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"✔ Modifications enregistrées dans {path}")
    else:
        print(f"✔ Aucun changement nécessaire pour {path}")

def main():
    base_dir = "./"  # adapte si nécessaire
    for filename in FILES:
        path = os.path.join(base_dir, filename)
        if os.path.exists(path):
            process_file(path)
        else:
            print(f"⚠ Fichier introuvable : {path}")

if __name__ == "__main__":
    main()
