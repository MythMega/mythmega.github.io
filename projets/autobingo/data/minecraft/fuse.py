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

    pattern = r"mc([0-9]+(?:\.[0-9]+)+(?:\.q)?)-(items|blocks)(?:\.json)?"
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
    Si on détecte des Index de types mélangés (int et str),
    on réécrit les Index dans le fichier final :
      - blocks  -> "block-<6 chiffres>"
      - items   -> "item-<6 chiffres>"
    """
    items_file = os.path.join(DATA_FOLDER, versions[version]["items"])
    blocks_file = os.path.join(DATA_FOLDER, versions[version]["blocks"])

    items_data = load_json(items_file)
    blocks_data = load_json(blocks_file)

    # Tagger la source pour pouvoir reconstruire des indices uniformes si besoin
    for it in items_data.get("Items", []):
        it["_source"] = "item"
    for bl in blocks_data.get("Items", []):
        bl["_source"] = "block"

    merged_items = items_data.get("Items", []) + blocks_data.get("Items", [])

    # Détecter s'il y a un mélange de types pour "Index" (int vs str)
    has_int = any(isinstance(x.get("Index"), int) for x in merged_items)
    has_str = any(isinstance(x.get("Index"), str) for x in merged_items)
    mixed_types = has_int and has_str

    # Fonction utilitaire pour extraire un entier depuis Index (fallback à un compteur)
    import itertools
    fallback_counter = itertools.count(1)
    def extract_int_index(val):
        if isinstance(val, int):
            return val
        if isinstance(val, str):
            m = re.search(r'\d+', val)
            if m:
                try:
                    return int(m.group())
                except ValueError:
                    pass
        # fallback
        return next(fallback_counter)

    # Si mélange détecté, réécrire les Index au format demandé et préparer un champ de tri
    if mixed_types:
        # Réinitialiser le compteur pour cohérence
        fallback_counter = itertools.count(1)
        for entry in merged_items:
            original = entry.get("Index")
            idx = extract_int_index(original)
            src = entry.get("_source", "item")
            entry["Index"] = f"{src}-{idx:06d}"
            entry["_sort_idx"] = idx
    else:
        # Pas de mélange : on tente de normaliser la clé de tri (numérique si possible)
        for entry in merged_items:
            original = entry.get("Index")
            try:
                entry["_sort_idx"] = int(original)
            except Exception:
                # si ce n'est pas convertible, on garde une valeur de tri basée sur la chaîne
                entry["_sort_idx"] = str(original)

    # Trier par _sort_idx (numérique si possible)
    merged_sorted = sorted(merged_items, key=lambda x: x["_sort_idx"])

    # Nettoyer les champs temporaires avant sauvegarde
    for e in merged_sorted:
        if "_source" in e:
            del e["_source"]
        if "_sort_idx" in e:
            del e["_sort_idx"]

    merged = {
        "Name": f"Minecraft {version} - Chaos Cubed",
        "Category": "Minecraft",
        "Subcategory": "Minecraft Vanilla",
        "Items": merged_sorted
    }

    # 🔧 Si la version contient ".q", on garde le suffixe dans le nom du fichier
    suffix = ".q" if ".q" in items_file or ".q" in blocks_file else ""
    output_path = os.path.join(DATA_FOLDER, f"mc{version}{suffix}-full.json")

    save_json(output_path, merged)
    print(f"\nFusion terminée ! Fichier généré : {output_path}")


def main():
    print("=== Fusion intelligente Minecraft JSON ===")

    versions = scan_versions()
    version = choose_version(versions)
    merge_files(version, versions)


if __name__ == "__main__":
    main()
