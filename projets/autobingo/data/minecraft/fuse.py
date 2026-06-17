import json
import os
import re

DATA_FOLDER = "./"   # Dossier contenant les JSON


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def scan_versions():
    """
    Scanne le dossier et retourne un dict :
    {
        "26.2": {"items": "...", "blocks": "..."},
        "1.21.9": {"items": "...", "blocks": "..."},
        ...
    }

    Le regex accepte toutes les versions : 1.21.9, 26.2, 3.5.12, etc.
    """
    versions = {}

    pattern = r"mc([0-9]+(?:\.[0-9]+)+)-(items|blocks)\.json"

    for filename in os.listdir(DATA_FOLDER):
        match = re.match(pattern, filename)
        if match:
            version, ftype = match.groups()
            versions.setdefault(version, {})
            versions[version][ftype] = filename

    return versions


def choose_version(versions):
    """
    Affiche les versions disponibles et laisse l'utilisateur choisir.
    """
    print("\nVersions détectées :")
    valid_versions = []

    for v, files in versions.items():
        if "items" in files and "blocks" in files:
            valid_versions.append(v)
            print(f"  - {v}  (items + blocks OK)")
        else:
            print(f"  - {v}  (incomplet)")

    if not valid_versions:
        print("Aucune version complète trouvée.")
        exit()

    print("\nQuelle version veux-tu fusionner ?")
    for i, v in enumerate(valid_versions, 1):
        print(f"{i}. {v}")

    choice = int(input("\nChoix : ")) - 1
    return valid_versions[choice]


def merge_files(version, versions):
    """
    Fusionne items + blocks → full
    """
    items_file = os.path.join(DATA_FOLDER, versions[version]["items"])
    blocks_file = os.path.join(DATA_FOLDER, versions[version]["blocks"])

    items_data = load_json(items_file)
    blocks_data = load_json(blocks_file)

    merged = {
        "Name": f"Minecraft {version} - Chaos Cubed",
        "Category": "Minecraft",
        "Subcategory": "Minecraft Vanilla",
        "Items": sorted(
            items_data["Items"] + blocks_data["Items"],
            key=lambda x: x["Index"]
        )
    }

    output_path = os.path.join(DATA_FOLDER, f"mc{version}-full.json")
    save_json(output_path, merged)

    print(f"\nFusion terminée ! Fichier généré : {output_path}")


def main():
    print("=== Fusion intelligente Minecraft JSON ===")

    versions = scan_versions()
    version = choose_version(versions)
    merge_files(version, versions)


if __name__ == "__main__":
    main()
