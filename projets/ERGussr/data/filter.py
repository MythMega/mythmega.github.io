import json
import os

def process_dataset(file_path):
    """Traite un fichier JSON selon les filtres JS et retourne les stats."""
    print(f"[Processing] {file_path}")

    with open(file_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    if not isinstance(raw, list) or len(raw) == 0:
        print(f"[Warning] Dataset vide ou non valide: {file_path}")
        return (file_path, 0, 0)

    all_items = [
        {
            "ID": r.get("ID"),
            "NameFR": r.get("NameFR", ""),
            "NameEN": r.get("NameEN", ""),
            "Desc1FR": r.get("Desc1FR", ""),
            "Desc1EN": r.get("Desc1EN", ""),
            "Desc2FR": r.get("Desc2FR", ""),
            "Desc2EN": r.get("Desc2EN", ""),
            "Desc3FR": r.get("Desc3FR", ""),
            "Desc3EN": r.get("Desc3EN", ""),
            "PictureURL": r.get("PictureURL", "")
        }
        for r in raw
    ]

    # Filtres identiques au JS
    with_desc = [
        i for i in all_items
        if i.get("Desc1FR", "").strip() != "" and i.get("Desc1EN", "").strip() != ""
    ]
    no_newline = [i for i in with_desc if "\n" not in i["NameFR"] and "\n" not in i["NameEN"]]
    items = [i for i in no_newline if "(Alt" not in i["NameEN"] and "(alt" not in i["NameFR"]]

    # Logs de diagnostic pour voir ce qui est supprimé
    for i in all_items:
        if not (i.get("Desc1FR", "").strip() and i.get("Desc1EN", "").strip()):
            print(f"[Skip-Desc] {i.get('NameFR')} — Desc1FR='{i.get('Desc1FR')}', Desc1EN='{i.get('Desc1EN')}'")
        elif "\n" in i.get("NameFR", "") or "\n" in i.get("NameEN", ""):
            print(f"[Skip-Name] {i.get('NameFR')} — contient '\\n'")
        elif "(Alt" in i.get("NameEN", "") or "(alt" in i.get("NameFR", ""):
            print(f"[Skip-Alt] {i.get('NameFR')} — variante Alt")

    skipped_desc = len(all_items) - len(with_desc)
    skipped_name = len(with_desc) - len(no_newline)
    skipped_alt = len(no_newline) - len(items)

    print(f"[Filter] {file_path}: -{skipped_desc} sans desc, -{skipped_name} noms malformés, -{skipped_alt} variantes Alt")

    # Réécriture du fichier filtré dans le même nom
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)

    print(f"[Done] {file_path}: {len(items)} éléments conservés sur {len(all_items)}")

    return (file_path, len(all_items), len(items))

def main():
    data_dir = "./"
    result_lines = []
    print("[Start] Nettoyage des datasets JSON...\n")

    for filename in os.listdir(data_dir):
        if filename.endswith(".json"):
            file_path = os.path.join(data_dir, filename)
            stats = process_dataset(file_path)
            result_lines.append(f"{os.path.basename(stats[0])}: {stats[1]} → {stats[2]} ({stats[1]-stats[2]})")

    result_path = os.path.join(data_dir, "result.txt")
    with open(result_path, "w", encoding="utf-8") as f:
        f.write("\n".join(result_lines))

    print("\n[Summary] Rapport écrit dans result.txt")
    for line in result_lines:
        print(line)

if __name__ == "__main__":
    main()
